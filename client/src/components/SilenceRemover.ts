/**
 * SilenceRemover
 * يكتشف السكتات الطويلة في الصوت ويزيلها، ثم يصدّر الصوت الناتج كـ WAV
 *
 * الخوارزمية:
 * 1. تحويل الـ AudioBuffer إلى mono (متوسط القنوات)
 * 2. المسح بنوافذ صغيرة (window) لحساب RMS لكل نافذة
 * 3. تحديد النوافذ الصامتة (RMS < threshold)
 * 4. دمج النوافذ المتجاورة في "مقاطع صوت" و"مقاطع صمت"
 * 5. إزالة مقاطع الصمت التي تتجاوز الحد الأدنى
 * 6. ربط مقاطع الصوت مع padding قصير بينها
 * 7. تصدير WAV
 */

export interface SilenceSegment {
  start: number;   // ثانية
  end: number;     // ثانية
  duration: number; // ثانية
}

export interface AudioSegment {
  start: number;   // ثانية
  end: number;     // ثانية
  type: "audio" | "silence";
  duration: number;
}

export interface SilenceRemoverOptions {
  /** حد الصوت: نسبة RMS التي تعتبر تحتها صمتاً (0.001 – 0.05) — افتراضي 0.01 */
  threshold: number;
  /** الحد الأدنى لمدة الصمت الذي يُحذف (ثوانٍ) — افتراضي 30 */
  minSilenceDuration: number;
  /** مدة الـ padding الصوتي المحتفظ به قبل وبعد كل مقطع (ثوانٍ) — افتراضي 0.3 */
  paddingDuration: number;
  /** حجم النافذة لحساب RMS (عدد العينات) — افتراضي 2048 */
  windowSize: number;
}

export interface SilenceRemoverResult {
  /** الـ AudioBuffer الناتج بعد إزالة السكتات */
  outputBuffer: AudioBuffer;
  /** قائمة السكتات التي تم اكتشافها */
  detectedSilences: SilenceSegment[];
  /** قائمة السكتات التي تم إزالتها (تلك التي تتجاوز الحد) */
  removedSilences: SilenceSegment[];
  /** المدة الأصلية (ثوانٍ) */
  originalDuration: number;
  /** المدة الناتجة (ثوانٍ) */
  outputDuration: number;
  /** نسبة التوفير في الوقت */
  savedPercentage: number;
}

const DEFAULT_OPTIONS: SilenceRemoverOptions = {
  threshold: 0.01,
  minSilenceDuration: 30,
  paddingDuration: 0.3,
  windowSize: 2048,
};

export class SilenceRemover {
  private audioContext: AudioContext;

  constructor(audioContext: AudioContext) {
    this.audioContext = audioContext;
  }

  /**
   * الدالة الرئيسية: تحلل الـ AudioBuffer وتزيل السكتات الطويلة
   */
  async process(
    inputBuffer: AudioBuffer,
    options: Partial<SilenceRemoverOptions> = {}
  ): Promise<SilenceRemoverResult> {
    const opts: SilenceRemoverOptions = { ...DEFAULT_OPTIONS, ...options };

    // 1. تحويل إلى mono
    const monoData = this.toMono(inputBuffer);
    const sampleRate = inputBuffer.sampleRate;
    const totalSamples = monoData.length;

    // 2. حساب RMS لكل نافذة
    const rmsValues = this.computeRMS(monoData, opts.windowSize);

    // 3. تحديد النوافذ الصامتة
    const isSilent = rmsValues.map((rms) => rms < opts.threshold);

    // 4. تجميع المقاطع
    const segments = this.buildSegments(isSilent, opts.windowSize, sampleRate, totalSamples);

    // 5. تحديد السكتات المكتشفة والمحذوفة
    const detectedSilences: SilenceSegment[] = segments
      .filter((s) => s.type === "silence")
      .map((s) => ({ start: s.start, end: s.end, duration: s.duration }));

    const removedSilences: SilenceSegment[] = detectedSilences.filter(
      (s) => s.duration >= opts.minSilenceDuration
    );

    // 6. بناء الـ AudioBuffer الناتج
    const outputBuffer = this.buildOutputBuffer(
      inputBuffer,
      segments,
      opts,
      sampleRate
    );

    const originalDuration = inputBuffer.duration;
    const outputDuration = outputBuffer.duration;
    const savedPercentage =
      originalDuration > 0
        ? ((originalDuration - outputDuration) / originalDuration) * 100
        : 0;

    return {
      outputBuffer,
      detectedSilences,
      removedSilences,
      originalDuration,
      outputDuration,
      savedPercentage,
    };
  }

  /**
   * تحليل فقط بدون إزالة — لعرض المعاينة
   */
  analyze(
    inputBuffer: AudioBuffer,
    options: Partial<SilenceRemoverOptions> = {}
  ): { segments: AudioSegment[]; detectedSilences: SilenceSegment[]; removedSilences: SilenceSegment[] } {
    const opts: SilenceRemoverOptions = { ...DEFAULT_OPTIONS, ...options };
    const monoData = this.toMono(inputBuffer);
    const sampleRate = inputBuffer.sampleRate;
    const totalSamples = monoData.length;

    const rmsValues = this.computeRMS(monoData, opts.windowSize);
    const isSilent = rmsValues.map((rms) => rms < opts.threshold);
    const segments = this.buildSegments(isSilent, opts.windowSize, sampleRate, totalSamples);

    const detectedSilences: SilenceSegment[] = segments
      .filter((s) => s.type === "silence")
      .map((s) => ({ start: s.start, end: s.end, duration: s.duration }));

    const removedSilences = detectedSilences.filter(
      (s) => s.duration >= opts.minSilenceDuration
    );

    return { segments, detectedSilences, removedSilences };
  }

  /**
   * تحويل AudioBuffer متعدد القنوات إلى mono
   */
  private toMono(buffer: AudioBuffer): Float32Array {
    if (buffer.numberOfChannels === 1) {
      return buffer.getChannelData(0).slice();
    }

    const length = buffer.length;
    const mono = new Float32Array(length);
    const numChannels = buffer.numberOfChannels;

    for (let ch = 0; ch < numChannels; ch++) {
      const channelData = buffer.getChannelData(ch);
      for (let i = 0; i < length; i++) {
        mono[i] += channelData[i];
      }
    }

    for (let i = 0; i < length; i++) {
      mono[i] /= numChannels;
    }

    return mono;
  }

  /**
   * حساب RMS (Root Mean Square) لكل نافذة
   */
  private computeRMS(data: Float32Array, windowSize: number): number[] {
    const numWindows = Math.ceil(data.length / windowSize);
    const rms: number[] = new Array(numWindows);

    for (let w = 0; w < numWindows; w++) {
      const start = w * windowSize;
      const end = Math.min(start + windowSize, data.length);
      let sum = 0;

      for (let i = start; i < end; i++) {
        sum += data[i] * data[i];
      }

      rms[w] = Math.sqrt(sum / (end - start));
    }

    return rms;
  }

  /**
   * تحويل النوافذ الصامتة إلى مقاطع متجاورة
   */
  private buildSegments(
    isSilent: boolean[],
    windowSize: number,
    sampleRate: number,
    totalSamples: number
  ): AudioSegment[] {
    const segments: AudioSegment[] = [];
    if (isSilent.length === 0) return segments;

    let currentType: "audio" | "silence" = isSilent[0] ? "silence" : "audio";
    let startWindow = 0;

    for (let w = 1; w <= isSilent.length; w++) {
      const type: "audio" | "silence" =
        w < isSilent.length ? (isSilent[w] ? "silence" : "audio") : currentType === "audio" ? "silence" : "audio";

      if (type !== currentType || w === isSilent.length) {
        const startSample = startWindow * windowSize;
        const endSample = Math.min(w * windowSize, totalSamples);
        const startSec = startSample / sampleRate;
        const endSec = endSample / sampleRate;

        segments.push({
          start: startSec,
          end: endSec,
          type: currentType,
          duration: endSec - startSec,
        });

        currentType = type;
        startWindow = w;
      }
    }

    return segments;
  }

  /**
   * بناء الـ AudioBuffer الناتج بعد حذف السكتات الطويلة
   */
  private buildOutputBuffer(
    inputBuffer: AudioBuffer,
    segments: AudioSegment[],
    opts: SilenceRemoverOptions,
    sampleRate: number
  ): AudioBuffer {
    const numChannels = inputBuffer.numberOfChannels;
    const paddingSamples = Math.floor(opts.paddingDuration * sampleRate);

    // تحديد المقاطع المحتفظ بها
    const keptSegments: Array<{ startSample: number; endSample: number }> = [];

    for (const seg of segments) {
      if (seg.type === "audio") {
        // مقطع صوت: نحتفظ به كاملاً
        keptSegments.push({
          startSample: Math.max(0, Math.floor(seg.start * sampleRate) - paddingSamples),
          endSample: Math.min(inputBuffer.length, Math.ceil(seg.end * sampleRate) + paddingSamples),
        });
      } else if (seg.duration < opts.minSilenceDuration) {
        // صمت قصير: نحتفظ به كما هو
        keptSegments.push({
          startSample: Math.floor(seg.start * sampleRate),
          endSample: Math.min(inputBuffer.length, Math.ceil(seg.end * sampleRate)),
        });
      }
      // صمت طويل: يُحذف
    }

    // دمج المقاطع المتداخلة
    const merged = this.mergeRanges(keptSegments, inputBuffer.length);

    // حساب إجمالي العينات الناتجة
    const totalOutputSamples = merged.reduce(
      (acc, r) => acc + (r.endSample - r.startSample),
      0
    );

    // إنشاء الـ AudioBuffer الناتج
    if (totalOutputSamples <= 0) {
      // لا يوجد صوت — أعد buffer فارغاً لمدة ثانية واحدة
      return this.audioContext.createBuffer(numChannels, sampleRate, sampleRate);
    }

    const outputBuffer = this.audioContext.createBuffer(
      numChannels,
      totalOutputSamples,
      sampleRate
    );

    // نسخ البيانات
    for (let ch = 0; ch < numChannels; ch++) {
      const inputData = inputBuffer.getChannelData(ch);
      const outputData = outputBuffer.getChannelData(ch);
      let writePos = 0;

      for (const range of merged) {
        const chunkLength = range.endSample - range.startSample;
        outputData.set(
          inputData.subarray(range.startSample, range.endSample),
          writePos
        );
        writePos += chunkLength;
      }
    }

    return outputBuffer;
  }

  /**
   * دمج النطاقات المتداخلة أو المتجاورة
   */
  private mergeRanges(
    ranges: Array<{ startSample: number; endSample: number }>,
    maxSample: number
  ): Array<{ startSample: number; endSample: number }> {
    if (ranges.length === 0) return [];

    const sorted = [...ranges].sort((a, b) => a.startSample - b.startSample);
    const merged: Array<{ startSample: number; endSample: number }> = [sorted[0]];

    for (let i = 1; i < sorted.length; i++) {
      const last = merged[merged.length - 1];
      const current = sorted[i];

      if (current.startSample <= last.endSample + 1) {
        last.endSample = Math.max(last.endSample, current.endSample);
      } else {
        merged.push(current);
      }
    }

    // تحديد الحدود
    return merged.map((r) => ({
      startSample: Math.max(0, r.startSample),
      endSample: Math.min(maxSample, r.endSample),
    }));
  }

  /**
   * تصدير AudioBuffer كـ WAV Blob
   */
  exportAsWav(buffer: AudioBuffer): Blob {
    const numChannels = buffer.numberOfChannels;
    const sampleRate = buffer.sampleRate;
    const length = buffer.length;
    const bytesPerSample = 2; // 16-bit
    const blockAlign = numChannels * bytesPerSample;
    const byteRate = sampleRate * blockAlign;
    const dataSize = length * blockAlign;
    const headerSize = 44;
    const totalSize = headerSize + dataSize;

    const arrayBuffer = new ArrayBuffer(totalSize);
    const view = new DataView(arrayBuffer);

    const writeString = (offset: number, str: string) => {
      for (let i = 0; i < str.length; i++) {
        view.setUint8(offset + i, str.charCodeAt(i));
      }
    };

    writeString(0, "RIFF");
    view.setUint32(4, totalSize - 8, true);
    writeString(8, "WAVE");
    writeString(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); // PCM
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, 16, true); // bits per sample
    writeString(36, "data");
    view.setUint32(40, dataSize, true);

    // كتابة العينات interleaved
    let offset = 44;
    for (let i = 0; i < length; i++) {
      for (let ch = 0; ch < numChannels; ch++) {
        const sample = Math.max(-1, Math.min(1, buffer.getChannelData(ch)[i]));
        view.setInt16(offset, sample < 0 ? sample * 32768 : sample * 32767, true);
        offset += 2;
      }
    }

    return new Blob([arrayBuffer], { type: "audio/wav" });
  }
}
