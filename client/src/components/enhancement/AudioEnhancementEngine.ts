import { AudioAnalyzer }     from "./AudioAnalyzer";
import { DeReverbProcessor } from "./DeReverbProcessor";
import { DynamicsProcessor }  from "./DynamicsProcessor";
import { HumRemover }         from "./HumRemover";
import { LoudnessNormalizer } from "./LoudnessNormalizer";
import { NoiseReducer }       from "./NoiseReducer";
import type { EnhancementOptions, EnhancementReport, EnhancementResult } from "./types";

/**
 * AudioEnhancementEngine
 *
 * Public API:
 *   enhanceAudio(buffer, options, onProgress?) → Promise<EnhancementResult>
 *
 * Pipeline order (Phase E):
 *   analyze input → hum removal → noise reduction → de-reverb → dynamics/EQ
 *   → normalization → analyze output
 *
 * Rules:
 * - Never mutates the input buffer.
 * - Always returns a new AudioBuffer.
 * - Works for mono and stereo.
 * - Preserves duration and sampleRate.
 * - Conservative defaults — safe for Quran recitation.
 * - Pure TypeScript — no React/DOM dependencies.
 */
export class AudioEnhancementEngine {

  static async enhanceAudio(
    buffer:      AudioBuffer,
    options:     EnhancementOptions,
    onProgress?: (pct: number, stage: string) => void,
  ): Promise<EnhancementResult> {

    if (!buffer || buffer.length === 0) {
      throw new Error("AudioEnhancementEngine: invalid or empty AudioBuffer");
    }

    const progress = onProgress ?? (() => {});

    // ── 1. Analyze input ──────────────────────────────────────────────────────
    progress(3, "جاري تحليل الصوت...");
    const before = AudioAnalyzer.analyze(buffer);

    const appliedStages: string[] = [];

    // ── 2. Hum removal (8–20%) ───────────────────────────────────────────────
    progress(8, "جاري التحقق من الطنين...");
    const humResult = await HumRemover.process(
      buffer,
      options.humRemoval,
      (pct, stage) => progress(8 + Math.round(pct * 0.12), stage),
    );
    const humBuffer = humResult.buffer;

    if (options.humRemoval.enabled) {
      appliedStages.push(`hum_removal_${options.humRemoval.frequencyHz}hz`);
    }

    // ── 3. Noise reduction (20–30%) ──────────────────────────────────────────
    progress(20, "جاري تحليل الضوضاء...");
    const nrResult = await NoiseReducer.process(
      humBuffer,
      options.noiseReduction,
      (pct, stage) => progress(20 + Math.round(pct * 0.10), stage),
    );
    const nrBuffer = nrResult.buffer;

    if (options.noiseReduction.enabled) {
      appliedStages.push(`noise_reduction_${options.noiseReduction.strength}`);
    }

    // ── 4. De-reverb (30–38%) ────────────────────────────────────────────────
    progress(30, "جاري تحليل الصدى...");
    const drResult = await DeReverbProcessor.process(
      nrBuffer,
      options.deReverb,
      (pct, stage) => progress(30 + Math.round(pct * 0.08), stage),
    );
    const drBuffer = drResult.buffer;

    if (options.deReverb.enabled) {
      appliedStages.push(`de_reverb_${options.deReverb.amount}`);
    }

    // ── 5. Dynamics processing (38–82%) ──────────────────────────────────────
    progress(38, "جاري إعداد المعالجة...");
    const processed = await DynamicsProcessor.process(
      drBuffer,
      options,
      (pct, stage) => progress(38 + Math.round(pct * 0.44), stage),
    );

    if (options.highPassHz      > 0)                                  appliedStages.push("high_pass");
    if (options.warmthHz        > 0 && options.warmthDb       !== 0)  appliedStages.push("warmth");
    if (options.presenceBoostHz > 0 && options.presenceBoostDb !== 0) appliedStages.push("presence");
    if (options.airBoostHz      > 0 && options.airBoostDb      !== 0) appliedStages.push("air");
    if (options.compressor.enabled)                                   appliedStages.push("compressor");
    if (options.limiter.enabled)                                      appliedStages.push("limiter");

    // ── 6. Peak normalization (82%) ───────────────────────────────────────────
    progress(82, "جاري التطبيع...");
    let finalBuffer         = processed;
    let normalizationGainDb = 0;

    if (options.normalize) {
      const norm       = LoudnessNormalizer.normalize(processed, options.normalizeTargetDb);
      finalBuffer      = norm.buffer;
      normalizationGainDb = norm.gainAppliedDb;
      appliedStages.push("peak_normalize");
    }

    // ── 7. Analyze output (94%) ───────────────────────────────────────────────
    progress(94, "جاري تحليل النتيجة...");
    const after = AudioAnalyzer.analyze(finalBuffer);

    const report: EnhancementReport = {
      before,
      after,
      presetId:             options.presetId,
      appliedStages,
      normalizationGainDb,
      limiterApplied:           options.limiter.enabled,
      clippingPrevented:        before.clippingDetected && !after.clippingDetected,
      humRemovalApplied:        options.humRemoval.enabled,
      humFrequency:             options.humRemoval.enabled ? options.humRemoval.frequencyHz : undefined,
      humHarmonicsProcessed:    humResult.harmonicsProcessed.length > 0 ? humResult.harmonicsProcessed : undefined,
      noiseReductionApplied:    options.noiseReduction.enabled,
      noiseReductionMode:       options.noiseReduction.enabled ? options.noiseReduction.mode : undefined,
      estimatedNoiseFloorDb:    options.noiseReduction.enabled ? nrResult.profile.noiseFloorDb     : undefined,
      noiseThresholdDb:         options.noiseReduction.enabled ? nrResult.profile.noiseThresholdDb : undefined,
      noiseFramesUsed:          options.noiseReduction.enabled ? nrResult.profile.noiseFramesUsed  : undefined,
      deReverbApplied:          options.deReverb.enabled,
      deReverbAmount:           options.deReverb.enabled ? options.deReverb.amount : undefined,
      reverbTailReductionDb:    options.deReverb.enabled ? drResult.reverbTailReductionDb : undefined,
    };

    progress(100, "اكتملت المعالجة ✓");

    return { processedBuffer: finalBuffer, report };
  }
}
