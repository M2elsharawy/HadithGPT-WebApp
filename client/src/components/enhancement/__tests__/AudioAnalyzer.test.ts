import { describe, it, expect, beforeAll } from "vitest";
import { patchGlobalAudioBuffer, makeAudioBuffer, channelDataUnchanged } from "./testHelpers";

beforeAll(() => { patchGlobalAudioBuffer(); });

import { AudioAnalyzer }        from "../AudioAnalyzer";
import { NoiseProfileAnalyzer } from "../NoiseProfileAnalyzer";

// ── AudioAnalyzer.analyze ────────────────────────────────────────────────────

describe("AudioAnalyzer.analyze", () => {

  it("reports correct sampleRate", () => {
    const buf = makeAudioBuffer({ sampleRate: 48000, length: 4800 });
    expect(AudioAnalyzer.analyze(buf).sampleRate).toBe(48000);
  });

  it("reports correct numberOfChannels", () => {
    const buf = makeAudioBuffer({ numberOfChannels: 2, length: 1024 });
    expect(AudioAnalyzer.analyze(buf).numberOfChannels).toBe(2);
  });

  it("reports correct duration (length / sampleRate)", () => {
    const buf = makeAudioBuffer({ numberOfChannels: 1, length: 44100, sampleRate: 44100 });
    expect(AudioAnalyzer.analyze(buf).durationSec).toBeCloseTo(1.0, 4);
  });

  it("does not mutate the input buffer", () => {
    const buf = makeAudioBuffer({ fill: 0.4 });
    const snapshot = Float32Array.from(buf.getChannelData(0));
    AudioAnalyzer.analyze(buf);
    expect(buf.getChannelData(0)).toEqual(snapshot);
  });

  it("silent buffer — peakDb and rmsDb are -Infinity", () => {
    const buf = makeAudioBuffer({ fill: 0 });
    const report = AudioAnalyzer.analyze(buf);
    expect(report.peakDb).toBe(-Infinity);
    expect(report.rmsDb).toBe(-Infinity);
  });

  it("silent buffer — clippingDetected is false", () => {
    const buf = makeAudioBuffer({ fill: 0 });
    expect(AudioAnalyzer.analyze(buf).clippingDetected).toBe(false);
  });

  it("detects clipping at ≥ 0.9999 threshold", () => {
    // Float32Array stores 0.9999 as slightly less than 0.9999 in 32-bit.
    // Use 1.0 which is exactly representable and clearly >= threshold.
    const buf = makeAudioBuffer({ length: 1024, fill: (i) => i === 500 ? 1.0 : 0.1 });
    expect(AudioAnalyzer.analyze(buf).clippingDetected).toBe(true);
  });

  it("does not flag clipping for signal just below threshold (0.9998)", () => {
    const buf = makeAudioBuffer({ fill: 0.9998 });
    expect(AudioAnalyzer.analyze(buf).clippingDetected).toBe(false);
  });

  it("peakDb matches expected value for a known constant signal", () => {
    // All samples = 0.5 → peak = 0.5 → -6.02 dBFS
    const buf = makeAudioBuffer({ fill: 0.5 });
    const report = AudioAnalyzer.analyze(buf);
    expect(report.peakDb).toBeCloseTo(-6.021, 1);
  });

  it("rmsDb equals peakDb for a DC signal (all samples same value)", () => {
    const buf = makeAudioBuffer({ fill: 0.5 });
    const report = AudioAnalyzer.analyze(buf);
    expect(report.rmsDb).toBeCloseTo(report.peakDb, 1);
  });

  it("peakDb is found across all channels in stereo", () => {
    // ch0 = 0.2, ch1 = 0.8 → peak should be from ch1 = 0.8 → -1.94 dBFS
    const buf = makeAudioBuffer({
      numberOfChannels: 2,
      length: 512,
      fill: (_, ch) => ch === 0 ? 0.2 : 0.8,
    });
    const report = AudioAnalyzer.analyze(buf);
    expect(report.peakDb).toBeCloseTo(20 * Math.log10(0.8), 1);
  });

  it("peakDb and rmsDb are finite for a normal signal", () => {
    const buf = makeAudioBuffer({ fill: 0.3 });
    const report = AudioAnalyzer.analyze(buf);
    expect(Number.isFinite(report.peakDb)).toBe(true);
    expect(Number.isFinite(report.rmsDb)).toBe(true);
  });

  it("estimatedNoiseFloorDb is finite for a non-silent signal", () => {
    const buf = makeAudioBuffer({ length: 44100, fill: 0.2 });
    const report = AudioAnalyzer.analyze(buf);
    expect(Number.isFinite(report.estimatedNoiseFloorDb)).toBe(true);
  });

  it("estimatedNoiseFloorDb ≤ peakDb for any signal", () => {
    const buf = makeAudioBuffer({ length: 44100, fill: (i) => Math.sin(i * 0.01) * 0.5 });
    const report = AudioAnalyzer.analyze(buf);
    expect(report.estimatedNoiseFloorDb).toBeLessThanOrEqual(report.peakDb + 0.01);
  });

  it("handles single-sample buffer without crashing", () => {
    const buf = makeAudioBuffer({ length: 1, fill: 0.5 });
    expect(() => AudioAnalyzer.analyze(buf)).not.toThrow();
  });

});

// ── PR#3 — Unified noise floor + SNR metric ───────────────────────────────────

describe("PR#3 — Unified noise floor + SNR metric", () => {

  const SR  = 44100;
  const LEN = 44100; // 1 s — enough frames for NoiseProfileAnalyzer

  // Mixed signal: loud first half, quiet second half — exercises the percentile logic
  function makeMixedBuf(): AudioBuffer {
    return makeAudioBuffer({
      length: LEN, sampleRate: SR,
      fill: (i) => {
        const amp = i < LEN / 2 ? 0.3 : 0.005;
        return Math.sin(2 * Math.PI * 440 * i / SR) * amp;
      },
    });
  }

  it("estimatedNoiseFloorDb matches NoiseProfileAnalyzer.noiseFloorDb exactly", () => {
    const buf     = makeMixedBuf();
    const report  = AudioAnalyzer.analyze(buf);
    const profile = NoiseProfileAnalyzer.analyze(buf);
    expect(report.estimatedNoiseFloorDb).toBe(profile.noiseFloorDb);
  });

  it("snrDb equals rmsDb − estimatedNoiseFloorDb within 1e-9", () => {
    const buf    = makeMixedBuf();
    const report = AudioAnalyzer.analyze(buf);
    const expected = report.rmsDb - report.estimatedNoiseFloorDb;
    expect(Math.abs(report.snrDb - expected)).toBeLessThan(1e-9);
  });

  it("peakDb regression — constant 0.5 signal still reads ≈ −6.02 dBFS", () => {
    const buf = makeAudioBuffer({ length: LEN, sampleRate: SR, fill: 0.5 });
    expect(AudioAnalyzer.analyze(buf).peakDb).toBeCloseTo(-6.021, 1);
  });

  it("rmsDb regression — DC 0.5 signal rmsDb equals peakDb", () => {
    const buf    = makeAudioBuffer({ length: LEN, sampleRate: SR, fill: 0.5 });
    const report = AudioAnalyzer.analyze(buf);
    expect(report.rmsDb).toBeCloseTo(report.peakDb, 4);
  });

  it("clippingDetected regression — 1.0 sample flags clipping", () => {
    const buf = makeAudioBuffer({
      length: LEN, sampleRate: SR,
      fill: (i) => i === 100 ? 1.0 : 0.1,
    });
    expect(AudioAnalyzer.analyze(buf).clippingDetected).toBe(true);
  });

  it("durationSec, sampleRate, numberOfChannels are unchanged by PR#3", () => {
    const buf    = makeAudioBuffer({ numberOfChannels: 2, length: LEN, sampleRate: SR });
    const report = AudioAnalyzer.analyze(buf);
    expect(report.durationSec).toBeCloseTo(1.0, 4);
    expect(report.sampleRate).toBe(SR);
    expect(report.numberOfChannels).toBe(2);
  });

  it("no NaN or Infinity in any report field for a non-silent signal", () => {
    const buf    = makeMixedBuf();
    const report = AudioAnalyzer.analyze(buf);
    const fields: (keyof typeof report)[] = [
      "peakDb", "rmsDb", "estimatedNoiseFloorDb", "snrDb", "durationSec",
    ];
    for (const f of fields) {
      const v = report[f] as number;
      expect(Number.isNaN(v)).toBe(false);
      expect(v).not.toBe(Infinity);
    }
  });

});
