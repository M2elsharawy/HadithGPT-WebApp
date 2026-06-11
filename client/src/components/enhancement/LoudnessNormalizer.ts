import { createAudioBuffer } from "./AudioContextFactory";

export interface NormalizationResult {
  buffer:             AudioBuffer;
  gainAppliedDb:      number;
  gainAppliedLinear:  number;
  peakBeforeLinear:   number;
  peakAfterLinear:    number;
}

export class LoudnessNormalizer {
  /**
   * Peak-normalize buffer so the highest sample reaches targetDb dBFS.
   * Never exceeds -1 dBFS ceiling regardless of targetDb value.
   * Always returns a NEW AudioBuffer — the original is never mutated.
   */
  static normalize(
    buffer: AudioBuffer,
    targetDb: number = -1,
  ): NormalizationResult {
    // Safety clamp: ceiling is always -1 dBFS
    const safeCeilingDb  = Math.min(targetDb, -1);
    const targetLinear   = Math.pow(10, safeCeilingDb / 20);

    const { numberOfChannels, sampleRate, length } = buffer;

    // 1. Find peak across ALL channels
    let peakLinear = 0;
    for (let ch = 0; ch < numberOfChannels; ch++) {
      const data = buffer.getChannelData(ch);
      for (let i = 0; i < data.length; i++) {
        const abs = Math.abs(data[i]);
        if (abs > peakLinear) peakLinear = abs;
      }
    }

    // Silent buffer — return identity copy
    if (peakLinear < 1e-9) {
      const silent = createAudioBuffer({ numberOfChannels, length, sampleRate });
      for (let ch = 0; ch < numberOfChannels; ch++) {
        silent.getChannelData(ch).set(buffer.getChannelData(ch));
      }
      return {
        buffer: silent,
        gainAppliedDb: 0,
        gainAppliedLinear: 1,
        peakBeforeLinear: 0,
        peakAfterLinear: 0,
      };
    }

    const gainLinear = targetLinear / peakLinear;
    const gainDb     = 20 * Math.log10(gainLinear);

    // 2. Apply gain into a new AudioBuffer
    const out = createAudioBuffer({ numberOfChannels, length, sampleRate });
    for (let ch = 0; ch < numberOfChannels; ch++) {
      const src = buffer.getChannelData(ch);
      const dst = out.getChannelData(ch);
      for (let i = 0; i < length; i++) {
        // Hard clamp as brickwall safety — should not trigger after correct gain
        dst[i] = Math.max(-1, Math.min(1, src[i] * gainLinear));
      }
    }

    return {
      buffer: out,
      gainAppliedDb: gainDb,
      gainAppliedLinear: gainLinear,
      peakBeforeLinear: peakLinear,
      peakAfterLinear: Math.min(1, peakLinear * gainLinear),
    };
  }
}
