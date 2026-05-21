import React, { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Download, RotateCcw } from 'lucide-react';
import { AudioTrimmer } from './AudioTrimmer';

interface TrimmerPanelProps {
  audioBuffer: AudioBuffer | null;
  audioContext: AudioContext | null;
  analyserNode: AnalyserNode | null;
  audioUrl?: string; // Phase F-3f: Add audio URL prop for native playback
  onTrimComplete?: (blob: Blob) => void;
  onTrimChange?: (startTime: number, endTime: number) => void;
  trimStart?: number;
  trimEnd?: number;
}

export default function TrimmerPanel({ 
  audioBuffer, 
  audioContext, 
  analyserNode, 
  audioUrl, // Phase F-3f: Accept audioUrl
  onTrimComplete, 
  onTrimChange, 
  trimStart = 0, 
  trimEnd = 0 
}: TrimmerPanelProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [trimmer, setTrimmer] = useState<AudioTrimmer | null>(null);
  const [startTime, setStartTime] = useState(0);
  const [endTime, setEndTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [waveformError, setWaveformError] = useState<string>(); // Phase F-3f: Track waveform errors

  useEffect(() => {
    if (audioBuffer && audioContext) {
      const newTrimmer = new AudioTrimmer(audioContext);
      newTrimmer.loadAudioBuffer(audioBuffer);
      setTrimmer(newTrimmer);
      setDuration(newTrimmer.getDuration());
      setEndTime(newTrimmer.getDuration());
      setWaveformError(undefined);
    } else {
      setTrimmer(null);
      setDuration(0);
      setStartTime(0);
      setEndTime(0);
    }
  }, [audioBuffer, audioContext]);

  // Phase F-3f: Handle audio element load
  useEffect(() => {
    if (!audioRef.current || !audioUrl) return;
    
    const handleLoadedMetadata = () => {
      const dur = audioRef.current?.duration ?? 0;
      if (dur > 0) {
        setDuration(dur);
        setEndTime(dur);
        setWaveformError(undefined);
      }
    };

    const handleError = () => {
      console.error('[TrimmerPanel] Audio element error:', audioUrl);
      // Phase F-3f: Only show error if file truly cannot load
      if (audioRef.current?.error) {
        setWaveformError('تعذر تحميل الملف الصوتي');
      }
    };

    audioRef.current.addEventListener('loadedmetadata', handleLoadedMetadata);
    audioRef.current.addEventListener('error', handleError);
    audioRef.current.src = audioUrl;

    return () => {
      audioRef.current?.removeEventListener('loadedmetadata', handleLoadedMetadata);
      audioRef.current?.removeEventListener('error', handleError);
    };
  }, [audioUrl]);

  const handleStartTimeChange = (value: number[]) => {
    const newStartTime = value[0];
    setStartTime(newStartTime);
    if (trimmer) {
      trimmer.setStartTime(newStartTime);
    }
    onTrimChange?.(newStartTime, endTime);
  };

  const handleEndTimeChange = (value: number[]) => {
    const newEndTime = value[0];
    setEndTime(newEndTime);
    if (trimmer) {
      trimmer.setEndTime(newEndTime);
    }
    onTrimChange?.(startTime, newEndTime);
  };

  const handleTrim = async () => {
    if (!trimmer) return;

    setIsLoading(true);
    try {
      const blob = trimmer.exportAsWav();
      if (blob && onTrimComplete) {
        onTrimComplete(blob);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleReset = () => {
    if (trimmer) {
      trimmer.reset();
      setStartTime(0);
      setEndTime(duration);
    }
  };

  const handleTrimStartClick = (time: number) => {
    const newStartTime = Math.max(0, Math.min(time, endTime - 0.1));
    setStartTime(newStartTime);
    if (trimmer) {
      trimmer.setStartTime(newStartTime);
    }
    onTrimChange?.(newStartTime, endTime);
  };

  const handleTrimEndClick = (time: number) => {
    const newEndTime = Math.max(startTime + 0.1, Math.min(time, duration));
    setEndTime(newEndTime);
    if (trimmer) {
      trimmer.setEndTime(newEndTime);
    }
    onTrimChange?.(startTime, newEndTime);
  };

  const handleCanvasClick = (time: number) => {
    if (audioRef.current) {
      audioRef.current.currentTime = Math.max(0, Math.min(time, duration));
    }
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const trimmedDuration = endTime - startTime;

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>تقطيع الصوت</CardTitle>
        <CardDescription>حدد جزء الملف الذي تريد الاحتفاظ به</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">

        {/* Phase F-3f: Add hidden audio element for native playback */}
        <audio
          ref={audioRef}
          crossOrigin="anonymous"
          className="hidden"
        />

        {/* Phase F-3f: Show error only if file truly cannot load */}
        {waveformError && duration === 0 && (
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded p-3">
            <p className="text-sm text-red-700 dark:text-red-300">{waveformError}</p>
          </div>
        )}

        {/* Phase F-3f: Show graceful fallback if audio loads but waveform fails */}
        {audioUrl && duration > 0 && (!audioContext || !analyserNode) && (
          <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded p-3">
            <p className="text-sm text-amber-700 dark:text-amber-300">
              تعذر عرض الموجة الصوتية، لكن يمكن تشغيل الصوت واستخدام التحديد بالوقت
            </p>
          </div>
        )}

        {/* حالة: لا يوجد ملف صوتي محمّل بعد */}
        {!audioBuffer && !audioUrl && (
          <div className="bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 rounded-lg p-4">
            <p className="text-sm text-amber-700 dark:text-amber-300">
              جاري تحميل الملف الصوتي للتقطيع...
            </p>
          </div>
        )}

        {/* عرض المدة */}
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-slate-100 dark:bg-slate-800 p-3 rounded">
            <p className="text-sm text-slate-600 dark:text-slate-400">المدة الكلية</p>
            <p className="text-lg font-semibold">{formatTime(duration)}</p>
          </div>
          <div className="bg-blue-100 dark:bg-blue-900 p-3 rounded">
            <p className="text-sm text-blue-600 dark:text-blue-400">المدة المقطوعة</p>
            <p className="text-lg font-semibold">{formatTime(trimmedDuration)}</p>
          </div>
          <div className="bg-green-100 dark:bg-green-900 p-3 rounded">
            <p className="text-sm text-green-600 dark:text-green-400">النسبة المئوية</p>
            <p className="text-lg font-semibold">
              {duration > 0 ? ((trimmedDuration / duration) * 100).toFixed(1) : '0.0'}%
            </p>
          </div>
        </div>

        {/* نقطة البداية */}
        <div className="space-y-3">
          <div className="flex justify-between items-center">
            <label className="text-sm font-medium">نقطة البداية</label>
            <span className="text-sm font-mono bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded">
              {formatTime(startTime)}
            </span>
          </div>
          <Slider
            value={[startTime]}
            min={0}
            max={Math.max(endTime - 0.1, 0)}
            step={0.1}
            onValueChange={handleStartTimeChange}
            disabled={!trimmer}
            className="w-full"
          />
        </div>

        {/* نقطة النهاية */}
        <div className="space-y-3">
          <div className="flex justify-between items-center">
            <label className="text-sm font-medium">نقطة النهاية</label>
            <span className="text-sm font-mono bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded">
              {formatTime(endTime)}
            </span>
          </div>
          <Slider
            value={[endTime]}
            min={Math.min(startTime + 0.1, duration)}
            max={duration}
            step={0.1}
            onValueChange={handleEndTimeChange}
            disabled={!trimmer}
            className="w-full"
          />
        </div>

        {/* الأزرار */}
        <div className="flex gap-3">
          <Button
            onClick={handleTrim}
            disabled={isLoading || !trimmer}
            className="flex-1 bg-blue-600 hover:bg-blue-700"
          >
            <Download className="w-4 h-4 mr-2" />
            {isLoading ? 'جاري التقطيع...' : 'تقطيع وتحميل'}
          </Button>
          <Button
            onClick={handleReset}
            variant="outline"
            className="flex-1"
            disabled={!trimmer}
          >
            <RotateCcw className="w-4 h-4 mr-2" />
            إعادة تعيين
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
