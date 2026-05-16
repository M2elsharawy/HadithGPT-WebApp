/**
 * AudioTrimmerEngine
 * محرك تقطيع الصوت — يعمل محلياً في المتصفح بالكامل
 *
 * يستخدم OfflineAudioContext لتقطيع AudioBuffer من start إلى end
 * ثم يُصدّر النتيجة كـ WAV Blob
 */

export class AudioTrimmerEngine {
  /**
   * تحميل AudioBuffer من URL
   */
  static async loadBuffer(url: string): Promise<AudioBuffer> {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`فشل تحميل الملف: HTTP ${response.status}`);
    const arrayBuffer = await response.arrayBuffer();
    const ctx = new AudioContext();
    try {
      return await ctx.decodeAudioData(arrayBuffer);
    } finally {
      await ctx.close();
    }
  }

  /**
   * تقطيع AudioBuffer من startSec إلى endSec
   * يستخدم OfflineAudioContext — أدق من نسخ arrays يدوياً
   */
  static async trim(
    buffer: AudioBuffer,
    startSec: number,
    endSec: number
  ): Promise<AudioBuffer> {
    const sampleRate = buffer.sampleRate;
    const numChannels = buffer.numberOfChannels;

    const startSample = Math.max(0, Math.floor(startSec * sampleRate));
    const endSample = Math.min(buffer.length, Math.ceil(endSec * sampleRate));
    const trimmedLength = endSample - startSample;

    if (trimmedLength <= 0) {
      throw new Error("نطاق التقطيع غير صالح — تأكد أن نقطة النهاية بعد نقطة البداية");
    }

    const offlineCtx = new OfflineAudioContext(numChannels, trimmedLength, sampleRate);
    const source = offlineCtx.createBufferSource();
    source.buffer = buffer;

    source.connect(offlineCtx.destination);
    // نبدأ التشغيل عند الزمن 0 في الـ offline context
    // لكن نُخبره أن يبدأ من offset = startSec في الـ buffer
    source.start(0, startSec, endSec - startSec);

    return offlineCtx.startRendering();
  }

  /**
   * تحويل AudioBuffer إلى WAV Blob — 16-bit PCM interleaved
   */
  static toWav(buffer: AudioBuffer): Blob {
    const numCh = buffer.numberOfChannels;
    const sr = buffer.sampleRate;
    const len = buffer.length;
    const bps = 2; // 16-bit
    const blockAlign = numCh * bps;
    const dataSize = len * blockAlign;
    const ab = new ArrayBuffer(44 + dataSize);
    const v = new DataView(ab);

    const str = (o: number, s: string) => {
      for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
    };

    str(0, "RIFF"); v.setUint32(4, 36 + dataSize, true);
    str(8, "WAVE"); str(12, "fmt ");
    v.setUint32(16, 16, true);
    v.setUint16(20, 1, true); // PCM
    v.setUint16(22, numCh, true);
    v.setUint32(24, sr, true);
    v.setUint32(28, sr * blockAlign, true);
    v.setUint16(32, blockAlign, true);
    v.setUint16(34, 16, true);
    str(36, "data"); v.setUint32(40, dataSize, true);

    let offset = 44;
    for (let i = 0; i < len; i++) {
      for (let ch = 0; ch < numCh; ch++) {
        const s = Math.max(-1, Math.min(1, buffer.getChannelData(ch)[i]));
        v.setInt16(offset, s < 0 ? s * 32768 : s * 32767, true);
        offset += 2;
      }
    }

    return new Blob([ab], { type: "audio/wav" });
  }

  /**
   * بناء اسم ملف التقطيع
   */
  static buildFileName(originalName: string): string {
    const dot  = originalName.lastIndexOf(".");
    const base = dot !== -1 ? originalName.slice(0, dot) : originalName;
    const clean = base.replace(/(-cut|-trim|-trimmed|-edited)+$/i, "");
    return `${clean}-edited.wav`;
  }

  /**
   * تنسيق الوقت بالثواني إلى mm:ss.t
   */
  static formatTime(sec: number): string {
    if (!isFinite(sec) || sec < 0) return "0:00.0";
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    const t = Math.floor((sec % 1) * 10);
    return `${m}:${s.toString().padStart(2, "0")}.${t}`;
  }

  /**
   * تحقق من صحة النطاق المحدد
   * يُعيد رسالة خطأ أو null إذا كان النطاق صحيحاً
   */
  static validateRange(
    start: number,
    end: number,
    duration: number,
    opts: { allowNearFull?: boolean } = {}
  ): string | null {
    if (!isFinite(start) || start < 0)
      return "نقطة البداية يجب أن تكون صفراً أو أكثر";
    if (!isFinite(end) || end > duration + 0.001)
      return "نقطة النهاية تتجاوز مدة الملف";
    if (end - start < 0.1)
      return "النطاق المحدد قصير جداً — الحد الأدنى 0.1 ثانية";
    if (!opts.allowNearFull && duration > 0) {
      // للحذف من المنتصف: لا يجوز حذف أكثر من 95% من الملف
      const ratio = (end - start) / duration;
      if (ratio > 0.95)
        return "النطاق المحدد يغطي معظم الملف — استخدم التقطيع العادي بدلاً من الحذف من المنتصف";
    }
    return null;
  }

  /**
   * تحويل نص mm:ss أو ثواني إلى رقم عشري
   * يقبل: "3:45"، "3:45.2"، "225"، "225.5"
   */
  static parseMmSs(input: string): number | null {
    const trimmed = input.trim();
    if (!trimmed) return null;

    // صيغة mm:ss أو mm:ss.t
    const colonMatch = trimmed.match(/^(\d+):([0-5]?\d)(\.\d+)?$/);
    if (colonMatch) {
      const minutes = parseInt(colonMatch[1], 10);
      const seconds = parseInt(colonMatch[2], 10);
      const frac = colonMatch[3] ? parseFloat(colonMatch[3]) : 0;
      return minutes * 60 + seconds + frac;
    }

    // رقم عشري فقط
    const num = parseFloat(trimmed);
    return isFinite(num) && num >= 0 ? num : null;
  }

  /**
   * تطبيق Fade-out على نهاية Float32Array (in-place)
   */
  private static applyFadeOut(data: Float32Array, fadeSamples: number): void {
    const start = Math.max(0, data.length - fadeSamples);
    for (let i = start; i < data.length; i++) {
      const gain = 1 - (i - start) / fadeSamples;
      data[i] *= gain;
    }
  }

  /**
   * تطبيق Fade-in على بداية Float32Array (in-place)
   */
  private static applyFadeIn(data: Float32Array, fadeSamples: number): void {
    const count = Math.min(fadeSamples, data.length);
    for (let i = 0; i < count; i++) {
      data[i] *= i / fadeSamples;
    }
  }

  /**
   * تقطيع AudioBuffer من startSec إلى endSec مع Fade
   * fadeDurationSec: مدة الـ fade بالثواني (default: 0.02 = 20ms)
   */
  static async trimWithFade(
    buffer: AudioBuffer,
    startSec: number,
    endSec: number,
    fadeDurationSec = 0.02
  ): Promise<AudioBuffer> {
    const sr = buffer.sampleRate;
    const numCh = buffer.numberOfChannels;
    const startSample = Math.max(0, Math.floor(startSec * sr));
    const endSample = Math.min(buffer.length, Math.ceil(endSec * sr));
    const outLen = endSample - startSample;

    if (outLen <= 0) throw new Error("نطاق التقطيع غير صالح");

    const fadeSamples = Math.floor(fadeDurationSec * sr);

    // نسخ وتعديل البيانات لكل قناة
    const channelData: Float32Array[] = [];
    for (let ch = 0; ch < numCh; ch++) {
      const src = buffer.getChannelData(ch);
      const slice = src.slice(startSample, endSample);
      AudioTrimmerEngine.applyFadeIn(slice, fadeSamples);
      AudioTrimmerEngine.applyFadeOut(slice, fadeSamples);
      channelData.push(slice);
    }

    // بناء buffer الناتج
    const tempCtx = new AudioContext();
    const outBuffer = tempCtx.createBuffer(numCh, outLen, sr);
    await tempCtx.close();
    for (let ch = 0; ch < numCh; ch++) {
      outBuffer.copyToChannel(channelData[ch], ch);
    }
    return outBuffer;
  }

  /**
   * حذف نطاق من منتصف الملف وربط الطرفين
   *
   * النتيجة: [0 → cutStart] + gap + [cutEnd → duration]
   * مع fade-out في نهاية الجزء الأول وfade-in في بداية الجزء الثاني
   *
   * @param buffer       الـ AudioBuffer الأصلي
   * @param cutStartSec  بداية الجزء المحذوف
   * @param cutEndSec    نهاية الجزء المحذوف
   * @param gapSec       مدة الفجوة الصامتة بين الجزأين (default: 0.5)
   * @param fadeDurationSec مدة الـ fade بالثواني (default: 0.02 = 20ms)
   */
  static async cutMiddle(
    buffer: AudioBuffer,
    cutStartSec: number,
    cutEndSec: number,
    gapSec = 0.5,
    fadeDurationSec = 0.02
  ): Promise<AudioBuffer> {
    const sr = buffer.sampleRate;
    const numCh = buffer.numberOfChannels;
    const totalSamples = buffer.length;

    const cutStartSample = Math.max(0, Math.floor(cutStartSec * sr));
    const cutEndSample = Math.min(totalSamples, Math.ceil(cutEndSec * sr));
    const gapSamples = Math.max(0, Math.floor(gapSec * sr));
    const fadeSamples = Math.floor(fadeDurationSec * sr);

    const lenA = cutStartSample;           // الجزء قبل الحذف
    const lenB = totalSamples - cutEndSample; // الجزء بعد الحذف
    const outLen = lenA + gapSamples + lenB;

    if (outLen <= 0) throw new Error("الناتج فارغ — تحقق من النطاق المحدد");

    // نسخ وتعديل البيانات لكل قناة
    const channelDataA: Float32Array[] = [];
    const channelDataB: Float32Array[] = [];

    for (let ch = 0; ch < numCh; ch++) {
      const src = buffer.getChannelData(ch);

      // chunk A: من البداية حتى cutStart مع fade-out
      const sliceA = src.slice(0, cutStartSample);
      if (sliceA.length > 0) {
        AudioTrimmerEngine.applyFadeOut(sliceA, fadeSamples);
      }
      channelDataA.push(sliceA);

      // chunk B: من cutEnd حتى النهاية مع fade-in
      const sliceB = src.slice(cutEndSample);
      if (sliceB.length > 0) {
        AudioTrimmerEngine.applyFadeIn(sliceB, fadeSamples);
      }
      channelDataB.push(sliceB);
    }

    // بناء buffer الناتج
    const tempCtx = new AudioContext();
    const outBuffer = tempCtx.createBuffer(numCh, Math.max(1, outLen), sr);
    await tempCtx.close();

    for (let ch = 0; ch < numCh; ch++) {
      const out = outBuffer.getChannelData(ch);
      // كتابة chunk A
      if (channelDataA[ch].length > 0) {
        out.set(channelDataA[ch], 0);
      }
      // gap: أصفار (الـ buffer مهيأ بأصفار تلقائياً)
      // كتابة chunk B بعد الـ gap
      if (channelDataB[ch].length > 0) {
        out.set(channelDataB[ch], lenA + gapSamples);
      }
    }

    return outBuffer;
  }

  /**
   * بناء اسم ملف الحذف من المنتصف
   */
  static buildCutFileName(originalName: string): string {
    const dot  = originalName.lastIndexOf(".");
    const base = dot !== -1 ? originalName.slice(0, dot) : originalName;
    // احذف أي لواحق -cut أو -trim أو -edited سابقة قبل إضافة الجديد
    const clean = base.replace(/(-cut|-trim|-edited)+$/i, "");
    return `${clean}-edited.wav`;
  }

  /**
   * حذف نطاق محدد من الصوت — يعمل في جميع الحالات:
   *   • حذف من البداية: [deleteEnd → duration]
   *   • حذف من المنتصف: [0 → deleteStart] + gap + [deleteEnd → duration]
   *   • حذف من النهاية: [0 → deleteStart]
   *
   * لا قيد على نسبة الحذف — يمكن حذف أي جزء مهما كان حجمه
   */
  static async deleteRange(
    buffer: AudioBuffer,
    deleteStartSec: number,
    deleteEndSec: number,
    gapSec = 0.5,
    fadeDurationSec = 0.02
  ): Promise<AudioBuffer> {
    const sr        = buffer.sampleRate;
    const numCh     = buffer.numberOfChannels;
    const totalSamp = buffer.length;
    const fadeSamp  = Math.floor(fadeDurationSec * sr);
    const gapSamp   = Math.max(0, Math.floor(gapSec * sr));

    const delStart = Math.max(0, Math.floor(deleteStartSec * sr));
    const delEnd   = Math.min(totalSamp, Math.ceil(deleteEndSec * sr));

    // الجزء قبل الحذف (يكون فارغاً إذا deleteStart = 0)
    const hasA = delStart > 0;
    // الجزء بعد الحذف (يكون فارغاً إذا deleteEnd = نهاية الملف)
    const hasB = delEnd < totalSamp;
    // الفجوة فقط إذا الجزأان موجودان
    const actualGap = hasA && hasB ? gapSamp : 0;

    const lenA   = hasA ? delStart : 0;
    const lenB   = hasB ? totalSamp - delEnd : 0;
    const outLen = lenA + actualGap + lenB;

    if (outLen <= 0) {
      throw new Error("النطاق المحذوف يغطي الملف بالكامل — لا يوجد شيء متبقٍ");
    }

    // بناء channel data
    const tempCtx = new AudioContext();
    const outBuffer = tempCtx.createBuffer(numCh, Math.max(1, outLen), sr);
    await tempCtx.close();

    for (let ch = 0; ch < numCh; ch++) {
      const src = buffer.getChannelData(ch);
      const out = outBuffer.getChannelData(ch);

      if (hasA) {
        const sliceA = src.slice(0, delStart);
        AudioTrimmerEngine.applyFadeOut(sliceA, fadeSamp);
        out.set(sliceA, 0);
      }

      if (hasB) {
        const sliceB = src.slice(delEnd);
        AudioTrimmerEngine.applyFadeIn(sliceB, fadeSamp);
        out.set(sliceB, lenA + actualGap);
      }
    }

    return outBuffer;
  }

  /**
   * دمج قائمة من AudioBuffer في buffer واحد بترتيبها
   * مع fade بين كل buffer والتالي لتجنب الـ click
   *
   * @param buffers         قائمة الـ AudioBuffer مرتبة حسب الترتيب المطلوب
   * @param gapSec          الفجوة بين كل ملفين (default: 0.5)
   * @param fadeDurationSec مدة الـ fade (default: 0.02 = 20ms)
   */
  static async mergeBuffersWithFade(
    buffers: AudioBuffer[],
    gapSec = 0.5,
    fadeDurationSec = 0.02
  ): Promise<AudioBuffer> {
    if (buffers.length === 0) throw new Error("لا توجد ملفات للدمج");
    if (buffers.length === 1) return buffers[0];

    // كل الملفات تُحوَّل لنفس sampleRate وعدد القنوات (الأول كمرجع)
    const sr    = buffers[0].sampleRate;
    const numCh = buffers[0].numberOfChannels;
    const fadeSamp = Math.floor(fadeDurationSec * sr);
    const gapSamp  = Math.max(0, Math.floor(gapSec * sr));

    // حساب الطول الكلي
    const totalLen = buffers.reduce(
      (acc, b, i) => acc + b.length + (i < buffers.length - 1 ? gapSamp : 0),
      0
    );

    const tempCtx = new AudioContext();
    const outBuffer = tempCtx.createBuffer(numCh, Math.max(1, totalLen), sr);
    await tempCtx.close();

    for (let ch = 0; ch < numCh; ch++) {
      const out = outBuffer.getChannelData(ch);
      let writePos = 0;

      buffers.forEach((buf, i) => {
        const chCount = Math.min(ch, buf.numberOfChannels - 1);
        const src = new Float32Array(buf.getChannelData(chCount));

        // fade-in على كل buffer ما عدا الأول
        if (i > 0) AudioTrimmerEngine.applyFadeIn(src, fadeSamp);
        // fade-out على كل buffer ما عدا الأخير
        if (i < buffers.length - 1) AudioTrimmerEngine.applyFadeOut(src, fadeSamp);

        out.set(src, writePos);
        writePos += src.length;

        // gap بعد كل buffer ما عدا الأخير
        if (i < buffers.length - 1) writePos += gapSamp;
      });
    }

    return outBuffer;
  }

  /**
   * تحميل عدة ملفات من URLs ودمجها في buffer واحد
   */
  static async mergeAudioFiles(
    urls: string[],
    gapSec = 0.5,
    fadeDurationSec = 0.02,
    onProgress?: (percent: number) => void
  ): Promise<AudioBuffer> {
    if (urls.length === 0) throw new Error("لا توجد ملفات للدمج");

    const buffers: AudioBuffer[] = [];
    for (let i = 0; i < urls.length; i++) {
      onProgress?.(Math.round((i / urls.length) * 70));
      const buf = await AudioTrimmerEngine.loadBuffer(urls[i]);
      buffers.push(buf);
    }

    onProgress?.(80);
    const merged = await AudioTrimmerEngine.mergeBuffersWithFade(
      buffers, gapSec, fadeDurationSec
    );
    onProgress?.(100);
    return merged;
  }

  /**
   * deleteMultipleRanges
   * حذف نطاقات متعددة دفعةً واحدة والاحتفاظ بالأجزاء المتبقية
   *
   * الخوارزمية:
   *   1. تحقق من صحة كل نطاق وحدّد حدوده
   *   2. رتّب النطاقات تصاعدياً حسب نقطة البداية
   *   3. ادمج النطاقات المتداخلة أو المتلاصقة
   *   4. استخرج "الأجزاء المحتفظ بها" = الفجوات بين النطاقات
   *   5. طبّق fade-out على نهاية كل جزء وfade-in على بداية الجزء التالي
   *   6. ادمج الأجزاء مع فجوة اختيارية بينها
   *
   * @param buffer         الـ AudioBuffer الأصلي
   * @param ranges         قائمة النطاقات المراد حذفها { start, end } بالثواني
   * @param gapSec         الفجوة الصامتة بين الأجزاء المحتفظ بها (default: 0.5)
   * @param fadeDurationSec مدة الـ fade عند نقاط الربط (default: 0.02 = 20ms)
   */
  static async deleteMultipleRanges(
    buffer: AudioBuffer,
    ranges: Array<{ start: number; end: number }>,
    gapSec = 0.5,
    fadeDurationSec = 0.02
  ): Promise<AudioBuffer> {
    const sr       = buffer.sampleRate;
    const numCh    = buffer.numberOfChannels;
    const totalSec = buffer.duration;
    const fadeSamp = Math.floor(fadeDurationSec * sr);
    const gapSamp  = Math.max(0, Math.floor(gapSec * sr));

    // ── 1. تصفية وتنظيف النطاقات ────────────────────────────────────────
    const valid = ranges
      .map(r => ({
        start: Math.max(0, r.start),
        end:   Math.min(totalSec, r.end),
      }))
      .filter(r => r.end - r.start >= 0.05); // نتجاهل النطاقات القصيرة جداً

    if (valid.length === 0) {
      // لا نطاقات صالحة — أعد الـ buffer كما هو
      return buffer;
    }

    // ── 2. الترتيب حسب البداية ──────────────────────────────────────────
    valid.sort((a, b) => a.start - b.start);

    // ── 3. دمج النطاقات المتداخلة ────────────────────────────────────────
    const merged: Array<{ start: number; end: number }> = [{ ...valid[0] }];
    for (let i = 1; i < valid.length; i++) {
      const last = merged[merged.length - 1];
      if (valid[i].start <= last.end + 0.01) {
        // تداخل أو تلاصق — وسّع النطاق الأخير
        last.end = Math.max(last.end, valid[i].end);
      } else {
        merged.push({ ...valid[i] });
      }
    }

    // ── 4. استخراج الأجزاء المحتفظ بها (الفجوات بين النطاقات) ─────────
    // مثال: النطاقات [1→3, 5→7]  الأجزاء = [0→1, 3→5, 7→end]
    const keepRanges: Array<{ startSec: number; endSec: number }> = [];

    // الجزء قبل أول نطاق
    if (merged[0].start > 0.001) {
      keepRanges.push({ startSec: 0, endSec: merged[0].start });
    }

    // الأجزاء بين النطاقات
    for (let i = 0; i < merged.length - 1; i++) {
      const gapStart = merged[i].end;
      const gapEnd   = merged[i + 1].start;
      if (gapEnd - gapStart > 0.001) {
        keepRanges.push({ startSec: gapStart, endSec: gapEnd });
      }
    }

    // الجزء بعد آخر نطاق
    const lastEnd = merged[merged.length - 1].end;
    if (totalSec - lastEnd > 0.001) {
      keepRanges.push({ startSec: lastEnd, endSec: totalSec });
    }

    if (keepRanges.length === 0) {
      throw new Error("النطاقات المحددة تغطي الملف بالكامل — لا يوجد صوت متبقٍ");
    }

    // ── 5. تحويل الأجزاء إلى slices مع Fade ────────────────────────────
    const channelSlices: Float32Array[][] = Array.from({ length: numCh }, () => []);

    for (let ki = 0; ki < keepRanges.length; ki++) {
      const { startSec, endSec } = keepRanges[ki];
      const startSamp = Math.max(0, Math.floor(startSec * sr));
      const endSamp   = Math.min(buffer.length, Math.ceil(endSec * sr));

      if (endSamp <= startSamp) continue;

      for (let ch = 0; ch < numCh; ch++) {
        const src   = buffer.getChannelData(ch);
        const slice = new Float32Array(src.buffer, startSamp * 4, endSamp - startSamp).slice();

        // fade-in على بداية كل جزء (ما عدا الأول إذا بدأ من الزمن 0)
        if (ki > 0 || startSec > 0.001) {
          AudioTrimmerEngine.applyFadeIn(slice, fadeSamp);
        }

        // fade-out على نهاية كل جزء (ما عدا الأخير إذا انتهى عند نهاية الملف)
        if (ki < keepRanges.length - 1 || endSec < totalSec - 0.001) {
          AudioTrimmerEngine.applyFadeOut(slice, fadeSamp);
        }

        channelSlices[ch].push(slice);
      }
    }

    // ── 6. حساب الطول الكلي للناتج ──────────────────────────────────────
    const numSegments = channelSlices[0].length;
    const totalOutSamp = channelSlices[0].reduce((acc, s) => acc + s.length, 0)
      + Math.max(0, numSegments - 1) * gapSamp;

    if (totalOutSamp <= 0) {
      throw new Error("خطأ داخلي: الناتج فارغ بعد المعالجة");
    }

    // ── 7. بناء الـ AudioBuffer الناتج ──────────────────────────────────
    const tempCtx   = new AudioContext();
    const outBuffer = tempCtx.createBuffer(numCh, totalOutSamp, sr);
    await tempCtx.close();

    for (let ch = 0; ch < numCh; ch++) {
      const out    = outBuffer.getChannelData(ch);
      let writePos = 0;

      for (let si = 0; si < channelSlices[ch].length; si++) {
        const slice = channelSlices[ch][si];
        out.set(slice, writePos);
        writePos += slice.length;

        // فجوة صامتة بين الأجزاء (buffer مهيأ بأصفار تلقائياً)
        if (si < channelSlices[ch].length - 1) {
          writePos += gapSamp;
        }
      }
    }

    return outBuffer;
  }

  /**
   * بناء اسم ملف الدمج
   */
  static buildMergedFileName(): string {
    return `merged-${Date.now()}.wav`;
  }
}
