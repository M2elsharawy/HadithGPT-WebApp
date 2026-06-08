/**
 * Audio Studio — Tools Page
 *
 * Workflow: Upload → Play → Choose Tool → Edit → Export
 *
 * UI مُعاد تصميمه بالكامل — كل منطق المعالجة محفوظ دون تعديل
 */

import { useState, useRef, useEffect, useCallback } from "react";
import { useAuth } from "@/_core/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Upload, Music, X, Download, Zap, RotateCcw,
  Scissors, Sliders, MicOff, Activity, Layers,
  Mic2, Sparkles, FileAudio, CheckCircle2,
} from "lucide-react";
import { toast } from "sonner";
import { AudioProcessor } from "@/components/AudioProcessor";
import { ProcessingIndicator } from "@/components/ProcessingIndicator";
import { AdvancedAudioProcessor } from "@/components/AdvancedAudioProcessor";
import { ManualEQ, EQ_BANDS, EQ_PRESETS, EQPresetName } from "@/components/ManualEQ";
import TrimPanel from "@/components/TrimPanel";
import MultiTrimPanel from "@/components/MultiTrimPanel";
import { SilenceProcessor, SilenceProcessorReport, DEFAULT_SILENCE_OPTIONS } from "@/components/SilenceProcessor";
import { PrayerTransitionAnalyzer, type VoicedSegment, type TransitionClass } from "@/components/PrayerTransitionAnalyzer";
import { useAppSettings } from "@/pages/Settings";
import { AudioTrimmerEngine } from "@/components/AudioTrimmerEngine";
import { SmartPrayerAnalyzer, type AnalyzerOptions } from "@/components/SmartPrayerAnalyzer";
import {
  SmartPrayerDecisionEngine,
  type DecidedSegment, type GlobalDecisionSummary, type DecisionEngineOptions,
} from "@/components/SmartPrayerDecisionEngine";
import {
  AudioExporter, ExportFormat, Mp3Bitrate,
  estimateMp3SizeMB, formatFileSizeMB,
} from "@/components/AudioExporter";
import { AudioEnhancementEngine } from "@/components/enhancement/AudioEnhancementEngine";
import { ENHANCEMENT_PRESETS, PRESET_LIST, DEFAULT_PRESET_ID, type PresetId } from "@/components/enhancement/EnhancementPresets";
import type { EnhancementReport, HumRemovalOptions, NoiseReductionOptions, DeReverbOptions } from "@/components/enhancement/types";
import WaveformPlayer, { WaveformPlayerHandle, WaveformMarker } from "@/components/WaveformPlayer";
import WaveformEditor, { EditableRange } from "@/components/WaveformEditor";
import PrayerMapPanel from "@/components/PrayerMapPanel";
import { useLocalHistory } from "@/hooks/useLocalHistory";
import { useAudioWorker } from "@/hooks/useAudioWorker";

const MAX_FILE_SIZE_MB    = 100;
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;

// ─── Tool IDs ──────────────────────────────────────────────────────────────────
type ToolId = "trim" | "cleanup" | "silence" | "eq" | "clarity" | "compression" | "multi" | "transcribe";

interface ToolDef {
  id: ToolId;
  icon: React.ReactNode;
  label: string;
  color: string;
  activeColor: string;
}

const TOOLS: ToolDef[] = [
  { id: "trim",        icon: <Scissors className="w-4 h-4"/>,   label: "✂ تقطيع",       color: "border-blue-200 text-blue-700 hover:bg-blue-50 dark:hover:bg-blue-950",       activeColor: "bg-blue-600 border-blue-600 text-white" },
  { id: "cleanup",     icon: <Sparkles className="w-4 h-4"/>,   label: "✨ تنظيف",       color: "border-emerald-200 text-emerald-700 hover:bg-emerald-50 dark:hover:bg-emerald-950", activeColor: "bg-emerald-600 border-emerald-600 text-white" },
  { id: "silence",     icon: <MicOff className="w-4 h-4"/>,     label: "🔇 صمت",         color: "border-violet-200 text-violet-700 hover:bg-violet-50 dark:hover:bg-violet-950",   activeColor: "bg-violet-600 border-violet-600 text-white" },
  { id: "eq",          icon: <Sliders className="w-4 h-4"/>,    label: "🎚 معادل",        color: "border-amber-200 text-amber-700 hover:bg-amber-50 dark:hover:bg-amber-950",       activeColor: "bg-amber-600 border-amber-600 text-white" },
  { id: "clarity",     icon: <Mic2 className="w-4 h-4"/>,       label: "⚡ وضوح",         color: "border-sky-200 text-sky-700 hover:bg-sky-50 dark:hover:bg-sky-950",               activeColor: "bg-sky-600 border-sky-600 text-white" },
  { id: "compression", icon: <Activity className="w-4 h-4"/>,   label: "📦 ضغط",         color: "border-orange-200 text-orange-700 hover:bg-orange-50 dark:hover:bg-orange-950",   activeColor: "bg-orange-600 border-orange-600 text-white" },
  { id: "multi",       icon: <Layers className="w-4 h-4"/>,     label: "🧩 دمج",          color: "border-indigo-200 text-indigo-700 hover:bg-indigo-50 dark:hover:bg-indigo-950",   activeColor: "bg-indigo-600 border-indigo-600 text-white" },
];

// ─── Progress bar ──────────────────────────────────────────────────────────────
function ProgressBar({ percent, label, color = "bg-blue-500" }: { percent: number; label?: string; color?: string }) {
  return (
    <div className="space-y-1">
      {label && (
        <div className="flex justify-between text-xs text-slate-500">
          <span>{label}</span><span>{Math.round(percent)}%</span>
        </div>
      )}
      <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-1.5">
        <div className={`${color} h-1.5 rounded-full transition-all duration-300`} style={{ width: `${percent}%` }}/>
      </div>
    </div>
  );
}

// ─── Section header ────────────────────────────────────────────────────────────
function SectionHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-4">
      <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200">{title}</h3>
      {subtitle && <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{subtitle}</p>}
    </div>
  );
}

// ─── Main component ────────────────────────────────────────────────────────────
// ─── normalizeDeleteRanges ────────────────────────────────────────────────────
/**
 * تنظيف قائمة نطاقات الحذف قبل تمريرها لـ deleteMultipleRanges:
 *   1. فرز تصاعدي
 *   2. دمج المتداخلة والمتقاربة (< 0.05s)
 *   3. ضبط الحدود [0, audioDuration]
 *   4. حذف النطاقات الصغيرة جداً (< 0.05s)
 */
function normalizeDeleteRanges(
  ranges: Array<{ start: number; end: number }>,
  audioDuration: number
): Array<{ start: number; end: number }> {
  const MERGE_GAP = 0.05; // دمج النطاقات المفصولة بأقل من 50ms
  const MIN_DUR   = 0.05; // تجاهل النطاقات الأصغر من 50ms

  // ضبط + تصفية
  const clamped = ranges
    .map(r => ({ start: Math.max(0, r.start), end: Math.min(audioDuration, r.end) }))
    .filter(r => r.end - r.start >= MIN_DUR);

  if (clamped.length === 0) return [];

  // فرز
  clamped.sort((a, b) => a.start - b.start);

  // دمج
  const merged: Array<{ start: number; end: number }> = [{ ...clamped[0] }];
  for (let i = 1; i < clamped.length; i++) {
    const last = merged[merged.length - 1];
    if (clamped[i].start <= last.end + MERGE_GAP) {
      last.end = Math.max(last.end, clamped[i].end);
    } else {
      merged.push({ ...clamped[i] });
    }
  }

  return merged.filter(r => r.end - r.start >= MIN_DUR);
}

// ─── EffectExportPanel — standalone component ─────────────────────────────────
interface EffectExportPanelProps {
  waveformDuration:  number;
  effectExportFmt:   "wav" | "mp3";
  effectExportBr:    96 | 128 | 192;
  isEffectExporting: boolean;
  onSelectFmt:       (fmt: "wav" | "mp3", br?: 96 | 128 | 192) => void;
  onExport:          () => void;
}
function EffectExportPanel({
  waveformDuration, effectExportFmt, effectExportBr,
  isEffectExporting, onSelectFmt, onExport,
}: EffectExportPanelProps) {
  const dur   = waveformDuration;
  const wavMb = dur > 0 ? ((dur * 44100 * 2 * 2 + 44) / (1024 * 1024)).toFixed(1) : "?";
  const mp3Mb = (br: number) => dur > 0 ? ((dur * br * 1000 / 8) / (1024 * 1024)).toFixed(1) : "?";
  return (
    <div className="bg-slate-50 dark:bg-slate-800/60 rounded-2xl border border-slate-200 dark:border-slate-700 p-4 space-y-2">
      <p className="text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">💾 اختر صيغة الحفظ:</p>
      {([
        { fmt:"wav"  as const, br: undefined as 128|192|undefined, label:"WAV",     sub:"جودة أصلية", size: wavMb },
        { fmt:"mp3"  as const, br: 128        as 128|192,          label:"MP3 128k",sub:"✓ واتساب",    size: mp3Mb(128) },
        { fmt:"mp3"  as const, br: 192        as 128|192,          label:"MP3 192k",sub:"جودة عالية",  size: mp3Mb(192) },
      ]).map(opt => (
        <button key={opt.label}
          onClick={() => onSelectFmt(opt.fmt, opt.br)}
          className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border text-xs transition-all ${
            effectExportFmt===opt.fmt && (!opt.br || effectExportBr===opt.br)
              ? "bg-emerald-600 border-emerald-600 text-white"
              : "border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 hover:border-emerald-400"
          }`}>
          <span className="font-bold w-14">{opt.label}</span>
          <span className="font-mono">~{opt.size} MB</span>
          <span className="mr-auto opacity-70">{opt.sub}</span>
        </button>
      ))}
      <button onClick={onExport} disabled={isEffectExporting}
        className="w-full h-10 flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-semibold rounded-xl text-sm transition-all">
        {isEffectExporting
          ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"/>جاري...</>
          : <>⬇ تحميل {effectExportFmt.toUpperCase()} {effectExportFmt==="mp3"?`${effectExportBr}k`:""}</>}
      </button>
    </div>
  );
}

// ─── TransitionPanel — standalone component ──────────────────────────────────
function TransitionPanel({
  segments, filter, onFilterChange, onToggle, onSelectSafe,
  onDeselectAll, onDelete, onClose, onPreview, previewingId,
}: {
  segments: VoicedSegment[];
  filter: TransitionClass | "all";
  onFilterChange: (f: TransitionClass | "all") => void;
  onToggle: (id: string) => void;
  onSelectSafe: () => void;
  onDeselectAll: () => void;
  onDelete: () => void;
  onClose: () => void;
  onPreview: (seg: VoicedSegment) => void;
  previewingId: string | null;
}) {
  const filtered = filter === "all"
    ? segments.filter(s => s.classification !== "quran_likely")
    : segments.filter(s => s.classification === filter);
  const counts = {
    takbeer:    segments.filter(s => s.classification === "takbeer_candidate").length,
    transition: segments.filter(s => s.classification === "transition_candidate").length,
    iqama:      segments.filter(s => s.classification === "iqama_or_intro").length,
    salam:      segments.filter(s => s.classification === "salam_or_outro").length,
    review:     segments.filter(s => s.classification === "review").length,
  };
  const enabledCount = segments.filter(s => s.enabled).length;

  return (
    <div className="border border-amber-200 dark:border-amber-800 rounded-2xl overflow-hidden mt-3">
      {/* Header */}
      <div className="px-4 py-3 bg-amber-50 dark:bg-amber-950/30 border-b border-amber-100 dark:border-amber-900">
        <div className="flex items-center justify-between">
          <p className="text-sm font-bold text-amber-800 dark:text-amber-200">🕌 تحليل مقاطع الصلاة</p>
          <button onClick={onClose} className="text-amber-400 hover:text-amber-600 text-xl leading-none">×</button>
        </div>
        <div className="flex flex-wrap gap-1.5 mt-2">
          {counts.takbeer > 0 && <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900 text-amber-700 dark:text-amber-300 font-medium">{counts.takbeer} تكبير محتمل</span>}
          {counts.iqama   > 0 && <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 font-medium">{counts.iqama} إقامة/افتتاح</span>}
          {counts.salam   > 0 && <span className="text-xs px-2 py-0.5 rounded-full bg-violet-100 dark:bg-violet-900 text-violet-700 dark:text-violet-300 font-medium">{counts.salam} تسليم/خاتمة</span>}
          {counts.transition > 0 && <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-900 text-indigo-700 dark:text-indigo-300 font-medium">{counts.transition} انتقال محتمل</span>}
          {counts.review  > 0 && <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 font-medium">{counts.review} يحتاج مراجعة</span>}
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-0.5 p-1.5 bg-amber-50/50 dark:bg-amber-950/10 border-b border-amber-100 dark:border-amber-900 overflow-x-auto">
        {(["all","takbeer_candidate","iqama_or_intro","salam_or_outro","transition_candidate","review"] as const).map(val => (
          <button key={val} onClick={() => onFilterChange(val)}
            className={`flex-shrink-0 px-2.5 py-1 text-xs rounded-lg font-medium transition-all ${
              filter === val
                ? "bg-white dark:bg-slate-900 text-amber-700 dark:text-amber-300 shadow-sm"
                : "text-slate-500 hover:text-slate-700"
            }`}>
            {val==="all"?"الكل":val==="takbeer_candidate"?"تكبير":val==="iqama_or_intro"?"إقامة":val==="salam_or_outro"?"تسليم":val==="transition_candidate"?"انتقال":"مراجعة"}
          </button>
        ))}
      </div>

      {/* Warning */}
      <div className="mx-3 my-2 px-3 py-2 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-xl text-xs text-red-700 dark:text-red-300">
        ⚠ <strong>تحذير:</strong> تحقق قبل الحذف. المقاطع المعلّمة بـ ★ مقترح حذفها فقط.
      </div>

      {/* List */}
      <div className="px-3 pb-2 max-h-60 overflow-y-auto space-y-1.5">
        {filtered.length === 0 && <p className="text-center text-xs text-slate-400 py-4">لا توجد مقاطع في هذا التصنيف</p>}
        {filtered.map(seg => {
          const color = PrayerTransitionAnalyzer.classColor(seg.classification);
          const label = PrayerTransitionAnalyzer.classLabel(seg.classification);
          return (
            <div key={seg.id} className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-xs transition-all ${
              seg.enabled
                ? "bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-800"
                : "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700"
            }`}>
              <button onClick={() => onToggle(seg.id)}
                className={`flex-shrink-0 w-5 h-5 rounded border-2 flex items-center justify-center ${
                  seg.enabled ? "bg-red-500 border-red-500" : "bg-white dark:bg-slate-900 border-slate-300"
                }`}>
                {seg.enabled && <span className="text-white font-bold" style={{fontSize:"10px"}}>✓</span>}
              </button>
              <span className="flex-shrink-0 text-xs px-1.5 py-0.5 rounded-full font-semibold"
                style={{background:color+"25",color}}>
                {label}{seg.safeToRemove?" ★":""}
              </span>
              <span className="font-mono text-slate-600 dark:text-slate-400 flex-1">
                {PrayerTransitionAnalyzer.fmt(seg.startSec)}
                <span className="text-slate-300 mx-1">←</span>
                {PrayerTransitionAnalyzer.fmt(seg.endSec)}
              </span>
              <span className="font-mono text-slate-400 flex-shrink-0">{seg.durationSec.toFixed(1)}ث</span>
              <button onClick={() => onPreview(seg)}
                className={`flex-shrink-0 w-7 h-7 flex items-center justify-center rounded-lg text-xs transition-all ${
                  previewingId === seg.id
                    ? "bg-emerald-600 text-white"
                    : "bg-slate-100 dark:bg-slate-800 text-slate-500 hover:bg-emerald-100 hover:text-emerald-600"
                }`}>
                {previewingId === seg.id ? "⏹" : "▶"}
              </button>
            </div>
          );
        })}
      </div>

      {/* Actions */}
      <div className="px-3 pb-3 space-y-2 border-t border-amber-100 dark:border-amber-900 pt-3">
        <div className="flex gap-1.5 text-xs">
          <button onClick={onSelectSafe}
            className="px-2.5 py-1.5 rounded-lg bg-amber-100 dark:bg-amber-900 text-amber-700 dark:text-amber-300 hover:bg-amber-200">
            تحديد المقترح ★
          </button>
          <button onClick={onDeselectAll}
            className="px-2.5 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 hover:bg-slate-200">
            إلغاء الكل
          </button>
        </div>
        <button onClick={onDelete} disabled={enabledCount === 0}
          className={`w-full h-11 rounded-xl text-sm font-bold flex items-center justify-center gap-2 transition-all ${
            enabledCount === 0
              ? "bg-slate-100 dark:bg-slate-800 text-slate-400 cursor-not-allowed"
              : "bg-red-600 hover:bg-red-500 text-white shadow-sm"
          }`}>
          {enabledCount > 0 ? <>✂ حذف المحدد ({enabledCount} مقطع)</> : "حدّد مقاطع للحذف أولاً"}
        </button>
      </div>
    </div>
  );
}

export default function Tools() {
  useAuth();
  const { settings: appSettings, update: updateSettings } = useAppSettings();
  const { addEntry: addHistoryEntry } = useLocalHistory();
  const audioWorker = useAudioWorker();

  // ── Core state ───────────────────────────────────────────────────────────
  const [selectedFile, setSelectedFile]     = useState<File | null>(null);
  const [isUploading, setIsUploading]       = useState(false);
  const [isDragging, setIsDragging]         = useState(false);
  const [isPlaying, setIsPlaying]           = useState(false);
  const [currentAudio, setCurrentAudio]     = useState<{ id: number; url: string; name: string } | null>(null);
  const [isProcessing, setIsProcessing]     = useState(false);
  const [audioProcessor, setAudioProcessor] = useState<AudioProcessor | null>(null);
  const [advancedProcessor, setAdvancedProcessor] = useState<AdvancedAudioProcessor | null>(null);
  const [activeEffects, setActiveEffects]   = useState<Set<string>>(new Set());
  const [isApplyingEffect, setIsApplyingEffect] = useState(false);
  const [currentEffectName, setCurrentEffectName] = useState("");
  const [effectProgress, setEffectProgress] = useState(0);
  // ── Enhancement Engine state ────────────────────────────────────────────────
  const [enhancementPresetId, setEnhancementPresetId] = useState<PresetId>(DEFAULT_PRESET_ID);
  const [isEnhancing, setIsEnhancing]                 = useState(false);
  const [enhancementProgress, setEnhancementProgress] = useState(0);
  const [enhancementStage, setEnhancementStage]       = useState("");
  const [enhancementReport, setEnhancementReport]     = useState<EnhancementReport | null>(null);
  const [humEnabled, setHumEnabled]   = useState(false);
  const [humFreqHz, setHumFreqHz]     = useState<50 | 60>(50);
  const [humStrength, setHumStrength] = useState<HumRemovalOptions["strength"]>("medium");
  const [nrEnabled, setNrEnabled]     = useState(false);
  const [nrStrength, setNrStrength]   = useState<NoiseReductionOptions["strength"]>("light");
  const [drEnabled, setDrEnabled]     = useState(false);
  const [drAmount, setDrAmount]       = useState<DeReverbOptions["amount"]>("light");
  const [waveformDuration, setWaveformDuration] = useState(0);
  const [waveformCurrentTime, setWaveformCurrentTime] = useState(0);

  // ── Phase F: A/B Comparison & Export Flow ──────────────────────────────────
  const [originalAudioBufferRef, setOriginalAudioBufferRef] = useState<AudioBuffer | null>(null);
  const [enhancedAudioBufferRef, setEnhancedAudioBufferRef] = useState<AudioBuffer | null>(null);
  const [enhancedAudioUrl, setEnhancedAudioUrl] = useState<string | null>(null);
  const [previewMode, setPreviewMode] = useState<'original' | 'enhanced'>('enhanced');
  const [settingsChangedAfterProcessing, setSettingsChangedAfterProcessing] = useState(false);
  const [playbackPositionBeforeSwitch, setPlaybackPositionBeforeSwitch] = useState(0);
  const [wasPlayingBeforeSwitch, setWasPlayingBeforeSwitch] = useState(false);

  // ── URLs ─────────────────────────────────────────────────────────────────
  const [originalAudioUrl, setOriginalAudioUrl] = useState<string | null>(null);
  const [processedBlobUrl, setProcessedBlobUrl] = useState<string | null>(null);
  const [processedFileName, setProcessedFileName] = useState("");
  const isModified = !!(currentAudio && originalAudioUrl && currentAudio.url !== originalAudioUrl);

  // ── Undo / Redo history ───────────────────────────────────────────────────
  // كل entry: { url, name } — blob URLs لا تُلغى حتى تخرج من كلا الـ stack
  interface HistoryEntry { url: string; name: string; }
  const undoStack = useRef<HistoryEntry[]>([]);
  const redoStack = useRef<HistoryEntry[]>([]);
  const [undoCount, setUndoCount] = useState(0); // لإعادة الـ render عند تغيّر الـ stack
  const [redoCount, setRedoCount] = useState(0);

  const MAX_HISTORY = 20;

  /** يُلغي blob URL إذا لم يعد مرجَّعاً في أي مكان */
  const safeRevoke = useCallback((url: string) => {
    if (!url.startsWith("blob:")) return;
    if (url === originalAudioUrl) return;
    if (url === currentAudio?.url) return;
    if (url === enhancedAudioUrl) return;  // Phase F-2: Protect enhanced
    const inUndo = undoStack.current.some(e => e.url === url);
    const inRedo = redoStack.current.some(e => e.url === url);
    if (!inUndo && !inRedo) {
      setTimeout(() => URL.revokeObjectURL(url), 300);
    }
  }, [originalAudioUrl, currentAudio?.url, enhancedAudioUrl]);  // Add enhancedAudioUrl

  // ── EQ ───────────────────────────────────────────────────────────────────
  const [manualEQ]      = useState<ManualEQ>(() => new ManualEQ());
  const [eqGains, setEqGains] = useState<number[]>([0,0,0,0,0,0,0,0,0]);
  const [eqPreset, setEqPreset] = useState<EQPresetName | null>(null);
  const [isExportingEQ, setIsExportingEQ] = useState(false);
  const [eqExportProgress, setEqExportProgress] = useState(0);
  const [eqExportStage, setEqExportStage] = useState("");

  // ── Cleanup ───────────────────────────────────────────────────────────────
  const [isCleaningUp, setIsCleaningUp]   = useState(false);
  const [cleanupProgress, setCleanupProgress] = useState(0);
  const [cleanupStage, setCleanupStage]   = useState("");

  // ── Silence ───────────────────────────────────────────────────────────────
  const [isDetectingSilence, setIsDetectingSilence] = useState(false);
  const [isRemovingSilence, setIsRemovingSilence]   = useState(false);
  const [silenceProgress, setSilenceProgress]       = useState(0);
  const [silenceStage, setSilenceStage]             = useState("");
  const [silenceReport, setSilenceReport]           = useState<SilenceProcessorReport | null>(null);

  // ── Silence settings — تُحمَّل من الإعدادات المحفوظة ──────────────────────
  const [silenceThresholdDb,    setSilenceThresholdDb]    = useState(() =>
    appSettings.silenceThresholdDb ?? DEFAULT_SILENCE_OPTIONS.thresholdDb);
  const [silenceMinDuration,    setSilenceMinDuration]    = useState(() =>
    appSettings.silenceMinDuration ?? DEFAULT_SILENCE_OPTIONS.minSilenceDuration);
  const [silenceReplacementGap, setSilenceReplacementGap] = useState(() =>
    appSettings.silenceGap ?? DEFAULT_SILENCE_OPTIONS.replacementGap);
  /** وضع الكشف: "rms" = قياسي (default) | "vad" = متقدم */
  const [silenceDetectionMode, setSilenceDetectionMode] = useState<"rms" | "vad">("rms");
  const [silenceMode, setSilenceMode] = useState<"default" | "smart">("default");
  /** حذف كل المحدد بدون قيود maxRemovableRatio */
  const [forceDeleteAll, setForceDeleteAll]             = useState(false);

  // ── Silence workspace extras ───────────────────────────────────────────────
  const SILENCE_THEMES = [
    { id:"slate",  wave:"#94a3b8", sel:"#3b82f6" },
    { id:"green",  wave:"#4ade80", sel:"#22c55e" },
    { id:"violet", wave:"#a78bfa", sel:"#8b5cf6" },
  ] as const;
  type SilenceThemeId = typeof SILENCE_THEMES[number]["id"];
  const [silenceThemeId, setSilenceThemeId] = useState<SilenceThemeId>("slate");
  const silenceTheme = SILENCE_THEMES.find(t => t.id === silenceThemeId) ?? SILENCE_THEMES[0];
  const [silencePlayRate, setSilencePlayRate] = useState(1);
  const [silenceCrossfade, setSilenceCrossfade] = useState(0.02);
  const [silenceHistoryChips, setSilenceHistoryChips] = useState<{id:string;label:string}[]>([]);
  const addSilenceChip = (label: string) =>
    setSilenceHistoryChips(prev => [...prev.slice(-4), { id: String(Date.now()), label }]);
  // Loop state for silence workspace
  const [silenceLoopEnabled, setSilenceLoopEnabled] = useState(false);
  const silenceLoopSrcRef = useRef<AudioBufferSourceNode|null>(null);
  const silenceLoopCtxRef = useRef<AudioContext|null>(null);
  const [showAdvancedSilence, setShowAdvancedSilence] = useState(false);
  const [showSilenceExport, setShowSilenceExport]     = useState(false);
  /** AudioBuffer للملف النشط — لتشغيل WaveformEditor في silence workspace */
  // AudioBuffer في useRef لتجنب تسرب الذاكرة (~600MB للملفات الطويلة)
  const silenceAudioBufferRef = useRef<AudioBuffer | null>(null);
  // getter/setter متوافقان مع الكود القديم
  const silenceAudioBuffer = silenceAudioBufferRef.current;
  const setSilenceAudioBuffer = (buf: AudioBuffer | null) => { silenceAudioBufferRef.current = buf; };
  const [silencePlayerTime, setSilencePlayerTime]   = useState(0);
  const startSilenceLoop = useCallback((s: number, e: number) => {
    const buf = silenceAudioBuffer; if (!buf) return;
    try { silenceLoopSrcRef.current?.stop(); } catch { /**/ }
    silenceLoopCtxRef.current?.close().catch(() => {});
    const ctx = new AudioContext(); silenceLoopCtxRef.current = ctx;
    const src = ctx.createBufferSource(); src.buffer = buf;
    src.loop=true; src.loopStart=s; src.loopEnd=e;
    src.connect(ctx.destination); src.start(0, s);
    silenceLoopSrcRef.current = src;
  }, [silenceAudioBuffer]);
  const stopSilenceLoop = useCallback(() => {
    try { silenceLoopSrcRef.current?.stop(); } catch { /**/ }
    silenceLoopSrcRef.current=null;
    silenceLoopCtxRef.current?.close().catch(()=>{}); silenceLoopCtxRef.current=null;
    setSilenceLoopEnabled(false);
  }, []);
  const [deleteConfirm, setDeleteConfirm] = useState<{
    deleteRatio: number; totalToDelete: number;
    estimatedFinal: number; normalized: Array<{start:number;end:number}>;
  } | null>(null);
  const deleteConfirmBufRef = useRef<AudioBuffer | null>(null);
  /** نتائج تشخيصية تُعرض بعد الكشف في VAD mode */
  const [silenceDiagnostics, setSilenceDiagnostics]     = useState<{
    noiseFloorDb: number; effectiveThresholdDb: number;
  } | null>(null);
  /** النطاقات المكتشفة مع حالة enabled — المصدر الوحيد للحقيقة */
  const [detectedSegments, setDetectedSegments] = useState<
    Array<{ id: string; startSec: number; endSec: number; durationSec: number; enabled: boolean }>
  >([]);
  const [highlightedSegId, setHighlightedSegId] = useState<string | null>(null);
  /** ترتيب القائمة */
  const [silenceSort, setSilenceSort] = useState<"time" | "longest">("time");
  // ── Silence zone preview ──────────────────────────────────────────────────
  const [previewingSegId, setPreviewingSegId] = useState<string | null>(null);
  const silencePreviewCtx = useRef<AudioContext | null>(null);
  const silencePreviewSrc = useRef<AudioBufferSourceNode | null>(null);
  // ── Silence result ────────────────────────────────────────────────────────
  // AudioBuffer في useRef لتجنب تسرب الذاكرة
  const silenceResultBufferRef = useRef<AudioBuffer | null>(null);
  const silenceResultBuffer = silenceResultBufferRef.current;
  const setSilenceResultBuffer = (buf: AudioBuffer | null) => { silenceResultBufferRef.current = buf; };
  const [silenceResultName, setSilenceResultName]     = useState("");
  // ── processedSilenceResult — يبقى بعد الحذف ليحافظ على الـ waveform ──────
  const [processedSilenceResult, setProcessedSilenceResult] = useState<{
    buffer:           AudioBuffer;
    url:              string;
    name:             string;
    originalDuration: number;
    newDuration:      number;
    removedDuration:  number;
    removedCount:     number;
  } | null>(null);
  // ── noSilenceFound — يحفظ حالة "اكتُشف لكن لا يوجد صمت" ──────────────────
  const [showSilenceSegmentList, setShowSilenceSegmentList] = useState(false);
  const [noSilenceFound, setNoSilenceFound] = useState(false);

  // ── PrayerTransitionAnalyzer state ──────────────────────────────────────────
  const [transitionSegments, setTransitionSegments]       = useState<VoicedSegment[]>([]);
  const [showTransitionPanel, setShowTransitionPanel]     = useState(false);
  // ── PrayerMapPanel state (وضع ذكي — مراجعة قبل الحذف) ──────────────────────
  const [prayerSegments, setPrayerSegments]               = useState<VoicedSegment[]>([]);
  const [showPrayerMap, setShowPrayerMap]                 = useState(false);
  const [isAnalyzingTransitions, setIsAnalyzingTransitions] = useState(false);
  const [transitionFilter, setTransitionFilter]           = useState<TransitionClass | "all">("all");
  // refs للـ result preview — لا useState حتى يكون الـ cleanup فورياً
  const silenceResultPreviewCtx = useRef<AudioContext | null>(null);
  const silenceResultPreviewSrc = useRef<AudioBufferSourceNode | null>(null);
  const [isPreviewing, setIsPreviewing]               = useState(false);
  // ── Result preview refs ───────────────────────────────────────────────────
  const resultPreviewRef = useRef<HTMLAudioElement | null>(null);

  const handleSilenceResultPreview = () => {
    const srcBuf = processedSilenceResult?.buffer ?? silenceResultBuffer;
    if (!srcBuf) return;
    const wav = AudioTrimmerEngine.toWav(srcBuf);
    const url = URL.createObjectURL(wav);
    const audio = new Audio(url);
    resultPreviewRef.current = audio;
    audio.play().catch(() => {});
    audio.onended = () => { URL.revokeObjectURL(url); resultPreviewRef.current = null; };
  };

  const stopResultPreview = () => {
    if (resultPreviewRef.current) {
      resultPreviewRef.current.pause();
      resultPreviewRef.current = null;
    }
  };

  // ── Silence export ────────────────────────────────────────────────────────
  const [silenceExportFormat, setSilenceExportFormat] = useState<ExportFormat>("wav");
  const [silenceExportBitrate, setSilenceExportBitrate] = useState<Mp3Bitrate>(192);
  const [silenceExportName, setSilenceExportName]     = useState("");
  const [isSilenceExporting, setIsSilenceExporting]   = useState(false);
  const [silenceExportStatus, setSilenceExportStatus] = useState<"idle"|"exporting"|"done"|"error">("idle");
  const [silenceExportError, setSilenceExportError]   = useState("");
  const [silenceShowExport, setSilenceShowExport]     = useState(false);
  // ── Silence export handler ───────────────────────────────────────────────
  const handleSilenceExport = async () => {
    const exportBuf = silenceResultBuffer ?? processedSilenceResult?.buffer;
    const exportName = processedSilenceResult?.name ?? (currentAudio?.name ?? "audio");
    if (!exportBuf) { toast.error("لا يوجد ناتج للتصدير"); return; }
    setIsSilenceExporting(true); setSilenceExportStatus("exporting"); setSilenceExportError("");
    try {
      const blob = await AudioExporter.export(exportBuf, {
        format: silenceExportFormat, mp3Bitrate: silenceExportBitrate,
      });
      if (blob.size === 0) throw new Error("الملف الناتج فارغ");
      const name = silenceExportName.trim() ||
        AudioExporter.buildExportName(exportName, silenceExportFormat);
      AudioExporter.downloadBlob(blob, name);
      addHistoryEntry({ name, sizeMb: blob.size/(1024*1024), duration: exportBuf.duration,
        operations: ["إزالة الصمت"], exportFmt: silenceExportFormat });
      setSilenceExportStatus("done");
      toast.success(`✓ تم التحميل: ${name}`);
      setTimeout(() => setSilenceExportStatus("idle"), 2500);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "خطأ";
      setSilenceExportError(msg); setSilenceExportStatus("error");
      toast.error(`فشل التصدير: ${msg}`);
    } finally { setIsSilenceExporting(false); }
  };


  // ── Smart Auto Clean ──────────────────────────────────────────────────────
  type AutoCleanPreset = "conservative" | "balanced" | "aggressive";
  const [autoCleanPreset, setAutoCleanPreset] = useState<AutoCleanPreset>("balanced");
  const [isAutoClean, setIsAutoClean]         = useState(false);
  const [autoCleanProgress, setAutoCleanProgress] = useState(0);
  const [autoCleanStage, setAutoCleanStage]   = useState("");
  const [autoCleanResult, setAutoCleanResult] = useState<{
    originalDuration: number;
    finalDuration: number;
    removedRatio: number;
    removedCount: number;
  } | null>(null);
  const [smartModeEnabled, setSmartModeEnabled] = useState(false);
  /** النتائج المُثرَّاة من SmartPrayerDecisionEngine */
  const [decidedSegments, setDecidedSegments]   = useState<DecidedSegment[]>([]);
  const [decisionSummary, setDecisionSummary]   = useState<GlobalDecisionSummary | null>(null);
  /** يسمح للمستخدم بتجاوز قرار الـ engine لكل جزء */
  const [smartOverrides, setSmartOverrides]     = useState<Record<string, boolean>>({});
  const [isAnalyzing, setIsAnalyzing]           = useState(false);
  // ── وضع الصلاة — الإعدادات المثلى لتسجيلات الصلاة ────────────────────────
  // PRAYER_PRESET — القيم المُختبَرة للصلاة (ثابتة كمرجع)
  const PRAYER_PRESET = {
    thresholdDb:        -20,
    minSilenceDuration:  5,
    replacementGap:      5,
  } as const;

  const applyPrayerPreset = () => {
    setSilenceThresholdDb(PRAYER_PRESET.thresholdDb);
    setSilenceMinDuration(PRAYER_PRESET.minSilenceDuration);
    setSilenceReplacementGap(PRAYER_PRESET.replacementGap);
    // حفظ في الإعدادات المحلية
    updateSettings({
      silenceThresholdDb:  PRAYER_PRESET.thresholdDb,
      silenceMinDuration:  PRAYER_PRESET.minSilenceDuration,
      silenceGap:          PRAYER_PRESET.replacementGap,
      silenceMode:         "prayer",
    });
    toast.success("✓ وضع الصلاة — حذف الصمت الطويل");
  };

  // ── Smart analysis — يُشغَّل بعد الكشف إذا كان Smart Mode مفعَّلاً ─────────
  const runSmartAnalysis = (
    rawSegs: Array<{ id: string; startSec: number; endSec: number; durationSec: number; enabled: boolean }>,
    totalAudioSec: number
  ) => {
    if (rawSegs.length === 0) { setDecidedSegments([]); setDecisionSummary(null); return; }
    setIsAnalyzing(true);

    // rmsFrames وهمية إذا لم يُعِدها SilenceProcessor بعد —
    // SmartPrayerAnalyzer يتعامل معها بأمان (تُعيد thresholdDb - 30 للـ avgDb)
    const fakeRms: number[] = [];

    const analyzerOpts: AnalyzerOptions = {
      thresholdDb:  silenceThresholdDb,
      sampleRate:   44100,
      windowSize:   2048,
    };
    const enriched = SmartPrayerAnalyzer.analyze(rawSegs, fakeRms, analyzerOpts);

    const engineOpts: DecisionEngineOptions = {
      minKeepDuration:     1.5,
      preTailSec:          0.3,
      postTailSec:         0.4,
      maxRemovableRatio:   0.40,
    };
    const { segments: decided, summary } = SmartPrayerDecisionEngine.decide(
      enriched, totalAudioSec, engineOpts
    );

    setDecidedSegments(decided);
    setDecisionSummary(summary);
    setSmartOverrides({});
    setIsAnalyzing(false);
  };

  // ── Smart Auto Clean ──────────────────────────────────────────────────────
  const PRESET_CONFIG: Record<string, {
    removeThreshold: number; shortPauseRemoveThreshold: number; maxRemovableRatio: number;
  }> = {
    conservative: { removeThreshold: 0.85, shortPauseRemoveThreshold: 0.75, maxRemovableRatio: 0.30 },
    balanced:     { removeThreshold: 0.75, shortPauseRemoveThreshold: 0.60, maxRemovableRatio: 0.40 },
    aggressive:   { removeThreshold: 0.60, shortPauseRemoveThreshold: 0.45, maxRemovableRatio: 0.50 },
  };

  const handleAutoClean = async () => {
    if (!currentAudio) { toast.error("لا يوجد ملف صوتي"); return; }
    setIsAutoClean(true); setAutoCleanProgress(0); setAutoCleanStage(""); setAutoCleanResult(null);
    try {
      const preset = PRESET_CONFIG[autoCleanPreset];

      // 1. VAD silence detection
      setAutoCleanStage("جاري تحليل الذبذبات..."); setAutoCleanProgress(5);
      const silenceWorkerResult1 = await audioWorker.runSilence(
        currentAudio.url,
        { thresholdDb: -50, minSilenceDuration: 1.4, replacementGap: 0.25,
          detectionMode: "vad", adaptiveHeadroomDb: 12 },
        (percent, stage) => {
          setAutoCleanStage(stage); setAutoCleanProgress(Math.round(percent * 0.35));
        },
      );
      const { report } = silenceWorkerResult1;

      const rawSegs = report.removedSegments.map((s, i) => ({
        id: `ac-${i}`, startSec: s.startSec, endSec: s.endSec,
        durationSec: s.durationSec, enabled: true,
      }));

      if (rawSegs.length === 0) {
        toast.success("لا صمت كافٍ للحذف"); setIsAutoClean(false); return;
      }

      // 2. SmartPrayerAnalyzer
      setAutoCleanStage("جاري تصنيف المقاطع..."); setAutoCleanProgress(42);
      const enriched = SmartPrayerAnalyzer.analyze(rawSegs, [], {
        thresholdDb: -50, sampleRate: 44100, windowSize: 2048,
      });

      // 3. SmartPrayerDecisionEngine
      setAutoCleanStage("جاري اتخاذ القرارات..."); setAutoCleanProgress(56);
      const buf = await AudioTrimmerEngine.loadBuffer(currentAudio.url);
      const { segments: decided, summary } = SmartPrayerDecisionEngine.decide(
        enriched, buf.duration,
        { shortPauseRemoveThreshold: preset.shortPauseRemoveThreshold,
          longPauseRemoveThreshold:  preset.removeThreshold,
          maxRemovableRatio:         preset.maxRemovableRatio,
          minKeepDuration: 1.5, preTailSec: 0.3, postTailSec: 0.4 }
      );

      const ranges = SmartPrayerDecisionEngine.toDeleteRanges(decided);
      if (ranges.length === 0) {
        toast.success("الذكاء الاصطناعي قرر الإبقاء على الملف كما هو");
        setIsAutoClean(false); return;
      }

      // 4. Apply deleteMultipleRanges
      setAutoCleanStage("جاري تطبيق التنظيف..."); setAutoCleanProgress(72);
      const outBuffer = await AudioTrimmerEngine.deleteMultipleRanges(buf, ranges, 0.25, 0.02);
      setAutoCleanProgress(90);

      // 5. setActiveAudio → Undo تلقائي
      const wavBlob = AudioTrimmerEngine.toWav(outBuffer);
      const newUrl  = URL.createObjectURL(wavBlob);
      const newName = currentAudio.name.replace(/\.[^.]+$/, "") + "-cleaned.wav";
      setActiveAudio(newUrl, newName);

      setAutoCleanResult({
        originalDuration: buf.duration,
        finalDuration:    outBuffer.duration,
        removedRatio:     summary.estimatedRemovedRatio,
        removedCount:     summary.removeCount + summary.partialTrimCount,
      });
      setAutoCleanProgress(100);
      toast.success(`✓ اكتمل التنظيف الذكي`);
    } catch (err) {
      toast.error(`فشل: ${err instanceof Error ? err.message : "خطأ غير معروف"}`);
    } finally { setIsAutoClean(false); }
  };
  const [activeTool, setActiveTool] = useState<ToolId | null>(null);
  const workspaceRef = useRef<HTMLDivElement>(null);

  // ── Refs ──────────────────────────────────────────────────────────────────
  const audioRef           = useRef<HTMLAudioElement>(null);
  const fileInputRef       = useRef<HTMLInputElement>(null);
  const waveformRef        = useRef<WaveformPlayerHandle>(null);
  const previousAudioUrlRef = useRef<string | null>(null);

  // ── Cleanup on unmount ────────────────────────────────────────────────────
  useEffect(() => {
    return () => {
      // أغلق كل الـ AudioContexts عند إلغاء تحميل الـ component
      try { silencePreviewSrc.current?.stop(); } catch { /* ignore */ }
      silencePreviewCtx.current?.close().catch(() => {});
      try { silenceResultPreviewSrc.current?.stop(); } catch { /* ignore */ }
      silenceResultPreviewCtx.current?.close().catch(() => {});
      
      // Phase F-2: Clean Phase F blob URLs on unmount
      if (enhancedAudioUrl) {
        try { URL.revokeObjectURL(enhancedAudioUrl); } catch { /* ignore */ }
      }
      if (originalAudioUrl) {
        try { URL.revokeObjectURL(originalAudioUrl); } catch { /* ignore */ }
      }
    };
  }, [enhancedAudioUrl, originalAudioUrl]); // eslint-disable-line

  // ── Audio processor init ─────────────────────────────────────────────────
  useEffect(() => {
    if (audioRef.current && !audioProcessor) {
      try {
        const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
        const source = ctx.createMediaElementSource(audioRef.current);
        const proc = new AudioProcessor(audioRef.current, ctx, source);
        proc.initialize();
        setAudioProcessor(proc);
        try { setAdvancedProcessor(new AdvancedAudioProcessor(ctx, source)); }
        catch (e) { console.warn("AdvancedAudioProcessor init failed", e); }
      } catch (e) {
        console.error("AudioProcessor init failed", e);
        toast.error("فشل تهيئة معالج الصوت");
      }
    }
  }, [audioProcessor]);

  // ── setActiveAudio — safe URL replacement with undo history ─────────────
  const setActiveAudio = useCallback((newUrl: string, newName: string, pushHistory = true) => {
    const oldUrl  = currentAudio?.url;
    const oldName = currentAudio?.name;

    // دمّر WaveSurfer أولاً قبل أي تغيير
    waveformRef.current?.destroy();

    if (pushHistory && currentAudio) {
      // احفظ الحالة الحالية في undo stack
      if (oldUrl && oldName) {
        undoStack.current.push({ url: oldUrl, name: oldName });
      }
      if (undoStack.current.length > MAX_HISTORY) {
        const evicted = undoStack.current.shift()!;
        safeRevoke(evicted.url);
      }
      // أي عملية جديدة تمسح الـ redo stack
      const evictedRedo = [...redoStack.current];
      redoStack.current = [];
      evictedRedo.forEach(e => safeRevoke(e.url));
      setUndoCount(undoStack.current.length);
      setRedoCount(0);
    }

    setCurrentAudio(prev => prev
      ? { ...prev, url: newUrl, name: newName }
      : { id: Date.now(), url: newUrl, name: newName }
    );
    previousAudioUrlRef.current = newUrl;
    // أوقف كل الـ previews مباشرةً عبر refs — بدون استدعاء دوال متأخرة
    try { silencePreviewSrc.current?.stop(); } catch { /* ignore */ }
    silencePreviewSrc.current = null;
    silencePreviewCtx.current?.close().catch(() => {});
    silencePreviewCtx.current = null;
    try { silenceResultPreviewSrc.current?.stop(); } catch { /* ignore */ }
    silenceResultPreviewSrc.current = null;
    silenceResultPreviewCtx.current?.close().catch(() => {});
    silenceResultPreviewCtx.current = null;
    setPreviewingSegId(null); setIsPreviewing(false); setSilenceExportStatus("idle"); setSilenceShowExport(false);
    // مسح الـ silence state
    setSilenceAudioBuffer(null); setDetectedSegments([]); setSilenceReport(null); setSilenceResultBuffer(null); setProcessedSilenceResult(null); setNoSilenceFound(false); setDecidedSegments([]); setDecisionSummary(null); setSmartOverrides({});

    if (processedBlobUrl && processedBlobUrl === oldUrl) {
      setProcessedBlobUrl(null);
      setProcessedFileName("");
    }
    
    // Phase F-2: Clean Phase F buffers and URLs when file changes
    setEnhancedAudioBufferRef(null);
    if (enhancedAudioUrl) {
      safeRevoke(enhancedAudioUrl);
      setEnhancedAudioUrl(null);
    }
    setPreviewMode('enhanced');
    setSettingsChangedAfterProcessing(false);
  }, [currentAudio, originalAudioUrl, processedBlobUrl, safeRevoke, enhancedAudioUrl]);

  const handleUndo = useCallback(() => {
    if (!currentAudio || undoStack.current.length === 0) return;
    const prev    = undoStack.current.pop()!;
    const oldUrl  = currentAudio.url;
    const oldName = currentAudio.name;

    // الحالة الحالية تذهب إلى redo
    redoStack.current.push({ url: oldUrl, name: oldName });
    setRedoCount(redoStack.current.length);
    setUndoCount(undoStack.current.length);

    // استعادة الحالة السابقة — بدون دفع في الـ history
    waveformRef.current?.destroy();
    // Phase F-2: Clean Phase F state on undo
    setEnhancedAudioBufferRef(null);
    if (enhancedAudioUrl) {
      safeRevoke(enhancedAudioUrl);
      setEnhancedAudioUrl(null);
    }
    setPreviewMode('enhanced');
    setSettingsChangedAfterProcessing(false);
    setCurrentAudio({ ...currentAudio, url: prev.url, name: prev.name });
    previousAudioUrlRef.current = prev.url;

    if (processedBlobUrl === oldUrl) {
      setProcessedBlobUrl(null); setProcessedFileName("");
    }
    toast.success("تم التراجع ✓");
  }, [currentAudio, processedBlobUrl]);

  const handleRedo = useCallback(() => {
    if (!currentAudio || redoStack.current.length === 0) return;
    const next    = redoStack.current.pop()!;
    const oldUrl  = currentAudio.url;
    const oldName = currentAudio.name;

    // الحالة الحالية تعود إلى undo
    undoStack.current.push({ url: oldUrl, name: oldName });
    setUndoCount(undoStack.current.length);
    setRedoCount(redoStack.current.length);

    waveformRef.current?.destroy();
    setCurrentAudio({ ...currentAudio, url: next.url, name: next.name });
    previousAudioUrlRef.current = next.url;

    if (processedBlobUrl === oldUrl) {
      setProcessedBlobUrl(null); setProcessedFileName("");
    }
    toast.success("تم الإعادة ✓");
  }, [currentAudio, processedBlobUrl]);

  // ── Tool selection with auto-scroll ─────────────────────────────────────
  const selectTool = (id: ToolId) => {
    setActiveTool(prev => prev === id ? null : id);
    setTimeout(() => workspaceRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  };

  // ── Transcription state ───────────────────────────────────────────────────
  const [isTranscribing, setIsTranscribing]         = useState(false);
  const [transcriptProgress, setTranscriptProgress] = useState(0);
  const [transcriptText, setTranscriptText]         = useState("");
  const [transcriptError, setTranscriptError]       = useState("");
  const [transcriptLang, setTranscriptLang]         = useState<"ar"|"auto"|"en">("ar");

  // ── Effect export panel state (مشترك بين Clarity/Compression/EQ) ─────────
  const [showEffectExport, setShowEffectExport]   = useState(false);
  const [effectExportFmt, setEffectExportFmt]     = useState<"wav"|"mp3">("mp3");
  const [effectExportBr, setEffectExportBr]       = useState<96|128|192>(128);
  const [isEffectExporting, setIsEffectExporting] = useState(false);

  const handleEffectExport = useCallback(async () => {
    if (!currentAudio) return;
    setIsEffectExporting(true);
    try {
      const buf  = await AudioTrimmerEngine.loadBuffer(currentAudio.url);
      let blob: Blob;
      let fname: string;
      const base = currentAudio.name.replace(/\.[^.]+$/, "");
      if (effectExportFmt === "wav") {
        blob  = AudioTrimmerEngine.toWav(buf);
        fname = `${base}-enhanced.wav`;
      } else {
        try {
          const { AudioExporter } = await import("@/components/AudioExporter");
          blob  = await AudioExporter.toMp3(buf, effectExportBr);
          fname = `${base}-enhanced-${effectExportBr}k.mp3`;
        } catch {
          blob  = AudioTrimmerEngine.toWav(buf);
          fname = `${base}-enhanced.wav`;
          toast.error("تعذّر تصدير MP3 — تم تحميل WAV بدلاً منه");
        }
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = fname;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
      addHistoryEntry({
        name: fname,
        sizeMb: blob.size / (1024 * 1024),
        duration: buf.duration,
        operations: Array.from(activeEffects),
        exportFmt: effectExportFmt,
      });
      toast.success(`✓ تم التحميل: ${fname}`);
      setShowEffectExport(false);
    } catch (e) { toast.error("فشل التصدير"); }
    finally { setIsEffectExporting(false); }
  }, [currentAudio, effectExportFmt, effectExportBr, activeEffects, addHistoryEntry]);

  // ── File handling ────────────────────────────────────────────────────────
  const handleFileSelect = (files: FileList | null) => {
    if (!files?.length) return;
    const file = files[0];
    const AUDIO_MIME = /^audio\//i;
    const AUDIO_EXT  = /\.(mp3|mp4|wav|ogg|m4a|aac|webm|flac|opus|mka|wma|aiff|aif|m4a\.mp4)$/i;
    const isAudio = AUDIO_MIME.test(file.type) || AUDIO_EXT.test(file.name) || file.type === "";
    if (!isAudio) {
      toast.error("صيغة الملف غير مدعومة — جرّب MP3 أو WAV أو M4A"); return;
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
      toast.error(`حجم الملف يتجاوز ${MAX_FILE_SIZE_MB} MB`); return;
    }
    // استدعاء مباشر بدون useState وسيط
    handleUploadFile(file);
  };

  // ref مُهمل — أُبقي عليه لتجنب أخطاء TypeScript في حال وجود إشارات له
  const autoUploadFileRef = useRef<File | null>(null);

  const handleUploadFile = (file: File) => {
    setIsUploading(true);
    try {
      waveformRef.current?.destroy();

      // blob URL مباشرةً — بدون decode أو تحويل
      const localUrl = URL.createObjectURL(file);

      setCurrentAudio({ id: Date.now(), url: localUrl, name: file.name });
      setOriginalAudioUrl(localUrl);
      previousAudioUrlRef.current = null;
      undoStack.current.forEach(e => safeRevoke(e.url));
      redoStack.current.forEach(e => safeRevoke(e.url));
      undoStack.current = []; redoStack.current = [];
      setUndoCount(0); setRedoCount(0);
      setProcessedBlobUrl(null);
      setProcessedFileName("");
      setSilenceReport(null);
      setSilenceAudioBuffer(null);
      setDetectedSegments([]);
      setDecidedSegments([]);
      setSilenceResultBuffer(null);
      setProcessedSilenceResult(null);
      setNoSilenceFound(false);
      setForceDeleteAll(false);
      setDeleteConfirm(null);
      setActiveEffects(new Set());
      setActiveTool(null);
      toast.success("تم تحميل الملف بنجاح");
    } catch {
      toast.error("فشل تحميل الملف");
    } finally {
      setIsUploading(false);
    }
  };

  // handleUpload — للتوافق مع أي استدعاء قديم
  const handleUpload = () => {
    if (selectedFile) handleUploadFile(selectedFile);
  };

  // ── Player helpers ────────────────────────────────────────────────────────
  const handleDownload = async () => {
    if (!currentAudio) return;
    setIsProcessing(true);
    try {
      const res = await fetch(currentAudio.url);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = currentAudio.name;
      document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
      // سجّل في السجل المحلي
      addHistoryEntry({
        name: currentAudio.name,
        sizeMb: blob.size / (1024 * 1024),
        duration: waveformDuration,
        operations: Array.from(activeEffects),
        exportFmt: currentAudio.name.endsWith(".mp3") ? "mp3" : "wav",
      });
    } catch { toast.error("فشل التحميل"); }
    finally { setIsProcessing(false); }
  };

  // ── Reset to original ─────────────────────────────────────────────────────
  const handleResetToOriginal = () => {
    if (!originalAudioUrl || !currentAudio) return;
    waveformRef.current?.destroy();
    const originalName = currentAudio.name
      .replace(/-cleaned\.wav$/, "").replace(/-no-silence\.wav$/, "")
      .replace(/-trimmed\.wav$/, "").replace(/-cut\.wav$/, "").replace(/-eq\.wav$/, "");
    setCurrentAudio({ ...currentAudio, url: originalAudioUrl, name: originalName });
    setProcessedBlobUrl(null); setProcessedFileName("");
    // مسح الـ silence state — الموجة القديمة لا تنطبق على الملف الأصلي
    setSilenceAudioBuffer(null); setDetectedSegments([]); setSilenceReport(null); setSilenceResultBuffer(null); setProcessedSilenceResult(null); setNoSilenceFound(false); setDecidedSegments([]); setDecisionSummary(null); setSmartOverrides({});
    toast.success("تمت استعادة الملف الأصلي");
  };

  // ── Effects ───────────────────────────────────────────────────────────────
  const handleClarityApply = useCallback(async () => {
    if (!currentAudio) return;
    setIsApplyingEffect(true); setCurrentEffectName("تحسين الوضوح"); setEffectProgress(10);
    try {
      const buf = await AudioTrimmerEngine.loadBuffer(currentAudio.url);
      setEffectProgress(40);
      const offline = new OfflineAudioContext(buf.numberOfChannels, buf.length, buf.sampleRate);
      const src = offline.createBufferSource();
      src.buffer = buf;
      // High-pass لإزالة الرنين المنخفض
      const hp = offline.createBiquadFilter();
      hp.type = "highpass"; hp.frequency.value = 120;
      // Presence boost (2-4 kHz — وضوح الكلام)
      const presence = offline.createBiquadFilter();
      presence.type = "peaking"; presence.frequency.value = 3000; presence.Q.value = 1.2; presence.gain.value = 4;
      // High-shelf لإضاءة الهواء
      const air = offline.createBiquadFilter();
      air.type = "highshelf"; air.frequency.value = 8000; air.gain.value = 2;
      src.connect(hp); hp.connect(presence); presence.connect(air); air.connect(offline.destination);
      src.start(0);
      const rendered = await offline.startRendering();
      setEffectProgress(85);
      const wav = AudioTrimmerEngine.toWav(rendered);
      const url = URL.createObjectURL(wav);
      setActiveAudio(url, currentAudio.name);
      setEffectProgress(100);
      const newEffects = new Set(activeEffects); newEffects.add("تحسين الوضوح");
      setActiveEffects(newEffects);
      toast.success("✓ تم تطبيق تحسين الوضوح على الملف");
    } catch (e) { console.error(e); toast.error("فشل تطبيق التأثير"); }
    finally { setIsApplyingEffect(false); setEffectProgress(0); setCurrentEffectName(""); }
  }, [currentAudio, activeEffects]);

  // ── Compression — تطبيق حقيقي على الـ buffer ─────────────────────────────
  const handleCompressionApply = useCallback(async () => {
    if (!currentAudio) return;
    setIsApplyingEffect(true); setCurrentEffectName("ضغط الصوت"); setEffectProgress(10);
    try {
      const buf = await AudioTrimmerEngine.loadBuffer(currentAudio.url);
      setEffectProgress(40);
      const offline = new OfflineAudioContext(buf.numberOfChannels, buf.length, buf.sampleRate);
      const src = offline.createBufferSource();
      src.buffer = buf;
      const comp = offline.createDynamicsCompressor();
      comp.threshold.value = -24;
      comp.knee.value      = 10;
      comp.ratio.value     = 4;
      comp.attack.value    = 0.005;
      comp.release.value   = 0.15;
      // Make-up gain بعد الضغط
      const gain = offline.createGain();
      gain.gain.value = 1.4;
      src.connect(comp); comp.connect(gain); gain.connect(offline.destination);
      src.start(0);
      const rendered = await offline.startRendering();
      setEffectProgress(85);
      const wav = AudioTrimmerEngine.toWav(rendered);
      const url = URL.createObjectURL(wav);
      setActiveAudio(url, currentAudio.name);
      setEffectProgress(100);
      const newEffects = new Set(activeEffects); newEffects.add("ضغط الصوت");
      setActiveEffects(newEffects);
      toast.success("✓ تم تطبيق ضغط الصوت على الملف");
    } catch (e) { console.error(e); toast.error("فشل تطبيق التأثير"); }
    finally { setIsApplyingEffect(false); setEffectProgress(0); setCurrentEffectName(""); }
  }, [currentAudio, activeEffects]);

  const handleResetEffects = () => { audioProcessor?.resetEffects(); setActiveEffects(new Set()); };

  // ── Enhancement Engine — حقيقي بالكامل، يعدّل الـ buffer الفعلي ────────────
  const handleEnhancementApply = useCallback(async () => {
    if (!currentAudio) return;
    setIsEnhancing(true);
    setEnhancementProgress(0);
    setEnhancementStage("جاري التحميل...");
    setEnhancementReport(null);
    setSettingsChangedAfterProcessing(false);
    try {
      const buf = await AudioTrimmerEngine.loadBuffer(currentAudio.url);
      
      if (!originalAudioBufferRef) {
        setOriginalAudioBufferRef(buf);
        if (!originalAudioUrl) {
          const origWav = AudioTrimmerEngine.toWav(buf);
          const origUrl = URL.createObjectURL(origWav);
          setOriginalAudioUrl(origUrl);
        }
      }
      
      const preset = ENHANCEMENT_PRESETS[enhancementPresetId];
      const options = {
        ...preset.options,
        humRemoval:     { enabled: humEnabled, frequencyHz: humFreqHz, strength: humStrength },
        noiseReduction: { enabled: nrEnabled, strength: nrStrength, mode: "broadband" as const },
        deReverb:       { enabled: drEnabled, amount: drAmount },
      };
      const workerResult = await audioWorker.runEnhance(
        buf,
        options,
        (pct, stage) => { setEnhancementProgress(pct); setEnhancementStage(stage); },
      );

      const audioCtx = new AudioContext();
      const outBuffer = audioCtx.createBuffer(
        workerResult.channels.length,
        workerResult.channels[0].length,
        buf.sampleRate,
      );
      for (let ch = 0; ch < workerResult.channels.length; ch++) {
        outBuffer.copyToChannel(workerResult.channels[ch], ch);
      }
      await audioCtx.close();

      setEnhancedAudioBufferRef(outBuffer);

      // Phase F-2: Revoke old enhanced URL before creating new one
      if (enhancedAudioUrl && enhancedAudioUrl !== currentAudio.url) {
        URL.revokeObjectURL(enhancedAudioUrl);
      }

      const wav  = AudioTrimmerEngine.toWav(outBuffer);
      const url  = URL.createObjectURL(wav);
      const name = currentAudio.name.replace(/\.[^.]+$/, "") + "-enhanced.wav";

      setEnhancedAudioUrl(url);
      setPreviewMode('enhanced');
      setActiveAudio(url, name);
      setEnhancementReport(workerResult.report);
      const fx = new Set(activeEffects); fx.add("تحسين متكامل");
      setActiveEffects(fx);
      toast.success("✓ تم تطبيق التحسين المتكامل — استخدم 'مقارنة' للمقارنة مع الأصلي");
    } catch (e) {
      console.error("[Enhancement]", e);
      toast.error(`فشل التحسين: ${e instanceof Error ? e.message : "خطأ غير معروف"}`);
    } finally {
      setIsEnhancing(false);
      setEnhancementProgress(0);
      setEnhancementStage("");
    }
  }, [currentAudio, enhancementPresetId, activeEffects, humEnabled, humFreqHz, humStrength, nrEnabled, nrStrength, drEnabled, drAmount, originalAudioBufferRef, originalAudioUrl]);

  // ── Phase F: A/B Comparison Handlers ──────────────────────────────────────
  // Phase F-2: Helper to switch preview source and restore playback
  const switchPreviewSource = useCallback((targetMode: 'original' | 'enhanced', targetUrl: string | null) => {
    const wf = waveformRef.current;
    // Capture current state BEFORE changing URL (using local variables, not state)
    const savedTime = wf?.getCurrentTime?.() ?? 0;
    const wasPlaying = wf?.isPlaying?.() ?? false;
    
    // Change preview mode and URL
    setPreviewMode(targetMode);
    if (targetUrl) {
      setCurrentAudio(prev => prev ? { ...prev, url: targetUrl } : null);
    }
    
    // Restore playback after new source loads (with minimal delay)
    // WaveformPlayer will reset currentTime to 0 on URL change, so we restore after
    const restoreTimer = setTimeout(() => {
      const wf = waveformRef.current;
      if (wf && savedTime > 0) {
        wf.seek(savedTime);
      }
      if (wf && wasPlaying) {
        wf.play();
      }
    }, 50);
    
    return () => clearTimeout(restoreTimer);
  }, []);

  const handleSwitchToOriginal = useCallback(() => {
    if (!originalAudioBufferRef) {
      toast.error("لا يوجد ملف أصلي للمقارنة");
      return;
    }
    
    let targetUrl = originalAudioUrl;
    if (!targetUrl) {
      // Create URL if not already created
      const wav = AudioTrimmerEngine.toWav(originalAudioBufferRef);
      targetUrl = URL.createObjectURL(wav);
      setOriginalAudioUrl(targetUrl);
    }
    
    switchPreviewSource('original', targetUrl);
    toast.info("تم التبديل إلى الملف الأصلي");
  }, [originalAudioBufferRef, originalAudioUrl, switchPreviewSource]);

  const handleSwitchToEnhanced = useCallback(() => {
    if (!enhancedAudioBufferRef || !enhancedAudioUrl) {
      toast.error("لا يوجد ملف محسّن للعودة إليه");
      return;
    }
    switchPreviewSource('enhanced', enhancedAudioUrl);
    toast.info("تم العودة إلى الملف المحسّن");
  }, [enhancedAudioBufferRef, enhancedAudioUrl, switchPreviewSource]);

  const handleExportOriginal = useCallback(async () => {
    if (!originalAudioBufferRef) {
      toast.error("لا يوجد ملف أصلي للتصدير");
      return;
    }
    try {
      setIsExportingEQ(true);
      const blob = await AudioExporter.export(originalAudioBufferRef, {
        format: effectExportFmt,
        mp3Bitrate: effectExportBr,
      });
      const name = currentAudio?.name.replace(/\.[^.]+$/, "") || "audio";
      const exportName = AudioExporter.buildExportName(name + "-original", effectExportFmt);
      AudioExporter.downloadBlob(blob, exportName);
      addHistoryEntry({
        name: exportName,
        sizeMb: blob.size / (1024 * 1024),
        duration: originalAudioBufferRef.duration,
        operations: ["تصدير الملف الأصلي"],
        exportFmt: effectExportFmt,
      });
      toast.success(`✓ تم تحميل الملف الأصلي: ${exportName}`);
    } catch (e) {
      toast.error(`فشل التصدير: ${e instanceof Error ? e.message : "خطأ"}`);
    } finally {
      setIsExportingEQ(false);
    }
  }, [originalAudioBufferRef, currentAudio?.name, effectExportFmt, effectExportBr]);

  const handleExportEnhanced = useCallback(async () => {
    if (!enhancedAudioBufferRef) {
      toast.error("لا يوجد ملف محسّن للتصدير. قم بمعالجة الملف أولاً.");
      return;
    }
    if (settingsChangedAfterProcessing) {
      toast.warning("تم تغيير الإعدادات بعد المعالجة. أعد المعالجة للحصول على أحدث نسخة.");
      return;
    }
    try {
      setIsExportingEQ(true);
      const blob = await AudioExporter.export(enhancedAudioBufferRef, {
        format: effectExportFmt,
        mp3Bitrate: effectExportBr,
      });
      const name = currentAudio?.name.replace(/\.[^.]+$/, "") || "audio";
      const exportName = AudioExporter.buildExportName(name + "-enhanced", effectExportFmt);
      AudioExporter.downloadBlob(blob, exportName);
      addHistoryEntry({
        name: exportName,
        sizeMb: blob.size / (1024 * 1024),
        duration: enhancedAudioBufferRef.duration,
        operations: ["تصدير الملف المحسّن"],
        exportFmt: effectExportFmt,
      });
      toast.success(`✓ تم تحميل الملف المحسّن: ${exportName}`);
    } catch (e) {
      toast.error(`فشل التصدير: ${e instanceof Error ? e.message : "خطأ"}`);
    } finally {
      setIsExportingEQ(false);
    }
  }, [enhancedAudioBufferRef, currentAudio?.name, effectExportFmt, effectExportBr, settingsChangedAfterProcessing]);

  // ── Track settings changes after enhancement ────────────────────────────────
  useEffect(() => {
    if (enhancedAudioBufferRef && !isEnhancing) {
      setSettingsChangedAfterProcessing(true);
    }
  }, [humEnabled, humFreqHz, humStrength, nrEnabled, nrStrength, drEnabled, drAmount, enhancementPresetId, enhancedAudioBufferRef, isEnhancing]);

  // ── EQ ────────────────────────────────────────────────────────────────────
  const handleEQChange = (i: number, db: number) => {
    manualEQ.setGain(i, db); setEqGains(manualEQ.getAllGains());
    advancedProcessor?.setEQGain(i, db);
  };
  const handleEQPreset = (p: EQPresetName) => {
    const g = manualEQ.applyPreset(p); setEqGains(g); setEqPreset(p);
    g.forEach((gain, i) => advancedProcessor?.setEQGain(i, gain));
  };
  // ── Time formatting ──────────────────────────────────────────────────────────
  const formatTime = (t: number) => {
    if (!t || isNaN(t) || !isFinite(t)) return "0:00";
    return `${Math.floor(t/60)}:${Math.floor(t%60).toString().padStart(2,"0")}`;
  };
  const formatTimeMs = (t: number) => {
    if (!t || isNaN(t) || !isFinite(t)) return "0:00.0";
    return `${Math.floor(t/60)}:${Math.floor(t%60).toString().padStart(2,"0")}.${Math.floor((t%1)*10)}`;
  };

  // ── Keyboard shortcuts ────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // تجاهل إذا كان التركيز داخل input أو textarea
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      const wf = waveformRef.current;

      switch (e.code) {
        case "Space":
          e.preventDefault();
          wf?.isPlaying() ? wf.pause() : wf?.play();
          break;
        case "ArrowLeft":
          e.preventDefault();
          if (wf) wf.seek(Math.max(0, wf.getCurrentTime() + (e.shiftKey ? -1 : -5)));
          break;
        case "ArrowRight":
          e.preventDefault();
          if (wf) wf.seek(wf.getCurrentTime() + (e.shiftKey ? 1 : 5));
          break;
        case "KeyM":
          e.preventDefault();
          break;
        case "Escape":
          // إغلاق الأداة النشطة
          if (activeTool) { setActiveTool(null); e.preventDefault(); }
          break;
        case "Home":
          e.preventDefault();
          wf?.seek(0);
          break;
        case "End":
          e.preventDefault();
          if (currentAudio) wf?.seek(waveformDuration);
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [activeTool, currentAudio, waveformDuration]);

  // ── EQ Preview — يشغّل 30 ثانية معالَجة مباشرةً بدون تطبيق على الملف ──────
  const eqPreviewCtxRef   = useRef<AudioContext | null>(null);
  const eqPreviewSrcRef   = useRef<AudioBufferSourceNode | null>(null);
  const [isEQPreviewing, setIsEQPreviewing] = useState(false);

  const stopEQPreview = useCallback(() => {
    try { eqPreviewSrcRef.current?.stop(); } catch {}
    eqPreviewSrcRef.current = null;
    eqPreviewCtxRef.current?.close().catch(() => {});
    eqPreviewCtxRef.current = null;
    setIsEQPreviewing(false);
  }, []);

  const handleEQPreview = useCallback(async (gains: number[]) => {
    if (!currentAudio) return;
    stopEQPreview();
    setIsEQPreviewing(true);
    try {
      // حمّل 30 ثانية فقط للـ preview السريع
      const buf = await AudioTrimmerEngine.loadBuffer(currentAudio.url);
      const previewDur = Math.min(30, buf.duration);
      const startSec   = buf.duration > 60 ? 30 : 0; // من الثانية 30 إذا كان الملف طويلاً
      const sampleRate = buf.sampleRate;
      const channels   = buf.numberOfChannels;
      const frameCount = Math.floor(previewDur * sampleRate);
      const startFrame = Math.floor(startSec * sampleRate);

      // انسخ الجزء المطلوب في buffer مؤقت
      const offline = new OfflineAudioContext(channels, frameCount, sampleRate);
      const sliceBuf = offline.createBuffer(channels, frameCount, sampleRate);
      for (let c = 0; c < channels; c++) {
        sliceBuf.copyToChannel(
          buf.getChannelData(c).slice(startFrame, startFrame + frameCount), c
        );
      }
      const src = offline.createBufferSource();
      src.buffer = sliceBuf;
      let prev: AudioNode = src;
      EQ_BANDS.forEach((band, i) => {
        const f = offline.createBiquadFilter();
        f.type = i === 0 ? "lowshelf" : i === EQ_BANDS.length - 1 ? "highshelf" : "peaking";
        f.frequency.value = band.freq; f.Q.value = 1.4; f.gain.value = gains[i];
        prev.connect(f); prev = f;
      });
      prev.connect(offline.destination); src.start(0);
      const rendered = await offline.startRendering();

      // شغّل الـ preview
      const ctx = new AudioContext();
      eqPreviewCtxRef.current = ctx;
      const playSrc = ctx.createBufferSource();
      playSrc.buffer = rendered;
      playSrc.connect(ctx.destination);
      playSrc.start(0);
      eqPreviewSrcRef.current = playSrc;
      playSrc.onended = () => {
        eqPreviewCtxRef.current?.close().catch(() => {});
        eqPreviewSrcRef.current = null;
        setIsEQPreviewing(false);
      };
      toast.success("▶ معاينة 30 ثانية — اضغط مرة أخرى للإيقاف", { duration: 2000 });
    } catch (e) {
      console.error(e);
      setIsEQPreviewing(false);
      toast.error("فشلت المعاينة");
    }
  }, [currentAudio, stopEQPreview]);

  // cleanup عند unmount أو تغيير الملف
  useEffect(() => () => stopEQPreview(), [stopEQPreview]);
  useEffect(() => { stopEQPreview(); }, [currentAudio?.url]);

  // Sync hum + NR + de-reverb controls when preset changes
  useEffect(() => {
    const { humRemoval, noiseReduction, deReverb } = ENHANCEMENT_PRESETS[enhancementPresetId].options;
    setHumEnabled(humRemoval.enabled);
    setHumFreqHz(humRemoval.frequencyHz);
    setHumStrength(humRemoval.strength);
    setNrEnabled(noiseReduction.enabled);
    setNrStrength(noiseReduction.strength);
    setDrEnabled(deReverb.enabled);
    setDrAmount(deReverb.amount);
  }, [enhancementPresetId]);

  const handleEQExport = async () => {
    const src = currentAudio?.url;
    if (!src) { toast.error("لا يوجد ملف"); return; }
    setIsExportingEQ(true); setEqExportProgress(0);
    try {
      const blob = await manualEQ.exportWithEQ(src, (pct, stage) => { setEqExportProgress(pct); setEqExportStage(stage); });
      const base = (currentAudio?.name ?? "audio").replace(/\.[^/.]+$/, "");
      const name = `${base}-eq.wav`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a"); a.href = url; a.download = name;
      document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
      toast.success("تم تصدير الملف مع المعادل ✓");
    } catch { toast.error("فشل تصدير الملف"); }
    finally { setIsExportingEQ(false); setEqExportProgress(0); setEqExportStage(""); }
  };

  // ── Transcription — Whisper via server (no auth required) ───────────────
  const transcribeAbortRef = useRef<AbortController | null>(null);

  const handleTranscribe = async () => {
    if (!currentAudio) return;

    // التحقق من دعم المتصفح للـ Web Speech API
    const SR = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;
    if (!SR) {
      setTranscriptError("متصفحك لا يدعم هذه الميزة — استخدم Chrome أو Edge");
      toast.error("متصفحك لا يدعم التعرف على الكلام");
      return;
    }

    const abortCtrl = new AbortController();
    transcribeAbortRef.current = abortCtrl;

    setIsTranscribing(true); setTranscriptProgress(5);
    setTranscriptText(""); setTranscriptError("");

    const audio       = new Audio(currentAudio.url);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const recognition = new SR() as any;
    recognition.lang             = transcriptLang === "ar" ? "ar-SA" : "en-US";
    recognition.continuous       = true;
    recognition.interimResults   = true;
    recognition.maxAlternatives  = 1;

    let finalText      = "";
    let recRunning     = true;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    recognition.onresult = (e: any) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) finalText += t + " ";
        else interim += t;
      }
      setTranscriptText(finalText + interim);
      if (audio.duration > 0) {
        setTranscriptProgress(Math.min(95, 20 + Math.round((audio.currentTime / audio.duration) * 73)));
      }
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    recognition.onerror = (e: any) => {
      if (e.error === "aborted" || e.error === "no-speech") return;
      if (e.error === "not-allowed") {
        setTranscriptError("لم يُسمح بالوصول للميكروفون — اضغط على أيقونة القفل بجانب الرابط ثم أعد المحاولة");
        setIsTranscribing(false);
      } else {
        setTranscriptError(`خطأ في التعرف: ${e.error}`);
      }
    };

    // إعادة تشغيل التعرف تلقائياً عند انتهاء الجلسة (حد 60 ث في Chrome)
    recognition.onend = () => {
      if (recRunning && !audio.ended && !audio.paused && !abortCtrl.signal.aborted) {
        try { recognition.start(); } catch {}
      }
    };

    // معالجة الإيقاف اليدوي
    abortCtrl.signal.addEventListener("abort", () => {
      recRunning = false;
      try { recognition.stop(); } catch {}
      audio.pause();
      audio.src = "";
      setIsTranscribing(false);
      toast("تم إيقاف الاستخراج");
    });

    try {
      recognition.start();
      setTranscriptProgress(15);
      await audio.play();

      // انتظر انتهاء الملف الصوتي
      await new Promise<void>(resolve => {
        audio.onended = () => resolve();
        audio.onerror = () => resolve();
      });

      // أعط التعرف ثانية إضافية لمعالجة الكلمات الأخيرة
      if (!abortCtrl.signal.aborted) {
        await new Promise(r => setTimeout(r, 1500));
      }

      recRunning = false;
      try { recognition.stop(); } catch {}
      audio.src = "";

      const result = finalText.trim();
      setTranscriptText(result);
      setTranscriptProgress(100);

      if (result) {
        toast.success("✓ تم استخراج النص");
      } else if (!abortCtrl.signal.aborted) {
        setTranscriptError("لم يُستخرج نص — تأكد من السماح بالميكروفون وأن الصوت يخرج من مكبرات الصوت وليس سماعة الرأس");
      }
    } catch (err) {
      recRunning = false;
      try { recognition.stop(); } catch {}
      audio.src = "";
      if ((err as Error).name !== "AbortError") {
        const msg = err instanceof Error ? err.message : "خطأ غير معروف";
        setTranscriptError(msg);
        toast.error(`فشل الاستخراج: ${msg}`);
      }
    } finally {
      setIsTranscribing(false);
      setTranscriptProgress(0);
      transcribeAbortRef.current = null;
    }
  };

  const handleStopTranscribe = () => {
    transcribeAbortRef.current?.abort();
    setIsTranscribing(false);
    setTranscriptProgress(0);
  };

  // ── Trim ──────────────────────────────────────────────────────────────────
  const handleTrimDownload = (blob: Blob, name: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
    // سجّل في السجل المحلي
    addHistoryEntry({
      name,
      sizeMb: blob.size / (1024 * 1024),
      duration: waveformDuration,
      operations: ["تقطيع يدوي"],
      exportFmt: name.endsWith(".mp3") ? "mp3" : "wav",
    });
  };
  const handleTrimUseInPlayer = (blob: Blob, name: string) => {
    const newUrl = URL.createObjectURL(blob);
    if (currentAudio) {
      setActiveAudio(newUrl, name);
    } else {
      // MultiTrimPanel — الملف المدموج يصبح الملف الأساسي
      setCurrentAudio({ id: Date.now(), url: newUrl, name });
      setOriginalAudioUrl(newUrl);
      previousAudioUrlRef.current = null;
      undoStack.current = []; redoStack.current = [];
      setUndoCount(0); setRedoCount(0);
    }
    toast.success(`✓ ${name} — جاهز للتصدير`);
  };

  // ── Quran cleanup ──────────────────────────────────────────────────────────
  const handleQuranCleanup = async () => {
    if (!currentAudio) { toast.error("لا يوجد ملف"); return; }
    setIsCleaningUp(true); setCleanupProgress(0);
    if (processedBlobUrl) { URL.revokeObjectURL(processedBlobUrl); setProcessedBlobUrl(null); }
    try {
      setCleanupStage("تحميل الملف..."); setCleanupProgress(15);
      const buf = await AudioTrimmerEngine.loadBuffer(currentAudio.url);

      setCleanupStage("تصفية الضجيج..."); setCleanupProgress(30);
      const offline = new OfflineAudioContext(buf.numberOfChannels, buf.length, buf.sampleRate);
      const src = offline.createBufferSource(); src.buffer = buf;

      // 1. High-pass لإزالة دوران الهواء والضجيج المنخفض
      const hp = offline.createBiquadFilter();
      hp.type = "highpass"; hp.frequency.value = 80; hp.Q.value = 0.7;

      // 2. Notch لإزالة طنين الكهرباء 50Hz
      const hum = offline.createBiquadFilter();
      hum.type = "notch"; hum.frequency.value = 50; hum.Q.value = 30;

      // 3. De-hiss: low-shelf خفيف لإيقاف الصفير العالي
      const shelf = offline.createBiquadFilter();
      shelf.type = "highshelf"; shelf.frequency.value = 12000; shelf.gain.value = -3;

      // 4. Presence boost خفيف لوضوح الكلام
      const presence = offline.createBiquadFilter();
      presence.type = "peaking"; presence.frequency.value = 2500; presence.Q.value = 1; presence.gain.value = 2;

      src.connect(hp); hp.connect(hum); hum.connect(shelf); shelf.connect(presence);
      presence.connect(offline.destination);
      src.start(0);

      setCleanupStage("تطبيع المستوى..."); setCleanupProgress(60);
      const filtered = await offline.startRendering();

      // 5. Normalize — رفع المستوى لأقصى قيمة آمنة
      const numCh = filtered.numberOfChannels;
      let peak = 0;
      for (let ch = 0; ch < numCh; ch++) {
        const d = filtered.getChannelData(ch);
        for (let i = 0; i < d.length; i++) { const v = Math.abs(d[i]); if (v > peak) peak = v; }
      }
      const gainVal = peak > 0.001 ? Math.min(0.95 / peak, 6) : 1;
      const out = offline.createBuffer(numCh, filtered.length, filtered.sampleRate);
      for (let ch = 0; ch < numCh; ch++) {
        const s = filtered.getChannelData(ch), d = out.getChannelData(ch);
        // Fade in/out 50ms لمنع الانقطاع المفاجئ
        const fadeSamp = Math.floor(0.05 * filtered.sampleRate);
        for (let i = 0; i < d.length; i++) {
          let g = gainVal;
          if (i < fadeSamp) g *= i / fadeSamp;
          if (i > d.length - fadeSamp) g *= (d.length - i) / fadeSamp;
          d[i] = s[i] * g;
        }
      }

      setCleanupStage("تصدير..."); setCleanupProgress(90);
      const { AudioExporter } = await import("@/components/AudioExporter");
      const blob = AudioExporter.toWav(out);
      const newUrl = URL.createObjectURL(blob);
      const newName = currentAudio.name.replace(/\.[^.]+$/, "") + "-cleaned.wav";
      setActiveAudio(newUrl, newName);
      setProcessedBlobUrl(newUrl); setProcessedFileName(newName);
      const newEffects = new Set(activeEffects);
      newEffects.add("تنظيف تلقائي");
      setActiveEffects(newEffects);
      toast.success("✓ اكتمل التنظيف — تصفية + تطبيع + fade");
    } catch (err) {
      const e = err instanceof Error ? err : new Error("خطأ");
      toast.error(`فشلت المعالجة: ${e.message}`);
    } finally { setIsCleaningUp(false); setCleanupProgress(0); setCleanupStage(""); }
  };
  const handleDownloadProcessed = () => {
    if (!processedBlobUrl || !processedFileName) return;
    const a = document.createElement("a"); a.href = processedBlobUrl; a.download = processedFileName;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
  };

  // ── Silence: detect only (لا تُطبّق — فقط يكتشف ويعرض) ──────────────────
  const handleDetectSilence = async () => {
    if (!currentAudio) { toast.error("لا يوجد ملف"); return; }

    // ── وضع ذكي: تحليل المقاطع الصوتية مباشرةً بدون SilenceProcessor ─────────
    if (silenceMode === "smart") {
      setIsDetectingSilence(true); setSilenceProgress(0); setSilenceStage("تحليل الأركان...");
      setShowPrayerMap(false); setPrayerSegments([]);
      setSilenceAudioBuffer(null); setProcessedSilenceResult(null); setNoSilenceFound(false);
      try {
        const buf = await AudioTrimmerEngine.loadBuffer(currentAudio.url);
        setSilenceAudioBuffer(buf);
        setSilenceProgress(40);
        await new Promise(r => setTimeout(r, 10));
        const result = PrayerTransitionAnalyzer.analyze(buf, -20);
        const segs = result.voicedSegments.map(s => ({ ...s, enabled: s.safeToRemove }));
        setPrayerSegments(segs);
        setShowPrayerMap(true);
        setSilenceProgress(100);
        const nonQuran = segs.filter(s => s.classification !== "quran_likely").length;
        toast.success(`تم تحليل ${segs.length} مقطع — ${nonQuran} مقطع غير قرآني للمراجعة`);
      } catch (err) {
        const e = err instanceof Error ? err : new Error("خطأ");
        toast.error(`فشل التحليل: ${e.message}`);
      } finally {
        setIsDetectingSilence(false); setSilenceProgress(0); setSilenceStage("");
      }
      return;
    }

    setIsDetectingSilence(true); setSilenceProgress(0); setSilenceStage("");
    setSilenceReport(null); setDetectedSegments([]); setSilenceAudioBuffer(null); setSilenceResultBuffer(null); setProcessedSilenceResult(null); setNoSilenceFound(false); setDecidedSegments([]); setDecisionSummary(null); setSmartOverrides({}); setShowSilenceSegmentList(false);
    try {
      // حمّل الـ buffer للـ waveform
      const buf = await AudioTrimmerEngine.loadBuffer(currentAudio.url);
      setSilenceAudioBuffer(buf);

      const silenceWorkerResult2 = await audioWorker.runSilence(
        currentAudio.url,
        {
          thresholdDb: silenceThresholdDb,
          minSilenceDuration: silenceMinDuration,
          replacementGap: silenceReplacementGap,
          detectionMode: silenceDetectionMode,
          adaptiveHeadroomDb: 12,
        },
        (percent, stage) => { setSilenceStage(stage); setSilenceProgress(Math.min(percent, 90)); },
      );
      const { report } = silenceWorkerResult2;
      setSilenceReport(report);
      // حفظ التشخيصات إذا كانت متاحة (VAD mode)
      if (report.detectedNoiseFloorDb !== undefined && report.effectiveThresholdDb !== undefined) {
        setSilenceDiagnostics({
          noiseFloorDb:        report.detectedNoiseFloorDb,
          effectiveThresholdDb: report.effectiveThresholdDb,
        });
      } else {
        setSilenceDiagnostics(null);
      }
      const segs = report.removedSegments.map((s, i) => ({
        id: `seg-${i}`,
        startSec: s.startSec,
        endSec: s.endSec,
        durationSec: s.durationSec,
        enabled: true,
      }));
      setDetectedSegments(segs);
      setSilenceProgress(100);

      if (segs.length === 0) {
        setNoSilenceFound(true);
        toast.success("لم يُعثر على صمت — الملف نظيف أو جرّب إعدادات مختلفة");
      } else {
        setNoSilenceFound(false);
        toast.success(`تم اكتشاف ${segs.length} فترة صمت — راجعها على الموجة`);
      }
      setProcessedSilenceResult(null); // مسح أي نتيجة سابقة
      // إذا Smart Mode مفعَّل → شغّل التحليل الذكي فوراً
      if (smartModeEnabled && segs.length > 0) {
        runSmartAnalysis(segs, buf.duration);
      }
    } catch (err) {
      const e = err instanceof Error ? err : new Error("خطأ");
      toast.error(e.message.includes("HTTP") ? "فشل تحميل الملف" : `فشل الكشف: ${e.message}`);
    } finally { setIsDetectingSilence(false); setSilenceProgress(0); setSilenceStage(""); }
  };

  // ── Silence: apply selected segments ─────────────────────────────────────
  const handleApplySilence = async () => {
    if (!currentAudio) { toast.error("لا يوجد ملف"); return; }

    setIsRemovingSilence(true); setSilenceProgress(0);
    try {
      // ── وضع ذكي — pipeline كامل بضغطة واحدة ────────────────────────────
      if (silenceMode === "smart") {
        const buf = await AudioTrimmerEngine.loadBuffer(currentAudio.url);
        const { processPrayerMode } = await import('@/components/PrayerModeProcessor');
        const result = await processPrayerMode(
          currentAudio.url,
          buf,
          (pct, stage) => { setSilenceProgress(pct); setSilenceStage(stage); },
        );

        if (result.removedCount === 0) {
          toast.success("لم يُعثر على مقاطع قابلة للحذف في هذا الملف");
          return;
        }

        const outBuffer = result.buffer;
        setSilenceProgress(85);
        setSilenceResultBuffer(outBuffer);
        const newName = SilenceProcessor.buildFileName(currentAudio?.name ?? "audio");
        setSilenceResultName(newName);
        const dot  = newName.lastIndexOf(".");
        const base = dot !== -1 ? newName.slice(0, dot) : newName;
        setSilenceExportName(`${base}.wav`);
        const outWav = AudioTrimmerEngine.toWav(outBuffer);
        const newUrl = URL.createObjectURL(outWav);
        setActiveAudio(newUrl, newName);
        setSilenceAudioBuffer(outBuffer);
        setProcessedSilenceResult({
          buffer:           outBuffer,
          url:              newUrl,
          name:             newName,
          originalDuration: result.originalSec,
          newDuration:      result.finalSec,
          removedDuration:  result.removedSec,
          removedCount:     result.removedCount,
        });
        setDetectedSegments([]); setSilenceReport(null);
        setSilenceProgress(100);
        addSilenceChip(`✂ ${result.removedCount} مقطع`);
        toast.success(
          `✓ حُذف ${result.removedCount} مقطع (${SilenceProcessor.formatDuration(result.removedSec)}) — ` +
          `المدة الجديدة: ${SilenceProcessor.formatDuration(result.finalSec)}`
        );
        return;
      }

      // ── الوضع العادي ─────────────────────────────────────────────────────
      const enabledSegs = detectedSegments.filter(s => s.enabled);
      if (enabledSegs.length === 0) { toast.error("لا توجد نطاقات مُفعَّلة للحذف"); return; }

      const buf = await AudioTrimmerEngine.loadBuffer(currentAudio.url);
      setSilenceProgress(40);

      // ── بناء الـ ranges ───────────────────────────────────────────────
      let rawRanges: Array<{ start: number; end: number }>;

      if (forceDeleteAll) {
        // Force mode: احذف كل enabled segments بدون قيود
        rawRanges = enabledSegs.map(s => ({ start: s.startSec, end: s.endSec }));
      } else if (smartModeEnabled && decidedSegments.length > 0) {
        // Smart mode: استخدم trim boundaries من DecisionEngine
        // مزامنة enabled من checkboxes
        const withOverrides = decidedSegments.map(d => {
          let enabled: boolean;
          if (d.id in smartOverrides) {
            enabled = smartOverrides[d.id];
          } else {
            const rawSeg = detectedSegments.find(s => s.id === d.id);
            enabled = rawSeg
              ? rawSeg.enabled
              : (d.decision === "remove" || d.decision === "partial_trim");
          }
          return { ...d, enabled };
        });
        rawRanges = SmartPrayerDecisionEngine.toDeleteRanges(withOverrides);
      } else {
        // Normal mode: استخدم detectedSegments مباشرةً — بلا preTail/postTail
        // هذا يطابق ما يُرسم أحمر على الـ waveform
        rawRanges = enabledSegs.map(s => ({ start: s.startSec, end: s.endSec }));
      }

      // ── normalizeDeleteRanges: فرز + دمج + تنظيف ──────────────────────
      const audioDuration = buf.duration;
      const normalized = normalizeDeleteRanges(rawRanges, audioDuration);

      if (normalized.length === 0) {
        toast.error("لا توجد نطاقات صالحة للحذف");
        return;
      }

      // ── Debug logging ─────────────────────────────────────────────────
      const totalToDelete  = normalized.reduce((s, r) => s + (r.end - r.start), 0);
      const gapTotal       = normalized.length * silenceReplacementGap;
      const estimatedFinal = audioDuration - totalToDelete + Math.min(gapTotal, totalToDelete);
      const deleteRatio    = totalToDelete / audioDuration;

      console.group(`[Apply] silenceRemove — ${normalized.length} ranges`);
      if (normalized.length > 10)
      console.groupEnd();

      // ── Hard block: أكثر من 90% أو أقل من 3 ثوانٍ ───────────────────
      if (deleteRatio > 0.90) {
        toast.error(`لا يمكن حذف ${(deleteRatio*100).toFixed(0)}% من الملف — ستكون النتيجة فارغة. قلّل المقاطع المحددة.`);
        return;
      }
      if (estimatedFinal < 3) {
        toast.error("لا يمكن حذف كل هذه المقاطع لأن الناتج سيكون قصيرًا جدًا أو فارغًا");
        return;
      }

      // ── Soft warn: أكثر من 70% أو أقل من 5 دقائق → Modal تأكيد ───────
      if (deleteRatio > 0.70 || estimatedFinal < 300) {
        deleteConfirmBufRef.current = buf;
        setDeleteConfirm({ deleteRatio, totalToDelete, estimatedFinal, normalized });
        return; // ننتظر تأكيد المستخدم
      }

      // ── تطبيق مباشر إذا لا حاجة للتأكيد ─────────────────────────────
      await doApplyConfirmed(buf, normalized);
    } catch (err) {
      const e = err instanceof Error ? err : new Error("خطأ");
      toast.error(`فشل التطبيق: ${e.message}`);
    } finally { setIsRemovingSilence(false); setSilenceProgress(0); }
  };

  /** تطبيق الحذف بعد التأكيد — مشترك بين المسار المباشر ومسار الـ Modal */
  const doApplyConfirmed = async (
    buf: AudioBuffer,
    normalized: Array<{start:number;end:number}>
  ) => {
    setIsRemovingSilence(true); setSilenceProgress(50);
    try {
      // في Force mode نستخدم gapSec=0 لأن المستخدم حدد النطاقات بنفسه
      // silenceReplacementGap كبير (0.25s × عشرات النطاقات) يُضيف دقائق زائدة
      const gap = forceDeleteAll ? 0 : silenceReplacementGap;

      // حساب دقيق للـ keep ranges قبل الاستدعاء
      const totalDur     = buf.duration;
      const totalDelete  = normalized.reduce((s, r) => s + (r.end - r.start), 0);
      const keepDuration = totalDur - totalDelete;

      if (keepDuration < 3) {
        toast.error(`الناتج سيكون ${keepDuration.toFixed(1)}s فقط — لا يمكن التطبيق. قلّل المقاطع المحددة.`);
        setIsRemovingSilence(false); setDeleteConfirm(null); setSilenceProgress(0);
        return;
      }

      const outBuffer = await AudioTrimmerEngine.deleteMultipleRanges(
        buf, normalized, gap, silenceCrossfade
      );

      if (!outBuffer || outBuffer.length === 0 || outBuffer.numberOfChannels === 0 || outBuffer.duration < 1) {
        toast.error(`الناتج غير صالح (${outBuffer?.duration?.toFixed(1) ?? 0}s) — قلّل نطاقات الحذف`);
        return;
      }
      setSilenceProgress(85);
      setSilenceResultBuffer(outBuffer);
      const newName = SilenceProcessor.buildFileName(currentAudio?.name ?? "audio");
      setSilenceResultName(newName);
      const dot  = newName.lastIndexOf(".");
      const base = dot !== -1 ? newName.slice(0, dot) : newName;
      setSilenceExportName(`${base}.wav`);

      // ── تحديث currentAudio تلقائياً — لا يحتاج المستخدم "في المشغل" ──────
      const outWav = AudioTrimmerEngine.toWav(outBuffer);
      const newUrl = URL.createObjectURL(outWav);
      setActiveAudio(newUrl, newName);
      setSilenceAudioBuffer(outBuffer);  // أبقِ الـ waveform محدَّثاً بالملف الجديد

      // ── processedSilenceResult — يُبقي الـ waveform ظاهراً بعد الحذف ─────
      const originalDur = buf.duration;
      const removedDur  = normalized.reduce((s, r) => s + (r.end - r.start), 0);
      setProcessedSilenceResult({
        buffer:           outBuffer,
        url:              newUrl,
        name:             newName,
        originalDuration: originalDur,
        newDuration:      outBuffer.duration,
        removedDuration:  removedDur,
        removedCount:     normalized.length,
      });

      setDetectedSegments([]); setSilenceReport(null);
      setSilenceProgress(100);
      addSilenceChip(`✂ ${normalized.length} مقطع`);
      toast.success(`✓ حُذف ${normalized.length} نطاق — الناتج: ${outBuffer.duration.toFixed(0)}s`);
    } catch (err) {
      const e = err instanceof Error ? err : new Error("خطأ");
      // لا نُغيّر currentAudio عند الفشل — المشغل يحتفظ بالملف السابق
      toast.error(`فشل التطبيق: ${e.message}`);
    } finally { setIsRemovingSilence(false); setSilenceProgress(0); setDeleteConfirm(null); }
  };

  // ── Silence zone preview ──────────────────────────────────────────────────
  const stopZonePreview = () => {
    try { silencePreviewSrc.current?.stop(); } catch { /* stopped */ }
    silencePreviewSrc.current = null;
    silencePreviewCtx.current?.close().catch(() => {});
    silencePreviewCtx.current = null;
    setPreviewingSegId(null);
  };

  // ── PrayerTransitionAnalyzer — تحليل المقاطع الصوتية القصيرة ───────────────
  const handleAnalyzeTransitions = async () => {
    const srcBuf = processedSilenceResult?.buffer ?? silenceAudioBuffer;
    if (!srcBuf) { toast.error("لا يوجد ملف للتحليل"); return; }
    setIsAnalyzingTransitions(true);
    setShowTransitionPanel(false);
    try {
      // التحليل يعمل في نفس الـ thread — قد يأخذ 1-3 ثوانٍ
      await new Promise(r => setTimeout(r, 10)); // أعطِ الـ UI وقتاً للتحديث
      const result = PrayerTransitionAnalyzer.analyze(srcBuf, silenceThresholdDb);
      setTransitionSegments(result.voicedSegments);
      setShowTransitionPanel(true);
      const nonQuran = result.takbeerCount + result.transitionCount + result.iqamaCount + result.salamCount + result.reviewCount;
      if (nonQuran === 0) {
        toast.success("لم يُعثر على تكبيرات أو انتقالات — الملف يبدو تلاوة قرآنية فقط");
      } else {
        toast.success(`تم اكتشاف ${nonQuran} مقطع غير قرآني للمراجعة`);
      }
    } catch (e) {
      console.error("[TransitionAnalyzer]", e);
      toast.error("فشل تحليل الانتقالات");
    } finally {
      setIsAnalyzingTransitions(false);
    }
  };

  // حذف المقاطع المُحددة في TransitionPanel
  // حذف المقاطع المُحددة في TransitionPanel
  const handleDeleteTransitions = async () => {
    const srcBuf = processedSilenceResult?.buffer ?? silenceAudioBuffer;
    if (!srcBuf) { toast.error("لا يوجد ملف"); return; }
    const toDelete = transitionSegments.filter(s => s.enabled);
    if (toDelete.length === 0) { toast.error("لم تُحدّد أي مقطع للحذف"); return; }
    const sorted = [...toDelete].sort((a, b) => b.startSec - a.startSec);
    let outBuf = srcBuf;
    for (const seg of sorted) {
      outBuf = await AudioTrimmerEngine.deleteRange(outBuf, seg.startSec, seg.endSec, 0.05, 0.02);
    }
    const wav  = AudioTrimmerEngine.toWav(outBuf);
    const url  = URL.createObjectURL(wav);
    const name = AudioTrimmerEngine.buildCutFileName(currentAudio?.name ?? "audio");
    setActiveAudio(url, name);
    setSilenceAudioBuffer(outBuf);
    setProcessedSilenceResult(prev => prev
      ? { ...prev, buffer: outBuf, url, name, newDuration: outBuf.duration }
      : { buffer: outBuf, url, name, originalDuration: srcBuf.duration,
          newDuration: outBuf.duration, removedDuration: srcBuf.duration - outBuf.duration,
          removedCount: toDelete.length }
    );
    setTransitionSegments([]);
    setShowTransitionPanel(false);
    toast.success(`✓ تم حذف ${toDelete.length} مقطع`);
  };

  // ── PrayerMapPanel handlers ───────────────────────────────────────────────
  const handlePrayerToggle = (id: string) => {
    setPrayerSegments(prev => prev.map(s => s.id === id ? { ...s, enabled: !s.enabled } : s));
  };

  const handlePrayerSelectAll = (enabled: boolean) => {
    setPrayerSegments(prev => prev.map(s => {
      const isProtected = s.classification === "quran_likely" && s.confidence >= 0.95;
      return isProtected ? s : { ...s, enabled };
    }));
  };

  const handlePrayerApply = async () => {
    if (!currentAudio) { toast.error("لا يوجد ملف"); return; }
    const toDelete = prayerSegments
      .filter(s => s.enabled)
      .map(s => ({ start: s.startSec, end: s.endSec }))
      .sort((a, b) => a.start - b.start);
    if (toDelete.length === 0) { toast.error("لم تُحدّد أي مقطع للحذف"); return; }

    setIsRemovingSilence(true); setSilenceProgress(0);
    try {
      const buf = await AudioTrimmerEngine.loadBuffer(currentAudio.url);
      setSilenceProgress(40);
      const normalized = normalizeDeleteRanges(toDelete, buf.duration);
      const outBuffer = await AudioTrimmerEngine.deleteMultipleRanges(buf, normalized, 0, 0.02);
      if (!outBuffer || outBuffer.duration < 1) {
        toast.error("الناتج غير صالح — قلّل نطاقات الحذف"); return;
      }
      setSilenceProgress(85);
      setSilenceResultBuffer(outBuffer);
      const newName = SilenceProcessor.buildFileName(currentAudio.name);
      setSilenceResultName(newName);
      const dot  = newName.lastIndexOf(".");
      const base = dot !== -1 ? newName.slice(0, dot) : newName;
      setSilenceExportName(`${base}.wav`);
      const outWav = AudioTrimmerEngine.toWav(outBuffer);
      const newUrl = URL.createObjectURL(outWav);
      setActiveAudio(newUrl, newName);
      setSilenceAudioBuffer(outBuffer);
      setProcessedSilenceResult({
        buffer:           outBuffer,
        url:              newUrl,
        name:             newName,
        originalDuration: buf.duration,
        newDuration:      outBuffer.duration,
        removedDuration:  buf.duration - outBuffer.duration,
        removedCount:     normalized.length,
      });
      setShowPrayerMap(false); setPrayerSegments([]);
      setSilenceProgress(100);
      addSilenceChip(`✂ ${normalized.length} مقطع`);
      toast.success(
        `✓ حُذف ${normalized.length} مقطع (${SilenceProcessor.formatDuration(buf.duration - outBuffer.duration)}) — ` +
        `المدة الجديدة: ${SilenceProcessor.formatDuration(outBuffer.duration)}`
      );
    } catch (err) {
      const e = err instanceof Error ? err : new Error("خطأ");
      toast.error(`فشل الحذف: ${e.message}`);
    } finally { setIsRemovingSilence(false); setSilenceProgress(0); }
  };

  // ─── Workspace content by tool ─────────────────────────────────────────────
  const renderWorkspace = () => {
    if (!activeTool || !currentAudio) return null;

    // ── EffectExportPanel — مشترك بين EQ/Clarity/Compression ───────────────
    const wrapClass = "space-y-5";

    switch (activeTool) {

      // ── Trim ────────────────────────────────────────────────────────────
      case "trim":
        return (
          <div className={wrapClass}>
            <SectionHeader
              title="تقطيع الصوت يدوياً"
              subtitle="احتفظ بجزء أو احذف جزءاً من منتصف الملف"
            />
            <TrimPanel
              audioUrl={currentAudio.url}
              fileName={currentAudio.name}
              onBack={() => setActiveTool(null)}
              onDownload={handleTrimDownload}
              onUseInPlayer={handleTrimUseInPlayer}
              onUndo={handleUndo}
              onRedo={handleRedo}
              undoCount={undoCount}
              redoCount={redoCount}
            />
          </div>
        );

      // ── Cleanup ─────────────────────────────────────────────────────────
      case "cleanup":
        return (
          <div className={wrapClass}>
            <SectionHeader
              title="تنظيف صوت القرآن"
              subtitle="High-Pass · Noise Gate · Voice EQ · Compressor · Limiter"
            />

            {/* ══ تنظيف تلقائي للصلاة ══════════════════════════════════ */}
            <div className="border-2 border-emerald-400 dark:border-emerald-600 rounded-xl overflow-hidden">
              {/* Header */}
              <div className="bg-emerald-600 text-white px-4 py-3 flex items-center gap-2">
                <span className="text-lg">🕌</span>
                <div>
                  <p className="text-sm font-bold">تنظيف تلقائي للصلاة</p>
                  <p className="text-xs text-emerald-100">ذكاء اصطناعي — بضغطة واحدة</p>
                </div>
              </div>

              <div className="p-4 space-y-3 bg-emerald-50 dark:bg-emerald-950">
                {/* Preset selector */}
                <div className="flex items-center gap-1 p-1 bg-white dark:bg-slate-900 rounded-lg border border-emerald-200 dark:border-emerald-800">
                  {([
                    { id: "conservative", label: "محافظ", icon: "🛡" },
                    { id: "balanced",     label: "متوازن", icon: "⚖️" },
                    { id: "aggressive",   label: "قوي",    icon: "⚡" },
                  ] as const).map(p => (
                    <button key={p.id} onClick={() => setAutoCleanPreset(p.id)}
                      className={`flex-1 flex items-center justify-center gap-1 py-1.5 rounded-md text-xs font-medium transition-colors ${
                        autoCleanPreset === p.id
                          ? "bg-emerald-600 text-white shadow-sm"
                          : "text-slate-500 hover:text-emerald-700 dark:hover:text-emerald-300"
                      }`}
                    >
                      {p.icon} {p.label}
                    </button>
                  ))}
                </div>

                {/* Preset description */}
                <p className="text-xs text-emerald-600 dark:text-emerald-400">
                  {autoCleanPreset === "conservative" && "🛡 يحذف الصمت الطويل فقط — الأكثر أماناً للتسجيلات الثمينة (max 30%)"}
                  {autoCleanPreset === "balanced"     && "⚖️ توازن بين الدقة وكمية الحذف — موصى به لمعظم التسجيلات (max 40%)"}
                  {autoCleanPreset === "aggressive"   && "⚡ يحذف أكبر قدر ممكن من الصمت — للتسجيلات ذات الصمت الكثير (max 50%)"}
                </p>

                {/* Progress */}
                {isAutoClean && (
                  <ProgressBar percent={autoCleanProgress} label={autoCleanStage} color="bg-emerald-500"/>
                )}

                {/* Result panel */}
                {autoCleanResult && !isAutoClean && (
                  <div className="space-y-2 bg-white dark:bg-slate-900 rounded-lg p-3 border border-emerald-200 dark:border-emerald-800">
                    <p className="text-xs font-semibold text-emerald-700 dark:text-emerald-300">✓ اكتمل التنظيف</p>
                    <div className="grid grid-cols-3 gap-2 text-xs text-center">
                      <div className="bg-slate-50 dark:bg-slate-800 rounded p-2">
                        <p className="text-slate-400">قبل</p>
                        <p className="font-mono font-bold">{SilenceProcessor.formatDuration(autoCleanResult.originalDuration)}</p>
                      </div>
                      <div className="bg-emerald-50 dark:bg-emerald-950 rounded p-2">
                        <p className="text-emerald-500">بعد</p>
                        <p className="font-mono font-bold text-emerald-700 dark:text-emerald-300">
                          {SilenceProcessor.formatDuration(autoCleanResult.finalDuration)}
                        </p>
                      </div>
                      <div className="bg-red-50 dark:bg-red-950 rounded p-2">
                        <p className="text-red-400">حُذف</p>
                        <p className="font-mono font-bold text-red-600 dark:text-red-400">
                          {(autoCleanResult.removedRatio * 100).toFixed(0)}%
                        </p>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={handleUndo} disabled={undoCount === 0}
                        className="flex-1 flex items-center justify-center gap-1.5 px-2 py-2 text-xs font-medium rounded-lg
                                   border border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-400
                                   hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 transition-colors">
                        🔁 تراجع
                      </button>
                      <button onClick={() => setActiveTool("trim")}
                        className="flex-1 flex items-center justify-center gap-1.5 px-2 py-2 text-xs font-medium rounded-lg
                                   border border-blue-300 dark:border-blue-700 text-blue-600 dark:text-blue-400
                                   hover:bg-blue-50 dark:hover:bg-blue-950 transition-colors">
                        ✂️ تعديل يدوي
                      </button>
                    </div>
                  </div>
                )}

                {/* Main button */}
                <Button onClick={handleAutoClean} disabled={isAutoClean || !currentAudio}
                  className="w-full gap-2 bg-emerald-600 hover:bg-emerald-700 text-white h-11">
                  {isAutoClean
                    ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"/>
                       {autoCleanStage || "جاري التنظيف..."}</>
                    : <>🕌 تنظيف تلقائي للصلاة</>
                  }
                </Button>
              </div>
            </div>

            <div className="border-t border-slate-200 dark:border-slate-700 pt-4 space-y-3">
            {isApplyingEffect && (
              <ProcessingIndicator isProcessing={isApplyingEffect} currentEffect={currentEffectName} progress={effectProgress} />
            )}
            {processedBlobUrl && (
              <div className="flex items-center justify-between bg-emerald-50 dark:bg-emerald-950 border border-emerald-200 dark:border-emerald-800 rounded-lg px-4 py-2.5">
                <p className="text-xs text-emerald-700 dark:text-emerald-300 flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5"/>
                  النسخة المعالجة: <strong>{processedFileName}</strong>
                </p>
                <Button size="sm" variant="outline" onClick={handleDownloadProcessed} className="text-xs h-7 gap-1">
                  <Download className="w-3 h-3"/> تحميل
                </Button>
              </div>
            )}
            {isCleaningUp && <ProgressBar percent={cleanupProgress} label={cleanupStage} color="bg-emerald-500"/>}
            <Button onClick={handleQuranCleanup} disabled={isCleaningUp}
              className="w-full gap-2 bg-emerald-600 hover:bg-emerald-700 text-white h-11">
              {isCleaningUp
                ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"/>جاري التنظيف...</>
                : <><Sparkles className="w-4 h-4"/>تنظيف صوت القرآن</>}
            </Button>
          </div>
        </div>
        );

      // ── Silence ──────────────────────────────────────────────────────────
      case "silence": {
        const enabledSegs    = detectedSegments.filter(s => s.enabled);
        const totalEnabled   = enabledSegs.reduce((a, s) => a + s.durationSec, 0);
        const audioDuration  = silenceReport?.originalDurationSec ?? 0;
        const deletionRatio  = audioDuration > 0 ? totalEnabled / audioDuration : 0;
        const estimatedFinal = Math.max(0,
          audioDuration - totalEnabled + enabledSegs.length * silenceReplacementGap
        );
        const sortedSegs = [...detectedSegments].sort((a, b) =>
          silenceSort === "longest" ? b.durationSec - a.durationSec : a.startSec - b.startSec
        );
        const hasResults   = detectedSegments.length > 0;
        const hasProcessed = processedSilenceResult !== null;
        const showWaveform = hasResults || hasProcessed || noSilenceFound;
        // الـ buffer: processed → original مع segments → original بدون segments
        const waveformBuffer = hasProcessed
          ? processedSilenceResult!.buffer
          : silenceAudioBuffer;

        return (
          <div className={wrapClass}>

            {/* ── STEP 1: Mode selector — دائماً ظاهر ─────────────────── */}
            <div className="rounded-2xl overflow-hidden border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">

              {/* Header */}
              <div className="flex items-center gap-3 px-4 py-3 bg-slate-50 dark:bg-slate-800/60 border-b border-slate-100 dark:border-slate-800">
                <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-violet-500 to-purple-700 flex items-center justify-center flex-shrink-0">
                  <span className="text-white text-base">✂</span>
                </div>
                <div>
                  <p className="text-sm font-bold text-slate-800 dark:text-slate-200">إزالة الصمت</p>
                  <p className="text-xs text-slate-400">اكتشف فترات الصمت وأزلها بضغطة واحدة</p>
                </div>
                {/* Color theme dots — في الـ header */}
                <div className="flex gap-1 mr-auto">
                  {SILENCE_THEMES.map(t => (
                    <button key={t.id} onClick={() => setSilenceThemeId(t.id as SilenceThemeId)}
                      title={t.id}
                      className={`w-4 h-4 rounded-full border-2 transition-all ${silenceThemeId===t.id?"border-slate-500 dark:border-slate-300 scale-110":"border-transparent hover:scale-105"}`}
                      style={{ background: t.wave }}/>
                  ))}
                </div>
              </div>

              {/* History chips */}
              {silenceHistoryChips.length > 0 && (
                <div className="flex items-center gap-2 px-4 py-2 border-b border-slate-100 dark:border-slate-800 overflow-x-auto">
                  <span className="text-xs text-slate-400 flex-shrink-0">السجل:</span>
                  {silenceHistoryChips.map(c => (
                    <span key={c.id} className="flex-shrink-0 text-xs px-2.5 py-0.5 rounded-full bg-violet-100 dark:bg-violet-950 text-violet-700 dark:text-violet-300 border border-violet-200 dark:border-violet-800 font-medium">
                      {c.label}
                    </span>
                  ))}
                  <button onClick={() => setSilenceHistoryChips([])} className="text-xs text-slate-300 hover:text-red-400 mr-auto flex-shrink-0 transition-colors">مسح</button>
                </div>
              )}

              {/* ── Mode cards — خطوة 1 ────────────────────────────────── */}
              <div className="p-4 space-y-3">
                <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">اختر الوضع المناسب</p>
                <div className="grid grid-cols-3 gap-3">

                  {/* وضع الصلاة */}
                  <button onClick={() => { applyPrayerPreset(); setSilenceMode("default"); }}
                    className={`flex flex-col gap-2 p-4 rounded-2xl border-2 text-right transition-all hover:scale-[1.02] ${
                      silenceThresholdDb===-10&&silenceMinDuration===1.4&&silenceReplacementGap===5
                        ? "border-violet-500 bg-violet-50 dark:bg-violet-950/60"
                        : "border-slate-200 dark:border-slate-700 hover:border-violet-300 dark:hover:border-violet-700 bg-white dark:bg-slate-900"
                    }`}>
                    <span className="text-2xl">🕌</span>
                    <div>
                      <p className="text-sm font-bold text-slate-800 dark:text-slate-200">صلاة</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">يحذف الفترات الطويلة بين الركعات</p>
                    </div>
                  </button>

                  {/* وضع ذكي */}
                  <button onClick={() => {
                    setSilenceMode("smart");
                    toast.success("✓ وضع الصلاة الذكي — يحذف الأركان والتكبيرات تلقائياً");
                  }}
                    className={`flex flex-col gap-2 p-4 rounded-2xl border-2 text-right transition-all hover:scale-[1.02] ${
                      silenceMode === "smart"
                        ? "border-amber-500 bg-amber-50 dark:bg-amber-950/60"
                        : "border-slate-200 dark:border-slate-700 hover:border-amber-300 dark:hover:border-amber-700 bg-white dark:bg-slate-900"
                    }`}>
                    <span className="text-2xl">✨</span>
                    <div>
                      <p className="text-sm font-bold text-slate-800 dark:text-slate-200">ذكي</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">يحذف الأركان والتكبيرات ويبقي التلاوة</p>
                    </div>
                  </button>

                  {/* وضع دقيق */}
                  <button onClick={() => {
                    setSilenceThresholdDb(-20); setSilenceMinDuration(0.5);
                    setSilenceReplacementGap(0.25); setSilenceDetectionMode("vad");
                    setSilenceMode("default");
                    if (!smartModeEnabled) setSmartModeEnabled(true);
                    toast.success("✓ وضع الاكتشاف الدقيق");
                  }}
                    className={`flex flex-col gap-2 p-4 rounded-2xl border-2 text-right transition-all hover:scale-[1.02] ${
                      silenceDetectionMode==="vad"
                        ? "border-emerald-500 bg-emerald-50 dark:bg-emerald-950/60"
                        : "border-slate-200 dark:border-slate-700 hover:border-emerald-300 dark:hover:border-emerald-700 bg-white dark:bg-slate-900"
                    }`}>
                    <span className="text-2xl">🎤</span>
                    <div>
                      <p className="text-sm font-bold text-slate-800 dark:text-slate-200">دقيق</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">يلتقط السكتات القصيرة والذبذبات</p>
                    </div>
                  </button>
                </div>

                {/* Smart Mode toggle — compact */}
                <button onClick={() => {
                  const next = !smartModeEnabled;
                  setSmartModeEnabled(next);
                  if (next && detectedSegments.length > 0 && silenceAudioBuffer)
                    runSmartAnalysis(detectedSegments, silenceAudioBuffer.duration);
                  else if (!next) { setDecidedSegments([]); setDecisionSummary(null); setSmartOverrides({}); }
                }}
                  className={`w-full flex items-center justify-between px-4 py-3 rounded-xl border transition-all ${
                    smartModeEnabled
                      ? "bg-emerald-50 dark:bg-emerald-950/50 border-emerald-300 dark:border-emerald-700"
                      : "bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 hover:border-slate-300"
                  }`}>
                  <div className="text-right">
                    <p className={`text-xs font-semibold ${smartModeEnabled?"text-emerald-800 dark:text-emerald-200":"text-slate-700 dark:text-slate-300"}`}>
                      🧠 التحليل الذكي
                    </p>
                    <p className={`text-xs ${smartModeEnabled?"text-emerald-500":"text-slate-400"}`}>
                      {smartModeEnabled?"يُصنّف الأجزاء تلقائياً":"تحكم يدوي"}
                    </p>
                  </div>
                  <div className={`relative w-11 h-6 rounded-full transition-colors flex-shrink-0 ${smartModeEnabled?"bg-emerald-500":"bg-slate-300 dark:bg-slate-600"}`}>
                    <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${smartModeEnabled?"translate-x-5":"translate-x-0.5"}`}/>
                  </div>
                </button>

                {/* ── Advanced settings — accordion ──────────────────────── */}
                <button onClick={() => setShowAdvancedSilence(v => !v)}
                  className="w-full flex items-center justify-between text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors py-1">
                  <span className="flex items-center gap-1.5">
                    <span>{showAdvancedSilence?"▲":"▼"}</span>
                    إعدادات متقدمة
                  </span>
                  <span className="font-mono text-slate-300 dark:text-slate-600">
                    {silenceThresholdDb}dB · {silenceMinDuration}ث
                  </span>
                </button>

                {showAdvancedSilence && (
                  <div className="space-y-3 pt-1 border-t border-slate-100 dark:border-slate-800">
                    {/* Sliders */}
                    <div className="grid gap-2 sm:grid-cols-3">
                      {[
                        { label:"عتبة الصمت", value:silenceThresholdDb,
                          set:(v:number)=>{ setSilenceThresholdDb(v); updateSettings({silenceThresholdDb:v}); },
                          min:-60, max:-10, step:1, suffix:" dB" },
                        { label:"الحد الأدنى", value:silenceMinDuration,
                          set:(v:number)=>{ setSilenceMinDuration(v); updateSettings({silenceMinDuration:v}); },
                          min:0.1, max:120, step:0.1, suffix:" ث" },
                        { label:"الفجوة البديلة", value:silenceReplacementGap,
                          set:(v:number)=>{ setSilenceReplacementGap(v); updateSettings({silenceGap:v}); },
                          min:0, max:5, step:0.05, suffix:" ث" },
                      ].map(({ label, value, set, min, max, step, suffix }) => (
                        <div key={label} className="space-y-1">
                          <div className="flex justify-between">
                            <span className="text-xs text-slate-500">{label}</span>
                            <span className="text-xs font-mono text-violet-600 dark:text-violet-400 font-bold">{value}{suffix}</span>
                          </div>
                          <input type="range" min={min} max={max} step={step} value={value}
                            onChange={e => set(Number(e.target.value))}
                            className="w-full accent-violet-500"/>
                        </div>
                      ))}
                    </div>
                    {/* Detection mode */}
                    <div className="flex gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-xl text-xs">
                      {[["rms","📊 قياسي"],["vad","🔬 VAD دقيق"]].map(([m,l]) => (
                        <button key={m} onClick={() => setSilenceDetectionMode(m as "rms"|"vad")}
                          className={`flex-1 py-1.5 rounded-lg font-medium transition-all ${
                            silenceDetectionMode===m
                              ? "bg-white dark:bg-slate-900 text-violet-700 dark:text-violet-300 shadow-sm"
                              : "text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
                          }`}>{l}</button>
                      ))}
                    </div>
                    {/* Fade + speed */}
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs text-slate-400">Fade:</span>
                      {([0,0.02,0.05] as const).map(d => (
                        <button key={d} onClick={() => setSilenceCrossfade(d)}
                          className={`px-2 py-0.5 text-xs rounded-lg font-mono ${silenceCrossfade===d?"bg-orange-500 text-white":"bg-slate-100 dark:bg-slate-800 text-slate-500 hover:bg-slate-200"}`}>
                          {d===0?"لا":`${d*1000|0}ms`}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* ── BIG Detect button — خطوة 2 ─────────────────────────── */}
                {(isDetectingSilence || isRemovingSilence) && (
                  <ProgressBar
                    percent={silenceProgress}
                    label={silenceStage || (isRemovingSilence?"جاري التطبيق...":"جاري الكشف...")}
                    color="bg-violet-500"/>
                )}

                <button onClick={handleDetectSilence}
                  disabled={isDetectingSilence||isRemovingSilence}
                  className={`w-full h-14 rounded-2xl text-sm font-bold transition-all flex items-center justify-center gap-3 shadow-sm
                    ${isDetectingSilence||isRemovingSilence
                      ? "bg-slate-100 dark:bg-slate-800 text-slate-400 cursor-not-allowed"
                      : "bg-violet-600 hover:bg-violet-500 active:scale-[0.99] text-white shadow-violet-200 dark:shadow-none"}`}>
                  {isDetectingSilence
                    ? <><div className="w-5 h-5 border-2 border-violet-400 border-t-transparent rounded-full animate-spin"/>جاري الاكتشاف...</>
                    : <><span className="text-xl">🔍</span>اكتشف فترات الصمت</>}
                </button>

                {/* ── خريطة الأركان الذكية ────────────────────────────────── */}
                {showPrayerMap && prayerSegments.length > 0 && (
                  <div className="mt-4">
                    <PrayerMapPanel
                      segments={prayerSegments}
                      onToggle={handlePrayerToggle}
                      onApply={handlePrayerApply}
                      onSelectAll={handlePrayerSelectAll}
                      isProcessing={isRemovingSilence}
                    />
                  </div>
                )}
              </div>
            </div>

            {/* ── STEP 2: Results ──────────────────────────────────────────── */}
            {showWaveform && (
              <div className="rounded-2xl overflow-hidden border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">

                {/* ── A. Summary card (no technical terms) ─────────────────── */}
                <div className={`px-4 py-3 border-b border-slate-100 dark:border-slate-800 ${
                  hasProcessed ? "bg-emerald-50 dark:bg-emerald-950/30" :
                  noSilenceFound ? "bg-amber-50 dark:bg-amber-950/20" :
                  "bg-slate-50 dark:bg-slate-800/60"
                }`}>
                  {hasProcessed ? (
                    <div className="flex items-center gap-3">
                      <span className="text-2xl flex-shrink-0">✅</span>
                      <div className="flex-1">
                        <p className="text-sm font-bold text-emerald-800 dark:text-emerald-200">
                          تم حذف {processedSilenceResult!.removedCount} فترة صمت
                        </p>
                        <p className="text-xs text-emerald-600 dark:text-emerald-400 mt-0.5 font-mono">
                          {Math.floor(processedSilenceResult!.originalDuration/60)}:{String(Math.floor(processedSilenceResult!.originalDuration%60)).padStart(2,'0')}
                          {" → "}
                          {Math.floor(processedSilenceResult!.newDuration/60)}:{String(Math.floor(processedSilenceResult!.newDuration%60)).padStart(2,'0')}
                          {" · وُفِّر "}
                          {Math.floor(processedSilenceResult!.removedDuration/60)}:{String(Math.floor(processedSilenceResult!.removedDuration%60)).padStart(2,'0')}
                        </p>
                      </div>
                    </div>
                  ) : noSilenceFound ? (
                    <div>
                      <p className="text-sm font-bold text-amber-700 dark:text-amber-300">
                        لم يتم العثور على فترات صمت مطابقة
                      </p>
                      <p className="text-xs text-slate-400 mt-0.5">
                        جرّب وضع الصلاة أو عدّل الإعدادات المتقدمة
                      </p>
                      <div className="flex gap-2 mt-2">
                        <button onClick={applyPrayerPreset}
                          className="px-2.5 py-1 text-xs font-semibold bg-violet-600 hover:bg-violet-500 text-white rounded-lg transition-colors">
                          🕌 جرّب وضع الصلاة
                        </button>
                        <button onClick={() => setShowAdvancedSilence(true)}
                          className="px-2.5 py-1 text-xs border border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-400 hover:border-violet-400 rounded-lg transition-colors">
                          إعدادات متقدمة
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div>
                      {/* Clean summary — no technical terms */}
                      <div className="grid grid-cols-3 gap-2 mb-3">
                        {[
                          { label:"فترات الصمت", value: String(enabledSegs.length), accent: true },
                          { label:"مقترح حذفه", value: SilenceProcessor.formatDuration(totalEnabled), accent: false },
                          { label:"المدة بعد الحذف", value: SilenceProcessor.formatDuration(estimatedFinal), accent: false },
                        ].map(s => (
                          <div key={s.label} className={`rounded-xl p-2.5 text-center ${s.accent?"bg-red-50 dark:bg-red-950/50 border border-red-100 dark:border-red-900":"bg-slate-100 dark:bg-slate-800"}`}>
                            <p className="text-xs text-slate-400">{s.label}</p>
                            <p className={`font-bold font-mono text-sm mt-0.5 ${s.accent?"text-red-600 dark:text-red-400":"text-slate-700 dark:text-slate-300"}`}>{s.value}</p>
                          </div>
                        ))}
                      </div>
                      {deletionRatio > 0.5 && (
                        <div className="flex items-start gap-2 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 rounded-xl px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
                          <span className="flex-shrink-0">⚠</span>
                          <span>هذا الحذف سيُزيل {(deletionRatio*100).toFixed(0)}% من الملف — راجع النطاقات بعناية</span>
                        </div>
                      )}
                      {(decisionSummary?.reviewCount ?? 0) > 0 && (
                        <p className="text-xs text-amber-600 dark:text-amber-400 mt-1.5">
                          · {decisionSummary!.reviewCount} فترة تحتاج مراجعة — لن تُحذف تلقائياً
                        </p>
                      )}
                      <p className="text-xs text-slate-400 mt-1.5">
                        المناطق الحمراء ستُحذف · انقر على أي منطقة لتعطيلها
                      </p>
                    </div>
                  )}
                </div>

                {/* ── B. Waveform ───────────────────────────────────────────── */}
                {waveformBuffer && (
                  <div className="border-b border-slate-100 dark:border-slate-800">
                    <WaveformEditor
                      waveColor={silenceTheme.wave}
                      selectionColor={silenceTheme.sel}
                      audioBuffer={waveformBuffer}
                      currentTime={silencePlayerTime}
                      height={96}
                      editableRanges={hasProcessed || noSilenceFound ? [] : (() => {
                        if (showPrayerMap && prayerSegments.length > 0) {
                          return prayerSegments.map(s => ({
                            id: s.id, startSec: s.startSec, endSec: s.endSec, enabled: s.enabled,
                            color: s.classification === "quran_likely"
                              ? "rgba(22,163,74,0.20)"
                              : (s.classification === "takbeer_candidate" || s.classification === "transition_candidate")
                                ? "rgba(220,38,38,0.20)"
                                : "rgba(234,179,8,0.20)",
                            label: PrayerTransitionAnalyzer.classLabel(s.classification),
                          }));
                        }
                        if (smartModeEnabled && decidedSegments.length > 0) {
                          return decidedSegments.map(d => {
                            const overrideEnabled = d.id in smartOverrides
                              ? smartOverrides[d.id]
                              : (d.decision==="remove"||d.decision==="partial_trim");
                            const startSec = d.trim?.startSec ?? d.startSec;
                            const endSec   = d.trim?.endSec   ?? d.endSec;
                            return { id:d.id, startSec, endSec, enabled:overrideEnabled,
                              label: d.decision==="remove" ? `آمن للحذف · ${SilenceProcessor.formatDuration(d.durationSec)}`
                                   : d.decision==="partial_trim" ? `حذف جزئي · ${SilenceProcessor.formatDuration(d.trim?.removedSec??0)}`
                                   : d.decision==="review" ? `يحتاج مراجعة · ${SilenceProcessor.formatDuration(d.durationSec)}`
                                   : `سيتم الاحتفاظ به · ${SilenceProcessor.formatDuration(d.durationSec)}` };
                          });
                        }
                        return detectedSegments.map(s => ({
                          id:s.id, startSec:s.startSec, endSec:s.endSec, enabled:s.enabled,
                          label:`${s.enabled?"آمن للحذف":"سيتم الاحتفاظ به"} · ${SilenceProcessor.formatDuration(s.durationSec)}`,
                        }));
                      })()}
                      onEditableRangesChange={hasProcessed || noSilenceFound ? undefined : (updated => {
                        setDetectedSegments(prev => prev.map(seg => {
                          const u = updated.find(x => x.id===seg.id);
                          if (!u) return seg;
                          return { ...seg, startSec:u.startSec, endSec:u.endSec, durationSec:u.endSec-u.startSec, enabled:u.enabled };
                        }));
                      })}
                      onRangeSelected={hasProcessed || noSilenceFound ? undefined : ((s, e) => {
                        const newId = `manual-${Date.now()}`;
                        setDetectedSegments(prev => [...prev, { id:newId, startSec:s, endSec:e, durationSec:e-s, enabled:true }]);
                        toast.success(`تم إضافة نطاق: ${SilenceProcessor.formatDuration(e-s)}`);
                      })}
                      onDeleteRange={async (s, e) => {
                        if (!silenceAudioBuffer && !processedSilenceResult?.buffer) return;
                        const srcBuf = processedSilenceResult?.buffer ?? silenceAudioBuffer!;
                        try {
                          const out  = await AudioTrimmerEngine.deleteRange(srcBuf, s, e, 0.05, 0.02);
                          const name = AudioTrimmerEngine.buildCutFileName(currentAudio?.name ?? "audio");
                          const wav  = AudioTrimmerEngine.toWav(out);
                          const url  = URL.createObjectURL(wav);
                          setActiveAudio(url, name);
                          setSilenceAudioBuffer(out);
                          setProcessedSilenceResult(prev => prev
                            ? { ...prev, buffer:out, url, name, newDuration:out.duration }
                            : { buffer:out, url, name, originalDuration:srcBuf.duration,
                                newDuration:out.duration, removedDuration:srcBuf.duration-out.duration, removedCount:1 }
                          );
                          toast.success("تم الحذف");
                        } catch { toast.error("فشل الحذف"); }
                      }}
                      onCropToRange={async (s, e) => {
                        if (!silenceAudioBuffer && !processedSilenceResult?.buffer) return;
                        const srcBuf = processedSilenceResult?.buffer ?? silenceAudioBuffer!;
                        try {
                          const out  = await AudioTrimmerEngine.trimWithFade(srcBuf, s, e, 0.02);
                          const name = AudioTrimmerEngine.buildFileName(currentAudio?.name ?? "audio");
                          const wav  = AudioTrimmerEngine.toWav(out);
                          const url  = URL.createObjectURL(wav);
                          setActiveAudio(url, name);
                          setSilenceAudioBuffer(out);
                          setProcessedSilenceResult(prev => prev
                            ? { ...prev, buffer:out, url, name, newDuration:out.duration }
                            : { buffer:out, url, name, originalDuration:srcBuf.duration,
                                newDuration:out.duration, removedDuration:srcBuf.duration-out.duration, removedCount:1 }
                          );
                          toast.success("تم الاحتفاظ بالمحدد فقط");
                        } catch { toast.error("فشل الاقتصاص"); }
                      }}
                      onSeek={t => setSilencePlayerTime(t)}
                    />
                  </div>
                )}

                {/* ── C. Primary action buttons ─────────────────────────────── */}
                {hasProcessed ? (
                  <div className="px-4 py-4 space-y-2">
                    <div className="grid grid-cols-4 gap-2">
                      <button onClick={() => { if(resultPreviewRef.current?.paused) handleSilenceResultPreview(); else stopResultPreview(); }}
                        className="flex flex-col items-center gap-1.5 p-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 hover:border-blue-400 transition-all text-xs font-medium text-slate-700 dark:text-slate-300">
                        <span className="text-2xl">▶</span>استمع للنتيجة
                      </button>
                      <button onClick={() => { setProcessedSilenceResult(null); selectTool("trim"); }}
                        className="flex flex-col items-center gap-1.5 p-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white transition-all text-xs font-bold">
                        <span className="text-2xl">✂</span>تعديل يدوي
                      </button>
                      <button onClick={() => setShowSilenceExport(v => !v)}
                        className="flex flex-col items-center gap-1.5 p-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white transition-all text-xs font-bold">
                        <span className="text-2xl">💾</span>حفظ النهائي
                      </button>
                    </div>
                    <button onClick={() => { setProcessedSilenceResult(null); setSilenceResultBuffer(null); setTransitionSegments([]); setShowTransitionPanel(false); }}
                      className="w-full text-xs text-slate-400 hover:text-slate-600 py-1 transition-colors">
                      اكتشف مجدداً ←
                    </button>

                    {/* ── زر تحليل الانتقالات ─────────────────────────── */}
                    <div className="border-t border-slate-100 dark:border-slate-800 pt-3">
                      <button
                        onClick={handleAnalyzeTransitions}
                        disabled={isAnalyzingTransitions}
                        className="w-full flex items-center justify-center gap-2 py-2.5 text-xs font-semibold rounded-xl border-2 border-dashed border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/30 transition-all disabled:opacity-50">
                        {isAnalyzingTransitions
                          ? <><div className="w-3.5 h-3.5 border-2 border-amber-500 border-t-transparent rounded-full animate-spin"/>يحلل التكبيرات والانتقالات...</>
                          : <>🕌 مراجعة التكبيرات والانتقالات</>}
                      </button>
                      <p className="text-xs text-center text-slate-400 mt-1.5">
                        يكتشف التكبيرات والإقامة والتسليم المحتملة
                      </p>
                    </div>

                    {/* ── Transition Analysis Panel ──────────────────────── */}
                    {showTransitionPanel && transitionSegments.length > 0 && (
                      <TransitionPanel
                        segments={transitionSegments}
                        filter={transitionFilter}
                        onFilterChange={setTransitionFilter}
                        onToggle={id => setTransitionSegments(prev => prev.map(s => s.id===id?{...s,enabled:!s.enabled}:s))}
                        onSelectSafe={() => setTransitionSegments(prev => prev.map(s => ({...s,enabled:s.safeToRemove})))}
                        onDeselectAll={() => setTransitionSegments(prev => prev.map(s => ({...s,enabled:false})))}
                        onDelete={handleDeleteTransitions}
                        onClose={() => setShowTransitionPanel(false)}
                        onPreview={seg => {
                          const srcBuf = processedSilenceResult?.buffer ?? silenceAudioBuffer;
                          if (!srcBuf) return;
                          stopZonePreview();
                          const ctx = new AudioContext();
                          silencePreviewCtx.current = ctx;
                          const src = ctx.createBufferSource();
                          src.buffer = srcBuf;
                          src.connect(ctx.destination);
                          const pad = 0.3;
                          src.start(0, Math.max(0, seg.startSec - pad), (seg.endSec - seg.startSec) + pad * 2);
                          silencePreviewSrc.current = src;
                          setPreviewingSegId(seg.id);
                          src.onended = () => setPreviewingSegId(null);
                        }}
                        previewingId={previewingSegId}
                      />
                    )}
                  </div>
                ) : noSilenceFound ? (
                  <div className="px-4 py-3 flex gap-2">
                    <button onClick={applyPrayerPreset}
                      className="flex-1 py-2.5 text-xs font-semibold bg-violet-600 hover:bg-violet-500 text-white rounded-xl transition-colors">
                      🕌 وضع الصلاة
                    </button>
                    <button onClick={() => waveformRef.current?.play?.()}
                      className="flex-1 py-2.5 text-xs font-medium border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:border-blue-400 rounded-xl transition-colors">
                      ▶ استمع
                    </button>
                  </div>
                ) : hasResults && (
                  <div className="px-4 py-4 space-y-3">
                    {/* BIG delete button */}
                    {isRemovingSilence && (
                      <ProgressBar percent={silenceProgress} label={silenceStage||"جاري التطبيق..."} color="bg-violet-500"/>
                    )}
                    <button onClick={() => handleApplySilence()}
                      disabled={isRemovingSilence||enabledSegs.length===0}
                      className={`w-full h-14 rounded-2xl text-sm font-bold flex items-center justify-center gap-3 transition-all ${
                        isRemovingSilence||enabledSegs.length===0
                          ? "bg-slate-100 dark:bg-slate-800 text-slate-400 cursor-not-allowed"
                          : "bg-violet-600 hover:bg-violet-500 active:scale-[0.99] text-white shadow-sm"
                      }`}>
                      {isRemovingSilence
                        ? <><div className="w-5 h-5 border-2 border-violet-300 border-t-transparent rounded-full animate-spin"/>جاري الحذف...</>
                        : <><span className="text-xl">✂</span>حذف فترات الصمت المحددة ({enabledSegs.length})</>}
                    </button>

                    {/* Secondary actions row */}
                    <div className="flex gap-2">
                      {/* Loop preview */}
                      <button onClick={() => {
                        if (silenceLoopEnabled) { stopSilenceLoop(); }
                        else {
                          const first = detectedSegments.find(s => s.enabled);
                          if (first) { setSilenceLoopEnabled(true); startSilenceLoop(first.startSec, first.endSec); }
                          else toast.error("فعّل نطاقاً أولاً");
                        }
                      }}
                        className={`flex-1 py-2 text-xs font-medium rounded-xl border transition-all ${
                          silenceLoopEnabled
                            ? "bg-violet-100 dark:bg-violet-950 border-violet-400 text-violet-700 dark:text-violet-300"
                            : "border-slate-200 dark:border-slate-700 text-slate-500 hover:border-violet-400"
                        }`}>
                        {silenceLoopEnabled ? "⟳ تكرار ●" : "▶ استمع للفترة الأولى"}
                      </button>
                      {/* Speed */}
                      <div className="flex gap-1">
                        {([0.5,1,1.5,2] as const).map(s => (
                          <button key={s} onClick={() => setSilencePlayRate(s)}
                            className={`px-2 py-1 text-xs rounded-lg font-mono transition-all ${silencePlayRate===s?"bg-violet-600 text-white":"bg-slate-100 dark:bg-slate-800 text-slate-500 hover:bg-slate-200"}`}>
                            {s}×
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Select/deselect all */}
                    <div className="flex items-center justify-between">
                      <div className="flex gap-1.5 text-xs">
                        <button onClick={() => setDetectedSegments(prev => prev.map(s => ({...s,enabled:true})))}
                          className="px-2.5 py-1 rounded-lg bg-red-100 dark:bg-red-950 text-red-600 dark:text-red-400 hover:bg-red-200 transition-all">
                          تحديد الكل
                        </button>
                        <button onClick={() => setDetectedSegments(prev => prev.map(s => ({...s,enabled:false})))}
                          className="px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 hover:bg-slate-200 transition-all">
                          إلغاء الكل
                        </button>
                      </div>
                      {/* Show details toggle */}
                      <button onClick={() => setShowSilenceSegmentList(v => !v)}
                        className="text-xs text-slate-400 hover:text-slate-600 transition-colors">
                        {showSilenceSegmentList ? "▲ إخفاء التفاصيل" : `▼ مراجعة التفاصيل (${detectedSegments.length})`}
                      </button>
                    </div>

                    {/* Segment list — hidden by default */}
                    {showSilenceSegmentList && (() => {
                      // state داخلي لتتبع المقطع الذي يُشغَّل
                      // نستخدم silenceAudioBuffer المتاح في نفس السياق
                      return (
                      <div className="space-y-1.5 max-h-56 overflow-y-auto">
                        {sortedSegs.map(seg => (
                          <div key={seg.id}
                            className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border transition-all text-xs ${
                              seg.enabled
                                ? "bg-red-50 dark:bg-red-950/60 border border-red-200 dark:border-red-800"
                                : "bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 opacity-60"
                            }`}>

                            {/* Checkbox — toggle enabled */}
                            <button
                              onClick={() => setDetectedSegments(prev => prev.map(s => s.id===seg.id?{...s,enabled:!s.enabled}:s))}
                              className={`flex-shrink-0 w-5 h-5 rounded border-2 flex items-center justify-center transition-all ${
                                seg.enabled
                                  ? "bg-red-500 border-red-500"
                                  : "bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-600"
                              }`}
                              title={seg.enabled ? "انقر لإزالته من قائمة الحذف" : "انقر لإضافته لقائمة الحذف"}
                            >
                              {seg.enabled && <span className="text-white text-xs font-bold">✓</span>}
                            </button>

                            {/* Time range */}
                            <span className={`font-mono flex-1 min-w-0 ${seg.enabled?"text-red-700 dark:text-red-300":"text-slate-500"}`}>
                              {SilenceProcessor.formatDuration(seg.startSec)}
                              <span className="text-slate-400 mx-1">←</span>
                              {SilenceProcessor.formatDuration(seg.endSec)}
                            </span>

                            {/* Duration */}
                            <span className={`font-mono text-xs flex-shrink-0 ${seg.enabled?"text-red-500":"text-slate-400"}`}>
                              {SilenceProcessor.formatDuration(seg.durationSec)}
                            </span>

                            {/* ▶ Play button */}
                            <button
                              onClick={async (e) => {
                                e.stopPropagation();
                                // أوقف أي تشغيل سابق
                                stopSilenceLoop();
                                const srcBuf = (processedSilenceResult as { buffer: AudioBuffer } | null)?.buffer ?? silenceAudioBuffer;
                                if (!srcBuf) { toast.error("لا يوجد ملف للتشغيل"); return; }
                                // شغّل المقطع مع هامش 0.3 ثانية قبله وبعده
                                const s = Math.max(0, seg.startSec - 0.3);
                                const e2 = Math.min(srcBuf.duration, seg.endSec + 0.3);
                                setSilenceLoopEnabled(true);
                                startSilenceLoop(s, e2);
                              }}
                              className={`flex-shrink-0 w-7 h-7 flex items-center justify-center rounded-lg transition-all ${
                                seg.enabled
                                  ? "bg-red-100 dark:bg-red-900/60 text-red-600 dark:text-red-400 hover:bg-red-200 dark:hover:bg-red-800"
                                  : "bg-slate-100 dark:bg-slate-700 text-slate-500 hover:bg-slate-200"
                              }`}
                              title="استمع لهذا المقطع قبل اتخاذ القرار"
                            >
                              ▶
                            </button>

                            {/* ✕ Remove from list */}
                            <button
                              onClick={e => { e.stopPropagation(); setDetectedSegments(prev => prev.filter(s => s.id!==seg.id)); }}
                              className="flex-shrink-0 w-6 h-6 flex items-center justify-center text-slate-300 dark:text-slate-600 hover:text-red-500 transition-colors rounded-lg hover:bg-red-50 dark:hover:bg-red-950/40"
                              title="إزالة من القائمة نهائياً"
                            >
                              ✕
                            </button>
                          </div>
                        ))}
                      </div>
                      );
                    })()}

                    {/* Force delete toggle — advanced */}
                    <div className={`flex items-center gap-3 px-3 py-2.5 rounded-xl border transition-all ${
                      forceDeleteAll?"bg-red-50 dark:bg-red-950/60 border-red-300 dark:border-red-700":"bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700"
                    }`}>
                      <input type="checkbox" id="forceDelete" checked={forceDeleteAll}
                        onChange={e => setForceDeleteAll(e.target.checked)}
                        className="w-4 h-4 accent-red-600 flex-shrink-0 cursor-pointer"/>
                      <label htmlFor="forceDelete" className="text-xs cursor-pointer">
                        <span className={`font-semibold ${forceDeleteAll?"text-red-700 dark:text-red-300":"text-slate-700 dark:text-slate-300"}`}>
                          حذف كل المحدد بدون قيود
                        </span>
                        {forceDeleteAll && <span className="block text-red-500 text-xs mt-0.5">⚠ تأكد قبل التنفيذ</span>}
                      </label>
                    </div>
                  </div>
                )}

                {/* ── D. Export panel ───────────────────────────────────────── */}
                {showSilenceExport && (silenceResultBuffer || processedSilenceResult) && (() => {
                  const exportBuf = silenceResultBuffer ?? processedSilenceResult!.buffer;
                  return (
                  <div className="border-t border-slate-100 dark:border-slate-800 px-4 py-4 space-y-2">
                    <p className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-3">اختر صيغة الحفظ:</p>
                    {[
                      { fmt:"wav" as const, label:"WAV", sub:"جودة أصلية — موثوق دائماً", size:((exportBuf.length*exportBuf.numberOfChannels*2+44)/(1024*1024)).toFixed(1) },
                      { fmt:"mp3" as const, br:128, label:"MP3 128k", sub:"✓ واتساب — مناسب للمشاركة", size:(exportBuf.duration*128*1000/8/(1024*1024)).toFixed(1) },
                      { fmt:"mp3" as const, br:192, label:"MP3 192k", sub:"جودة عالية", size:(exportBuf.duration*192*1000/8/(1024*1024)).toFixed(1) },
                    ].map(opt => (
                      <button key={opt.label}
                        onClick={() => { setSilenceExportFormat(opt.fmt); if(opt.br) setSilenceExportBitrate(opt.br as 128|192|96); }}
                        className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border text-xs transition-all ${
                          silenceExportFormat===opt.fmt&&(opt.br===undefined||silenceExportBitrate===opt.br)
                            ?"bg-emerald-600 border-emerald-600 text-white"
                            :"border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:border-emerald-400"
                        }`}>
                        <span className="font-bold w-16">{opt.label}</span>
                        <span className="font-mono">~{opt.size} MB</span>
                        <span className={`mr-auto text-xs ${silenceExportFormat===opt.fmt&&(opt.br===undefined||silenceExportBitrate===opt.br)?"text-emerald-100":"text-slate-400"}`}>{opt.sub}</span>
                      </button>
                    ))}
                    {isSilenceExporting && (
                      <div className="flex items-center gap-2 text-xs text-emerald-600">
                        <div className="w-3.5 h-3.5 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin"/>جاري التصدير...
                      </div>
                    )}
                    {silenceExportError && <p className="text-xs text-red-500">{silenceExportError}</p>}
                    <Button onClick={handleSilenceExport} disabled={isSilenceExporting}
                      className="w-full gap-2 h-12 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl text-sm">
                      {isSilenceExporting
                        ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"/>جاري التحميل...</>
                        : <>⬇ تحميل {silenceExportFormat.toUpperCase()} {silenceExportFormat==="mp3"?`${silenceExportBitrate}k`:""}</>}
                    </Button>
                  </div>
                  );
                })()}
              </div>
            )}
          </div>
        );
      }

      // ── EQ ───────────────────────────────────────────────────────────────
      case "eq":
        return (
          <div className={wrapClass}>
            <SectionHeader
              title="معادل صوتي يدوي — 9 نطاقات"
              subtitle={advancedProcessor ? "يؤثر مباشرةً على التشغيل الحالي" : "تصدير فقط"}
            />
            {/* Presets — اختر واستمع فوراً */}
            <div className="grid grid-cols-2 gap-2">
              {(["quranClarity","noiseReduction","warmVoice","flat"] as EQPresetName[]).map((p) => {
                const isActive = eqPreset === p;
                return (
                  <button key={p}
                    onClick={() => {
                      handleEQPreset(p);
                      if (isActive && isEQPreviewing) { stopEQPreview(); }
                      else { handleEQPreview(EQ_PRESETS[p].gains); }
                    }}
                    className={`relative flex flex-col items-start gap-1 px-3 py-3 rounded-xl border-2 text-right transition-all ${
                      isActive
                        ? "border-blue-500 bg-blue-50 dark:bg-blue-950/40"
                        : "border-slate-200 dark:border-slate-700 hover:border-blue-300 hover:bg-slate-50 dark:hover:bg-slate-800/50"
                    }`}>
                    {/* Sound wave animation when previewing */}
                    {isActive && isEQPreviewing && (
                      <span className="absolute top-2 left-2 flex items-end gap-0.5 h-3">
                        {[2,3,5,3,2].map((h,i) => (
                          <span key={i} className="w-0.5 bg-blue-400 rounded-sm animate-pulse"
                            style={{ height:`${h*3}px`, animationDelay:`${i*0.12}s`}}/>
                        ))}
                      </span>
                    )}
                    <span className={`text-sm font-semibold ${isActive?"text-blue-700 dark:text-blue-300":"text-slate-700 dark:text-slate-300"}`}>
                      {EQ_PRESETS[p].nameAr}
                    </span>
                    <span className={`text-xs leading-tight ${isActive?"text-blue-500 dark:text-blue-400":"text-slate-400"}`}>
                      {p==="quranClarity" ? "وضوح التلاوة والحضور"  :
                       p==="noiseReduction"? "يُخفّف الضجيج والرنين" :
                       p==="warmVoice"    ? "دفء وعمق في الصوت"    :
                                            "إعادة كل شيء للصفر"}
                    </span>
                    {isActive && (
                      <span className="text-xs text-blue-400 font-medium mt-0.5">
                        {isEQPreviewing ? "⏸ انقر للإيقاف" : "▶ انقر للاستماع"}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Preview status */}
            {isEQPreviewing && (
              <div className="flex items-center justify-between bg-slate-900 rounded-xl px-4 py-2.5">
                <div className="flex items-center gap-2.5">
                  <div className="flex gap-0.5 items-end" style={{height:"16px"}}>
                    {[3,5,4,7,4,5,3].map((h,i) => (
                      <span key={i} className="w-1 bg-blue-400 rounded-sm animate-pulse"
                        style={{height:`${h*2}px`, animationDelay:`${i*0.1}s`}}/>
                    ))}
                  </div>
                  <span className="text-xs text-slate-300">
                    معاينة — استمع للفرق قبل التطبيق
                  </span>
                </div>
                <button onClick={stopEQPreview}
                  className="text-xs text-slate-400 hover:text-white px-2 py-1 rounded-lg hover:bg-slate-700 transition-all">
                  ⏹ إيقاف
                </button>
              </div>
            )}
            {/* Sliders */}
            <div className="bg-slate-50 dark:bg-slate-800 rounded-xl p-4">
              <div className="flex items-end justify-between gap-1">
                {EQ_BANDS.map((band, i) => (
                  <div key={band.freq} className="flex flex-col items-center gap-1 flex-1 min-w-0" title={band.description}>
                    <span className={`text-xs font-mono leading-none ${eqGains[i]>0?"text-emerald-600":eqGains[i]<0?"text-red-500":"text-slate-400"}`}>
                      {eqGains[i]>0?"+":""}{eqGains[i].toFixed(0)}
                    </span>
                    <div className="relative flex justify-center" style={{ height:"96px" }}>
                      <input type="range" min="-12" max="12" step="0.5" value={eqGains[i]}
                        onChange={(e) => handleEQChange(i, parseFloat(e.target.value))}
                        className="appearance-none cursor-pointer"
                        style={{ writingMode:"vertical-lr" as React.CSSProperties["writingMode"], direction:"rtl",
                          width:"20px", height:"96px",
                          accentColor: eqGains[i]>0?"#10b981":eqGains[i]<0?"#ef4444":"#94a3b8" }}/>
                      <div className="absolute left-0 right-0 pointer-events-none"
                        style={{ top:"50%", height:"1px", background:"#cbd5e1", opacity:0.5 }}/>
                    </div>
                    <span className="text-slate-400 leading-none text-center" style={{ fontSize:"10px" }}>{band.label}</span>
                  </div>
                ))}
              </div>
            </div>
            {isExportingEQ && <ProgressBar percent={eqExportProgress} label={eqExportStage}/>}
            <div className="grid grid-cols-2 gap-2">
              <Button onClick={async () => {
                // تطبيق EQ على الملف مباشرةً بدون تصدير
                if (!currentAudio || isExportingEQ) return;
                setIsExportingEQ(true); setEqExportProgress(10); setEqExportStage("جاري التطبيق...");
                try {
                  const buf = await AudioTrimmerEngine.loadBuffer(currentAudio.url);
                  setEqExportProgress(40);
                  const offline = new OfflineAudioContext(buf.numberOfChannels, buf.length, buf.sampleRate);
                  const src = offline.createBufferSource(); src.buffer = buf;
                  let prev: AudioNode = src;
                  EQ_BANDS.forEach((band, i) => {
                    const f = offline.createBiquadFilter();
                    f.type = i === 0 ? "lowshelf" : i === EQ_BANDS.length - 1 ? "highshelf" : "peaking";
                    f.frequency.value = band.freq; f.Q.value = 1.4; f.gain.value = eqGains[i];
                    prev.connect(f); prev = f;
                  });
                  prev.connect(offline.destination); src.start(0);
                  const rendered = await offline.startRendering();
                  setEqExportProgress(85);
                  const { AudioExporter } = await import("@/components/AudioExporter");
                  const blob = AudioExporter.toWav(rendered);
                  const url = URL.createObjectURL(blob);
                  setActiveAudio(url, currentAudio.name);
                  const newEffects = new Set(activeEffects); newEffects.add("معادل الصوت");
                  setActiveEffects(newEffects);
                  toast.success("✓ تم تطبيق المعادل على الملف");
                } catch (e) { toast.error("فشل التطبيق"); }
                finally { setIsExportingEQ(false); setEqExportProgress(0); setEqExportStage(""); }
              }} disabled={isExportingEQ} className="h-11 gap-2">
                <Zap className="w-4 h-4"/> تطبيق على الملف
              </Button>
              <Button onClick={handleEQExport} disabled={isExportingEQ} variant="outline" className="h-11 gap-2">
                <Download className="w-4 h-4"/>
                {isExportingEQ ? "جاري..." : "تصدير WAV"}
              </Button>
            </div>
            {/* حفظ بصيغ متعددة */}
            <button onClick={() => setShowEffectExport(v => !v)}
              className="w-full py-2.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400 border border-emerald-300 dark:border-emerald-700 rounded-xl hover:bg-emerald-50 dark:hover:bg-emerald-950/30 transition-all">
              💾 {showEffectExport ? "▲ إخفاء خيارات الحفظ" : "حفظ النهائي بصيغة MP3 أو WAV ←"}
            </button>
            {showEffectExport && <EffectExportPanel waveformDuration={waveformDuration} effectExportFmt={effectExportFmt} effectExportBr={effectExportBr} isEffectExporting={isEffectExporting} onSelectFmt={(fmt,br)=>{ setEffectExportFmt(fmt); if(br) setEffectExportBr(br); }} onExport={handleEffectExport}/>}
          </div>
        );

      // ── Clarity ───────────────────────────────────────────────────────────
      case "clarity":
        return (
          <div className={wrapClass}>
            <SectionHeader title="تحسين وضوح الكلام" subtitle="استمع للمعاينة أولاً ثم طبّق على الملف"/>

            {/* ── Enhancement Engine Section ──────────────────────────────── */}
            <div className="border border-emerald-200 dark:border-emerald-800 rounded-xl p-3 space-y-2.5 bg-emerald-50/40 dark:bg-emerald-950/20">
              <p className="text-xs font-bold text-emerald-700 dark:text-emerald-300">⚡ محرك التحسين المتكامل</p>

              {/* Preset selector */}
              <div className="grid grid-cols-3 gap-1.5">
                {PRESET_LIST.map(p => (
                  <button key={p.id}
                    onClick={() => setEnhancementPresetId(p.id)}
                    title={p.descriptionAr}
                    className={`py-1.5 px-1 rounded-lg text-xs font-medium transition-all text-center leading-tight ${
                      enhancementPresetId === p.id
                        ? "bg-emerald-600 text-white shadow-sm"
                        : "bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-emerald-100 dark:hover:bg-emerald-950/50 border border-slate-200 dark:border-slate-700"
                    }`}>
                    <span className="block text-base">{p.icon}</span>
                    {p.labelAr}
                  </button>
                ))}
              </div>

              {/* Preset description */}
              <p className="text-xs text-slate-500 dark:text-slate-400 text-center">
                {ENHANCEMENT_PRESETS[enhancementPresetId].descriptionAr}
              </p>

              {/* ── Hum Removal Controls ─────────────────────────────────── */}
              <div className="border border-slate-200 dark:border-slate-700 rounded-lg p-2.5 space-y-2 bg-white/60 dark:bg-slate-800/40">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">إزالة الطنين الكهربائي</span>
                  <button
                    onClick={() => setHumEnabled(v => !v)}
                    className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
                      humEnabled
                        ? "bg-amber-500 text-white"
                        : "bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-600"
                    }`}>
                    {humEnabled ? "مفعّل" : "معطّل"}
                  </button>
                </div>
                {humEnabled && (
                  <>
                    <div className="flex gap-1.5">
                      {([50, 60] as const).map(hz => (
                        <button key={hz}
                          onClick={() => setHumFreqHz(hz)}
                          className={`flex-1 py-1 rounded-md text-xs font-medium transition-all ${
                            humFreqHz === hz
                              ? "bg-amber-500 text-white"
                              : "bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-600"
                          }`}>
                          {hz} Hz
                        </button>
                      ))}
                    </div>
                    <div className="flex gap-1.5">
                      {(["light", "medium", "strong"] as const).map(s => (
                        <button key={s}
                          onClick={() => setHumStrength(s)}
                          className={`flex-1 py-1 rounded-md text-xs font-medium transition-all ${
                            humStrength === s
                              ? "bg-amber-500 text-white"
                              : "bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-600"
                          }`}>
                          {s === "light" ? "خفيف" : s === "medium" ? "متوسط" : "قوي"}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </div>

              {/* ── Noise Reduction Controls ──────────────────────────────── */}
              <div className="border border-slate-200 dark:border-slate-700 rounded-lg p-2.5 space-y-2 bg-white/60 dark:bg-slate-800/40">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">تخفيف الضوضاء الخلفية</span>
                  <button
                    onClick={() => setNrEnabled(v => !v)}
                    className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
                      nrEnabled
                        ? "bg-violet-500 text-white"
                        : "bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-600"
                    }`}>
                    {nrEnabled ? "مفعّل" : "معطّل"}
                  </button>
                </div>
                {nrEnabled && (
                  <div className="flex gap-1.5">
                    {(["light", "medium", "strong"] as const).map(s => (
                      <button key={s}
                        onClick={() => setNrStrength(s)}
                        className={`flex-1 py-1 rounded-md text-xs font-medium transition-all ${
                          nrStrength === s
                            ? "bg-violet-500 text-white"
                            : "bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-600"
                        }`}>
                        {s === "light" ? "خفيف" : s === "medium" ? "متوسط" : "قوي"}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* ── De-reverb Controls ───────────────────────────────────── */}
              <div className="border border-teal-200 dark:border-teal-800 rounded-lg p-2.5 space-y-2 bg-white/60 dark:bg-slate-800/40">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-600 dark:text-slate-300">تخفيف الصدى</span>
                  <button
                    onClick={() => setDrEnabled(v => !v)}
                    className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
                      drEnabled
                        ? "bg-teal-500 text-white"
                        : "bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-600"
                    }`}>
                    {drEnabled ? "مفعّل" : "معطّل"}
                  </button>
                </div>
                {drEnabled && (
                  <div className="flex gap-1.5">
                    {(["light", "medium"] as const).map(a => (
                      <button key={a}
                        onClick={() => setDrAmount(a)}
                        className={`flex-1 py-1 rounded-md text-xs font-medium transition-all ${
                          drAmount === a
                            ? "bg-teal-500 text-white"
                            : "bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-600"
                        }`}>
                        {a === "light" ? "خفيف" : "متوسط"}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Progress */}
              {isEnhancing && (
                <ProcessingIndicator isProcessing={true} currentEffect={enhancementStage || "جاري التحسين..."} progress={enhancementProgress}/>
              )}

              {/* Apply button */}
              <Button
                className="w-full gap-2 h-11 bg-emerald-600 hover:bg-emerald-500 text-white"
                disabled={!currentAudio || anyBusy}
                onClick={() => { stopEQPreview(); setShowEffectExport(false); handleEnhancementApply(); }}>
                <Sparkles className="w-4 h-4"/>
                {isEnhancing
                  ? (enhancementStage || "جاري التحسين...")
                  : activeEffects.has("تحسين متكامل")
                    ? "✓ مُطبَّق — تطبيق مجدداً"
                    : "تطبيق التحسين المتكامل"}
              </Button>

              {/* Before / After report */}
              {enhancementReport && !isEnhancing && (
                <div className="bg-white dark:bg-slate-900 rounded-lg px-3 py-2 text-xs space-y-1 border border-emerald-100 dark:border-emerald-900">
                  <p className="font-semibold text-slate-600 dark:text-slate-400 mb-1">تقرير المعالجة</p>
                  <div className="flex justify-between text-slate-500">
                    <span>الذروة</span>
                    <span className="font-mono">
                      {enhancementReport.before.peakDb.toFixed(1)} → {enhancementReport.after.peakDb.toFixed(1)} dB
                    </span>
                  </div>
                  <div className="flex justify-between text-slate-500">
                    <span>RMS</span>
                    <span className="font-mono">
                      {enhancementReport.before.rmsDb.toFixed(1)} → {enhancementReport.after.rmsDb.toFixed(1)} dB
                    </span>
                  </div>
                  <div className="flex justify-between text-slate-500">
                    <span>التطبيع</span>
                    <span className="font-mono">{enhancementReport.normalizationGainDb > 0 ? "+" : ""}{enhancementReport.normalizationGainDb.toFixed(1)} dB</span>
                  </div>
                  {enhancementReport.humRemovalApplied && (
                    <div className="flex justify-between text-amber-600 dark:text-amber-400">
                      <span>الطنين</span>
                      <span className="font-mono">{enhancementReport.humFrequency} Hz · {enhancementReport.humHarmonicsProcessed?.join(", ")} Hz</span>
                    </div>
                  )}
                  {enhancementReport.noiseReductionApplied && (
                    <div className="flex justify-between text-violet-600 dark:text-violet-400">
                      <span>الضوضاء</span>
                      <span className="font-mono">
                        {enhancementReport.estimatedNoiseFloorDb?.toFixed(1)} dB floor · {enhancementReport.noiseFramesUsed} إطار
                      </span>
                    </div>
                  )}
                  {enhancementReport.deReverbApplied && (
                    <div className="flex justify-between text-teal-600 dark:text-teal-400">
                      <span>الصدى</span>
                      <span className="font-mono">
                        -{enhancementReport.reverbTailReductionDb?.toFixed(1)} dB · {enhancementReport.deReverbAmount}
                      </span>
                    </div>
                  )}
                  <p className="text-slate-400 mt-1 leading-snug">
                    {enhancementReport.appliedStages.join(" · ")}
                  </p>
                </div>
              )}

              {/* Phase F: A/B Comparison Controls */}
              {enhancementReport && !isEnhancing && originalAudioBufferRef && enhancedAudioBufferRef && (
                <div className="bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-950 dark:to-indigo-950 rounded-lg p-3 space-y-2 border border-blue-200 dark:border-blue-800">
                  <p className="text-xs font-semibold text-blue-700 dark:text-blue-300 mb-2">🔄 مقارنة الأصلي والمحسّن</p>
                  <div className="flex gap-2">
                    <button
                      onClick={handleSwitchToOriginal}
                      className={`flex-1 py-2 px-3 text-xs font-semibold rounded-lg transition-all ${
                        previewMode === 'original'
                          ? 'bg-blue-600 text-white shadow-lg'
                          : 'bg-white dark:bg-slate-800 text-blue-600 dark:text-blue-400 border border-blue-300 dark:border-blue-700 hover:bg-blue-50 dark:hover:bg-slate-700'
                      }`}
                    >
                      📄 الأصلي
                    </button>
                    <button
                      onClick={handleSwitchToEnhanced}
                      className={`flex-1 py-2 px-3 text-xs font-semibold rounded-lg transition-all ${
                        previewMode === 'enhanced'
                          ? 'bg-emerald-600 text-white shadow-lg'
                          : 'bg-white dark:bg-slate-800 text-emerald-600 dark:text-emerald-400 border border-emerald-300 dark:border-emerald-700 hover:bg-emerald-50 dark:hover:bg-slate-700'
                      }`}
                    >
                      ✨ المحسّن
                    </button>
                  </div>
                  <div className="text-xs text-slate-600 dark:text-slate-400 text-center py-1 bg-white/50 dark:bg-slate-800/50 rounded">
                    {previewMode === 'original' ? '🔊 استمع للملف الأصلي' : '🔊 استمع للملف المحسّن'}
                  </div>
                </div>
              )}

              {/* Phase F: Export Both Versions */}
              {enhancementReport && !isEnhancing && originalAudioBufferRef && enhancedAudioBufferRef && (
                <div className="bg-gradient-to-r from-amber-50 to-orange-50 dark:from-amber-950 dark:to-orange-950 rounded-lg p-3 space-y-2 border border-amber-200 dark:border-amber-800">
                  <p className="text-xs font-semibold text-amber-700 dark:text-amber-300 mb-2">💾 تصدير النسختين</p>
                  <div className="flex gap-2">
                    <button
                      onClick={handleExportOriginal}
                      disabled={isExportingEQ}
                      className="flex-1 py-2 px-3 text-xs font-semibold rounded-lg bg-slate-600 hover:bg-slate-700 text-white disabled:opacity-50 transition-all"
                    >
                      {isExportingEQ ? '⋯' : '📄'} تصدير الأصلي
                    </button>
                    <button
                      onClick={handleExportEnhanced}
                      disabled={isExportingEQ || settingsChangedAfterProcessing}
                      className="flex-1 py-2 px-3 text-xs font-semibold rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-50 transition-all"
                    >
                      {isExportingEQ ? '⋯' : '✨'} تصدير المحسّن
                    </button>
                  </div>
                  {settingsChangedAfterProcessing && (
                    <p className="text-xs text-amber-600 dark:text-amber-400 text-center">
                      ⚠️ تم تغيير الإعدادات - أعد المعالجة
                    </p>
                  )}
                </div>
              )}

              {/* Export after enhancement */}
              {activeEffects.has("تحسين متكامل") && (
                <button onClick={() => setShowEffectExport(v => !v)}
                  className="w-full py-2 text-xs font-semibold text-emerald-600 dark:text-emerald-400 border border-emerald-300 dark:border-emerald-700 rounded-xl hover:bg-emerald-50 dark:hover:bg-emerald-950/30 transition-all">
                  💾 {showEffectExport ? "▲ إخفاء خيارات الحفظ" : "حفظ الملف المُحسَّن ←"}
                </button>
              )}
              {showEffectExport && activeEffects.has("تحسين متكامل") && (
                <EffectExportPanel
                  waveformDuration={waveformDuration}
                  effectExportFmt={effectExportFmt}
                  effectExportBr={effectExportBr}
                  isEffectExporting={isEffectExporting}
                  onSelectFmt={(fmt, br) => { setEffectExportFmt(fmt); if (br) setEffectExportBr(br); }}
                  onExport={handleEffectExport}/>
              )}
            </div>

            {/* ── Divider ─────────────────────────────────────────────────── */}
            <div className="flex items-center gap-2">
              <div className="flex-1 h-px bg-slate-200 dark:bg-slate-700"/>
              <span className="text-xs text-slate-400">أو تطبيق يدوي</span>
              <div className="flex-1 h-px bg-slate-200 dark:bg-slate-700"/>
            </div>
            <div className="grid grid-cols-3 gap-2 text-center">
              {[{label:"حذف الرنين",sub:"< 120Hz",icon:"🔇"},{label:"وضوح الكلام",sub:"3kHz ↑",icon:"🎤"},{label:"إضاءة",sub:"8kHz ↑",icon:"✨"}].map(f=>(
                <div key={f.label} className="bg-slate-50 dark:bg-slate-800 rounded-xl p-2.5 space-y-1">
                  <p className="text-xl">{f.icon}</p>
                  <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">{f.label}</p>
                  <p className="text-xs text-slate-400 font-mono">{f.sub}</p>
                </div>
              ))}
            </div>
            <button onClick={async()=>{
              if(!currentAudio||isEQPreviewing)return; stopEQPreview(); setIsEQPreviewing(true);
              try{
                const buf=await AudioTrimmerEngine.loadBuffer(currentAudio.url);
                const dur=Math.min(30,buf.duration),start=buf.duration>60?30:0;
                const sr=buf.sampleRate,ch=buf.numberOfChannels,frames=Math.floor(dur*sr),startF=Math.floor(start*sr);
                const offline=new OfflineAudioContext(ch,frames,sr);
                const slice=offline.createBuffer(ch,frames,sr);
                for(let c=0;c<ch;c++)slice.copyToChannel(buf.getChannelData(c).slice(startF,startF+frames),c);
                const src=offline.createBufferSource();src.buffer=slice;
                const hp=offline.createBiquadFilter();hp.type="highpass";hp.frequency.value=120;
                const pr=offline.createBiquadFilter();pr.type="peaking";pr.frequency.value=3000;pr.Q.value=1.2;pr.gain.value=4;
                const air=offline.createBiquadFilter();air.type="highshelf";air.frequency.value=8000;air.gain.value=2;
                src.connect(hp);hp.connect(pr);pr.connect(air);air.connect(offline.destination);src.start(0);
                const rendered=await offline.startRendering();
                const ctx=new AudioContext();eqPreviewCtxRef.current=ctx;
                const play=ctx.createBufferSource();play.buffer=rendered;play.connect(ctx.destination);play.start(0);
                eqPreviewSrcRef.current=play;
                play.onended=()=>{ctx.close().catch(()=>{});eqPreviewSrcRef.current=null;setIsEQPreviewing(false);};
                toast.success("▶ معاينة 30 ثانية",{duration:2000});
              }catch{setIsEQPreviewing(false);toast.error("فشلت المعاينة");}
            }} disabled={!currentAudio}
              className="w-full py-3 rounded-xl border-2 border-dashed border-blue-300 dark:border-blue-700 text-blue-600 dark:text-blue-400 font-semibold hover:bg-blue-50 dark:hover:bg-blue-950/30 transition-all disabled:opacity-50 flex items-center justify-center gap-2 text-sm">
              {isEQPreviewing?<><div className="w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin"/>جاري التحضير...</>:<>▶ استمع للمعاينة أولاً</>}
            </button>
            {isEQPreviewing&&(<div className="flex items-center justify-between bg-slate-900 rounded-xl px-4 py-2.5">
              <span className="text-xs text-slate-300 flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse inline-block"/>معاينة تحسين الوضوح</span>
              <button onClick={stopEQPreview} className="text-xs text-slate-400 hover:text-white px-2 py-1 rounded-lg hover:bg-slate-700">⏹ إيقاف</button>
            </div>)}
            {isApplyingEffect&&currentEffectName==="تحسين الوضوح"&&(<ProcessingIndicator isProcessing={true} currentEffect="جاري التطبيق..." progress={effectProgress}/>)}
            <Button className="w-full gap-2 h-11" disabled={isApplyingEffect||anyBusy} onClick={()=>{stopEQPreview();setShowEffectExport(false);handleClarityApply();}}>
              <Mic2 className="w-4 h-4"/>{activeEffects.has("تحسين الوضوح")?"✓ مُطبَّق — اضغط للإعادة":"تطبيق على الملف"}
            </Button>
            {activeEffects.has("تحسين الوضوح") && (
              <>
                <button onClick={() => setShowEffectExport(v => !v)}
                  className="w-full py-2.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400 border border-emerald-300 dark:border-emerald-700 rounded-xl hover:bg-emerald-50 dark:hover:bg-emerald-950/30 transition-all">
                  💾 {showEffectExport ? "▲ إخفاء خيارات الحفظ" : "حفظ النهائي ←"}
                </button>
                {showEffectExport && <EffectExportPanel waveformDuration={waveformDuration} effectExportFmt={effectExportFmt} effectExportBr={effectExportBr} isEffectExporting={isEffectExporting} onSelectFmt={(fmt,br)=>{ setEffectExportFmt(fmt); if(br) setEffectExportBr(br); }} onExport={handleEffectExport}/>}
                <Button variant="outline" size="sm" onClick={handleResetEffects} className="w-full gap-2 text-slate-500">
                  <RotateCcw className="w-3.5 h-3.5"/> استعادة الأصل
                </Button>
              </>
            )}
          </div>
        );

      // ── Compression ───────────────────────────────────────────────────────
      case "compression":
        return (
          <div className={wrapClass}>
            <SectionHeader title="ضغط الصوت" subtitle="استمع للمعاينة أولاً ثم طبّق على الملف"/>
            <div className="grid grid-cols-3 gap-2 text-center">
              {[{label:"يُوازن المستوى",sub:"4:1 ratio",icon:"⚖️"},{label:"يرفع الهادئ",sub:"make-up gain",icon:"🔊"},{label:"انتقال ناعم",sub:"attack/release",icon:"🎚"}].map(f=>(
                <div key={f.label} className="bg-slate-50 dark:bg-slate-800 rounded-xl p-2.5 space-y-1">
                  <p className="text-xl">{f.icon}</p>
                  <p className="text-xs font-semibold text-slate-700 dark:text-slate-300">{f.label}</p>
                  <p className="text-xs text-slate-400 font-mono">{f.sub}</p>
                </div>
              ))}
            </div>
            <button onClick={async()=>{
              if(!currentAudio||isEQPreviewing)return; stopEQPreview(); setIsEQPreviewing(true);
              try{
                const buf=await AudioTrimmerEngine.loadBuffer(currentAudio.url);
                const dur=Math.min(30,buf.duration),start=buf.duration>60?30:0;
                const sr=buf.sampleRate,ch=buf.numberOfChannels,frames=Math.floor(dur*sr),startF=Math.floor(start*sr);
                const offline=new OfflineAudioContext(ch,frames,sr);
                const slice=offline.createBuffer(ch,frames,sr);
                for(let c=0;c<ch;c++)slice.copyToChannel(buf.getChannelData(c).slice(startF,startF+frames),c);
                const src=offline.createBufferSource();src.buffer=slice;
                const comp=offline.createDynamicsCompressor();
                comp.threshold.value=-24;comp.knee.value=10;comp.ratio.value=4;comp.attack.value=0.005;comp.release.value=0.15;
                const gain=offline.createGain();gain.gain.value=1.4;
                src.connect(comp);comp.connect(gain);gain.connect(offline.destination);src.start(0);
                const rendered=await offline.startRendering();
                const ctx=new AudioContext();eqPreviewCtxRef.current=ctx;
                const play=ctx.createBufferSource();play.buffer=rendered;play.connect(ctx.destination);play.start(0);
                eqPreviewSrcRef.current=play;
                play.onended=()=>{ctx.close().catch(()=>{});eqPreviewSrcRef.current=null;setIsEQPreviewing(false);};
                toast.success("▶ معاينة 30 ثانية",{duration:2000});
              }catch{setIsEQPreviewing(false);toast.error("فشلت المعاينة");}
            }} disabled={!currentAudio}
              className="w-full py-3 rounded-xl border-2 border-dashed border-amber-300 dark:border-amber-700 text-amber-600 dark:text-amber-400 font-semibold hover:bg-amber-50 dark:hover:bg-amber-950/30 transition-all disabled:opacity-50 flex items-center justify-center gap-2 text-sm">
              {isEQPreviewing?<><div className="w-4 h-4 border-2 border-amber-400 border-t-transparent rounded-full animate-spin"/>جاري التحضير...</>:<>▶ استمع للمعاينة أولاً</>}
            </button>
            {isEQPreviewing&&(<div className="flex items-center justify-between bg-slate-900 rounded-xl px-4 py-2.5">
              <span className="text-xs text-slate-300 flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse inline-block"/>معاينة ضغط الصوت</span>
              <button onClick={stopEQPreview} className="text-xs text-slate-400 hover:text-white px-2 py-1 rounded-lg hover:bg-slate-700">⏹ إيقاف</button>
            </div>)}
            {isApplyingEffect&&currentEffectName==="ضغط الصوت"&&(<ProcessingIndicator isProcessing={true} currentEffect="جاري التطبيق..." progress={effectProgress}/>)}
            <Button
              className="w-full gap-2 h-11"
              disabled={isApplyingEffect || anyBusy}
              onClick={() => { stopEQPreview(); setShowEffectExport(false); handleCompressionApply(); }}
            >
              <Activity className="w-4 h-4"/>
              {activeEffects.has("ضغط الصوت") ? "✓ مُطبَّق — اضغط للإعادة" : "تطبيق ضغط الصوت"}
            </Button>
            {activeEffects.has("ضغط الصوت") && (
              <>
                <button onClick={() => setShowEffectExport(v => !v)}
                  className="w-full py-2.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400 border border-emerald-300 dark:border-emerald-700 rounded-xl hover:bg-emerald-50 dark:hover:bg-emerald-950/30 transition-all">
                  💾 {showEffectExport ? "▲ إخفاء خيارات الحفظ" : "حفظ النهائي ←"}
                </button>
                {showEffectExport && <EffectExportPanel waveformDuration={waveformDuration} effectExportFmt={effectExportFmt} effectExportBr={effectExportBr} isEffectExporting={isEffectExporting} onSelectFmt={(fmt,br)=>{ setEffectExportFmt(fmt); if(br) setEffectExportBr(br); }} onExport={handleEffectExport}/>}
                <Button variant="outline" size="sm" onClick={handleResetEffects} className="w-full gap-2 text-slate-500">
                  <RotateCcw className="w-3.5 h-3.5"/> استعادة الأصل
                </Button>
              </>
            )}
          </div>
        );

      // ── Transcription ─────────────────────────────────────────────────────
      case "transcribe":
        return (
          <div className={wrapClass}>
            <SectionHeader
              title="استخراج النص من الصوت"
              subtitle="يعمل محلياً في المتصفح — Chrome أو Edge فقط"
            />

            {/* Language selector */}
            <div className="flex gap-2 p-1 bg-slate-100 dark:bg-slate-800 rounded-xl">
              {[{v:"ar" as const, l:"🇸🇦 عربي"},{v:"en" as const, l:"🇬🇧 English"}].map(o => (
                <button key={o.v} onClick={() => setTranscriptLang(o.v)}
                  className={`flex-1 py-2 text-xs font-semibold rounded-lg transition-all ${
                    transcriptLang===o.v
                      ? "bg-white dark:bg-slate-900 text-teal-700 dark:text-teal-300 shadow-sm"
                      : "text-slate-500"
                  }`}>
                  {o.l}
                </button>
              ))}
            </div>

            {/* Info */}
            <div className="bg-teal-50 dark:bg-teal-950/30 border border-teal-200 dark:border-teal-800 rounded-xl p-3 text-xs text-teal-700 dark:text-teal-300 space-y-1">
              <p>• يُشغّل الملف الصوتي ويستمع إليه عبر الميكروفون في الوقت الفعلي</p>
              <p>• اسمح بالوصول للميكروفون عند الطلب</p>
              <p>• تأكد أن الصوت يخرج من مكبرات الصوت (وليس سماعة الرأس)</p>
              <p>• الأفضل في بيئة هادئة بدون ضوضاء</p>
            </div>

            {/* Progress */}
            {isTranscribing && (
              <ProgressBar percent={transcriptProgress} label="جاري تحليل الصوت..." color="bg-teal-500"/>
            )}

            {/* Start / Stop button */}
            {!isTranscribing ? (
              <Button onClick={handleTranscribe} disabled={!currentAudio}
                className="w-full gap-2 h-11 bg-teal-600 hover:bg-teal-500 text-white">
                <span className="text-lg">📝</span>
                {transcriptText ? "إعادة الاستخراج" : "ابدأ استخراج النص"}
              </Button>
            ) : (
              <Button onClick={handleStopTranscribe} variant="outline"
                className="w-full gap-2 h-11 border-red-300 text-red-600 hover:bg-red-50">
                <div className="w-3 h-3 rounded-full bg-red-500 animate-pulse"/>
                جارٍ الاستخراج... (اضغط للإيقاف)
              </Button>
            )}

            {/* Error */}
            {transcriptError && (
              <div className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-xl px-4 py-3 text-xs text-red-700 dark:text-red-300">
                ⚠ {transcriptError}
              </div>
            )}

            {/* Result */}
            {transcriptText && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-slate-600 dark:text-slate-400">النص المستخرج:</p>
                  <div className="flex gap-1.5">
                    <button
                      onClick={() => { navigator.clipboard.writeText(transcriptText); toast.success("تم النسخ"); }}
                      className="px-2.5 py-1 text-xs bg-slate-100 dark:bg-slate-800 rounded-lg hover:bg-slate-200 transition-colors text-slate-600 dark:text-slate-400">
                      نسخ
                    </button>
                    <button
                      onClick={() => {
                        const blob = new Blob([transcriptText], { type: "text/plain;charset=utf-8" });
                        const url  = URL.createObjectURL(blob);
                        const a    = document.createElement("a");
                        a.href = url;
                        a.download = (currentAudio?.name ?? "audio").replace(/\.[^.]+$/, "") + "-text.txt";
                        a.click(); URL.revokeObjectURL(url);
                      }}
                      className="px-2.5 py-1 text-xs bg-teal-100 dark:bg-teal-950 text-teal-700 dark:text-teal-300 rounded-lg hover:bg-teal-200 transition-colors">
                      تحميل .txt
                    </button>
                    <button onClick={() => setTranscriptText("")}
                      className="px-2.5 py-1 text-xs text-slate-400 hover:text-red-500 transition-colors">
                      مسح
                    </button>
                  </div>
                </div>
                <textarea
                  value={transcriptText}
                  onChange={e => setTranscriptText(e.target.value)}
                  rows={8}
                  dir="auto"
                  className="w-full text-sm bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl p-3 resize-none focus:outline-none focus:ring-2 focus:ring-teal-400 text-slate-800 dark:text-slate-200 leading-relaxed"
                />
                <p className="text-xs text-slate-400 text-left ltr">
                  {transcriptText.trim().split(/\s+/).length} كلمة · {transcriptText.length} حرف
                </p>
              </div>
            )}
          </div>
        );

      // ── Multi-file merge ──────────────────────────────────────────────────
      case "multi":
        return (
          <div className={wrapClass}>
            <SectionHeader
              title="دمج ملفات متعددة"
              subtitle="قطّع كل ملف على حدة ثم ادمجها في ملف واحد"
            />
            <MultiTrimPanel onUseInPlayer={handleTrimUseInPlayer} />
          </div>
        );

      
      default:
        return null;
    }
  };

  // ─── Render ────────────────────────────────────────────────────────────────
  const hasAudio = !!currentAudio;
  const anyBusy  = isCleaningUp || isRemovingSilence || isExportingEQ || isApplyingEffect || isProcessing || isEnhancing;

  // Waveform markers — من فترات الصمت المكتشفة
  const waveformMarkers: WaveformMarker[] = detectedSegments.map(s => ({
    id:       s.id,
    startSec: s.startSec,
    endSec:   s.endSec,
    color:    s.enabled ? "red" : "gray",
    label:    s.enabled ? "✂" : "—",
  }));

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      {/* input دائم — يبقى في الـ DOM دائماً حتى يعمل زر إعادة الرفع */}
      <input
        ref={fileInputRef}
        type="file"
        accept="audio/mpeg,audio/mp4,audio/wav,audio/x-wav,audio/ogg,audio/x-m4a,audio/aac,audio/webm,audio/flac,audio/opus,video/mp4,.mp3,.mp4,.wav,.ogg,.m4a,.aac,.webm,.flac,.opus"
        className="hidden"
        onChange={e => { handleFileSelect(e.target.files); e.target.value = ""; }}
      />
      <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">

        {/* ── Guided Mode Banner ──────────────────────────────────────────── */}
        <div className="flex items-center justify-between bg-slate-100 dark:bg-slate-800/60 rounded-2xl px-4 py-2.5">
          <p className="text-xs text-slate-500 dark:text-slate-400">
            🕌 مستخدم جديد؟ جرّب الوضع المبسّط
          </p>
          <a href="/guided"
            className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline">
            ابدأ هنا ←
          </a>
        </div>

        {/* ── Confirmation Modal ──────────────────────────────────────────── */}
        {deleteConfirm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
            <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl max-w-sm w-full p-6 space-y-4">
              <h3 className="text-base font-bold text-red-600 dark:text-red-400 text-right">
                ⚠️ تأكيد الحذف
              </h3>
              <p className="text-sm text-slate-700 dark:text-slate-300 text-right leading-relaxed">
                سيتم حذف نسبة كبيرة من التسجيل.
                المدة المتبقية المتوقعة:{" "}
                <strong>{SilenceProcessor.formatDuration(deleteConfirm.estimatedFinal)}</strong>.
                هل تريد المتابعة؟
              </p>
              {/* Stats */}
              <div className="grid grid-cols-3 gap-2 text-xs text-center">
                <div className="bg-slate-50 dark:bg-slate-800 rounded-lg p-2">
                  <p className="text-slate-400">المدة الأصلية</p>
                  <p className="font-mono font-bold">{SilenceProcessor.formatDuration(deleteConfirmBufRef.current?.duration ?? 0)}</p>
                </div>
                <div className="bg-red-50 dark:bg-red-950 rounded-lg p-2">
                  <p className="text-red-400">يُحذف</p>
                  <p className="font-mono font-bold text-red-600 dark:text-red-400">
                    {SilenceProcessor.formatDuration(deleteConfirm.totalToDelete)}
                    {" "}({(deleteConfirm.deleteRatio * 100).toFixed(0)}%)
                  </p>
                </div>
                <div className="bg-emerald-50 dark:bg-emerald-950 rounded-lg p-2">
                  <p className="text-emerald-400">الناتج</p>
                  <p className="font-mono font-bold text-emerald-600 dark:text-emerald-400">
                    {SilenceProcessor.formatDuration(deleteConfirm.estimatedFinal)}
                  </p>
                </div>
              </div>
              {/* Buttons */}
              <div className="flex gap-3 pt-1">
                <button
                  onClick={() => setDeleteConfirm(null)}
                  className="flex-1 px-4 py-2.5 text-sm font-medium rounded-xl border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                >إلغاء</button>
                <button
                  onClick={() => doApplyConfirmed(deleteConfirmBufRef.current!, deleteConfirm.normalized)}
                  className="flex-1 px-4 py-2.5 text-sm font-bold rounded-xl bg-red-600 hover:bg-red-700 text-white transition-colors"
                >نعم، احذف المحدد</button>
              </div>
            </div>
          </div>
        )}
        {/* ══ UPLOAD SCREEN ══════════════════════════════════════════════ */}
        {!hasAudio && (
          <div
            onDragOver={e => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={e => { e.preventDefault(); setIsDragging(false); handleFileSelect(e.dataTransfer.files); }}
            onClick={() => fileInputRef.current?.click()}
            className={`group flex flex-col items-center justify-center min-h-[340px] rounded-3xl cursor-pointer transition-all duration-200 border-2 border-dashed select-none
              ${isDragging
                ? "border-blue-400 bg-blue-50 dark:bg-blue-950/30 scale-[1.01]"
                : "border-slate-200 dark:border-slate-700 hover:border-blue-300 dark:hover:border-blue-700 hover:bg-slate-50/50 dark:hover:bg-slate-800/30"
              }`}
          >
            {/* Upload zone inner */}
            <div className={`w-20 h-20 rounded-2xl flex items-center justify-center mb-4 transition-all duration-200 ${isDragging ? "bg-blue-100 dark:bg-blue-900/60 scale-110" : "bg-slate-100 dark:bg-slate-800 group-hover:bg-blue-50 dark:group-hover:bg-slate-700"}`}>
              <Upload className={`w-8 h-8 transition-colors ${isDragging ? "text-blue-500" : "text-slate-400 group-hover:text-blue-500"}`}/>
            </div>
            <p className="text-xl font-bold text-slate-700 dark:text-slate-200 mb-1">
              {isDragging ? "أفلت الملف هنا ✓" : "ارفع ملفك الصوتي"}
            </p>
            <p className="text-sm text-slate-400 mb-6">MP3 · WAV · M4A · OGG — حتى {MAX_FILE_SIZE_MB} MB</p>
            <button type="button" onClick={e => { e.stopPropagation(); fileInputRef.current?.click(); }}
              className="px-8 py-3 rounded-2xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-sm transition-all shadow-lg shadow-blue-200 dark:shadow-none hover:shadow-blue-300 active:scale-95">
              اختر ملفاً
            </button>
            <p className="text-xs text-slate-300 dark:text-slate-600 mt-4">أو اسحب وأفلت مباشرة</p>
            {/* input في أعلى الصفحة — دائم */}

            {selectedFile && (
              <div className="absolute bottom-0 left-0 right-0 flex items-center gap-3 bg-blue-600 rounded-b-3xl px-5 py-3.5 shadow-lg" onClick={e => e.stopPropagation()}>
                <div className="w-8 h-8 rounded-lg bg-blue-500 flex items-center justify-center flex-shrink-0">
                  <Music className="w-4 h-4 text-white"/>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-white truncate">{selectedFile.name}</p>
                  <p className="text-xs text-blue-200">{(selectedFile.size/1024/1024).toFixed(1)} MB</p>
                </div>
                {isUploading && <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin flex-shrink-0"/>}
              </div>
            )}
          </div>
        )}

        {/* ══ STUDIO — audio loaded ════════════════════════════════════════ */}
        {hasAudio && (
          <div className="space-y-4">

            {/* ─ PLAYER CARD ──────────────────────────────────────────────── */}
            <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">

              {/* File header row */}
              <div className="flex items-center gap-3 px-4 pt-4 pb-1">
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-violet-600 flex items-center justify-center flex-shrink-0 shadow-sm">
                  <Music className="w-4.5 h-4.5 text-white" style={{width:"18px",height:"18px"}}/>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-slate-800 dark:text-slate-200 truncate leading-tight">
                    {currentAudio.name}
                  </p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="font-mono text-xs font-semibold text-blue-600 dark:text-blue-400 tabular-nums">
                      {formatTimeMs(waveformCurrentTime)}
                    </span>
                    <span className="text-slate-300 dark:text-slate-600 text-xs">/</span>
                    <span className="font-mono text-xs text-slate-400 tabular-nums">
                      {formatTimeMs(waveformDuration)}
                    </span>
                    {isModified && (
                      <span className="flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse inline-block"/>
                        <span className="text-xs text-amber-600 dark:text-amber-400 font-medium">معدَّل</span>
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  {isModified && (
                    <button onClick={handleResetToOriginal}
                      title="استعادة النسخة الأصلية"
                      className="w-8 h-8 flex items-center justify-center rounded-xl text-slate-400 hover:text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950/40 transition-all">
                      <RotateCcw className="w-3.5 h-3.5"/>
                    </button>
                  )}
                  <button onClick={() => fileInputRef.current?.click()}
                    title="فتح ملف جديد"
                    className="w-8 h-8 flex items-center justify-center rounded-xl text-slate-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/40 transition-all">
                    <Upload className="w-3.5 h-3.5"/>
                  </button>
                  {/* input is shared with upload zone above — no duplicate ref */}
                </div>
              </div>

              {/* Waveform — المحور الرئيسي */}
              <div className="px-0 pb-0">
                <audio ref={audioRef} src={currentAudio.url}
                  onPlay={() => setIsPlaying(true)}
                  onPause={() => setIsPlaying(false)}
                  onEnded={() => setIsPlaying(false)}
                  className="hidden"/>
                <WaveformPlayer
                  ref={waveformRef}
                  audioUrl={currentAudio.url}
                  height={80}
                  waveColor="#e2e8f0"
                  progressColor="#3b82f6"
                  markers={waveformMarkers}
                  onMarkerClick={id => {
                    setHighlightedSegId(prev => prev === id ? null : id);
                    setDetectedSegments(prev => prev.map(s => s.id === id ? {...s, enabled: !s.enabled} : s));
                  }}
                  onReady={dur => { setWaveformDuration(dur); setWaveformCurrentTime(0); }}
                  onTimeUpdate={t => setWaveformCurrentTime(t)}
                  onError={() => {}}
                />
              </div>

              {/* Active effects badge */}
              {(activeEffects.size > 0 || isApplyingEffect) && (
                <div className="mx-4 mb-3 mt-2 flex items-center gap-2 bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 rounded-xl px-3 py-2">
                  {isApplyingEffect
                    ? <ProcessingIndicator isProcessing={true} currentEffect={currentEffectName} progress={effectProgress}/>
                    : <>
                        <div className="flex flex-wrap gap-1 flex-1">
                          {Array.from(activeEffects).map(fx => (
                            <span key={fx} className="text-xs bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 px-2 py-0.5 rounded-full font-medium">
                              {fx}
                            </span>
                          ))}
                        </div>
                        <button onClick={handleResetEffects}
                          className="text-xs text-slate-400 hover:text-slate-600 flex items-center gap-1 flex-shrink-0">
                          <RotateCcw className="w-3 h-3"/> مسح
                        </button>
                      </>
                  }
                </div>
              )}
            </div>

            {/* ─ CONTEXTUAL NEXT STEP — اقتراح ذكي للخطوة التالية ─────────── */}
            {!activeTool && (
              <div className="bg-gradient-to-br from-slate-50 to-slate-100/50 dark:from-slate-800/60 dark:to-slate-900/30 rounded-2xl border border-slate-200 dark:border-slate-700 p-4">
                <p className="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-3">
                  ماذا تريد أن تفعل؟
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { id:"silence" as ToolId, icon:"🔇", label:"إزالة الصمت", sub:"للصلاة والتسجيلات", color:"from-violet-500 to-violet-700", bg:"hover:border-violet-300 hover:bg-violet-50/70 dark:hover:border-violet-800 dark:hover:bg-violet-950/20", badge:"الأكثر استخداماً" },
                    { id:"trim"    as ToolId, icon:"✂", label:"قص وتقطيع",   sub:"تحديد وحذف أجزاء", color:"from-blue-500 to-blue-700",   bg:"hover:border-blue-300 hover:bg-blue-50/70 dark:hover:border-blue-800" },
                    { id:"eq"      as ToolId, icon:"🎚", label:"تحسين الصوت", sub:"وضوح وجودة أعلى",  color:"from-amber-500 to-amber-700", bg:"hover:border-amber-300 hover:bg-amber-50/70 dark:hover:border-amber-800" },
                    { id:"multi"   as ToolId, icon:"🧩", label:"دمج ملفات",   sub:"اجمع تسجيلات معاً",color:"from-indigo-500 to-indigo-700",bg:"hover:border-indigo-300 hover:bg-indigo-50/70 dark:hover:border-indigo-800" },
                    { id:"transcribe" as ToolId, icon:"📝", label:"استخراج النص", sub:"نسخ التلاوة كتابةً", color:"from-teal-500 to-teal-700",bg:"hover:border-teal-300 hover:bg-teal-50/70 dark:hover:border-teal-800" },
                    { id:"cleanup" as ToolId, icon:"✨", label:"تنظيف تلقائي", sub:"بضغطة واحدة",      color:"from-emerald-500 to-emerald-700",bg:"hover:border-emerald-300 hover:bg-emerald-50/70 dark:hover:border-emerald-800" },
                  ].map(t => (
                    <button key={t.id}
                      onClick={() => selectTool(t.id)}
                      disabled={anyBusy}
                      className={`relative flex items-center gap-3 p-3 rounded-2xl border-2 border-transparent bg-white dark:bg-slate-900 transition-all disabled:opacity-40 active:scale-[0.98] text-left ${t.bg} shadow-sm`}
                    >
                      {t.badge && (
                        <span className="absolute -top-2 -right-2 text-xs bg-violet-600 text-white px-1.5 py-0.5 rounded-full font-bold leading-none">
                          ★
                        </span>
                      )}
                      <div className={`w-9 h-9 rounded-xl bg-gradient-to-br ${t.color} flex items-center justify-center flex-shrink-0 shadow-sm`}>
                        <span className="text-base leading-none">{t.icon}</span>
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-bold text-slate-800 dark:text-slate-200 leading-tight">{t.label}</p>
                        <p className="text-xs text-slate-400 mt-0.5">{t.sub}</p>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* ─ TOOL ACTIVE — sub-navigation ─────────────────────────────── */}
            {activeTool && (
              <>
                {/* Sub-tabs only when needed */}
                {["trim","silence","cleanup"].includes(activeTool) && (
                  <div className="flex gap-1 p-1 bg-slate-100 dark:bg-slate-800/80 rounded-2xl">
                    {[
                      {id:"silence" as ToolId, icon:"🔇", label:"إزالة الصمت"},
                      {id:"trim"    as ToolId, icon:"✂",  label:"تقطيع يدوي"},
                      {id:"cleanup" as ToolId, icon:"✨",  label:"تنظيف تلقائي"},
                    ].map(t => (
                      <button key={t.id} onClick={() => selectTool(t.id)} disabled={anyBusy}
                        className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-semibold rounded-xl transition-all ${
                          activeTool === t.id
                            ? "bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 shadow-sm"
                            : "text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
                        }`}>
                        <span>{t.icon}</span><span>{t.label}</span>
                      </button>
                    ))}
                  </div>
                )}

                {["eq","clarity","compression"].includes(activeTool) && (
                  <div className="flex gap-1 p-1 bg-slate-100 dark:bg-slate-800/80 rounded-2xl">
                    {[
                      {id:"eq"          as ToolId, icon:"🎚", label:"معادل الصوت"},
                      {id:"clarity"     as ToolId, icon:"⚡", label:"تحسين الوضوح"},
                      {id:"compression" as ToolId, icon:"📦", label:"ضغط الصوت"},
                    ].map(t => (
                      <button key={t.id} onClick={() => selectTool(t.id)} disabled={anyBusy}
                        className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-semibold rounded-xl transition-all ${
                          activeTool === t.id
                            ? "bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 shadow-sm"
                            : "text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
                        }`}>
                        <span>{t.icon}</span><span>{t.label}</span>
                      </button>
                    ))}
                  </div>
                )}

                {/* ─ WORKSPACE PANEL ──────────────────────────────────────── */}
                <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
                  {/* Header */}
                  <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 dark:border-slate-800">
                    {/* ← رجوع للقائمة الرئيسية */}
                    <button
                      onClick={() => setActiveTool(null)}
                      className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 transition-colors group"
                      title="العودة للقائمة الرئيسية"
                    >
                      <span className="text-lg leading-none group-hover:-translate-x-0.5 transition-transform inline-block">←</span>
                      <span className="font-medium">رجوع</span>
                    </button>

                    {/* Tool title */}
                    <div className="flex items-center gap-2">
                      <span className="text-base leading-none">
                        {activeTool==="trim"?"✂":activeTool==="silence"?"🔇":activeTool==="cleanup"?"✨":activeTool==="eq"?"🎚":activeTool==="clarity"?"⚡":activeTool==="compression"?"📦":activeTool==="transcribe"?"📝":"🧩"}
                      </span>
                      <p className="text-sm font-bold text-slate-800 dark:text-slate-200">
                        {activeTool==="trim"?"التقطيع اليدوي":activeTool==="silence"?"إزالة الصمت":activeTool==="cleanup"?"التنظيف التلقائي":activeTool==="eq"?"معادل الصوت":activeTool==="clarity"?"تحسين وضوح الكلام":activeTool==="compression"?"ضغط وتوازن الصوت":activeTool==="transcribe"?"استخراج النص":"دمج الملفات"}
                      </p>
                    </div>

                    {/* × close */}
                    <button
                      onClick={() => setActiveTool(null)}
                      className="w-7 h-7 flex items-center justify-center rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-all"
                      title="إغلاق"
                    >
                      <X className="w-4 h-4"/>
                    </button>
                  </div>
                  <div className="p-5">
                    {renderWorkspace()}
                  </div>
                </div>
              </>
            )}

            {/* Guided link */}
            <p className="text-center text-xs text-slate-400 pb-1">
              مستخدم جديد؟{" "}
              <a href="/guided" className="text-blue-500 hover:text-blue-600 font-medium">
                جرّب وضع الصلاة المبسّط ←
              </a>
            </p>

          </div>
        )}

      </div>
    </div>
  );
}