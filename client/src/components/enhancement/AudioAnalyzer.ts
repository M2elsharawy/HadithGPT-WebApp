import type { AudioAnalysisReport } from "./types";

const linToDb = (lin: number): number =>
  lin > 0 ? 20 * Math.log10(lin) : -Infinity;

export class AudioAnalyzer {
  /**
   * Analyze an AudioBuffer and return peak, RMS, noise-floor estimate,
   * and basic metadata. Does NOT mutate the buffer.
   */
  static analyze(buffer: AudioBuffer): AudioAnalysisReport {
    const { numberOfChannels, sampleRate, length, duration } = buffer;

    let peakLinear = 0;
    let sumSq      = 0;
    let totalSamples = 0;
    let clippingDetected = false;

    for (let ch = 0; ch < numberOfChannels; ch++) {
      const data = buffer.getChannelData(ch);
      for (let i = 0; i < data.length; i++) {
        const abs = Math.abs(data[i]);
        if (abs > peakLinear) peakLinear = abs;
        if (abs >= 0.9999)    clippingDetected = true;
        sumSq += data[i] * data[i];
        totalSamples++;
      }
    }

    const rmsLinear = totalSamples > 0 ? Math.sqrt(sumSq / totalSamples) : 0;

    // Noise-floor: 10th percentile of 100 ms windowed RMS (ch 0 only)
    const windowFrames = Math.floor(sampleRate * 0.1);
    const numWindows   = Math.max(1, Math.floor(length / windowFrames));
    const ch0          = buffer.getChannelData(0);
    const windowRms: number[] = [];

    for (let w = 0; w < numWindows; w++) {
      let wSumSq = 0;
      const start = w * windowFrames;
      const end   = Math.min(start + windowFrames, length);
      for (let i = start; i < end; i++) wSumSq += ch0[i] * ch0[i];
      windowRms.push(Math.sqrt(wSumSq / (end - start)));
    }

    windowRms.sort((a, b) => a - b);
    const pctIdx        = Math.floor(windowRms.length * 0.10);
    const noiseFloorLin = windowRms[pctIdx] ?? windowRms[0] ?? 0;

    return {
      peakDb:                linToDb(peakLinear),
      rmsDb:                 linToDb(rmsLinear),
      estimatedNoiseFloorDb: linToDb(noiseFloorLin),
      durationSec:           duration,
      sampleRate,
      numberOfChannels,
      clippingDetected,
    };
  }
}
