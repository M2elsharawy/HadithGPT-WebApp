import { createAudioBuffer } from "./AudioContextFactory";
import type { DeReverbOptions } from "./types";

// ── Amount configuration ──────────────────────────────────────────────────────

interface AmountConfig {
  peakReleaseTime: number;  // sec — peak-hold envelope release
  thresholdRatio:  number;  // linear 0..1 — ratio below which tail attenuation starts
  gainFloor:       number;  // linear — minimum gain (max attenuation)
  gainSmoothTime:  number;  // sec — IIR smoother on gain signal
}

const CONFIGS: Record<DeReverbOptions["amount"], AmountConfig> = {
  light: {
    peakReleaseTime: 0.600,
    thresholdRatio:  0.20,  // signal must decay to < 20% of peak → −14 dB
    gainFloor:       0.65,  // max attenuation: −3.7 dB — conservative
    gainSmoothTime:  0.008,
  },
  medium: {
    peakReleaseTime: 0.500,
    thresholdRatio:  0.28,  // signal must decay to < 28% of peak → −11 dB
    gainFloor:       0.40,  // max attenuation: −8.0 dB
    gainSmoothTime:  0.005,
  },
  strong: {
    peakReleaseTime: 0.380, // faster gate release between phrases
    thresholdRatio:  0.45,  // trigger attenuation when signal drops to < 45% of peak
    gainFloor:       0.22,  // max attenuation: −13.2 dB — targets PA loudspeaker ringing
    gainSmoothTime:  0.005, // same as medium — avoids pumping artifacts
  },
};

const RMS_SMOOTH_S    = 0.010;  // 10 ms short-term RMS smoother
const PEAK_HOLD_S     = 0.020;  // 20 ms hold before peak envelope releases

// ── Public types ──────────────────────────────────────────────────────────────

export interface DeReverbResult {
  buffer:               AudioBuffer;
  reverbTailReductionDb: number;
}

function cloneBuffer(src: AudioBuffer): AudioBuffer {
  const out = createAudioBuffer({
    numberOfChannels: src.numberOfChannels,
    length:           src.length,
    sampleRate:       src.sampleRate,
  });
  for (let ch = 0; ch < src.numberOfChannels; ch++) {
    out.getChannelData(ch).set(src.getChannelData(ch));
  }
  return out;
}

/**
 * DeReverbProcessor
 *
 * Conservative reverb-tail attenuator for speech and Quran recitation.
 *
 * Algorithm: Peak-Following Reverb Tail Attenuator
 * 1. Short-term IIR RMS envelope (10 ms) — tracks instantaneous energy.
 * 2. Peak-hold envelope (instant attack, 20 ms hold, slow exponential
 *    release) — stays elevated throughout the reverb tail after speech.
 * 3. Ratio = instantRms / peakEnv:
 *    - Near 1.0 during active speech → gain = 1.0 (no processing)
 *    - Low during reverb tail  → gain reduced toward gainFloor
 * 4. Soft ramp: gain = gainFloor + (1−gainFloor) × (ratio / threshold)
 * 5. Short IIR gain smoother prevents sample-level artifacts.
 * 6. Single gain signal (from mixed-channel RMS) applied to all channels
 *    identically — stereo balance preserved.
 *
 * Why this is real de-reverb and not EQ:
 * - EQ applies a fixed frequency-domain filter to every sample equally.
 * - This applies a time-varying gain derived from the signal's temporal
 *   dynamics: the ratio between short-term energy and recent peak energy.
 *   Two signals with identical spectral content but different dynamics
 *   (one dry, one reverberant) receive different treatment.
 *
 * Limitations:
 * - Energy-envelope based — cannot separate reverb from signal spectrally.
 * - Does not handle early reflections (< 50 ms) or non-stationary rooms.
 * - Prolonged vowels / sustained notes: ratio stays near 1.0 → no effect.
 * - Quiet recordings: peak hold and gainFloor keep processing minimal.
 *
 * When disabled: returns a cloned buffer — never the original reference.
 */
export class DeReverbProcessor {
  static async process(
    buffer:      AudioBuffer,
    options:     DeReverbOptions,
    onProgress?: (pct: number, stage: string) => void,
  ): Promise<DeReverbResult> {

    if (!options.enabled) {
      return { buffer: cloneBuffer(buffer), reverbTailReductionDb: 0 };
    }

    const { numberOfChannels, sampleRate, length } = buffer;
    const cfg = CONFIGS[options.amount];

    onProgress?.(5, "جاري تحليل صدى الغرفة...");

    // Precompute all IIR coefficients once
    const rmsCoeff        = Math.exp(-1 / (sampleRate * RMS_SMOOTH_S));
    const peakRelCoeff    = Math.exp(-1 / (sampleRate * cfg.peakReleaseTime));
    const gainSmoothCoeff = Math.exp(-1 / (sampleRate * cfg.gainSmoothTime));
    const peakHoldSamples = Math.round(sampleRate * PEAK_HOLD_S);

    // Pre-cache channel data arrays (avoids getChannelData() per sample)
    const srcData: Float32Array[] = [];
    for (let ch = 0; ch < numberOfChannels; ch++) {
      srcData.push(buffer.getChannelData(ch));
    }
    const chScaleInv = 1 / numberOfChannels;

    onProgress?.(15, "جاري معالجة صدى الغرفة...");

    const out = createAudioBuffer({ numberOfChannels, length, sampleRate });
    const dstData: Float32Array[] = [];
    for (let ch = 0; ch < numberOfChannels; ch++) {
      dstData.push(out.getChannelData(ch));
    }

    // ── Single-pass: gain computed from mixed-channel energy, applied uniformly
    let smoothedRmsSq  = 0;
    let peakEnv        = 0;
    let holdCounter    = 0;
    let smoothedGain   = 1.0;
    let minGain        = 1.0;

    for (let i = 0; i < length; i++) {
      // 1. Mixed-channel instantaneous squared energy
      let sumSq = 0;
      for (let ch = 0; ch < numberOfChannels; ch++) {
        const s = srcData[ch][i];
        sumSq += s * s;
      }

      // 2. Short-term RMS (IIR smoothed)
      smoothedRmsSq = rmsCoeff * smoothedRmsSq + (1 - rmsCoeff) * (sumSq * chScaleInv);
      const instantRms = Math.sqrt(smoothedRmsSq);

      // 3. Peak-hold envelope: instant attack, hold, then release
      if (instantRms >= peakEnv) {
        peakEnv     = instantRms;
        holdCounter = peakHoldSamples;
      } else if (holdCounter > 0) {
        holdCounter--;
      } else {
        peakEnv = peakRelCoeff * peakEnv + (1 - peakRelCoeff) * instantRms;
      }

      // 4. Tail gain computation from ratio
      let targetGain: number;
      if (peakEnv < 1e-9) {
        // Near-silent — nothing to de-reverb
        targetGain = 1.0;
      } else {
        const ratio = instantRms / peakEnv;
        if (ratio >= cfg.thresholdRatio) {
          targetGain = 1.0;
        } else {
          // Soft linear ramp: gainFloor (at 0) → 1.0 (at thresholdRatio)
          targetGain = cfg.gainFloor + (1 - cfg.gainFloor) * (ratio / cfg.thresholdRatio);
        }
      }

      // 5. Smooth gain and track minimum
      smoothedGain = gainSmoothCoeff * smoothedGain + (1 - gainSmoothCoeff) * targetGain;
      if (smoothedGain < minGain) minGain = smoothedGain;

      // 6. Apply uniform gain to all channels
      for (let ch = 0; ch < numberOfChannels; ch++) {
        dstData[ch][i] = srcData[ch][i] * smoothedGain;
      }
    }

    onProgress?.(90, "اكتمل تخفيف الصدى");

    const reverbTailReductionDb = minGain < 0.9999
      ? -20 * Math.log10(minGain)
      : 0;

    return { buffer: out, reverbTailReductionDb };
  }
}
