/**
 * ManualEQ
 * معادل صوتي يدوي من 9 نطاقات لتسجيلات المساجد والقرآن الكريم
 *
 * وظيفتان:
 *   1. Realtime: تعديل فوري أثناء التشغيل عبر AdvancedAudioProcessor
 *   2. Export: تصدير WAV بإعدادات الـ EQ الحالية عبر OfflineAudioContext
 */

export interface EQBand {
  /** تردد النطاق بالهرتز */
  freq: number;
  /** اسم النطاق بالعربية */
  label: string;
  /** وصف وظيفة النطاق */
  description: string;
  /** نوع الفلتر في Web Audio API */
  type: BiquadFilterType;
  /** قيمة Q */
  Q: number;
}

export const EQ_BANDS: EQBand[] = [
  { freq: 80,    label: "80Hz",   description: "هدير / ضوضاء منخفضة",  type: "lowshelf",  Q: 0.7 },
  { freq: 150,   label: "150Hz",  description: "الدفء",                  type: "peaking",   Q: 1.0 },
  { freq: 250,   label: "250Hz",  description: "تعكير",                  type: "peaking",   Q: 1.0 },
  { freq: 500,   label: "500Hz",  description: "جسم الصوت",              type: "peaking",   Q: 1.0 },
  { freq: 1000,  label: "1kHz",   description: "الحضور",                 type: "peaking",   Q: 1.0 },
  { freq: 2500,  label: "2.5kHz", description: "الوضوح",                 type: "peaking",   Q: 1.2 },
  { freq: 4000,  label: "4kHz",   description: "فهم الكلمات",            type: "peaking",   Q: 1.2 },
  { freq: 8000,  label: "8kHz",   description: "السطوع",                 type: "peaking",   Q: 1.0 },
  { freq: 12000, label: "12kHz",  description: "هسهسة / هواء",           type: "highshelf", Q: 0.7 },
];

export type EQPresetName = "flat" | "quranClarity" | "noiseReduction" | "warmVoice";

export interface EQPreset {
  name: string;
  nameAr: string;
  gains: number[]; // 9 values, one per band
}

export const EQ_PRESETS: Record<EQPresetName, EQPreset> = {
  flat: {
    name: "Flat",
    nameAr: "مسطّح (إعادة تعيين)",
    gains: [0, 0, 0, 0, 0, 0, 0, 0, 0],
  },
  quranClarity: {
    name: "Quran Clarity",
    nameAr: "وضوح القرآن",
    // قطع قوي للهدير والتعكير، تعزيز واضح لمخارج الحروف والحضور
    gains: [-7, -3, -5, -2, +2, +7, +6, +2, -3],
  },
  noiseReduction: {
    name: "Noise Reduction",
    nameAr: "تقليل الضوضاء",
    // خفض حاد للترددات الحاملة للضوضاء مع الحفاظ على وضوح الكلام
    gains: [-9, -5, -6, -2, 0, +3, +3, -4, -6],
  },
  warmVoice: {
    name: "Warm Clear Voice",
    nameAr: "صوت دافئ واضح",
    // دفء طبيعي مع وضوح كافٍ للكلام دون حدة
    gains: [-4, +2, -4, +1, +2, +5, +4, 0, -3],
  },
};

export class ManualEQ {
  /** الـ gains الحالية — 9 قيم بالـ dB */
  private gains: number[] = [0, 0, 0, 0, 0, 0, 0, 0, 0];

  constructor() {
    // لا نحتاج AudioContext هنا — الـ realtime يمر عبر AdvancedAudioProcessor
  }

  /** تعيين gain لنطاق محدد */
  setGain(bandIndex: number, db: number): void {
    if (bandIndex >= 0 && bandIndex < EQ_BANDS.length) {
      this.gains[bandIndex] = Math.max(-12, Math.min(12, db));
    }
  }

  /** الحصول على gain نطاق محدد */
  getGain(bandIndex: number): number {
    return this.gains[bandIndex] ?? 0;
  }

  /** الحصول على جميع الـ gains */
  getAllGains(): number[] {
    return [...this.gains];
  }

  /** تطبيق preset */
  applyPreset(preset: EQPresetName): number[] {
    this.gains = [...EQ_PRESETS[preset].gains];
    return this.getAllGains();
  }

  /** إعادة تعيين للمسطّح */
  reset(): number[] {
    return this.applyPreset("flat");
  }

  /**
   * تصدير الصوت مع تطبيق إعدادات الـ EQ الحالية
   * يستخدم OfflineAudioContext — لا يحتاج تشغيلاً فعلياً
   */
  async exportWithEQ(
    audioUrl: string,
    onProgress?: (percent: number, stage: string) => void
  ): Promise<Blob> {
    // 1. تحميل الملف
    onProgress?.(5, "جاري تحميل الملف...");
    const response = await fetch(audioUrl);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const arrayBuffer = await response.arrayBuffer();

    // 2. فك التشفير
    onProgress?.(20, "جاري فك تشفير الصوت...");
    const decodeCtx = new AudioContext();
    let inputBuffer: AudioBuffer;
    try {
      inputBuffer = await decodeCtx.decodeAudioData(arrayBuffer);
    } finally {
      await decodeCtx.close();
    }

    const { numberOfChannels, sampleRate, length } = inputBuffer;

    // 3. OfflineAudioContext
    onProgress?.(35, "جاري تجهيز المعادل...");
    const offlineCtx = new OfflineAudioContext(numberOfChannels, length, sampleRate);

    const source = offlineCtx.createBufferSource();
    source.buffer = inputBuffer;

    // بناء 9 فلاتر بنفس إعدادات الـ EQ الحالية
    const filters: BiquadFilterNode[] = EQ_BANDS.map((band, i) => {
      const filter = offlineCtx.createBiquadFilter();
      filter.type = band.type;
      filter.frequency.value = band.freq;
      filter.Q.value = band.Q;
      filter.gain.value = this.gains[i];
      return filter;
    });

    // ربط السلسلة: source → filter[0] → ... → filter[8] → destination
    source.connect(filters[0]);
    for (let i = 0; i < filters.length - 1; i++) {
      filters[i].connect(filters[i + 1]);
    }
    filters[filters.length - 1].connect(offlineCtx.destination);

    // 4. تشغيل المعالجة
    onProgress?.(55, "جاري المعالجة...");
    source.start(0);
    const rendered = await offlineCtx.startRendering();

    // 5. تصدير WAV
    onProgress?.(85, "جاري تصدير الملف...");
    const blob = ManualEQ.toWav(rendered);
    onProgress?.(100, "اكتمل التصدير ✓");
    return blob;
  }

  /** تحويل AudioBuffer إلى WAV Blob — 16-bit PCM */
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
    v.setUint16(34, 16, true); s(36, "data");
    v.setUint32(40, dataSize, true);
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
}
