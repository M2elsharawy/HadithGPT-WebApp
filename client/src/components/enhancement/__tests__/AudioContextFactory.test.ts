import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createOfflineAudioContext, createAudioBuffer } from "../AudioContextFactory";

// ── AudioContextFactory ───────────────────────────────────────────────────────
// Tests run in Node.js where OfflineAudioContext does not exist by default.
// We install/remove mock constructors on globalThis to test each branch.

function removeProp(key: string) {
  // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
  delete (globalThis as Record<string, unknown>)[key];
}

const MOCK_INSTANCE = { __mock: true } as unknown as OfflineAudioContext;

class MockOfflineAudioContext {
  readonly numberOfChannels: number;
  readonly length: number;
  readonly sampleRate: number;
  constructor(numberOfChannels: number, length: number, sampleRate: number) {
    this.numberOfChannels = numberOfChannels;
    this.length           = length;
    this.sampleRate       = sampleRate;
    Object.assign(this, MOCK_INSTANCE);
  }
}

describe("createOfflineAudioContext", () => {
  // Save original values so we can restore them after each test
  let origOAC:       unknown;
  let origWebkitOAC: unknown;

  beforeEach(() => {
    origOAC       = (globalThis as Record<string, unknown>).OfflineAudioContext;
    origWebkitOAC = (globalThis as Record<string, unknown>).webkitOfflineAudioContext;
    // Start each test with neither present
    removeProp("OfflineAudioContext");
    removeProp("webkitOfflineAudioContext");
  });

  afterEach(() => {
    if (origOAC !== undefined) {
      (globalThis as Record<string, unknown>).OfflineAudioContext = origOAC;
    } else {
      removeProp("OfflineAudioContext");
    }
    if (origWebkitOAC !== undefined) {
      (globalThis as Record<string, unknown>).webkitOfflineAudioContext = origWebkitOAC;
    } else {
      removeProp("webkitOfflineAudioContext");
    }
  });

  // ── Standard path ─────────────────────────────────────────────────────────

  it("uses globalThis.OfflineAudioContext when available", () => {
    (globalThis as Record<string, unknown>).OfflineAudioContext = MockOfflineAudioContext;
    const ctx = createOfflineAudioContext(1, 44100, 44100);
    expect(ctx).toBeInstanceOf(MockOfflineAudioContext);
  });

  it("passes numberOfChannels, length, sampleRate to the constructor", () => {
    (globalThis as Record<string, unknown>).OfflineAudioContext = MockOfflineAudioContext;
    const ctx = createOfflineAudioContext(2, 8000, 16000) as unknown as MockOfflineAudioContext;
    expect(ctx.numberOfChannels).toBe(2);
    expect(ctx.length).toBe(8000);
    expect(ctx.sampleRate).toBe(16000);
  });

  // ── webkit-prefixed fallback ──────────────────────────────────────────────

  it("falls back to webkitOfflineAudioContext when standard is absent", () => {
    (globalThis as Record<string, unknown>).webkitOfflineAudioContext = MockOfflineAudioContext;
    const ctx = createOfflineAudioContext(1, 44100, 44100);
    expect(ctx).toBeInstanceOf(MockOfflineAudioContext);
  });

  it("webkit fallback passes correct parameters", () => {
    (globalThis as Record<string, unknown>).webkitOfflineAudioContext = MockOfflineAudioContext;
    const ctx = createOfflineAudioContext(2, 4800, 48000) as unknown as MockOfflineAudioContext;
    expect(ctx.numberOfChannels).toBe(2);
    expect(ctx.length).toBe(4800);
    expect(ctx.sampleRate).toBe(48000);
  });

  it("prefers standard OfflineAudioContext over webkit when both are present", () => {
    class WebkitMock extends MockOfflineAudioContext {}
    (globalThis as Record<string, unknown>).OfflineAudioContext       = MockOfflineAudioContext;
    (globalThis as Record<string, unknown>).webkitOfflineAudioContext = WebkitMock;
    const ctx = createOfflineAudioContext(1, 1000, 44100);
    expect(ctx).toBeInstanceOf(MockOfflineAudioContext);
    expect(ctx).not.toBeInstanceOf(WebkitMock);
  });

  // ── Error path ────────────────────────────────────────────────────────────

  it("throws when neither OfflineAudioContext nor webkit variant is available", () => {
    expect(() => createOfflineAudioContext(1, 44100, 44100)).toThrowError(
      "OfflineAudioContext is not supported in this browser/runtime",
    );
  });

  it("thrown error is an instance of Error", () => {
    expect(() => createOfflineAudioContext(1, 44100, 44100)).toThrow(Error);
  });
});

// ── createAudioBuffer ─────────────────────────────────────────────────────────

class MockAudioBufferCtor {
  readonly numberOfChannels: number;
  readonly length: number;
  readonly sampleRate: number;
  constructor(opts: { numberOfChannels: number; length: number; sampleRate: number }) {
    this.numberOfChannels = opts.numberOfChannels;
    this.length           = opts.length;
    this.sampleRate       = opts.sampleRate;
  }
}

// Returned by MockOACWithCreateBuffer.createBuffer — distinct class so tests
// can verify which path was taken.
class MockAudioBufferFromOAC {
  readonly numberOfChannels: number;
  readonly length: number;
  readonly sampleRate: number;
  constructor(ch: number, len: number, sr: number) {
    this.numberOfChannels = ch;
    this.length           = len;
    this.sampleRate       = sr;
  }
}

class MockOACWithCreateBuffer {
  readonly numberOfChannels: number;
  readonly length: number;
  readonly sampleRate: number;
  constructor(numberOfChannels: number, length: number, sampleRate: number) {
    this.numberOfChannels = numberOfChannels;
    this.length           = length;
    this.sampleRate       = sampleRate;
  }
  createBuffer(numberOfChannels: number, length: number, sampleRate: number): MockAudioBufferFromOAC {
    return new MockAudioBufferFromOAC(numberOfChannels, length, sampleRate);
  }
}

describe("createAudioBuffer", () => {
  let origAB:         unknown;
  let origOAC:        unknown;
  let origWebkitOAC:  unknown;

  beforeEach(() => {
    origAB        = (globalThis as Record<string, unknown>).AudioBuffer;
    origOAC       = (globalThis as Record<string, unknown>).OfflineAudioContext;
    origWebkitOAC = (globalThis as Record<string, unknown>).webkitOfflineAudioContext;
    removeProp("AudioBuffer");
    removeProp("OfflineAudioContext");
    removeProp("webkitOfflineAudioContext");
  });

  afterEach(() => {
    if (origAB !== undefined) {
      (globalThis as Record<string, unknown>).AudioBuffer = origAB;
    } else {
      removeProp("AudioBuffer");
    }
    if (origOAC !== undefined) {
      (globalThis as Record<string, unknown>).OfflineAudioContext = origOAC;
    } else {
      removeProp("OfflineAudioContext");
    }
    if (origWebkitOAC !== undefined) {
      (globalThis as Record<string, unknown>).webkitOfflineAudioContext = origWebkitOAC;
    } else {
      removeProp("webkitOfflineAudioContext");
    }
  });

  // ── Standard path (AudioBuffer available) ─────────────────────────────────

  it("uses globalThis.AudioBuffer when available", () => {
    (globalThis as Record<string, unknown>).AudioBuffer = MockAudioBufferCtor;
    const buf = createAudioBuffer({ numberOfChannels: 1, length: 1024, sampleRate: 44100 });
    expect(buf).toBeInstanceOf(MockAudioBufferCtor);
  });

  it("passes numberOfChannels, length, sampleRate as options object", () => {
    (globalThis as Record<string, unknown>).AudioBuffer = MockAudioBufferCtor;
    const buf = createAudioBuffer({ numberOfChannels: 2, length: 8000, sampleRate: 48000 }) as unknown as MockAudioBufferCtor;
    expect(buf.numberOfChannels).toBe(2);
    expect(buf.length).toBe(8000);
    expect(buf.sampleRate).toBe(48000);
  });

  it("passes all three fields (mono, 44100, short buffer)", () => {
    (globalThis as Record<string, unknown>).AudioBuffer = MockAudioBufferCtor;
    const buf = createAudioBuffer({ numberOfChannels: 1, length: 512, sampleRate: 44100 }) as unknown as MockAudioBufferCtor;
    expect(buf.numberOfChannels).toBe(1);
    expect(buf.length).toBe(512);
    expect(buf.sampleRate).toBe(44100);
  });

  // ── OAC fallback path (AudioBuffer absent, OfflineAudioContext present) ───

  it("falls back to OfflineAudioContext.createBuffer when AudioBuffer is absent", () => {
    (globalThis as Record<string, unknown>).OfflineAudioContext = MockOACWithCreateBuffer;
    const buf = createAudioBuffer({ numberOfChannels: 1, length: 1024, sampleRate: 44100 });
    expect(buf).toBeInstanceOf(MockAudioBufferFromOAC);
  });

  it("fallback path passes numberOfChannels, length, sampleRate correctly", () => {
    (globalThis as Record<string, unknown>).OfflineAudioContext = MockOACWithCreateBuffer;
    const buf = createAudioBuffer({ numberOfChannels: 2, length: 4800, sampleRate: 48000 }) as unknown as MockAudioBufferFromOAC;
    expect(buf.numberOfChannels).toBe(2);
    expect(buf.length).toBe(4800);
    expect(buf.sampleRate).toBe(48000);
  });

  // ── Error path (neither AudioBuffer nor OfflineAudioContext available) ────

  it("throws when both AudioBuffer and OfflineAudioContext are unavailable", () => {
    expect(() =>
      createAudioBuffer({ numberOfChannels: 1, length: 1024, sampleRate: 44100 }),
    ).toThrowError("OfflineAudioContext is not supported in this browser/runtime");
  });

  it("thrown error is an instance of Error", () => {
    expect(() =>
      createAudioBuffer({ numberOfChannels: 1, length: 1024, sampleRate: 44100 }),
    ).toThrow(Error);
  });
});
