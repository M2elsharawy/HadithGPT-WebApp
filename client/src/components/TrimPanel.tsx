import { useState, useEffect, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Play, Pause, Square, Download, Scissors,
  CheckCircle, RotateCcw, Plus, Trash2, ListX, FileDown,
} from "lucide-react";
import WaveformEditor from "./WaveformEditor";
import { AudioTrimmerEngine } from "./AudioTrimmerEngine";
import {
  AudioExporter, ExportFormat,
  Mp3Bitrate, MP3_BITRATE_OPTIONS, DEFAULT_MP3_BITRATE,
  estimateMp3SizeMB, formatFileSizeMB,
} from "./AudioExporter";
import { toast } from "sonner";

interface TrimPanelProps {
  audioUrl: string;
  fileName: string;
  onDownload: (blob: Blob, fileName: string) => void;
  onUseInPlayer: (blob: Blob, fileName: string) => void;
  onBack?: () => void;  // ← رجوع للقائمة الرئيسية
  /** undo/redo من Tools.tsx */
  onUndo?: () => void;
  onRedo?: () => void;
  undoCount?: number;
  redoCount?: number;
}

type LoadState  = "idle" | "loading" | "ready" | "error";
type EditMode   = "keep" | "cut";
type Processing = false | "trim" | "cut" | "multi";
type TabView    = "single" | "multi";

const fmt   = AudioTrimmerEngine.formatTime;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

const GAP_OPTIONS = [0, 0.5, 1, 2] as const;
type GapOption = typeof GAP_OPTIONS[number];

interface DeleteRange {
  id: string;
  startInput: string;
  endInput: string;
  startSec: number | null;
  endSec:   number | null;
}

const uid       = () => Math.random().toString(36).slice(2, 8);
const makeRange = (s = 0, e = 0): DeleteRange => ({
  id: uid(), startInput: fmt(s), endInput: fmt(e), startSec: s, endSec: e,
});

export default function TrimPanel({
  audioUrl, fileName, onDownload, onUseInPlayer, onBack,
  onUndo, onRedo, undoCount = 0, redoCount = 0,
}: TrimPanelProps) {

  // ── Buffer ─────────────────────────────────────────────────────────────────
  const [loadState, setLoadState]     = useState<LoadState>("idle");
  const [audioBuffer, setAudioBuffer] = useState<AudioBuffer | null>(null);
  // ── ready — مشتق من loadState — يجب قبل أي callback يستخدمه ───────────────
  // لا نستطيع استخدام const مباشرة لأنه يتغير مع loadState
  // نستخدم useRef للوصول الفوري في callbacks
  const readyRef = useRef(false);
  // ready كـ derived value تُحدَّث في كل render
  const ready = loadState === "ready";
  readyRef.current = ready;
  // Export panel ref for scroll-to
  const exportPanelRef = useRef<HTMLDivElement>(null);
  const [showExportPanel, setShowExportPanel] = useState(false);
  /** تحكم: إظهار الأدوات المتقدمة (مخفية افتراضياً) */
  const [showAdvanced, setShowAdvanced] = useState(false);
  const totalDuration = audioBuffer?.duration ?? 0;

  // ── Player state — يجب أن يكون قبل أي callback يستخدمه ──────────────────────
  const playerRef     = useRef<HTMLAudioElement>(null);
  const [playerTime, setPlayerTime]         = useState(0);
  const [playerDuration, setPlayerDuration] = useState(0);
  const [playerPlaying, setPlayerPlaying]   = useState(false);
  // tab — يجب قبل handleSplit الذي يستخدمه (سطر 163)
  const [tab, setTab] = useState<TabView>("single");

  // ── History chips ──────────────────────────────────────────────────────────
  interface HistoryChip { id: string; label: string; type: "cut"|"keep"|"multi"|"norm"|"split"; }
  const [historyChips, setHistoryChips] = useState<HistoryChip[]>([]);
  const addChip = (label: string, type: HistoryChip["type"]) =>
    setHistoryChips(prev => [...prev.slice(-4), { id: uid(), label, type }]);

  // ── Markers (ملوّنة + قابلة التسمية) ─────────────────────────────────────────
  interface Marker { id: string; timeSec: number; label: string; color: string; }
  const MARKER_COLORS = ["#facc15","#34d399","#60a5fa","#f87171","#c084fc","#fb923c"];
  const [markers, setMarkers]           = useState<Marker[]>([]);
  const [editingMarkerId, setEditingMarkerId] = useState<string|null>(null);
  const addMarker = (t: number, label?: string) => {
    const color = MARKER_COLORS[markers.length % MARKER_COLORS.length];
    setMarkers(prev => [...prev, { id: uid(), timeSec: t, label: label ?? `م${prev.length+1}`, color }]);
  };
  const renameMarker = (id: string, label: string) =>
    setMarkers(prev => prev.map(m => m.id===id ? {...m, label} : m));
  const removeMarker = (id: string) => setMarkers(prev => prev.filter(m => m.id!==id));
  const jumpToMarker  = (t: number) => { setPlayerTime(t); if(playerRef.current) playerRef.current.currentTime=t; };
  // تصدير العلامات كـ CSV
  const exportMarkers = () => {
    if (markers.length === 0) { toast.error("لا توجد علامات للتصدير"); return; }
    const csv = "Label,Time\n" + markers.map(m => `${m.label},${m.timeSec.toFixed(3)}`).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const a    = document.createElement("a"); a.href = URL.createObjectURL(blob);
    a.download = `${fileName}-markers.csv`; a.click();
    toast.success("تم تصدير العلامات كـ CSV");
  };

  // ── Loop preview ─────────────────────────────────────────────────────────────
  const [loopEnabled, setLoopEnabled] = useState(false);
  const loopSrcRef = useRef<AudioBufferSourceNode|null>(null);
  const loopCtxRef = useRef<AudioContext|null>(null);
  const startLoop = useCallback((s: number, e: number) => {
    if (!audioBuffer) return;
    try { loopSrcRef.current?.stop(); } catch { /**/ }
    loopCtxRef.current?.close().catch(() => {});
    const ctx = new AudioContext(); loopCtxRef.current = ctx;
    const src = ctx.createBufferSource(); src.buffer = audioBuffer;
    src.loop=true; src.loopStart=s; src.loopEnd=e; src.connect(ctx.destination); src.start(0,s);
    loopSrcRef.current = src;
  }, [audioBuffer]);
  const stopLoop = useCallback(() => {
    try { loopSrcRef.current?.stop(); } catch { /**/ }
    loopSrcRef.current=null; loopCtxRef.current?.close().catch(()=>{}); loopCtxRef.current=null;
    setLoopEnabled(false);
  }, []);
  useEffect(() => () => stopLoop(), [stopLoop]);

  // ── Normalize ────────────────────────────────────────────────────────────────
  const [isNormalizing, setIsNormalizing] = useState(false);
  const handleNormalize = useCallback(async () => {
    if (!audioBuffer || isNormalizing) return;
    setIsNormalizing(true);
    try {
      const numCh = audioBuffer.numberOfChannels;
      let peak = 0;
      for (let ch=0; ch<numCh; ch++) {
        const d = audioBuffer.getChannelData(ch);
        for (let i=0; i<d.length; i++) { const v=Math.abs(d[i]); if(v>peak) peak=v; }
      }
      if (peak < 0.001) { toast.error("الملف صامت أو مستواه صفر"); return; }
      const gain = Math.min(0.98/peak, 6);
      const tempCtx = new AudioContext();
      const out  = tempCtx.createBuffer(numCh, audioBuffer.length, audioBuffer.sampleRate);
      for (let ch=0; ch<numCh; ch++) {
        const s=audioBuffer.getChannelData(ch), d=out.getChannelData(ch);
        for (let i=0; i<s.length; i++) d[i]=s[i]*gain;
      }
      tempCtx.close().catch(() => {});
      const name = fileName.replace(/\.[^.]+$/,"")+"-normalized.wav";
      storeResult(out, name); // storeResult تستدعي onUseInPlayer تلقائياً
      addChip(`📊 ×${gain.toFixed(1)}`, "norm");
      toast.success(`✓ تم التطبيع — رُفع المستوى ${((gain-1)*100).toFixed(0)}%`);
    } finally { setIsNormalizing(false); }
  }, [audioBuffer, fileName, isNormalizing]); // eslint-disable-line

  // ── Quick Split at Playhead ───────────────────────────────────────────────────
  const handleSplit = useCallback(() => {
    if (!audioBuffer || !ready) return;
    const t = playerTime;
    if (t<0.1 || t>audioBuffer.duration-0.1) { toast.error("الـ playhead قريب من الحافة"); return; }
    // أضف نطاق صغير عند نقطة الفصل + علامة
    setRanges(prev => [...prev, makeRange(Math.max(0,t-0.01), Math.min(audioBuffer.duration,t+0.01))]);
    if (tab !== "multi") setTab("multi");
    addMarker(t, `✂ ${fmt(t)}`);
    toast.success(`فصل عند ${fmt(t)} — استخدم "حذف النطاقات" لتطبيقه`);
  }, [audioBuffer, playerTime, ready, tab, markers]); // eslint-disable-line

  // ── Waveform Color Theme ─────────────────────────────────────────────────────
  const THEMES = [
    { id:"slate",  label:"كلاسيكي", wave:"#94a3b8", sel:"#3b82f6" },
    { id:"green",  label:"أودaسيتي",wave:"#4ade80", sel:"#22c55e" },
    { id:"violet", label:"مخصص",   wave:"#a78bfa", sel:"#8b5cf6" },
    { id:"amber",  label:"دافئ",   wave:"#fbbf24", sel:"#f59e0b" },
  ] as const;
  type ThemeId = typeof THEMES[number]["id"];
  const [themeId, setThemeId] = useState<ThemeId>("slate");
  const theme = THEMES.find(t => t.id === themeId) ?? THEMES[0];

  // ── Speed Preview ─────────────────────────────────────────────────────────────
  const [playbackRate, setPlaybackRate] = useState(1);
  const SPEED_OPTIONS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;
  useEffect(() => { if (playerRef.current) playerRef.current.playbackRate = playbackRate; }, [playbackRate]);

  // ── Zoom to Selection (يُمرَّر للـ WaveformEditor) ────────────────────────────
  const [waveZoom, setWaveZoom] = useState<{ s: number; e: number } | null>(null);

  // ── Crossfade duration ────────────────────────────────────────────────────────
  const [crossfadeDur, setCrossfadeDur] = useState(0.04);

  // ── Silence Jump ─────────────────────────────────────────────────────────────
  const handleSilenceJump = useCallback((dir: 1|-1) => {
    if (!audioBuffer) return;
    const sr = audioBuffer.sampleRate, ch = audioBuffer.getChannelData(0);
    const W  = Math.floor(sr * 0.05), thr = Math.pow(10, -50/10);
    const cur = Math.floor(playerTime * sr);
    const start = dir===1 ? Math.floor(cur/W)+1 : Math.floor(cur/W)-2;
    const end   = dir===1 ? Math.ceil(ch.length/W) : -1;
    for (let w=start; dir===1 ? w<end : w>end; w+=dir) {
      let ste=0; const ws=w*W, we=Math.min((w+1)*W,ch.length);
      for (let i=ws; i<we; i++) ste+=ch[i]*ch[i]; ste/=W;
      if (ste<thr) {
        const t=(w*W)/sr; setPlayerTime(t);
        if (playerRef.current) playerRef.current.currentTime=t;
        toast.success(`صمت: ${fmt(t)}`); return;
      }
    }
    toast.error("لا يوجد صمت في هذا الاتجاه");
  }, [audioBuffer, playerTime]); // eslint-disable-line

  // ── Region Export ─────────────────────────────────────────────────────────────
  const handleRegionExport = useCallback(async () => {
    if (!audioBuffer || markers.length===0) { toast.error("أضف علامات لتحديد نقاط الفصل"); return; }
    const pts = [0, ...[...markers].sort((a,b)=>a.timeSec-b.timeSec).map(m=>m.timeSec), audioBuffer.duration];
    let n=0;
    for (let i=0; i<pts.length-1; i++) {
      const s=pts[i], e=pts[i+1]; if(e-s<0.5) continue;
      const buf=await AudioTrimmerEngine.trimWithFade(audioBuffer,s,e,0.02);
      const blob=AudioExporter.toWav(buf);
      const label=i<markers.length?([...markers].sort((a,b)=>a.timeSec-b.timeSec)[i]?.label??`r${i+1}`):`r${i+1}`;
      const exportUrl=URL.createObjectURL(blob);
      const a=document.createElement("a"); a.href=exportUrl;
      a.download=`${fileName.replace(/\.[^.]+$/,"")}-${label}.wav`; a.click();
      URL.revokeObjectURL(exportUrl);
      n++; await new Promise(r=>setTimeout(r,300));
    }
    toast.success(`✓ تم تصدير ${n} ملف`);
  }, [audioBuffer, markers, fileName]); // eslint-disable-line

  // ── Single selection ────────────────────────────────────────────────────────
  // originalFileName — لا يتغيّر أبداً — يمنع تراكم -cut-cut-cut في الاسم
  const originalFileName = useRef(fileName);
  const [selStart, setSelStart]     = useState(0);
  const [selEnd, setSelEnd]         = useState(0);
  const [startInput, setStartInput] = useState("0:00.0");
  const [endInput, setEndInput]     = useState("0:00.0");
  const [editMode, setEditMode]     = useState<EditMode>("keep");
  const [gapSec, setGapSec]         = useState<GapOption>(0.5);

  // ── Multi-range ─────────────────────────────────────────────────────────────
  const [ranges, setRanges]     = useState<DeleteRange[]>([]);
  const [multiGap, setMultiGap] = useState<GapOption>(0.5);

  // ── Processing ──────────────────────────────────────────────────────────────
  const [processing, setProcessing]     = useState<Processing>(false);
  const [procProgress, setProcProgress] = useState(0);

  // ── Export result ───────────────────────────────────────────────────────────
  // الـ AudioBuffer الناتج عن آخر عملية — يبقى حتى عملية جديدة أو تغيير الـ URL
  const [resultBuffer, setResultBuffer]   = useState<AudioBuffer | null>(null);
  const [resultName, setResultName]       = useState("");
  const [exportFormat, setExportFormat]   = useState<ExportFormat>("wav");
  const [mp3Bitrate, setMp3Bitrate]       = useState<Mp3Bitrate>(DEFAULT_MP3_BITRATE);
  const [exportFileName, setExportFileName] = useState("");
  const [isExporting, setIsExporting]     = useState(false);

  // ── Preview ─────────────────────────────────────────────────────────────────
  const previewSrcRef = useRef<AudioBufferSourceNode | null>(null);
  const previewCtxRef = useRef<AudioContext | null>(null);
  const [isPreviewing, setIsPreviewing] = useState(false);

  // ── Undo (managed by Tools.tsx) ────────────────────────────────────────────
  // undoRef القديم حُذف — الـ undo/redo الآن في Tools.tsx عبر onUndo/onRedo

  // ── Active range index for multi (for player-time capture) ─────────────────
  const [activeRangeIdx, setActiveRangeIdx] = useState<number>(-1);

  // ── Load ────────────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    setLoadState("loading"); setAudioBuffer(null);
    setPlayerTime(0); setPlayerDuration(0); setPlayerPlaying(false);
    stopPreview();
    AudioTrimmerEngine.loadBuffer(audioUrl)
      .then(buf => {
        if (cancelled) return;
        setAudioBuffer(buf);
        setSelStart(0); setSelEnd(buf.duration);
        setStartInput(fmt(0)); setEndInput(fmt(buf.duration));
        setLoadState("ready");
      })
      .catch(() => { if (!cancelled) setLoadState("error"); });
    return () => { cancelled = true; stopPreview(); };
  }, [audioUrl]);

  useEffect(() => { setStartInput(fmt(selStart)); }, [selStart]);
  useEffect(() => { setEndInput(fmt(selEnd)); },   [selEnd]);

  // ── Player ──────────────────────────────────────────────────────────────────
  const jumpPlayer = (d: number) => {
    const el = playerRef.current; if (!el) return;
    const t = clamp(el.currentTime + d, 0, el.duration || 0);
    el.currentTime = t; setPlayerTime(t);
  };

  // ── Preview ──────────────────────────────────────────────────────────────────
  const stopPreview = useCallback(() => {
    try { previewSrcRef.current?.stop(); } catch { /* stopped */ }
    previewSrcRef.current = null;
    previewCtxRef.current?.close().catch(() => {});
    previewCtxRef.current = null;
    setIsPreviewing(false);
  }, []);

  const handlePreview = useCallback(() => {
    if (!audioBuffer) return;
    if (isPreviewing) { stopPreview(); return; }
    try {
      const ctx = new AudioContext();
      previewCtxRef.current = ctx;
      const src = ctx.createBufferSource();
      src.buffer = audioBuffer;
      src.connect(ctx.destination);
      src.start(0, selStart, selEnd - selStart);
      previewSrcRef.current = src;
      setIsPreviewing(true);
      src.onended = () => { if (previewSrcRef.current === src) stopPreview(); };
    } catch { toast.error("فشل تشغيل المعاينة"); stopPreview(); }
  }, [audioBuffer, selStart, selEnd, isPreviewing, stopPreview]);

  // ── Single helpers — must be defined BEFORE keyboard useEffect ────────────
  const applyStart = (v: number) => { setSelStart(clamp(v, 0, selEnd - 0.05)); stopPreview(); };
  const applyEnd   = (v: number) => { setSelEnd(clamp(v, selStart + 0.05, totalDuration)); stopPreview(); };
  const commitSI   = () => { const v = AudioTrimmerEngine.parseMmSs(startInput); v === null ? setStartInput(fmt(selStart)) : applyStart(v); };
  const commitEI   = () => { const v = AudioTrimmerEngine.parseMmSs(endInput);   v === null ? setEndInput(fmt(selEnd))     : applyEnd(v); };

  // ── Keyboard shortcuts ────────────────────────────────────────────────────
  // تعمل فقط خارج حقول الإدخال لتجنب التعارض مع الكتابة
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      switch (e.code) {
        case "Space":
          e.preventDefault();
          if (playerRef.current) {
            playerPlaying ? playerRef.current.pause() : playerRef.current.play();
          }
          break;
        case "KeyS":
          e.preventDefault();
          if (tab === "single") applyStart(playerTime);
          else setLastRangeFromPlayer("start");
          break;
        case "KeyE":
          e.preventDefault();
          if (tab === "single") applyEnd(playerTime);
          else setLastRangeFromPlayer("end");
          break;
        case "KeyA":
          if (tab === "multi") { e.preventDefault(); addRange(); }
          break;
        case "KeyM":
          e.preventDefault();
          if (ready) { addMarker(playerTime); toast.success(`🔖 علامة: ${fmt(playerTime)}`); }
          break;
        case "KeyL":
          e.preventDefault();
          if (!loopEnabled && selStart < selEnd) { setLoopEnabled(true); startLoop(selStart, selEnd); }
          else stopLoop();
          break;
        case "KeyN":
          e.preventDefault();
          handleNormalize();
          break;
        case "KeyT":
          // T = Split at playhead
          e.preventDefault();
          handleSplit();
          break;
        case "KeyZ":
          // Z = Zoom to selection
          e.preventDefault();
          if (selStart < selEnd) setWaveZoom({ s: selStart, e: selEnd });
          break;
        case "ArrowRight":
          if (e.shiftKey) { e.preventDefault(); handleSilenceJump(1); }
          break;
        case "ArrowLeft":
          if (e.shiftKey) { e.preventDefault(); handleSilenceJump(-1); }
          break;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [tab, playerTime, playerPlaying, selStart, selEnd, totalDuration, ranges]); // eslint-disable-line
  // ── Store result helper ───────────────────────────────────────────────────
  const storeResult = (buf: AudioBuffer, suggestedName: string) => {
    setResultBuffer(buf);
    setResultName(suggestedName);
    // اقترح اسم الملف حسب الصيغة الحالية
    const dot  = suggestedName.lastIndexOf(".");
    const base = dot !== -1 ? suggestedName.slice(0, dot) : suggestedName;
    setExportFileName(`${base}.${exportFormat}`);
    // ── تحديث GuidedWorkflow تلقائياً بعد كل عملية ──────────────────────
    // هذا يضمن أن Save Final Audio دائماً يُصدّر أحدث نسخة
    const wavBlob = AudioExporter.toWav(buf);
    onUseInPlayer(wavBlob, suggestedName);
  };

  // ── Single process ────────────────────────────────────────────────────────
  const runSingle = async (mode: EditMode) => {
    if (!audioBuffer) { toast.error("الملف لم يُحمَّل"); return; }
    const err = AudioTrimmerEngine.validateRange(selStart, selEnd, totalDuration, { allowNearFull: true });
    if (err) { toast.error(err); return; }
    stopPreview();
    setProcessing(mode === "keep" ? "trim" : "cut"); setProcProgress(10);
    try {
      setProcProgress(40);
      const buf = mode === "keep"
        ? await AudioTrimmerEngine.trimWithFade(audioBuffer, selStart, selEnd, 0.02)
        : await AudioTrimmerEngine.deleteRange(audioBuffer, selStart, selEnd, gapSec, 0.02);
      setProcProgress(90);
      const name = mode === "keep"
        ? AudioTrimmerEngine.buildFileName(originalFileName.current)
        : AudioTrimmerEngine.buildCutFileName(originalFileName.current);
      storeResult(buf, name);
      setProcProgress(100);
      toast.success("تمت المعالجة ✓ — اختر صيغة التصدير");
    } catch (e) { toast.error(e instanceof Error ? e.message : "فشلت العملية"); }
    finally { setProcessing(false); setProcProgress(0); }
  };

  /** معالجة فورية + تحميل في المشغل بخطوة واحدة */
  const runAndApply = async (mode: EditMode) => {
    if (!audioBuffer) { toast.error("الملف لم يُحمَّل"); return; }
    const err = AudioTrimmerEngine.validateRange(selStart, selEnd, totalDuration, { allowNearFull: true });
    if (err) { toast.error(err); return; }
    stopPreview();
    setProcessing(mode === "keep" ? "trim" : "cut"); setProcProgress(10);
    try {
      setProcProgress(40);
      const buf = mode === "keep"
        ? await AudioTrimmerEngine.trimWithFade(audioBuffer, selStart, selEnd, 0.02)
        : await AudioTrimmerEngine.deleteRange(audioBuffer, selStart, selEnd, gapSec, 0.02);
      setProcProgress(90);
      const name = mode === "keep"
        ? AudioTrimmerEngine.buildFileName(originalFileName.current)
        : AudioTrimmerEngine.buildCutFileName(originalFileName.current);
      storeResult(buf, name);
      // storeResult تستدعي onUseInPlayer تلقائياً — لا داعي للاستدعاء المكرر
      setProcProgress(100);
      toast.success(mode === "keep" ? "✓ تم الاقتصاص وتحميله في المشغل" : "✓ تم الحذف وتحميله في المشغل");
    } catch (e) { toast.error(e instanceof Error ? e.message : "فشلت العملية"); }
    finally { setProcessing(false); setProcProgress(0); }
  };

  // ── Multi helpers ─────────────────────────────────────────────────────────
  const addRange = () => {
    const lastEnd = ranges.length > 0 ? (ranges[ranges.length-1].endSec ?? 0) : playerTime;
    const s = Math.min(lastEnd, Math.max(0, totalDuration - 1));
    const e = Math.min(s + 10, totalDuration);
    setRanges(prev => [...prev, makeRange(s, e)]);
  };

  const removeRange = (id: string) => setRanges(prev => prev.filter(r => r.id !== id));

  const updateInput = (id: string, field: "startInput" | "endInput", val: string) => {
    setRanges(prev => prev.map(r => {
      if (r.id !== id) return r;
      const parsed = AudioTrimmerEngine.parseMmSs(val);
      return field === "startInput"
        ? { ...r, startInput: val, startSec: parsed }
        : { ...r, endInput: val, endSec: parsed };
    }));
  };

  const commitInput = (id: string, field: "startInput" | "endInput") => {
    setRanges(prev => prev.map(r => {
      if (r.id !== id) return r;
      if (field === "startInput") {
        const v = AudioTrimmerEngine.parseMmSs(r.startInput);
        if (v === null) return { ...r, startInput: fmt(r.startSec ?? 0) };
        const c = clamp(v, 0, (r.endSec ?? totalDuration) - 0.05);
        return { ...r, startSec: c, startInput: fmt(c) };
      } else {
        const v = AudioTrimmerEngine.parseMmSs(r.endInput);
        if (v === null) return { ...r, endInput: fmt(r.endSec ?? 0) };
        const c = clamp(v, (r.startSec ?? 0) + 0.05, totalDuration);
        return { ...r, endSec: c, endInput: fmt(c) };
      }
    }));
  };

  const setLastRangeFromPlayer = (field: "start" | "end") => {
    if (ranges.length === 0) return;
    const t = playerTime;
    setRanges(prev => {
      const arr = [...prev];
      const last = { ...arr[arr.length-1] };
      if (field === "start") { const c = clamp(t, 0, (last.endSec ?? totalDuration)-0.05); last.startSec=c; last.startInput=fmt(c); }
      else                   { const c = clamp(t, (last.startSec??0)+0.05, totalDuration);  last.endSec=c;   last.endInput=fmt(c); }
      arr[arr.length-1] = last;
      return arr;
    });
  };

  // ── Multi process ─────────────────────────────────────────────────────────
  const runMulti = async () => {
    if (!audioBuffer) { toast.error("الملف لم يُحمَّل"); return; }
    if (ranges.length === 0) { toast.error("أضف نطاقاً واحداً على الأقل"); return; }
    const invalid = ranges.find(r => r.startSec===null || r.endSec===null || r.endSec! - r.startSec! < 0.05);
    if (invalid) { toast.error("بعض النطاقات تحتوي قيماً غير صالحة"); return; }
    stopPreview();
    setProcessing("multi"); setProcProgress(10);
    try {
      const rr = ranges.map(r => ({ start: r.startSec!, end: r.endSec! }));
      setProcProgress(40);
      const buf  = await AudioTrimmerEngine.deleteMultipleRanges(audioBuffer, rr, multiGap, 0.02);
      setProcProgress(90);
      const name = AudioTrimmerEngine.buildCutFileName(originalFileName.current);
      storeResult(buf, name);
      // storeResult تستدعي onUseInPlayer تلقائياً
      setProcProgress(100);
      toast.success(`✓ تم حذف ${rr.length} نطاقات وتحميل الناتج في المشغل`);
    } catch (e) { toast.error(e instanceof Error ? e.message : "فشلت العملية"); }
    finally { setProcessing(false); setProcProgress(0); }
  };


  // ── Export result ─────────────────────────────────────────────────────────
  const [exportStatus, setExportStatus] = useState<"idle" | "encoding" | "done" | "error">("idle");
  const [exportError, setExportError]   = useState("");

  const handleExport = async () => {
    if (!resultBuffer) { toast.error("لا يوجد ناتج للتصدير"); return; }

    setIsExporting(true);
    setExportStatus("encoding");
    setExportError("");

    try {
      // 1. Encode
      const blob = await AudioExporter.export(resultBuffer, {
        format: exportFormat,
        mp3Bitrate,
      });

      // 2. Validate
      if (blob.size === 0) {
        throw new Error("الملف الناتج فارغ — حاول مرة أخرى");
      }

      // 3. Build filename
      const name = exportFileName.trim()
        || AudioExporter.buildExportName(fileName, exportFormat);

      // 4. Download — sync, no await needed
      AudioExporter.downloadBlob(blob, name);

      setExportStatus("done");
      toast.success(`بدأ تحميل: ${name}`);

      // أعد الحالة بعد ثانيتين
      setTimeout(() => setExportStatus("idle"), 2000);

    } catch (e) {
      const msg = e instanceof Error ? e.message : "خطأ غير معروف";
      setExportStatus("error");
      setExportError(msg);
      toast.error(`فشل التصدير: ${msg}`);
    } finally {
      setIsExporting(false);
    }
  };

  const handleUseResultInPlayer = () => {
    if (!resultBuffer) { toast.error("لا يوجد ناتج"); return; }
    const wavBlob = AudioExporter.toWav(resultBuffer);
    const name = exportFileName || resultName || AudioTrimmerEngine.buildFileName(originalFileName.current);
    onUseInPlayer(wavBlob, name);
    toast.success("تم تحميل الناتج في المشغل ✓");
  };

  // تحديث اسم الملف عند تغيير الصيغة
  const handleFormatChange = (fmt: ExportFormat) => {
    setExportFormat(fmt);
    if (resultName) {
      const dot  = resultName.lastIndexOf(".");
      const base = dot !== -1 ? resultName.slice(0, dot) : resultName;
      setExportFileName(`${base}.${fmt}`);
    }
  };

  const busy  = processing !== false;

  const chipColors: Record<HistoryChip["type"], string> = {
    cut:   "bg-red-100 dark:bg-red-950 text-red-600 dark:text-red-400 border-red-200 dark:border-red-800",
    keep:  "bg-blue-100 dark:bg-blue-950 text-blue-600 dark:text-blue-400 border-blue-200 dark:border-blue-800",
    multi: "bg-purple-100 dark:bg-purple-950 text-purple-600 dark:text-purple-400 border-purple-200 dark:border-purple-800",
    split: "bg-orange-100 dark:bg-orange-950 text-orange-600 dark:text-orange-400 border-orange-200 dark:border-orange-800",
    norm:  "bg-green-100 dark:bg-green-950 text-green-600 dark:text-green-400 border-green-200 dark:border-green-800",
  };

  // ── UX simplification states ──────────────────────────────────────────────
  const [showKeyboardHelp, setShowKeyboardHelp] = useState(false);
  const [showAllHistory, setShowAllHistory]     = useState(false);
  const [showAdvancedExport, setShowAdvancedExport] = useState(false);
  // Crossfade toggle — "انتقال ناعم" = 50ms داخلياً
  const smoothTransition = crossfadeDur > 0;
  const toggleSmooth = () => setCrossfadeDur(v => v > 0 ? 0 : 0.05);
  // Speed simplified
  const SPEED_SIMPLE = [
    { label: "بطيء", value: 0.75 },
    { label: "عادي", value: 1 },
    { label: "سريع", value: 1.5 },
  ] as const;
  // mm:ss.d
  const fmtMs = (t: number) => {
    if (!t || isNaN(t) || !isFinite(t)) return "0:00.0";
    return `${Math.floor(t/60)}:${Math.floor(t%60).toString().padStart(2,"0")}.${Math.floor((t%1)*10)}`;
  };
  return (
    <div className="relative flex flex-col gap-0 pb-16">

      {/* hidden audio */}
      <audio ref={playerRef} src={audioUrl}
        onTimeUpdate={e => setPlayerTime(e.currentTarget.currentTime)}
        onDurationChange={e => setPlayerDuration(e.currentTarget.duration)}
        onPlay={() => setPlayerPlaying(true)}
        onPause={() => setPlayerPlaying(false)}
        onEnded={() => setPlayerPlaying(false)}/>

      {/* ── STUDIO CARD ─────────────────────────────────────────────────── */}
      <div className="rounded-2xl overflow-hidden border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-sm">

        {/* ── Studio Header ──────────────────────────────────────────────── */}
        <div className="flex items-center gap-3 px-4 py-3 bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-700">
          {/* File name */}
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-violet-600 flex items-center justify-center flex-shrink-0">
              <Scissors className="w-4 h-4 text-white"/>
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-slate-800 dark:text-slate-200 truncate">{fileName}</p>
              <p className="text-xs text-slate-400 tabular-nums">
                {ready ? `${fmt(playerDuration)} · ${loadState === "ready" ? "جاهز" : ""}` : "جاري التحميل..."}
              </p>
            </div>
          </div>

          {/* Undo / Redo */}
          <div className="flex items-center gap-0.5">
            <button onClick={onUndo} disabled={undoCount===0||!onUndo}
              className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-25 transition-all"
              title={`تراجع (${undoCount})`}>
              <RotateCcw className="w-3.5 h-3.5"/>
            </button>
            <button onClick={onRedo} disabled={redoCount===0||!onRedo}
              className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700 disabled:opacity-25 transition-all"
              title={`إعادة (${redoCount})`}>
              <RotateCcw className="w-3.5 h-3.5 scale-x-[-1]"/>
            </button>
          </div>

          {/* Save shortcut */}
          <button
            onClick={() => { setShowExportPanel(true); setTimeout(() => exportPanelRef.current?.scrollIntoView({ behavior:"smooth", block:"center" }), 80); }}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold
                       bg-emerald-600 hover:bg-emerald-500 text-white transition-colors shadow-sm">
            <Download className="w-3.5 h-3.5"/>حفظ
          </button>
        </div>

        {/* ── Seekbar + Time counter ─────────────────────────────────────── */}
        <div className="px-0">
          <div className="relative">
            <input type="range" min={0} max={playerDuration||1} step={0.05} value={playerTime}
              onChange={e => { const t=parseFloat(e.target.value); setPlayerTime(t); if(playerRef.current) playerRef.current.currentTime=t; }}
              disabled={!ready}
              className="w-full h-1 accent-blue-500 disabled:opacity-30 cursor-pointer"
              style={{ margin: 0, display: "block" }}/>
          </div>
          {/* Primary time display */}
          <div className="flex items-center justify-between px-4 pt-1.5 pb-1">
            <span className="font-mono text-sm font-semibold text-slate-700 dark:text-slate-300 tabular-nums">
              {fmtMs(playerTime)}
            </span>
            <span className="font-mono text-xs text-slate-400 tabular-nums">
              / {fmtMs(playerDuration)}
            </span>
          </div>
          {/* Selection info — يظهر عند وجود تحديد */}
          {selStart < selEnd && (
            <div className="flex items-center gap-2 px-4 pb-2">
              <span className="text-xs font-mono text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/40 px-2 py-0.5 rounded-lg tabular-nums">
                {fmtMs(selStart)} → {fmtMs(selEnd)}
              </span>
              <span className="text-xs text-slate-400">
                مدة: <strong className="text-slate-600 dark:text-slate-300 font-mono">{fmtMs(selEnd - selStart)}</strong>
              </span>
            </div>
          )}
        </div>

        {/* ── Waveform — PRIMARY — دائماً ظاهر ────────────────────────── */}
        <div className="px-0 pb-0 relative">
          {/* Hint bar */}
          <div className="px-4 py-2 bg-blue-50 dark:bg-blue-950/30 border-y border-blue-100 dark:border-blue-900 flex items-center justify-between">
            <p className="text-xs text-blue-700 dark:text-blue-300">
              اسحب لتحديد جزء · ظهر شريط الإجراءات فوق التحديد مباشرةً
            </p>
            <span className="hidden lg:inline text-xs text-blue-400 font-mono">Alt = ⊘ snap</span>
          </div>
          {loadState === "loading" && (
            <div className="h-28 flex items-center justify-center gap-2 text-slate-400">
              <div className="w-5 h-5 border-2 border-blue-400 border-t-transparent rounded-full animate-spin"/>
              <span className="text-sm">جاري تحميل الموجة...</span>
            </div>
          )}
          {loadState === "error" && (
            <div className="h-28 flex items-center justify-center text-red-400 text-sm">تعذّر تحميل الملف</div>
          )}
          {ready && audioBuffer && (
            <WaveformEditor
              audioBuffer={audioBuffer}
              currentTime={playerTime}
              waveColor={theme.wave}
              selectionColor={theme.sel}
              existingRanges={
                ranges.filter(r => r.startSec !== null && r.endSec !== null)
                  .map(r => ({ id: r.id, startSec: r.startSec!, endSec: r.endSec! }))
              }
              onZoomToSelection={(s, e) => setWaveZoom({ s, e })}
              onDeleteRange={async (s, e) => {                if (!audioBuffer) return;
                stopPreview();
                setProcessing("cut"); setProcProgress(20);
                try {
                  const buf  = await AudioTrimmerEngine.deleteRange(audioBuffer, s, e, gapSec, crossfadeDur);
                  const name = AudioTrimmerEngine.buildCutFileName(originalFileName.current);
                  storeResult(buf, name); // يستدعي onUseInPlayer تلقائياً
                  addChip(`✂ ${fmt(e-s)}`, "cut");
                  toast.success("تم الحذف — يمكنك التراجع");
                } catch (err) { toast.error(err instanceof Error ? err.message : "فشل الحذف"); }
                finally { setProcessing(false); setProcProgress(0); }
              }}
              onCropToRange={async (s, e) => {
                if (!audioBuffer) return;
                stopPreview();
                setProcessing("trim"); setProcProgress(20);
                try {
                  const buf  = await AudioTrimmerEngine.trimWithFade(audioBuffer, s, e, 0.02);
                  const name = AudioTrimmerEngine.buildFileName(originalFileName.current);
                  storeResult(buf, name); // يستدعي onUseInPlayer تلقائياً
                  addChip(`⊡ ${fmt(e-s)}`, "keep");
                  toast.success("تم الاحتفاظ بالمحدد — يمكنك التراجع");
                } catch (err) { toast.error(err instanceof Error ? err.message : "فشل الاقتصاص"); }
                finally { setProcessing(false); setProcProgress(0); }
              }}
              onRangeSelected={(s, e) => {
                const nr = makeRange(s, e);
                setRanges(prev => [...prev, nr]);
                if (tab !== "multi") setTab("multi");
              }}
              onSeek={t => { setPlayerTime(t); if(playerRef.current) playerRef.current.currentTime=t; }}
              height={112}
            />
          )}

          {/* Processing bar — inline */}
          {busy && (
            <div className="absolute bottom-0 left-0 right-0 bg-blue-500/20 backdrop-blur-sm px-4 py-2 flex items-center gap-2">
              <div className="w-3.5 h-3.5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin flex-shrink-0"/>
              <div className="flex-1 bg-blue-200 dark:bg-blue-900 rounded-full h-1">
                <div className="bg-blue-500 h-1 rounded-full transition-all" style={{width:`${procProgress}%`}}/>
              </div>
              <span className="text-xs text-blue-600 dark:text-blue-400 tabular-nums">{procProgress}%</span>
            </div>
          )}
        </div>

        {/* ── Hint + shortcuts — desktop only ──────────────────────────── */}
        <div className="hidden lg:block px-4 py-2 border-t border-slate-100 dark:border-slate-800 bg-slate-50/40 dark:bg-slate-800/20">
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-400 justify-center">
            {[
              ["Space","تشغيل"], ["S","بداية"], ["E","نهاية"],
              ["M","علامة"],     ["L","تكرار"],  ["N","تطبيع"],
              ["T","فصل"],       ["Z","تكبير تحديد"],
              ["⇧→","صمت تالٍ"], ["Alt","⊘ snap"],
            ].map(([k,v]) => (
              <span key={k}>
                <kbd className="font-mono bg-slate-200 dark:bg-slate-700 px-1 rounded text-xs">{k}</kbd>
                {" "}{v}
              </span>
            ))}
          </div>
        </div>

        {/* ── Tools row ─────────────────────────────────────────────────── */}
        <div className="flex items-center gap-2 px-4 py-2.5 border-t border-slate-100 dark:border-slate-800 flex-wrap">

          {/* 🔖 Marker */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button type="button" onClick={() => { if(ready) { addMarker(playerTime); toast.success(`🔖 ${fmt(playerTime)}`); }}}
                disabled={!ready}
                aria-label="إضافة علامة عند الموضع الحالي"
                className="flex items-center gap-1 px-2.5 py-2.5 text-xs font-medium rounded-xl border border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-400 hover:border-yellow-400 hover:text-yellow-600 dark:hover:text-yellow-400 disabled:opacity-40 transition-all">
                🔖 علامة
              </button>
            </TooltipTrigger>
            <TooltipContent>إضافة علامة عند الموضع الحالي</TooltipContent>
          </Tooltip>

          {/* ⟳ Loop */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button type="button" onClick={() => { if(loopEnabled){stopLoop();}else if(selStart<selEnd){setLoopEnabled(true);startLoop(selStart,selEnd);}else toast.error("حدد مقطعاً أولاً لتشغيله بتكرار"); }}
                disabled={!ready}
                aria-label="تشغيل المقطع المحدد بتكرار"
                className={`flex items-center gap-1 px-2.5 py-2.5 text-xs font-medium rounded-xl border transition-all disabled:opacity-40 ${loopEnabled?"bg-violet-100 dark:bg-violet-950 border-violet-400 text-violet-700 dark:text-violet-300":"border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-400 hover:border-violet-400 hover:text-violet-600"}`}>
                {loopEnabled ? "⟳ ●" : "⟳ تكرار"}
              </button>
            </TooltipTrigger>
            <TooltipContent>تشغيل المقطع المحدد بتكرار للمراجعة</TooltipContent>
          </Tooltip>

          {/* 🔍 Zoom to selection */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button type="button" onClick={() => { if(selStart<selEnd) setWaveZoom({s:selStart,e:selEnd}); else toast.error("حدد مقطعاً أولاً للتكبير عليه"); }}
                disabled={!ready}
                aria-label="تكبير الموجة على الجزء المحدد"
                className="flex items-center gap-1 px-2.5 py-2.5 text-xs font-medium rounded-xl border border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-400 hover:border-sky-400 hover:text-sky-600 disabled:opacity-40 transition-all">
                🔍 تكبير
              </button>
            </TooltipTrigger>
            <TooltipContent>تكبير الموجة على الجزء المحدد</TooltipContent>
          </Tooltip>

          {/* ✂ Split */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button type="button" onClick={handleSplit} disabled={!ready}
                aria-label="فصل التسجيل عند موضع التشغيل الحالي"
                className="flex items-center gap-1 px-2.5 py-2.5 text-xs font-medium rounded-xl border border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-400 hover:border-orange-400 hover:text-orange-600 disabled:opacity-40 transition-all">
                ✂ فصل
              </button>
            </TooltipTrigger>
            <TooltipContent>فصل التسجيل عند موضع التشغيل الحالي</TooltipContent>
          </Tooltip>

          {/* 📊 Normalize */}
          <Tooltip>
            <TooltipTrigger asChild>
              <button type="button" onClick={handleNormalize} disabled={!ready||isNormalizing}
                aria-label="رفع مستوى الصوت تلقائياً بدون تشويه"
                className="flex items-center gap-1 px-2.5 py-2.5 text-xs font-medium rounded-xl border border-slate-300 dark:border-slate-600 text-slate-600 dark:text-slate-400 hover:border-blue-400 hover:text-blue-600 disabled:opacity-40 transition-all">
                {isNormalizing ? "..." : "📊 تطبيع"}
              </button>
            </TooltipTrigger>
            <TooltipContent>رفع مستوى الصوت تلقائياً بدون تشويه</TooltipContent>
          </Tooltip>

          {/* ⇧→ Silence jump */}
          <div className="flex items-center gap-0.5">
            <Tooltip>
              <TooltipTrigger asChild>
                <button type="button" onClick={() => handleSilenceJump(-1)} disabled={!ready}
                  aria-label="الانتقال إلى فترة الصمت السابقة"
                  className="px-2 py-2.5 text-xs font-bold rounded-r-none rounded-xl border border-slate-300 dark:border-slate-600 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 transition-all">◀ صمت</button>
              </TooltipTrigger>
              <TooltipContent>الانتقال إلى فترة الصمت السابقة</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <button type="button" onClick={() => handleSilenceJump(1)} disabled={!ready}
                  aria-label="الانتقال إلى فترة الصمت التالية"
                  className="px-2 py-2.5 text-xs font-bold rounded-l-none rounded-xl border border-slate-300 dark:border-slate-600 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 border-r-0">صمت ▶</button>
              </TooltipTrigger>
              <TooltipContent>الانتقال إلى فترة الصمت التالية</TooltipContent>
            </Tooltip>
          </div>

          {/* Region export */}
          {markers.length > 0 && (
            <button onClick={handleRegionExport} disabled={!ready}
              className="flex items-center gap-1 px-2.5 py-2.5 text-xs font-medium rounded-xl border border-emerald-300 dark:border-emerald-700 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-950 disabled:opacity-40 transition-all">
              ⬇ تصدير مناطق
            </button>
          )}

          {/* Marker CSV export */}
          {markers.length > 0 && (
            <button onClick={exportMarkers}
              className="flex items-center gap-1 px-2.5 py-2.5 text-xs font-medium rounded-xl border border-slate-300 dark:border-slate-600 text-slate-500 hover:border-emerald-400 hover:text-emerald-600 transition-all">
              ⬇ CSV
            </button>
          )}
        </div>

        {/* ── Simplified Speed + Smooth Toggle + Advanced ───────────────── */}
        <div className="flex items-center gap-3 px-4 py-2 border-t border-slate-100 dark:border-slate-800 flex-wrap">

          {/* Speed — Slow/Normal/Fast */}
          <div className="flex items-center gap-1">
            <span className="text-xs text-slate-400 ml-1">سرعة:</span>
            {SPEED_SIMPLE.map(s => (
              <button key={s.value} type="button" onClick={() => setPlaybackRate(s.value)}
                className={`px-2.5 py-2 text-xs rounded-lg transition-all ${
                  playbackRate === s.value
                    ? "bg-blue-600 text-white shadow-sm"
                    : "bg-slate-100 dark:bg-slate-800 text-slate-500 hover:bg-slate-200"
                }`}>
                {s.label}
              </button>
            ))}
          </div>

          <div className="w-px h-4 bg-slate-200 dark:bg-slate-700"/>

          {/* Crossfade — toggle */}
          <button type="button" onClick={toggleSmooth}
            className={`flex items-center gap-1.5 px-2.5 py-2 text-xs rounded-lg border transition-all ${
              smoothTransition
                ? "bg-orange-50 dark:bg-orange-950/30 border-orange-300 dark:border-orange-700 text-orange-700 dark:text-orange-400"
                : "border-slate-200 dark:border-slate-700 text-slate-500 hover:border-orange-300"
            }`}>
            <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${smoothTransition ? "bg-orange-500" : "bg-slate-300"}`}/>
            انتقال ناعم
          </button>

          {/* Advanced Settings (theme, keyboard shortcuts) */}
          <button type="button" onClick={() => setShowAdvanced(v => !v)}
            className="mr-auto flex items-center gap-1 text-xs text-slate-400 hover:text-slate-600 transition-colors">
            <span>{showAdvanced ? "▲" : "▼"}</span> إعدادات
          </button>
        </div>

        {/* ── Advanced tools section ─────────────────────────────────── */}
        {ready && (
          <div className="border-t border-slate-100 dark:border-slate-800">
            <button type="button"
              onClick={() => setShowAdvanced(v => !v)}
              className="w-full flex items-center justify-between px-4 py-3 text-xs text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
              <span className="flex items-center gap-2">
                <span className="text-slate-400">{showAdvanced ? "▲" : "▼"}</span>
                <span className="font-medium">أدوات إضافية — استخراج النص والإعدادات</span>
              </span>
              <span className="text-slate-300 dark:text-slate-600">{showAdvanced ? "إخفاء" : "إظهار"}</span>
            </button>

            {showAdvanced && (
              <div className="px-4 py-4 space-y-5 border-t border-slate-100 dark:border-slate-800">
                {/* Transcription — متاح في الأدوات الرئيسية */}
                <div>
                  <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-2">🎤 استخراج النص</p>
                  <p className="text-xs text-slate-400">
                    استخدم أداة "استخراج النص" من القائمة الرئيسية للحصول على النص الكامل.
                  </p>
                </div>

                {/* Theme */}
                <div>
                  <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-2">🎨 لون الموجة</p>
                  <div className="flex items-center gap-2">
                    {THEMES.map(t => (
                      <button key={t.id} type="button" onClick={() => setThemeId(t.id)}
                        title={t.label}
                        className={`w-8 h-8 sm:w-6 sm:h-6 rounded-full border-2 transition-all ${themeId===t.id?"border-slate-600 dark:border-slate-300 scale-110":"border-transparent hover:scale-105"}`}
                        style={{ background: t.wave }}/>
                    ))}
                  </div>
                </div>

                {/* Keyboard shortcuts */}
                <div>
                  <button type="button" onClick={() => setShowKeyboardHelp(v => !v)}
                    className="text-xs text-slate-500 hover:text-slate-700 flex items-center gap-1 mb-2">
                    ⌨ {showKeyboardHelp ? "إخفاء الاختصارات" : "اختصارات لوحة المفاتيح"}
                  </button>
                  {showKeyboardHelp && (
                    <div className="grid grid-cols-2 gap-1 text-xs text-slate-500 dark:text-slate-400">
                      {[
                        ["Space","تشغيل / إيقاف"], ["Delete","حذف التحديد"],
                        ["Enter","احتفظ بالتحديد"], ["Escape","إلغاء التحديد"],
                        ["←/→","تحريك ثانية"], ["Shift+←/→","تحريك 5 ثوانٍ"],
                        ["S","ضع البداية"], ["E","ضع النهاية"],
                        ["M","إضافة علامة"], ["L","تكرار"],
                      ].map(([k,v]) => (
                        <div key={k} className="flex items-center gap-1.5">
                          <span className="bg-slate-200 dark:bg-slate-700 px-1.5 py-0.5 rounded font-mono text-slate-700 dark:text-slate-300 text-xs flex-shrink-0">{k}</span>
                          <span>{v}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Markers timeline ──────────────────────────────────────────── */}
        {markers.length > 0 && playerDuration > 0 && (
          <div className="mx-4 mb-3">
            {/* Timeline strip */}
            <div className="relative h-7 bg-slate-100 dark:bg-slate-800 rounded-xl overflow-visible border border-slate-200 dark:border-slate-700">
              {/* Progress */}
              <div className="absolute left-0 top-0 h-full bg-blue-200/50 dark:bg-blue-800/30 rounded-xl transition-all pointer-events-none"
                style={{ width:`${(playerTime/playerDuration)*100}%` }}/>

              {markers.map(m => {
                const pct = (m.timeSec / playerDuration) * 100;
                return (
                  <div key={m.id}
                    className="absolute top-0 h-full flex flex-col items-center group"
                    style={{ left:`${pct}%`, transform:"translateX(-50%)", zIndex:10 }}>
                    {/* Stem */}
                    <div className="w-0.5 h-full opacity-70 group-hover:opacity-100 transition-opacity"
                      style={{ background: m.color }}/>
                    {/* Head — click to jump, double-click to rename, right-click to delete */}
                    <div
                      className="absolute -top-1 w-3.5 h-3.5 rounded-full shadow-md cursor-pointer hover:scale-125 transition-transform"
                      style={{ background: m.color, transform:"translateX(-50%) translateY(0)" }}
                      onClick={() => jumpToMarker(m.timeSec)}
                      onDoubleClick={() => setEditingMarkerId(m.id)}
                      onContextMenu={e => { e.preventDefault(); removeMarker(m.id); }}
                      title={`${m.label} — ${fmt(m.timeSec)} | انقر للانتقال · دبل انقر للتسمية · كليك يمين للحذف`}
                    />
                    {/* Label — inline edit on double-click */}
                    {editingMarkerId === m.id ? (
                      <input autoFocus
                        className="absolute -bottom-6 text-xs bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded px-1 py-0.5 w-16 text-center shadow-lg z-20"
                        defaultValue={m.label}
                        onBlur={e => { renameMarker(m.id, e.target.value||m.label); setEditingMarkerId(null); }}
                        onKeyDown={e => { if(e.key==="Enter"||e.key==="Escape") { renameMarker(m.id,(e.target as HTMLInputElement).value||m.label); setEditingMarkerId(null); }}}
                      />
                    ) : (
                      <span
                        className="absolute bottom-0.5 text-xs font-bold opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap select-none"
                        style={{ color: m.color, transform:"translateX(-50%)", left:"50%" }}>
                        {m.label}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="flex items-center justify-between mt-1">
              <p className="text-xs text-slate-400">
                {markers.length} علامة · انقر للانتقال · دبل انقر للتسمية · كليك يمين للحذف
              </p>
              <button onClick={() => setMarkers([])}
                className="text-xs text-slate-300 dark:text-slate-600 hover:text-red-400 transition-colors">
                مسح الكل
              </button>
            </div>
          </div>
        )}

        {/* ── History — last action only ────────────────────────────────── */}
        {historyChips.length > 0 && (
          <div className="flex items-center gap-2 px-4 py-2 border-t border-slate-100 dark:border-slate-800">
            <span className="text-xs text-slate-400 flex-shrink-0">آخر عملية:</span>
            <span className={`flex-shrink-0 text-xs px-2.5 py-1 rounded-full border font-medium ${chipColors[historyChips[historyChips.length-1].type] ?? "bg-slate-100 dark:bg-slate-800 text-slate-500 border-slate-200"}`}>
              {historyChips[historyChips.length-1].label}
            </span>
            {historyChips.length > 1 && (
              <button type="button" onClick={() => setShowAllHistory(v => !v)}
                className="text-xs text-slate-400 hover:text-slate-600 transition-colors">
                {showAllHistory ? "إخفاء" : `+${historyChips.length - 1} أخرى`}
              </button>
            )}
            {showAllHistory && historyChips.slice(0, -1).reverse().map(c => (
              <span key={c.id} className={`flex-shrink-0 text-xs px-2 py-0.5 rounded-full border opacity-60 ${chipColors[c.type] ?? ""}`}>
                {c.label}
              </span>
            ))}
            <button type="button" onClick={() => { setHistoryChips([]); setShowAllHistory(false); }}
              className="flex-shrink-0 text-xs text-slate-300 dark:text-slate-600 hover:text-slate-500 mr-auto transition-colors">
              مسح
            </button>
          </div>
        )}

        {/* ── Advanced editing (accordion) ───────────────────────────────── */}
        <div className="border-t border-slate-100 dark:border-slate-800">
          <button onClick={() => setShowAdvanced(v => !v)}
            className="w-full flex items-center justify-between px-4 py-3 text-xs text-slate-500 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
            <span className="flex items-center gap-2">
              <span className="text-slate-400">{showAdvanced ? "▲" : "▼"}</span>
              <span className="font-medium">أدوات إضافية — تحرير بالنطاقات</span>
            </span>
            <span className="text-slate-300 dark:text-slate-600">{showAdvanced ? "إخفاء" : "إظهار"}</span>
          </button>

          {showAdvanced && (
            <div className="px-4 pb-5 space-y-4 border-t border-slate-100 dark:border-slate-800 pt-4">

              {/* Tab */}
              <div className="flex gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-xl">
                {([["single","✂ فردي"],["multi","🗑 متعدد"]] as const).map(([id, label]) => (
                  <button key={id} onClick={() => setTab(id)}
                    className={`flex-1 py-1.5 text-xs font-medium rounded-lg transition-all ${
                      tab===id ? "bg-white dark:bg-slate-900 shadow-sm text-slate-800 dark:text-slate-200" : "text-slate-500"
                    }`}>
                    {label}
                  </button>
                ))}
              </div>

              {/* Single tab */}
              {tab === "single" && (
                <div className="space-y-3">
                  <div className="flex gap-1.5">
                    {(["cut","keep"] as EditMode[]).map(m => (
                      <button key={m} onClick={() => setEditMode(m)}
                        className={`flex-1 py-2 text-xs font-semibold rounded-xl border transition-all ${
                          editMode===m
                            ? m==="cut" ? "bg-red-600 border-red-600 text-white shadow-sm" : "bg-blue-600 border-blue-600 text-white shadow-sm"
                            : "border-slate-300 dark:border-slate-600 text-slate-500 hover:border-slate-400"
                        }`}>
                        {m==="cut" ? "✂ احذف النطاق" : "⊡ احتفظ بالنطاق"}
                      </button>
                    ))}
                  </div>

                  {/* S/E capture */}
                  <div className="grid grid-cols-2 gap-2">
                    {([
                      { label:"البداية", kbd:"S", fn:() => applyStart(playerTime), val:fmt(selStart), color:"blue" },
                      { label:"النهاية", kbd:"E", fn:() => applyEnd(playerTime),   val:fmt(selEnd),   color:"emerald" },
                    ] as const).map(({ label, kbd, fn, val, color }) => (
                      <button key={label} onClick={fn} disabled={!ready}
                        className={`flex items-center justify-between px-3 py-2.5 rounded-xl border text-xs transition-all disabled:opacity-40 ${
                          color==="blue"
                            ? "border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950 hover:bg-blue-100 dark:hover:bg-blue-900"
                            : "border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950 hover:bg-emerald-100 dark:hover:bg-emerald-900"
                        }`}>
                        <span className={`flex items-center gap-1 font-medium ${color==="blue"?"text-blue-700 dark:text-blue-300":"text-emerald-700 dark:text-emerald-300"}`}>
                          <kbd className={`font-mono text-xs px-1 rounded ${color==="blue"?"bg-blue-200 dark:bg-blue-800":"bg-emerald-200 dark:bg-emerald-800"}`}>{kbd}</kbd>
                          {label}
                        </span>
                        <span className={`font-mono font-semibold ${color==="blue"?"text-blue-600 dark:text-blue-400":"text-emerald-600 dark:text-emerald-400"}`}>{val}</span>
                      </button>
                    ))}
                  </div>

                  {/* Sliders */}
                  <div className="space-y-2">
                    <input type="range" min={0} max={Math.max(selEnd-0.05, 0)} step={0.05} value={selStart} disabled={!ready}
                      onChange={e => applyStart(parseFloat(e.target.value))}
                      className={`w-full disabled:opacity-40 ${editMode==="cut"?"accent-red-500":"accent-blue-500"}`}/>
                    <input type="range" min={selStart+0.05} max={totalDuration} step={0.05} value={selEnd} disabled={!ready}
                      onChange={e => applyEnd(parseFloat(e.target.value))}
                      className={`w-full disabled:opacity-40 ${editMode==="cut"?"accent-red-500":"accent-blue-500"}`}/>
                  </div>

                  {/* Stats row */}
                  <div className="grid grid-cols-3 gap-2 text-center text-xs">
                    {[
                      { l:"النطاق", v:fmt(selEnd-selStart), accent:true },
                      { l:"الكل",   v:fmt(totalDuration) },
                      { l:"الناتج", v:fmt(editMode==="keep"?selEnd-selStart:Math.max(0,totalDuration-(selEnd-selStart)+gapSec)) },
                    ].map(({l,v,accent}) => (
                      <div key={l} className={`rounded-xl p-2.5 ${accent?"bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800":"bg-slate-50 dark:bg-slate-800"}`}>
                        <p className={`text-xs mb-0.5 ${accent?"text-blue-500":"text-slate-400"}`}>{l}</p>
                        <p className={`font-mono font-bold ${accent?"text-blue-700 dark:text-blue-300":"text-slate-700 dark:text-slate-300"}`}>{v}</p>
                      </div>
                    ))}
                  </div>

                  <Button onClick={() => runAndApply(editMode)} disabled={!ready||busy}
                    className={`w-full h-10 gap-2 font-semibold ${editMode==="cut"?"bg-red-600 hover:bg-red-500":"bg-blue-600 hover:bg-blue-500"} text-white`}>
                    {busy ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"/>جاري...</>
                          : editMode==="cut" ? <><Scissors className="w-4 h-4"/>احذف وطبّق</>
                                            : <><Play className="w-4 h-4"/>احتفظ وطبّق</>}
                  </Button>
                </div>
              )}

              {/* Multi tab */}
              {tab === "multi" && (
                <div className="space-y-3">
                  {ranges.length === 0 ? (
                    <div className="rounded-xl border-2 border-dashed border-slate-300 dark:border-slate-600 p-6 text-center">
                      <p className="text-sm text-slate-400">حدد نطاقات على الموجة أو اضغط إضافة</p>
                      <p className="text-xs text-slate-300 dark:text-slate-600 mt-1">كل نطاق يُمثّل جزءاً سيُحذف</p>
                    </div>
                  ) : (
                    <div className="space-y-1.5 max-h-48 overflow-y-auto">
                      {ranges.map((r, i) => (
                        <div key={r.id}
                          className="flex items-center gap-2 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded-xl px-3 py-2">
                          <span className="text-xs text-red-400 font-bold w-4 flex-shrink-0">{i+1}</span>
                          <span className="text-xs font-mono text-red-700 dark:text-red-300 flex-1">
                            {fmt(r.startSec??0)} ← {fmt(r.endSec??0)}
                          </span>
                          <span className="text-xs text-red-400 font-mono">{fmt((r.endSec??0)-(r.startSec??0))}</span>
                          <button onClick={() => setRanges(prev=>prev.filter(x=>x.id!==r.id))}
                            className="text-red-400 hover:text-red-600 transition-colors flex-shrink-0">
                            <Trash2 className="w-3.5 h-3.5"/>
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm"
                      onClick={() => setRanges(prev => [...prev, makeRange(playerTime, Math.min(playerTime+5, totalDuration))])}
                      disabled={!ready} className="flex-1 gap-1.5 text-xs">
                      <Plus className="w-3 h-3"/>إضافة نطاق
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => setRanges([])} disabled={ranges.length===0}
                      className="text-red-500 border-red-200 hover:bg-red-50 text-xs">
                      مسح الكل
                    </Button>
                  </div>
                  <Button onClick={runMulti} disabled={!ready||busy||ranges.length===0}
                    className="w-full h-10 gap-2 bg-red-600 hover:bg-red-500 text-white font-semibold">
                    {busy ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"/>جاري...</>
                          : <><ListX className="w-4 h-4"/>احذف {ranges.length} نطاقات وطبّق</>}
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ══ EXPORT PANEL ════════════════════════════════════════════════ */}
        <div ref={exportPanelRef}>
          {(resultBuffer || showExportPanel) && (
            <div className="border-t border-emerald-200 dark:border-emerald-800 bg-gradient-to-b from-emerald-50 to-white dark:from-emerald-950/50 dark:to-slate-900 px-4 py-5 space-y-3">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-emerald-100 dark:bg-emerald-900 flex items-center justify-center">
                  <Download className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400"/>
                </div>
                <p className="text-sm font-semibold text-emerald-800 dark:text-emerald-200">تصدير الملف</p>
                {resultBuffer && (
                  <span className="text-xs text-emerald-500 mr-auto bg-emerald-100 dark:bg-emerald-900 px-2 py-0.5 rounded-full">
                    {(resultBuffer.duration/60).toFixed(1)} دق · {(resultBuffer.sampleRate/1000).toFixed(0)}kHz
                  </span>
                )}
              </div>

              {!resultBuffer ? (
                <p className="text-xs text-emerald-600 dark:text-emerald-400 text-center py-2">
                  نفّذ عملية حذف أو اقتصاص ليظهر الملف الناتج هنا
                </p>
              ) : (
                <div className="space-y-3">
                  {/* Primary actions — MP3 + WAV */}
                  <div className="grid grid-cols-2 gap-2">
                    <Button type="button"
                      onClick={() => { handleFormatChange("mp3"); setMp3Bitrate(128); setTimeout(handleExport, 50); }}
                      disabled={isExporting}
                      className="h-11 gap-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl shadow-sm">
                      {isExporting && exportFormat==="mp3"
                        ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"/>
                        : <Download className="w-4 h-4"/>}
                      تحميل MP3
                    </Button>
                    <Button type="button" variant="outline"
                      onClick={() => { handleFormatChange("wav"); setTimeout(handleExport, 50); }}
                      disabled={isExporting}
                      className="h-11 gap-2 border-emerald-300 dark:border-emerald-700 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-950 rounded-xl">
                      {isExporting && exportFormat==="wav"
                        ? <div className="w-4 h-4 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin"/>
                        : <Download className="w-4 h-4"/>}
                      تحميل WAV
                    </Button>
                  </div>

                  {/* Advanced export options */}
                  <button type="button" onClick={() => setShowAdvancedExport(v => !v)}
                    className="w-full text-xs text-slate-400 hover:text-slate-600 flex items-center justify-center gap-1 py-1 transition-colors">
                    {showAdvancedExport ? "▲ إخفاء خيارات التصدير" : "▼ خيارات متقدمة"}
                  </button>

                  {showAdvancedExport && (
                    <div className="space-y-2">
                      {/* WAV */}
                      <button type="button" onClick={() => handleFormatChange("wav")}
                        className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border text-xs transition-all ${
                          exportFormat==="wav"
                            ? "bg-emerald-600 border-emerald-600 text-white"
                            : "border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:border-emerald-400"
                        }`}>
                        <span className="font-bold w-14">WAV</span>
                        <span className="font-mono">~{formatFileSizeMB((resultBuffer.length*resultBuffer.numberOfChannels*2+44)/(1024*1024))}</span>
                        <span className="mr-auto opacity-60">جودة أصلية</span>
                      </button>
                      {([192,128,96] as Mp3Bitrate[]).map(br => (
                        <button key={br} type="button" onClick={() => { handleFormatChange("mp3"); setMp3Bitrate(br); }}
                          className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border text-xs transition-all ${
                            exportFormat==="mp3"&&mp3Bitrate===br
                              ? "bg-emerald-600 border-emerald-600 text-white"
                              : "border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:border-emerald-400"
                          }`}>
                          <span className="font-bold w-14">MP3 {br}k</span>
                          <span className="font-mono">~{formatFileSizeMB(estimateMp3SizeMB(resultBuffer.duration,br))}</span>
                          <span className="mr-auto opacity-60">{br===192?"جودة عالية":br===128?"✓ واتساب":"حجم صغير"}</span>
                        </button>
                      ))}
                      <input type="text" value={exportFileName} onChange={e=>setExportFileName(e.target.value)}
                        placeholder="اسم الملف"
                        className="w-full text-xs border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 rounded-xl px-3 py-2 focus:outline-none focus:ring-2 focus:ring-emerald-400 text-slate-700 dark:text-slate-300"/>
                      {exportStatus==="encoding" && (
                        <div className="flex items-center gap-2 text-xs text-emerald-600">
                          <div className="w-3 h-3 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin"/>جاري الترميز...
                        </div>
                      )}
                      {exportStatus==="error" && <p className="text-xs text-red-500">{exportError}</p>}
                      <Button type="button" onClick={handleExport} disabled={isExporting}
                        className="w-full h-10 gap-2 bg-emerald-600 hover:bg-emerald-500 text-white font-semibold rounded-xl">
                        {isExporting
                          ? <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"/>جاري...</>
                          : <><Download className="w-4 h-4"/>تحميل {exportFormat.toUpperCase()} {exportFormat==="mp3"?`${mp3Bitrate}k`:""}</>}
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── STICKY BOTTOM BAR ─────────────────────────────────────────────── */}
      <div className="fixed bottom-0 left-0 right-0 z-40"
        style={{ background:"rgba(10,15,28,0.97)", backdropFilter:"blur(16px)", borderTop:"1px solid rgba(255,255,255,0.05)" }}>
        <div className="max-w-3xl mx-auto px-4 py-2 flex items-center gap-1.5">

          {/* ← رجوع */}
          {onBack && (
            <button onClick={onBack}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-white/50 hover:text-white hover:bg-white/10 text-xs font-medium transition-all flex-shrink-0 mr-1"
              title="العودة للقائمة الرئيسية">
              <span className="text-sm">←</span>
              رجوع
            </button>
          )}
          {onBack && <div className="w-px h-5 bg-white/10 flex-shrink-0"/>}

          {/* ‹5 */}
          <button onClick={() => jumpPlayer(-5)} disabled={!ready}
            className="w-10 h-10 flex items-center justify-center rounded-lg text-white/40 hover:text-white hover:bg-white/10 disabled:opacity-20 text-xs font-mono transition-all">‹5</button>

          {/* ‹1 */}
          <button onClick={() => jumpPlayer(-1)} disabled={!ready}
            className="w-11 h-11 flex items-center justify-center rounded-lg text-white/40 hover:text-white hover:bg-white/10 disabled:opacity-20 text-xs font-mono transition-all">‹1</button>

          {/* Play */}
          <button onClick={() => { const el=playerRef.current; if(!el) return; playerPlaying?el.pause():el.play(); }}
            disabled={!ready}
            className="w-10 h-10 rounded-full bg-blue-500 hover:bg-blue-400 text-white flex items-center justify-center disabled:opacity-20 shadow-lg mx-1 transition-all hover:scale-105 active:scale-95">
            {playerPlaying ? <Pause className="w-4 h-4"/> : <Play className="w-4 h-4 ml-px"/>}
          </button>

          {/* 1› */}
          <button onClick={() => jumpPlayer(1)} disabled={!ready}
            className="w-11 h-11 flex items-center justify-center rounded-lg text-white/40 hover:text-white hover:bg-white/10 disabled:opacity-20 text-xs font-mono transition-all">1›</button>

          {/* 5› */}
          <button onClick={() => jumpPlayer(5)} disabled={!ready}
            className="w-10 h-10 flex items-center justify-center rounded-lg text-white/40 hover:text-white hover:bg-white/10 disabled:opacity-20 text-xs font-mono transition-all">5›</button>

          {/* Divider */}
          <div className="w-px h-5 bg-white/10 mx-1 flex-shrink-0"/>

          {/* S / E buttons */}
          <button onClick={() => { tab==="single" ? applyStart(playerTime) : setLastRangeFromPlayer("start"); }}
            disabled={!ready}
            className="px-3 py-2.5 text-xs font-bold rounded-lg text-blue-400 hover:text-white hover:bg-blue-600/40 disabled:opacity-20 font-mono transition-all"
            title="S — ضع البداية">S</button>

          <button onClick={() => { tab==="single" ? applyEnd(playerTime) : setLastRangeFromPlayer("end"); }}
            disabled={!ready}
            className="px-3 py-2.5 text-xs font-bold rounded-lg text-emerald-400 hover:text-white hover:bg-emerald-600/40 disabled:opacity-20 font-mono transition-all"
            title="E — ضع النهاية">E</button>

          {/* Divider */}
          <div className="w-px h-5 bg-white/10 mx-1 flex-shrink-0"/>

          {/* Time */}
          <span className="text-xs font-mono text-white/50 tabular-nums">
            {fmt(playerTime)}<span className="text-white/20">/{fmt(playerDuration)}</span>
          </span>

          {/* Undo */}
          <button onClick={onUndo} disabled={undoCount===0||!onUndo}
            className="w-10 h-10 flex items-center justify-center rounded-lg text-white/35 hover:text-white hover:bg-white/10 disabled:opacity-20 transition-all ml-auto">
            <RotateCcw className="w-4 h-4"/>
          </button>

          {/* M — marker */}
          <button onClick={() => { if(ready) { addMarker(playerTime); toast.success(`🔖 ${fmt(playerTime)}`); }}}
            disabled={!ready} title="M — علامة"
            className="w-10 h-10 flex items-center justify-center rounded-lg text-yellow-400/70 hover:text-yellow-300 hover:bg-yellow-400/10 disabled:opacity-20 transition-all text-sm">
            🔖
          </button>

          {/* T — split */}
          <button onClick={handleSplit} disabled={!ready} title="T — فصل هنا"
            className="w-10 h-10 flex items-center justify-center rounded-lg text-orange-400/70 hover:text-orange-300 hover:bg-orange-400/10 disabled:opacity-20 transition-all text-xs font-bold">
            ✂
          </button>

          {/* N — normalize */}
          <button onClick={handleNormalize} disabled={!ready||isNormalizing} title="N — تطبيع المستوى"
            className="w-10 h-10 flex items-center justify-center rounded-lg text-blue-400/70 hover:text-blue-300 hover:bg-blue-400/10 disabled:opacity-20 transition-all text-sm">
            📊
          </button>

          {/* Save */}
          <button
            onClick={() => { setShowExportPanel(true); setTimeout(() => exportPanelRef.current?.scrollIntoView({ behavior:"smooth", block:"center" }), 80); }}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-emerald-500 hover:bg-emerald-400 text-white shadow-lg transition-all hover:scale-105 active:scale-95">
            <Download className="w-3.5 h-3.5"/>حفظ
          </button>
        </div>
      </div>

    </div>
  );
}
