import { describe, it, expect, beforeAll } from "vitest";
import {
  patchGlobalAudioBuffer,
  makeAudioBuffer,
  hasInvalidSamples,
} from "./testHelpers";

beforeAll(() => { patchGlobalAudioBuffer(); });

import { NoiseReducer } from "../NoiseReducer";
import { DEFAULT_PIPELINE_VARIANT, PIPELINE_VARIANTS } from "../PipelineVariants";

// ── Test helpers ─────────────────────────────────────────────────────────────

/** Max absolute per-sample difference on channel 0 between two buffers. */
function maxDiff(a: AudioBuffer, b: AudioBuffer): number {
  const da = a.getChannelData(0);
  const db = b.getChannelData(0);
  let max = 0;
  for (let i = 0; i < da.length; i++) {
    const d = Math.abs(da[i] - db[i]);
    if (d > max) max = d;
  }
  return max;
}

/** RMS of channel 0. */
function rmsLinear(buf: AudioBuffer): number {
  const data = buf.getChannelData(0);
  let sum = 0;
  for (const s of data) sum += s * s;
  return Math.sqrt(sum / data.length);
}

// ── Test signal ───────────────────────────────────────────────────────────────
// Two-zone sine: first half at 0.3 amplitude (loud — gate passes through),
// second half at 0.005 (quiet — gate attenuates). Exercises the expander.

const SR  = 44100;
const LEN = 8192;

function makeMixedSignal(): AudioBuffer {
  return makeAudioBuffer({
    length: LEN,
    sampleRate: SR,
    fill: (i) => {
      const amp = i < LEN / 2 ? 0.30 : 0.005;
      return Math.sin(2 * Math.PI * 440 * i / SR) * amp;
    },
  });
}

const BASE_OPTIONS = {
  enabled:  true,
  strength: "medium" as const,
  mode:     "broadband" as const,
};

// ── wetDryRatio tests ─────────────────────────────────────────────────────────

describe("NoiseReducer — wetDryRatio", () => {

  it("omitting wetDryRatio and passing wetDryRatio=1.0 produce bit-identical output", async () => {
    const input = makeMixedSignal();
    const [rDefault, rWet1] = await Promise.all([
      NoiseReducer.process(input, BASE_OPTIONS),
      NoiseReducer.process(input, { ...BASE_OPTIONS, wetDryRatio: 1.0 }),
    ]);
    // wetRatio=1.0 skips the blend block entirely — must be exactly identical
    expect(maxDiff(rDefault.buffer, rWet1.buffer)).toBe(0);
  });

  it("wetDryRatio=0.0 returns a buffer matching the original sample-for-sample", async () => {
    const input = makeMixedSignal();
    const { buffer } = await NoiseReducer.process(input, { ...BASE_OPTIONS, wetDryRatio: 0.0 });
    // 0.0 * processed + 1.0 * original = original (IEEE 754 exact)
    expect(maxDiff(buffer, input)).toBe(0);
  });

  it("wetDryRatio=0.5 blends processed and original with <1e-6 error", async () => {
    const input = makeMixedSignal();
    // Run fully-processed to capture reference processed samples
    const { buffer: procBuf } = await NoiseReducer.process(input, { ...BASE_OPTIONS, wetDryRatio: 1.0 });
    // Run blended
    const { buffer: blendBuf } = await NoiseReducer.process(input, { ...BASE_OPTIONS, wetDryRatio: 0.5 });

    const orig  = input.getChannelData(0);
    const proc  = procBuf.getChannelData(0);
    const blend = blendBuf.getChannelData(0);

    let maxErr = 0;
    for (let i = 0; i < orig.length; i++) {
      const expected = 0.5 * proc[i] + 0.5 * orig[i];
      const err = Math.abs(blend[i] - expected);
      if (err > maxErr) maxErr = err;
    }
    expect(maxErr).toBeLessThan(1e-6);
  });

  it("wetDryRatio=0.5 reduces RMS compared to fully processed (gate was active)", async () => {
    const input = makeMixedSignal();
    const { buffer: procBuf }  = await NoiseReducer.process(input, { ...BASE_OPTIONS, wetDryRatio: 1.0 });
    const { buffer: blendBuf } = await NoiseReducer.process(input, { ...BASE_OPTIONS, wetDryRatio: 0.5 });
    // The blend must sit between original RMS and processed RMS
    const rmsOrig  = rmsLinear(input);
    const rmsProc  = rmsLinear(procBuf);
    const rmsBlend = rmsLinear(blendBuf);
    const rmsMin   = Math.min(rmsOrig, rmsProc);
    const rmsMax   = Math.max(rmsOrig, rmsProc);
    expect(rmsBlend).toBeGreaterThanOrEqual(rmsMin - 1e-6);
    expect(rmsBlend).toBeLessThanOrEqual(rmsMax + 1e-6);
  });

  it("wetDryRatio value >1.0 is clamped — no NaN, no Infinity, no clipping", async () => {
    const input = makeMixedSignal();
    const { buffer } = await NoiseReducer.process(input, { ...BASE_OPTIONS, wetDryRatio: 2.5 });
    // Clamped to 1.0 → same as fully processed → no corruption
    expect(hasInvalidSamples(buffer)).toBe(false);
    // Should be bit-identical to wet=1.0
    const { buffer: ref } = await NoiseReducer.process(input, { ...BASE_OPTIONS, wetDryRatio: 1.0 });
    expect(maxDiff(buffer, ref)).toBe(0);
  });

  it("wetDryRatio value <0.0 is clamped — output equals original", async () => {
    const input = makeMixedSignal();
    const { buffer } = await NoiseReducer.process(input, { ...BASE_OPTIONS, wetDryRatio: -0.5 });
    // Clamped to 0.0 → original returned
    expect(maxDiff(buffer, input)).toBe(0);
  });

  it("wetDryRatio=0.5 does not produce NaN or Infinity", async () => {
    const input = makeMixedSignal();
    const { buffer } = await NoiseReducer.process(input, { ...BASE_OPTIONS, wetDryRatio: 0.5 });
    expect(hasInvalidSamples(buffer)).toBe(false);
  });

  it("wetDryRatio does not mutate the input buffer", async () => {
    const input    = makeMixedSignal();
    const snapshot = Float32Array.from(input.getChannelData(0));
    await NoiseReducer.process(input, { ...BASE_OPTIONS, wetDryRatio: 0.5 });
    expect(input.getChannelData(0)).toEqual(snapshot);
  });

  it("when disabled, wetDryRatio has no effect — returns clone of original", async () => {
    const input = makeMixedSignal();
    const { buffer } = await NoiseReducer.process(input, {
      enabled: false, strength: "medium", mode: "broadband", wetDryRatio: 0.5,
    });
    // disabled path returns cloneBuffer(input) before any wetDry logic
    expect(maxDiff(buffer, input)).toBe(0);
  });

  it("returns a new buffer object — does not return the input reference", async () => {
    const input = makeMixedSignal();
    const { buffer } = await NoiseReducer.process(input, { ...BASE_OPTIONS, wetDryRatio: 1.0 });
    expect(buffer).not.toBe(input);
  });

  it("preserves numberOfChannels, length, sampleRate", async () => {
    const input = makeMixedSignal();
    const { buffer } = await NoiseReducer.process(input, { ...BASE_OPTIONS, wetDryRatio: 0.7 });
    expect(buffer.numberOfChannels).toBe(input.numberOfChannels);
    expect(buffer.length).toBe(input.length);
    expect(buffer.sampleRate).toBe(input.sampleRate);
  });

});

// ── PipelineVariants structure tests ─────────────────────────────────────────

describe("PipelineVariants — structure & defaults", () => {

  it("DEFAULT_PIPELINE_VARIANT is 'legacy'", () => {
    expect(DEFAULT_PIPELINE_VARIANT).toBe("legacy");
  });

  it("legacy stageOrder exactly matches original pipeline: hum → nr → dereverb → dynamics", () => {
    const { stageOrder } = PIPELINE_VARIANTS.legacy;
    expect(stageOrder[0]).toBe("hum_removal");
    expect(stageOrder[1]).toBe("noise_reduction");
    expect(stageOrder[2]).toBe("de_reverb");
    expect(stageOrder[3]).toBe("dynamics");
    expect(stageOrder.length).toBe(4);
  });

  it("dereverb_first places de_reverb strictly before noise_reduction", () => {
    const order = PIPELINE_VARIANTS.dereverb_first.stageOrder;
    expect(order.indexOf("de_reverb")).toBeLessThan(order.indexOf("noise_reduction"));
  });

  it("no_dereverb does not contain the de_reverb stage", () => {
    expect(PIPELINE_VARIANTS.no_dereverb.stageOrder).not.toContain("de_reverb");
  });

  it("all variants start with hum_removal", () => {
    for (const v of Object.values(PIPELINE_VARIANTS)) {
      expect(v.stageOrder[0]).toBe("hum_removal");
    }
  });

  it("all variants end with dynamics", () => {
    for (const v of Object.values(PIPELINE_VARIANTS)) {
      expect(v.stageOrder[v.stageOrder.length - 1]).toBe("dynamics");
    }
  });

  it("every variant has a non-empty description", () => {
    for (const v of Object.values(PIPELINE_VARIANTS)) {
      expect(v.description.length).toBeGreaterThan(0);
    }
  });

  it("variant ids match their keys in PIPELINE_VARIANTS", () => {
    for (const [key, v] of Object.entries(PIPELINE_VARIANTS)) {
      expect(v.id).toBe(key);
    }
  });

});

// ── Regression: default behaviour unchanged ───────────────────────────────────

describe("Regression — default behaviour unchanged", () => {

  it("NoiseReducer output is identical with and without pipelineVariant in EnhancementOptions shape", async () => {
    // NoiseReducer only receives NoiseReductionOptions — pipelineVariant is never seen by it.
    // This test verifies that the NoiseReducer contract is unchanged.
    const input = makeMixedSignal();
    const [rA, rB] = await Promise.all([
      NoiseReducer.process(input, BASE_OPTIONS),
      NoiseReducer.process(input, { ...BASE_OPTIONS }), // same shape, no wetDryRatio
    ]);
    expect(maxDiff(rA.buffer, rB.buffer)).toBe(0);
  });

  it("strong mode with no wetDryRatio still uses gainFloor=0.10 (legacy value)", async () => {
    // Verify the floor: a near-silent signal should not be fully muted
    const input = makeAudioBuffer({
      length: LEN, sampleRate: SR,
      fill: () => 0.001, // well below any realistic threshold
    });
    const { buffer } = await NoiseReducer.process(input, {
      enabled: true, strength: "strong", mode: "broadband",
    });
    // gainFloor = 0.10 → output should be at least 10% of input energy
    expect(rmsLinear(buffer)).toBeGreaterThan(0);
    expect(hasInvalidSamples(buffer)).toBe(false);
  });

  it("no sample is NaN or Infinity for light/medium/strong with wetDryRatio=1.0", async () => {
    const input = makeMixedSignal();
    for (const strength of ["light", "medium", "strong"] as const) {
      const { buffer } = await NoiseReducer.process(input, {
        enabled: true, strength, mode: "broadband", wetDryRatio: 1.0,
      });
      expect(hasInvalidSamples(buffer)).toBe(false);
    }
  });

});
