import { describe, it, expect, beforeAll } from "vitest";
import { patchGlobalAudioBuffer } from "./testHelpers";

beforeAll(() => { patchGlobalAudioBuffer(); });

import { selectAdaptiveNotchFreqs } from "../AudioEnhancementEngine";
import type { ArtifactDiagnostics } from "../types";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeDiagnostics(
  resonanceLikelihood: ArtifactDiagnostics["resonanceLikelihood"],
  dominantGapFrequenciesHz: number[] = [],
): ArtifactDiagnostics {
  return {
    speechToGapRmsRatioDb:      8,
    gapSpectralFlatness:        0.10,
    dominantGapFrequenciesHz,
    envelopeModulationDepthDb:  0,
    nearSaturationRatio:        0,
    codecFrameCorrelationScore: 0,
    reverbTailLikelihood:       "none",
    resonanceLikelihood,
    pumpingLikelihood:          "none",
    saturationLikelihood:       "none",
    codecArtifactLikelihood:    "none",
    dominantArtifactType:       "pa_resonance",
  };
}

// ── 1. Resonance likelihood gating ───────────────────────────────────────────

describe("selectAdaptiveNotchFreqs — resonance gating", () => {
  it("returns [] when resonanceLikelihood is none", () => {
    expect(selectAdaptiveNotchFreqs(makeDiagnostics("none", [440, 880]))).toEqual([]);
  });

  it("returns [] when resonanceLikelihood is low", () => {
    expect(selectAdaptiveNotchFreqs(makeDiagnostics("low", [440, 880]))).toEqual([]);
  });

  it("returns freqs when resonanceLikelihood is medium", () => {
    expect(selectAdaptiveNotchFreqs(makeDiagnostics("medium", [440]))).toEqual([440]);
  });

  it("returns freqs when resonanceLikelihood is high", () => {
    const result = selectAdaptiveNotchFreqs(makeDiagnostics("high", [200, 400]));
    expect(result).toContain(200);
    expect(result).toContain(400);
  });
});

// ── 2. Frequency range filter [100, 4000] Hz ─────────────────────────────────

describe("selectAdaptiveNotchFreqs — frequency range filter", () => {
  it("excludes frequencies below 100 Hz", () => {
    const result = selectAdaptiveNotchFreqs(makeDiagnostics("high", [50, 440]));
    expect(result).not.toContain(50);
    expect(result).toContain(440);
  });

  it("excludes frequencies above 4000 Hz", () => {
    const result = selectAdaptiveNotchFreqs(makeDiagnostics("high", [440, 5000]));
    expect(result).not.toContain(5000);
    expect(result).toContain(440);
  });

  it("accepts 100 Hz (inclusive lower bound)", () => {
    expect(selectAdaptiveNotchFreqs(makeDiagnostics("high", [100]))).toEqual([100]);
  });

  it("accepts 4000 Hz (inclusive upper bound)", () => {
    expect(selectAdaptiveNotchFreqs(makeDiagnostics("high", [4000]))).toEqual([4000]);
  });

  it("returns [] when all freqs fall outside [100, 4000] Hz", () => {
    const result = selectAdaptiveNotchFreqs(makeDiagnostics("high", [50, 60, 70]));
    expect(result).toEqual([]);
  });
});

// ── 3. Cap at 3 frequencies ───────────────────────────────────────────────────

describe("selectAdaptiveNotchFreqs — cap at 3", () => {
  it("returns at most 3 frequencies when more are provided", () => {
    const result = selectAdaptiveNotchFreqs(
      makeDiagnostics("high", [200, 400, 800, 1600, 3200]),
    );
    expect(result.length).toBeLessThanOrEqual(3);
  });

  it("takes the first 3 in input order (sorted by FFT power descending)", () => {
    const result = selectAdaptiveNotchFreqs(
      makeDiagnostics("high", [200, 400, 800, 1600]),
    );
    expect(result).toEqual([200, 400, 800]);
  });
});

// ── 4. Deduplication within 50 Hz ────────────────────────────────────────────

describe("selectAdaptiveNotchFreqs — 50 Hz deduplication", () => {
  it("skips a frequency within 50 Hz of an already-accepted one", () => {
    const result = selectAdaptiveNotchFreqs(makeDiagnostics("high", [440, 460]));
    expect(result).toEqual([440]);
  });

  it("keeps both frequencies when they are exactly 50 Hz apart", () => {
    const result = selectAdaptiveNotchFreqs(makeDiagnostics("high", [440, 490]));
    expect(result).toContain(440);
    expect(result).toContain(490);
  });

  it("keeps both when gap is > 50 Hz", () => {
    const result = selectAdaptiveNotchFreqs(makeDiagnostics("high", [440, 500]));
    expect(result).toContain(440);
    expect(result).toContain(500);
  });
});

// ── 5. Edge cases ─────────────────────────────────────────────────────────────

describe("selectAdaptiveNotchFreqs — edge cases", () => {
  it("returns [] when dominantGapFrequenciesHz is empty even with high resonance", () => {
    expect(selectAdaptiveNotchFreqs(makeDiagnostics("high", []))).toEqual([]);
  });

  it("returns [] when resonanceLikelihood is none and freqs is empty", () => {
    expect(selectAdaptiveNotchFreqs(makeDiagnostics("none", []))).toEqual([]);
  });

  it("result array is never longer than 3", () => {
    // Large set with many distinct valid freqs
    const freqs = [110, 220, 330, 440, 550, 660, 770, 880, 990, 1100];
    const result = selectAdaptiveNotchFreqs(makeDiagnostics("high", freqs));
    expect(result.length).toBeLessThanOrEqual(3);
  });
});
