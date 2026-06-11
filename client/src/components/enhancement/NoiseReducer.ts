import { NoiseProfileAnalyzer } from "./NoiseProfileAnalyzer";
import type { NoiseProfile }     from "./NoiseProfileAnalyzer";
import type { NoiseReductionOptions } from "./types";

// ── Strength configuration ────────────────────────────────────────────────────

interface StrengthConfig {
  thresholdOffsetDb: number;  // Added to noiseThresholdDb from profile
  gainFloor:         number;  // Minimum gain (linear) — never fully mutes
  expansionRangeDb:  number;  // dB range over which gain linearly ramps gainFloor→1.0
}

const STRENGTH_CONFIGS: Record<NoiseReductionOptions["strength"], StrengthConfig> = {
  // Higher thresholdOffset → more frames fall below threshold → more aggressive.
  // Lower gainFloor → maximum attenuation is greater.
  light:  { thresholdOffsetDb: -4, gainFloor: 0.40, expansionRangeDb: 12 },
  medium: { thresholdOffsetDb:  0, gainFloor: 0.20, expansionRangeDb: 12 },
  strong: { thresholdOffsetDb:  4, gainFloor: 0.20, expansionRangeDb: 12 },
};

// ── Timing constants ──────────────────────────────────────────────────────────

const FRAME_SIZE      = 512;   // ~11 ms at 44100 Hz — per-frame gain decision
const ATTACK_TIME_S   = 0.003; // gate opens fast when speech appears
const RELEASE_TIME_S  = 0.150; // gate closes slowly to preserve natural pauses

// ── Helpers ───────────────────────────────────────────────────────────────────

function cloneBuffer(src: AudioBuffer): AudioBuffer {
  const out = new AudioBuffer({
    numberOfChannels: src.numberOfChannels,
    length:           src.length,
    sampleRate:       src.sampleRate,
  });
  for (let ch = 0; ch < src.numberOfChannels; ch++) {
    out.getChannelData(ch).set(src.getChannelData(ch));
  }
  return out;
}

// ── Public types ──────────────────────────────────────────────────────────────

export interface NoiseReducerResult {
  buffer:  AudioBuffer;
  profile: NoiseProfile;
}

/**
 * NoiseReducer
 *
 * Broadband frame-based expander with adaptive noise threshold.
 *
 * Algorithm:
 * 1. Estimate noise floor via NoiseProfileAnalyzer (quietest 15% of frames).
 * 2. For each 512-sample frame, compute mixed-channel RMS.
 * 3. Map RMS → target gain via soft expansion curve:
 *    - Above threshold           → gain = 1.0 (pass through)
 *    - Below (threshold−12 dB)  → gain = gainFloor (max attenuation)
 *    - Between                  → linear interpolation
 * 4. Smooth gain with first-order IIR per sample:
 *    - Attack  10 ms (fast: gate opens quickly when speech appears)
 *    - Release 150 ms (slow: gate closes gradually after speech ends)
 * 5. Apply smoothed gain to each sample in a new AudioBuffer.
 *
 * This is a real time-domain noise reducer, not EQ:
 * - EQ applies the same fixed gain to every sample regardless of level.
 * - This expander applies a time-varying gain that depends on local
 *   frame energy, so quiet frames (noise) are attenuated while loud
 *   frames (speech) pass through unchanged.
 *
 * Limitations (see upgrade notes for spectral mode):
 * - No frequency-domain separation; targets amplitude, not spectral shape.
 * - May attenuate very soft speech or breaths near the threshold.
 * - Does not track non-stationary noise.
 *
 * When disabled: returns a clone of the input buffer (no mutation, safe
 * for standalone use).
 */
export class NoiseReducer {
  static async process(
    buffer:      AudioBuffer,
    options:     NoiseReductionOptions,
    onProgress?: (pct: number, stage: string) => void,
  ): Promise<NoiseReducerResult> {

    if (!options.enabled) {
      return { buffer: cloneBuffer(buffer), profile: NoiseProfileAnalyzer.analyze(buffer) };
    }

    const { numberOfChannels, sampleRate, length } = buffer;
    const cfg = STRENGTH_CONFIGS[options.strength];

    onProgress?.(5, "جاري تحليل مستوى الضوضاء...");

    // ── 1. Noise profiling ────────────────────────────────────────────────────
    const profile = NoiseProfileAnalyzer.analyze(buffer);

    const thresholdDb     = profile.noiseThresholdDb + cfg.thresholdOffsetDb;
    const thresholdLinear = Math.pow(10, thresholdDb / 20);
    const lowerDb         = thresholdDb - cfg.expansionRangeDb;
    const lowerLinear     = Math.pow(10, lowerDb / 20);

    onProgress?.(20, "جاري حساب مغلف الضوضاء...");

    // ── 2. Per-frame target gain ──────────────────────────────────────────────
    const numFrames   = Math.ceil(length / FRAME_SIZE);
    const targetGains = new Float32Array(numFrames);

    for (let f = 0; f < numFrames; f++) {
      const start = f * FRAME_SIZE;
      const end   = Math.min(start + FRAME_SIZE, length);
      let sumSq   = 0;
      let count   = 0;
      for (let ch = 0; ch < numberOfChannels; ch++) {
        const data = buffer.getChannelData(ch);
        for (let i = start; i < end; i++) {
          sumSq += data[i] * data[i];
          count++;
        }
      }
      const frameRms = count > 0 ? Math.sqrt(sumSq / count) : 0;

      if (frameRms >= thresholdLinear) {
        targetGains[f] = 1.0;
      } else if (frameRms <= lowerLinear || frameRms < 1e-9) {
        targetGains[f] = cfg.gainFloor;
      } else {
        // Soft linear ramp from gainFloor (at lowerLinear) to 1.0 (at threshold)
        const ratio    = (frameRms - lowerLinear) / (thresholdLinear - lowerLinear);
        targetGains[f] = cfg.gainFloor + (1 - cfg.gainFloor) * ratio;
      }
    }

    onProgress?.(40, "جاري تطبيق تخفيف الضوضاء...");

    // ── 3. IIR smoothing coefficients ────────────────────────────────────────
    // coeff closer to 1 → slower response (larger time constant)
    const attackCoeff  = Math.exp(-1 / (sampleRate * ATTACK_TIME_S));
    const releaseCoeff = Math.exp(-1 / (sampleRate * RELEASE_TIME_S));

    // ── 4. Apply gain per channel ─────────────────────────────────────────────
    const out = new AudioBuffer({ numberOfChannels, length, sampleRate });

    for (let ch = 0; ch < numberOfChannels; ch++) {
      const src = buffer.getChannelData(ch);
      const dst = out.getChannelData(ch);
      let smoothGain = 1.0;

      for (let i = 0; i < length; i++) {
        const target = targetGains[Math.floor(i / FRAME_SIZE)];

        // Attack (gain rising): gate opens fast; Release (gain falling): gate closes slowly
        const coeff = target > smoothGain ? attackCoeff : releaseCoeff;
        smoothGain  = coeff * smoothGain + (1 - coeff) * target;

        dst[i] = src[i] * smoothGain;
      }
    }

    // ── 5. Wet/dry blend ─────────────────────────────────────────────────────
    // wetDryRatio: 1.0 = fully processed (default), 0.0 = original.
    // Values outside [0, 1] are clamped. When wet === 1.0 the blend block is
    // skipped entirely, so omitting the option is a strict no-op.
    const wetRatio = Math.max(0, Math.min(1, options.wetDryRatio ?? 1.0));
    if (wetRatio < 1.0) {
      const dryRatio = 1 - wetRatio;
      for (let ch = 0; ch < numberOfChannels; ch++) {
        const orig = buffer.getChannelData(ch);
        const proc = out.getChannelData(ch);
        for (let i = 0; i < length; i++) {
          proc[i] = wetRatio * proc[i] + dryRatio * orig[i];
        }
      }
    }

    onProgress?.(90, "اكتملت معالجة الضوضاء");

    return { buffer: out, profile };
  }
}
