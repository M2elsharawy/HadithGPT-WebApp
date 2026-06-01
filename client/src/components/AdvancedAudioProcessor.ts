/**
 * AdvancedAudioProcessor — stub
 */
export class AdvancedAudioProcessor {
  constructor(
    private ctx: AudioContext,
    private source: AudioNode,
  ) {}

  setEQBand(_band: number, _gainDb: number): void {}
  setEQGain(_band: number, _gainDb: number): void {}
  applyPreset(_preset: string): void {}
  setCompressor(_settings: object): void {}
  setReverb(_wet: number): void {}
  reset(): void {}
  resetEQ(): void {}
  getAnalyserNode(): AnalyserNode | null { return null; }
  getWaveformData(): Float32Array { return new Float32Array(0); }
}
