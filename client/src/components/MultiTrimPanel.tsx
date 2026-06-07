import { useState, useRef, useCallback, useEffect, Component, type ReactNode, type ErrorInfo } from "react";
import {
  Upload, Download, Trash2, ChevronUp, ChevronDown,
  Merge, CheckCircle, AlertCircle, RotateCcw, GripVertical,
  Undo2, Redo2, X, Info,
} from "lucide-react";
import { AudioTrimmerEngine } from "./AudioTrimmerEngine";
import { AudioExporter } from "./AudioExporter";
import WaveformEditor from "./WaveformEditor";
import { toast } from "sonner";

// ─── Inline Entry Error Boundary ─────────────────────────────────────────────

interface EBState { error: Error | null }
class EntryErrorBoundary extends Component<{ name: string; children: ReactNode }, EBState> {
  state: EBState = { error: null };
  static getDerivedStateFromError(e: Error): EBState { return { error: e }; }
  componentDidCatch(e: Error, info: ErrorInfo) { console.error("[EntryError]", e, info.componentStack); }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="rounded-2xl border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30 px-4 py-3 flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-bold text-red-600 dark:text-red-400">خطأ في معالجة: {this.props.name}</p>
          <p className="text-xs text-red-400 mt-0.5">{this.state.error.message}</p>
        </div>
        <button
          onClick={() => this.setState({ error: null })}
          className="text-xs px-3 py-1.5 rounded-lg bg-red-100 dark:bg-red-900 text-red-600 hover:bg-red-200 transition-all flex-shrink-0">
          إعادة المحاولة
        </button>
      </div>
    );
  }
}

// ─── Types ────────────────────────────────────────────────────────────────────

type FileStatus = "loading" | "ready" | "trimmed" | "error";

interface FileEntry {
  id:           string;
  file:         File;
  objectUrl:    string;
  status:       FileStatus;
  buffer:       AudioBuffer | null;  // الأصل — لا يتغير بعد التحميل
  bufferStack:  AudioBuffer[];       // مكدس التعديلات
  historyIndex: number;              // -1=لا تعديل، ≥0=bufferStack[idx]
  duration:     number;
}

interface MultiTrimPanelProps {
  onUseInPlayer: (blob: Blob, fileName: string) => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const uid    = () => crypto.randomUUID().slice(0, 8);
const fmtMs  = (t: number) => {
  if (!t || !isFinite(t)) return "0:00.0";
  return `${Math.floor(t / 60)}:${Math.floor(t % 60).toString().padStart(2, "0")}.${Math.floor((t % 1) * 10)}`;
};
const fmtKHz = (r: number) => r >= 1000 ? `${(r / 1000).toFixed(1)} kHz` : `${r} Hz`;

const AUDIO_EXT  = /\.(mp3|mp4|wav|ogg|m4a|aac|webm|flac|opus|mka|wma|aiff|aif)$/i;
const AUDIO_MIME = /^audio\//;

const GAP_OPTIONS = [0, 0.5, 1, 2] as const;
type GapSec = typeof GAP_OPTIONS[number];

const MAX_FILE_SIZE_MB    = 100;
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;

// vendor prefix لدعم Safari
const getAudioContext = (): AudioContext => {
  const Ctx = window.AudioContext ?? (window as any).webkitAudioContext;
  return new Ctx();
};

// localStorage helpers — تحفظ تفضيلات التصدير
const LS_FMT = "mtp_export_fmt";
const LS_BR  = "mtp_export_br";
const readLsFmt = (): "wav" | "mp3" =>
  (localStorage.getItem(LS_FMT) as "wav" | "mp3") ?? "mp3";
const readLsBr = (): 128 | 192 =>
  (parseInt(localStorage.getItem(LS_BR) ?? "128") as 128 | 192);

// buffer helpers
const currentBuf = (e: FileEntry): AudioBuffer | null =>
  e.historyIndex >= 0 ? (e.bufferStack[e.historyIndex] ?? null) : e.buffer;
const canUndo = (e: FileEntry) => e.historyIndex >= 0;
const canRedo = (e: FileEntry) => e.historyIndex < e.bufferStack.length - 1;

// ─── Component ────────────────────────────────────────────────────────────────

export default function MultiTrimPanel({ onUseInPlayer }: MultiTrimPanelProps) {
  const [entries, setEntries]             = useState<FileEntry[]>([]);
  const [mergeGap, setMergeGap]           = useState<GapSec>(0.5);
  const [crossfade, setCrossfade]         = useState(0.04);
  const [isMerging, setIsMerging]         = useState(false);
  const [mergeProgress, setMergeProgress] = useState(0);
  const [mergePhase, setMergePhase]       = useState("");
  const [dragOver, setDragOver]           = useState(false);
  const [activeId, setActiveId]           = useState<string | null>(null);

  // Export — يقرأ التفضيل المحفوظ
  const [showExport, setShowExport]     = useState(false);
  const [exportFmt, setExportFmtRaw]   = useState<"wav" | "mp3">(readLsFmt);
  const [exportBr, setExportBrRaw]     = useState<128 | 192>(readLsBr);
  const [isExporting, setIsExporting]  = useState(false);
  const [mergedBuffer, setMergedBuffer] = useState<AudioBuffer | null>(null);

  const setExportFmt = (v: "wav" | "mp3") => { setExportFmtRaw(v); localStorage.setItem(LS_FMT, v); };
  const setExportBr  = (v: 128 | 192)    => { setExportBrRaw(v);  localStorage.setItem(LS_BR, String(v)); };

  // Silence
  const SILENCE_THRESHOLD = -20;
  const SILENCE_MIN_DUR   = 5;
  const SILENCE_GAP       = 5;
  const [removingSilenceId, setRemovingSilenceId] = useState<string | null>(null);
  // مؤشر تقدم حذف الصمت
  const [silenceProgress, setSilenceProgress] = useState<{ id: string; current: number; total: number } | null>(null);

  type SilSeg = { id: string; startSec: number; endSec: number; durationSec: number; enabled: boolean };
  const [silenceAnalysis, setSilenceAnalysis]   = useState<Record<string, SilSeg[]>>({});
  const [analyzingId, setAnalyzingId]           = useState<string | null>(null);
  const [silencePreviewId, setSilencePreviewId] = useState<string | null>(null);
  const silPreviewCtx = useRef<AudioContext | null>(null);
  const silPreviewSrc = useRef<AudioBufferSourceNode | null>(null);

  // Per-file player
  const [playerTimes, setPlayerTimes] = useState<Record<string, number>>({});
  const [playingIds, setPlayingIds]   = useState<Set<string>>(new Set());
  const playerRefs = useRef<Record<string, HTMLAudioElement | null>>({});

  // Buffer preview
  const previewCtxRef = useRef<AudioContext | null>(null);
  const previewSrcRef = useRef<AudioBufferSourceNode | null>(null);
  const [previewingId, setPreviewingId] = useState<string | null>(null);

  // Drag & Drop
  const [draggedId, setDraggedId]   = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  // File info tooltip
  const [showInfoId, setShowInfoId] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // entriesRef — يمنع stale closure في cleanup والدوال الـ async
  const entriesRef = useRef<FileEntry[]>([]);
  useEffect(() => { entriesRef.current = entries; }, [entries]);

  // ── Cleanup ───────────────────────────────────────────────────────────────
  useEffect(() => () => {
    try { previewSrcRef.current?.stop(); } catch {}
    previewCtxRef.current?.close().catch(() => {});
    try { silPreviewSrc.current?.stop(); } catch {}
    silPreviewCtx.current?.close().catch(() => {});
    entriesRef.current.forEach(e => URL.revokeObjectURL(e.objectUrl));
  }, []);

  // ── Keyboard shortcuts ────────────────────────────────────────────────────
  // Ctrl+Z = تراجع، Ctrl+Y / Ctrl+Shift+Z = إعادة
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!activeId) return;
      const ctrl = e.ctrlKey || e.metaKey;
      if (!ctrl) return;

      if (!e.shiftKey && e.key === "z") {
        e.preventDefault();
        const entry = entriesRef.current.find(x => x.id === activeId);
        if (entry && canUndo(entry)) undoEdit(activeId);
      } else if (e.key === "y" || (e.shiftKey && e.key === "z")) {
        e.preventDefault();
        const entry = entriesRef.current.find(x => x.id === activeId);
        if (entry && canRedo(entry)) redoEdit(activeId);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [activeId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── History helpers ───────────────────────────────────────────────────────

  const pushToHistory = useCallback((
    id: string, newBuf: AudioBuffer,
    opts?: { originalBuf?: AudioBuffer; newUrl?: string }
  ) => {
    setEntries(prev => prev.map(e => {
      if (e.id !== id) return e;
      const stack = e.bufferStack.slice(0, e.historyIndex + 1);
      return {
        ...e,
        ...(opts?.originalBuf && !e.buffer ? { buffer: opts.originalBuf } : {}),
        ...(opts?.newUrl ? { objectUrl: opts.newUrl } : {}),
        bufferStack: [...stack, newBuf],
        historyIndex: stack.length,
        status: "trimmed",
        duration: newBuf.duration,
      };
    }));
  }, []);

  const undoEdit = (id: string) => {
    setEntries(prev => prev.map(e => {
      if (e.id !== id) return e;
      const newIndex = e.historyIndex - 1;
      const buf = newIndex >= 0 ? e.bufferStack[newIndex] : e.buffer;
      return { ...e, historyIndex: newIndex, status: newIndex < 0 ? "ready" : "trimmed", duration: buf?.duration ?? e.duration };
    }));
    toast("↩ تم التراجع");
  };

  const redoEdit = (id: string) => {
    setEntries(prev => prev.map(e => {
      if (e.id !== id) return e;
      if (e.historyIndex >= e.bufferStack.length - 1) return e;
      const newIndex = e.historyIndex + 1;
      const buf = e.bufferStack[newIndex];
      return { ...e, historyIndex: newIndex, status: "trimmed", duration: buf?.duration ?? e.duration };
    }));
    toast("↪ تم الإعادة");
  };

  const resetEdit = (id: string) => {
    setEntries(prev => prev.map(e => {
      if (e.id !== id || !e.buffer) return e;
      return { ...e, bufferStack: [], historyIndex: -1, status: "ready", duration: e.buffer.duration };
    }));
    toast.success("تمت إعادة التعيين الكامل");
  };

  // ── Clear All ─────────────────────────────────────────────────────────────

  const clearAll = () => {
    entriesRef.current.forEach(e => URL.revokeObjectURL(e.objectUrl));
    Object.values(playerRefs.current).forEach(el => { if (el) { el.pause(); el.src = ""; } });
    playerRefs.current = {};
    setEntries([]);
    setSilenceAnalysis({});
    setPlayerTimes({});
    setPlayingIds(new Set());
    setMergedBuffer(null);
    setShowExport(false);
    setActiveId(null);
    stopPreview();
  };

  // ── Load files ────────────────────────────────────────────────────────────

  const loadFiles = useCallback(async (files: File[]) => {
    const candidates = Array.from(files).filter(f =>
      AUDIO_MIME.test(f.type) || AUDIO_EXT.test(f.name) || f.type === ""
    );
    if (candidates.length === 0) {
      toast.error("لم يُعثر على ملفات — اختر ملفات MP3 أو WAV أو M4A");
      return;
    }

    // حد الحجم
    const oversized = candidates.filter(f => f.size > MAX_FILE_SIZE_BYTES);
    oversized.forEach(f => toast.error(`${f.name}: يتجاوز ${MAX_FILE_SIZE_MB} MB`));
    const sizedOk = candidates.filter(f => f.size <= MAX_FILE_SIZE_BYTES);
    if (sizedOk.length === 0) return;

    // منع إضافة نفس الملف مرتين (نفس الاسم + الحجم)
    const existingKeys = new Set(entriesRef.current.map(e => `${e.file.name}_${e.file.size}`));
    const dupes = sizedOk.filter(f => existingKeys.has(`${f.name}_${f.size}`));
    dupes.forEach(f => toast(`${f.name}: مضاف مسبقاً — تم تجاهله`));
    const uniqueCandidates = sizedOk.filter(f => !existingKeys.has(`${f.name}_${f.size}`));
    if (uniqueCandidates.length === 0) return;

    const getDurationFast = (objectUrl: string): Promise<number> =>
      new Promise(resolve => {
        const a = new Audio();
        a.preload = "metadata";
        a.onloadedmetadata = () => { resolve(a.duration || 0); a.src = ""; };
        a.onerror = () => resolve(0);
        a.src = objectUrl;
      });

    const newEntries: FileEntry[] = uniqueCandidates.map(f => ({
      id: uid(), file: f,
      objectUrl: URL.createObjectURL(f),
      status: "loading",
      buffer: null, bufferStack: [], historyIndex: -1, duration: 0,
    }));

    setEntries(prev => [...prev, ...newEntries]);

    await Promise.all(newEntries.map(async entry => {
      try {
        const dur = await getDurationFast(entry.objectUrl);
        if (dur > 0) {
          setEntries(prev => prev.map(e =>
            e.id === entry.id ? { ...e, status: "ready", duration: dur } : e
          ));
        } else {
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
    if (e.dataTransfer.files.length > 0) loadFiles(Array.from(e.dataTransfer.files));
  };

  // ── Drag & Drop reorder ───────────────────────────────────────────────────

  const handleReorderDrop = (targetId: string) => {
    if (!draggedId || draggedId === targetId) return;
    setEntries(prev => {
      const from = prev.findIndex(x => x.id === draggedId);
      const to   = prev.findIndex(x => x.id === targetId);
      if (from < 0 || to < 0) return prev;
      const next = [...prev];
      const [item] = next.splice(from, 1);
      next.splice(to, 0, item);
      return next;
    });
    setDraggedId(null); setDragOverId(null);
  };

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
    setSilenceAnalysis(prev => { const n = { ...prev }; delete n[id]; return n; });
    const el = playerRefs.current[id];
    if (el) { el.pause(); el.src = ""; }
    delete playerRefs.current[id];
    setPlayerTimes(prev => { const n = { ...prev }; delete n[id]; return n; });
    setPlayingIds(prev => { const s = new Set(prev); s.delete(id); return s; });
    if (activeId === id) setActiveId(null);
    if (showInfoId === id) setShowInfoId(null);
  };

  // ── Buffer preview ────────────────────────────────────────────────────────

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
    const buf = currentBuf(entry);
    if (!buf) return;
    try {
      const ctx = getAudioContext();
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

  // ── Silence analysis ──────────────────────────────────────────────────────

  const MAX_DIRECT_DURATION_MIN = 60;

  const handleAnalyzeSilence = async (entryId: string) => {
    const entrySnap = entriesRef.current.find(e => e.id === entryId);
    if (!entrySnap) return;
    setAnalyzingId(entryId);

    let buf = currentBuf(entrySnap);
    if (!buf) {
      const dMin = entrySnap.duration / 60;
      if (dMin <= MAX_DIRECT_DURATION_MIN && entrySnap.file.size <= MAX_FILE_SIZE_BYTES) {
        try {
          buf = await AudioTrimmerEngine.loadBuffer(entrySnap.objectUrl);
          setEntries(prev => prev.map(e =>
            e.id === entryId ? { ...e, buffer: buf!, status: "ready" } : e
          ));
        } catch { /* نكمل بدون موجة */ }
      }
    }
    setActiveId(entryId);

    try {
      const { SilenceProcessor } = await import("./SilenceProcessor");
      const durationMin = entrySnap.duration / 60;
      const isLarge = durationMin > MAX_DIRECT_DURATION_MIN || entrySnap.file.size > MAX_FILE_SIZE_BYTES;
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
      if (segs.length === 0) toast(`${entrySnap.file.name}: لم يُعثر على صمت يتجاوز ${SILENCE_MIN_DUR} ثوانٍ`);
      else toast.success(`🔍 اكتُشف ${segs.length} فترة صمت — راجعها ثم احذف ما تريد`);

    } catch (err) {
      console.error(err);
      toast.error("فشل التحليل — تأكد أن الملف صوتي صالح");
    } finally {
      setAnalyzingId(null);
    }
  };

  // ── Apply silence removal ─────────────────────────────────────────────────

  const handleApplySilenceForEntry = async (entryId: string) => {
    const segs = silenceAnalysis[entryId]?.filter(s => s.enabled) ?? [];
    if (segs.length === 0) { toast.error("لم تُحدّد أي فترة صمت للحذف"); return; }
    const entrySnap = entriesRef.current.find(e => e.id === entryId);
    if (!entrySnap) return;

    setRemovingSilenceId(entryId);
    setSilenceProgress({ id: entryId, current: 0, total: segs.length });

    try {
      let buf = currentBuf(entrySnap);
      let originalBuf = entrySnap.buffer;
      if (!buf) {
        buf = await AudioTrimmerEngine.loadBuffer(entrySnap.objectUrl);
        originalBuf = buf;
      }

      const sorted = [...segs].sort((a, b) => b.startSec - a.startSec);
      let out = buf;
      for (let i = 0; i < sorted.length; i++) {
        // مؤشر التقدم — X من Y
        setSilenceProgress({ id: entryId, current: i + 1, total: sorted.length });
        out = await AudioTrimmerEngine.deleteRange(out, sorted[i].startSec, sorted[i].endSec, 0.05, 0.02);
      }

      const oldUrl = entrySnap.objectUrl;
      const newUrl = URL.createObjectURL(AudioTrimmerEngine.toWav(out));
      setTimeout(() => URL.revokeObjectURL(oldUrl), 500);

      pushToHistory(entryId, out!, { originalBuf: originalBuf ?? undefined, newUrl });
      setPlayerTimes(prev => ({ ...prev, [entryId]: 0 }));
      setSilenceAnalysis(prev => { const n = { ...prev }; delete n[entryId]; return n; });
      toast.success(`✓ حُذف ${segs.length} فترة صمت — يمكنك التراجع بـ Ctrl+Z`);
    } catch (err) { console.error(err); toast.error("فشل الحذف"); }
    finally { setRemovingSilenceId(null); setSilenceProgress(null); }
  };

  // ── Preview silence segment ───────────────────────────────────────────────

  const previewSilenceSegment = (entryId: string, seg: SilSeg) => {
    try { silPreviewSrc.current?.stop(); } catch {}
    silPreviewCtx.current?.close().catch(() => {});
    if (silencePreviewId === seg.id) { setSilencePreviewId(null); return; }

    const entrySnap = entriesRef.current.find(e => e.id === entryId);
    const buf = currentBuf(entrySnap!) ?? entrySnap?.buffer;
    if (!buf) return;

    try {
      const ctx = getAudioContext();
      silPreviewCtx.current = ctx;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(ctx.destination);
      const pad = 0.5;
      src.start(0, Math.max(0, seg.startSec - pad), (seg.endSec - seg.startSec) + pad * 2);
      silPreviewSrc.current = src;
      setSilencePreviewId(seg.id);
      src.onended = () => { setSilencePreviewId(null); ctx.close().catch(() => {}); };
    } catch { toast.error("فشل تشغيل المعاينة"); }
  };

  // ── Merge ─────────────────────────────────────────────────────────────────

  const handleMerge = async () => {
    const allEntries = entries.filter(e => e.status === "ready" || e.status === "trimmed");
    if (allEntries.length < 1) { toast.error("أضف ملفاً واحداً على الأقل"); return; }

    setIsMerging(true); setMergeProgress(5); setMergePhase("جاري تحميل الملفات...");
    try {
      const buffers: AudioBuffer[] = [];
      for (let i = 0; i < allEntries.length; i++) {
        const e = allEntries[i];
        setMergeProgress(Math.round(5 + (i / allEntries.length) * 55));
        setMergePhase(`تحميل: ${e.file.name}`);
        let buf = currentBuf(e);
        if (!buf) {
          buf = await AudioTrimmerEngine.loadBuffer(e.objectUrl);
          setEntries(prev => prev.map(x => x.id === e.id ? { ...x, buffer: buf! } : x));
        }
        buffers.push(buf);
      }

      // تحذير اختلاف معدلات الأخذ بالعينات
      if (buffers.length > 1) {
        const rates = new Set(buffers.map(b => b.sampleRate));
        if (rates.size > 1) {
          toast(`⚠ ملفات بمعدلات مختلفة: ${[...rates].map(fmtKHz).join(" / ")} — قد يؤثر على جودة الصوت`, { duration: 6000 });
        }
      }

      setMergeProgress(65); setMergePhase("جاري الدمج...");
      const merged = buffers.length === 1
        ? buffers[0]
        : await AudioTrimmerEngine.mergeBuffersWithFade(buffers, mergeGap, crossfade);
      setMergeProgress(95); setMergePhase("اكتمل الدمج ✓");
      setMergedBuffer(merged);
      setShowExport(true);

      // أرسل إلى المشغل الرئيسي فوراً بعد الدمج (معاينة WAV)
      const base = allEntries.length === 1
        ? allEntries[0].file.name.replace(/\.[^.]+$/, "")
        : `merged-${allEntries.length}files`;
      onUseInPlayer(AudioTrimmerEngine.toWav(merged), `${base}.wav`);

      toast.success(`✓ ${allEntries.length > 1 ? `تم دمج ${allEntries.length} ملفات` : "الملف جاهز للتصدير"}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "فشل الدمج");
    } finally {
      setIsMerging(false); setMergeProgress(0); setMergePhase("");
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
        // حماية WAV Overflow — المتصفح لا يتحمل > ~2 GB
        const estimatedBytes = mergedBuffer.length * mergedBuffer.numberOfChannels * 2 + 44;
        if (estimatedBytes > 1.5 * 1024 * 1024 * 1024) {
          toast.error(
            `حجم WAV المتوقع (~${(estimatedBytes / 1024 / 1024 / 1024).toFixed(1)} GB) يتجاوز حد المتصفح — استخدم MP3`
          );
          return;
        }
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
  const totalDur   = entries.reduce((s, e) => s + (currentBuf(e)?.duration ?? 0), 0);

  return (
    <div className="space-y-4">

      {/* ── Drop zone ─────────────────────────────────────────────────── */}
      <div
        onDragOver={e => { e.preventDefault(); if (e.dataTransfer.types.includes("Files")) setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        role="button"
        aria-label="منطقة رفع الملفات"
        className={`border-2 border-dashed rounded-2xl p-8 text-center cursor-pointer transition-all ${
          dragOver
            ? "border-indigo-400 bg-indigo-50 dark:bg-indigo-950/40"
            : entries.length === 0
              ? "border-slate-300 dark:border-slate-600 hover:border-indigo-400 hover:bg-indigo-50/30"
              : "border-slate-200 dark:border-slate-700 hover:border-indigo-300 py-4"
        }`}
      >
        <Upload className={`mx-auto text-slate-400 mb-2 ${entries.length ? "w-4 h-4" : "w-8 h-8"}`} />
        <p className={`font-medium text-slate-600 dark:text-slate-400 ${entries.length ? "text-xs" : "text-sm"}`}>
          {dragOver ? "أفلت الملفات هنا ✓" : entries.length ? "+ أضف المزيد من الملفات" : "اسحب ملفاتك هنا أو انقر للاختيار"}
        </p>
        {entries.length === 0 && (
          <>
            <p className="text-xs text-slate-400 mt-1 font-medium">MP3 · WAV · M4A · OGG · AAC · حد {MAX_FILE_SIZE_MB} MB</p>
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
            <div className="flex items-center gap-2">
              <span>{readyCount} ملف جاهز</span>
              {/* اختصارات لوحة المفاتيح */}
              {activeId && (
                <span className="text-slate-300 dark:text-slate-600 hidden sm:inline">
                  Ctrl+Z تراجع · Ctrl+Y إعادة
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {totalDur > 0 && (
                <span className="font-mono">
                  {fmtMs(totalDur + mergeGap * Math.max(0, readyCount - 1))}
                </span>
              )}
              {/* مسح الكل */}
              <button
                onClick={e => { e.stopPropagation(); clearAll(); }}
                className="flex items-center gap-1 px-2 py-0.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 transition-all"
                title="مسح جميع الملفات"
                aria-label="مسح جميع الملفات">
                <X className="w-3 h-3" />
                <span className="text-xs">مسح الكل</span>
              </button>
            </div>
          </div>

          <div role="list" aria-label="قائمة الملفات الصوتية">
            {entries.map((entry, idx) => {
              const isActive  = activeId === entry.id;
              const isPrev    = previewingId === entry.id;
              const isPlaying = playingIds.has(entry.id);
              const isDragged = draggedId === entry.id;
              const isDragTarget = dragOverId === entry.id && draggedId !== entry.id;
              const buf       = currentBuf(entry);

              return (
                <EntryErrorBoundary key={entry.id} name={entry.file.name}>
                  <div
                    role="listitem"
                    draggable
                    onDragStart={e => { setDraggedId(entry.id); e.dataTransfer.effectAllowed = "move"; }}
                    onDragEnd={() => { setDraggedId(null); setDragOverId(null); }}
                    onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; setDragOverId(entry.id); }}
                    onDragLeave={() => setDragOverId(null)}
                    onDrop={e => { e.preventDefault(); handleReorderDrop(entry.id); }}
                    className={`rounded-2xl border overflow-hidden transition-all select-none mb-2 ${
                      isDragTarget
                        ? "border-indigo-400 dark:border-indigo-500 bg-indigo-50/30 dark:bg-indigo-950/20 scale-[1.01]"
                        : isActive
                          ? "border-indigo-400 dark:border-indigo-600 shadow-sm shadow-indigo-100 dark:shadow-none"
                          : "border-slate-200 dark:border-slate-700"
                    } ${isDragged ? "opacity-40 scale-[0.98]" : ""}`}>

                    {/* File row */}
                    <div className={`flex items-center gap-2 px-3 py-2.5 ${
                      isActive ? "bg-indigo-50 dark:bg-indigo-950/30" : "bg-slate-50 dark:bg-slate-800/60"
                    }`}>

                      {/* مقبض السحب */}
                      <GripVertical
                        className="w-3.5 h-3.5 text-slate-300 dark:text-slate-600 flex-shrink-0 cursor-grab active:cursor-grabbing"
                        aria-hidden="true" />

                      {/* Status */}
                      <span className="flex-shrink-0" aria-label={
                        entry.status === "loading" ? "جاري التحميل" :
                        entry.status === "ready" ? "جاهز" :
                        entry.status === "trimmed" ? "مُعدَّل" : "خطأ"
                      }>
                        {entry.status === "loading" && <div className="w-3.5 h-3.5 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin" />}
                        {entry.status === "ready"   && <CheckCircle className="w-3.5 h-3.5 text-slate-400" />}
                        {entry.status === "trimmed" && <CheckCircle className="w-3.5 h-3.5 text-emerald-500" />}
                        {entry.status === "error"   && <AlertCircle className="w-3.5 h-3.5 text-red-500" />}
                      </span>

                      {/* Name + duration */}
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-slate-700 dark:text-slate-300 truncate" title={entry.file.name}>
                          {entry.file.name}
                        </p>
                        {entry.duration > 0 && (
                          <p className="text-xs font-mono text-slate-400 tabular-nums">
                            {entry.status === "trimmed" ? "✂ " : ""}{fmtMs(entry.duration)}
                            {entry.bufferStack.length > 0 && (
                              <span className="mr-1.5 text-indigo-400 font-sans text-[10px]">
                                ({entry.historyIndex + 1}/{entry.bufferStack.length})
                              </span>
                            )}
                            {entry.duration > 3600 && (
                              <span className="mr-1.5 text-amber-500 font-sans font-medium not-italic">· قطّع أولاً</span>
                            )}
                          </p>
                        )}
                      </div>

                      {/* Actions */}
                      <div className="flex items-center gap-1 flex-shrink-0">

                        {/* ℹ معلومات الملف */}
                        <button
                          onClick={() => setShowInfoId(showInfoId === entry.id ? null : entry.id)}
                          className={`w-6 h-6 flex items-center justify-center rounded-lg text-xs transition-all ${
                            showInfoId === entry.id
                              ? "bg-slate-200 dark:bg-slate-700 text-slate-600"
                              : "text-slate-300 dark:text-slate-600 hover:text-slate-500"
                          }`}
                          aria-label="معلومات الملف"
                          title="معلومات الملف">
                          <Info className="w-3 h-3" />
                        </button>

                        {/* ▶ Buffer preview */}
                        {buf && (
                          <button onClick={() => playEntry(entry)}
                            aria-label={isPrev ? "إيقاف المعاينة" : "معاينة الملف"}
                            className={`w-7 h-7 flex items-center justify-center rounded-lg text-xs transition-all ${
                              isPrev
                                ? "bg-emerald-600 text-white"
                                : "bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-600 text-slate-500 hover:border-emerald-400 hover:text-emerald-600"
                            }`}>
                            {isPrev ? "⏹" : "▶"}
                          </button>
                        )}

                        {/* ✂ Edit */}
                        {(entry.status === "ready" || entry.status === "trimmed") && (
                          <button
                            aria-label={isActive ? "إغلاق لوحة التقطيع" : "فتح لوحة التقطيع"}
                            onClick={async () => {
                              if (isActive) { setActiveId(null); return; }
                              if (!entry.buffer && !currentBuf(entry)) {
                                setEntries(prev => prev.map(e => e.id === entry.id ? { ...e, status: "loading" } : e));
                                try {
                                  const b = await AudioTrimmerEngine.loadBuffer(entry.objectUrl);
                                  setEntries(prev => prev.map(e => e.id === entry.id ? { ...e, buffer: b, status: "ready" } : e));
                                } catch {
                                  toast.error(`تعذّر فتح: ${entry.file.name}`);
                                  setEntries(prev => prev.map(e => e.id === entry.id ? { ...e, status: "ready" } : e));
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

                        {/* 🔇 Silence */}
                        {(entry.status === "ready" || entry.status === "trimmed") && (() => {
                          const durationMin = entry.duration / 60;
                          const isLarge = durationMin > 60 || entry.file.size > MAX_FILE_SIZE_BYTES;
                          return (
                            <button
                              onClick={() => handleAnalyzeSilence(entry.id)}
                              disabled={analyzingId === entry.id || removingSilenceId === entry.id}
                              aria-label="تحليل الصمت"
                              className="flex items-center gap-1 px-2 py-1 text-xs rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-600 text-violet-600 hover:border-violet-400 hover:bg-violet-50 dark:hover:bg-violet-950/30 transition-all disabled:opacity-50"
                              title={isLarge ? `streaming (${Math.round(durationMin)} دقيقة)` : "تحليل الصمت"}>
                              {analyzingId === entry.id
                                ? <div className="w-3 h-3 border border-violet-500 border-t-transparent rounded-full animate-spin" />
                                : isLarge ? "🌊" : "🔇"}
                              <span>{analyzingId === entry.id ? "..." : "صمت"}</span>
                            </button>
                          );
                        })()}

                        {/* ↩ Undo */}
                        {canUndo(entry) && (
                          <button onClick={() => undoEdit(entry.id)}
                            aria-label={`تراجع — ${entry.historyIndex + 1} تعديل`}
                            className="w-7 h-7 flex items-center justify-center rounded-lg text-indigo-500 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 transition-all"
                            title={`تراجع (Ctrl+Z) — ${entry.historyIndex + 1} تعديل`}>
                            <Undo2 className="w-3.5 h-3.5" />
                          </button>
                        )}

                        {/* ↪ Redo */}
                        {canRedo(entry) && (
                          <button onClick={() => redoEdit(entry.id)}
                            aria-label="إعادة"
                            className="w-7 h-7 flex items-center justify-center rounded-lg text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/40 transition-all"
                            title="إعادة (Ctrl+Y)">
                            <Redo2 className="w-3.5 h-3.5" />
                          </button>
                        )}

                        {/* ↺ Reset كامل */}
                        {entry.status === "trimmed" && (
                          <button onClick={() => resetEdit(entry.id)}
                            aria-label="إعادة تعيين كامل"
                            className="w-7 h-7 flex items-center justify-center rounded-lg text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950/40 transition-all"
                            title="إعادة تعيين كامل">
                            <RotateCcw className="w-3.5 h-3.5" />
                          </button>
                        )}

                        {/* ↑↓ Reorder */}
                        <div className="flex flex-col gap-0.5" role="group" aria-label="إعادة ترتيب">
                          <button onClick={() => move(entry.id, -1)} disabled={idx === 0}
                            aria-label="نقل لأعلى"
                            className="w-5 h-4 flex items-center justify-center text-slate-400 hover:text-slate-700 disabled:opacity-20">
                            <ChevronUp className="w-3 h-3" />
                          </button>
                          <button onClick={() => move(entry.id, 1)} disabled={idx === entries.length - 1}
                            aria-label="نقل لأسفل"
                            className="w-5 h-4 flex items-center justify-center text-slate-400 hover:text-slate-700 disabled:opacity-20">
                            <ChevronDown className="w-3 h-3" />
                          </button>
                        </div>

                        {/* 🗑 Remove */}
                        <button onClick={() => removeEntry(entry.id)}
                          aria-label={`حذف ${entry.file.name}`}
                          className="w-7 h-7 flex items-center justify-center rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40 transition-all"
                          title="حذف الملف">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    {/* معلومات الملف — Tooltip */}
                    {showInfoId === entry.id && (
                      <div className="px-3 py-2 bg-slate-100 dark:bg-slate-800 border-t border-slate-200 dark:border-slate-700 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500 font-mono">
                        <span>📁 {(entry.file.size / 1024 / 1024).toFixed(1)} MB</span>
                        {(currentBuf(entry) ?? entry.buffer) && <>
                          <span>🎵 {fmtKHz((currentBuf(entry) ?? entry.buffer)!.sampleRate)}</span>
                          <span>{(currentBuf(entry) ?? entry.buffer)!.numberOfChannels === 1 ? "🎙 Mono" : "🎙 Stereo"}</span>
                          <span>⏱ {fmtMs((currentBuf(entry) ?? entry.buffer)!.duration)}</span>
                        </>}
                        <span className="text-slate-400">{entry.file.type || "audio/*"}</span>
                      </div>
                    )}

                    {/* Edit panel */}
                    {isActive && (
                      <div className="border-t border-slate-200 dark:border-slate-700">

                        {/* audio element مع تتبع أحداث التشغيل */}
                        <audio
                          ref={el => { if (el) playerRefs.current[entry.id] = el; }}
                          src={entry.objectUrl}
                          onPlay={() => setPlayingIds(prev => new Set(prev).add(entry.id))}
                          onPause={() => setPlayingIds(prev => { const s = new Set(prev); s.delete(entry.id); return s; })}
                          onEnded={() => setPlayingIds(prev => { const s = new Set(prev); s.delete(entry.id); return s; })}
                          onTimeUpdate={e => {
                            const t = e.currentTarget?.currentTime;
                            if (t != null) setPlayerTimes(prev => ({ ...prev, [entry.id]: t }));
                          }}
                          className="hidden"
                        />

                        {/* Mini player */}
                        <div className="flex items-center gap-2 px-3 py-2 bg-indigo-50/50 dark:bg-indigo-950/20">
                          <button
                            onClick={() => { const el = playerRefs.current[entry.id]; el && (el.paused ? el.play() : el.pause()); }}
                            aria-label={isPlaying ? "إيقاف" : "تشغيل"}
                            className="w-8 h-8 rounded-full bg-indigo-600 hover:bg-indigo-500 text-white flex items-center justify-center flex-shrink-0 text-xs">
                            {isPlaying ? "⏸" : "▶"}
                          </button>
                          <span className="font-mono text-xs text-slate-500 tabular-nums">
                            {fmtMs(playerTimes[entry.id] ?? 0)} / {fmtMs(entry.duration)}
                          </span>
                          <input type="range" min={0} max={entry.duration || 1} step={0.05}
                            value={playerTimes[entry.id] ?? 0}
                            aria-label="شريط التقدم"
                            onChange={e => {
                              const t = parseFloat(e.target.value);
                              setPlayerTimes(prev => ({ ...prev, [entry.id]: t }));
                              const el = playerRefs.current[entry.id];
                              if (el) el.currentTime = t;
                            }}
                            className="flex-1 h-1 accent-indigo-500" />
                          {[0.5, 1, 1.5, 2].map(s => (
                            <button key={s}
                              onClick={() => { const el = playerRefs.current[entry.id]; if (el) el.playbackRate = s; }}
                              aria-label={`سرعة ${s}x`}
                              className="px-1.5 py-0.5 text-xs rounded font-mono bg-slate-100 dark:bg-slate-800 text-slate-500 hover:bg-indigo-100 dark:hover:bg-indigo-950">
                              {s}×
                            </button>
                          ))}
                        </div>

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
                                  .map(s => ({ id: s.id, startSec: s.startSec, endSec: s.endSec, label: "🔇", color: "#ef4444", enabled: true }))
                              }
                              onDeleteRange={async (s, e) => {
                                try {
                                  const out = await AudioTrimmerEngine.deleteRange(buf, s, e, 0.05, 0.02);
                                  pushToHistory(entry.id, out);
                                  toast.success(`✓ حُذف ${fmtMs(e - s)} — Ctrl+Z للتراجع`);
                                } catch { toast.error("فشل الحذف"); }
                              }}
                              onCropToRange={async (s, e) => {
                                try {
                                  const out = await AudioTrimmerEngine.trimWithFade(buf, s, e, crossfade);
                                  pushToHistory(entry.id, out);
                                  toast.success(`✓ اقتُصر على ${fmtMs(e - s)} — Ctrl+Z للتراجع`);
                                } catch { toast.error("فشل الاقتصاص"); }
                              }}
                              onSeek={t => {
                                setPlayerTimes(prev => ({ ...prev, [entry.id]: t }));
                                const el = playerRefs.current[entry.id];
                                if (el) el.currentTime = t;
                              }}
                            />
                            {/* Crossfade + Undo/Redo */}
                            <div className="flex items-center gap-2 px-3 py-2 border-t border-slate-100 dark:border-slate-800 flex-wrap">
                              <span className="text-xs text-slate-400">انتقال ناعم:</span>
                              {[{ v: 0, l: "لا" }, { v: 0.02, l: "20ms" }, { v: 0.05, l: "50ms" }].map(o => (
                                <button key={o.v} onClick={() => setCrossfade(o.v)}
                                  className={`px-2 py-0.5 text-xs rounded-lg transition-all ${
                                    crossfade === o.v ? "bg-indigo-600 text-white" : "bg-slate-100 dark:bg-slate-800 text-slate-500"
                                  }`}>
                                  {o.l}
                                </button>
                              ))}
                              <div className="mr-auto flex gap-1">
                                <button onClick={() => undoEdit(entry.id)} disabled={!canUndo(entry)}
                                  aria-label="تراجع Ctrl+Z"
                                  className="flex items-center gap-1 px-2 py-0.5 text-xs rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-500 hover:bg-indigo-100 disabled:opacity-30 transition-all">
                                  <Undo2 className="w-3 h-3" /> تراجع
                                </button>
                                <button onClick={() => redoEdit(entry.id)} disabled={!canRedo(entry)}
                                  aria-label="إعادة Ctrl+Y"
                                  className="flex items-center gap-1 px-2 py-0.5 text-xs rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-500 hover:bg-indigo-100 disabled:opacity-30 transition-all">
                                  <Redo2 className="w-3 h-3" /> إعادة
                                </button>
                              </div>
                            </div>
                          </>
                        ) : (
                          <div className="px-4 py-3 bg-slate-50 dark:bg-slate-800/50 text-center">
                            {analyzingId === entry.id ? (
                              <p className="text-xs text-violet-600 dark:text-violet-400 flex items-center justify-center gap-2">
                                <div className="w-3 h-3 border border-violet-500 border-t-transparent rounded-full animate-spin" />
                                جاري تحليل الصمت...
                              </p>
                            ) : (
                              <p className="text-xs text-slate-400">سيتم تحميل الموجة عند الحاجة للتقطيع اليدوي</p>
                            )}
                          </div>
                        )}

                        {/* Silence results */}
                        {silenceAnalysis[entry.id] && silenceAnalysis[entry.id].length > 0 && (
                          <div className="border-t border-violet-200 dark:border-violet-800 bg-violet-50/50 dark:bg-violet-950/20">
                            <div className="flex items-center justify-between px-3 py-2">
                              <span className="text-xs font-bold text-violet-700 dark:text-violet-300">
                                🔇 فترات الصمت ({silenceAnalysis[entry.id].filter(s => s.enabled).length}/{silenceAnalysis[entry.id].length})
                              </span>
                              <div className="flex gap-1.5">
                                <button
                                  onClick={() => setSilenceAnalysis(prev => ({
                                    ...prev, [entry.id]: prev[entry.id].map(s => ({ ...s, enabled: true }))
                                  }))}
                                  className="text-xs px-2 py-0.5 rounded-lg bg-violet-100 dark:bg-violet-900 text-violet-700 dark:text-violet-300">
                                  تحديد الكل
                                </button>
                                <button
                                  onClick={() => setSilenceAnalysis(prev => ({
                                    ...prev, [entry.id]: prev[entry.id].map(s => ({ ...s, enabled: false }))
                                  }))}
                                  className="text-xs px-2 py-0.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-500">
                                  إلغاء الكل
                                </button>
                                <button
                                  onClick={() => setSilenceAnalysis(prev => { const n = { ...prev }; delete n[entry.id]; return n; })}
                                  className="text-xs text-slate-400 hover:text-slate-600 px-1"
                                  aria-label="إغلاق قائمة الصمت">✕</button>
                              </div>
                            </div>

                            <div className="px-3 pb-2 max-h-44 overflow-y-auto space-y-1" role="list">
                              {silenceAnalysis[entry.id].map((seg, si) => (
                                <div key={seg.id} role="listitem"
                                  className={`flex items-center gap-2 px-2.5 py-1.5 rounded-xl border text-xs transition-all ${
                                    seg.enabled
                                      ? "bg-red-50 dark:bg-red-950/40 border-red-200 dark:border-red-800"
                                      : "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-700 opacity-60"
                                  }`}>
                                  <button
                                    onClick={() => setSilenceAnalysis(prev => ({
                                      ...prev,
                                      [entry.id]: prev[entry.id].map(s => s.id === seg.id ? { ...s, enabled: !s.enabled } : s)
                                    }))}
                                    aria-label={seg.enabled ? "إلغاء تحديد" : "تحديد"}
                                    aria-pressed={seg.enabled}
                                    className={`flex-shrink-0 w-4 h-4 rounded border-2 flex items-center justify-center ${
                                      seg.enabled ? "bg-red-500 border-red-500" : "border-slate-300"
                                    }`}>
                                    {seg.enabled && <span className="text-white" style={{ fontSize: "9px" }}>✓</span>}
                                  </button>
                                  <span className="text-slate-400 w-4 text-center">{si + 1}</span>
                                  <span className="font-mono text-slate-600 dark:text-slate-400 flex-1">
                                    {fmtMs(seg.startSec)} → {fmtMs(seg.endSec)}
                                  </span>
                                  <span className="font-mono text-slate-400 flex-shrink-0">{fmtMs(seg.durationSec)}</span>
                                  <button
                                    onClick={() => previewSilenceSegment(entry.id, seg)}
                                    aria-label={silencePreviewId === seg.id ? "إيقاف المعاينة" : "معاينة فترة الصمت"}
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

                            <div className="px-3 pb-3">
                              <button
                                onClick={() => handleApplySilenceForEntry(entry.id)}
                                disabled={removingSilenceId === entry.id || silenceAnalysis[entry.id].filter(s => s.enabled).length === 0}
                                className={`w-full h-9 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all ${
                                  removingSilenceId === entry.id || silenceAnalysis[entry.id].filter(s => s.enabled).length === 0
                                    ? "bg-slate-100 dark:bg-slate-800 text-slate-400 cursor-not-allowed"
                                    : "bg-red-600 hover:bg-red-500 text-white"
                                }`}>
                                {removingSilenceId === entry.id
                                  ? <>
                                      <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                      {/* مؤشر التقدم X من Y */}
                                      {silenceProgress?.id === entry.id
                                        ? `حذف ${silenceProgress.current} من ${silenceProgress.total}...`
                                        : "جاري الحذف..."}
                                    </>
                                  : <>✂ حذف {silenceAnalysis[entry.id].filter(s => s.enabled).length} فترة صمت</>}
                              </button>
                              <p className="text-center text-xs text-slate-400 mt-1">
                                بعد الحذف يمكن التعديل اليدوي أو التراجع بـ Ctrl+Z
                              </p>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </EntryErrorBoundary>
              );
            })}
          </div>
        </div>
      )}

      {/* ── Merge controls ────────────────────────────────────────────── */}
      {readyCount >= 1 && (
        <div className="space-y-3 pt-2 border-t border-slate-200 dark:border-slate-700">

          {readyCount > 1 && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-500 flex-shrink-0">فجوة بين الملفات:</span>
              <div className="flex gap-1 flex-1" role="group" aria-label="خيارات الفجوة">
                {GAP_OPTIONS.map(g => (
                  <button key={g} onClick={() => setMergeGap(g)}
                    aria-pressed={mergeGap === g}
                    className={`flex-1 py-1.5 text-xs rounded-xl border transition-all ${
                      mergeGap === g
                        ? "bg-indigo-600 border-indigo-600 text-white"
                        : "border-slate-200 dark:border-slate-700 text-slate-600 hover:border-indigo-400"
                    }`}>
                    {g === 0 ? "بلا" : `${g}ث`}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* مؤشر تقدم مفصَّل */}
          {isMerging && (
            <div className="space-y-1">
              <div className="h-1.5 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden" role="progressbar" aria-valuenow={mergeProgress} aria-valuemin={0} aria-valuemax={100}>
                <div className="h-full bg-indigo-500 rounded-full transition-all duration-300" style={{ width: `${mergeProgress}%` }} />
              </div>
              <p className="text-xs text-slate-500 text-center">{mergePhase} — {mergeProgress}%</p>
            </div>
          )}

          <button onClick={handleMerge} disabled={isMerging}
            aria-label={readyCount > 1 ? `دمج ${readyCount} ملفات` : "تصدير الملف"}
            className="w-full h-12 rounded-2xl bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-200 disabled:text-slate-400 text-white font-bold text-sm flex items-center justify-center gap-2 transition-all active:scale-[0.99]">
            {isMerging
              ? <><div className="w-5 h-5 border-2 border-indigo-200 border-t-transparent rounded-full animate-spin" />جاري الدمج...</>
              : <><Merge className="w-4 h-4" />{readyCount > 1 ? `دمج ${readyCount} ملفات` : "تصدير الملف"}</>}
          </button>
        </div>
      )}

      {/* ── Export panel ──────────────────────────────────────────────── */}
      {showExport && mergedBuffer && (
        <div className="bg-slate-50 dark:bg-slate-800/60 rounded-2xl border border-slate-200 dark:border-slate-700 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">💾 اختر صيغة الحفظ</p>
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs text-slate-400">{fmtMs(mergedBuffer.duration)}</span>
              <span className="text-xs text-slate-400">·</span>
              <span className="text-xs text-slate-400">{fmtKHz(mergedBuffer.sampleRate)}</span>
              <span className="text-xs text-slate-400">·</span>
              <span className="text-xs text-slate-400">{mergedBuffer.numberOfChannels === 1 ? "Mono" : "Stereo"}</span>
            </div>
          </div>

          {[
            { fmt: "wav" as const, br: undefined, label: "WAV",      sub: "جودة أصلية — موثوق",
              size: ((mergedBuffer.length * mergedBuffer.numberOfChannels * 2 + 44) / (1024 * 1024)).toFixed(1) },
            { fmt: "mp3" as const, br: 128,       label: "MP3 128k", sub: "✓ واتساب — مشاركة",
              size: (mergedBuffer.duration * 128 * 1000 / 8 / (1024 * 1024)).toFixed(1) },
            { fmt: "mp3" as const, br: 192,       label: "MP3 192k", sub: "جودة عالية",
              size: (mergedBuffer.duration * 192 * 1000 / 8 / (1024 * 1024)).toFixed(1) },
          ].map(opt => (
            <button key={opt.label}
              onClick={() => { setExportFmt(opt.fmt); if (opt.br) setExportBr(opt.br as 128 | 192); }}
              aria-pressed={exportFmt === opt.fmt && (!opt.br || exportBr === opt.br)}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border text-xs transition-all ${
                exportFmt === opt.fmt && (!opt.br || exportBr === opt.br)
                  ? "bg-emerald-600 border-emerald-600 text-white"
                  : "border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 hover:border-emerald-400"
              }`}>
              <span className="font-bold w-14">{opt.label}</span>
              <span className="font-mono">~{opt.size} MB</span>
              <span className="mr-auto opacity-70">{opt.sub}</span>
            </button>
          ))}

          <button onClick={handleExport} disabled={isExporting}
            aria-label={`تحميل بصيغة ${exportFmt.toUpperCase()}`}
            className="w-full h-11 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold text-sm flex items-center justify-center gap-2 transition-all">
            {isExporting
              ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />جاري...</>
              : <><Download className="w-4 h-4" />تحميل {exportFmt.toUpperCase()} {exportFmt === "mp3" ? `${exportBr}k` : ""}</>}
          </button>
        </div>
      )}

      {entries.length === 0 && (
        <p className="text-xs text-slate-400 text-center pb-2">
          أضف ملفين أو أكثر للبدء · اسحب البطاقات لإعادة الترتيب · Ctrl+Z للتراجع
        </p>
      )}
    </div>
  );
}