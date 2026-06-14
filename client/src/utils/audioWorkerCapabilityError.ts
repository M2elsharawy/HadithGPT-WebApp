// Known error messages thrown by AudioContextFactory helpers when the
// worker runtime cannot resolve Web Audio API constructors via globalThis.
const CAPABILITY_PATTERNS = [
  "AudioBuffer is not defined",
  "AudioBuffer is not supported in this worker/runtime",
  "OfflineAudioContext is not defined",
  "OfflineAudioContext is not supported in this browser/runtime",
] as const;

/**
 * Returns true when `error` is a known Web Audio API constructor
 * unavailability error from the enhancement worker.  Used to decide
 * whether to fall back to main-thread enhancement rather than surfacing
 * the error to the user.
 */
export function isAudioWorkerCapabilityError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const { message } = error;
  return CAPABILITY_PATTERNS.some(pattern => message.includes(pattern));
}
