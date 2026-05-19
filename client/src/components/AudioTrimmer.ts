/**
 * AudioTrimmer - مكون لتقطيع الملفات الصوتية
 * يوفر واجهة لتحديد نقاط البداية والنهاية وتصدير الجزء المقطوع
 */

export class AudioTrimmer {
  private audioContext: AudioContext;
  private audioBuffer: AudioBuffer | null = null;
  private startTime: number = 0;
  private endTime: number = 0;

  constructor(audioContext: AudioContext) {
    this.audioContext = audioContext;
  }

  /**
   * تحميل ملف صوتي من ArrayBuffer مُشفَّر (MP3/WAV/OGG)
   */
  async loadAudio(arrayBuffer: ArrayBuffer): Promise<void> {
    this.audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
    this.endTime = this.audioBuffer.duration;
  }

  /**
   * تحميل AudioBuffer جاهز مباشرةً (بدون إعادة فك التشفير)
   */
  loadAudioBuffer(audioBuffer: AudioBuffer): void {
    this.audioBuffer = audioBuffer;
    this.startTime = 0;
    this.endTime = audioBuffer.duration;
  }

  /**
   * تعيين نقطة البداية
   */
  setStartTime(time: number): void {
    if (time >= 0 && time < this.endTime) {
      this.startTime = time;
    }
  }

  /**
   * تعيين نقطة النهاية
   */
  setEndTime(time: number): void {
    if (time > this.startTime && time <= (this.audioBuffer?.duration || 0)) {
      this.endTime = time;
    }
  }

  /**
   * الحصول على المدة الكلية للملف
   */
  getDuration(): number {
    return this.audioBuffer?.duration || 0;
  }

  /**
   * الحصول على مدة الجزء المقطوع
   */
  getTrimmedDuration(): number {
    return this.endTime - this.startTime;
  }

  /**
   * تقطيع الملف الصوتي وإرجاع AudioBuffer الجديد
   */
  trim(): AudioBuffer | null {
    if (!this.audioBuffer) return null;

    const sampleRate = this.audioBuffer.sampleRate;
    const startSample = Math.floor(this.startTime * sampleRate);
    const endSample = Math.floor(this.endTime * sampleRate);
    const trimmedLength = endSample - startSample;

    const trimmedBuffer = this.audioContext.createBuffer(
      this.audioBuffer.numberOfChannels,
      trimmedLength,
      sampleRate
    );

    for (let channel = 0; channel < this.audioBuffer.numberOfChannels; channel++) {
      const sourceData = this.audioBuffer.getChannelData(channel);
      const targetData = trimmedBuffer.getChannelData(channel);
      targetData.set(sourceData.slice(startSample, endSample));
    }

    return trimmedBuffer;
  }

  /**
   * تحويل AudioBuffer إلى WAV ArrayBuffer
   */
  audioBufferToWav(audioBuffer: AudioBuffer): ArrayBuffer {
    const numberOfChannels = audioBuffer.numberOfChannels;
    const sampleRate = audioBuffer.sampleRate;
    const format = 1; // PCM
    const bitDepth = 16;

    const bytesPerSample = bitDepth / 8;
    const blockAlign = numberOfChannels * bytesPerSample;

    const channelData: Float32Array[] = [];
    for (let i = 0; i < numberOfChannels; i++) {
      channelData.push(audioBuffer.getChannelData(i));
    }

    const interleaved = new Float32Array(audioBuffer.length * numberOfChannels);
    let index = 0;
    const channelLength = audioBuffer.length;

    for (let i = 0; i < channelLength; i++) {
      for (let channel = 0; channel < numberOfChannels; channel++) {
        interleaved[index++] = channelData[channel][i];
      }
    }

    const dataLength = interleaved.length * bytesPerSample;
    const buffer = new ArrayBuffer(44 + dataLength);
    const view = new DataView(buffer);

    const writeString = (offset: number, string: string) => {
      for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
      }
    };

    const floatTo16BitPCM = (output: DataView, offset: number, input: Float32Array) => {
      for (let i = 0; i < input.length; i++, offset += 2) {
        const s = Math.max(-1, Math.min(1, input[i]));
        output.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      }
    };

    writeString(0, 'RIFF');
    view.setUint32(4, 36 + dataLength, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true); // subchunk1size
    view.setUint16(20, format, true);
    view.setUint16(22, numberOfChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * blockAlign, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitDepth, true);
    writeString(36, 'data');
    view.setUint32(40, dataLength, true);
    floatTo16BitPCM(view, 44, interleaved);

    return buffer;
  }

  /**
   * تصدير الملف المقطوع كـ WAV
   */
  exportAsWav(): Blob | null {
    const trimmedBuffer = this.trim();
    if (!trimmedBuffer) return null;

    const wavBuffer = this.audioBufferToWav(trimmedBuffer);
    return new Blob([wavBuffer], { type: 'audio/wav' });
  }

  /**
   * إعادة تعيين
   */
  reset(): void {
    this.audioBuffer = null;
    this.startTime = 0;
    this.endTime = 0;
  }
}
