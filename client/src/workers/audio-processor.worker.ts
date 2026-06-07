// eslint-disable-next-line @typescript-eslint/triple-slash-reference
/// <reference lib="webworker" />

import { SilenceProcessor } from '../components/SilenceProcessor';
import { AudioEnhancementEngine } from '../components/enhancement/AudioEnhancementEngine';
import type { SilenceProcessorOptions, SilenceProcessorReport } from '../components/SilenceProcessor';
import type { EnhancementOptions, EnhancementReport } from '../components/enhancement/types';

export type WorkerRequest =
  | {
      id: number;
      type: 'silence';
      audioUrl: string;
      options: Partial<SilenceProcessorOptions>;
    }
  | {
      id: number;
      type: 'enhance';
      channels: Float32Array<ArrayBuffer>[];
      sampleRate: number;
      numberOfChannels: number;
      length: number;
      options: EnhancementOptions;
    };

export type WorkerResponse =
  | { id: number; type: 'progress'; percent: number; stage: string }
  | { id: number; type: 'silence-done'; report: SilenceProcessorReport }
  | { id: number; type: 'enhance-done'; channels: Float32Array<ArrayBuffer>[]; duration: number; report: EnhancementReport }
  | { id: number; type: 'error'; message: string };

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const req = e.data;

  const sendProgress = (percent: number, stage: string) => {
    self.postMessage({ id: req.id, type: 'progress', percent, stage } satisfies WorkerResponse);
  };

  try {
    if (req.type === 'silence') {
      const { report } = await SilenceProcessor.process(
        req.audioUrl,
        req.options,
        ({ percent, stage }) => sendProgress(percent, stage),
      );
      self.postMessage({ id: req.id, type: 'silence-done', report } satisfies WorkerResponse);

    } else if (req.type === 'enhance') {
      const ctx = new OfflineAudioContext(
        req.numberOfChannels,
        req.length,
        req.sampleRate,
      );
      const buffer = ctx.createBuffer(req.numberOfChannels, req.length, req.sampleRate);
      for (let ch = 0; ch < req.numberOfChannels; ch++) {
        buffer.copyToChannel(req.channels[ch], ch);
      }

      const result = await AudioEnhancementEngine.enhanceAudio(
        buffer,
        req.options,
        (pct, stage) => sendProgress(pct, stage),
      );

      const outChannels: Float32Array<ArrayBuffer>[] = [];
      for (let ch = 0; ch < result.processedBuffer.numberOfChannels; ch++) {
        outChannels.push(result.processedBuffer.getChannelData(ch).slice() as Float32Array<ArrayBuffer>);
      }

      self.postMessage(
        {
          id: req.id,
          type: 'enhance-done',
          channels: outChannels,
          duration: result.processedBuffer.duration,
          report: result.report,
        } satisfies WorkerResponse,
        outChannels.map(c => c.buffer),
      );
    }
  } catch (err) {
    self.postMessage({
      id: req.id,
      type: 'error',
      message: err instanceof Error ? err.message : String(err),
    } satisfies WorkerResponse);
  }
};
