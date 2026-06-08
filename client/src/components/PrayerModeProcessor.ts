import { SilenceProcessor } from './SilenceProcessor';
import { SmartPrayerAnalyzer } from './SmartPrayerAnalyzer';
import { SmartPrayerDecisionEngine } from './SmartPrayerDecisionEngine';
import { AudioTrimmerEngine } from './AudioTrimmerEngine';

export interface PrayerModeResult {
  buffer:       AudioBuffer;
  removedCount: number;
  removedSec:   number;
  originalSec:  number;
  finalSec:     number;
}

export async function processPrayerMode(
  audioUrl:    string,
  audioBuffer: AudioBuffer,
  onProgress?: (pct: number, stage: string) => void,
): Promise<PrayerModeResult> {

  // 1. كشف الصمت والحصول على rmsFrames
  onProgress?.(5, 'تحليل الملف الصوتي...');
  const { report } = await SilenceProcessor.process(
    audioUrl,
    {
      thresholdDb:        -20,
      minSilenceDuration: 0.3,
      replacementGap:     0,
    },
    ({ percent }) => onProgress?.(5 + percent * 0.4, 'كشف فترات الصمت...'),
  );

  // 2. تحليل ذكي للمقاطع
  onProgress?.(50, 'تحليل الأركان والتكبيرات...');
  const rawSegments = report.removedSegments ?? [];
  const rmsFrames   = report.rmsFrames ?? new Float32Array(0);

  if (rawSegments.length === 0) {
    return {
      buffer:       audioBuffer,
      removedCount: 0,
      removedSec:   0,
      originalSec:  audioBuffer.duration,
      finalSec:     audioBuffer.duration,
    };
  }

  const enriched = SmartPrayerAnalyzer.analyze(
    rawSegments.map((s, i) => ({
      id:          `pm-${i}`,
      startSec:    s.startSec,
      endSec:      s.endSec,
      durationSec: s.durationSec,
      enabled:     true,
    })),
    rmsFrames,
    {
      thresholdDb: -20,
      sampleRate:  audioBuffer.sampleRate,
      windowSize:  2048,
    },
  );

  // 3. قرار الحذف
  onProgress?.(70, 'تحديد ما يُحذف...');
  const { segments: decided } = SmartPrayerDecisionEngine.decide(
    enriched,
    audioBuffer.duration,
    {
      maxRemovableRatio: 0.85,
      preTailSec:        0.1,
      postTailSec:       0.1,
    },
  );

  const deleteRanges = SmartPrayerDecisionEngine.toDeleteRanges(decided);

  if (deleteRanges.length === 0) {
    return {
      buffer:       audioBuffer,
      removedCount: 0,
      removedSec:   0,
      originalSec:  audioBuffer.duration,
      finalSec:     audioBuffer.duration,
    };
  }

  // 4. تطبيق الحذف
  onProgress?.(85, 'تطبيق الحذف...');
  const outBuffer = await AudioTrimmerEngine.deleteMultipleRanges(
    audioBuffer,
    deleteRanges,
    0,
    0.02,
  );

  const removedSec = Math.max(0, audioBuffer.duration - outBuffer.duration);
  onProgress?.(100, 'اكتمل');

  return {
    buffer:       outBuffer,
    removedCount: deleteRanges.length,
    removedSec,
    originalSec:  audioBuffer.duration,
    finalSec:     outBuffer.duration,
  };
}
