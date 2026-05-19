import React, { useState, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Download, Play, Pause, RotateCcw, Scissors, AlertCircle, CheckCircle2, Clock, Zap } from "lucide-react";
import { SilenceRemover, SilenceSegment, SilenceRemoverOptions } from "./SilenceRemover";
import { toast } from "sonner";

interface SilenceRemoverPanelProps {
  audioUrl: string;
  fileName: string;
  audioContext: AudioContext;
}

interface AnalysisResult {
  detectedSilences: SilenceSegment[];
  removedSilences: SilenceSegment[];
  originalDuration: number;
  estimatedOutputDuration: number;
}

export default function SilenceRemoverPanel({
  audioUrl,
  fileName,
  audioContext,
}: SilenceRemoverPanelProps) {
  // ─── Options ──────────────────────────────────────────────────────────────
  const [threshold, setThreshold] = useState(0.01);
  const [minSilenceDuration, setMinSilenceDuration] = useState(30);
  const [paddingDuration, setPaddingDuration] = useState(0.3);

  // ─── State ────────────────────────────────────────────────────────────────
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
  const [outputBlob, setOutputBlob] = useState<Blob | null>(null);
  const [outputUrl, setOutputUrl] = useState<string | null>(null);
  const [isPreviewPlaying, setIsPreviewPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressLabel, setProgressLabel] = useState("");

  const previewAudioRef = useRef<HTMLAudioElement>(null);
  const removerRef = useRef<SilenceRemover | null>(null);

  // ─── Helpers ──────────────────────────────────────────────────────────────
  const formatTime = (seconds: number) => {
    if (!seconds || isNaN(seconds)) return "0:00";
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  const formatDuration = (seconds: number) => {
    if (seconds < 60) return `${seconds.toFixed(1)} ث`;
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m} د ${s} ث`;
  };

  const getOptions = (): Partial<SilenceRemoverOptions> => ({
    threshold,
    minSilenceDuration,
    paddingDuration,
  });

  // ─── Load AudioBuffer from URL ─────────────────────────────────────────
  const loadAudioBuffer = useCallback(async (): Promise<AudioBuffer> => {
    const response = await fetch(audioUrl);
    if (!response.ok) throw new Error("فشل تحميل الملف الصوتي");
    const arrayBuffer = await response.arrayBuffer();
    return audioContext.decodeAudioData(arrayBuffer);
  }, [audioUrl, audioContext]);

  // ─── Analyze (preview silences without removing) ──────────────────────
  const handleAnalyze = async () => {
    setIsAnalyzing(true);
    setProgress(0);
    setProgressLabel("جاري تحميل الملف...");
    setAnalysisResult(null);
    setOutputBlob(null);
    setOutputUrl(null);

    try {
      setProgress(20);
      const inputBuffer = await loadAudioBuffer();

      setProgress(50);
      setProgressLabel("جاري تحليل السكتات...");

      if (!removerRef.current) {
        removerRef.current = new SilenceRemover(audioContext);
      }

      const { detectedSilences, removedSilences } = removerRef.current.analyze(
        inputBuffer,
        getOptions()
      );

      const removedTime = removedSilences.reduce((acc, s) => acc + s.duration, 0);
      const estimatedOutputDuration = inputBuffer.duration - removedTime;

      setAnalysisResult({
        detectedSilences,
        removedSilences,
        originalDuration: inputBuffer.duration,
        estimatedOutputDuration: Math.max(0, estimatedOutputDuration),
      });

      setProgress(100);
      setProgressLabel("اكتمل التحليل");
      toast.success(
        removedSilences.length > 0
          ? `تم اكتشاف ${removedSilences.length} سكتة طويلة`
          : "لا توجد سكتات تتجاوز الحد المحدد"
      );
    } catch (error) {
      console.error("Analysis error:", error);
      toast.error("فشل تحليل الملف الصوتي");
    } finally {
      setIsAnalyzing(false);
    }
  };

  // ─── Process (actually remove silences and export) ────────────────────
  const handleProcess = async () => {
    setIsProcessing(true);
    setProgress(0);
    setProgressLabel("جاري تحميل الملف...");

    try {
      setProgress(15);
      const inputBuffer = await loadAudioBuffer();

      setProgress(35);
      setProgressLabel("جاري إزالة السكتات...");

      if (!removerRef.current) {
        removerRef.current = new SilenceRemover(audioContext);
      }

      const result = await removerRef.current.process(inputBuffer, getOptions());

      setProgress(80);
      setProgressLabel("جاري تصدير الملف...");

      const blob = removerRef.current.exportAsWav(result.outputBuffer);
      const url = URL.createObjectURL(blob);

      setOutputBlob(blob);
      setOutputUrl(url);

      setProgress(100);
      setProgressLabel("اكتمت المعالجة");

      // تحديث نتيجة التحليل بالأرقام الفعلية
      setAnalysisResult({
        detectedSilences: result.detectedSilences,
        removedSilences: result.removedSilences,
        originalDuration: result.originalDuration,
        estimatedOutputDuration: result.outputDuration,
      });

      toast.success(
        `تمت الإزالة! وُفِّر ${result.savedPercentage.toFixed(1)}% من وقت الملف`
      );
    } catch (error) {
      console.error("Processing error:", error);
      toast.error("فشل معالجة الملف الصوتي");
    } finally {
      setIsProcessing(false);
    }
  };

  // ─── Download ─────────────────────────────────────────────────────────
  const handleDownload = () => {
    if (!outputBlob) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(outputBlob);
    const baseName = fileName.replace(/\.[^/.]+$/, "");
    a.download = `${baseName}-no-silence.wav`;
    a.click();
    toast.success("تم تحميل الملف بنجاح");
  };

  // ─── Preview playback ────────────────────────────────────────────────
  const handlePreviewPlayPause = () => {
    if (!previewAudioRef.current) return;
    if (isPreviewPlaying) {
      previewAudioRef.current.pause();
    } else {
      previewAudioRef.current.play();
    }
  };

  // ─── Reset ───────────────────────────────────────────────────────────
  const handleReset = () => {
    setAnalysisResult(null);
    setOutputBlob(null);
    if (outputUrl) URL.revokeObjectURL(outputUrl);
    setOutputUrl(null);
    setProgress(0);
    setProgressLabel("");
    setThreshold(0.01);
    setMinSilenceDuration(30);
    setPaddingDuration(0.3);
    toast.success("تم إعادة تعيين الإعدادات");
  };

  // ─── Saved time calculation ───────────────────────────────────────────
  const savedSeconds = analysisResult
    ? analysisResult.originalDuration - analysisResult.estimatedOutputDuration
    : 0;
  const savedPercent = analysisResult
    ? (savedSeconds / analysisResult.originalDuration) * 100
    : 0;

  // ─── Render ───────────────────────────────────────────────────────────
  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Scissors className="w-5 h-5 text-orange-500" />
          إزالة السكتات الطويلة
        </CardTitle>
        <CardDescription>
          اكتشاف وإزالة فترات الصمت التي تتجاوز الحد المحدد من الملف الصوتي
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">
        <Tabs defaultValue="settings">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="settings">الإعدادات</TabsTrigger>
            <TabsTrigger value="analysis" disabled={!analysisResult}>
              نتائج التحليل
              {analysisResult && analysisResult.removedSilences.length > 0 && (
                <span className="mr-1.5 bg-orange-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center">
                  {analysisResult.removedSilences.length}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value="preview" disabled={!outputUrl}>
              المعاينة
            </TabsTrigger>
          </TabsList>

          {/* ── Settings Tab ─────────────────────────────────────────── */}
          <TabsContent value="settings" className="space-y-6 mt-4">

            {/* Minimum silence duration */}
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <label className="text-sm font-medium flex items-center gap-2">
                  <Clock className="w-4 h-4 text-slate-500" />
                  الحد الأدنى لمدة الصمت المحذوف
                </label>
                <span className="text-sm font-mono bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded">
                  {minSilenceDuration} ث
                </span>
              </div>
              <Slider
                value={[minSilenceDuration]}
                onValueChange={(v) => setMinSilenceDuration(v[0])}
                min={5}
                max={120}
                step={5}
                className="w-full"
              />
              <p className="text-xs text-slate-500">
                سيتم حذف أي صمت يتجاوز <strong>{minSilenceDuration} ثانية</strong>. الافتراضي: 30 ثانية.
              </p>
            </div>

            {/* Threshold */}
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <label className="text-sm font-medium flex items-center gap-2">
                  <Zap className="w-4 h-4 text-slate-500" />
                  حساسية كشف الصمت
                </label>
                <span className="text-sm font-mono bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded">
                  {(threshold * 100).toFixed(1)}%
                </span>
              </div>
              <Slider
                value={[threshold]}
                onValueChange={(v) => setThreshold(v[0])}
                min={0.001}
                max={0.05}
                step={0.001}
                className="w-full"
              />
              <p className="text-xs text-slate-500">
                قيمة أعلى = حساسية أكبر (يكشف أصوات أكثر كصمت). الافتراضي: 1%.
              </p>
            </div>

            {/* Padding */}
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <label className="text-sm font-medium">
                  هامش الصوت المحتفظ به (padding)
                </label>
                <span className="text-sm font-mono bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded">
                  {paddingDuration.toFixed(1)} ث
                </span>
              </div>
              <Slider
                value={[paddingDuration]}
                onValueChange={(v) => setPaddingDuration(v[0])}
                min={0.0}
                max={2.0}
                step={0.1}
                className="w-full"
              />
              <p className="text-xs text-slate-500">
                مقدار الصوت المحتفظ به قبل وبعد كل مقطع لتجنب القطع المفاجئ.
              </p>
            </div>

            {/* Info box */}
            <div className="bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 rounded-lg p-4">
              <div className="flex gap-2">
                <AlertCircle className="w-4 h-4 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
                <div className="text-xs text-amber-700 dark:text-amber-300 space-y-1">
                  <p><strong>كيف تعمل الميزة:</strong></p>
                  <p>1. اضغط "تحليل" لمعاينة السكتات المكتشفة دون تعديل الملف.</p>
                  <p>2. اضبط الإعدادات حسب الحاجة.</p>
                  <p>3. اضغط "إزالة السكتات" لمعالجة الملف وتحميله.</p>
                </div>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex gap-3">
              <Button
                onClick={handleAnalyze}
                disabled={isAnalyzing || isProcessing}
                variant="outline"
                className="flex-1 gap-2"
              >
                {isAnalyzing ? (
                  <>
                    <div className="w-4 h-4 border-2 border-slate-400 border-t-transparent rounded-full animate-spin" />
                    جاري التحليل...
                  </>
                ) : (
                  <>
                    <Zap className="w-4 h-4" />
                    تحليل فقط
                  </>
                )}
              </Button>

              <Button
                onClick={handleProcess}
                disabled={isAnalyzing || isProcessing}
                className="flex-1 gap-2 bg-orange-600 hover:bg-orange-700"
              >
                {isProcessing ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    جاري المعالجة...
                  </>
                ) : (
                  <>
                    <Scissors className="w-4 h-4" />
                    إزالة السكتات
                  </>
                )}
              </Button>
            </div>

            {/* Progress Bar */}
            {(isAnalyzing || isProcessing || progress > 0) && (
              <div className="space-y-1">
                <div className="flex justify-between text-xs text-slate-500">
                  <span>{progressLabel}</span>
                  <span>{Math.round(progress)}%</span>
                </div>
                <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-2">
                  <div
                    className="bg-orange-500 h-2 rounded-full transition-all duration-300"
                    style={{ width: `${progress}%` }}
                  />
                </div>
              </div>
            )}
          </TabsContent>

          {/* ── Analysis Tab ──────────────────────────────────────────── */}
          <TabsContent value="analysis" className="space-y-4 mt-4">
            {analysisResult && (
              <>
                {/* Summary cards */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div className="bg-slate-100 dark:bg-slate-800 rounded-lg p-3 text-center">
                    <p className="text-xs text-slate-500 mb-1">المدة الأصلية</p>
                    <p className="font-bold text-slate-900 dark:text-white">
                      {formatTime(analysisResult.originalDuration)}
                    </p>
                  </div>
                  <div className="bg-green-100 dark:bg-green-900 rounded-lg p-3 text-center">
                    <p className="text-xs text-green-600 dark:text-green-400 mb-1">المدة الناتجة</p>
                    <p className="font-bold text-green-700 dark:text-green-300">
                      {formatTime(analysisResult.estimatedOutputDuration)}
                    </p>
                  </div>
                  <div className="bg-orange-100 dark:bg-orange-900 rounded-lg p-3 text-center">
                    <p className="text-xs text-orange-600 dark:text-orange-400 mb-1">الوقت الموفَّر</p>
                    <p className="font-bold text-orange-700 dark:text-orange-300">
                      {formatDuration(savedSeconds)}
                    </p>
                  </div>
                  <div className="bg-blue-100 dark:bg-blue-900 rounded-lg p-3 text-center">
                    <p className="text-xs text-blue-600 dark:text-blue-400 mb-1">نسبة التوفير</p>
                    <p className="font-bold text-blue-700 dark:text-blue-300">
                      {savedPercent.toFixed(1)}%
                    </p>
                  </div>
                </div>

                {/* Status message */}
                {analysisResult.removedSilences.length === 0 ? (
                  <div className="flex items-center gap-2 bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 rounded-lg p-4">
                    <CheckCircle2 className="w-5 h-5 text-green-600" />
                    <p className="text-sm text-green-700 dark:text-green-300">
                      لا توجد سكتات تتجاوز {minSilenceDuration} ثانية في هذا الملف.
                    </p>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 bg-orange-50 dark:bg-orange-950 border border-orange-200 dark:border-orange-800 rounded-lg p-4">
                    <Scissors className="w-5 h-5 text-orange-600" />
                    <p className="text-sm text-orange-700 dark:text-orange-300">
                      سيتم إزالة <strong>{analysisResult.removedSilences.length}</strong> سكتة طويلة، مما يوفر{" "}
                      <strong>{formatDuration(savedSeconds)}</strong> من وقت الملف.
                    </p>
                  </div>
                )}

                {/* Silences list */}
                {analysisResult.removedSilences.length > 0 && (
                  <div className="space-y-2">
                    <h4 className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                      السكتات التي ستُحذف ({analysisResult.removedSilences.length})
                    </h4>
                    <div className="max-h-52 overflow-y-auto space-y-1.5 rounded-lg border border-slate-200 dark:border-slate-700 p-2">
                      {analysisResult.removedSilences.map((silence, i) => (
                        <div
                          key={i}
                          className="flex items-center justify-between text-xs bg-orange-50 dark:bg-orange-950 rounded px-3 py-2"
                        >
                          <span className="text-orange-700 dark:text-orange-300 font-mono">
                            {formatTime(silence.start)} → {formatTime(silence.end)}
                          </span>
                          <span className="text-orange-600 dark:text-orange-400 font-medium">
                            {formatDuration(silence.duration)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* All detected silences (collapsible) */}
                {analysisResult.detectedSilences.length > 0 && (
                  <details className="text-sm">
                    <summary className="cursor-pointer text-slate-500 hover:text-slate-700 dark:hover:text-slate-300">
                      جميع السكتات المكتشفة ({analysisResult.detectedSilences.length})
                    </summary>
                    <div className="mt-2 max-h-40 overflow-y-auto space-y-1 rounded border border-slate-200 dark:border-slate-700 p-2">
                      {analysisResult.detectedSilences.map((silence, i) => {
                        const willBeRemoved = silence.duration >= minSilenceDuration;
                        return (
                          <div
                            key={i}
                            className={`flex items-center justify-between text-xs rounded px-3 py-1.5 ${
                              willBeRemoved
                                ? "bg-red-50 dark:bg-red-950 text-red-700 dark:text-red-300"
                                : "bg-slate-50 dark:bg-slate-900 text-slate-600 dark:text-slate-400"
                            }`}
                          >
                            <span className="font-mono">
                              {formatTime(silence.start)} → {formatTime(silence.end)}
                            </span>
                            <span>
                              {formatDuration(silence.duration)}
                              {willBeRemoved && " ✂️"}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </details>
                )}

                {/* Process button shortcut */}
                {!outputUrl && (
                  <Button
                    onClick={handleProcess}
                    disabled={isProcessing || analysisResult.removedSilences.length === 0}
                    className="w-full gap-2 bg-orange-600 hover:bg-orange-700"
                  >
                    {isProcessing ? (
                      <>
                        <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        جاري المعالجة...
                      </>
                    ) : (
                      <>
                        <Scissors className="w-4 h-4" />
                        إزالة السكتات وتصدير الملف
                      </>
                    )}
                  </Button>
                )}
              </>
            )}
          </TabsContent>

          {/* ── Preview Tab ───────────────────────────────────────────── */}
          <TabsContent value="preview" className="space-y-4 mt-4">
            {outputUrl && (
              <>
                <div className="bg-green-50 dark:bg-green-950 border border-green-200 dark:border-green-800 rounded-lg p-4 flex items-center gap-3">
                  <CheckCircle2 className="w-5 h-5 text-green-600 flex-shrink-0" />
                  <div className="text-sm text-green-700 dark:text-green-300">
                    <p className="font-medium">تمت المعالجة بنجاح!</p>
                    <p>
                      المدة الناتجة:{" "}
                      {analysisResult ? formatTime(analysisResult.estimatedOutputDuration) : "—"}
                      {" · "}
                      تم توفير {savedPercent.toFixed(1)}% من وقت الملف
                    </p>
                  </div>
                </div>

                {/* Audio preview */}
                <div className="space-y-3">
                  <h4 className="text-sm font-semibold">معاينة الملف الناتج</h4>
                  <audio
                    ref={previewAudioRef}
                    src={outputUrl}
                    onPlay={() => setIsPreviewPlaying(true)}
                    onPause={() => setIsPreviewPlaying(false)}
                    onEnded={() => setIsPreviewPlaying(false)}
                    controls
                    className="w-full"
                  />
                </div>

                {/* Download */}
                <Button
                  onClick={handleDownload}
                  className="w-full gap-2 bg-green-600 hover:bg-green-700"
                >
                  <Download className="w-4 h-4" />
                  تحميل الملف بدون السكتات
                </Button>
              </>
            )}
          </TabsContent>
        </Tabs>

        {/* Reset button */}
        <div className="flex justify-end">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleReset}
            className="gap-2 text-slate-500 hover:text-slate-700"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            إعادة تعيين
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
