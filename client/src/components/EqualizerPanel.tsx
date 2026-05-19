import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { RotateCcw } from "lucide-react";
import type { AdvancedAudioProcessor } from "./AdvancedAudioProcessor";

interface EqualizerPanelProps {
  processor: AdvancedAudioProcessor | null;
  isEnabled: boolean;
}

const BANDS = [
  { freq: 60, label: "60Hz" },
  { freq: 150, label: "150Hz" },
  { freq: 250, label: "250Hz" },
  { freq: 500, label: "500Hz" },
  { freq: 1000, label: "1kHz" },
  { freq: 2000, label: "2kHz" },
  { freq: 4000, label: "4kHz" },
  { freq: 8000, label: "8kHz" },
  { freq: 12000, label: "12kHz" },
  { freq: 16000, label: "16kHz" },
];

export function EqualizerPanel({ processor, isEnabled }: EqualizerPanelProps) {
  const [gains, setGains] = useState<number[]>([0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);

  const handleGainChange = (bandIndex: number, value: number[]) => {
    const newGain = value[0];
    const newGains = [...gains];
    newGains[bandIndex] = newGain;
    setGains(newGains);

    if (processor && isEnabled) {
      processor.setEQGain(bandIndex, newGain);
    }
  };

  const handleReset = () => {
    setGains([0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
    if (processor && isEnabled) {
      processor.resetEQ();
    }
  };

  return (
    <Card className="p-6 bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-900 dark:to-slate-800">
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-bold text-slate-900 dark:text-white">
              معادل صوتي (10-Band Equalizer)
            </h3>
            <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
              اضبط الترددات لتحسين جودة الصوت
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleReset}
            disabled={!isEnabled}
            className="gap-2"
          >
            <RotateCcw className="w-4 h-4" />
            إعادة تعيين
          </Button>
        </div>

        {/* EQ Bands */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-6">
          {BANDS.map((band, index) => (
            <div key={index} className="flex flex-col items-center space-y-3">
              {/* Vertical Slider */}
              <div className="h-40 flex items-end justify-center">
                <div className="relative h-full w-8 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                  <div
                    className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-blue-500 to-blue-400 transition-all duration-100"
                    style={{
                      height: `${((gains[index] + 12) / 24) * 100}%`,
                    }}
                  />
                </div>
              </div>

              {/* Slider Control */}
              <Slider
                value={[gains[index]]}
                onValueChange={(value) => handleGainChange(index, value)}
                min={-12}
                max={12}
                step={0.5}
                disabled={!isEnabled}
                className="w-full"
                orientation="vertical"
              />

              {/* Frequency Label */}
              <div className="text-center">
                <p className="text-xs font-semibold text-slate-900 dark:text-white">
                  {band.label}
                </p>
                <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
                  {gains[index] > 0 ? "+" : ""}
                  {gains[index].toFixed(1)} dB
                </p>
              </div>
            </div>
          ))}
        </div>

        {/* Info */}
        <div className="bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
          <p className="text-sm text-blue-700 dark:text-blue-300">
            💡 <strong>نصيحة:</strong> استخدم المعادل لتحسين الترددات المختلفة.
            قلل الترددات المنخفضة لتقليل الضوضاء، وزد الترددات العالية لتحسين الوضوح.
          </p>
        </div>
      </div>
    </Card>
  );
}
