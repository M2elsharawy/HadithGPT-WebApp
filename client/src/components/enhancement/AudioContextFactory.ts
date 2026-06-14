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
 * Worker-safe AudioBuffer constructor with OfflineAudioContext fallback.
 *
 * Safari module workers may not expose AudioBuffer as a bare global.
 * Primary path: globalThis.AudioBuffer constructor.
 * Fallback path: createOfflineAudioContext().createBuffer() — always available
 * when any OfflineAudioContext variant is present (standard or webkit-prefixed).
 * Throws only if neither AudioBuffer nor any OfflineAudioContext is available.
 */
export function createAudioBuffer(options: {
  numberOfChannels: number;
  length: number;
  sampleRate: number;
}): AudioBuffer {
  const Ctor = (globalThis as typeof globalThis & { AudioBuffer?: typeof AudioBuffer })
    .AudioBuffer;

  if (Ctor) {
    return new Ctor(options);
  }

  const ctx = createOfflineAudioContext(
    options.numberOfChannels,
    options.length,
    options.sampleRate,
  );

  return ctx.createBuffer(
    options.numberOfChannels,
    options.length,
    options.sampleRate,
  );
}
