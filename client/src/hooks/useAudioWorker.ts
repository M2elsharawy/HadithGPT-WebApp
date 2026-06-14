import { useRef, useCallback } from 'react';
import type { WorkerRequest, WorkerResponse } from '../workers/audio-processor.worker';
import type { EnhancementOptions } from '../components/enhancement/types';
import { AudioEnhancementEngine } from '../components/enhancement/AudioEnhancementEngine';
import { isAudioWorkerCapabilityError } from '../utils/audioWorkerCapabilityError';

type ProgressCallback = (percent: number, stage: string) => void;

let requestCounter = 0;

export function useAudioWorker() {
  const workerRef = useRef<Worker | null>(null);
  const pendingRef = useRef<Map<number, {
    resolve: (val: unknown) => void;
    reject:  (err: Error)  => void;
    onProgress?: ProgressCallback;
  }>>(new Map());

  const getWorker = useCallback((): Worker => {
    if (!workerRef.current) {
      workerRef.current = new Worker(
        new URL('../workers/audio-processor.worker.ts', import.meta.url),
        { type: 'module' },
      );
      workerRef.current.onmessage = (e: MessageEvent<WorkerResponse>) => {
        const res = e.data;
        const pending = pendingRef.current.get(res.id);
        if (!pending) return;

        if (res.type === 'progress') {
          pending.onProgress?.(res.percent, res.stage);
        } else if (res.type === 'error') {
          pendingRef.current.delete(res.id);
          pending.reject(new Error(res.message));
        } else {
          pendingRef.current.delete(res.id);
          pending.resolve(res);
        }
      };
      workerRef.current.onerror = (e) => {
        console.error('[AudioWorker]', e.message);
      };
    }
    return workerRef.current;
  }, []);

  const runEnhance = useCallback(async (
    buffer: AudioBuffer,
    options: EnhancementOptions,
    onProgress?: ProgressCallback,
  ): Promise<Extract<WorkerResponse, { type: 'enhance-done' }>> => {
    const id = ++requestCounter;

    const channels: Float32Array<ArrayBuffer>[] = [];
    for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
      channels.push(buffer.getChannelData(ch).slice() as Float32Array<ArrayBuffer>);
    }

    try {
      const worker = getWorker();
      return await new Promise<Extract<WorkerResponse, { type: 'enhance-done' }>>((resolve, reject) => {
        pendingRef.current.set(id, { resolve: resolve as (v: unknown) => void, reject, onProgress });
        const req: WorkerRequest = {
          id, type: 'enhance',
          channels,
          sampleRate: buffer.sampleRate,
          numberOfChannels: buffer.numberOfChannels,
          length: buffer.length,
          options,
        };
        worker.postMessage(req, channels.map(c => c.buffer));
      });
    } catch (err) {
      // Only fall back for known Web Audio API constructor unavailability.
      // All other errors (DSP failures, invalid input, etc.) propagate normally.
      if (!isAudioWorkerCapabilityError(err)) throw err;

      // Worker runtime lacks AudioBuffer/OfflineAudioContext — run the same
      // engine on the main thread where browser Web Audio APIs are available.
      const result = await AudioEnhancementEngine.enhanceAudio(buffer, options, onProgress);
      const outChannels: Float32Array<ArrayBuffer>[] = [];
      for (let ch = 0; ch < result.processedBuffer.numberOfChannels; ch++) {
        outChannels.push(
          result.processedBuffer.getChannelData(ch).slice() as Float32Array<ArrayBuffer>,
        );
      }
      return {
        id,
        type: 'enhance-done',
        channels: outChannels,
        duration: result.processedBuffer.duration,
        report: result.report,
      };
    }
  }, [getWorker]);

  const terminate = useCallback(() => {
    workerRef.current?.terminate();
    workerRef.current = null;
  }, []);

  return { runEnhance, terminate };
}
