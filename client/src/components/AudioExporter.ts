/**
 * AudioExporter
 * تصدير AudioBuffer إلى WAV أو MP3
 *
 * MP3: يستخدم lamejs إذا كان مثبتاً (تحكم كامل في الـ bitrate)
 *      وإلا MediaRecorder كـ fallback (لا تحكم في bitrate)
 *
 * لتثبيت lamejs: pnpm add lamejs
 */

export type ExportFormat = "wav" | "mp3";

export type Mp3Bitrate = 64 | 96 | 128 | 192;

export interface ExportOptions {
  format: ExportFormat;
  /** جودة MP3 بالـ kbps — تعمل فقط مع lamejs */
  mp3Bitrate?: Mp3Bitrate;
}

// ─── Bitrate presets ──────────────────────────────────────────────────────────

export const MP3_BITRATE_OPTIONS: Array<{
  value: Mp3Bitrate;
  label: string;
  desc: string;
}> = [
  { value: 192, label: "عالية (192 kbps)",   desc: "جودة عالية — مناسب للأرشفة" },
  { value: 128, label: "متوسطة (128 kbps)",  desc: "جودة جيدة — مناسب للمشاركة ✓" },
  { value: 96,  label: "منخفضة (96 kbps)",   desc: "حجم أصغر — مناسب لواتساب" },
  { value: 64,  label: "منخفضة جداً (64 kbps)", desc: "أصغر حجم — مناسب لتسجيلات الصوت" },
];

export const DEFAULT_MP3_BITRATE: Mp3Bitrate = 128;

// ─── Size estimation ──────────────────────────────────────────────────────────

/**
 * تقدير حجم ملف MP3 بالـ MB
 * الصيغة: (bitrate_kbps × duration_sec) / 8000
 */
export function estimateMp3SizeMB(
  durationSec: number,
  bitrate: Mp3Bitrate
): number {
  return (bitrate * durationSec) / 8000;
}

/**
 * تنسيق حجم الملف للعرض
 */
export function formatFileSizeMB(mb: number): string {
  if (mb < 1) return `${(mb * 1024).toFixed(0)} KB`;
  return `${mb.toFixed(1)} MB`;
}

// ─── Main class ───────────────────────────────────────────────────────────────

// ── Internal type ─────────────────────────────────────────────────────────
type EncoderCtor = new (channels: number, sampleRate: number, bitrate: number) => {
  encodeBuffer(left: Int16Array, right?: Int16Array): Int8Array;
  flush(): Int8Array;
};

export class AudioExporter {

  // ── نقطة دخول ────────────────────────────────────────────────────────────

  static async export(buffer: AudioBuffer, options: ExportOptions): Promise<Blob> {
    if (!buffer || buffer.length === 0) {
      throw new Error("الـ AudioBuffer فارغ");
    }

    const blob = options.format === "wav"
      ? AudioExporter.toWav(buffer)
      : await AudioExporter.toMp3(buffer, options.mp3Bitrate ?? DEFAULT_MP3_BITRATE);

    if (blob.size === 0) {
      throw new Error(`ناتج التصدير فارغ (${options.format.toUpperCase()})`);
    }

    return blob;
  }

  // ── WAV ──────────────────────────────────────────────────────────────────

  static toWav(buffer: AudioBuffer): Blob {
    const numCh      = buffer.numberOfChannels;
    const sr         = buffer.sampleRate;
    const len        = buffer.length;
    const bps        = 2;
    const blockAlign = numCh * bps;
    const dataSize   = len * blockAlign;
    const ab = new ArrayBuffer(44 + dataSize);
    const v  = new DataView(ab);

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

  // ── MP3 ───────────────────────────────────────────────────────────────────

  static async toMp3(buffer: AudioBuffer, bitrate: Mp3Bitrate = DEFAULT_MP3_BITRATE): Promise<Blob> {
    try {
      return await AudioExporter._encodeMp3(buffer, bitrate);
    } catch (err) {
      console.warn("[AudioExporter] MP3 encoding failed:", err instanceof Error ? err.message : err);
      // Fallback: WAV محفوظ بامتداد mp3 — يُشغَّل في معظم المشغلات لكن ليس واتساب
      // أخبر المستخدم بذلك
      throw new Error(
        "تعذّر إنتاج MP3 حقيقي في هذا المتصفح.\n" +
        "الحل: استخدم WAV للتصدير، أو افتح التطبيق في Chrome."
      );
    }
  }

  /**
   * MP3 encoding — يجرب مصدرين محليين فقط (بدون CDN):
   * 1. @breezystack/lamejs (ESM-safe, browser-native)
   * 2. lamejs (npm)
   */
  private static async _encodeMp3(buffer: AudioBuffer, bitrate: Mp3Bitrate): Promise<Blob> {
    // ── 1. @breezystack/lamejs ────────────────────────────────────────────
    let Mp3Encoder = await AudioExporter._tryBreezyLamejs();

    // ── 2. lamejs npm ──────────────────────────────────────────────────────
    if (!Mp3Encoder) Mp3Encoder = await AudioExporter._tryNpmLamejs();

    if (!Mp3Encoder) throw new Error("lamejs غير متاح — تأكد من تثبيت @breezystack/lamejs");

    return AudioExporter._runLameEncoder(Mp3Encoder, buffer, bitrate);
  }

  private static async _tryBreezyLamejs(): Promise<EncoderCtor | null> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const m: any = await import("@breezystack/lamejs");
      const Enc = m?.Mp3Encoder ?? m?.default?.Mp3Encoder;
      return typeof Enc === "function" ? Enc : null;
    } catch { return null; }
  }

  private static async _tryNpmLamejs(): Promise<EncoderCtor | null> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const m: any = await import("lamejs");
      const Enc = m?.Mp3Encoder ?? m?.default?.Mp3Encoder ?? (typeof m?.default === "function" ? m.default : null);
      return typeof Enc === "function" ? Enc : null;
    } catch { return null; }
  }

  private static _runLameEncoder(Mp3Encoder: EncoderCtor, buffer: AudioBuffer, bitrate: Mp3Bitrate): Blob {
    const ch  = Math.min(buffer.numberOfChannels, 2) as 1 | 2;
    const sr  = buffer.sampleRate;
    const len = buffer.length;

    const toInt16 = (f: Float32Array): Int16Array => {
      const o = new Int16Array(f.length);
      for (let i = 0; i < f.length; i++) {
        const v = Math.max(-1, Math.min(1, f[i]));
        o[i] = v < 0 ? v * 32768 : v * 32767;
      }
      return o;
    };

    const L = toInt16(buffer.getChannelData(0));
    const R = ch === 2 ? toInt16(buffer.getChannelData(1)) : L;

    const enc = new Mp3Encoder(ch, sr, bitrate);
    const SZ  = 1152;
    const out: Int8Array[] = [];

    for (let i = 0; i < len; i += SZ) {
      const l = L.subarray(i, i + SZ);
      const r = R.subarray(i, i + SZ);
      const d: Int8Array = ch === 2 ? enc.encodeBuffer(l, r) : enc.encodeBuffer(l);
      if (d.length > 0) out.push(d);
    }
    const tail = enc.flush();
    if (tail.length > 0) out.push(tail);
    if (out.length === 0) throw new Error("lamejs لم يُنتج بيانات");

    const total = out.reduce((a, c) => a + c.length, 0);
    const buf   = new Uint8Array(total);
    let p = 0;
    for (const c of out) { buf.set(c, p); p += c.length; }

    return new Blob([buf], { type: "audio/mpeg" });
  }

  /** MP3 fallback عبر MediaRecorder — يعمل في الوقت الفعلي (بطيء) */
  private static _toMp3WithMediaRecorder(buffer: AudioBuffer): Promise<Blob> {
    return new Promise((resolve, reject) => {
      const { sampleRate: sr, length: len, numberOfChannels: numCh } = buffer;
      const durationMs = (len / sr) * 1000;
      // timeout = مدة الصوت × 1.3 + 5 ثوانٍ أمان
      const timeoutMs = durationMs * 1.3 + 5000;

      const offCtx = new OfflineAudioContext(numCh, len, sr);
      const src    = offCtx.createBufferSource();
      src.buffer   = buffer;
      src.connect(offCtx.destination);
      src.start(0);

      offCtx.startRendering().then(rendered => {
        const liveCtx = new AudioContext({ sampleRate: sr });
        const dest    = liveCtx.createMediaStreamDestination();
        const liveSrc = liveCtx.createBufferSource();
        liveSrc.buffer = rendered;
        liveSrc.connect(dest);

        const mimeType = [
          "audio/webm;codecs=opus",
          "audio/webm",
          "audio/ogg;codecs=opus",
          "audio/ogg",
        ].find(t => {
          try { return MediaRecorder.isTypeSupported(t); }
          catch { return false; }
        });

        if (!mimeType) {
          liveCtx.close().catch(() => {});
          reject(new Error(
            "تعذر تصدير MP3 — المتصفح لا يدعم تسجيل الصوت.\n" +
            "يمكنك استخدام WAV أو تجربة Chrome / Edge."
          ));
          return;
        }

        const recorder = new MediaRecorder(dest.stream, { mimeType });
        const chunks: Blob[] = [];
        let settled = false;

        const settle = (fn: () => void) => {
          if (settled) return;
          settled = true;
          liveCtx.close().catch(() => {});
          fn();
        };

        // timeout يمنع التعليق الأبدي
        const tid = setTimeout(() => {
          try { if (recorder.state !== "inactive") recorder.stop(); }
          catch { /* ignore */ }
          settle(() => {
            if (chunks.length > 0) {
              resolve(new Blob(chunks, { type: "audio/mpeg" }));
            } else {
              reject(new Error("انتهت المهلة — لم يُنتج MediaRecorder بيانات"));
            }
          });
        }, timeoutMs);

        recorder.ondataavailable = e => { if (e.data?.size > 0) chunks.push(e.data); };
        recorder.onstop = () => {
          clearTimeout(tid);
          settle(() => {
            if (chunks.length === 0) { reject(new Error("MediaRecorder لم يُنتج بيانات")); return; }
            resolve(new Blob(chunks, { type: "audio/mpeg" }));
          });
        };
        recorder.onerror = () => { clearTimeout(tid); settle(() => reject(new Error("خطأ في MediaRecorder"))); };

        recorder.start(250);
        liveSrc.start(0);
        liveSrc.onended = () => {
          setTimeout(() => {
            try { if (recorder.state !== "inactive") recorder.stop(); }
            catch { /* ignore */ }
          }, 500);
        };
      }).catch(reject);
    });
  }

  // ── Download ──────────────────────────────────────────────────────────────

  static downloadBlob(blob: Blob, fileName: string): void {
    if (!blob || blob.size === 0) {
      throw new Error("الملف فارغ");
    }
    const url = URL.createObjectURL(blob);
    const a   = document.createElement("a");
    a.style.display = "none";
    a.href          = url;
    a.download      = fileName;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  static buildExportName(
    originalName: string,
    format: ExportFormat,
    suffix = "trimmed"
  ): string {
    const dot  = originalName.lastIndexOf(".");
    const base = dot !== -1 ? originalName.slice(0, dot) : originalName;
    return `${base}-${suffix}.${format}`;
  }
}
