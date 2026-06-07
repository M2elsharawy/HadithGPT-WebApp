/**
 * SilenceProcessor
 * كشف وإزالة الصمت الطويل في تسجيلات القرآن الكريم
 *
 * الخوارزمية:
 *   1. حساب RMS لكل نافذة صغيرة
 *   2. تجميع النوافذ في مقاطع صوت/صمت
 *   3. تطبيق Hold لتجنب قطع نهايات الكلمات
 *   4. استبدال الصمت الطويل (≥ minSilenceDuration) بفجوة قصيرة (replacementGap)
 *   5. تصدير WAV
 */

export interface SilenceProcessorOptions {
  /** عتبة الصمت بالـ dB — ما دونها يُعتبر صمتاً (default: -40) */
  thresholdDb: number;
  /** الحد الأدنى لمدة الصمت المحذوف بالثواني (default: 30) */
  minSilenceDuration: number;
  /** مدة الفجوة البديلة بالثواني (default: 2.5) */
  replacementGap: number;
  /** حجم النافذة بعدد الـ samples (default: 4096) */
  windowSize: number;
  /** Hold بعد كل مقطع صوت بالثواني — يمنع قطع نهايات الكلمات (default: 0.25) */
  holdDuration: number;
  /**
   * وضع الكشف:
   *   "rms" (default) — سلوك v1 كما هو، لا تغيير
   *   "vad"           — Multi-Feature VAD (ZCR + Adaptive Noise Floor + Spectral)
   */
  detectionMode?: "rms" | "vad";
  /** headroom فوق noise floor المكتشف تلقائياً بالـ dB (default: 12) — يُستخدم في "vad" فقط */
  adaptiveHeadroomDb?: number;
}

/**
 * بيانات تشخيصية لكل إطار زمني — مُنتَجة فقط عند detectionMode = "vad"
 */
export interface VADFrameData {
  /** الوقت بالثواني في منتصف الإطار */
  timeSec: number;
  /** مستوى الصوت بالـ dB */
  db: number;
  /** Zero Crossing Rate (0–1) */
  zcr: number;
  /** Short-Time Energy */
  energy: number;
  /** هل يبدو صوتاً بشرياً؟ */
  isSpeechLike: boolean;
  /** هل يُعتبر صمتاً؟ */
  isSilent: boolean;
}

export const DEFAULT_SILENCE_OPTIONS: SilenceProcessorOptions = {
  thresholdDb: -20,          // -20 dB — أفضل قيمة مُختبَرة للصلاة
  minSilenceDuration: 5,     // 5 ثوانٍ — الحد الأدنى المُختبَر
  replacementGap: 5,         // 5 ثوانٍ — الفجوة البديلة المُختبَرة
  windowSize: 2048,
  holdDuration: 0.25,
};

export interface SilenceSegment {
  startSec: number;
  endSec: number;
  durationSec: number;
}

export interface SilenceProcessorReport {
  /** عدد فترات الصمت الطويل التي تم اكتشافها وإزالتها */
  removedCount: number;
  /** إجمالي الوقت المحذوف بالثواني */
  totalRemovedSec: number;
  /** المدة الأصلية بالثواني */
  originalDurationSec: number;
  /** المدة الناتجة بالثواني */
  finalDurationSec: number;
  /** قائمة فترات الصمت التي تم إزالتها */
  removedSegments: SilenceSegment[];
  /** بيانات VAD التشخيصية — موجودة فقط عند detectionMode = "vad" */
  vadFrames?: VADFrameData[];
  /** noise floor المكتشف تلقائياً بالـ dB — موجود فقط عند detectionMode = "vad" */
  detectedNoiseFloorDb?: number;
  /** العتبة الفعلية المُطبَّقة بالـ dB */
  effectiveThresholdDb?: number;
}

export interface SilenceProcessorResult {
  blob: Blob;
  report: SilenceProcessorReport;
}

export interface SilenceProcessorProgress {
  stage: string;
  percent: number;
}

// ─── Internal segment type ────────────────────────────────────────────────────
interface Segment {
  type: "audio" | "silence";
  startSample: number;
  endSample: number;
}

// ─── VAD helpers (يُستخدم فقط عند detectionMode = "vad") ─────────────────────

/** Zero Crossing Rate — عدد مرات عبور الإشارة للصفر / طول الإطار */
function _zcr(data: Float32Array, start: number, end: number): number {
  let c = 0;
  for (let i = start + 1; i < end; i++) {
    if ((data[i] >= 0) !== (data[i - 1] >= 0)) c++;
  }
  return c / Math.max(1, end - start - 1);
}

/** Short-Time Energy (مجموع المربعات / عدد العينات) */
function _ste(data: Float32Array, start: number, end: number): number {
  let s = 0;
  for (let i = start; i < end; i++) s += data[i] * data[i];
  return s / (end - start);
}

/**
 * Adaptive Noise Floor
 * percentile 15 من قيم STE — يُمثّل المناطق الأهدأ في الملف
 * يُعيد القيمة بالـ dB (STE → dB: 10 × log10)
 */
function _noiseFloorDb(steArr: Float32Array): number {
  const valid: number[] = [];
  for (let i = 0; i < steArr.length; i++) {
    if (steArr[i] > 1e-12) valid.push(steArr[i]);
  }
  if (valid.length === 0) return -80;
  valid.sort((a, b) => a - b);
  const nf = valid[Math.floor(valid.length * 0.15)];
  return 10 * Math.log10(nf);
}

/** Median smoothing على Uint8Array — يُزيل القرارات المتذبذبة */
function _medianSmooth(arr: Uint8Array, halfWin: number): Uint8Array {
  if (halfWin <= 0) return arr;
  const out = new Uint8Array(arr.length);
  for (let i = 0; i < arr.length; i++) {
    const lo = Math.max(0, i - halfWin);
    const hi = Math.min(arr.length - 1, i + halfWin);
    let ones = 0;
    for (let j = lo; j <= hi; j++) ones += arr[j];
    out[i] = ones > (hi - lo + 1) / 2 ? 1 : 0;
  }
  return out;
}

/**
 * Pitch Score عبر Normalized Autocorrelation
 * التلاوة: pitch score مرتفع (0.3+)
 * الركوع/الصمت/التنفس: pitch score منخفض (< 0.15)
 */
function _pitchScore(data: Float32Array, start: number, end: number, sampleRate: number): number {
  const N = end - start;
  if (N < 64) return 0;
  const minLag = Math.floor(sampleRate / 400); // 400 Hz max pitch
  const maxLag = Math.min(Math.floor(sampleRate / 80), Math.floor(N / 2)); // 80 Hz min pitch
  if (minLag >= maxLag) return 0;

  let power = 0;
  for (let i = start; i < end; i++) power += data[i] * data[i];
  if (power < 1e-12) return 0;

  let bestR = 0;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let r = 0;
    const lim = Math.min(N - lag, 256); // حد 256 sample للسرعة
    for (let i = 0; i < lim; i++) {
      r += data[start + i] * data[start + i + lag];
    }
    const norm = (power / N) * lim;
    const rNorm = norm > 0 ? r / norm : 0;
    if (rNorm > bestR) bestR = rNorm;
  }
  return Math.max(0, Math.min(1, bestR));
}

/**
 * High Frequency Ratio — نسبة الطاقة فوق 2000 Hz
 * التلاوة: نسبة منخفضة (< 0.35) — معظم الطاقة في الترددات الأساسية
 * الركوع/التنفس: نسبة مرتفعة (> 0.5) — broadband noise
 */
function _highFreqRatio(data: Float32Array, start: number, end: number, sampleRate: number): number {
  const N = end - start;
  if (N < 32) return 0.5;
  const freqStep = sampleRate / N;
  const cutBin   = Math.floor(2000 / freqStep);
  const maxBin   = Math.min(Math.floor(N / 2), 80);
  if (maxBin <= cutBin) return 0;

  let totalE = 0, highE = 0;
  const stride = Math.max(1, Math.floor(maxBin / 32));

  for (let k = 1; k < maxBin; k += stride) {
    let re = 0, im = 0;
    const omega = (2 * Math.PI * k) / N;
    const lim   = Math.min(N, 128);
    for (let n = 0; n < lim; n++) {
      re += data[start + n] * Math.cos(omega * n);
      im -= data[start + n] * Math.sin(omega * n);
    }
    const p = re * re + im * im;
    totalE += p;
    if (k > cutBin) highE += p;
  }
  return totalE > 0 ? highE / totalE : 0.5;
}

export class SilenceProcessor {
  /**
   * تحميل AudioBuffer من URL
   */
  static async loadBuffer(url: string): Promise<AudioBuffer> {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`فشل تحميل الملف: HTTP ${response.status}`);
    const arrayBuffer = await response.arrayBuffer();
    const ctx = new AudioContext();
    try { return await ctx.decodeAudioData(arrayBuffer); } finally { await ctx.close(); }
  }

  /**
   * كشف الصمت فقط بدون decode كامل للذاكرة
   * يستخدم HTMLAudioElement + ScriptProcessorNode لقراءة البيانات تدريجياً
   * مناسب للملفات الطويلة (> 60 دقيقة) — لا يحتاج تحميل الملف كاملاً
   */
  static async detectSilenceStreaming(
    objectUrl: string,
    options: Partial<SilenceProcessorOptions> = {},
    onProgress?: (p: SilenceProcessorProgress) => void
  ): Promise<{ segments: Array<{ startSec: number; endSec: number; durationSec: number }> }> {
    const opts: SilenceProcessorOptions = { ...DEFAULT_SILENCE_OPTIONS, ...options };
    const thresholdLinear = Math.pow(10, opts.thresholdDb / 20);

    return new Promise((resolve, reject) => {
      const audio = new Audio();
      audio.src = objectUrl;
      audio.preload = "auto";
      audio.crossOrigin = "anonymous";

      const ctx = new AudioContext();
      const source = ctx.createMediaElementSource(audio);

      // ScriptProcessor يقرأ samples فعلية
      const bufSize = 4096;
      const processor = ctx.createScriptProcessor(bufSize, 1, 1);
      const gainNode = ctx.createGain();
      gainNode.gain.value = 0; // بدون إخراج صوتي

      source.connect(processor);
      processor.connect(gainNode);
      gainNode.connect(ctx.destination);

      const silenceSegs: Array<{ startSec: number; endSec: number; durationSec: number }> = [];
      let silenceStart: number | null = null;
      let currentTime = 0;
      let duration = 0;

      audio.addEventListener("loadedmetadata", () => {
        duration = audio.duration;
      }, { once: true });

      processor.onaudioprocess = (e) => {
        const data = e.inputBuffer.getChannelData(0);
        currentTime = audio.currentTime;

        // حساب RMS لهذا الـ chunk
        let sum = 0;
        for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
        const rms = Math.sqrt(sum / data.length);

        const isSilent = rms < thresholdLinear;
        const chunkDur = data.length / ctx.sampleRate;

        if (isSilent && silenceStart === null) {
          silenceStart = currentTime;
        } else if (!isSilent && silenceStart !== null) {
          const silDur = currentTime - silenceStart;
          if (silDur >= opts.minSilenceDuration) {
            silenceSegs.push({
              startSec:    silenceStart,
              endSec:      currentTime,
              durationSec: silDur,
            });
          }
          silenceStart = null;
        }

        // progress
        if (duration > 0) {
          const pct = Math.min(95, Math.round((currentTime / duration) * 100));
          onProgress?.({ stage: "جاري تحليل الصمت...", percent: pct });
        }
      };

      audio.addEventListener("ended", async () => {
        // أغلق الـ silence الأخير إن وجد
        if (silenceStart !== null) {
          const silDur = audio.duration - silenceStart;
          if (silDur >= opts.minSilenceDuration) {
            silenceSegs.push({
              startSec:    silenceStart,
              endSec:      audio.duration,
              durationSec: silDur,
            });
          }
        }
        processor.disconnect();
        source.disconnect();
        await ctx.close().catch(() => {});
        onProgress?.({ stage: "اكتمل التحليل", percent: 100 });
        resolve({ segments: silenceSegs });
      });

      audio.addEventListener("error", async () => {
        await ctx.close().catch(() => {});
        reject(new Error("فشل تحميل الملف للتحليل"));
      });

      // شغّل بأسرع وقت
      audio.playbackRate = 16; // 16× = ملف ساعة يُحلَّل في 4 دقائق
      audio.volume = 0;
      audio.play().catch(reject);
    });
  }

  /**
   * الدالة الرئيسية — تكشف الصمت وتُعالجه وتُصدّر WAV
   */
  static async process(
    audioUrl: string,
    options: Partial<SilenceProcessorOptions> = {},
    onProgress?: (p: SilenceProcessorProgress) => void
  ): Promise<SilenceProcessorResult> {
    const opts: SilenceProcessorOptions = { ...DEFAULT_SILENCE_OPTIONS, ...options };

    // ── 1. تحميل وفك التشفير ─────────────────────────────────────────────────
    onProgress?.({ stage: "جاري تحميل الملف...", percent: 5 });
    const inputBuffer = await SilenceProcessor.loadBuffer(audioUrl);
    const { sampleRate, numberOfChannels, length } = inputBuffer;
    const originalDurationSec = inputBuffer.duration;

    // ── 2. تحويل threshold من dB إلى linear ──────────────────────────────────
    // -40 dB → 0.01 linear
    const thresholdLinear = Math.pow(10, opts.thresholdDb / 20);

    // ── 3. حساب RMS لكل نافذة على القناة الأولى ──────────────────────────────
    onProgress?.({ stage: "جاري تحليل مستويات الصوت...", percent: 20 });

    const ch0 = inputBuffer.getChannelData(0);
    const numWindows = Math.ceil(length / opts.windowSize);
    const rmsValues = new Float32Array(numWindows);

    // ── حساب RMS مع yield للـ main thread كل 2000 نافذة ──────────────────────
    for (let w = 0; w < numWindows; w++) {
      const start = w * opts.windowSize;
      const end = Math.min(start + opts.windowSize, length);
      let sum = 0;
      for (let i = start; i < end; i++) {
        sum += ch0[i] * ch0[i];
      }
      rmsValues[w] = Math.sqrt(sum / (end - start));
      // yield للـ main thread كل 2000 نافذة — يمنع "Page Unresponsive"
      if (w > 0 && w % 2000 === 0) {
        const pct = 20 + Math.round((w / numWindows) * 15);
        onProgress?.({ stage: "جاري تحليل الصوت...", percent: pct });
        await new Promise(r => setTimeout(r, 0));
      }
    }

    // ── 4. تحديد النوافذ الصامتة ─────────────────────────────────────────────
    onProgress?.({ stage: "جاري كشف فترات الصمت...", percent: 35 });

    const holdWindows = Math.ceil((opts.holdDuration * sampleRate) / opts.windowSize);
    const isSilent = new Uint8Array(numWindows);

    // متغيرات للـ report — تُملأ فقط في VAD mode
    let vadFrames: VADFrameData[] | undefined;
    let detectedNoiseFloorDb: number | undefined;
    let effectiveThresholdDb: number = opts.thresholdDb;

    if (opts.detectionMode === "vad") {
      // ── VAD Mode — Multi-Feature: STE + ZCR + Adaptive Noise Floor ──────────

      // 4a. حساب STE لجميع النوافذ (نستخدم rmsValues² كـ STE)
      const steValues = new Float32Array(numWindows);
      for (let w = 0; w < numWindows; w++) steValues[w] = rmsValues[w] * rmsValues[w];

      // 4b. حساب ZCR + Pitch + HighFreqRatio لجميع النوافذ
      const zcrValues   = new Float32Array(numWindows);
      const pitchValues = new Float32Array(numWindows);
      const hfrValues   = new Float32Array(numWindows);

      for (let w = 0; w < numWindows; w++) {
        const start = w * opts.windowSize;
        const end   = Math.min(start + opts.windowSize, length);
        zcrValues[w]   = _zcr(ch0, start, end);
        pitchValues[w] = _pitchScore(ch0, start, end, sampleRate);
        hfrValues[w]   = _highFreqRatio(ch0, start, end, sampleRate);
      }

      // 4c. Adaptive Noise Floor
      detectedNoiseFloorDb = _noiseFloorDb(steValues);
      effectiveThresholdDb  = Math.min(
        opts.thresholdDb,
        detectedNoiseFloorDb + (opts.adaptiveHeadroomDb ?? 12)
      );
      effectiveThresholdDb  = Math.max(effectiveThresholdDb, -70);

      // threshold للـ STE: STE = 10^(dB/10)
      const thresholdSTE = Math.pow(10, effectiveThresholdDb / 10);

      // 4d. قرار لكل نافذة: صامتة أم لا؟
      vadFrames = [];
      const isSilentRaw = new Uint8Array(numWindows);
      for (let w = 0; w < numWindows; w++) {
        const ste  = steValues[w];
        const zcr  = zcrValues[w];
        const db   = ste > 1e-12 ? 10 * Math.log10(ste) : -80;

        // ── القرار المُركَّب: STE + ZCR + Pitch + HighFreqRatio ────────────────
        // 1. القرار الأساسي من STE
        let isSil = ste < thresholdSTE;

        if (isSil) {
          // 2. Pitch rescue: pitch score مرتفع → تلاوة خافتة لا صمت
          //    التلاوة حتى الخافتة جداً لها pitch واضح (0.25+)
          if (pitchValues[w] > 0.25 && ste > thresholdSTE * 0.05) {
            isSil = false;
          }

          // 3. ZCR rescue: ZCR منخفض جداً + طاقة → صوت مجهور
          const speechLikeZCR = zcrValues[w] < 0.07 && ste > thresholdSTE * 0.08;
          if (speechLikeZCR) isSil = false;
        }

        // 4. High-freq check: ZCR مرتفع + HFR مرتفع → تنفس/ركوع/ضجيج → إبقاء كصمت
        //    حتى لو كانت الطاقة فوق العتبة
        if (!isSil && zcrValues[w] > 0.18 && hfrValues[w] > 0.55 && ste < thresholdSTE * 3) {
          // broadband noise بطاقة خفيفة → صمت (ركوع/تنفس)
          isSil = true;
        }

        isSilentRaw[w] = isSil ? 1 : 0;

        vadFrames.push({
          timeSec:      (w + 0.5) * opts.windowSize / sampleRate,
          db,
          zcr:          zcrValues[w],
          energy:       ste,
          isSpeechLike: !isSil,
          isSilent:     isSil,
        });
      }

      // 4e. Median smoothing (نافذة 5 = halfWin 2) — يُزيل القطع القصيرة المزيفة
      const smoothed = _medianSmooth(isSilentRaw, 2);
      smoothed.forEach((v, i) => { isSilent[i] = v; });

    } else {
      // ── RMS Mode (v1 — سلوك محفوظ بالكامل) ──────────────────────────────────
      effectiveThresholdDb = opts.thresholdDb;
      for (let w = 0; w < numWindows; w++) {
        isSilent[w] = rmsValues[w] < thresholdLinear ? 1 : 0;
      }
    }

    // Pass 2: apply Hold — مشترك بين الوضعين
    let holdRemaining = 0;
    for (let w = 0; w < numWindows; w++) {
      if (isSilent[w] === 0) {
        holdRemaining = holdWindows;
      } else if (holdRemaining > 0) {
        isSilent[w] = 0;
        holdRemaining--;
      }
    }

    // ── 5. تجميع النوافذ في مقاطع متجاورة ───────────────────────────────────
    const segments: Segment[] = [];
    if (numWindows > 0) {
      let currentType: "audio" | "silence" = isSilent[0] === 0 ? "audio" : "silence";
      let segStart = 0;

      for (let w = 1; w <= numWindows; w++) {
        const winType: "audio" | "silence" =
          w < numWindows ? (isSilent[w] === 0 ? "audio" : "silence") : currentType;

        if (winType !== currentType || w === numWindows) {
          segments.push({
            type: currentType,
            startSample: segStart * opts.windowSize,
            endSample: Math.min(w * opts.windowSize, length),
          });
          currentType = winType;
          segStart = w;
        }
      }
    }

    // ── 6. تحديد الصمت الطويل المطلوب إزالته ────────────────────────────────
    onProgress?.({ stage: "جاري معالجة الصمت...", percent: 50 });

    const minSilenceSamples = Math.floor(opts.minSilenceDuration * sampleRate);
    const replacementSamples = Math.floor(opts.replacementGap * sampleRate);

    const removedSegments: SilenceSegment[] = [];
    let totalRemovedSec = 0;

    // بناء قائمة مقاطع الـ output
    interface OutputChunk {
      type: "copy" | "silence";
      startSample?: number; // for copy
      endSample?: number;   // for copy
      durationSamples?: number; // for silence
    }
    const outputChunks: OutputChunk[] = [];

    for (const seg of segments) {
      const segLength = seg.endSample - seg.startSample;

      if (seg.type === "audio") {
        outputChunks.push({ type: "copy", startSample: seg.startSample, endSample: seg.endSample });
      } else {
        // صمت
        if (segLength >= minSilenceSamples) {
          // صمت طويل — استبدله بفجوة قصيرة
          const startSec = seg.startSample / sampleRate;
          const endSec = seg.endSample / sampleRate;
          const durationSec = endSec - startSec;

          removedSegments.push({ startSec, endSec, durationSec });
          totalRemovedSec += durationSec - opts.replacementGap;

          outputChunks.push({ type: "silence", durationSamples: replacementSamples });
        } else {
          // صمت قصير — احتفظ به كما هو
          outputChunks.push({ type: "copy", startSample: seg.startSample, endSample: seg.endSample });
        }
      }
    }

    // ── 7. حساب حجم الـ output ───────────────────────────────────────────────
    let totalOutputSamples = 0;
    for (const chunk of outputChunks) {
      if (chunk.type === "copy") {
        totalOutputSamples += (chunk.endSample! - chunk.startSample!);
      } else {
        totalOutputSamples += chunk.durationSamples!;
      }
    }

    const finalDurationSec = totalOutputSamples / sampleRate;

    // ── 8. بناء الـ AudioBuffer الناتج ───────────────────────────────────────
    onProgress?.({ stage: "جاري بناء الملف الناتج...", percent: 65 });

    const tempCtx = new AudioContext();
    const outputBuffer = tempCtx.createBuffer(
      numberOfChannels,
      Math.max(1, totalOutputSamples),
      sampleRate
    );

    // نسخ البيانات chunk by chunk لجميع القنوات
    const channelWritePos = new Array(numberOfChannels).fill(0);

    for (const chunk of outputChunks) {
      if (chunk.type === "copy") {
        const chunkLen = chunk.endSample! - chunk.startSample!;
        for (let ch = 0; ch < numberOfChannels; ch++) {
          const inputData = inputBuffer.getChannelData(ch);
          const outputData = outputBuffer.getChannelData(ch);
          outputData.set(
            inputData.subarray(chunk.startSample!, chunk.endSample!),
            channelWritePos[ch]
          );
          channelWritePos[ch] += chunkLen;
        }
      } else {
        // صمت بديل — كتابة أصفار
        const silenceLen = chunk.durationSamples!;
        for (let ch = 0; ch < numberOfChannels; ch++) {
          const outputData = outputBuffer.getChannelData(ch);
          outputData.fill(0, channelWritePos[ch], channelWritePos[ch] + silenceLen);
          channelWritePos[ch] += silenceLen;
        }
      }
    }

    // ── 9. تصدير WAV ─────────────────────────────────────────────────────────
    onProgress?.({ stage: "جاري تصدير الملف...", percent: 85 });

    const blob = SilenceProcessor.toWav(outputBuffer);

    onProgress?.({ stage: "اكتملت المعالجة ✓", percent: 100 });

    const report: SilenceProcessorReport = {
      removedCount: removedSegments.length,
      totalRemovedSec: Math.max(0, totalRemovedSec),
      originalDurationSec,
      finalDurationSec,
      removedSegments,
      vadFrames,
      detectedNoiseFloorDb,
      effectiveThresholdDb,
    };

    return { blob, report };
  }

  /**
   * تحويل AudioBuffer إلى WAV Blob — 16-bit PCM interleaved
   */
  static toWav(buffer: AudioBuffer): Blob {
    const numCh = buffer.numberOfChannels;
    const sr = buffer.sampleRate;
    const len = buffer.length;
    const bps = 2;
    const blockAlign = numCh * bps;
    const dataSize = len * blockAlign;
    const ab = new ArrayBuffer(44 + dataSize);
    const v = new DataView(ab);

    const s = (o: number, t: string) => {
      for (let i = 0; i < t.length; i++) v.setUint8(o + i, t.charCodeAt(i));
    };

    s(0, "RIFF"); v.setUint32(4, 36 + dataSize, true);
    s(8, "WAVE"); s(12, "fmt ");
    v.setUint32(16, 16, true); v.setUint16(20, 1, true);
    v.setUint16(22, numCh, true); v.setUint32(24, sr, true);
    v.setUint32(28, sr * blockAlign, true); v.setUint16(32, blockAlign, true);
    v.setUint16(34, 16, true); s(36, "data"); v.setUint32(40, dataSize, true);

    let offset = 44;
    for (let i = 0; i < len; i++) {
      for (let ch = 0; ch < numCh; ch++) {
        const x = Math.max(-1, Math.min(1, buffer.getChannelData(ch)[i]));
        v.setInt16(offset, x < 0 ? x * 32768 : x * 32767, true);
        offset += 2;
      }
    }
    return new Blob([ab], { type: "audio/wav" });
  }

  /**
   * تنسيق الثواني إلى mm:ss
   */
  static formatDuration(sec: number): string {
    if (!isFinite(sec) || sec < 0) return "0:00";
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  }

  /**
   * بناء اسم الملف الناتج
   */
  static buildFileName(originalName: string): string {
    const dot = originalName.lastIndexOf(".");
    const base = dot !== -1 ? originalName.slice(0, dot) : originalName;
    return `${base}-no-silence.wav`;
  }
}
