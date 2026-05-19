export interface NoiseProfile {
  noiseFloorDb:     number;
  noiseThresholdDb: number;
  noiseFramesUsed:  number;
  averageNoiseRms:  number;
}

const FRAME_SIZE   = 1024;
const PERCENTILE   = 0.15;
const HEADROOM_DB  = 9;

/**
 * NoiseProfileAnalyzer
 *
 * Estimates the background noise floor of an AudioBuffer by:
 * 1. Splitting the buffer into fixed-size frames.
 * 2. Computing the RMS of each frame (averaged across all channels).
 * 3. Sorting frame RMS values ascending and taking the quietest
 *    PERCENTILE fraction as representative noise frames.
 * 4. Averaging those frames' RMS to produce a noise floor estimate.
 *
 * The analysis does NOT assume silence at the start or end of the file.
 * It is robust to recordings where noise appears throughout.
 */
export class NoiseProfileAnalyzer {
  static analyze(buffer: AudioBuffer): NoiseProfile {
    const { numberOfChannels, length } = buffer;
    const numFrames = Math.floor(length / FRAME_SIZE);

    if (numFrames === 0) {
      return {
        noiseFloorDb:     -96,
        noiseThresholdDb: -96 + HEADROOM_DB,
        noiseFramesUsed:  0,
        averageNoiseRms:  0,
      };
    }

    const frameRms: number[] = new Array(numFrames);

    for (let f = 0; f < numFrames; f++) {
      const start = f * FRAME_SIZE;
      let sumSq = 0;
      for (let ch = 0; ch < numberOfChannels; ch++) {
        const data = buffer.getChannelData(ch);
        for (let i = start; i < start + FRAME_SIZE; i++) {
          sumSq += data[i] * data[i];
        }
      }
      frameRms[f] = Math.sqrt(sumSq / (FRAME_SIZE * numberOfChannels));
    }

    // Ascending sort — noise frames have the lowest RMS
    const sorted = frameRms.slice().sort((a, b) => a - b);

    const noiseCount    = Math.max(1, Math.floor(sorted.length * PERCENTILE));
    let   sumNoiseRms   = 0;
    for (let i = 0; i < noiseCount; i++) sumNoiseRms += sorted[i];

    const averageNoiseRms = sumNoiseRms / noiseCount;
    const noiseFloorDb    = averageNoiseRms > 1e-9
      ? 20 * Math.log10(averageNoiseRms)
      : -96;

    return {
      noiseFloorDb,
      noiseThresholdDb: noiseFloorDb + HEADROOM_DB,
      noiseFramesUsed:  noiseCount,
      averageNoiseRms,
    };
  }
}
