import { useEffect, useState } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { useAudioAnalyzer } from "./AudioAnalyzer";

interface WaveformVisualizationProps {
  isPlaying?: boolean;
  fileName?: string; // Phase F-3f: Add for logging
}

export function WaveformVisualization({ isPlaying, fileName }: WaveformVisualizationProps) {
  const [waveformData, setWaveformData] = useState<Array<{ time: number; amplitude: number }>>([]);
  const [analyserError, setAnalyserError] = useState<string>(); // Phase F-3f: Track analyser errors
  const { analyser, waveformData: waveformBuffer, error: contextError } = useAudioAnalyzer();

  useEffect(() => {
    if (!analyser || !isPlaying) return;

    const generateWaveform = () => {
      try {
        analyser.getByteTimeDomainData(waveformBuffer as any);

        // Phase F-3f: Check if waveform has actual data (not all zeros)
        const hasData = Array.from(waveformBuffer).some(v => v !== 128); // 128 is silence
        if (!hasData) {
          console.log('[WaveformVisualization] Analyser receiving zero data:', {
            fileName,
            bufferLength: waveformBuffer.length,
          });
          setAnalyserError('تعذر عرض الموجة الصوتية — قد تكون هناك قيود CORS');
          return;
        }

        const data = Array.from(waveformBuffer)
          .slice(0, 100)
          .map((value, index) => ({
            time: index,
            amplitude: (value / 255) * 100,
          }));

        setWaveformData(data);
        setAnalyserError(undefined);
      } catch (err) {
        console.error('[WaveformVisualization] Error generating waveform:', {
          error: err,
          fileName,
        });
        setAnalyserError('خطأ في معالجة الموجة الصوتية');
      }
    };

    const interval = setInterval(generateWaveform, 100);
    return () => clearInterval(interval);
  }, [analyser, isPlaying, waveformBuffer, fileName]);

  // Phase F-3f: Show graceful fallback if analyser not available
  if (!analyser) {
    return (
      <div className="w-full h-64 bg-slate-100 dark:bg-slate-800 rounded-lg p-4 flex items-center justify-center">
        <div className="text-center">
          <p className="text-sm text-amber-700 dark:text-amber-300">
            تعذر عرض الموجة الصوتية
          </p>
          <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
            — معاينة تقريبية
          </p>
        </div>
      </div>
    );
  }

  // Phase F-3f: Show error if analyser has no data
  if (analyserError && isPlaying) {
    return (
      <div className="w-full h-64 bg-slate-100 dark:bg-slate-800 rounded-lg p-4 flex items-center justify-center">
        <div className="text-center">
          <p className="text-sm text-amber-700 dark:text-amber-300">
            {analyserError}
          </p>
          <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
            — معاينة تقريبية
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full h-64 bg-slate-100 dark:bg-slate-800 rounded-lg p-4">
      {waveformData.length > 0 ? (
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={waveformData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#cbd5e1" />
            <XAxis dataKey="time" stroke="#94a3b8" />
            <YAxis stroke="#94a3b8" domain={[0, 100]} />
            <Tooltip
              contentStyle={{
                backgroundColor: "#1e293b",
                border: "1px solid #475569",
                borderRadius: "0.5rem",
              }}
              labelStyle={{ color: "#e2e8f0" }}
            />
            <Line
              type="monotone"
              dataKey="amplitude"
              stroke="#3b82f6"
              dot={false}
              strokeWidth={2}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      ) : (
        <div className="flex items-center justify-center h-full text-slate-600 dark:text-slate-400">
          <p>شغّل الملف الصوتي لعرض الموجة</p>
        </div>
      )}
    </div>
  );
}
