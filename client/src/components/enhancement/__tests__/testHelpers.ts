/**
 * Minimal AudioBuffer mock for DSP unit tests in Node.js environment.
 *
 * Implements only the parts of the AudioBuffer interface used by the
 * enhancement engine: getChannelData, numberOfChannels, length, sampleRate,
 * duration. The constructor mirrors the real Web Audio API constructor.
 *
 * Usage:
 *   patchGlobalAudioBuffer();          // call once before importing DSP modules
 *   const buf = makeAudioBuffer({ ... });
 */

export class MockAudioBuffer {
  readonly numberOfChannels: number;
  readonly sampleRate: number;
  readonly length: number;
  readonly duration: number;
  private readonly channels: Float32Array[];

  constructor({
    numberOfChannels,
    length,
    sampleRate,
  }: {
    numberOfChannels: number;
    length: number;
    sampleRate: number;
  }) {
    this.numberOfChannels = numberOfChannels;
    this.length = length;
    this.sampleRate = sampleRate;
    this.duration = length / sampleRate;
    this.channels = Array.from(
      { length: numberOfChannels },
      () => new Float32Array(length),
    );
  }

  getChannelData(channel: number): Float32Array {
    if (channel < 0 || channel >= this.numberOfChannels) {
      throw new RangeError(`getChannelData: channel ${channel} out of range`);
    }
    return this.channels[channel];
  }

  copyFromChannel(destination: Float32Array, channelNumber: number, startInChannel = 0): void {
    destination.set(this.channels[channelNumber].subarray(startInChannel));
  }

  copyToChannel(source: Float32Array, channelNumber: number, startInChannel = 0): void {
    this.channels[channelNumber].set(source, startInChannel);
  }
}

/** Install MockAudioBuffer as the global AudioBuffer constructor. */
export function patchGlobalAudioBuffer(): void {
  (globalThis as Record<string, unknown>).AudioBuffer = MockAudioBuffer;
}

export interface MakeBufferOptions {
  numberOfChannels?: number;
  length?: number;
  sampleRate?: number;
  /** Constant fill value, or a per-sample function (i=sample index, ch=channel). */
  fill?: number | ((i: number, ch: number) => number);
}

/**
 * Create a MockAudioBuffer with optional per-sample fill.
 * Always calls patchGlobalAudioBuffer() first.
 */
export function makeAudioBuffer({
  numberOfChannels = 1,
  length = 1024,
  sampleRate = 44100,
  fill,
}: MakeBufferOptions = {}): AudioBuffer {
  patchGlobalAudioBuffer();
  const buf = new MockAudioBuffer({ numberOfChannels, length, sampleRate });
  if (fill !== undefined) {
    for (let ch = 0; ch < numberOfChannels; ch++) {
      const data = buf.getChannelData(ch);
      if (typeof fill === "number") {
        data.fill(fill);
      } else {
        for (let i = 0; i < length; i++) data[i] = fill(i, ch);
      }
    }
  }
  return buf as unknown as AudioBuffer;
}

/** Peak linear across all channels. */
export function peakLinear(buf: AudioBuffer): number {
  let peak = 0;
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    for (const s of buf.getChannelData(ch)) {
      const a = Math.abs(s);
      if (a > peak) peak = a;
    }
  }
  return peak;
}

/** True if any sample is NaN or non-finite. */
export function hasInvalidSamples(buf: AudioBuffer): boolean {
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    for (const s of buf.getChannelData(ch)) {
      if (!Number.isFinite(s)) return true;
    }
  }
  return false;
}

/** True if all samples in two buffers are exactly identical on channel 0. */
export function channelDataUnchanged(a: AudioBuffer, b: AudioBuffer): boolean {
  const da = a.getChannelData(0);
  const db = b.getChannelData(0);
  if (da.length !== db.length) return false;
  for (let i = 0; i < da.length; i++) {
    if (da[i] !== db[i]) return false;
  }
  return true;
}
