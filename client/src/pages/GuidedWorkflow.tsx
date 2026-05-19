/**
 * GuidedWorkflow — تجربة موجَّهة لتنظيف تسجيلات الصلاة
 *
 * المراحل: رفع → تنظيف ذكي → مراجعة → تعديل يدوي → حفظ
 *
 * مبدأ التصميم:
 * - المستخدم العادي لا يرى أي مصطلحات تقنية
 * - التحليل الذكي يعمل خلف الكواليس
 * - لا يُحذف تلقائياً أي مقطع مشكوك فيه
 * - الخطأ بعدم الحذف أفضل من الخطأ بالحذف الخاطئ
 */

import { useState, useRef, useCallback, useEffect } from "react";
import { toast } from "sonner";
import { SilenceProcessor, DEFAULT_SILENCE_OPTIONS } from "@/components/SilenceProcessor";
import { AudioTrimmerEngine } from "@/components/AudioTrimmerEngine";
import { AudioExporter } from "@/components/AudioExporter";
import { SmartPrayerAnalyzer } from "@/components/SmartPrayerAnalyzer";
import { SmartPrayerDecisionEngine } from "@/components/SmartPrayerDecisionEngine";
import TrimPanel from "@/components/TrimPanel";

// ─── Types ────────────────────────────────────────────────────────────────────

type Stage =
  | "upload"      // شاشة البداية
  | "uploaded"    // ملف مرفوع — جاهز للتنظيف
  | "processing"  // جاري التحليل والتنظيف
  | "result"      // عرض النتيجة
  | "edit"        // تعديل يدوي عبر TrimPanel
  | "save";       // حفظ النهائي

interface AudioFile {
  name:     string;
  duration: number;
  sizeMb:   number;
  url:      string;
}

interface CleanSummary {
  originalDuration:  number;
  newDuration:       number;
  removedDuration:   number;
  safeRemovedCount:  number;   // مقاطع حُذفت بثقة عالية
  reviewCount:       number;   // مقاطع تحتاج مراجعة — لم تُحذف
  keptCount:         number;   // مقاطع حُفظت عمداً
  processedBuffer:   AudioBuffer;
  processedUrl:      string;
}

// ─── Safe Preset — Prayer Default ────────────────────────────────────────────

interface CleanPreset {
  id:          string;
  label:       string;
  description: string;
  badge?:      string;
  // SilenceProcessor params
  thresholdDb:        number;
  minSilenceDuration: number;
  detectionMode:      "rms" | "vad";
  // DecisionEngine params
  maxRemovableRatio:  number;
  preTailSec:         number;
  postTailSec:        number;
  shortPauseRemoveThreshold: number;
  longPauseRemoveThreshold:  number;
}

const PRESETS: Record<string, CleanPreset> = {
  prayer: {
    id:          "prayer",
    label:       "تسجيل صلاة",
    description: "يحذف الصمت الطويل فقط · يحافظ على الانتقالات الطبيعية",
    badge:       "افتراضي",
    thresholdDb:               -52,
    minSilenceDuration:         2.0,
    detectionMode:              "rms",
    maxRemovableRatio:          0.40,
    preTailSec:                 0.35,
    postTailSec:                0.40,
    shortPauseRemoveThreshold:  0.80,  // حذف الصمت القصير فقط عند ثقة عالية جداً
    longPauseRemoveThreshold:   0.70,
  },
  balanced: {
    id:          "balanced",
    label:       "تسجيل عام",
    description: "متوازن — مناسب لمعظم التسجيلات",
    thresholdDb:               -45,
    minSilenceDuration:         1.0,
    detectionMode:              "rms",
    maxRemovableRatio:          0.55,
    preTailSec:                 0.20,
    postTailSec:                0.25,
    shortPauseRemoveThreshold:  0.65,
    longPauseRemoveThreshold:   0.60,
  },
  thorough: {
    id:          "thorough",
    label:       "تنظيف مكثف",
    description: "يحذف أكثر — للتسجيلات ذات الضوضاء العالية",
    thresholdDb:               -38,
    minSilenceDuration:         0.6,
    detectionMode:              "vad",
    maxRemovableRatio:          0.65,
    preTailSec:                 0.10,
    postTailSec:                0.15,
    shortPauseRemoveThreshold:  0.55,
    longPauseRemoveThreshold:   0.50,
  },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmt = (s: number) => {
  if (!s || isNaN(s) || !isFinite(s)) return "0:00";
  const m = Math.floor(s / 60), sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
};

const sizeSuffix = (mb: number) =>
  mb < 1 ? `${Math.round(mb * 1024)} KB` : `${mb.toFixed(1)} MB`;

/** حساب rmsFrames من AudioBuffer لتمريرها للـ SmartPrayerAnalyzer */
function computeRmsFrames(buffer: AudioBuffer, windowSize: number): Float32Array {
  const ch     = buffer.getChannelData(0);
  const nWin   = Math.ceil(ch.length / windowSize);
  const frames = new Float32Array(nWin);
  for (let w = 0; w < nWin; w++) {
    const s = w * windowSize, e = Math.min(s + windowSize, ch.length);
    let sum = 0;
    for (let i = s; i < e; i++) sum += ch[i] * ch[i];
    frames[w] = Math.sqrt(sum / (e - s));
  }
  return frames;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function GuidedWorkflow() {

  const [stage, setStage]           = useState<Stage>("upload");
  const [file, setFile]             = useState<AudioFile | null>(null);
  const [summary, setSummary]       = useState<CleanSummary | null>(null);
  const [progress, setProgress]     = useState(0);
  const [progressMsg, setProgressMsg] = useState("");
  const [presetId, setPresetId]     = useState("prayer");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [crossfade, setCrossfade]   = useState(0.04);

  // Player state
  const audioRef    = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying]   = useState(false);
  const [curTime, setCurTime]   = useState(0);
  const [dur, setDur]           = useState(0);

  // Export
  const [exportFmt, setExportFmt]         = useState<"wav"|"mp3">("mp3");
  const [exportBr, setExportBr]           = useState<96|128|192>(128);
  const [isExporting, setIsExporting]     = useState(false);

  // File input
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── File handling ──────────────────────────────────────────────────────
  const handleFile = useCallback(async (f: File) => {
    if (!f.type.startsWith("audio/")) {
      toast.error("الملف غير مدعوم — اختر ملفاً صوتياً");
      return;
    }
    if (f.size > 100 * 1024 * 1024) {
      toast.error("حجم الملف كبير جداً — الحد الأقصى 100 MB");
      return;
    }
    const url = URL.createObjectURL(f);
    const duration = await new Promise<number>(res => {
      const a = new Audio(url);
      a.onloadedmetadata = () => res(a.duration);
      a.onerror = () => res(0);
    });
    setFile({ name: f.name, duration, sizeMb: f.size / (1024 * 1024), url });
    setStage("uploaded");
  }, []);

  // ── Auto Clean — الخوارزمية الكاملة ────────────────────────────────────
  const handleClean = useCallback(async () => {
    if (!file) return;
    setStage("processing");
    setProgress(5);
    setProgressMsg("جاري تحميل التسجيل...");

    const preset = PRESETS[presetId] ?? PRESETS.prayer;

    try {
      // ── 1. SilenceProcessor: اكتشاف فترات الصمت ──────────────────────
      setProgressMsg("جاري تحليل التسجيل...");
      const { report } = await SilenceProcessor.process(
        file.url,
        {
          thresholdDb:        preset.thresholdDb,
          minSilenceDuration: preset.minSilenceDuration,
          replacementGap:     0,   // سنستخدم DecisionEngine لتحديد الفجوات
          detectionMode:      preset.detectionMode,
          adaptiveHeadroomDb: 8,
        },
        ({ stage: s, percent }) => {
          setProgressMsg(s);
          setProgress(5 + Math.round(percent * 0.40));
        }
      );
      setProgress(48);

      // ── 2. تحميل AudioBuffer ──────────────────────────────────────────
      setProgressMsg("جاري إعداد الملف...");
      const buf = await AudioTrimmerEngine.loadBuffer(file.url);
      setProgress(55);

      if (report.removedSegments.length === 0) {
        // لا يوجد صمت — أعد الأصل كما هو
        const outBlob = AudioTrimmerEngine.toWav(buf);
        const outUrl  = URL.createObjectURL(outBlob);
        setSummary({
          originalDuration:  buf.duration,
          newDuration:        buf.duration,
          removedDuration:    0,
          safeRemovedCount:   0,
          reviewCount:        0,
          keptCount:          0,
          processedBuffer:    buf,
          processedUrl:       outUrl,
        });
        setProgress(100);
        setStage("result");
        toast.success("التسجيل نظيف — لم يُعثر على صمت يحتاج إزالة");
        return;
      }

      // ── 3. SmartPrayerAnalyzer: تحليل كل مقطع ────────────────────────
      setProgressMsg("جاري التحليل الذكي...");
      const windowSize = DEFAULT_SILENCE_OPTIONS.windowSize;
      const rmsFrames  = computeRmsFrames(buf, windowSize);

      const rawSegments = report.removedSegments.map((s, i) => ({
        id:          `seg-${i}`,
        startSec:    s.startSec,
        endSec:      s.endSec,
        durationSec: s.durationSec,
      }));

      const enriched = SmartPrayerAnalyzer.analyze(rawSegments, rmsFrames, {
        thresholdDb:  preset.thresholdDb,
        sampleRate:   buf.sampleRate,
        windowSize,
      });
      setProgress(70);

      // ── 4. DecisionEngine: قرار لكل مقطع مع حماية maxRatio ──────────
      setProgressMsg("جاري اتخاذ القرارات...");
      const { segments: decided, summary: decSummary } = SmartPrayerDecisionEngine.decide(
        enriched,
        buf.duration,
        {
          maxRemovableRatio:          preset.maxRemovableRatio,
          preTailSec:                 preset.preTailSec,
          postTailSec:                preset.postTailSec,
          shortPauseRemoveThreshold:  preset.shortPauseRemoveThreshold,
          longPauseRemoveThreshold:   preset.longPauseRemoveThreshold,
          minKeepDuration:            1.5,
          minGapMs:                   150,
          longNeighborProtectSec:     4,
        }
      );
      setProgress(78);

      // ── 5. تطبيق الحذف — فقط "remove" و"partial_trim" ───────────────
      // لا نحذف "review" أبداً — نتركها للمستخدم
      setProgressMsg("جاري تطبيق التنظيف...");
      const deleteRanges = SmartPrayerDecisionEngine.toDeleteRanges(
        decided.filter(d => d.decision === "remove" || d.decision === "partial_trim")
      );

      let processed: AudioBuffer;
      if (deleteRanges.length === 0) {
        processed = buf;
      } else {
        processed = await AudioTrimmerEngine.deleteMultipleRanges(
          buf,
          deleteRanges,
          crossfade,
          crossfade
        );
      }
      setProgress(92);

      const outBlob = AudioTrimmerEngine.toWav(processed);
      const outUrl  = URL.createObjectURL(outBlob);

      const reviewCount = decided.filter(d => d.decision === "review").length;
      const keptCount   = decided.filter(d => d.decision === "keep").length;
      const safeCount   = decided.filter(d => d.decision === "remove" || d.decision === "partial_trim").length;
      const removedSec  = decided
        .filter(d => d.decision === "remove" || d.decision === "partial_trim")
        .reduce((a, d) => a + (d.trim ? d.trim.removedSec : d.durationSec), 0);

      setSummary({
        originalDuration:  buf.duration,
        newDuration:        processed.duration,
        removedDuration:    removedSec,
        safeRemovedCount:   safeCount,
        reviewCount,
        keptCount,
        processedBuffer:    processed,
        processedUrl:       outUrl,
      });
      setProgress(100);
      setStage("result");

      if (reviewCount > 0) {
        toast.success(
          `✓ تم التنظيف — ${safeCount} مقطع حُذف · ${reviewCount} مقطع يحتاج مراجعة`
        );
      } else {
        toast.success(`✓ تم التنظيف — حُذف ${safeCount} فترة صمت`);
      }

    } catch (err) {
      console.error("[GuidedWorkflow] clean error:", err);
      setStage("uploaded");
      toast.error("حدث خطأ أثناء التنظيف. جرّب مرة أخرى أو اختر إعدادات مختلفة.");
    }
  }, [file, presetId, crossfade]);

  // ── Export ────────────────────────────────────────────────────────────
  const handleExport = useCallback(async () => {
    if (!summary) return;
    setIsExporting(true);
    try {
      let blob: Blob;
      let filename: string;
      const base = file?.name.replace(/\.[^.]+$/, "") ?? "recording";

      if (exportFmt === "wav") {
        blob     = AudioTrimmerEngine.toWav(summary.processedBuffer);
        filename = `${base}-cleaned.wav`;
      } else {
        try {
          blob     = await AudioExporter.toMp3(summary.processedBuffer, exportBr);
          filename = `${base}-cleaned-${exportBr}k.mp3`;
        } catch {
          toast.error(
            "تعذّر تصدير MP3 الآن. جاري تحميل WAV بدلاً من ذلك.\n" +
            "يمكنك تجربة متصفح Chrome أو Firefox."
          );
          blob     = AudioTrimmerEngine.toWav(summary.processedBuffer);
          filename = `${base}-cleaned.wav`;
        }
      }

      const url = URL.createObjectURL(blob);
      const a   = document.createElement("a");
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success("✓ تم التحميل");
    } finally {
      setIsExporting(false);
    }
  }, [summary, exportFmt, exportBr, file]);

  // ── Player sync ───────────────────────────────────────────────────────
  useEffect(() => {
    const el = audioRef.current;
    if (!el || !summary) return;
    el.src  = summary.processedUrl;
    el.load();
  }, [summary?.processedUrl]);

  const jump = (delta: number) => {
    const el = audioRef.current;
    if (!el) return;
    el.currentTime = Math.max(0, Math.min(el.duration || 0, el.currentTime + delta));
  };

  // ── Size estimates ────────────────────────────────────────────────────
  const wavMb  = summary
    ? (summary.processedBuffer.length * summary.processedBuffer.numberOfChannels * 2 + 44) / (1024**2)
    : 0;
  const mp3Mb  = (br: number) =>
    summary ? (summary.processedBuffer.duration * br * 1000 / 8) / (1024**2) : 0;

  // ─────────────────────────────────────────────────────────────────────
  // RENDER
  // ─────────────────────────────────────────────────────────────────────

  return (
    <div
      className="min-h-screen bg-gradient-to-b from-slate-50 to-white dark:from-slate-950 dark:to-slate-900"
      dir="rtl"
    >
      {/* Nav bar minimal */}
      <nav className="border-b border-slate-100 dark:border-slate-800 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xl">🕌</span>
          <span className="font-bold text-slate-800 dark:text-slate-200 text-sm">
            معالج الصوت
          </span>
        </div>
        {/* Link to advanced tools */}
        <a href="/app/tools"
          className="text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors flex items-center gap-1">
          الأدوات المتقدمة ←
        </a>
      </nav>

      <div className="max-w-lg mx-auto px-4 py-10 space-y-5">

        {/* ── STAGE: upload ─────────────────────────────────────────── */}
        {stage === "upload" && (
          <div className="space-y-6">
            <div className="text-center space-y-3 pt-4">
              <h1 className="text-3xl font-bold text-slate-800 dark:text-slate-100 leading-tight">
                تنظيف تسجيل الصلاة
              </h1>
              <p className="text-slate-500 dark:text-slate-400 text-base leading-relaxed">
                ارفع التسجيل وسيُزيل البرنامج فترات الصمت تلقائياً<br/>
                مع الحفاظ على الانتقالات الطبيعية بين التلاوات
              </p>
            </div>

            <div
              className="border-2 border-dashed border-slate-300 dark:border-slate-600 rounded-3xl p-12 text-center cursor-pointer transition-all hover:border-blue-400 hover:bg-blue-50 dark:hover:border-blue-600 dark:hover:bg-blue-950/20"
              onClick={() => fileInputRef.current?.click()}
              onDragOver={e => e.preventDefault()}
              onDrop={e => {
                e.preventDefault();
                const f = e.dataTransfer.files[0];
                if (f) handleFile(f);
              }}
            >
              <div className="text-5xl mb-5">🎙</div>
              <p className="text-slate-500 dark:text-slate-400 mb-5 text-base">
                اسحب الملف هنا، أو
              </p>
              <button
                onClick={e => { e.stopPropagation(); fileInputRef.current?.click(); }}
                className="px-8 py-4 bg-blue-600 hover:bg-blue-500 active:scale-[0.98] text-white text-base font-bold rounded-2xl transition-all shadow-lg shadow-blue-200 dark:shadow-none"
              >
                اختيار ملف صوتي
              </button>
              <p className="text-xs text-slate-400 mt-5">
                MP3 · WAV · OGG · M4A · حتى 100 MB
              </p>
            </div>
            <input
              ref={fileInputRef} type="file" accept="audio/*" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
            />
          </div>
        )}

        {/* ── STAGE: uploaded ───────────────────────────────────────── */}
        {stage === "uploaded" && file && (
          <div className="space-y-4">
            <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100 text-center pt-2">
              تنظيف تسجيل الصلاة
            </h1>

            {/* File card */}
            <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
              <div className="p-5 flex items-center gap-4">
                <div className="w-12 h-12 rounded-2xl bg-blue-100 dark:bg-blue-950 flex items-center justify-center flex-shrink-0 text-2xl">
                  🎵
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-slate-800 dark:text-slate-200 truncate text-sm">{file.name}</p>
                  <p className="text-xs text-slate-400 mt-0.5">{fmt(file.duration)} · {sizeSuffix(file.sizeMb)}</p>
                </div>
                <button
                  onClick={() => { setFile(null); setStage("upload"); }}
                  className="text-slate-300 hover:text-red-400 transition-colors text-lg p-1"
                >✕</button>
              </div>

              {/* Preset selector */}
              <div className="px-5 pb-2 space-y-2">
                <p className="text-xs text-slate-400 font-medium">نوع التسجيل:</p>
                <div className="grid grid-cols-3 gap-2">
                  {Object.values(PRESETS).map(p => (
                    <button key={p.id} onClick={() => setPresetId(p.id)}
                      className={`relative py-3 px-2 rounded-2xl border-2 text-center transition-all text-xs font-medium ${
                        presetId === p.id
                          ? "border-blue-600 bg-blue-600 text-white"
                          : "border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:border-blue-300"
                      }`}>
                      {p.badge && presetId !== p.id && (
                        <span className="absolute -top-2 right-2 bg-emerald-500 text-white text-xs px-1.5 py-0.5 rounded-full leading-none">
                          {p.badge}
                        </span>
                      )}
                      {p.label}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-slate-400 text-center">
                  {PRESETS[presetId]?.description}
                </p>
              </div>

              {/* Advanced settings — collapsed */}
              <div className="px-5 pb-5 space-y-3">
                <button
                  onClick={() => setShowAdvanced(v => !v)}
                  className="flex items-center gap-2 text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors w-full"
                >
                  <span>{showAdvanced ? "▲" : "▼"}</span>
                  إعدادات متقدمة
                </button>

                {showAdvanced && (
                  <div className="space-y-4 pt-2 border-t border-slate-100 dark:border-slate-800">
                    {/* Crossfade */}
                    <div>
                      <p className="text-xs font-medium text-slate-500 mb-2">انتقال طبيعي بين المقاطع:</p>
                      <div className="flex gap-1.5">
                        {[
                          { v: 0,    l: "بدون" },
                          { v: 0.02, l: "خفيف" },
                          { v: 0.05, l: "متوسط" },
                          { v: 0.1,  l: "ناعم" },
                        ].map(o => (
                          <button key={o.v} onClick={() => setCrossfade(o.v)}
                            className={`flex-1 py-2 text-xs rounded-xl border transition-all ${
                              crossfade === o.v
                                ? "bg-slate-700 border-slate-700 text-white"
                                : "border-slate-200 dark:border-slate-700 text-slate-500"
                            }`}>
                            {o.l}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* CTA */}
              <div className="px-5 pb-5">
                <button onClick={handleClean}
                  className="w-full py-4 bg-blue-600 hover:bg-blue-500 active:scale-[0.99] text-white text-lg font-bold rounded-2xl transition-all shadow-lg shadow-blue-100 dark:shadow-none">
                  ✨ ابدأ التنظيف
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── STAGE: processing ─────────────────────────────────────── */}
        {stage === "processing" && (
          <div className="text-center space-y-8 py-20">
            <div className="relative w-24 h-24 mx-auto">
              <div className="absolute inset-0 rounded-full border-4 border-blue-100 dark:border-blue-950"/>
              <div className="absolute inset-0 rounded-full border-4 border-blue-600 border-t-transparent animate-spin"/>
              <span className="absolute inset-0 flex items-center justify-center text-3xl">🕌</span>
            </div>
            <div className="space-y-2">
              <p className="text-xl font-bold text-slate-800 dark:text-slate-100">
                جارٍ تحليل التسجيل
              </p>
              <p className="text-sm text-slate-500 dark:text-slate-400 max-w-xs mx-auto leading-relaxed">
                {progressMsg || "جاري المعالجة..."}
              </p>
            </div>
            <div className="max-w-xs mx-auto space-y-2">
              <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-2 overflow-hidden">
                <div
                  className="bg-blue-600 h-2 rounded-full transition-all duration-700"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <p className="text-xs text-slate-400">{progress}%</p>
            </div>
            <p className="text-xs text-slate-400">
              يتم الحفاظ على الانتقالات الطبيعية بين التلاوات
            </p>
          </div>
        )}

        {/* ── STAGE: result ─────────────────────────────────────────── */}
        {stage === "result" && summary && (
          <div className="space-y-4">

            {/* Result card */}
            <div className="bg-white dark:bg-slate-900 rounded-3xl border border-emerald-200 dark:border-emerald-800 shadow-sm overflow-hidden">

              {/* Header */}
              <div className="px-6 pt-6 pb-4 bg-gradient-to-b from-emerald-50/80 to-transparent dark:from-emerald-950/30">
                <div className="flex items-center gap-3 mb-4">
                  <span className="text-3xl">✅</span>
                  <div>
                    <p className="font-bold text-slate-800 dark:text-slate-200 text-lg">اكتمل التنظيف</p>
                    <p className="text-sm text-slate-500 dark:text-slate-400">
                      {summary.safeRemovedCount > 0
                        ? `حُذف ${summary.safeRemovedCount} فترة بثقة عالية`
                        : "لم يُحذف أي مقطع"}
                    </p>
                  </div>
                </div>

                {/* Stats grid */}
                {summary.safeRemovedCount > 0 && (
                  <div className="grid grid-cols-3 gap-2 mb-4">
                    {[
                      { label: "المدة الأصلية", val: fmt(summary.originalDuration), accent: false },
                      { label: "المدة الجديدة", val: fmt(summary.newDuration),       accent: true  },
                      { label: "وُفِّر",         val: fmt(summary.removedDuration),   accent: false },
                    ].map(s => (
                      <div key={s.label}
                        className={`rounded-2xl p-3 text-center ${
                          s.accent
                            ? "bg-emerald-100 dark:bg-emerald-900/50 border border-emerald-200 dark:border-emerald-800"
                            : "bg-slate-100 dark:bg-slate-800"
                        }`}>
                        <p className="text-xs text-slate-400 mb-1">{s.label}</p>
                        <p className={`font-bold font-mono text-base ${
                          s.accent ? "text-emerald-700 dark:text-emerald-300" : "text-slate-700 dark:text-slate-200"
                        }`}>{s.val}</p>
                      </div>
                    ))}
                  </div>
                )}

                {/* Review notice — بسيط بدون قائمة */}
                {summary.reviewCount > 0 && (
                  <div className="flex items-start gap-2.5 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-2xl px-4 py-3 mb-4">
                    <span className="text-amber-500 flex-shrink-0 mt-0.5">⚠</span>
                    <div>
                      <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
                        {summary.reviewCount} مقطع يحتاج مراجعة
                      </p>
                      <p className="text-xs text-amber-600 dark:text-amber-400 mt-0.5">
                        لم يُحذف تلقائياً — يمكنك مراجعته عبر التعديل اليدوي
                      </p>
                    </div>
                  </div>
                )}

                {/* Player */}
                <audio
                  ref={audioRef}
                  onTimeUpdate={e => setCurTime(e.currentTarget.currentTime)}
                  onDurationChange={e => setDur(e.currentTarget.duration)}
                  onPlay={() => setPlaying(true)}
                  onPause={() => setPlaying(false)}
                  onEnded={() => setPlaying(false)}
                />
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-mono text-slate-400 w-10 text-right tabular-nums">{fmt(curTime)}</span>
                    <input
                      type="range" min={0} max={dur || 1} step={0.1} value={curTime}
                      onChange={e => {
                        const t = parseFloat(e.target.value);
                        setCurTime(t);
                        if (audioRef.current) audioRef.current.currentTime = t;
                      }}
                      className="flex-1 accent-emerald-500 h-1.5 cursor-pointer"
                    />
                    <span className="text-xs font-mono text-slate-400 w-10 tabular-nums">{fmt(dur)}</span>
                  </div>
                  <div className="flex items-center justify-center gap-2">
                    {[-5, -1].map(d => (
                      <button key={d} onClick={() => jump(d)}
                        className="px-3 py-2 text-xs rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-700 font-mono transition-all">
                        {d}ث
                      </button>
                    ))}
                    <button
                      onClick={() => { const el = audioRef.current; if (!el) return; playing ? el.pause() : el.play(); }}
                      className="w-13 h-13 w-12 h-12 rounded-full bg-emerald-600 hover:bg-emerald-500 text-white text-xl flex items-center justify-center transition-all shadow-md mx-2 hover:scale-105 active:scale-95"
                    >
                      {playing ? "⏸" : "▶"}
                    </button>
                    {[1, 5].map(d => (
                      <button key={d} onClick={() => jump(d)}
                        className="px-3 py-2 text-xs rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-500 hover:bg-slate-200 dark:hover:bg-slate-700 font-mono transition-all">
                        +{d}ث
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Actions */}
              <div className="px-5 pb-5 space-y-2 border-t border-slate-100 dark:border-slate-800 pt-4">
                <button onClick={() => setStage("save")}
                  className="w-full py-4 bg-emerald-600 hover:bg-emerald-500 active:scale-[0.99] text-white text-base font-bold rounded-2xl transition-all shadow-md">
                  💾 حفظ النهائي
                </button>
                <button onClick={() => setStage("edit")}
                  className="w-full py-3 border-2 border-slate-200 dark:border-slate-700 hover:border-blue-400 dark:hover:border-blue-600 text-slate-700 dark:text-slate-300 font-semibold rounded-2xl transition-all text-sm hover:bg-blue-50 dark:hover:bg-blue-950/20">
                  ✏️ تعديل يدوي
                </button>
                <button
                  onClick={() => { setSummary(null); setFile(null); setStage("upload"); }}
                  className="w-full py-2 text-xs text-slate-400 hover:text-slate-600 transition-colors"
                >
                  رفع تسجيل جديد
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── STAGE: edit — TrimPanel كامل ─────────────────────────── */}
        {stage === "edit" && summary && (
          <div className="space-y-4">
            {/* Header */}
            <div className="flex items-center gap-3 pt-2">
              <button onClick={() => setStage("result")}
                className="text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 text-sm transition-colors">
                ← رجوع
              </button>
              <h2 className="font-bold text-slate-800 dark:text-slate-200 flex-1 text-center">
                التعديل اليدوي
              </h2>
              <span className="text-xs text-slate-400 w-12"/>
            </div>

            <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
              <div className="px-4 py-3 bg-blue-50 dark:bg-blue-950/30 border-b border-blue-100 dark:border-blue-900">
                <p className="text-sm text-blue-700 dark:text-blue-300 text-center">
                  اسحب لتحديد جزء · احذف أو احتفظ · تراجع فوري
                </p>
              </div>

              {/* TrimPanel الكامل */}
              <TrimPanel
                audioUrl={summary.processedUrl}
                fileName={file?.name ?? "recording.wav"}
                onDownload={async (blob, name) => {
                  // كل عملية تعديل في TrimPanel تُنتج blob جديد — نحفظه دائماً
                  try {
                    const arrayBuf = await blob.arrayBuffer();
                    const ctx      = new AudioContext();
                    const newBuf   = await ctx.decodeAudioData(arrayBuf);
                    await ctx.close();
                    const newUrl   = URL.createObjectURL(blob);
                    setSummary(prev => prev
                      ? { ...prev, processedBuffer: newBuf, processedUrl: newUrl, newDuration: newBuf.duration }
                      : prev
                    );
                  } catch {
                    // fallback: حدّث URL فقط
                    const newUrl = URL.createObjectURL(blob);
                    setSummary(prev => prev ? { ...prev, processedUrl: newUrl } : prev);
                  }
                  // حمّل الملف أيضاً
                  const url = URL.createObjectURL(blob);
                  const a   = document.createElement("a");
                  a.href = url; a.download = name;
                  document.body.appendChild(a); a.click();
                  document.body.removeChild(a);
                  URL.revokeObjectURL(url);
                }}
                onUseInPlayer={async (blob, _name) => {
                  // TrimPanel يستدعي هذا عند كل "استخدم في المشغل" — نحدّث الـ buffer الكامل
                  try {
                    const arrayBuf = await blob.arrayBuffer();
                    const ctx      = new AudioContext();
                    const newBuf   = await ctx.decodeAudioData(arrayBuf);
                    await ctx.close();
                    const newUrl   = URL.createObjectURL(blob);
                    setSummary(prev => prev
                      ? { ...prev, processedBuffer: newBuf, processedUrl: newUrl, newDuration: newBuf.duration }
                      : prev
                    );
                  } catch {
                    const newUrl = URL.createObjectURL(blob);
                    setSummary(prev => prev ? { ...prev, processedUrl: newUrl } : prev);
                  }
                }}
              />
            </div>

            {/* Save from edit */}
            <button onClick={() => setStage("save")}
              className="w-full py-4 bg-emerald-600 hover:bg-emerald-500 text-white text-base font-bold rounded-2xl transition-all shadow-md">
              💾 حفظ النهائي
            </button>
          </div>
        )}

        {/* ── STAGE: save ───────────────────────────────────────────── */}
        {stage === "save" && summary && (
          <div className="space-y-4">
            <div className="flex items-center gap-3 pt-2">
              <button onClick={() => setStage("result")}
                className="text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 text-sm transition-colors">
                ← رجوع
              </button>
              <h2 className="font-bold text-slate-800 dark:text-slate-200 flex-1 text-center">
                اختر صيغة الحفظ
              </h2>
              <span className="w-12"/>
            </div>

            <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
              <div className="p-5 space-y-2">

                {/* WAV */}
                <button onClick={() => setExportFmt("wav")}
                  className={`w-full flex items-center gap-4 px-4 py-4 rounded-2xl border-2 text-right transition-all ${
                    exportFmt === "wav"
                      ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-950/40"
                      : "border-slate-200 dark:border-slate-700 hover:border-emerald-300"
                  }`}>
                  <div className={`w-5 h-5 rounded-full border-2 flex-shrink-0 flex items-center justify-center ${
                    exportFmt === "wav" ? "border-emerald-500 bg-emerald-500" : "border-slate-300"
                  }`}>
                    {exportFmt === "wav" && <div className="w-2 h-2 rounded-full bg-white"/>}
                  </div>
                  <div className="flex-1">
                    <p className="font-bold text-slate-800 dark:text-slate-200 text-sm">WAV</p>
                    <p className="text-xs text-slate-400 mt-0.5">جودة أصلية — موثوق دائماً</p>
                  </div>
                  <span className="text-xs font-mono text-slate-400">~{sizeSuffix(wavMb)}</span>
                </button>

                {/* MP3 options */}
                {([192, 128, 96] as const).map(br => (
                  <button key={br}
                    onClick={() => { setExportFmt("mp3"); setExportBr(br); }}
                    className={`w-full flex items-center gap-4 px-4 py-4 rounded-2xl border-2 text-right transition-all ${
                      exportFmt === "mp3" && exportBr === br
                        ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-950/40"
                        : "border-slate-200 dark:border-slate-700 hover:border-emerald-300"
                    }`}>
                    <div className={`w-5 h-5 rounded-full border-2 flex-shrink-0 flex items-center justify-center ${
                      exportFmt === "mp3" && exportBr === br
                        ? "border-emerald-500 bg-emerald-500"
                        : "border-slate-300"
                    }`}>
                      {exportFmt === "mp3" && exportBr === br &&
                        <div className="w-2 h-2 rounded-full bg-white"/>}
                    </div>
                    <div className="flex-1">
                      <p className="font-bold text-slate-800 dark:text-slate-200 text-sm">
                        MP3 {br}k
                        {br === 128 && (
                          <span className="mr-2 text-xs text-emerald-600 dark:text-emerald-400 font-normal">
                            · واتساب ✓
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-slate-400 mt-0.5">
                        {br === 192 ? "جودة عالية" : br === 128 ? "مناسب للمشاركة" : "حجم صغير"}
                      </p>
                    </div>
                    <span className="text-xs font-mono text-slate-400">~{sizeSuffix(mp3Mb(br))}</span>
                  </button>
                ))}
              </div>

              <div className="px-5 pb-5">
                <button onClick={handleExport} disabled={isExporting}
                  className="w-full py-4 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-white text-base font-bold rounded-2xl transition-all shadow-md flex items-center justify-center gap-2">
                  {isExporting
                    ? <><div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"/>جاري التحميل...</>
                    : <>⬇ تحميل الملف</>}
                </button>
                <p className="text-xs text-slate-400 text-center mt-3">
                  إذا فشل MP3 ، سيُحمَّل WAV تلقائياً
                </p>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}
