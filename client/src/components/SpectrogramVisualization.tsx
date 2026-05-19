import { useEffect, useState } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { useAudioAnalyzer } from "./AudioAnalyzer";

interface SpectrogramVisualizationProps {
  isPlaying?: boolean;
}

export function SpectrogramVisualization({ isPlaying }: SpectrogramVisualizationProps) {
  const [spectrogramData, setSpectrogramData] = useState<Array<{ freq: number; magnitude: number }>>([]);
  const { analyser, frequencyData } = useAudioAnalyzer();

  useEffect(() => {
    if (!analyser || !isPlaying) return;

    const generateSpectrogram = () => {
      analyser.getByteFrequencyData(frequencyData as any);

      const data = Array.from(frequencyData)
        .slice(0, 50)
        .map((value, index) => ({
          freq: index * 10,
          magnitude: (value / 255) * 100,
        }));

      setSpectrogramData(data);
    };

    const interval = setInterval(generateSpectrogram, 100);
    return () => clearInterval(interval);
  }, [analyser, isPlaying, frequencyData]);

  return (
    <div className="w-full h-64 bg-slate-100 dark:bg-slate-800 rounded-lg p-4">
      {spectrogramData.length > 0 ? (
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={spectrogramData}>
            <CartesianGrid strokeDasharray="3 3" stroke="#cbd5e1" />
            <XAxis dataKey="freq" stroke="#94a3b8" />
            <YAxis stroke="#94a3b8" domain={[0, 100]} />
            <Tooltip
              contentStyle={{
                backgroundColor: "#1e293b",
                border: "1px solid #475569",
                borderRadius: "0.5rem",
              }}
              labelStyle={{ color: "#e2e8f0" }}
            />
            <Bar
              dataKey="magnitude"
              fill="#8b5cf6"
              isAnimationActive={false}
              radius={[4, 4, 0, 0]}
            />
          </BarChart>
        </ResponsiveContainer>
      ) : (
        <div className="flex items-center justify-center h-full text-slate-600 dark:text-slate-400">
          <p>شغّل الملف الصوتي لعرض الطيف الترددي</p>
        </div>
      )}
    </div>
  );
}
