/**
 * Worker-safe OfflineAudioContext constructor.
 *
 * Safari module workers do not expose OfflineAudioContext as a bare global —
 * it must be accessed via globalThis. This helper resolves the constructor
 * through globalThis (with webkit-prefixed fallback) and throws a clear error
 * if neither is present, so the failure surface is obvious rather than a
 * cryptic ReferenceError.
 */
export function createOfflineAudioContext(
  numberOfChannels: number,
  length: number,
  sampleRate: number,
): OfflineAudioContext {
  const Ctor =
    (globalThis as typeof globalThis & { OfflineAudioContext?: typeof OfflineAudioContext })
      .OfflineAudioContext ??
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).webkitOfflineAudioContext;

  if (!Ctor) {
    throw new Error(
      "OfflineAudioContext is not supported in this browser/runtime",
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-unsafe-call
  return new Ctor(numberOfChannels, length, sampleRate) as OfflineAudioContext;
}

/**
 * Worker-safe AudioBuffer constructor.
 *
 * Safari module workers do not expose AudioBuffer as a bare global —
 * it must be accessed via globalThis. This helper resolves the constructor
 * through globalThis and throws a clear error if it is not present.
 */
export function createAudioBuffer(options: {
  numberOfChannels: number;
  length: number;
  sampleRate: number;
}): AudioBuffer {
  const Ctor = (globalThis as typeof globalThis & { AudioBuffer?: typeof AudioBuffer })
    .AudioBuffer;

  if (!Ctor) {
    throw new Error("AudioBuffer is not supported in this worker/runtime");
  }

  return new Ctor(options);
}
