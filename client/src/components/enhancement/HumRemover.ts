import { createOfflineAudioContext } from "./AudioContextFactory";
import type { HumRemovalOptions } from "./types";

const HARMONICS_50 = [50, 100, 150, 200] as const;
const HARMONICS_60 = [60, 120, 180, 240] as const;

// Narrower Q → wider notch → more removal; wider Q → narrower notch → safer for voice.
const Q_BY_STRENGTH: Record<HumRemovalOptions["strength"], number> = {
  light:  20,
  medium: 30,
  strong: 45,
};

function cloneBuffer(src: AudioBuffer): AudioBuffer {
  const out = new AudioBuffer({
    numberOfChannels: src.numberOfChannels,
    length:           src.length,
    sampleRate:       src.sampleRate,
  });
  for (let ch = 0; ch < src.numberOfChannels; ch++) {
    out.getChannelData(ch).set(src.getChannelData(ch));
  }
  return out;
}

export interface HumRemoverResult {
  buffer:              AudioBuffer;
  harmonicsProcessed:  number[];
}

/**
 * HumRemover
 *
 * Removes electrical mains hum (50 Hz or 60 Hz) and its first three harmonics
 * using BiquadFilterNode notch filters in an OfflineAudioContext.
 *
 * Rules:
 * - Input buffer is never mutated.
 * - Always returns a new AudioBuffer with the same duration/sampleRate/channels.
 * - When disabled, returns a cloned buffer so callers never hold the original reference.
 */
export class HumRemover {
  static async process(
    buffer:      AudioBuffer,
    options:     HumRemovalOptions,
    onProgress?: (pct: number, stage: string) => void,
  ): Promise<HumRemoverResult> {
    if (!options.enabled) {
      return { buffer: cloneBuffer(buffer), harmonicsProcessed: [] };
    }

    const { numberOfChannels, sampleRate, length } = buffer;
    const harmonics = options.frequencyHz === 50 ? HARMONICS_50 : HARMONICS_60;
    const q         = Q_BY_STRENGTH[options.strength];

    onProgress?.(10, "جاري إزالة الطنين الكهربائي...");

    const offline = createOfflineAudioContext(numberOfChannels, length, sampleRate);
    const src     = offline.createBufferSource();
    src.buffer    = buffer;

    // Chain one notch per harmonic: fundamental → 2nd → 3rd → 4th
    let node: AudioNode = src;
    for (const freq of harmonics) {
      const notch           = offline.createBiquadFilter();
      notch.type            = "notch";
      notch.frequency.value = freq;
      notch.Q.value         = q;
      node.connect(notch);
      node = notch;
    }

    node.connect(offline.destination);
    src.start(0);

    onProgress?.(50, "جاري معالجة الطنين...");
    const rendered = await offline.startRendering();
    onProgress?.(90, "اكتملت إزالة الطنين");

    return { buffer: rendered, harmonicsProcessed: [...harmonics] };
  }
}
