import type { ArtifactDiagnostics } from "./types";

// ── Frame analysis constants ──────────────────────────────────────────────────
const FRAME_MS             = 10;    // analysis frame size
const GAP_PERCENTILE_LOW   = 0.10;  // p10 frame RMS → "quiet" representative
const GAP_PERCENTILE_HIGH  = 0.90;  // p90 frame RMS → "loud" representative
const GAP_SPECTRAL_PCTILE  = 0.25;  // bottom 25th percentile → spectral gap analysis
const GAP_MAX_SEC          = 5;     // limit FFT input to first 5 s of quiet material

// ── Onset / pump detection ────────────────────────────────────────────────────
const ONSET_RISE_DB        = 12;    // RMS must rise ≥ 12 dB in one frame → onset
const PUMP_SKIP_FRAMES     = 5;     // skip first 50 ms post-onset (direct attack)
const PUMP_MEASURE_FRAMES  = 25;    // measure next 250 ms (frames 5–30 after onset)
const PUMP_MIN_ONSETS      = 3;     // require ≥ 3 onsets to compute modulation depth

// ── Near-saturation ───────────────────────────────────────────────────────────
const NEAR_SAT_AMP         = 0.90;  // amplitude threshold

// ── Spectral analysis (FFT) ───────────────────────────────────────────────────
const FFT_N                = 1024;  // window size — must be power of 2
const FFT_MAX_WINS         = 20;    // cap FFT windows for bounded runtime
const FFT_PEAK_MAX_HZ      = 4000;  // resonance search upper limit
const FFT_TOP_PEAKS        = 3;     // number of peak frequencies to report

// ── Codec correlation ─────────────────────────────────────────────────────────
// Frame-RMS autocorrelation lags in frames (1 frame = 10 ms).
// Lags 2–3 correspond to 20–30 ms codec frame durations.
const CODEC_LAGS           = [2, 3] as const;

// ── Classification thresholds ─────────────────────────────────────────────────
const SPEECH_GAP_CLEAN_DB    = 20;   // > 20 dB → clean dynamics
const SPEECH_GAP_PARTIAL_DB  = 10;   // 10–20 dB → partial artifact
const FLATNESS_TONAL         = 0.30; // < 0.30 → tonal/resonant → PA ringing
const FLATNESS_BROADBAND     = 0.60; // > 0.60 → broadband (noise or reverb)
const PUMP_MEDIUM_DB         = 3.0;  // > 3 dB → moderate pump
const PUMP_HIGH_DB           = 6.0;  // > 6 dB → strong pump
const NEAR_SAT_MEDIUM        = 0.01; // > 1 % → possible overload
const NEAR_SAT_HIGH          = 0.04; // > 4 % → likely distortion
const CODEC_SCORE_FLAG       = 0.35; // above this → "low" codec likelihood
// Below this dynamic range the signal is effectively constant (no real gaps)
const MIN_DYNAMIC_RANGE_DB   = 2.0;

type Likelihood = "none" | "low" | "medium" | "high";

// ── Internal: radix-2 Cooley-Tukey FFT (in-place, power-of-2 length) ─────────

function runFFT(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len;
    const wr0 = Math.cos(ang);
    const wi0 = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let wr = 1, wi = 0;
      const half = len >> 1;
      for (let j = 0; j < half; j++) {
        const ur = re[i + j],         ui = im[i + j];
        const vr = re[i+j+half]*wr - im[i+j+half]*wi;
        const vi = re[i+j+half]*wi + im[i+j+half]*wr;
        re[i + j]     = ur + vr;   im[i + j]     = ui + vi;
        re[i+j+half]  = ur - vr;   im[i+j+half]  = ui - vi;
        const nwr = wr*wr0 - wi*wi0;
        wi = wr*wi0 + wi*wr0;
        wr = nwr;
      }
    }
  }
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function computeSpectralFeatures(
  mono: Float64Array,
  isQuiet: Uint8Array,
  frameSize: number,
  numFrames: number,
  sampleRate: number,
): { flatness: number; dominantFreqs: number[] } {
  // Collect quiet-frame samples up to GAP_MAX_SEC seconds
  const maxSamples = Math.round(GAP_MAX_SEC * sampleRate);
  const buf: number[] = [];
  for (let f = 0; f < numFrames && buf.length < maxSamples; f++) {
    if (!isQuiet[f]) continue;
    const base = f * frameSize;
    for (let i = 0; i < frameSize && buf.length < maxSamples; i++) {
      buf.push(mono[base + i]);
    }
  }

  if (buf.length < FFT_N) return { flatness: 1.0, dominantFreqs: [] };

  const half = FFT_N >> 1;
  const avgPower = new Float64Array(half);
  const re = new Float64Array(FFT_N);
  const im = new Float64Array(FFT_N);
  let wins = 0;

  for (let start = 0; start + FFT_N <= buf.length && wins < FFT_MAX_WINS; start += half) {
    re.fill(0); im.fill(0);
    for (let i = 0; i < FFT_N; i++) {
      const w = 0.5 * (1 - Math.cos(2 * Math.PI * i / (FFT_N - 1)));  // Hann
      re[i] = buf[start + i] * w;
    }
    runFFT(re, im);
    for (let k = 0; k < half; k++) avgPower[k] += re[k]*re[k] + im[k]*im[k];
    wins++;
  }

  if (wins === 0) return { flatness: 1.0, dominantFreqs: [] };
  for (let k = 0; k < half; k++) avgPower[k] /= wins;

  // Spectral flatness = geometric mean / arithmetic mean (skip DC bin 0)
  const M = half - 1;
  let logSum = 0, linSum = 0;
  for (let k = 1; k <= M; k++) {
    const p = Math.max(avgPower[k], 1e-30);
    logSum += Math.log(p);
    linSum += p;
  }
  const geo   = Math.exp(logSum / M);
  const arith = linSum / M;
  const flatness = arith > 0 ? Math.min(1, geo / arith) : 1.0;

  // Dominant peak frequencies when signal is tonal
  const dominantFreqs: number[] = [];
  if (flatness < FLATNESS_TONAL) {
    const peakBinLimit = Math.min(
      Math.floor(FFT_PEAK_MAX_HZ * FFT_N / sampleRate),
      half - 2,
    );
    const peaks: { bin: number; power: number }[] = [];
    for (let k = 2; k <= peakBinLimit; k++) {
      if (avgPower[k] > avgPower[k-1] && avgPower[k] > avgPower[k+1]) {
        peaks.push({ bin: k, power: avgPower[k] });
      }
    }
    peaks.sort((a, b) => b.power - a.power);
    for (let p = 0; p < Math.min(FFT_TOP_PEAKS, peaks.length); p++) {
      dominantFreqs.push(Math.round(peaks[p].bin * sampleRate / FFT_N));
    }
  }

  return { flatness, dominantFreqs };
}

function computeEnvelopeModulation(frameRms: Float64Array, numFrames: number): number {
  const minFrames = PUMP_SKIP_FRAMES + PUMP_MEASURE_FRAMES + 2;
  if (numFrames < minFrames) return 0;

  const onsetRatio = Math.pow(10, ONSET_RISE_DB / 20);
  const onsets: number[] = [];
  for (let f = 1; f < numFrames; f++) {
    if (frameRms[f-1] > 1e-9 && frameRms[f] >= frameRms[f-1] * onsetRatio) {
      onsets.push(f);
    }
  }
  if (onsets.length < PUMP_MIN_ONSETS) return 0;

  const stdDevs: number[] = [];
  for (const onset of onsets) {
    const winStart = onset + PUMP_SKIP_FRAMES;
    const winEnd   = winStart + PUMP_MEASURE_FRAMES;
    if (winEnd > numFrames) continue;

    const dbVals: number[] = [];
    for (let f = winStart; f < winEnd; f++) {
      dbVals.push(20 * Math.log10(Math.max(frameRms[f], 1e-9)));
    }
    const mean = dbVals.reduce((s, v) => s + v, 0) / dbVals.length;
    const variance = dbVals.reduce((s, v) => s + (v - mean) ** 2, 0) / dbVals.length;
    stdDevs.push(Math.sqrt(variance));
  }

  if (stdDevs.length < PUMP_MIN_ONSETS) return 0;
  return stdDevs.reduce((s, v) => s + v, 0) / stdDevs.length;
}

function computeCodecCorrelation(frameRms: Float64Array, numFrames: number): number {
  if (numFrames < 10) return 0;

  let mean = 0;
  for (let f = 0; f < numFrames; f++) mean += frameRms[f];
  mean /= numFrames;

  let variance = 0;
  for (let f = 0; f < numFrames; f++) variance += (frameRms[f] - mean) ** 2;
  variance /= numFrames;
  if (variance < 1e-12) return 0;

  let maxCorr = 0;
  for (const lag of CODEC_LAGS) {
    let sum = 0;
    for (let f = 0; f < numFrames - lag; f++) {
      sum += (frameRms[f] - mean) * (frameRms[f + lag] - mean);
    }
    const corr = Math.abs(sum / (numFrames * variance));
    if (corr > maxCorr) maxCorr = corr;
  }
  return Math.min(1, maxCorr);
}

function classifyReverbTail(ratioDB: number, flatness: number, hasQuiet: boolean): Likelihood {
  if (!hasQuiet || ratioDB < MIN_DYNAMIC_RANGE_DB) return "none";
  if (ratioDB < SPEECH_GAP_PARTIAL_DB && flatness >= FLATNESS_BROADBAND) return "high";
  if (ratioDB < SPEECH_GAP_CLEAN_DB   && flatness >= FLATNESS_BROADBAND) return "medium";
  if (ratioDB < SPEECH_GAP_PARTIAL_DB) return "low";
  return "none";
}

function classifyResonance(ratioDB: number, flatness: number, hasQuiet: boolean): Likelihood {
  if (!hasQuiet || ratioDB < MIN_DYNAMIC_RANGE_DB) return "none";
  if (ratioDB < SPEECH_GAP_PARTIAL_DB && flatness < FLATNESS_TONAL) return "high";
  if (ratioDB < SPEECH_GAP_CLEAN_DB   && flatness < FLATNESS_TONAL) return "medium";
  if (flatness < FLATNESS_TONAL) return "low";
  return "none";
}

function classifyPumping(modulationDb: number): Likelihood {
  if (modulationDb >= PUMP_HIGH_DB)  return "high";
  if (modulationDb >= PUMP_MEDIUM_DB) return "medium";
  if (modulationDb > 0) return "low";
  return "none";
}

function classifySaturation(ratio: number): Likelihood {
  if (ratio >= NEAR_SAT_HIGH)   return "high";
  if (ratio >= NEAR_SAT_MEDIUM) return "medium";
  if (ratio > 0) return "low";
  return "none";
}

function determineDominant(
  reverb:  Likelihood,
  resonance: Likelihood,
  pumping: Likelihood,
  saturation: Likelihood,
  codec: "none" | "low",
  ratioDB: number,
  flatness: number,
  hasQuiet: boolean,
): ArtifactDiagnostics["dominantArtifactType"] {
  const highCount = [reverb, resonance, pumping, saturation].filter(l => l === "high").length;
  if (highCount > 1) return "mixed";

  // Priority order: saturation → pumping → resonance → reverb → broadband → codec → clean
  if (saturation  === "high")   return "mic_saturation";
  if (pumping     === "high")   return "pa_limiter_pump";
  if (resonance   === "high")   return "pa_resonance";
  if (reverb      === "high")   return "reverb_tail";

  if (saturation  === "medium") return "mic_saturation";
  if (pumping     === "medium") return "pa_limiter_pump";
  if (resonance   === "medium") return "pa_resonance";
  if (reverb      === "medium") return "reverb_tail";

  // Broadband noise: quiet sections present and spectrally flat
  if (hasQuiet && ratioDB < SPEECH_GAP_CLEAN_DB && flatness >= FLATNESS_BROADBAND) {
    return "broadband_noise";
  }

  // Codec: last resort, and only when there is meaningful dynamic variation
  if (codec === "low" && ratioDB >= MIN_DYNAMIC_RANGE_DB) return "codec_artifact";

  return "clean";
}

// ── Public API ────────────────────────────────────────────────────────────────

export class ArtifactDiagnosticsAnalyzer {

  /**
   * Analyze the input buffer for acoustic artifact characteristics.
   * Pure read-only: never modifies any AudioBuffer channel data.
   * Safe for any buffer length, sample rate, or channel count.
   */
  static analyze(buffer: AudioBuffer): ArtifactDiagnostics {
    const { sampleRate, length, numberOfChannels } = buffer;
    const frameSize = Math.max(1, Math.round(sampleRate * FRAME_MS / 1000));
    const numFrames = Math.floor(length / frameSize);

    // Guard: too short to analyze
    if (numFrames < 4) {
      return ArtifactDiagnosticsAnalyzer._safeDefault();
    }

    // ── 1. Mix all channels to a read-only mono copy ──────────────────────────
    const mono = new Float64Array(numFrames * frameSize);
    for (let ch = 0; ch < numberOfChannels; ch++) {
      const src = buffer.getChannelData(ch);
      for (let i = 0; i < mono.length; i++) mono[i] += src[i];
    }
    if (numberOfChannels > 1) {
      const inv = 1 / numberOfChannels;
      for (let i = 0; i < mono.length; i++) mono[i] *= inv;
    }

    // ── 2. Per-frame RMS ──────────────────────────────────────────────────────
    const frameRms = new Float64Array(numFrames);
    for (let f = 0; f < numFrames; f++) {
      const base = f * frameSize;
      let sum = 0;
      for (let i = 0; i < frameSize; i++) sum += mono[base + i] ** 2;
      frameRms[f] = Math.sqrt(sum / frameSize);
    }

    // ── 3. Percentile-based dynamic range ─────────────────────────────────────
    const sorted = Float64Array.from(frameRms).sort();
    const p10 = sorted[Math.max(0, Math.floor(GAP_PERCENTILE_LOW  * numFrames))];
    const p90 = sorted[Math.min(numFrames - 1, Math.floor(GAP_PERCENTILE_HIGH * numFrames))];

    // Use first p10 value > 1e-9 to skip true-silence frames
    let effectiveP10 = p10;
    if (effectiveP10 < 1e-9) {
      for (let i = 0; i < sorted.length; i++) {
        if (sorted[i] > 1e-9) { effectiveP10 = sorted[i]; break; }
      }
    }

    const speechToGapRmsRatioDb = (effectiveP10 > 1e-9 && p90 > effectiveP10)
      ? Math.min(60, 20 * Math.log10(p90 / effectiveP10))
      : 0;

    // ── 4. Bottom-25th-percentile frames → spectral gap analysis ──────────────
    const p25 = sorted[Math.max(0, Math.floor(GAP_SPECTRAL_PCTILE * numFrames))];
    const isQuiet = new Uint8Array(numFrames);
    let quietCount = 0;
    for (let f = 0; f < numFrames; f++) {
      if (frameRms[f] <= p25 && frameRms[f] > 1e-9) {
        isQuiet[f] = 1;
        quietCount++;
      }
    }

    const { flatness: gapSpectralFlatness, dominantFreqs: dominantGapFrequenciesHz } =
      quietCount > 0
        ? computeSpectralFeatures(mono, isQuiet, frameSize, numFrames, sampleRate)
        : { flatness: 1.0, dominantFreqs: [] };

    // ── 5. Envelope modulation (pump detection) ───────────────────────────────
    const envelopeModulationDepthDb = computeEnvelopeModulation(frameRms, numFrames);

    // ── 6. Near-saturation ────────────────────────────────────────────────────
    let satCount = 0;
    for (let i = 0; i < mono.length; i++) {
      if (Math.abs(mono[i]) > NEAR_SAT_AMP) satCount++;
    }
    const nearSaturationRatio = mono.length > 0 ? satCount / mono.length : 0;

    // ── 7. Codec frame correlation ────────────────────────────────────────────
    const codecFrameCorrelationScore = computeCodecCorrelation(frameRms, numFrames);

    // ── 8. Likelihood labels ──────────────────────────────────────────────────
    const hasQuiet = quietCount > 0;
    const reverbTailLikelihood  = classifyReverbTail(speechToGapRmsRatioDb, gapSpectralFlatness, hasQuiet);
    const resonanceLikelihood   = classifyResonance(speechToGapRmsRatioDb, gapSpectralFlatness, hasQuiet);
    const pumpingLikelihood     = classifyPumping(envelopeModulationDepthDb);
    const saturationLikelihood  = classifySaturation(nearSaturationRatio);
    const codecArtifactLikelihood: "none" | "low" =
      codecFrameCorrelationScore >= CODEC_SCORE_FLAG ? "low" : "none";

    // ── 9. Dominant artifact type ─────────────────────────────────────────────
    const dominantArtifactType = determineDominant(
      reverbTailLikelihood, resonanceLikelihood,
      pumpingLikelihood, saturationLikelihood,
      codecArtifactLikelihood,
      speechToGapRmsRatioDb, gapSpectralFlatness, hasQuiet,
    );

    return {
      speechToGapRmsRatioDb,
      gapSpectralFlatness,
      dominantGapFrequenciesHz,
      envelopeModulationDepthDb,
      nearSaturationRatio,
      codecFrameCorrelationScore,
      reverbTailLikelihood,
      resonanceLikelihood,
      pumpingLikelihood,
      saturationLikelihood,
      codecArtifactLikelihood,
      dominantArtifactType,
    };
  }

  private static _safeDefault(): ArtifactDiagnostics {
    return {
      speechToGapRmsRatioDb:      0,
      gapSpectralFlatness:        1.0,
      dominantGapFrequenciesHz:   [],
      envelopeModulationDepthDb:  0,
      nearSaturationRatio:        0,
      codecFrameCorrelationScore: 0,
      reverbTailLikelihood:       "none",
      resonanceLikelihood:        "none",
      pumpingLikelihood:          "none",
      saturationLikelihood:       "none",
      codecArtifactLikelihood:    "none",
      dominantArtifactType:       "clean",
    };
  }
}
