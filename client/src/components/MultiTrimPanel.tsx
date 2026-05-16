/**
 * MultiTrimPanel — دمج وتقطيع ملفات متعددة
 * الإصلاحات:
 * - قبول MP3/M4A/AAC بالامتداد لا MIME type (إصلاح Windows)
 * - معاينة كل ملف قبل الدمج
 * - export panel بـ WAV/MP3 128k/192k
 * - شريط الوقت mm:ss.d
 * - selection action bar أسفل كل موجة
 * - سجل تلقائي في localStorage
 */

import { useState, useRef, useCallback, useEffect } from "react";
import {
  Upload, Download, Trash2, ChevronUp, ChevronDown,
  Merge, CheckCircle, AlertCircle, RotateCcw, GripVertical,
} from "lucide-react";
import { AudioTrimmerEngine } from "./AudioTrimmerEngine";
import { AudioExporter } from "./AudioExporter";
import WaveformEditor from "./WaveformEditor";
import { toast } from "sonner";

// ─── Types ────────────────────────────────────────────────────────────────────

type FileStatus = "loading" | "ready" | "trimmed" | "error";

interface FileEntry {
  id:              string;
  file:            File;
  objectUrl:       string;
  status:          FileStatus;
  buffer:          AudioBuffer | null;
  processedBuffer: AudioBuffer | null;
  duration:        number;
}

interface MultiTrimPanelProps {
  onUseInPlayer: (blob: Blob, fileName: string) => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const uid  = () => Math.random().toString(36).slice(2, 9);
const fmtMs = (t: number) => {
  if (!t || !isFinite(t)) return "0:00.0";
  return `${Math.floor(t/60)}:${Math.floor(t%60).toString().padStart(2,"0")}.${Math.floor((t%1)*10)}`;
};

// ✅ إصلاح رئيسي — يقبل الملفات بالامتداد أو MIME أو الاثنين
const AUDIO_EXT = /\.(mp3|mp4|wav|ogg|m4a|aac|webm|flac|opus|mka|wma|aiff|aif)$/i;
const AUDIO_MIME = /^audio\//;
const isAudioFile = (f: File) =>
  AUDIO_MIME.test(f.type) ||   // MIME type صريح
  AUDIO_EXT.test(f.name) ||    // امتداد معروف
  f.size > 0;                  // fallback — نحاول تحميل أي ملف ونُفشل بشكل ناعم

const GAP_OPTIONS = [0, 0.5, 1, 2] as const;
type GapSec = typeof GAP_OPTIONS[number];

// ─── Component ────────────────────────────────────────────────────────────────

export default function MultiTrimPanel({ onUseInPlayer }: MultiTrimPanelProps) {
  const [entries, setEntries]           = useState<FileEntry[]>([]);
  const [mergeGap, setMergeGap]         = useState<GapSec>(0.5);
  const [crossfade, setCrossfade]       = useState(0.04);
  const [isMerging, setIsMerging]       = useState(false);
  const [mergeProgress, setMergeProgress] = useState(0);
  const [dragOver, setDragOver]         = useState(false);
  const [activeId, setActiveId]         = useState<string | null>(null);

  // Export panel
  const [showExport, setShowExport]     = useState(false);
  const [exportFmt, setExportFmt]       = useState<"wav"|"mp3">("mp3");
  const [exportBr, setExportBr]         = useState<128|192>(128);
  const [isExporting, setIsExporting]   = useState(false);
  const [mergedBuffer, setMergedBuffer] = useState<AudioBuffer | null>(null);

  // ── Silence removal per file ─────────────────────────────────────────────
  // القيم المثلى المُختبَرة للصلاة
  const SILENCE_THRESHOLD = -20;
  const SILENCE_MIN_DUR   = 5;
  const SILENCE_GAP       = 5;
  const [removingSilenceId, setRemovingSilenceId] = useState<string | null>(null);

  // ── Silence analysis state — per entry ─────────────────────────────────────
  type SilSeg = { id: string; startSec: number; endSec: number; durationSec: number; enabled: boolean; };
  const [silenceAnalysis, setSilenceAnalysis] = useState<Record<string, SilSeg[]>>({});
  const [analyzingId, setAnalyzingId] = useState<string | null>(null);
  const [silencePreviewId, setSilencePreviewId] = useState<string | null>(null);
  const silPreviewCtx = useRef<AudioContext | null>(null);
  const silPreviewSrc = useRef<AudioBufferSourceNode | null>(null);

  // Per-file player
  const [playerTimes, setPlayerTimes]   = useState<Record<string, number>>({});
  const playerRefs = useRef<Record<string, HTMLAudioElement | null>>({});

  // Preview
  const previewCtxRef = useRef<AudioContext | null>(null);
  const previewSrcRef = useRef<AudioBufferSourceNode | null>(null);
  const [previewingId, setPreviewingId] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Cleanup ───────────────────────────────────────────────────────────────

  useEffect(() => () => {
    try { previewSrcRef.current?.stop(); } catch {}
    previewCtxRef.current?.close().catch(() => {});
    entries.forEach(e => URL.revokeObjectURL(e.objectUrl));
  }, []); // eslint-disable-line

  // ── Load files ────────────────────────────────────────────────────────────

  const loadFiles = useCallback(async (files: File[]) => {
    const candidates = Array.from(files).filter(f =>
      AUDIO_MIME.test(f.type) || AUDIO_EXT.test(f.name) || f.type === ""
    );
    if (candidates.length === 0) {
      toast.error("لم يُعثر على ملفات — اختر ملفات MP3 أو WAV أو M4A");
      return;
    }

    // ── Lazy loading: اقرأ duration فقط بدون decode كامل ────────────────────
    const getDurationFast = (objectUrl: string): Promise<number> =>
      new Promise(resolve => {
        const a = new Audio();
        a.preload = "metadata";
        a.onloadedmetadata = () => { resolve(a.duration || 0); a.src = ""; };
        a.onerror = () => resolve(0);
        a.src = objectUrl;
      });

    const newEntries: FileEntry[] = candidates.map(f => ({
      id: uid(), file: f,
      objectUrl: URL.createObjectURL(f),
      status: "loading",
      buffer: null, processedBuffer: null, duration: 0,
    }));

    setEntries(prev => [...prev, ...newEntries]);

    // حمّل duration لكل ملف بشكل متوازٍ — سريع جداً
    await Promise.all(newEntries.map(async entry => {
      try {
        const dur = await getDurationFast(entry.objectUrl);
        if (dur > 0) {
          setEntries(prev => prev.map(e =>
            e.id === entry.id ? { ...e, status: "ready", duration: dur } : e
          ));
        } else {
          // إذا فشل HTML Audio في قراءة duration — نُجرّب decode كامل
          const buf = await AudioTrimmerEngine.loadBuffer(entry.objectUrl);
          setEntries(prev => prev.map(e =>
            e.id === entry.id ? { ...e, buffer: buf, status: "ready", duration: buf.duration } : e
          ));
        }
      } catch {
        setEntries(prev => prev.map(e =>
          e.id === entry.id ? { ...e, status: "error" } : e
        ));
        setTimeout(() => {
          setEntries(prev => prev.filter(e => !(e.id === entry.id && e.status === "error")));
          URL.revokeObjectURL(entry.objectUrl);
        }, 2000);
        toast.error(`تعذّر فتح: ${entry.file.name}`);
      }
    }));
  }, []);

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    loadFiles(Array.from(e.target.files ?? []));
    e.target.value = "";
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragOver(false);
    loadFiles(Array.from(e.dataTransfer.files));
  };

  // ── Reorder ───────────────────────────────────────────────────────────────

  const move = (id: string, dir: -1 | 1) => {
    setEntries(prev => {
      const i = prev.findIndex(e => e.id === id);
      if (i < 0) return prev;
      const j = i + dir;
      if (j < 0 || j >= prev.length) return prev;
      const arr = [...prev];
      [arr[i], arr[j]] = [arr[j], arr[i]];
      return arr;
    });
  };

  // ── Remove ────────────────────────────────────────────────────────────────

  const removeEntry = (id: string) => {
    setEntries(prev => {
      const e = prev.find(x => x.id === id);
      if (e) URL.revokeObjectURL(e.objectUrl);
      return prev.filter(x => x.id !== id);
    });
    const el = playerRefs.current[id];
    if (el) { el.pause(); el.src = ""; }
    delete playerRefs.current[id];
    setPlayerTimes(prev => { const n = {...prev}; delete n[id]; return n; });
    if (activeId === id) setActiveId(null);
  };

  // ── Preview ───────────────────────────────────────────────────────────────

  const stopPreview = useCallback(() => {
    try { previewSrcRef.current?.stop(); } catch {}
    previewSrcRef.current = null;
    previewCtxRef.current?.close().catch(() => {});
    previewCtxRef.current = null;
    setPreviewingId(null);
  }, []);

  const playEntry = (entry: FileEntry) => {
    if (previewingId === entry.id) { stopPreview(); return; }
    stopPreview();
    const buf = entry.processedBuffer ?? entry.buffer;
    if (!buf) return;
    try {
      const ctx = new AudioContext();
      previewCtxRef.current = ctx;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(ctx.destination);
      src.start(0);
      previewSrcRef.current = src;
      setPreviewingId(entry.id);
      src.onended = () => { if (previewSrcRef.current === src) stopPreview(); };
    } catch { toast.error("فشل تشغيل المعاينة"); }
  };

  // ── Reset edit ────────────────────────────────────────────────────────────

  const resetEdit = (id: string) => {
    setEntries(prev => prev.map(e => {
      if (e.id !== id || !e.buffer) return e;
      return { ...e, processedBuffer: null, status: "ready", duration: e.buffer.duration };
    }));
    toast.success("تمت إعادة التعيين");
  };

  // ── Merge ─────────────────────────────────────────────────────────────────

  // ── 1. تحليل الصمت — streaming للملفات الكبيرة، عادي للصغيرة ──────────────
  const MAX_DIRECT_DURATION_MIN = 60;

  const handleAnalyzeSilence = async (entryId: string) => {
    const entrySnap = entries.find(e => e.id === entryId);
    if (!entrySnap) return;

    setAnalyzingId(entryId);

    // ── 1. تحميل الـ buffer إذا لم يُحمَّل (لعرض الموجة) ──────────────────
    let buf = entrySnap.processedBuffer ?? entrySnap.buffer;
    if (!buf) {
      const dMin = entrySnap.duration / 60;
      const isLargeFile = dMin > MAX_DIRECT_DURATION_MIN || entrySnap.file.size > 200 * 1024 * 1024;
      if (!isLargeFile) {
        // حمّل الـ buffer للملفات الصغيرة لعرض الموجة
        try {
          buf = await AudioTrimmerEngine.loadBuffer(entrySnap.objectUrl);
          setEntries(prev => prev.map(e =>
            e.id === entryId ? { ...e, buffer: buf!, status: "ready" } : e
          ));
        } catch { /* نكمل بدون موجة */ }
      }
    }

    // ── 2. افتح الـ panel ───────────────────────────────────────────────────
    setActiveId(entryId);

    try {
      const { SilenceProcessor } = await import("./SilenceProcessor");
      const durationMin = entrySnap.duration / 60;
      const isLarge = durationMin > MAX_DIRECT_DURATION_MIN ||
                      entrySnap.file.size > 200 * 1024 * 1024;

      let segs: SilSeg[];

      if (isLarge) {
        toast(`🔍 ملف طويل (${Math.round(durationMin)} دقيقة) — جاري التحليل بوضع الـ streaming...`, { duration: 4000 });
        const result = await SilenceProcessor.detectSilenceStreaming(
          entrySnap.objectUrl,
          { thresholdDb: SILENCE_THRESHOLD, minSilenceDuration: SILENCE_MIN_DUR, replacementGap: SILENCE_GAP },
          () => {}
        );
        segs = result.segments.map((s, i) => ({
          id: `sil_${entryId}_${i}`, startSec: s.startSec,
          endSec: s.endSec, durationSec: s.durationSec, enabled: true,
        }));
      } else {
        const result = await SilenceProcessor.process(
          entrySnap.objectUrl,
          { thresholdDb: SILENCE_THRESHOLD, minSilenceDuration: SILENCE_MIN_DUR, replacementGap: SILENCE_GAP },
          () => {}
        );
        segs = (result.report.removedSegments ?? []).map((s, i) => ({
          id: `sil_${entryId}_${i}`, startSec: s.startSec,
          endSec: s.endSec, durationSec: s.durationSec ?? (s.endSec - s.startSec), enabled: true,
        }));
      }

      setSilenceAnalysis(prev => ({ ...prev, [entryId]: segs }));
      if (segs.length === 0) toast(`${entrySnap.file.name}: لم يُعثر على صمت`);
      else toast.success(`🔍 اكتُشف ${segs.length} فترة صمت — راجعها ثم احذف ما تريد`);

    } catch (err) {
      console.error(err);
      toast.error("فشل التحليل — تأكد أن الملف صوتي صالح");
    } finally {
      setAnalyzingId(null);
    }
  };

  // ── 2. تطبيق الحذف للفترات المُحددة ─────────────────────────────────────
  const handleApplySilenceForEntry = async (entryId: string) => {
    const segs = silenceAnalysis[entryId]?.filter(s => s.enabled) ?? [];
    if (segs.length === 0) { toast.error("لم تُحدّد أي فترة صمت للحذف"); return; }
    const entrySnap = entries.find(e => e.id === entryId);
    if (!entrySnap) return;
    setRemovingSilenceId(entryId);
    try {
      let buf = entrySnap.processedBuffer ?? entrySnap.buffer;
      if (!buf) { buf = await AudioTrimmerEngine.loadBuffer(entrySnap.objectUrl); }
      // احذف من الأكبر للأصغر لتجنب انزياح timestamps
      const sorted = [...segs].sort((a,b) => b.startSec - a.startSec);
      let out = buf;
      for (const seg of sorted) {
        out = await AudioTrimmerEngine.deleteRange(out, seg.startSec, seg.endSec, 0.05, 0.02);
      }
      const newUrl = URL.createObjectURL(AudioTrimmerEngine.toWav(out));
      setTimeout(() => URL.revokeObjectURL(entrySnap.objectUrl), 500);
      setEntries(prev => prev.map(e => e.id===entryId
        ? {...e, buffer:out, processedBuffer:out, duration:out.duration, objectUrl:newUrl, status:"trimmed"}
        : e
      ));
      setSilenceAnalysis(prev => { const n={...prev}; delete n[entryId]; return n; });
      toast.success(`✓ حُذف ${segs.length} فترة صمت — المقطع جاهز للتعديل اليدوي`);
    } catch(err) { console.error(err); toast.error("فشل الحذف"); }
    finally { setRemovingSilenceId(null); }
  };

  // ── preview فترة صمت ──────────────────────────────────────────────────────
  const previewSilenceSegment = (entryId: string, seg: SilSeg) => {
    try { silPreviewSrc.current?.stop(); } catch {}
    silPreviewCtx.current?.close().catch(() => {});
    if (silencePreviewId === seg.id) { setSilencePreviewId(null); return; }
    const entrySnap = entries.find(e => e.id === entryId);
    const buf = entrySnap?.processedBuffer ?? entrySnap?.buffer;
    if (!buf) return;
    const ctx = new AudioContext();
    silPreviewCtx.current = ctx;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    const pad = 0.5;
    src.start(0, Math.max(0, seg.startSec - pad), (seg.endSec - seg.startSec) + pad * 2);
    silPreviewSrc.current = src;
    setSilencePreviewId(seg.id);
    src.onended = () => { setSilencePreviewId(null); ctx.close().catch(()=>{}); };
  };

  const handleMerge = async () => {
    const allEntries = entries.filter(e => e.status === "ready" || e.status === "trimmed");
    if (allEntries.length < 1) { toast.error("أضف ملفاً واحداً على الأقل"); return; }

    setIsMerging(true); setMergeProgress(5);
    try {
      // decode أي ملف لم يُحمَّل بعد (lazy loading)
      const buffers: AudioBuffer[] = [];
      for (let i = 0; i < allEntries.length; i++) {
        const e = allEntries[i];
        setMergeProgress(Math.round(5 + (i / allEntries.length) * 60));
        let buf = e.processedBuffer ?? e.buffer;
        if (!buf) {
          buf = await AudioTrimmerEngine.loadBuffer(e.objectUrl);
          setEntries(prev => prev.map(x =>
            x.id === e.id ? { ...x, buffer: buf! } : x
          ));
        }
        buffers.push(buf);
      }
      setMergeProgress(70);
      const merged = buffers.length === 1
        ? buffers[0]
        : await AudioTrimmerEngine.mergeBuffersWithFade(buffers, mergeGap, crossfade);
      setMergeProgress(90);
      setMergedBuffer(merged);
      setShowExport(true);
      toast.success(`✓ ${ready.length > 1 ? `تم دمج ${ready.length} ملفات` : "الملف جاهز للتصدير"}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "فشل الدمج");
    } finally {
      setIsMerging(false); setMergeProgress(0);
    }
  };

  // ── Export ────────────────────────────────────────────────────────────────

  const handleExport = async () => {
    if (!mergedBuffer) return;
    setIsExporting(true);
    try {
      let blob: Blob;
      let fname: string;
      const base = entries.length === 1
        ? entries[0].file.name.replace(/\.[^.]+$/, "")
        : `merged-${entries.length}files`;

      if (exportFmt === "wav") {
        blob  = AudioTrimmerEngine.toWav(mergedBuffer);
        fname = `${base}.wav`;
      } else {
        try {
          blob  = await AudioExporter.toMp3(mergedBuffer, exportBr);
          fname = `${base}-${exportBr}k.mp3`;
        } catch {
          blob  = AudioTrimmerEngine.toWav(mergedBuffer);
          fname = `${base}.wav`;
          toast.error("تعذّر تصدير MP3 — تم تحميل WAV بدلاً منه");
        }
      }
      const url = URL.createObjectURL(blob);
      const a   = document.createElement("a");
      a.href = url; a.download = fname;
      document.body.appendChild(a); a.click();
      document.body.removeChild(a); URL.revokeObjectURL(url);
      onUseInPlayer(blob, fname);
      toast.success(`✓ تم التحميل: ${fname}`);
    } catch { toast.error("فشل التصدير"); }
    finally { setIsExporting(false); }
  };

  // ── Render ────────────────────────────────────────────────────────────────

  const readyCount = entries.filter(e => e.status === "ready" || e.status === "trimmed").length;
  const totalDur   = entries.reduce((s, e) => s + (e.processedBuffer?.duration ?? e.buffer?.duration ?? 0), 0);

  return (
    <div className="space-y-4">

      {/* ── Drop zone ─────────────────────────────────────────────────── */}
      <div
        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        className={`border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition-all ${
          dragOver
            ? "border-indigo-400 bg-indigo-50 dark:bg-indigo-950/40"
            : entries.length === 0
              ? "border-slate-300 dark:border-slate-600 hover:border-indigo-400 hover:bg-indigo-50/30"
              : "border-slate-200 dark:border-slate-700 hover:border-indigo-300 py-4"
        }`}
      >
        <Upload className={`mx-auto text-slate-400 mb-2 ${entries.length ? "w-4 h-4" : "w-8 h-8"}`}/>
        <p className={`font-medium text-slate-600 dark:text-slate-400 ${entries.length ? "text-xs" : "text-sm"}`}>
          {dragOver ? "أفلت الملفات هنا ✓" : entries.length ? "+ أضف المزيد من الملفات" : "اسحب ملفاتك هنا أو انقر للاختيار"}
        </p>
        {entries.length === 0 && (
          <>
            <p className="text-xs text-slate-400 mt-1 font-medium">MP3 · WAV · M4A · OGG · AAC</p>
            <p className="text-xs text-slate-300 dark:text-slate-600 mt-1">
              تلميح: يمكنك اختيار ملفات متعددة دفعة واحدة بالضغط على Ctrl أثناء الاختيار
            </p>
          </>
        )}
        <input
          ref={fileInputRef} type="file"
          accept="audio/mpeg,audio/mp3,audio/wav,audio/x-wav,audio/ogg,audio/mp4,audio/x-m4a,audio/aac,audio/webm,audio/flac,audio/opus,.mp3,.wav,.ogg,.m4a,.aac,.webm,.flac,.opus,.mp4"
          multiple className="hidden"
          onChange={handleFileInput}
        />
      </div>

      {/* ── File list ─────────────────────────────────────────────────── */}
      {entries.length > 0 && (
        <div className="space-y-2">
          {/* Stats bar */}
          <div className="flex items-center justify-between text-xs text-slate-500 px-1">
            <span>{readyCount} ملف جاهز</span>
            {totalDur > 0 && (
              <span className="font-mono">
                المجموع: {fmtMs(totalDur + mergeGap * Math.max(0, readyCount - 1))}
              </span>
            )}
          </div>

          {entries.map((entry, idx) => {
            const isActive = activeId === entry.id;
            const isPrev   = previewingId === entry.id;
            const buf      = entry.processedBuffer ?? entry.buffer;

            return (
              <div key={entry.id}
                className={`rounded-2xl border overflow-hidden transition-all ${
                  isActive
                    ? "border-indigo-400 dark:border-indigo-600 shadow-sm shadow-indigo-100 dark:shadow-none"
                    : "border-slate-200 dark:border-slate-700"
                }`}>

                {/* File row */}
                <div className={`flex items-center gap-2 px-3 py-2.5 ${
                  isActive ? "bg-indigo-50 dark:bg-indigo-950/30" : "bg-slate-50 dark:bg-slate-800/60"
                }`}>
                  {/* Drag handle / index */}
                  <span className="text-xs font-mono text-slate-400 w-5 text-center flex-shrink-0 select-none">
                    {idx + 1}
                  </span>

                  {/* Status */}
                  <span className="flex-shrink-0">
                    {entry.status === "loading" && (
                      <div className="w-3.5 h-3.5 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin"/>
                    )}
                    {entry.status === "ready"   && <CheckCircle className="w-3.5 h-3.5 text-slate-400"/>}
                    {entry.status === "trimmed" && <CheckCircle className="w-3.5 h-3.5 text-emerald-500"/>}
                    {entry.status === "error"   && <AlertCircle className="w-3.5 h-3.5 text-red-500"/>}
                  </span>

                  {/* Name + duration */}
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-slate-700 dark:text-slate-300 truncate">
                      {entry.file.name}
                    </p>
                    {entry.duration > 0 && (
                      <p className="text-xs font-mono text-slate-400 tabular-nums">
                        {entry.status === "trimmed" ? "✂ " : ""}{fmtMs(entry.duration)}
                        {entry.duration > 60 * 60 && (
                          <span className="mr-1.5 text-amber-500 font-sans font-medium not-italic">
                            · قطّع أولاً
                          </span>
                        )}
                      </p>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1 flex-shrink-0">
                    {/* ▶ Preview */}
                    {buf && (
                      <button onClick={() => playEntry(entry)}
                        className={`w-7 h-7 flex items-center justify-center rounded-lg text-xs transition-all ${
                          isPrev
                            ? "bg-emerald-600 text-white"
                            : "bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-600 text-slate-500 hover:border-emerald-400 hover:text-emerald-600"
                        }`}
                        title={isPrev ? "إيقاف" : "استمع للملف"}>
                        {isPrev ? "⏹" : "▶"}
                      </button>
                    )}

                    {/* ✂ Edit — يُحمّل الـ buffer إذا لم يكن محمّلاً */}
                    {(entry.status === "ready" || entry.status === "trimmed") && (
                      <button onClick={async () => {
                        if (isActive) { setActiveId(null); return; }
                        // decode on-demand إذا لم يكن buffer محمّلاً بعد
                        if (!entry.buffer && !entry.processedBuffer) {
                          setEntries(prev => prev.map(e =>
                            e.id === entry.id ? { ...e, status: "loading" } : e
                          ));
                          try {
                            const buf = await AudioTrimmerEngine.loadBuffer(entry.objectUrl);
                            setEntries(prev => prev.map(e =>
                              e.id === entry.id ? { ...e, buffer: buf, status: "ready" } : e
                            ));
                          } catch {
                            toast.error(`تعذّر فتح: ${entry.file.name}`);
                            setEntries(prev => prev.map(e =>
                              e.id === entry.id ? { ...e, status: "ready" } : e
                            ));
                            return;
                          }
                        }
                        setActiveId(entry.id);
                      }}
                        className={`px-2 py-1 text-xs rounded-lg transition-all ${
                          isActive
                            ? "bg-indigo-600 text-white"
                            : "bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-600 text-slate-600 hover:border-indigo-400"
                        }`}>
                        ✂ تقطيع
                      </button>
                    )}

                    {/* 🔇 تحليل الصمت — يفتح الموجة ويُظهر فترات الصمت */}
                    {(entry.status === "ready" || entry.status === "trimmed") && (() => {
                      const durationMin = entry.duration / 60;
                      const isLarge = durationMin > 60 || entry.file.size > 200 * 1024 * 1024;
                      return (
                        <button
                          onClick={() => handleAnalyzeSilence(entry.id)}
                          disabled={analyzingId === entry.id || removingSilenceId === entry.id}
                          className="flex items-center gap-1 px-2 py-1 text-xs rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-600 text-violet-600 hover:border-violet-400 hover:bg-violet-50 dark:hover:bg-violet-950/30 transition-all disabled:opacity-50"
                          title={isLarge
                            ? `تحليل الصمت بوضع الـ streaming (${Math.round(durationMin)} دقيقة)`
                            : "تحليل الصمت وعرضه قبل الحذف"}>
                          {analyzingId === entry.id
                            ? <div className="w-3 h-3 border border-violet-500 border-t-transparent rounded-full animate-spin"/>
                            : isLarge ? "🌊" : "🔇"}
                          <span>{analyzingId === entry.id ? "..." : "صمت"}</span>
                        </button>
                      );
                    })()}

                    {/* ↺ Reset */}
                    {entry.status === "trimmed" && (
                      <button onClick={() => resetEdit(entry.id)}
                        className="w-7 h-7 flex items-center justify-center rounded-lg text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950/40 transition-all"
                        title="تراجع عن التقطيع">
                        <RotateCcw className="w-3.5 h-3.5"/>
                      </button>
                    )}

                    {/* Reorder */}
                    <div className="flex flex-col gap-0.5">
                      <button onClick={() => move(entry.id, -1)} disabled={idx === 0}
                        className="w-5 h-4 flex items-center justify-center text-slate-400 hover:text-slate-700 disabled:opacity-20">
                        <ChevronUp className="w-3 h-3"/>
                      </button>
                      <button onClick={() => move(entry.id, 1)} disabled={idx === entries.length - 1}
                        className="w-5 h-4 flex items-center justify-center text-slate-400 hover:text-slate-700 disabled:opacity-20">
                        <ChevronDown className="w-3 h-3"/>
                      </button>
                    </div>

                    {/* 🗑 Remove */}
                    <button onClick={() => removeEntry(entry.id)}
                      className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40 transition-all"
                      title="حذف الملف">
                      <Trash2 className="w-3.5 h-3.5"/>
                    </button>
                  </div>
                </div>

                {/* Edit panel — يفتح عند الضغط على تقطيع أو صمت */}
                {isActive && (
                  <div className="border-t border-slate-200 dark:border-slate-700">
                    {/* Mini player — دائماً */}
                    <audio
                      ref={el => { playerRefs.current[entry.id] = el; }}
                      src={entry.objectUrl}
                      onTimeUpdate={e => setPlayerTimes(prev => ({...prev, [entry.id]: e.currentTarget.currentTime}))}
                      className="hidden"
                    />
                    <div className="flex items-center gap-2 px-3 py-2 bg-indigo-50/50 dark:bg-indigo-950/20">
                      <button
                        onClick={() => { const el = playerRefs.current[entry.id]; el && (el.paused ? el.play() : el.pause()); }}
                        className="w-8 h-8 rounded-full bg-indigo-600 hover:bg-indigo-500 text-white flex items-center justify-center flex-shrink-0 text-xs">
                        ▶
                      </button>
                      <span className="font-mono text-xs text-slate-500 tabular-nums">
                        {fmtMs(playerTimes[entry.id] ?? 0)} / {fmtMs(entry.duration)}
                      </span>
                      <input type="range" min={0} max={entry.duration || 1} step={0.05}
                        value={playerTimes[entry.id] ?? 0}
                        onChange={e => {
                          const t = parseFloat(e.target.value);
                          setPlayerTimes(prev => ({...prev, [entry.id]: t}));
                          const el = playerRefs.current[entry.id];
                          if (el) el.currentTime = t;
                        }}
                        className="flex-1 h-1 accent-indigo-500"/>
                      {[0.5, 1, 1.5, 2].map(s => (
                        <button key={s} onClick={() => { const el = playerRefs.current[entry.id]; if(el) el.playbackRate = s; }}
                          className="px-1.5 py-0.5 text-xs rounded font-mono bg-slate-100 dark:bg-slate-800 text-slate-500 hover:bg-indigo-100 dark:hover:bg-indigo-950">
                          {s}×
                        </button>
                      ))}
                    </div>

                    {/* WaveformEditor — فقط عند توفر الـ buffer */}
                    {buf ? (
                      <>
                        <WaveformEditor
                          audioBuffer={buf}
                          currentTime={playerTimes[entry.id] ?? 0}
                          waveColor="#818cf8"
                          selectionColor="#6366f1"
                          height={72}
                          editableRanges={
                            (silenceAnalysis[entry.id] ?? [])
                              .filter(s => s.enabled)
                              .map(s => ({ id: s.id, startSec: s.startSec, endSec: s.endSec, label: "🔇", color: "#ef4444" }))
                          }
                          onDeleteRange={async (s, e) => {
                            try {
                              const out = await AudioTrimmerEngine.deleteRange(buf, s, e, 0.05, 0.02);
                              setEntries(prev => prev.map(en => en.id === entry.id
                                ? {...en, processedBuffer: out, status: "trimmed", duration: out.duration} : en));
                              toast.success(`✓ حُذف ${fmtMs(e-s)}`);
                            } catch { toast.error("فشل الحذف"); }
                          }}
                          onCropToRange={async (s, e) => {
                            try {
                              const out = await AudioTrimmerEngine.trimWithFade(buf, s, e, crossfade);
                              setEntries(prev => prev.map(en => en.id === entry.id
                                ? {...en, processedBuffer: out, status: "trimmed", duration: out.duration} : en));
                              toast.success(`✓ اقتُصر على ${fmtMs(e-s)}`);
                            } catch { toast.error("فشل الاقتصاص"); }
                          }}
                          onSeek={t => {
                            setPlayerTimes(prev => ({...prev, [entry.id]: t}));
                            const el = playerRefs.current[entry.id];
                            if (el) el.currentTime = t;
                          }}
                        />
                        {/* Crossfade control */}
                        <div className="flex items-center gap-2 px-3 py-2 border-t border-slate-100 dark:border-slate-800">
                          <span className="text-xs text-slate-400">انتقال ناعم:</span>
                          {[{v:0,l:"لا"},{v:0.02,l:"20ms"},{v:0.05,l:"50ms"}].map(o => (
                            <button key={o.v} onClick={() => setCrossfade(o.v)}
                              className={`px-2 py-0.5 text-xs rounded-lg transition-all ${
                                crossfade===o.v?"bg-indigo-600 text-white":"bg-slate-100 dark:bg-slate-800 text-slate-500"
                              }`}>
                              {o.l}
                            </button>
                          ))}
                        </div>
                      </>
                    ) : (
                      /* لا buffer — رسالة توضيحية مع زر تحميل */
                      <div className="px-4 py-3 bg-slate-50 dark:bg-slate-800/50 text-center">
                        {analyzingId === entry.id ? (
                          <p className="text-xs text-violet-600 dark:text-violet-400 flex items-center justify-center gap-2">
                            <div className="w-3 h-3 border border-violet-500 border-t-transparent rounded-full animate-spin"/>
                            جاري تحليل الصمت...
                          </p>
                        ) : (
                          <p className="text-xs text-slate-400">
                            سيتم تحميل الموجة عند الحاجة للتقطيع اليدوي
                          </p>
                        )}
                      </div>
                    )}

                    {/* ── Silence Analysis Results ──────────────────────── */}
                    {silenceAnalysis[entry.id] && silenceAnalysis[entry.id].length > 0 && (
                      <div className="border-t border-violet-200 dark:border-violet-800 bg-violet-50/50 dark:bg-violet-950/20">
                        {/* Header */}
                        <div className="flex items-center justify-between px-3 py-2">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold text-violet-700 dark:text-violet-300">
                              🔇 فترات الصمت المكتشفة ({silenceAnalysis[entry.id].filter(s=>s.enabled).length}/{silenceAnalysis[entry.id].length})
                            </span>
                          </div>
                          <div className="flex gap-1.5">
                            <button
                              onClick={() => setSilenceAnalysis(prev => ({
                                ...prev,
                                [entry.id]: prev[entry.id].map(s => ({...s, enabled: true}))
                              }))}
                              className="text-xs px-2 py-0.5 rounded-lg bg-violet-100 dark:bg-violet-900 text-violet-700 dark:text-violet-300">
                              تحديد الكل
                            </button>
                            <button
                              onClick={() => setSilenceAnalysis(prev => ({
                                ...prev,
                                [entry.id]: prev[entry.id].map(s => ({...s, enabled: false}))
                              }))}
                              className="text-xs px-2 py-0.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-500">
                              إلغاء الكل
                            </button>
                            <button
                              onClick={() => setSilenceAnalysis(prev => { const n={...prev}; delete n[entry.id]; return n; })}
                              className="text-xs text-slate-400 hover:text-slate-600 px-1">
                              ✕
                            </button>
                          </div>
                        </div>

                        {/* Segment list */}
                        <div className="px-3 pb-2 max-h-44 overflow-y-auto space-y-1">
                          {silenceAnalysis[entry.id].map((seg, si) => (
                            <div key={seg.id}
                              className={`flex items-center gap-2 px-2.5 py-1.5 rounded-xl border text-xs transition-all ${
                                seg.enabled
                                  ? "bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-800"
                                  : "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 opacity-60"
                              }`}>
                              {/* Checkbox */}
                              <button
                                onClick={() => setSilenceAnalysis(prev => ({
                                  ...prev,
                                  [entry.id]: prev[entry.id].map(s => s.id===seg.id ? {...s, enabled:!s.enabled} : s)
                                }))}
                                className={`flex-shrink-0 w-4 h-4 rounded border-2 flex items-center justify-center ${
                                  seg.enabled ? "bg-red-500 border-red-500" : "border-slate-300"
                                }`}>
                                {seg.enabled && <span className="text-white" style={{fontSize:"9px"}}>✓</span>}
                              </button>
                              {/* Number */}
                              <span className="text-slate-400 w-4 text-center">{si+1}</span>
                              {/* Time */}
                              <span className="font-mono text-slate-600 dark:text-slate-400 flex-1">
                                {fmtMs(seg.startSec)} → {fmtMs(seg.endSec)}
                              </span>
                              {/* Duration */}
                              <span className="font-mono text-slate-400 flex-shrink-0">
                                {fmtMs(seg.durationSec)}
                              </span>
                              {/* ▶ Preview */}
                              <button
                                onClick={() => previewSilenceSegment(entry.id, seg)}
                                className={`flex-shrink-0 w-6 h-6 flex items-center justify-center rounded-lg text-xs transition-all ${
                                  silencePreviewId === seg.id
                                    ? "bg-emerald-600 text-white"
                                    : "bg-slate-100 dark:bg-slate-800 text-slate-500 hover:bg-emerald-100 hover:text-emerald-600"
                                }`}>
                                {silencePreviewId === seg.id ? "⏹" : "▶"}
                              </button>
                            </div>
                          ))}
                        </div>

                        {/* Apply button */}
                        <div className="px-3 pb-3">
                          <button
                            onClick={() => handleApplySilenceForEntry(entry.id)}
                            disabled={removingSilenceId === entry.id || silenceAnalysis[entry.id].filter(s=>s.enabled).length === 0}
                            className={`w-full h-9 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all ${
                              removingSilenceId === entry.id || silenceAnalysis[entry.id].filter(s=>s.enabled).length === 0
                                ? "bg-slate-100 dark:bg-slate-800 text-slate-400 cursor-not-allowed"
                                : "bg-red-600 hover:bg-red-500 text-white"
                            }`}>
                            {removingSilenceId === entry.id
                              ? <><div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin"/>جاري الحذف...</>
                              : <>✂ حذف {silenceAnalysis[entry.id].filter(s=>s.enabled).length} فترة صمت محددة</>}
                          </button>
                          <p className="text-center text-xs text-slate-400 mt-1">
                            بعد الحذف يمكنك التعديل اليدوي على الموجة أعلاه
                          </p>
                        </div>
                      </div>
                    )}
                  </div>  {/* end edit panel */}
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Merge controls ────────────────────────────────────────────── */}
      {readyCount >= 1 && (
        <div className="space-y-3 pt-2 border-t border-slate-200 dark:border-slate-700">

          {/* Gap between files */}
          {readyCount > 1 && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-500 flex-shrink-0">فجوة بين الملفات:</span>
              <div className="flex gap-1 flex-1">
                {GAP_OPTIONS.map(g => (
                  <button key={g} onClick={() => setMergeGap(g)}
                    className={`flex-1 py-1.5 text-xs rounded-xl border transition-all ${
                      mergeGap===g
                        ? "bg-indigo-600 border-indigo-600 text-white"
                        : "border-slate-200 dark:border-slate-700 text-slate-600 hover:border-indigo-400"
                    }`}>
                    {g===0?"بلا":`${g}ث`}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Progress */}
          {isMerging && (
            <div className="space-y-1">
              <div className="h-1.5 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
                <div className="h-full bg-indigo-500 rounded-full transition-all" style={{width:`${mergeProgress}%`}}/>
              </div>
              <p className="text-xs text-slate-500 text-center">جاري الدمج...</p>
            </div>
          )}

          {/* Big merge button */}
          <button onClick={handleMerge} disabled={isMerging}
            className="w-full h-12 rounded-2xl bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-200 disabled:text-slate-400 text-white font-bold text-sm flex items-center justify-center gap-2 transition-all active:scale-[0.99]">
            {isMerging
              ? <><div className="w-5 h-5 border-2 border-indigo-200 border-t-transparent rounded-full animate-spin"/>جاري الدمج...</>
              : <><Merge className="w-4 h-4"/>{readyCount > 1 ? `دمج ${readyCount} ملفات` : "تصدير الملف"}</>}
          </button>
        </div>
      )}

      {/* ── Export panel ──────────────────────────────────────────────── */}
      {showExport && mergedBuffer && (
        <div className="bg-slate-50 dark:bg-slate-800/60 rounded-2xl border border-slate-200 dark:border-slate-700 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">
              💾 اختر صيغة الحفظ
            </p>
            <span className="font-mono text-xs text-slate-400">
              {fmtMs(mergedBuffer.duration)}
            </span>
          </div>

          {/* Format options */}
          {[
            { fmt:"wav" as const,  br:undefined, label:"WAV",     sub:"جودة أصلية — موثوق",
              size: ((mergedBuffer.length * mergedBuffer.numberOfChannels * 2 + 44)/(1024*1024)).toFixed(1) },
            { fmt:"mp3" as const,  br:128,       label:"MP3 128k",sub:"✓ واتساب — مشاركة",
              size: (mergedBuffer.duration * 128 * 1000 / 8 / (1024*1024)).toFixed(1) },
            { fmt:"mp3" as const,  br:192,       label:"MP3 192k",sub:"جودة عالية",
              size: (mergedBuffer.duration * 192 * 1000 / 8 / (1024*1024)).toFixed(1) },
          ].map(opt => (
            <button key={opt.label}
              onClick={() => { setExportFmt(opt.fmt); if(opt.br) setExportBr(opt.br as 128|192); }}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border text-xs transition-all ${
                exportFmt===opt.fmt&&(!opt.br||exportBr===opt.br)
                  ?"bg-emerald-600 border-emerald-600 text-white"
                  :"border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 hover:border-emerald-400"
              }`}>
              <span className="font-bold w-14">{opt.label}</span>
              <span className="font-mono">~{opt.size} MB</span>
              <span className="mr-auto opacity-70">{opt.sub}</span>
            </button>
          ))}

          <button onClick={handleExport} disabled={isExporting}
            className="w-full h-11 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold text-sm flex items-center justify-center gap-2 transition-all">
            {isExporting
              ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"/>جاري...</>
              : <><Download className="w-4 h-4"/>تحميل {exportFmt.toUpperCase()} {exportFmt==="mp3"?`${exportBr}k`:""}</>}
          </button>
        </div>
      )}

      {/* Empty state */}
      {entries.length === 0 && (
        <p className="text-xs text-slate-400 text-center pb-2">
          أضف ملفين أو أكثر للبدء · ترتيبها يحدد ترتيب الدمج
        </p>
      )}
    </div>
  );
}
