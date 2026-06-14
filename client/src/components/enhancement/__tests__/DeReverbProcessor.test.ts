import { describe, it, expect, beforeAll } from "vitest";
import { patchGlobalAudioBuffer, makeAudioBuffer, hasInvalidSamples } from "./testHelpers";

beforeAll(() => { patchGlobalAudioBuffer(); });

import { DeReverbProcessor } from "../DeReverbProcessor";

// ── Helpers ───────────────────────────────────────────────────────────────────

const SR  = 44100;
const SEC = SR;  // samples per second

/** RMS over a sample range on channel 0. */
function rmsRange(buf: AudioBuffer, startSample: number, endSample: number): number {
  const data = buf.getChannelData(0);
  let sum = 0;
  for (let i = startSample; i < endSample; i++) sum += data[i] * data[i];
  return Math.sqrt(sum / (endSample - startSample));
}

/**
 * Synthetic speech+tail buffer:
 *   - speechSec seconds of full-amplitude sine (speech-level)
 *   - tailSec   seconds of low-amplitude sine (reverb tail)
 *
 * The tail amplitude is set so the ratio (tail/speech) falls well below the
 * `strong` thresholdRatio (0.45) but also below `medium` (0.28), ensuring
 * both configs produce measurable attenuation while strong is always stronger.
 */
function makeSpeechPlusTail(
  speechSec = 0.3,
  tailSec   = 0.7,
  speechAmp = 0.60,
  tailAmp   = 0.05,  // 8.3% of speech — clearly below both thresholds
): AudioBuffer {
  const speechLen = Math.round(speechSec * SR);
  const tailLen   = Math.round(tailSec   * SR);
  return makeAudioBuffer({
    length: speechLen + tailLen,
    sampleRate: SR,
    fill: (i) => {
      const amp = i < speechLen ? speechAmp : tailAmp;
      return Math.sin(2 * Math.PI * 440 * i / SR) * amp;
    },
  });
}

// ── Disabled: returns a clone, not the original ───────────────────────────────

describe("DeReverbProcessor — disabled", () => {
  it("returns a new buffer object when disabled", async () => {
    const input = makeSpeechPlusTail();
    const { buffer } = await DeReverbProcessor.process(input, { enabled: false, amount: "light" });
    expect(buffer).not.toBe(input);
  });

  it("disabled output is sample-identical to input on channel 0", async () => {
    const input = makeSpeechPlusTail();
    const { buffer } = await DeReverbProcessor.process(input, { enabled: false, amount: "medium" });
    const src = input.getChannelData(0);
    const dst = buffer.getChannelData(0);
    for (let i = 0; i < src.length; i++) {
      expect(dst[i]).toBe(src[i]);
    }
  });

  it("reverbTailReductionDb is 0 when disabled", async () => {
    const input = makeSpeechPlusTail();
    const { reverbTailReductionDb } = await DeReverbProcessor.process(input, { enabled: false, amount: "medium" });
    expect(reverbTailReductionDb).toBe(0);
  });
});

// ── light and medium: existing behaviour unchanged ────────────────────────────

describe("DeReverbProcessor — light / medium (regression)", () => {
  it("light: returns a new buffer without mutating input", async () => {
    const input  = makeSpeechPlusTail();
    const snap   = Float32Array.from(input.getChannelData(0));
    const { buffer } = await DeReverbProcessor.process(input, { enabled: true, amount: "light" });
    expect(buffer).not.toBe(input);
    expect(input.getChannelData(0)).toEqual(snap);
  });

  it("medium: returns a new buffer without mutating input", async () => {
    const input  = makeSpeechPlusTail();
    const snap   = Float32Array.from(input.getChannelData(0));
    const { buffer } = await DeReverbProcessor.process(input, { enabled: true, amount: "medium" });
    expect(buffer).not.toBe(input);
    expect(input.getChannelData(0)).toEqual(snap);
  });

  it("light: output contains no NaN or non-finite samples", async () => {
    const input = makeSpeechPlusTail();
    const { buffer } = await DeReverbProcessor.process(input, { enabled: true, amount: "light" });
    expect(hasInvalidSamples(buffer)).toBe(false);
  });

  it("medium: output contains no NaN or non-finite samples", async () => {
    const input = makeSpeechPlusTail();
    const { buffer } = await DeReverbProcessor.process(input, { enabled: true, amount: "medium" });
    expect(hasInvalidSamples(buffer)).toBe(false);
  });
});

// ── strong: new behaviour ─────────────────────────────────────────────────────

describe("DeReverbProcessor — strong", () => {

  // ── 1. Attenuates tail more than medium ──────────────────────────────────────

  it("attenuates the tail section more than medium on synthetic tail audio", async () => {
    const input = makeSpeechPlusTail(0.3, 0.7, 0.60, 0.05);
    const speechLen = Math.round(0.3 * SR);

    const [rMedium, rStrong] = await Promise.all([
      DeReverbProcessor.process(input, { enabled: true, amount: "medium" }),
      DeReverbProcessor.process(input, { enabled: true, amount: "strong" }),
    ]);

    // Compare RMS of the early tail (first 200 ms after speech, peak still elevated)
    const tailStart = speechLen;
    const tailEnd   = speechLen + Math.round(0.2 * SR);
    const rmsMedium = rmsRange(rMedium.buffer, tailStart, tailEnd);
    const rmsStrong = rmsRange(rStrong.buffer, tailStart, tailEnd);

    // strong must attenuate the tail more than medium
    expect(rmsStrong).toBeLessThan(rmsMedium);
  });

  it("strong tail RMS is at least 15% lower than medium tail RMS", async () => {
    const input = makeSpeechPlusTail(0.3, 0.7, 0.60, 0.05);
    const speechLen = Math.round(0.3 * SR);

    const [rMedium, rStrong] = await Promise.all([
      DeReverbProcessor.process(input, { enabled: true, amount: "medium" }),
      DeReverbProcessor.process(input, { enabled: true, amount: "strong" }),
    ]);

    const tailStart = speechLen;
    const tailEnd   = speechLen + Math.round(0.2 * SR);
    const rmsMedium = rmsRange(rMedium.buffer, tailStart, tailEnd);
    const rmsStrong = rmsRange(rStrong.buffer, tailStart, tailEnd);

    expect(rmsStrong).toBeLessThan(rmsMedium * 0.85);
  });

  // ── 2. Does not mutate input buffer ───────────────────────────────────────────

  it("does not mutate the input buffer", async () => {
    const input   = makeSpeechPlusTail();
    const snap    = Float32Array.from(input.getChannelData(0));
    await DeReverbProcessor.process(input, { enabled: true, amount: "strong" });
    expect(input.getChannelData(0)).toEqual(snap);
  });

  it("returns a new buffer object (not the input reference)", async () => {
    const input = makeSpeechPlusTail();
    const { buffer } = await DeReverbProcessor.process(input, { enabled: true, amount: "strong" });
    expect(buffer).not.toBe(input);
  });

  // ── 3. Preserves stereo balance ───────────────────────────────────────────────

  it("preserves stereo balance — L and R channels are processed equally", async () => {
    const stereo = makeAudioBuffer({
      numberOfChannels: 2,
      length: Math.round(1.0 * SR),
      sampleRate: SR,
      fill: (i, ch) => {
        const amp = i < Math.round(0.3 * SR) ? (ch === 0 ? 0.60 : 0.60) : (ch === 0 ? 0.05 : 0.05);
        return Math.sin(2 * Math.PI * 440 * i / SR) * amp;
      },
    });

    const { buffer } = await DeReverbProcessor.process(stereo, { enabled: true, amount: "strong" });

    const L = buffer.getChannelData(0);
    const R = buffer.getChannelData(1);

    // L and R should be equal sample-for-sample (same gain applied to both)
    for (let i = 0; i < L.length; i++) {
      expect(L[i]).toBeCloseTo(R[i], 10);
    }
  });

  // ── 4. Does not over-attenuate continuous strong speech ───────────────────────

  it("does not excessively attenuate a continuous loud signal", async () => {
    // Continuous sine at speech level — ratio stays near 1.0 → gain near 1.0
    const continuous = makeAudioBuffer({
      length: Math.round(1.0 * SR),
      sampleRate: SR,
      fill: (i) => Math.sin(2 * Math.PI * 440 * i / SR) * 0.60,
    });

    const inputRms  = rmsRange(continuous, 0, continuous.length);
    const { buffer } = await DeReverbProcessor.process(continuous, { enabled: true, amount: "strong" });
    const outputRms = rmsRange(buffer, 0, buffer.length);

    // Less than 10% RMS reduction on continuous signal (gate should stay open)
    expect(outputRms).toBeGreaterThan(inputRms * 0.90);
  });

  // ── 5. No NaN or non-finite samples ──────────────────────────────────────────

  it("output contains no NaN or non-finite samples", async () => {
    const input = makeSpeechPlusTail();
    const { buffer } = await DeReverbProcessor.process(input, { enabled: true, amount: "strong" });
    expect(hasInvalidSamples(buffer)).toBe(false);
  });

  // ── 6. reverbTailReductionDb is positive when tail is attenuated ──────────────

  it("reports positive reverbTailReductionDb when tail is attenuated", async () => {
    const input = makeSpeechPlusTail(0.3, 0.7, 0.60, 0.05);
    const { reverbTailReductionDb } = await DeReverbProcessor.process(input, { enabled: true, amount: "strong" });
    expect(reverbTailReductionDb).toBeGreaterThan(0);
  });

  // ── 7. Stronger than medium in terms of reverbTailReductionDb ────────────────

  it("reports higher reverbTailReductionDb than medium on the same input", async () => {
    const input = makeSpeechPlusTail(0.3, 0.7, 0.60, 0.05);
    const [rMedium, rStrong] = await Promise.all([
      DeReverbProcessor.process(input, { enabled: true, amount: "medium" }),
      DeReverbProcessor.process(input, { enabled: true, amount: "strong" }),
    ]);
    expect(rStrong.reverbTailReductionDb).toBeGreaterThan(rMedium.reverbTailReductionDb);
  });
});
