import { createOfflineAudioContext } from "./AudioContextFactory";
import type { EnhancementOptions } from "./types";

/**
 * Offline dynamics processing pipeline.
 * Builds a Web Audio filter/compressor chain inside OfflineAudioContext,
 * renders it, and returns the resulting AudioBuffer.
 * The input buffer is NEVER mutated.
 */
export class DynamicsProcessor {
  static async process(
    buffer: AudioBuffer,
    options: EnhancementOptions,
    onProgress?: (pct: number, stage: string) => void,
  ): Promise<AudioBuffer> {
    const { numberOfChannels, sampleRate, length } = buffer;

    onProgress?.(5, "جاري إعداد سلسلة المعالجة...");

    const offline = createOfflineAudioContext(numberOfChannels, length, sampleRate);
    const src     = offline.createBufferSource();
    src.buffer    = buffer;

    let node: AudioNode = src;

    // ── Stage 1: High-pass ────────────────────────────────────────────────────
    if (options.highPassHz > 0) {
      const hp        = offline.createBiquadFilter();
      hp.type         = "highpass";
      hp.frequency.value = options.highPassHz;
      hp.Q.value      = 0.707; // Butterworth — maximally flat passband
      node.connect(hp);
      node = hp;
    }

    onProgress?.(15, "جاري تطبيق فلاتر التوازن...");

    // ── Stage 2: Warmth boost (low-mid) ──────────────────────────────────────
    if (options.warmthHz > 0 && options.warmthDb !== 0) {
      const w        = offline.createBiquadFilter();
      w.type         = "peaking";
      w.frequency.value = options.warmthHz;
      w.Q.value      = 1.2;
      w.gain.value   = options.warmthDb;
      node.connect(w);
      node = w;
    }

    // ── Stage 3: Presence boost ───────────────────────────────────────────────
    if (options.presenceBoostHz > 0 && options.presenceBoostDb !== 0) {
      const p        = offline.createBiquadFilter();
      p.type         = "peaking";
      p.frequency.value = options.presenceBoostHz;
      p.Q.value      = options.presenceQ > 0 ? options.presenceQ : 1.2;
      p.gain.value   = options.presenceBoostDb;
      node.connect(p);
      node = p;
    }

    // ── Stage 4: Air boost (high-shelf) ──────────────────────────────────────
    if (options.airBoostHz > 0 && options.airBoostDb !== 0) {
      const air         = offline.createBiquadFilter();
      air.type          = "highshelf";
      air.frequency.value = options.airBoostHz;
      air.gain.value    = options.airBoostDb;
      node.connect(air);
      node = air;
    }

    onProgress?.(30, "جاري تطبيق ضغط الديناميكية...");

    // ── Stage 5: Compressor ───────────────────────────────────────────────────
    if (options.compressor.enabled) {
      const comp         = offline.createDynamicsCompressor();
      comp.threshold.value = options.compressor.threshold;
      comp.knee.value      = Math.max(0, options.compressor.knee);
      comp.ratio.value     = Math.min(20, Math.max(1, options.compressor.ratio));
      comp.attack.value    = options.compressor.attack;
      comp.release.value   = options.compressor.release;
      node.connect(comp);
      node = comp;

      // Make-up gain after compressor, before limiter
      if (options.compressor.makeupGainDb !== 0) {
        const makeup        = offline.createGain();
        makeup.gain.value   = Math.pow(10, options.compressor.makeupGainDb / 20);
        node.connect(makeup);
        node = makeup;
      }
    }

    // ── Stage 6: Limiter (DynamicsCompressor as brickwall) ───────────────────
    // Note: true brickwall requires post-processing; LoudnessNormalizer provides
    // the final sample-level guarantee. This stage reduces overshoots.
    if (options.limiter.enabled) {
      const lim         = offline.createDynamicsCompressor();
      lim.threshold.value = options.limiter.ceilingDb;
      lim.knee.value      = 0;    // hard knee
      lim.ratio.value     = 20;   // near-brickwall
      lim.attack.value    = 0.001;
      lim.release.value   = 0.05;
      node.connect(lim);
      node = lim;
    }

    node.connect(offline.destination);
    src.start(0);

    onProgress?.(50, "جاري المعالجة الصوتية...");
    const rendered = await offline.startRendering();
    onProgress?.(90, "اكتملت المعالجة...");

    return rendered;
  }
}
