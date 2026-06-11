import { NoiseProfileAnalyzer } from "./NoiseProfileAnalyzer";
import type { AudioAnalysisReport } from "./types";

const linToDb = (lin: number): number =>
  lin > 0 ? 20 * Math.log10(lin) : -Infinity;

export class AudioAnalyzer {
  /**
   * Analyze an AudioBuffer and return peak, RMS, noise-floor estimate,
   * SNR, and basic metadata. Does NOT mutate the buffer.
   *
   * estimatedNoiseFloorDb is now sourced from NoiseProfileAnalyzer so it
   * matches the value used by NoiseReducer during processing.
   */
  static analyze(buffer: AudioBuffer): AudioAnalysisReport {
    const { numberOfChannels, sampleRate, duration } = buffer;

    let peakLinear       = 0;
    let sumSq            = 0;
    let totalSamples     = 0;
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
    const rmsDb     = linToDb(rmsLinear);

    const profile               = NoiseProfileAnalyzer.analyze(buffer);
    const estimatedNoiseFloorDb = profile.noiseFloorDb;
    const snrDb                 = rmsDb - estimatedNoiseFloorDb;

    return {
      peakDb: linToDb(peakLinear),
      rmsDb,
      estimatedNoiseFloorDb,
      snrDb,
      durationSec:    duration,
      sampleRate,
      numberOfChannels,
      clippingDetected,
    };
  }
}
