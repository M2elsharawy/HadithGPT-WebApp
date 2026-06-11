import { AudioAnalyzer }     from "./AudioAnalyzer";
import { DeReverbProcessor } from "./DeReverbProcessor";
import { DynamicsProcessor }  from "./DynamicsProcessor";
import { HumRemover }         from "./HumRemover";
import { LoudnessNormalizer } from "./LoudnessNormalizer";
import { NoiseReducer }       from "./NoiseReducer";
import type { EnhancementOptions, EnhancementReport, EnhancementResult } from "./types";

// ── Presence/air boost safety ─────────────────────────────────────────────────
// When SNR is low the noise floor is close to the speech level.  Applying
// full presence/air boosts would amplify noise as much as speech.
// Two-tier conservative scale-back: only positive boosts are reduced; negative
// boosts (cuts) and zero values are never touched.

const BOOST_SAFETY_HARD_THRESHOLD_DB = 12;   // SNR < 12 dB  → scale to 50 %
const BOOST_SAFETY_SOFT_THRESHOLD_DB = 18;   // SNR < 18 dB  → scale to 75 %

export interface BoostSafetyResult {
  presenceBoostDb: number;
  airBoostDb:      number;
  adjusted:        boolean;
  scale:           number;   // 1.0 = no change; <1.0 = attenuated
}

/**
 * Returns scaled presence/air boost values for noisy recordings.
 * Exported as a pure function so it can be unit-tested without
 * OfflineAudioContext.
 */
export function applyPresenceAirSafety(
  presenceBoostDb: number,
  airBoostDb:      number,
  snrDb:           number,
): BoostSafetyResult {
  let scale = 1.0;
  if (snrDb < BOOST_SAFETY_HARD_THRESHOLD_DB) {
    scale = 0.5;
  } else if (snrDb < BOOST_SAFETY_SOFT_THRESHOLD_DB) {
    scale = 0.75;
  }

  const adjusted = scale < 1.0 && (presenceBoostDb > 0 || airBoostDb > 0);
  return {
    presenceBoostDb: presenceBoostDb > 0 ? presenceBoostDb * scale : presenceBoostDb,
    airBoostDb:      airBoostDb      > 0 ? airBoostDb      * scale : airBoostDb,
    adjusted,
    scale,
  };
}

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

    // ── 5. Presence/air boost safety ─────────────────────────────────────────
    // Reduce positive presence/air boosts on noisy recordings (low SNR) so
    // noise is not amplified together with speech.  The original `options`
    // object is never mutated — a shallow spread copy is used when needed.
    const safeBoosts    = applyPresenceAirSafety(
      options.presenceBoostDb,
      options.airBoostDb,
      before.snrDb,
    );
    const dynamicsOptions: EnhancementOptions = safeBoosts.adjusted
      ? { ...options, presenceBoostDb: safeBoosts.presenceBoostDb, airBoostDb: safeBoosts.airBoostDb }
      : options;

    // ── 6. Dynamics processing (38–82%) ──────────────────────────────────────
    progress(38, "جاري إعداد المعالجة...");
    const processed = await DynamicsProcessor.process(
      drBuffer,
      dynamicsOptions,
      (pct, stage) => progress(38 + Math.round(pct * 0.44), stage),
    );

    if (options.highPassHz      > 0)                                       appliedStages.push("high_pass");
    if (options.warmthHz        > 0 && options.warmthDb        !== 0)     appliedStages.push("warmth");
    if (options.presenceBoostHz > 0 && dynamicsOptions.presenceBoostDb !== 0) appliedStages.push("presence");
    if (options.airBoostHz      > 0 && dynamicsOptions.airBoostDb      !== 0) appliedStages.push("air");
    if (options.compressor.enabled)                                        appliedStages.push("compressor");
    if (options.limiter.enabled)                                           appliedStages.push("limiter");

    // ── 7. Peak normalization (82%) ───────────────────────────────────────────
    progress(82, "جاري التطبيع...");
    let finalBuffer         = processed;
    let normalizationGainDb = 0;

    if (options.normalize) {
      const norm       = LoudnessNormalizer.normalize(processed, options.normalizeTargetDb);
      finalBuffer      = norm.buffer;
      normalizationGainDb = norm.gainAppliedDb;
      appliedStages.push("peak_normalize");
    }

    // ── 8. Analyze output (94%) ───────────────────────────────────────────────
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

      presenceBoostAdjusted:    safeBoosts.adjusted || undefined,
      appliedPresenceBoostDb:   safeBoosts.adjusted ? safeBoosts.presenceBoostDb : undefined,
      appliedAirBoostDb:        safeBoosts.adjusted ? safeBoosts.airBoostDb      : undefined,
      snrDbUsedForSafety:       safeBoosts.adjusted ? before.snrDb               : undefined,
    };

    progress(100, "اكتملت المعالجة ✓");

    return { processedBuffer: finalBuffer, report };
  }
}
