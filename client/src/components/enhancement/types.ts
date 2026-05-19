// ─── Audio Analysis ───────────────────────────────────────────────────────────

export interface AudioAnalysisReport {
  peakDb:                 number;
  rmsDb:                  number;
  estimatedNoiseFloorDb:  number;
  durationSec:            number;
  sampleRate:             number;
  numberOfChannels:       number;
  clippingDetected:       boolean;
}

// ─── Enhancement Options ──────────────────────────────────────────────────────

export interface CompressorOptions {
  enabled:      boolean;
  threshold:    number;   // dBFS  e.g. -24
  knee:         number;   // dB    e.g. 8
  ratio:        number;   //       e.g. 4
  attack:       number;   // sec   e.g. 0.005
  release:      number;   // sec   e.g. 0.15
  makeupGainDb: number;   // dB    e.g. 3
}

export interface LimiterOptions {
  enabled:    boolean;
  ceilingDb:  number;   // dBFS  e.g. -1
}

export interface HumRemovalOptions {
  enabled:     boolean;
  frequencyHz: 50 | 60;
  strength:    "light" | "medium" | "strong";
}

export interface NoiseReductionOptions {
  enabled:  boolean;
  strength: "light" | "medium" | "strong";
  // "spectral" reserved — only "broadband" is implemented in Phase D
  mode:     "broadband" | "spectral";
}

export interface DeReverbOptions {
  enabled: boolean;
  amount:  "light" | "medium";
}

export interface EnhancementOptions {
  presetId?:         string;

  // Filtering
  highPassHz:        number;   // 0 = disabled
  // EQ
  presenceBoostHz:   number;   // 0 = disabled
  presenceBoostDb:   number;
  presenceQ:         number;
  airBoostHz:        number;   // 0 = disabled
  airBoostDb:        number;
  warmthHz:          number;   // 0 = disabled
  warmthDb:          number;

  // Dynamics
  compressor:        CompressorOptions;
  limiter:           LimiterOptions;

  // Normalization
  normalize:         boolean;
  normalizeTargetDb: number;   // dBFS  e.g. -1

  // Hum removal — implemented in Phase C
  humRemoval:        HumRemovalOptions;

  // Noise reduction — implemented in Phase D
  noiseReduction:    NoiseReductionOptions;

  // De-reverb — implemented in Phase E
  deReverb:          DeReverbOptions;
}

// ─── Enhancement Result ───────────────────────────────────────────────────────

export interface EnhancementReport {
  before:                   AudioAnalysisReport;
  after:                    AudioAnalysisReport;
  presetId?:                string;
  appliedStages:            string[];
  normalizationGainDb:      number;
  limiterApplied:           boolean;
  clippingPrevented:        boolean;
  humRemovalApplied:        boolean;
  humFrequency?:            50 | 60;
  humHarmonicsProcessed?:   number[];
  noiseReductionApplied:    boolean;
  noiseReductionMode?:      "broadband" | "spectral";
  estimatedNoiseFloorDb?:   number;
  noiseThresholdDb?:        number;
  noiseFramesUsed?:         number;
  deReverbApplied:          boolean;
  deReverbAmount?:          "light" | "medium";
  reverbTailReductionDb?:   number;
}

export interface EnhancementResult {
  processedBuffer: AudioBuffer;
  report:          EnhancementReport;
}
