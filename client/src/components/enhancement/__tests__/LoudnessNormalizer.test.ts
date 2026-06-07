import { describe, it, expect, beforeAll } from "vitest";
import { patchGlobalAudioBuffer, makeAudioBuffer, peakLinear, hasInvalidSamples } from "./testHelpers";

// Patch global before importing DSP modules so new AudioBuffer() works.
beforeAll(() => { patchGlobalAudioBuffer(); });

// Dynamic import deferred to after the global is set up.
import { LoudnessNormalizer } from "../LoudnessNormalizer";

// ── LoudnessNormalizer.normalize (peak normalization) ────────────────────────

describe("LoudnessNormalizer.normalize", () => {

  it("returns a different buffer object (does not return input)", () => {
    const input = makeAudioBuffer({ fill: 0.5 });
    const { buffer } = LoudnessNormalizer.normalize(input, -1);
    expect(buffer).not.toBe(input);
  });

  it("does not mutate the input buffer", () => {
    const input = makeAudioBuffer({ fill: 0.5 });
    const snapshot = Float32Array.from(input.getChannelData(0));
    LoudnessNormalizer.normalize(input, -1);
    expect(input.getChannelData(0)).toEqual(snapshot);
  });

  it("preserves numberOfChannels, length, and sampleRate", () => {
    const input = makeAudioBuffer({ numberOfChannels: 2, length: 512, sampleRate: 48000 });
    const { buffer } = LoudnessNormalizer.normalize(input, -1);
    expect(buffer.numberOfChannels).toBe(2);
    expect(buffer.length).toBe(512);
    expect(buffer.sampleRate).toBe(48000);
  });

  it("peak-normalizes a signal to within 0.01 dB of the target", () => {
    const input = makeAudioBuffer({ length: 2048, fill: 0.3 });
    const TARGET_DB = -1;
    const { buffer } = LoudnessNormalizer.normalize(input, TARGET_DB);
    const peak = peakLinear(buffer);
    const targetLinear = Math.pow(10, TARGET_DB / 20);
    expect(peak).toBeCloseTo(targetLinear, 3);
  });

  it("never lets peak exceed 1.0 (no clipping)", () => {
    const input = makeAudioBuffer({ fill: 0.9 });
    const { buffer } = LoudnessNormalizer.normalize(input, 0); // request 0 dBFS
    expect(peakLinear(buffer)).toBeLessThanOrEqual(1.0);
  });

  it("applies positive gain when signal is below target", () => {
    const input = makeAudioBuffer({ fill: 0.1 });
    const { gainAppliedDb } = LoudnessNormalizer.normalize(input, -1);
    expect(gainAppliedDb).toBeGreaterThan(0);
  });

  it("applies negative gain when signal is above target", () => {
    const input = makeAudioBuffer({ fill: 0.99 });
    const { gainAppliedDb } = LoudnessNormalizer.normalize(input, -6);
    expect(gainAppliedDb).toBeLessThan(0);
  });

  it("produces no NaN or Infinity for a normal signal", () => {
    const input = makeAudioBuffer({ fill: 0.5 });
    const { buffer } = LoudnessNormalizer.normalize(input, -1);
    expect(hasInvalidSamples(buffer)).toBe(false);
  });

  it("handles silent buffer without NaN — returns gainAppliedDb = 0", () => {
    const input = makeAudioBuffer({ fill: 0 });
    const { buffer, gainAppliedDb } = LoudnessNormalizer.normalize(input, -1);
    expect(gainAppliedDb).toBe(0);
    expect(hasInvalidSamples(buffer)).toBe(false);
  });

  it("silence in → silence out (samples remain zero)", () => {
    const input = makeAudioBuffer({ fill: 0 });
    const { buffer } = LoudnessNormalizer.normalize(input, -1);
    expect(peakLinear(buffer)).toBe(0);
  });

  it("stereo: peak measured across both channels and both gain-adjusted", () => {
    const input = makeAudioBuffer({ numberOfChannels: 2, length: 1024, fill: (i, ch) => ch === 0 ? 0.8 : 0.3 });
    const { buffer } = LoudnessNormalizer.normalize(input, -1);
    const ch0peak = Math.max(...buffer.getChannelData(0).map(Math.abs));
    const ch1peak = Math.max(...buffer.getChannelData(1).map(Math.abs));
    // ch0 had 0.8 (the global peak) → should be close to -1 dBFS target
    expect(ch0peak).toBeCloseTo(Math.pow(10, -1 / 20), 3);
    // ch1 gain should be the same factor applied to 0.3
    expect(ch1peak).toBeCloseTo(0.3 * (Math.pow(10, -1 / 20) / 0.8), 3);
  });

});
