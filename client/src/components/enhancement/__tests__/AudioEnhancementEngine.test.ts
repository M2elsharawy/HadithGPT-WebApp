import { describe, it, expect, beforeAll } from "vitest";
import { patchGlobalAudioBuffer } from "./testHelpers";

beforeAll(() => { patchGlobalAudioBuffer(); });

import { applyPresenceAirSafety } from "../AudioEnhancementEngine";
import { ENHANCEMENT_PRESETS }    from "../EnhancementPresets";

// ── applyPresenceAirSafety ────────────────────────────────────────────────────
// Tests operate on the pure helper only — no OfflineAudioContext required.
// The helper encapsulates all safety-scaling decisions, so these tests
// fully verify the PR#4 behaviour contract.

describe("applyPresenceAirSafety — SNR thresholds", () => {

  // ── SNR < 12 dB (hard threshold) → scale = 0.5 ──────────────────────────

  it("SNR < 12 — presenceBoostDb is halved (scale 0.5)", () => {
    const { presenceBoostDb, scale } = applyPresenceAirSafety(3.0, 1.0, 10);
    expect(scale).toBe(0.5);
    expect(presenceBoostDb).toBeCloseTo(1.5, 6);
  });

  it("SNR < 12 — airBoostDb is halved (scale 0.5)", () => {
    const { airBoostDb } = applyPresenceAirSafety(3.0, 2.0, 8);
    expect(airBoostDb).toBeCloseTo(1.0, 6);
  });

  it("SNR exactly 12 — still triggers hard threshold (< 12 is exclusive)", () => {
    // snrDb = 11.999 → hard; snrDb = 12.0 → soft band
    expect(applyPresenceAirSafety(4.0, 2.0, 11.999).scale).toBe(0.5);
    expect(applyPresenceAirSafety(4.0, 2.0, 12.0).scale).toBe(0.75);
  });

  // ── 12 ≤ SNR < 18 dB (soft threshold) → scale = 0.75 ───────────────────

  it("SNR = 15 — presenceBoostDb is scaled to 75 %", () => {
    const { presenceBoostDb, scale } = applyPresenceAirSafety(4.0, 2.0, 15);
    expect(scale).toBe(0.75);
    expect(presenceBoostDb).toBeCloseTo(3.0, 6);
  });

  it("SNR = 15 — airBoostDb is scaled to 75 %", () => {
    const { airBoostDb } = applyPresenceAirSafety(4.0, 2.0, 15);
    expect(airBoostDb).toBeCloseTo(1.5, 6);
  });

  // ── SNR ≥ 18 dB (clean) → no change ─────────────────────────────────────

  it("SNR ≥ 18 — scale is 1.0 (no attenuation)", () => {
    expect(applyPresenceAirSafety(3.0, 1.5, 18).scale).toBe(1.0);
    expect(applyPresenceAirSafety(3.0, 1.5, 25).scale).toBe(1.0);
    expect(applyPresenceAirSafety(3.0, 1.5, 40).scale).toBe(1.0);
  });

  it("SNR ≥ 18 — presenceBoostDb unchanged", () => {
    const { presenceBoostDb } = applyPresenceAirSafety(3.0, 1.5, 20);
    expect(presenceBoostDb).toBe(3.0);
  });

  it("SNR ≥ 18 — airBoostDb unchanged", () => {
    const { airBoostDb } = applyPresenceAirSafety(3.0, 1.5, 20);
    expect(airBoostDb).toBe(1.5);
  });

  it("SNR ≥ 18 — adjusted flag is false", () => {
    expect(applyPresenceAirSafety(3.0, 1.5, 20).adjusted).toBe(false);
  });

  // ── Non-positive boosts are never raised ─────────────────────────────────

  it("presenceBoostDb = 0 — not changed at any SNR", () => {
    for (const snr of [5, 10, 15, 20]) {
      expect(applyPresenceAirSafety(0, 2.0, snr).presenceBoostDb).toBe(0);
    }
  });

  it("presenceBoostDb < 0 (cut) — not changed at any SNR", () => {
    for (const snr of [5, 10, 15, 20]) {
      const { presenceBoostDb } = applyPresenceAirSafety(-2.0, 0, snr);
      expect(presenceBoostDb).toBe(-2.0);
    }
  });

  it("airBoostDb = 0 — not changed at any SNR", () => {
    for (const snr of [5, 10, 15, 20]) {
      expect(applyPresenceAirSafety(2.0, 0, snr).airBoostDb).toBe(0);
    }
  });

  it("airBoostDb < 0 (cut) — not changed at any SNR", () => {
    for (const snr of [5, 10, 15, 20]) {
      const { airBoostDb } = applyPresenceAirSafety(0, -1.5, snr);
      expect(airBoostDb).toBe(-1.5);
    }
  });

  it("both boosts ≤ 0 — adjusted is false even with low SNR", () => {
    expect(applyPresenceAirSafety(0, -1.5, 8).adjusted).toBe(false);
    expect(applyPresenceAirSafety(-2.0, 0, 8).adjusted).toBe(false);
  });

  // ── adjusted flag semantics ───────────────────────────────────────────────

  it("adjusted = true only when scale < 1.0 AND at least one positive boost", () => {
    expect(applyPresenceAirSafety(3.0, 0, 10).adjusted).toBe(true);
    expect(applyPresenceAirSafety(0, 2.0, 10).adjusted).toBe(true);
    expect(applyPresenceAirSafety(3.0, 2.0, 10).adjusted).toBe(true);
  });

  it("values are never raised — scaled result ≤ original for all SNR levels", () => {
    const cases = [
      { p: 4.0, a: 2.0, snr: 5 },
      { p: 4.0, a: 2.0, snr: 15 },
      { p: 4.0, a: 2.0, snr: 25 },
    ];
    for (const { p, a, snr } of cases) {
      const result = applyPresenceAirSafety(p, a, snr);
      expect(result.presenceBoostDb).toBeLessThanOrEqual(p);
      expect(result.airBoostDb).toBeLessThanOrEqual(a);
    }
  });

});

// ── Preset regression ─────────────────────────────────────────────────────────
// Verifies that EnhancementPresets.ts was not modified by this PR.

describe("PR#4 — Preset regression (EnhancementPresets unchanged)", () => {

  it("quran_clean preset presenceBoostDb is 2.5", () => {
    expect(ENHANCEMENT_PRESETS.quran_clean.options.presenceBoostDb).toBe(2.5);
  });

  it("quran_clean preset airBoostDb is 1.0", () => {
    expect(ENHANCEMENT_PRESETS.quran_clean.options.airBoostDb).toBe(1.0);
  });

  it("mosque_recording_repair_basic preset presenceBoostDb is 3.0", () => {
    expect(ENHANCEMENT_PRESETS.mosque_recording_repair_basic.options.presenceBoostDb).toBe(3.0);
  });

  it("mosque_recording_repair_basic preset airBoostDb is 0", () => {
    expect(ENHANCEMENT_PRESETS.mosque_recording_repair_basic.options.airBoostDb).toBe(0);
  });

  it("phone_recording_fix_basic preset airBoostDb is −1.5 (negative — cut)", () => {
    // Negative air boost must never be raised by safety logic
    expect(ENHANCEMENT_PRESETS.phone_recording_fix_basic.options.airBoostDb).toBe(-1.5);
    const { airBoostDb } = applyPresenceAirSafety(
      ENHANCEMENT_PRESETS.phone_recording_fix_basic.options.presenceBoostDb,
      ENHANCEMENT_PRESETS.phone_recording_fix_basic.options.airBoostDb,
      5, // very low SNR
    );
    expect(airBoostDb).toBe(-1.5);
  });

  it("custom_manual preset has no active boosts (0 / 0)", () => {
    expect(ENHANCEMENT_PRESETS.custom_manual.options.presenceBoostDb).toBe(0);
    expect(ENHANCEMENT_PRESETS.custom_manual.options.airBoostDb).toBe(0);
  });

});

// ── High-SNR signal — no modification ────────────────────────────────────────

describe("PR#4 — High-SNR signal produces no boost adjustment", () => {

  it("clean recording (SNR ≥ 18) — applyPresenceAirSafety returns original values", () => {
    // Simulate a clean recording: SNR = 30 dB
    const origPresence = 3.0;
    const origAir      = 1.5;
    const result = applyPresenceAirSafety(origPresence, origAir, 30);
    expect(result.presenceBoostDb).toBe(origPresence);
    expect(result.airBoostDb).toBe(origAir);
    expect(result.adjusted).toBe(false);
    expect(result.scale).toBe(1.0);
  });

  it("borderline SNR = 18.0 — exactly at threshold, no attenuation", () => {
    const result = applyPresenceAirSafety(2.5, 1.0, 18.0);
    expect(result.scale).toBe(1.0);
    expect(result.adjusted).toBe(false);
  });

});
