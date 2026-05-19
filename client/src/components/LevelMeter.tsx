import { useEffect, useRef, useState } from "react";
import { Card } from "@/components/ui/card";
import type { AdvancedAudioProcessor } from "./AdvancedAudioProcessor";

interface LevelMeterProps {
  processor: AdvancedAudioProcessor | null;
  isPlaying: boolean;
}

export function LevelMeter({ processor, isPlaying }: LevelMeterProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animationRef = useRef<number | undefined>(undefined);
  const [levels, setLevels] = useState({ left: 0, right: 0, peak: 0 });

  useEffect(() => {
    if (!processor || !canvasRef.current || !isPlaying) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const draw = () => {
      const data = processor.getWaveformData();
      let sum = 0;
      let peak = 0;

      // Calculate RMS and peak levels
      for (let i = 0; i < data.length; i++) {
        const normalized = (data[i] - 128) / 128;
        sum += normalized * normalized;
        peak = Math.max(peak, Math.abs(normalized));
      }

      const rms = Math.sqrt(sum / data.length);
      const db = 20 * Math.log10(Math.max(rms, 0.001));
      const normalizedDb = Math.max(0, Math.min(1, (db + 60) / 60));

      setLevels({
        left: normalizedDb * 100,
        right: normalizedDb * 100,
        peak: peak * 100,
      });

      // Draw canvas
      const width = canvas.width;
      const height = canvas.height;

      // Clear canvas
      ctx.fillStyle = "#0f172a";
      ctx.fillRect(0, 0, width, height);

      // Draw grid
      ctx.strokeStyle = "#334155";
      ctx.lineWidth = 1;
      for (let i = 0; i <= 10; i++) {
        const x = (i / 10) * width;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
        ctx.stroke();
      }

      // Draw level bars
      const barHeight = height / 2 - 10;
      const barWidth = (normalizedDb * width) / 1.2;

      // Left channel
      ctx.fillStyle = normalizedDb > 0.9 ? "#ef4444" : "#3b82f6";
      ctx.fillRect(10, 10, barWidth, barHeight);

      // Right channel (same as left for mono)
      ctx.fillRect(10, barHeight + 20, barWidth, barHeight);

      // Draw labels
      ctx.fillStyle = "#94a3b8";
      ctx.font = "12px Arial";
      ctx.fillText("L", 0, 20);
      ctx.fillText("R", 0, barHeight + 30);

      // Draw dB values
      ctx.fillStyle = "#e2e8f0";
      ctx.fillText(`${Math.round(db)} dB`, width - 60, 20);

      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };

    animationRef.current = requestAnimationFrame(draw);

    return () => {
      if (animationRef.current !== undefined) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [processor, isPlaying]);

  return (
    <Card className="p-4 bg-slate-900 border-slate-700">
      <div className="space-y-3">
        <h4 className="text-sm font-semibold text-white">مستويات الصوت</h4>

        {/* Waveform Canvas */}
        <canvas
          ref={canvasRef}
          width={400}
          height={120}
          className="w-full border border-slate-700 rounded-lg"
        />

        {/* Level Indicators */}
        <div className="grid grid-cols-3 gap-4">
          <div className="text-center">
            <p className="text-xs text-slate-400">القناة اليسرى</p>
            <div className="mt-2 h-8 bg-slate-800 rounded flex items-center justify-center">
              <div
                className="h-full bg-gradient-to-r from-blue-500 to-blue-400 rounded transition-all"
                style={{ width: `${levels.left}%` }}
              />
              <span className="text-xs text-white ml-2 absolute">
                {levels.left.toFixed(0)}%
              </span>
            </div>
          </div>

          <div className="text-center">
            <p className="text-xs text-slate-400">القناة اليمنى</p>
            <div className="mt-2 h-8 bg-slate-800 rounded flex items-center justify-center">
              <div
                className="h-full bg-gradient-to-r from-blue-500 to-blue-400 rounded transition-all"
                style={{ width: `${levels.right}%` }}
              />
              <span className="text-xs text-white ml-2 absolute">
                {levels.right.toFixed(0)}%
              </span>
            </div>
          </div>

          <div className="text-center">
            <p className="text-xs text-slate-400">الذروة</p>
            <div className="mt-2 h-8 bg-slate-800 rounded flex items-center justify-center">
              <div
                className={`h-full rounded transition-all ${
                  levels.peak > 90
                    ? "bg-gradient-to-r from-red-500 to-red-400"
                    : "bg-gradient-to-r from-green-500 to-green-400"
                }`}
                style={{ width: `${levels.peak}%` }}
              />
              <span className="text-xs text-white ml-2 absolute">
                {levels.peak.toFixed(0)}%
              </span>
            </div>
          </div>
        </div>

        {/* Info */}
        <div className="text-xs text-slate-400 text-center">
          {levels.peak > 90 && (
            <p className="text-red-400">⚠️ تحذير: مستوى الصوت مرتفع جداً</p>
          )}
          {levels.peak > 0 && levels.peak <= 90 && (
            <p className="text-green-400">✓ مستوى الصوت طبيعي</p>
          )}
        </div>
      </div>
    </Card>
  );
}
