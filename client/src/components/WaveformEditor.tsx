/**
 * WaveformEditor v4
 * محرر موجة صوتية تفاعلي — canvas مخصص
 *
 * الميزات:
 * - رسم الموجة من AudioBuffer (peak data محسوبة مرة واحدة)
 * - إنشاء تحديد بالسحب / اللمس
 * - مقابض قابلة للسحب: يسار=start, يمين=end, داخل=move
 * - اختصارات لوحة مفاتيح للضبط الدقيق
 * - تكبير بعجلة الماوس أو أزرار
 * - عرض النطاقات الموجودة (حمراء)
 * - مؤشر التشغيل الحالي
 */

import { useEffect, useRef, useState, useCallback } from "react";
import { ZoomIn, ZoomOut, Maximize2, Plus } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface WaveformRange {
  id: string;
  startSec: number;
  endSec: number;
}

/** نطاق قابل للتحرير والحذف والتعطيل */
export interface EditableRange {
  id: string;
  startSec: number;
  endSec: number;
  /** true = أحمر (سيُحذف) — false = رمادي (معطَّل) */
  enabled: boolean;
  /** نص اختياري يظهر داخل النطاق */
  label?: string;
  /** لون مخصص للمنطقة (اختياري) — يُستخدم كـ fill عند enabled */
  color?: string;
}

interface WaveformEditorProps {
  audioBuffer: AudioBuffer | null;
  currentTime: number;
  existingRanges?: WaveformRange[];
  editableRanges?: EditableRange[];
  onEditableRangesChange?: (ranges: EditableRange[]) => void;
  onRangeSelected?: (startSec: number, endSec: number) => void;
  onDeleteRange?: (startSec: number, endSec: number) => void;
  onCropToRange?: (startSec: number, endSec: number) => void;
  onSeek?: (timeSec: number) => void;
  height?: number;
  /** تفعيل Smart Snap (default: true) */
  smartSnapEnabled?: boolean;
  /** نطاق الالتقاط بالثواني (default: 0.15) */
  snapToleranceSec?: number;
  /** لون أعمدة الموجة (default: #94a3b8) */
  waveColor?: string;
  /** لون التحديد (default: #3b82f6) */
  selectionColor?: string;
  /** يُستدعى عند الضغط على "تكبير على التحديد" */
  onZoomToSelection?: (startSec: number, endSec: number) => void;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const HANDLE_PX       = 10;
const DRAG_MIN_PX     = 5;
const MIN_SEL_SEC     = 0.1;
const BINS            = 2000;
const SNAP_TOLERANCE  = 0.15; // ثواني

// ─── Snap helper (pure) ───────────────────────────────────────────────────────

/**
 * snapTime — يُعيد أقرب نقطة الـ snap إذا كانت ضمن التسامح، وإلا يُعيد timeSec نفسه.
 * @param timeSec  الوقت المراد اختبار snap له
 * @param points   نقاط الـ snap (ثواني)
 * @param tol      نطاق الالتقاط بالثواني
 */
function snapTime(timeSec: number, points: number[], tol: number): { snapped: number; didSnap: boolean } {
  if (points.length === 0 || tol <= 0) return { snapped: timeSec, didSnap: false };
  let best = timeSec;
  let minDist = tol;
  for (const p of points) {
    const d = Math.abs(p - timeSec);
    if (d < minDist) { minDist = d; best = p; }
  }
  return { snapped: best, didSnap: best !== timeSec };
}

// ─── Drag mode ────────────────────────────────────────────────────────────────

type DragMode = "none" | "create" | "move" | "resize-start" | "resize-end";

// ─── Format time ─────────────────────────────────────────────────────────────

const fmt = (sec: number): string => {
  if (!isFinite(sec) || sec < 0) return "0:00.0";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  const t = Math.floor((sec % 1) * 10);
  return `${m}:${s.toString().padStart(2, "0")}.${t}`;
};

const clamp = (v: number, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, v));

// ─── Component ────────────────────────────────────────────────────────────────

export default function WaveformEditor({
  audioBuffer,
  currentTime,
  existingRanges = [],
  editableRanges = [],
  onEditableRangesChange,
  onRangeSelected,
  onDeleteRange,
  onCropToRange,
  onSeek,
  height = 96,
  smartSnapEnabled = true,
  snapToleranceSec = SNAP_TOLERANCE,
  waveColor = "#94a3b8",
  selectionColor = "#3b82f6",
  onZoomToSelection,
}: WaveformEditorProps) {

  const canvasRef    = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // ── Snap ──────────────────────────────────────────────────────────────────
  const snapPointsRef = useRef<number[]>([]);
  const isAltDownRef  = useRef(false);
  const [snapHint, setSnapHint] = useState<{ side: "start"|"end"; x: number } | null>(null);

  // ── Zoom ──────────────────────────────────────────────────────────────────
  const [zoom,      setZoom]      = useState(1);
  const [scrollOff, setScrollOff] = useState(0);
  const zoomRef      = useRef(1);
  const scrollOffRef = useRef(0);
  useEffect(() => { zoomRef.current      = zoom;      }, [zoom]);
  useEffect(() => { scrollOffRef.current = scrollOff; }, [scrollOff]);

  // ── Selection (manual drag) ───────────────────────────────────────────────
  const [selStart, setSelStart] = useState<number | null>(null);
  const [selEnd,   setSelEnd]   = useState<number | null>(null);
  const selStartRef = useRef<number | null>(null);
  const selEndRef   = useRef<number | null>(null);
  useEffect(() => { selStartRef.current = selStart; }, [selStart]);
  useEffect(() => { selEndRef.current   = selEnd;   }, [selEnd]);

  // ── Drag state (selection) ────────────────────────────────────────────────
  const dragModeRef      = useRef<DragMode>("none");
  const dragStartPxRef   = useRef<number>(0);
  const dragStartTimeRef = useRef<number>(0);
  const dragSelSnapRef   = useRef<{ s: number; e: number } | null>(null);

  // ── Editable range drag state ──────────────────────────────────────────────
  const editDragIdRef   = useRef<string | null>(null);
  const editDragSideRef = useRef<"start" | "end" | "move" | null>(null);
  const editDragSnapRef = useRef<{ s: number; e: number } | null>(null);
  const editableRangesRef = useRef<EditableRange[]>([]);
  useEffect(() => { editableRangesRef.current = editableRanges; }, [editableRanges]);

  // ── Hover segment preview ─────────────────────────────────────────────────
  /** ID النطاق الذي يُعاينه الـ hover حالياً */
  const [hoverPreviewId, setHoverPreviewId] = useState<string | null>(null);
  /** tooltip على الجوال — يظهر عند tap على نطاق */
  const [mobileActionRangeId, setMobileActionRangeId] = useState<string | null>(null);
  const hoverDebounceRef  = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Auto-preview ref — مشترك بين hover preview و selection preview ──────────
  const previewCtxRef = useRef<AudioContext | null>(null);
  const previewSrcRef = useRef<AudioBufferSourceNode | null>(null);
  const stopPreviewAudio = useCallback(() => {
    if (hoverDebounceRef.current) { clearTimeout(hoverDebounceRef.current); hoverDebounceRef.current = null; }
    try { previewSrcRef.current?.stop(); } catch { /**/ }
    previewSrcRef.current = null;
    previewCtxRef.current?.close().catch(() => {});
    previewCtxRef.current = null;
    setHoverPreviewId(null);
  }, []);

  /** إيقاف أي preview نشط — alias للتوافق مع الكود القديم */
  const stopHoverPreview = stopPreviewAudio;

  /** تشغيل نطاق معين من الـ audioBuffer */
  const startHoverPreview = useCallback((rangeId: string, startSec: number, endSec: number) => {
    if (!audioBuffer) return;
    stopPreviewAudio();
    try {
      const ctx = new AudioContext();
      previewCtxRef.current = ctx;
      const src = ctx.createBufferSource();
      src.buffer = audioBuffer;
      src.connect(ctx.destination);
      const duration = Math.max(0.05, endSec - startSec);
      src.start(0, startSec, duration);
      previewSrcRef.current = src;
      setHoverPreviewId(rangeId);
      src.onended = () => {
        previewSrcRef.current = null;
        ctx.close().catch(() => {});
        previewCtxRef.current = null;
        setHoverPreviewId(null);
      };
    } catch { stopPreviewAudio(); }
  }, [audioBuffer, stopPreviewAudio]);

  const playSelectionPreview = useCallback((s: number, e: number) => {
    if (!audioBuffer || e - s < 0.05) return;
    stopPreviewAudio();
    const ctx = new AudioContext();
    previewCtxRef.current = ctx;
    const src = ctx.createBufferSource();
    src.buffer = audioBuffer;
    src.connect(ctx.destination);
    src.start(0, s, e - s);
    previewSrcRef.current = src;
    src.onended = () => { previewCtxRef.current?.close().catch(() => {}); previewSrcRef.current = null; };
  }, [audioBuffer, stopPreviewAudio]);

  /** cleanup عند unmount */
  useEffect(() => () => { stopPreviewAudio(); }, [stopPreviewAudio]);

  // ── Toolbar drag ──────────────────────────────────────────────────────────
  const [toolbarOffsetY, setToolbarOffsetY] = useState(0);
  const toolbarDragRef   = useRef<{ startY: number; startOffset: number } | null>(null);
  const isDraggingToolbar = useRef(false);

  const onToolbarDragStart = useCallback((clientY: number) => {
    isDraggingToolbar.current = true;
    toolbarDragRef.current = { startY: clientY, startOffset: toolbarOffsetY };
  }, [toolbarOffsetY]);

  const onToolbarDragMove = useCallback((clientY: number) => {
    if (!isDraggingToolbar.current || !toolbarDragRef.current) return;
    const delta     = toolbarDragRef.current.startY - clientY;
    const newOffset = toolbarDragRef.current.startOffset + delta;
    // maxOffset موسَّع — يمكن سحب الـ toolbar بعيداً عن الـ canvas
    const maxOffset = (height ?? 100) + 200;
    setToolbarOffsetY(Math.max(-(height ?? 100), Math.min(maxOffset, newOffset)));
  }, [height]);

  const onToolbarDragEnd = useCallback(() => {
    isDraggingToolbar.current = false;
    toolbarDragRef.current = null;
  }, []);

  // Global mouse/touch listeners for toolbar drag
  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => onToolbarDragMove(e.clientY);
    const onMouseUp   = () => onToolbarDragEnd();
    const onTouchMove = (e: TouchEvent) => { if (isDraggingToolbar.current) { e.preventDefault(); onToolbarDragMove(e.touches[0].clientY); } };
    const onTouchEnd  = () => onToolbarDragEnd();
    window.addEventListener("mousemove",  onMouseMove);
    window.addEventListener("mouseup",    onMouseUp);
    window.addEventListener("touchmove",  onTouchMove, { passive: false });
    window.addEventListener("touchend",   onTouchEnd);
    return () => {
      window.removeEventListener("mousemove",  onMouseMove);
      window.removeEventListener("mouseup",    onMouseUp);
      window.removeEventListener("touchmove",  onTouchMove);
      window.removeEventListener("touchend",   onTouchEnd);
    };
  }, [onToolbarDragMove, onToolbarDragEnd]);

  // ── Snap points (from existingRanges + editableRanges) ───────────────────
  useEffect(() => {
    const pts = new Set<number>();
    for (const r of existingRanges) { pts.add(r.startSec); pts.add(r.endSec); }
    for (const r of editableRanges) { pts.add(r.startSec); pts.add(r.endSec); }
    snapPointsRef.current = Array.from(pts).sort((a, b) => a - b);
  }, [existingRanges, editableRanges]);

  // Alt key tracking — تعطيل snap مؤقتاً
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Alt") { isAltDownRef.current = e.type === "keydown"; }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup",   onKey);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("keyup", onKey); };
  }, []);

  /** تطبيق snap على وقت — يُستدعى عند mouseup/touchend فقط */
  const applySnap = useCallback((timeSec: number, side: "start" | "end"): number => {
    if (!smartSnapEnabled || isAltDownRef.current) return timeSec;
    const { snapped, didSnap } = snapTime(timeSec, snapPointsRef.current, snapToleranceSec);
    if (didSnap) {
      // حساب موضع x للـ hint البصري
      const canvas = canvasRef.current;
      if (canvas) {
        const dur = audioBuffer?.duration ?? 1;
        const vis = dur / zoomRef.current;
        const st  = scrollOffRef.current * dur;
        const x   = Math.round(((snapped - st) / vis) * canvas.getBoundingClientRect().width);
        setSnapHint({ side, x });
        setTimeout(() => setSnapHint(null), 900);
      }
    }
    return snapped;
  }, [smartSnapEnabled, snapToleranceSec, audioBuffer]);

  // ── Peak data (computed once per buffer) ──────────────────────────────────
  const peakData = useRef<Float32Array | null>(null);

  useEffect(() => {
    // Reset everything on buffer change
    setZoom(1); setScrollOff(0);
    setSelStart(null); setSelEnd(null);
    selStartRef.current = null; selEndRef.current = null;
    dragModeRef.current = "none";

    if (!audioBuffer) { peakData.current = null; return; }

    const ch   = audioBuffer.getChannelData(0);
    const step = Math.max(1, Math.floor(ch.length / BINS));
    const data = new Float32Array(BINS);
    for (let i = 0; i < BINS; i++) {
      let max = 0;
      const base = i * step;
      const end  = Math.min(base + step, ch.length);
      for (let j = base; j < end; j++) {
        const abs = Math.abs(ch[j]);
        if (abs > max) max = abs;
      }
      data[i] = max;
    }
    peakData.current = data;
  }, [audioBuffer]);

  // ── Coordinate helpers ────────────────────────────────────────────────────

  /** px على الـ canvas → ثواني (مع مراعاة zoom/scroll) */
  const pxToTime = useCallback((clientX: number): number => {
    const canvas = canvasRef.current;
    if (!canvas || !audioBuffer) return 0;
    const rect       = canvas.getBoundingClientRect();
    const frac       = (clientX - rect.left) / rect.width;
    const duration   = audioBuffer.duration;
    const visibleDur = duration / zoomRef.current;
    const startSec   = scrollOffRef.current * duration;
    return clamp(startSec + frac * visibleDur, 0, duration);
  }, [audioBuffer]);

  /** ثواني → px على الـ canvas */
  const timeToPx = useCallback((sec: number, canvasW: number): number => {
    if (!audioBuffer) return 0;
    const duration   = audioBuffer.duration;
    const visibleDur = duration / zoomRef.current;
    const startSec   = scrollOffRef.current * duration;
    return ((sec - startSec) / visibleDur) * canvasW;
  }, [audioBuffer]);

  /** تحديد dragMode بناءً على موضع الماوس */
  const getDragMode = useCallback((clientX: number): DragMode => {
    const canvas = canvasRef.current;
    if (!canvas || selStartRef.current === null || selEndRef.current === null) return "create";
    const W  = canvas.getBoundingClientRect().width;
    const sx = timeToPx(selStartRef.current, W);
    const ex = timeToPx(selEndRef.current,   W);
    const rect = canvas.getBoundingClientRect();
    const px = clientX - rect.left;
    if (Math.abs(px - sx) <= HANDLE_PX) return "resize-start";
    if (Math.abs(px - ex) <= HANDLE_PX) return "resize-end";
    if (px > sx + HANDLE_PX && px < ex - HANDLE_PX) return "move";
    return "create";
  }, [timeToPx]);

  /** cursor style */
  const getCursor = useCallback((clientX: number): string => {
    if (selStartRef.current === null) return "grab";
    const mode = getDragMode(clientX);
    if (mode === "resize-start" || mode === "resize-end") return "ew-resize";
    if (mode === "move") return "grab";
    return "crosshair";
  }, [getDragMode]);

  // ── Drawing ───────────────────────────────────────────────────────────────

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx  = canvas.getContext("2d");
    if (!ctx)  return;
    const W    = canvas.width;
    const H    = canvas.height;
    const dur  = audioBuffer?.duration ?? 0;
    const visibleDur = dur / zoom;
    const startSec   = scrollOff * dur;
    const endSec     = startSec + visibleDur;

    // Background
    ctx.fillStyle = "#f8fafc";
    ctx.fillRect(0, 0, W, H);

    // Editable ranges (enabled=red, disabled=gray) — مع مقابض
    for (const r of editableRanges) {
      const rS = Math.max(r.startSec, startSec);
      const rE = Math.min(r.endSec,   endSec);
      if (rE <= rS) continue;
      const sx = ((r.startSec - startSec) / visibleDur) * W;
      const ex = ((r.endSec   - startSec) / visibleDur) * W;
      const x  = ((rS - startSec) / visibleDur) * W;
      const w  = ((rE - rS)       / visibleDur) * W;
      const isEn = r.enabled;

      // Fill
      const fillColor = isEn
        ? (r.color ?? "rgba(239,68,68,0.20)")
        : "rgba(148,163,184,0.15)";
      ctx.fillStyle = fillColor;
      ctx.fillRect(x, 0, w, H);

      // Borders
      ctx.strokeStyle = isEn ? "rgba(220,38,38,0.7)" : "rgba(148,163,184,0.5)";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([]);
      if (r.startSec >= startSec) {
        ctx.beginPath(); ctx.moveTo(sx, 0); ctx.lineTo(sx, H); ctx.stroke();
      }
      if (r.endSec <= endSec) {
        ctx.beginPath(); ctx.moveTo(ex, 0); ctx.lineTo(ex, H); ctx.stroke();
      }

      // Handles — circles on border lines
      if (r.startSec >= startSec && r.startSec <= endSec) {
        ctx.fillStyle = isEn ? "#ef4444" : "#94a3b8";
        ctx.beginPath(); ctx.arc(sx, H / 2, 6, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = "#fff"; ctx.lineWidth = 1.5; ctx.stroke();
      }
      if (r.endSec >= startSec && r.endSec <= endSec) {
        ctx.fillStyle = isEn ? "#ef4444" : "#94a3b8";
        ctx.beginPath(); ctx.arc(ex, H / 2, 6, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = "#fff"; ctx.lineWidth = 1.5; ctx.stroke();
      }

      // Label
      if (w > 24) {
        ctx.fillStyle = isEn ? "rgba(220,38,38,0.85)" : "rgba(148,163,184,0.85)";
        ctx.font = "9px monospace";
        ctx.textAlign = "center";
        ctx.fillText(
          r.label ?? fmt(r.endSec - r.startSec),
          x + w / 2, 11
        );
        ctx.textAlign = "start";
      }
    }

    // Existing ranges (red, no handles) — ثابتة لا تُحرَّر
    for (const r of existingRanges) {
      const rS = Math.max(r.startSec, startSec);
      const rE = Math.min(r.endSec,   endSec);
      if (rE <= rS) continue;
      const x = ((rS - startSec) / visibleDur) * W;
      const w = ((rE - rS)       / visibleDur) * W;
      ctx.fillStyle = "rgba(239,68,68,0.20)";
      ctx.fillRect(x, 0, w, H);
      ctx.strokeStyle = "rgba(220,38,38,0.65)";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([]);
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x+w, 0); ctx.lineTo(x+w, H); ctx.stroke();
      if (w > 28) {
        ctx.fillStyle = "rgba(220,38,38,0.8)";
        ctx.font = "9px monospace";
        ctx.fillText(fmt(r.endSec - r.startSec), x + 3, 11);
      }
    }

    // Waveform bars
    const data = peakData.current;
    if (data && dur > 0) {
      const BAR = 2; const GAP = 1;
      const cols = Math.floor(W / (BAR + GAP));
      for (let i = 0; i < cols; i++) {
        const frac    = i / cols;
        const tSec    = startSec + frac * visibleDur;
        const dIdx    = Math.min(Math.floor((tSec / dur) * data.length), data.length - 1);
        const amp     = data[dIdx] ?? 0;
        const barH    = Math.max(2, amp * (H - 8));
        const x       = i * (BAR + GAP);
        const y       = (H - barH) / 2;
        const inSel   = selStart !== null && selEnd !== null &&
          tSec >= Math.min(selStart, selEnd) && tSec <= Math.max(selStart, selEnd);
        const inRed   = existingRanges.some(r => tSec >= r.startSec && tSec <= r.endSec);
        ctx.fillStyle = inRed ? "#ef4444" : inSel ? selectionColor : waveColor;
        ctx.beginPath();
        ctx.roundRect(x, y, BAR, barH, 1);
        ctx.fill();
      }
    } else if (!data) {
      ctx.fillStyle = "#cbd5e1";
      ctx.font = "13px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("اسحب على الموجة لتحديد نطاق للحذف", W / 2, H / 2 + 5);
      ctx.textAlign = "start";
    }

    // Selection overlay + handles
    if (selStart !== null && selEnd !== null && dur > 0) {
      const s  = Math.min(selStart, selEnd);
      const e  = Math.max(selStart, selEnd);
      const sx = ((s - startSec) / visibleDur) * W;
      const ex = ((e - startSec) / visibleDur) * W;
      const sw = ex - sx;

      // Selection fill
      ctx.fillStyle = "rgba(59,130,246,0.18)";
      ctx.fillRect(sx, 0, sw, H);

      // Left handle
      ctx.fillStyle = "#1d4ed8";
      ctx.fillRect(sx - 2, 0, 4, H);
      // Handle grip circle
      ctx.fillStyle = "#2563eb";
      ctx.beginPath();
      ctx.arc(sx, H / 2, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Right handle
      ctx.fillStyle = "#1d4ed8";
      ctx.fillRect(ex - 2, 0, 4, H);
      ctx.fillStyle = "#2563eb";
      ctx.beginPath();
      ctx.arc(ex, H / 2, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Time labels near handles
      ctx.fillStyle = "rgba(29,78,216,0.9)";
      ctx.font      = "bold 9px monospace";
      // start label
      const sLabel = fmt(s);
      const sLx    = clamp(sx - 2, 2, W - 40);
      ctx.fillText(sLabel, sLx, H - 3);
      // end label
      const eLabel = fmt(e);
      const eLx    = clamp(ex + 3, 2, W - 40);
      ctx.fillText(eLabel, eLx, H - 3);
      // duration in center
      if (sw > 60) {
        ctx.fillStyle = "rgba(29,78,216,0.7)";
        ctx.font = "9px monospace";
        ctx.textAlign = "center";
        ctx.fillText(fmt(e - s), sx + sw / 2, 11);
        ctx.textAlign = "start";
      }
    }

    // Playhead
    if (dur > 0 && currentTime >= startSec && currentTime <= endSec) {
      const x = ((currentTime - startSec) / visibleDur) * W;
      ctx.strokeStyle = "#ef4444";
      ctx.lineWidth   = 2;
      ctx.setLineDash([]);
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
      ctx.fillStyle = "#ef4444";
      ctx.beginPath(); ctx.arc(x, H / 2, 4, 0, Math.PI * 2); ctx.fill();
    }

    // Time axis
    if (dur > 0) {
      ctx.fillStyle = "#94a3b8";
      ctx.font      = "8px monospace";
      const ticks = Math.min(8, Math.floor(W / 60));
      for (let i = 0; i <= ticks; i++) {
        const t = startSec + (i / ticks) * visibleDur;
        ctx.fillText(fmt(t), clamp((i / ticks) * W + 2, 0, W - 38), H - 14);
      }
    }
  }, [audioBuffer, currentTime, existingRanges, editableRanges, zoom, scrollOff, selStart, selEnd, timeToPx]);

  // ── Resize observer + initial draw ───────────────────────────────────────

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const obs = new ResizeObserver(() => {
      const canvas = canvasRef.current;
      if (canvas) { canvas.width = container.clientWidth; draw(); }
    });
    obs.observe(container);
    return () => obs.disconnect();
  }, [draw]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (canvas && container) canvas.width = container.clientWidth;
    canvas && (canvas.height = height);
    draw();
  }, [draw, height]);

  // ── Mouse handlers ────────────────────────────────────────────────────────

  // applyDrag مُعرَّفة أولاً — تُستخدم في handleMouseMove و handleTouchMove
  const applyDrag = useCallback((clientX: number) => {
    const mode = dragModeRef.current;
    if (mode === "none") return;

    if (mode === "create") {
      setSelEnd(pxToTime(clientX));
      return;
    }

    const dur = audioBuffer?.duration ?? 0;
    const dt  = pxToTime(clientX) - dragStartTimeRef.current;

    if (mode === "resize-start") {
      setSelStart(prev => {
        if (prev === null || selEndRef.current === null) return prev;
        const maxEnd = Math.max(prev, selEndRef.current);
        return clamp(prev + dt, 0, maxEnd - MIN_SEL_SEC);
      });
      dragStartTimeRef.current = pxToTime(clientX);
    } else if (mode === "resize-end") {
      setSelEnd(prev => {
        if (prev === null || selStartRef.current === null) return prev;
        const minStart = Math.min(selStartRef.current, prev);
        return clamp(prev + dt, minStart + MIN_SEL_SEC, dur);
      });
      dragStartTimeRef.current = pxToTime(clientX);
    } else if (mode === "move") {
      const snap = dragSelSnapRef.current;
      if (!snap) return;
      const totalDt = pxToTime(clientX) - dragStartTimeRef.current;
      const selDur  = snap.e - snap.s;
      const newS    = clamp(snap.s + totalDt, 0, dur - selDur);
      setSelStart(newS);
      setSelEnd(newS + selDur);
    }
  }, [audioBuffer, pxToTime]);

  /** تحديد إذا كان الـ click قريباً من مقبض editable range */
  const getEditableDragTarget = useCallback((clientX: number): {
    id: string; side: "start" | "end" | "move"
  } | null => {
    const canvas = canvasRef.current;
    if (!canvas || editableRangesRef.current.length === 0) return null;
    const W    = canvas.getBoundingClientRect().width;
    const dur  = audioBuffer?.duration ?? 0;
    if (!dur)  return null;
    const rect = canvas.getBoundingClientRect();
    const px   = clientX - rect.left;

    for (const r of editableRangesRef.current) {
      const sx = timeToPx(r.startSec, W);
      const ex = timeToPx(r.endSec,   W);
      if (Math.abs(px - sx) <= HANDLE_PX + 4) return { id: r.id, side: "start" };
      if (Math.abs(px - ex) <= HANDLE_PX + 4) return { id: r.id, side: "end" };
      if (px > sx + HANDLE_PX && px < ex - HANDLE_PX) return { id: r.id, side: "move" };
    }
    return null;
  }, [audioBuffer, timeToPx]);

  /** إيجاد أي editableRange (enabled) يقع تحت px موضع الماوس */
  const getEditableRangeAtPx = useCallback((clientX: number): EditableRange | null => {
    const canvas = canvasRef.current;
    if (!canvas || !audioBuffer) return null;
    const rect = canvas.getBoundingClientRect();
    const px   = clientX - rect.left;
    const W    = rect.width;
    const dur  = audioBuffer.duration;
    const vis  = dur / zoomRef.current;
    const st   = scrollOffRef.current * dur;

    for (const r of editableRangesRef.current) {
      if (!r.enabled) continue;
      const sx = ((r.startSec - st) / vis) * W;
      const ex = ((r.endSec   - st) / vis) * W;
      if (px >= sx && px <= ex) return r;
    }
    return null;
  }, [audioBuffer]);
  const applyEditableDrag = useCallback((clientX: number) => {
    const id   = editDragIdRef.current;
    const side = editDragSideRef.current;
    if (!id || !side || !onEditableRangesChange) return;

    const dur   = audioBuffer?.duration ?? 0;
    const ranges = editableRangesRef.current;
    const r = ranges.find(x => x.id === id);
    if (!r) return;

    let updated: EditableRange;
    if (side === "start") {
      // incremental: dt = تغيير الوقت منذ آخر mousemove
      const dt = pxToTime(clientX) - dragStartTimeRef.current;
      dragStartTimeRef.current = pxToTime(clientX);
      updated = { ...r, startSec: clamp(r.startSec + dt, 0, r.endSec - MIN_SEL_SEC) };
    } else if (side === "end") {
      const dt = pxToTime(clientX) - dragStartTimeRef.current;
      dragStartTimeRef.current = pxToTime(clientX);
      updated = { ...r, endSec: clamp(r.endSec + dt, r.startSec + MIN_SEL_SEC, dur) };
    } else {
      // move — absolute: snap.e = startSec عند بدء السحب، snap.s = وقت الماوس عند بدء السحب
      const snap = editDragSnapRef.current;
      if (!snap) return;
      const selDur   = snap.e - r.startSec + (r.endSec - snap.e); // = r.endSec - r.startSec
      const origDur  = r.endSec - r.startSec;
      const curTime  = pxToTime(clientX);
      const totalDt  = curTime - snap.s; // إجمالي التغيير من بداية السحب
      const newS     = clamp(snap.e + totalDt, 0, dur - origDur);
      // لا نُحدّث dragStartTimeRef في move — نعتمد على snap
      updated = { ...r, startSec: newS, endSec: newS + origDur };
    }
    onEditableRangesChange(ranges.map(x => x.id === id ? updated : x));
  }, [audioBuffer, onEditableRangesChange, pxToTime]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // editable range drag
    if (editDragIdRef.current) {
      e.preventDefault();
      applyEditableDrag(e.clientX);
      canvas.style.cursor = "grabbing";
      return;
    }

    if (dragModeRef.current !== "none") {
      e.preventDefault();
      applyDrag(e.clientX);
      if (dragModeRef.current === "move") canvas.style.cursor = "grabbing";
    } else {
      // cursor — editable range له الأولوية
      const et = getEditableDragTarget(e.clientX);
      if (et) {
        canvas.style.cursor = et.side === "move" ? "grab" : "ew-resize";
      } else {
        canvas.style.cursor = getCursor(e.clientX);
      }

      // hover preview على النطاقات الحمراء — debounce 350ms
      const hovered = getEditableRangeAtPx(e.clientX);
      if (hovered) {
        if (hovered.id !== hoverPreviewId) {
          stopHoverPreview();
          hoverDebounceRef.current = setTimeout(() => {
            startHoverPreview(hovered.id, hovered.startSec, hovered.endSec);
          }, 350);
        }
        if (!et) canvas.style.cursor = "pointer";
      } else {
        if (hoverPreviewId) stopHoverPreview();
        else if (hoverDebounceRef.current) {
          clearTimeout(hoverDebounceRef.current);
          hoverDebounceRef.current = null;
        }
      }
    }
  }, [applyDrag, applyEditableDrag, getCursor, getEditableDragTarget,
      getEditableRangeAtPx, hoverPreviewId, startHoverPreview, stopHoverPreview]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (!audioBuffer || e.button !== 0) return;
    e.preventDefault();
    canvasRef.current?.focus();

    // أولاً: هل هو drag على editable range؟
    const et = getEditableDragTarget(e.clientX);
    if (et && onEditableRangesChange) {
      editDragIdRef.current   = et.id;
      editDragSideRef.current = et.side;
      dragStartTimeRef.current = pxToTime(e.clientX);
      if (et.side === "move") {
        const r = editableRangesRef.current.find(x => x.id === et.id);
        if (r) {
          editDragSnapRef.current = { s: pxToTime(e.clientX), e: r.startSec };
        }
      }
      if (canvasRef.current) canvasRef.current.style.cursor = "grabbing";
      return;
    }

    const mode = getDragMode(e.clientX);
    dragModeRef.current    = mode;
    dragStartPxRef.current = e.clientX;
    dragStartTimeRef.current = pxToTime(e.clientX);

    if (mode === "move" && selStartRef.current !== null && selEndRef.current !== null) {
      dragSelSnapRef.current = {
        s: Math.min(selStartRef.current, selEndRef.current),
        e: Math.max(selStartRef.current, selEndRef.current),
      };
      if (canvasRef.current) canvasRef.current.style.cursor = "grabbing";
    } else if (mode === "create") {
      const t = pxToTime(e.clientX);
      setSelStart(t); setSelEnd(t);
    } else {
      dragSelSnapRef.current = null;
    }
  }, [audioBuffer, getDragMode, getEditableDragTarget, onEditableRangesChange, pxToTime]);

  const handleMouseDrag = useCallback((e: React.MouseEvent) => {
    if (dragModeRef.current === "none") return;
    e.preventDefault();
    applyDrag(e.clientX);
    if (dragModeRef.current === "move") {
      if (canvasRef.current) canvasRef.current.style.cursor = "grabbing";
    }
  }, [applyDrag]);

  const handleMouseUp = useCallback((e: React.MouseEvent) => {
    // إنهاء editable range drag
    if (editDragIdRef.current) {
      editDragIdRef.current   = null;
      editDragSideRef.current = null;
      editDragSnapRef.current = null;
      if (canvasRef.current) canvasRef.current.style.cursor = getCursor(e.clientX);
      return;
    }

    const mode = dragModeRef.current;
    dragModeRef.current = "none";
    dragSelSnapRef.current = null;

    if (mode === "create") {
      const dx = Math.abs(e.clientX - dragStartPxRef.current);
      if (dx < DRAG_MIN_PX) {
        onSeek?.(pxToTime(e.clientX));
        setSelStart(null); setSelEnd(null);
      } else {
        // ── Final snap on mouseup ──────────────────────────────────────────
        setSelStart(prev => prev !== null ? applySnap(prev, "start") : prev);
        setSelEnd  (prev => prev !== null ? applySnap(prev, "end")   : prev);
      }
    } else if (mode === "resize-start") {
      setSelStart(prev => prev !== null ? applySnap(prev, "start") : prev);
    } else if (mode === "resize-end") {
      setSelEnd  (prev => prev !== null ? applySnap(prev, "end")   : prev);
    }
    // move mode: snap both edges
    else if (mode === "move") {
      setSelStart(prev => prev !== null ? applySnap(prev, "start") : prev);
      setSelEnd  (prev => prev !== null ? applySnap(prev, "end")   : prev);
    }

    if (canvasRef.current) canvasRef.current.style.cursor = getCursor(e.clientX);

    // ── Auto-preview عند اكتمال التحديد ───────────────────────────────────
    if (mode === "create" || mode === "resize-start" || mode === "resize-end" || mode === "move") {
      // نقرأ القيم مباشرة بعد setState (ستُحدَّث في الـ render التالي)
      setTimeout(() => {
        setSelStart(s => {
          setSelEnd(e2 => {
            if (s !== null && e2 !== null && Math.abs(e2 - s) > 0.1) {
              const ns = Math.min(s, e2), ne = Math.max(s, e2);
              playSelectionPreview(ns, ne);
            }
            return e2;
          });
          return s;
        });
      }, 50);
    }
  }, [getCursor, onSeek, pxToTime, applySnap, playSelectionPreview]);

  // Global mouseup (когда мышь вышла за пределы)
  useEffect(() => {
    const onUp = (e: MouseEvent) => {
      // clear editable drag
      if (editDragIdRef.current) {
        editDragIdRef.current   = null;
        editDragSideRef.current = null;
        editDragSnapRef.current = null;
        return;
      }
      if (dragModeRef.current === "none") return;
      const mode = dragModeRef.current;
      dragModeRef.current = "none";
      dragSelSnapRef.current = null;
      if (mode === "create") {
        const dx = Math.abs(e.clientX - dragStartPxRef.current);
        if (dx < DRAG_MIN_PX) {
          onSeek?.(pxToTime(e.clientX));
          setSelStart(null); setSelEnd(null);
        } else {
          setSelStart(prev => prev !== null ? applySnap(prev, "start") : prev);
          setSelEnd  (prev => prev !== null ? applySnap(prev, "end")   : prev);
        }
      } else if (mode === "resize-start") {
        setSelStart(prev => prev !== null ? applySnap(prev, "start") : prev);
      } else if (mode === "resize-end") {
        setSelEnd  (prev => prev !== null ? applySnap(prev, "end")   : prev);
      } else if (mode === "move") {
        setSelStart(prev => prev !== null ? applySnap(prev, "start") : prev);
        setSelEnd  (prev => prev !== null ? applySnap(prev, "end")   : prev);
      }
    };
    window.addEventListener("mouseup", onUp);
    return () => window.removeEventListener("mouseup", onUp);
  }, [onSeek, pxToTime, applySnap]);

  // ── Touch handlers ────────────────────────────────────────────────────────

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (!audioBuffer || e.touches.length !== 1) return;
    e.preventDefault(); // يمنع scroll الصفحة أثناء السحب
    canvasRef.current?.focus();
    const t = e.touches[0].clientX;

    // أولاً: هل اللمس على editable range handle؟ (نُوسّع نطاق اللمس للجوال ×2)
    const et = getEditableDragTarget(t);
    if (et && onEditableRangesChange) {
      editDragIdRef.current   = et.id;
      editDragSideRef.current = et.side;
      dragStartTimeRef.current = pxToTime(t);
      if (et.side === "move") {
        const r = editableRangesRef.current.find(x => x.id === et.id);
        if (r) editDragSnapRef.current = { s: pxToTime(t), e: r.startSec };
      }
      return;
    }

    const mode = getDragMode(t);
    dragModeRef.current      = mode;
    dragStartPxRef.current   = t;
    dragStartTimeRef.current = pxToTime(t);
    if (mode === "move" && selStartRef.current !== null && selEndRef.current !== null) {
      dragSelSnapRef.current = {
        s: Math.min(selStartRef.current, selEndRef.current),
        e: Math.max(selStartRef.current, selEndRef.current),
      };
    } else if (mode === "create") {
      const sec = pxToTime(t);
      setSelStart(sec); setSelEnd(sec);
    }
  }, [audioBuffer, getDragMode, pxToTime, getEditableDragTarget, onEditableRangesChange]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (e.touches.length !== 1) return;
    e.preventDefault(); // يمنع scroll أثناء السحب

    // editable range drag
    if (editDragIdRef.current) {
      applyEditableDrag(e.touches[0].clientX);
      return;
    }

    if (dragModeRef.current !== "none") {
      applyDrag(e.touches[0].clientX);
    }
  }, [applyDrag, applyEditableDrag]);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    // editable range drag end
    if (editDragIdRef.current) {
      editDragIdRef.current   = null;
      editDragSideRef.current = null;
      editDragSnapRef.current = null;
      return;
    }

    const mode = dragModeRef.current;
    dragModeRef.current    = "none";
    dragSelSnapRef.current = null;
    if (mode === "create") {
      const t = e.changedTouches[0]?.clientX ?? dragStartPxRef.current;
      if (Math.abs(t - dragStartPxRef.current) < DRAG_MIN_PX) {
        const tapped = getEditableRangeAtPx(t);
        if (tapped) {
          setMobileActionRangeId(prev => prev === tapped.id ? null : tapped.id);
        } else {
          onSeek?.(pxToTime(t));
          setSelStart(null); setSelEnd(null);
        }
      } else {
        setSelStart(prev => prev !== null ? applySnap(prev, "start") : prev);
        setSelEnd  (prev => prev !== null ? applySnap(prev, "end")   : prev);
        // auto-preview بعد اكتمال التحديد باللمس
        setTimeout(() => {
          setSelStart(s => {
            setSelEnd(e2 => {
              if (s !== null && e2 !== null && Math.abs(e2 - s) > 0.1) {
                playSelectionPreview(Math.min(s, e2), Math.max(s, e2));
              }
              return e2;
            });
            return s;
          });
        }, 50);
      }
    } else if (mode === "resize-start") {
      setSelStart(prev => prev !== null ? applySnap(prev, "start") : prev);
    } else if (mode === "resize-end") {
      setSelEnd  (prev => prev !== null ? applySnap(prev, "end")   : prev);
    } else if (mode === "move") {
      setSelStart(prev => prev !== null ? applySnap(prev, "start") : prev);
      setSelEnd  (prev => prev !== null ? applySnap(prev, "end")   : prev);
    }
  }, [getEditableRangeAtPx, onSeek, pxToTime, applySnap, playSelectionPreview]);

  // ── Keyboard ──────────────────────────────────────────────────────────────

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (!audioBuffer) return;
    // لا تُشغّل shortcuts عند الكتابة في input/textarea
    const tag = (e.target as HTMLElement).tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return;

    // Escape — مسح التحديد
    if (e.key === "Escape") {
      e.preventDefault();
      setSelStart(null); setSelEnd(null);
      stopPreviewAudio();
      return;
    }

    // Delete / Backspace — حذف التحديد فوراً
    if ((e.key === "Delete" || e.key === "Backspace") &&
        selStartRef.current !== null && selEndRef.current !== null) {
      e.preventDefault();
      const s = Math.min(selStartRef.current, selEndRef.current);
      const en = Math.max(selStartRef.current, selEndRef.current);
      onDeleteRange?.(s, en);
      setSelStart(null); setSelEnd(null);
      return;
    }

    // Enter — احتفظ بالتحديد / Shift+Enter — احذف
    if (e.key === "Enter" && selStartRef.current !== null && selEndRef.current !== null) {
      e.preventDefault();
      const s = Math.min(selStartRef.current, selEndRef.current);
      const en = Math.max(selStartRef.current, selEndRef.current);
      if (e.shiftKey) {
        onDeleteRange?.(s, en);
      } else {
        onCropToRange?.(s, en);
      }
      setSelStart(null); setSelEnd(null);
      return;
    }

    if (selStartRef.current === null || selEndRef.current === null) return;

    const dur    = audioBuffer.duration;
    const isShift = e.shiftKey;
    const isAlt   = e.altKey;
    // step: Shift=5s, normal=1s | boundary nudge: Shift+Alt=5s, Alt=1s
    const moveStep  = isShift ? 5.0 : 1.0;
    const nudgeStep = isShift ? 5.0 : 1.0;

    const left  = e.key === "ArrowLeft";
    const right = e.key === "ArrowRight";
    if (!left && !right) return;
    e.preventDefault();

    const dir = right ? 1 : -1;

    if (!isAlt) {
      // تحريك التحديد كاملاً
      const s    = Math.min(selStartRef.current, selEndRef.current);
      const en   = Math.max(selStartRef.current, selEndRef.current);
      const selD = en - s;
      const ns   = clamp(s + dir * moveStep, 0, dur - selD);
      setSelStart(ns); setSelEnd(ns + selD);
    } else {
      // تحريك الحد الأيسر فقط (nudge)
      const s  = Math.min(selStartRef.current, selEndRef.current);
      const en = Math.max(selStartRef.current, selEndRef.current);
      const ns = clamp(s + dir * nudgeStep, 0, en - MIN_SEL_SEC);
      setSelStart(ns); setSelEnd(en);
    }
  }, [audioBuffer, onDeleteRange, onCropToRange, stopPreviewAudio]);

  // ── Zoom ──────────────────────────────────────────────────────────────────

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const factor  = e.deltaY < 0 ? 1.25 : 1 / 1.25;
    const newZoom = clamp(zoom * factor, 1, 20);
    if (audioBuffer && newZoom !== zoom) {
      const canvas = canvasRef.current;
      if (canvas) {
        const rect    = canvas.getBoundingClientRect();
        const frac    = (e.clientX - rect.left) / rect.width;
        const dur     = audioBuffer.duration;
        const curTime = scrollOff * dur + frac * (dur / zoom);
        setScrollOff(clamp(curTime / dur - frac / newZoom, 0, 1 - 1/newZoom));
      }
    }
    setZoom(newZoom);
  }, [audioBuffer, zoom, scrollOff]);

  const zoomIn  = () => setZoom(z => clamp(z * 1.5, 1, 20));
  const zoomOut = () => setZoom(z => {
    const nz = clamp(z / 1.5, 1, 20);
    setScrollOff(o => clamp(o, 0, Math.max(0, 1 - 1/nz)));
    return nz;
  });
  const zoomFit = () => { setZoom(1); setScrollOff(0); };
  const zoomToSel = () => {
    if (!audioBuffer || selStart === null || selEnd === null) return;
    const dur    = audioBuffer.duration;
    const s      = Math.min(selStart, selEnd);
    const e      = Math.max(selStart, selEnd);
    const selDur = e - s;
    if (selDur < 0.01) return;
    const nz = clamp(dur / selDur * 0.85, 1, 20);
    setZoom(nz);
    setScrollOff(clamp(s / dur, 0, 1 - 1/nz));
  };

  // ── Add to delete ─────────────────────────────────────────────────────────

  const hasSelection = selStart !== null && selEnd !== null &&
    Math.abs(selEnd - selStart) >= MIN_SEL_SEC;

  const normalSel = hasSelection
    ? { s: Math.min(selStart!, selEnd!), e: Math.max(selStart!, selEnd!) }
    : null;

  const handleAddRange = () => {
    if (!normalSel) return;
    onRangeSelected?.(normalSel.s, normalSel.e);
    setSelStart(null); setSelEnd(null);
  };

  const clearSel = () => { setSelStart(null); setSelEnd(null); };

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="space-y-2">

      {/* Zoom controls */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-xs text-slate-500 flex-shrink-0">تكبير:</span>
        <button onClick={zoomIn}
          className="p-2.5 sm:p-1.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700">
          <ZoomIn className="w-4 h-4 sm:w-3.5 sm:h-3.5"/>
        </button>
        <button onClick={zoomOut}
          className="p-2.5 sm:p-1.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700">
          <ZoomOut className="w-4 h-4 sm:w-3.5 sm:h-3.5"/>
        </button>
        <button onClick={zoomFit}
          className="px-2 py-1 text-xs rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700">
          <Maximize2 className="w-3 h-3 inline mr-0.5"/>ملاءمة
        </button>
        {hasSelection && (
          <button onClick={zoomToSel}
            className="px-2 py-1 text-xs rounded bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 hover:bg-blue-200">
            تكبير التحديد
          </button>
        )}
        <span className="text-xs text-slate-400 mr-auto">
          {zoom > 1 ? `${zoom.toFixed(1)}×` : "عرض كامل"}
        </span>
      </div>

      {/* Canvas */}
      <div
        ref={containerRef}
        className="relative rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 select-none overflow-visible"
        style={{ height }}
      >
        <canvas
          ref={canvasRef}
          height={height}
          tabIndex={0}
          className="w-full block outline-none focus:ring-2 focus:ring-blue-400 focus:ring-inset"
          style={{ touchAction: "none" }}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseEnter={handleMouseMove}
          onMouseLeave={(e) => {
            if (canvasRef.current) canvasRef.current.style.cursor = "crosshair";
            stopHoverPreview();
          }}
          onMouseUp={handleMouseUp}
          onWheel={handleWheel}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          onKeyDown={handleKeyDown}
        />

        {/* ── Floating action tooltip — position:fixed يتجاوز أي overflow:hidden ── */}
        {normalSel && audioBuffer && (() => {
          const dur     = audioBuffer.duration;
          const vis     = dur / zoomRef.current;
          const st      = scrollOffRef.current * dur;
          const midFrac = ((normalSel.s + normalSel.e) / 2 - st) / vis;
          // احسب الموضع من الـ canvas مباشرةً
          const canvasRect = canvasRef.current?.getBoundingClientRect();
          const leftPx  = canvasRect
            ? canvasRect.left + midFrac * canvasRect.width
            : window.innerWidth / 2;
          const topPx   = canvasRect
            ? canvasRect.top + toolbarOffsetY - 52
            : 200;

          return (
            <div
              className="fixed z-[9999] hidden sm:flex items-center rounded-2xl shadow-2xl overflow-hidden select-none"
              style={{
                top:  Math.max(8, topPx),
                left: Math.max(8, Math.min(window.innerWidth - 320, leftPx - 160)),
                background: "rgba(15,23,42,0.97)",
                backdropFilter: "blur(8px)",
                border: "1px solid rgba(255,255,255,0.08)",
                boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
              }}
            >
              {/* ⠿ Drag handle */}
              <span
                className="px-2 py-2.5 text-white/25 hover:text-white/60 transition-colors cursor-grab active:cursor-grabbing flex-shrink-0"
                title="اسحب لتحريك الشريط"
                onMouseDown={e => { e.stopPropagation(); onToolbarDragStart(e.clientY); }}
                onTouchStart={e => { e.stopPropagation(); onToolbarDragStart(e.touches[0].clientY); }}
              >
                ⠿
              </span>

              {/* Duration chip */}
              <span className="text-white/60 text-xs font-mono pr-2 py-2.5 border-r border-white/10 select-none whitespace-nowrap">
                {fmt(normalSel.e - normalSel.s)}
              </span>

              {/* ▶ استمع — toggle play/stop */}
              <button
                onClick={() => {
                  if (!audioBuffer) return;
                  if (previewSrcRef.current) {
                    stopPreviewAudio();
                    return;
                  }
                  playSelectionPreview(normalSel.s, normalSel.e);
                }}
                className="px-3 py-2.5 text-xs font-semibold text-emerald-300 hover:text-white
                           hover:bg-emerald-600/40 transition-colors whitespace-nowrap border-r border-white/10"
                title="استمع إلى المقطع المحدد قبل التعديل — انقر مجدداً للإيقاف"
              >
                {previewSrcRef.current ? "⏹ إيقاف" : "▶ استمع"}
              </button>

              {/* 🔍 Zoom to selection */}
              {onZoomToSelection && (
                <button
                  onClick={() => { onZoomToSelection(normalSel.s, normalSel.e); }}
                  className="px-3 py-2.5 text-xs font-semibold text-slate-300 hover:text-white
                             hover:bg-white/10 transition-colors whitespace-nowrap border-r border-white/10"
                  title="تكبير على التحديد (Z)"
                >
                  🔍
                </button>
              )}

              {/* ✂ احذف */}
              {onDeleteRange && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    stopPreviewAudio();
                    onDeleteRange(normalSel.s, normalSel.e);
                    clearSel();
                  }}
                  className="px-4 py-2.5 text-xs font-bold text-red-300 hover:text-white
                             hover:bg-red-600 transition-colors whitespace-nowrap border-r border-white/10"
                  title="يحذف الجزء المحدد من التسجيل (Delete)"
                  aria-label="حذف المقطع المحدد"
                >
                  ✂ احذف
                </button>
              )}

              {/* ⊡ احتفظ */}
              {onCropToRange && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    stopPreviewAudio();
                    onCropToRange(normalSel.s, normalSel.e);
                    clearSel();
                  }}
                  className="px-3 py-2.5 text-xs font-semibold text-blue-300 hover:text-white
                             hover:bg-blue-600/60 transition-colors whitespace-nowrap border-r border-white/10"
                  title="يحتفظ بالجزء المحدد فقط ويحذف باقي التسجيل (Enter)"
                  aria-label="احتفظ بالمحدد فقط"
                >
                  ⊡ احتفظ
                </button>
              )}

              {/* ✕ */}
              <button
                onClick={clearSel}
                className="px-2.5 py-2.5 text-white/40 hover:text-white/80 transition-colors"
                title="إلغاء (Esc)"
              >
                ✕
              </button>
            </div>
          );
        })()}

        {/* ── Mobile action tooltip ─────────────────────────────────── */}
        {mobileActionRangeId && (() => {
          const r = editableRanges.find(x => x.id === mobileActionRangeId);
          if (!r || !audioBuffer) return null;
          const vis    = audioBuffer.duration / zoomRef.current;
          const st     = scrollOffRef.current * audioBuffer.duration;
          const midPct = Math.max(5, Math.min(80,
            (((r.startSec + r.endSec) / 2 - st) / vis) * 100
          ));
          return (
            <div className="absolute z-30 flex items-center gap-0 rounded-xl shadow-2xl overflow-hidden border border-slate-300 dark:border-slate-600"
              style={{ top: 6, left: `${midPct}%`, transform: "translateX(-50%)" }}
            >
              <span className="bg-slate-800 text-white text-xs font-mono px-2 py-2 select-none whitespace-nowrap">
                {fmt(r.endSec - r.startSec)}
              </span>
              <button
                onClick={() => { startHoverPreview(r.id, r.startSec, r.endSec); }}
                className="px-3 py-2 text-xs font-semibold bg-violet-600 hover:bg-violet-500 text-white whitespace-nowrap"
              >▶ استمع</button>
              <button
                onClick={() => setMobileActionRangeId(null)}
                className="px-2.5 py-2 text-xs bg-slate-700 hover:bg-slate-600 text-slate-300"
              >✕</button>
            </div>
          );
        })()}

        {/* ── Snap hint — يظهر لحظياً عند الـ snap ───────────── */}
        {snapHint && (
          <div
            className="absolute z-30 pointer-events-none"
            style={{
              top: "50%", left: snapHint.x,
              transform: "translate(-50%, -50%)",
            }}
          >
            <div className="bg-yellow-400/90 text-slate-900 text-xs font-bold px-2 py-0.5 rounded-full shadow-lg whitespace-nowrap flex items-center gap-1">
              ⊕ تم الالتقاط
            </div>
          </div>
        )}

        {/* ── Hover preview indicator ───────────────────────────────── */}
        {hoverPreviewId && (
          <div className="absolute top-1 right-2 z-30 flex items-center gap-1.5 bg-black/60 text-white text-xs rounded-lg px-2 py-1 pointer-events-none">
            <span className="w-2 h-2 rounded-full bg-violet-400 animate-pulse inline-block"/>
            معاينة...
          </div>
        )}
      </div>

      {/* Scrollbar */}
      {zoom > 1 && (
        <input type="range" min={0} max={1 - 1/zoom} step={0.001}
          value={scrollOff}
          onChange={e => setScrollOff(parseFloat(e.target.value))}
          className="w-full h-1.5 accent-blue-500"
          title="تمرير الموجة"/>
      )}

      {/* Hint — فقط عندما لا يوجد تحديد */}
      {!normalSel && (
        <p className="text-xs text-slate-400 text-center">
          {audioBuffer && editableRanges.length > 0
            ? "مرّر فوق أي مقطع أحمر لسماعه قبل الحذف · اسحب لتحديد منطقة"
            : audioBuffer
            ? <>
                اسحب لتحديد منطقة · انقر للتنقل · عجلة الماوس للتكبير
                {smartSnapEnabled && <span className="text-slate-300 dark:text-slate-600"> · <kbd className="font-mono bg-slate-200 dark:bg-slate-700 px-1 rounded text-xs">Alt</kbd> لتعطيل الالتقاط</span>}
              </>
            : "جاري تحميل الموجة..."}
        </p>
      )}

      {/* ── Selection Action Bar — يظهر عند أي تحديد ─────────────────── */}
      {normalSel && audioBuffer && (
        <div className="flex flex-wrap items-center gap-2 px-3 py-2.5 bg-slate-900 dark:bg-slate-950 rounded-2xl border border-slate-700 shadow-lg">
          {/* Time info */}
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <span className="font-mono text-xs text-slate-400 tabular-nums">
              {fmt(normalSel.s)}
            </span>
            <span className="text-slate-600">→</span>
            <span className="font-mono text-xs text-slate-400 tabular-nums">
              {fmt(normalSel.e)}
            </span>
            <span className="text-xs text-slate-500 bg-slate-800 px-1.5 py-0.5 rounded-lg font-mono ml-1">
              {fmt(normalSel.e - normalSel.s)}
            </span>
          </div>

          <div className="flex-1"/>

          {/* ▶ استمع — الزر الأهم */}
          <button
            type="button"
            onClick={() => {
              if (previewSrcRef.current) { stopPreviewAudio(); return; }
              playSelectionPreview(normalSel.s, normalSel.e);
            }}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all ${
              previewSrcRef.current
                ? "bg-emerald-600 text-white"
                : "bg-emerald-700 hover:bg-emerald-600 text-white"
            }`}
            title="استمع إلى المقطع المحدد قبل التعديل"
          >
            {previewSrcRef.current ? "⏹ إيقاف" : "▶ استمع"}
          </button>

          {/* ✂ احذف */}
          {onDeleteRange && (
            <button
              type="button"
              onClick={() => {
                stopPreviewAudio();
                onDeleteRange(normalSel.s, normalSel.e);
                clearSel();
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold bg-red-700 hover:bg-red-600 text-white transition-all"
              title="يحذف الجزء المحدد من التسجيل (Delete)"
            >
              ✂ احذف
            </button>
          )}

          {/* ⊡ احتفظ */}
          {onCropToRange && (
            <button
              type="button"
              onClick={() => {
                stopPreviewAudio();
                onCropToRange(normalSel.s, normalSel.e);
                clearSel();
              }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-blue-700 hover:bg-blue-600 text-white transition-all"
              title="يحتفظ بالجزء المحدد فقط ويحذف الباقي (Enter)"
            >
              ⊡ احتفظ
            </button>
          )}

          {/* ✕ إلغاء */}
          <button
            type="button"
            onClick={() => { stopPreviewAudio(); clearSel(); }}
            className="w-7 h-7 flex items-center justify-center rounded-xl text-slate-500 hover:text-white hover:bg-slate-700 transition-all text-lg leading-none"
            title="إلغاء التحديد (Escape)"
          >
            ×
          </button>
        </div>
      )}
    </div>
  );
}
