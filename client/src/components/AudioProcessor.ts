/**
 * AudioProcessor — stub
 * يوفر الـ API المطلوب من Tools.tsx بدون crash
 */
export class AudioProcessor {
  constructor(
    private audio: HTMLAudioElement,
    private ctx: AudioContext,
    private source: MediaElementAudioSourceNode,
  ) {}

  initialize(): void {}
  removeNoise(): void {}
  enhanceClarity(): void {}
  applyEqualizer(): void {}
  applyCompression(): void {}
  resetEffects(): void {}
}
