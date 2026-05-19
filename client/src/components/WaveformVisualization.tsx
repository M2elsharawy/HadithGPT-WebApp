import { useEffect, useState } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { useAudioAnalyzer } from "./AudioAnalyzer";

interface WaveformVisualizationProps {
  isPlaying?: boolean;
}

export function WaveformVisualization({ isPlaying }: WaveformVisualizationProps) {
  const [waveformData, setWaveformData] = useState<Array<{ time: number; amplitude: number }>>([]);
  const { analyser, waveformData: waveformBuffer } = useAudioAnalyzer();

  useEffect(() => {
    if (!analyser || !isPlaying) return;

    const generateWaveform = () => {
      analyser.getByteTimeDomainData(waveformBuffer as any);

      const data = Array.from(waveformBuffer)
        .slice(0, 100)
        .map((value, index) => ({
          time: index,
          amplitude: (value / 255) * 100,
        }));

      setWaveformData(data);
    };

    const interval = setInterval(generateWaveform, 100);
    return () => clearInterval(interval);
  }, [analyser, isPlaying, waveformBuffer]);

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
