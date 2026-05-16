/**
 * WaveformPlayer
 * مشغل صوتي احترافي مع موجة صوتية حقيقية باستخدام WaveSurfer.js
 *
 * آمن من ناحية memory — يُدمر الـ instance قبل تغيير الـ URL
 * وقبل أن يُلغى الـ blob URL من الخارج
 */

import { useEffect, useRef, useState, useCallback, useImperativeHandle, forwardRef } from "react";
import WaveSurfer from "wavesurfer.js";
import { Play, Pause, Volume2, VolumeX, RotateCcw } from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface WaveformPlayerHandle {
  /** إيقاف التشغيل وتحرير الموارد — يجب استدعاؤها قبل إلغاء الـ URL */
  destroy: () => void;
}

/** نطاق يُرسم كـ overlay ملوّن فوق الـ waveform */
export interface WaveformMarker {
  id: string;
  startSec: number;
  endSec: number;
  /** اللون — "red" للصمت المختار، "gray" للمعطَّل */
  color: "red" | "gray";
  /** نص اختياري يظهر داخل المنطقة */
  label?: string;
  /** هل النطاق محدد/مضاء؟ */
  highlighted?: boolean;
}

export interface WaveformPlayerProps {
  audioUrl: string;
  height?: number;
  waveColor?: string;
  progressColor?: string;
  /** نطاقات ملوّنة تُرسم فوق الـ waveform */
  markers?: WaveformMarker[];
  /** يُستدعى عند النقر على marker */
  onMarkerClick?: (id: string) => void;
  onReady?: (duration: number) => void;
  onTimeUpdate?: (time: number) => void;
  onError?: () => void;
  onFinish?: () => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmt = (sec: number) => {
  if (!isFinite(sec) || sec < 0) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
};

// ─── Component ────────────────────────────────────────────────────────────────

const WaveformPlayer = forwardRef<WaveformPlayerHandle, WaveformPlayerProps>(
  function WaveformPlayer(
    {
      audioUrl,
      height = 80,
      waveColor = "#94a3b8",
      progressColor = "#3b82f6",
      markers = [],
      onMarkerClick,
      onReady,
      onTimeUpdate,
      onFinish,
      onError,
    },
    ref
  ) {
    const containerRef = useRef<HTMLDivElement>(null);
    const wsRef        = useRef<WaveSurfer | null>(null);
    const urlRef       = useRef<string>("");

    const [isPlaying, setIsPlaying]   = useState(false);
    const [isLoading, setIsLoading]   = useState(false);
    const [loadError, setLoadError]   = useState(false);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration]     = useState(0);
    const [volume, setVolume]         = useState(1);
    const [isMuted, setIsMuted]       = useState(false);

    // ── Expose destroy() to parent ─────────────────────────────────────────
    useImperativeHandle(ref, () => ({
      destroy: () => {
        destroyWS();
      },
    }));

    // ── Destroy helper ────────────────────────────────────────────────────
    const destroyWS = useCallback(() => {
      if (wsRef.current) {
        try {
          wsRef.current.pause();
          wsRef.current.destroy();
        } catch {
          // قد يكون مُدمَّراً بالفعل
        }
        wsRef.current = null;
      }
      setIsPlaying(false);
    }, []);

    // ── Init / re-init on URL change ─────────────────────────────────────
    useEffect(() => {
      if (!containerRef.current || !audioUrl) return;
      if (audioUrl === urlRef.current) return; // نفس الـ URL — لا تُعيد البناء

      // دمّر الـ instance القديم أولاً
      destroyWS();
      urlRef.current = audioUrl;

      setIsLoading(true);
      setLoadError(false);
      setCurrentTime(0);
      setDuration(0);

      let cancelled = false;

      const ws = WaveSurfer.create({
        container: containerRef.current,
        height,
        waveColor,
        progressColor,
        cursorColor: "#ef4444",
        cursorWidth: 2,
        barWidth: 2,
        barGap: 1,
        barRadius: 2,
        normalize: true,
        interact: true,
        // backend و hideScrollbar أُزيلا في WaveSurfer v7
      });

      wsRef.current = ws;

      ws.on("ready", (dur: number) => {
        if (cancelled) return;
        setIsLoading(false);
        setDuration(dur);
        onReady?.(dur);
      });

      ws.on("audioprocess", (t: number) => {
        if (cancelled) return;
        setCurrentTime(t);
        onTimeUpdate?.(t);
      });

      // في WaveSurfer v7 الـ seek event يُعطي progress (0-1) لا ثوانٍ
      ws.on("seek", (progress: number) => {
        if (cancelled) return;
        const t = progress * ws.getDuration();
        setCurrentTime(t);
        onTimeUpdate?.(t);
      });

      ws.on("play",   () => { if (!cancelled) setIsPlaying(true); });
      ws.on("pause",  () => { if (!cancelled) setIsPlaying(false); });
      ws.on("finish", () => {
        if (cancelled) return;
        setIsPlaying(false);
        setCurrentTime(0);
        onFinish?.();
      });

      ws.on("error", (err: Error) => {
        if (cancelled) return;
        console.warn("WaveSurfer failed to decode:", err?.message ?? err);
        setIsLoading(false);
        setLoadError(true);
        onError?.();
      });

      // blob/data URLs: نُحمّل عبر ArrayBuffer مباشرة — يتجنب مشاكل fetch في WaveSurfer
      if (audioUrl.startsWith("blob:") || audioUrl.startsWith("data:")) {
        fetch(audioUrl)
          .then(r => r.arrayBuffer())
          .then(ab => {
            if (cancelled || !wsRef.current) return;
            const blob = new Blob([ab], { type: "audio/wav" });
            // WaveSurfer v7 يدعم loadBlob
            if (typeof (wsRef.current as any).loadBlob === "function") {
              (wsRef.current as any).loadBlob(blob);
            } else {
              const objectUrl = URL.createObjectURL(blob);
              wsRef.current.load(objectUrl);
            }
          })
          .catch(() => {
            if (!cancelled && wsRef.current) wsRef.current.load(audioUrl);
          });
      } else {
        ws.load(audioUrl);
      }

      return () => {
        cancelled = true;
        // لا نُدمر هنا — نتركه للـ URL change التالي أو unmount
      };
    }, [audioUrl]); // eslint-disable-line react-hooks/exhaustive-deps

    // ── Cleanup on unmount ────────────────────────────────────────────────
    useEffect(() => {
      return () => {
        destroyWS();
      };
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // ── Controls ──────────────────────────────────────────────────────────
    const handlePlayPause = () => {
      if (!wsRef.current || isLoading || loadError) return;
      wsRef.current.playPause();
    };

    const handleVolumeChange = (v: number) => {
      setVolume(v);
      setIsMuted(v === 0);
      wsRef.current?.setVolume(v);
    };

    const handleMuteToggle = () => {
      if (!wsRef.current) return;
      const newMuted = !isMuted;
      setIsMuted(newMuted);
      wsRef.current.setVolume(newMuted ? 0 : volume);
    };

    const handleRestart = () => {
      if (!wsRef.current) return;
      wsRef.current.seekTo(0);
      setCurrentTime(0);
    };

    const progress = duration > 0 ? currentTime / duration : 0;

    // ─── Render ────────────────────────────────────────────────────────────
    return (
      <div className="space-y-3">
        {/* Waveform canvas */}
        <div className="relative bg-slate-50 dark:bg-slate-900 rounded-xl overflow-hidden border border-slate-200 dark:border-slate-700">
          {/* Loading overlay */}
          {isLoading && (
            <div className="absolute inset-0 flex items-center justify-center bg-slate-50/80 dark:bg-slate-900/80 z-10">
              <div className="flex items-center gap-2 text-sm text-slate-500">
                <div className="w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
                جاري تحميل الموجة الصوتية...
              </div>
            </div>
          )}

          {/* Error state — fallback to native audio element */}
          {loadError && !isLoading && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-slate-50 dark:bg-slate-900 z-10 p-4">
              <p className="text-sm text-red-500 text-center">
                تعذّر عرض الموجة الصوتية
              </p>
              <p className="text-xs text-slate-400 text-center">
                الملف محمّل ويمكن تشغيله من أزرار التحكم — الموجة البصرية غير متاحة لهذا الصيغة
              </p>
              {/* Native audio fallback */}
              <audio
                src={audioUrl}
                controls
                className="w-full max-w-sm h-10 opacity-70"
                style={{ direction: "ltr" }}
              />
            </div>
          )}

          {/* WaveSurfer container */}
          <div
            ref={containerRef}
            style={{ minHeight: height, padding: "12px 16px" }}
            className="w-full"
          />

          {/* Silence / cut marker overlays — positioned absolute over waveform */}
          {duration > 0 && markers.map(marker => {
            const left  = (marker.startSec / duration) * 100;
            const width = ((marker.endSec - marker.startSec) / duration) * 100;
            if (width <= 0) return null;

            const isRed  = marker.color === "red";
            const isGray = marker.color === "gray";

            return (
              <div
                key={marker.id}
                onClick={() => onMarkerClick?.(marker.id)}
                title={marker.label ?? (isRed ? "منطقة صمت — انقر للتعطيل" : "معطَّل — انقر للتفعيل")}
                className={`absolute top-0 bottom-0 cursor-pointer transition-all duration-200 group ${
                  onMarkerClick ? "hover:opacity-80" : "pointer-events-none"
                }`}
                style={{
                  left:    `${left}%`,
                  width:   `${width}%`,
                  background: isRed
                    ? (marker.highlighted
                        ? "rgba(239,68,68,0.45)"
                        : "rgba(239,68,68,0.28)")
                    : "rgba(148,163,184,0.18)",
                  borderLeft:  `2px solid ${isRed ? "rgba(220,38,38,0.8)" : "rgba(148,163,184,0.4)"}`,
                  borderRight: `2px solid ${isRed ? "rgba(220,38,38,0.8)" : "rgba(148,163,184,0.4)"}`,
                  zIndex: 5,
                }}
              >
                {/* Label chip */}
                {marker.label && width > 3 && (
                  <span
                    className={`absolute top-1 left-1/2 -translate-x-1/2 text-white rounded px-1 py-0.5 select-none pointer-events-none
                      ${isRed ? "bg-red-500/80" : "bg-slate-400/70"}`}
                    style={{ fontSize: "9px", whiteSpace: "nowrap", maxWidth: "90%" }}
                  >
                    {marker.label}
                  </span>
                )}
              </div>
            );
          })}

          {/* Time overlay */}
          {duration > 0 && (
            <div className="absolute bottom-2 left-3 right-3 flex justify-between pointer-events-none">
              <span className="text-xs font-mono text-slate-500 dark:text-slate-400 bg-white/70 dark:bg-slate-900/70 px-1 rounded">
                {fmt(currentTime)}
              </span>
              <span className="text-xs font-mono text-slate-500 dark:text-slate-400 bg-white/70 dark:bg-slate-900/70 px-1 rounded">
                {fmt(duration)}
              </span>
            </div>
          )}
        </div>

        {/* Progress bar */}
        <div className="w-full bg-slate-200 dark:bg-slate-700 rounded-full h-1">
          <div
            className="bg-blue-500 h-1 rounded-full transition-all duration-100"
            style={{ width: `${progress * 100}%` }}
          />
        </div>

        {/* Controls row */}
        <div className="flex items-center gap-3">
          {/* Restart */}
          <button
            onClick={handleRestart}
            disabled={isLoading || loadError || duration === 0}
            className="p-2 rounded-lg text-slate-500 hover:text-slate-700 dark:hover:text-slate-300
                       hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 transition-colors"
            title="العودة للبداية"
          >
            <RotateCcw className="w-4 h-4" />
          </button>

          {/* Play/Pause */}
          <button
            onClick={handlePlayPause}
            disabled={isLoading || loadError}
            className="w-10 h-10 rounded-full bg-blue-600 hover:bg-blue-700 text-white
                       flex items-center justify-center disabled:opacity-40 transition-colors shadow-sm"
          >
            {isLoading ? (
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : isPlaying ? (
              <Pause className="w-4 h-4" />
            ) : (
              <Play className="w-4 h-4 ml-0.5" />
            )}
          </button>

          {/* Volume */}
          <button
            onClick={handleMuteToggle}
            disabled={isLoading}
            className="p-2 rounded-lg text-slate-500 hover:text-slate-700 dark:hover:text-slate-300
                       hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 transition-colors"
          >
            {isMuted || volume === 0
              ? <VolumeX className="w-4 h-4" />
              : <Volume2 className="w-4 h-4" />}
          </button>
          <input
            type="range"
            min={0} max={1} step={0.05}
            value={isMuted ? 0 : volume}
            onChange={(e) => handleVolumeChange(parseFloat(e.target.value))}
            disabled={isLoading}
            className="w-24 accent-blue-500 disabled:opacity-40"
          />
          <span className="text-xs text-slate-400 w-8">
            {Math.round((isMuted ? 0 : volume) * 100)}%
          </span>
        </div>
      </div>
    );
  }
);

export default WaveformPlayer;
