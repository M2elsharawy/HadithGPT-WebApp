import { describe, it, expect } from "vitest";
import { isAudioWorkerCapabilityError } from "../audioWorkerCapabilityError";

describe("isAudioWorkerCapabilityError", () => {
  // ── Known capability error messages ───────────────────────────────────────

  it("returns true for 'AudioBuffer is not defined'", () => {
    expect(isAudioWorkerCapabilityError(new Error("AudioBuffer is not defined"))).toBe(true);
  });

  it("returns true for 'AudioBuffer is not supported in this worker/runtime'", () => {
    expect(
      isAudioWorkerCapabilityError(new Error("AudioBuffer is not supported in this worker/runtime")),
    ).toBe(true);
  });

  it("returns true for 'OfflineAudioContext is not defined'", () => {
    expect(
      isAudioWorkerCapabilityError(new Error("OfflineAudioContext is not defined")),
    ).toBe(true);
  });

  it("returns true for 'OfflineAudioContext is not supported in this browser/runtime'", () => {
    expect(
      isAudioWorkerCapabilityError(
        new Error("OfflineAudioContext is not supported in this browser/runtime"),
      ),
    ).toBe(true);
  });

  it("returns true when pattern is embedded in a longer message", () => {
    expect(
      isAudioWorkerCapabilityError(
        new Error("Worker init failed: OfflineAudioContext is not defined at line 42"),
      ),
    ).toBe(true);
  });

  // ── Unrelated errors must NOT trigger fallback ────────────────────────────

  it("returns false for an unrelated Error", () => {
    expect(isAudioWorkerCapabilityError(new Error("Division by zero"))).toBe(false);
  });

  it("returns false for a DSP-domain error", () => {
    expect(
      isAudioWorkerCapabilityError(new Error("AudioEnhancementEngine: invalid or empty AudioBuffer")),
    ).toBe(false);
  });

  it("returns false for a network error", () => {
    expect(isAudioWorkerCapabilityError(new Error("Failed to fetch"))).toBe(false);
  });

  // ── Non-Error types ───────────────────────────────────────────────────────

  it("returns false for a plain string", () => {
    expect(isAudioWorkerCapabilityError("AudioBuffer is not defined")).toBe(false);
  });

  it("returns false for null", () => {
    expect(isAudioWorkerCapabilityError(null)).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(isAudioWorkerCapabilityError(undefined)).toBe(false);
  });

  it("returns false for a plain object", () => {
    expect(isAudioWorkerCapabilityError({ message: "AudioBuffer is not defined" })).toBe(false);
  });
});
