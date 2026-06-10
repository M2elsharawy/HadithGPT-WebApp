import { useMemo } from 'react';
import type { VoicedSegment } from './PrayerTransitionAnalyzer';

interface PrayerMapPanelProps {
  segments:    VoicedSegment[];
  onToggle:    (id: string) => void;
  onApply:     () => void;
  onSelectAll: (enabled: boolean) => void;
  isProcessing?: boolean;
  onPreview?:  (startSec: number, endSec: number) => void;
}

const CLASS_CONFIG: Record<string, { color: string; bg: string; label: string; emoji: string }> = {
  quran_likely:         { color: '#16a34a', bg: 'bg-green-50 dark:bg-green-950',   label: 'تلاوة',       emoji: '📖' },
  takbeer_candidate:    { color: '#dc2626', bg: 'bg-red-50 dark:bg-red-950',       label: 'تكبير/ركن',   emoji: '🔴' },
  transition_candidate: { color: '#dc2626', bg: 'bg-red-50 dark:bg-red-950',       label: 'انتقال',      emoji: '🔴' },
  iqama_or_intro:       { color: '#eab308', bg: 'bg-yellow-50 dark:bg-yellow-950', label: 'مقدمة/إقامة', emoji: '🟡' },
  salam_or_outro:       { color: '#eab308', bg: 'bg-yellow-50 dark:bg-yellow-950', label: 'سلام/ختام',   emoji: '🟡' },
  review:               { color: '#eab308', bg: 'bg-yellow-50 dark:bg-yellow-950', label: 'مراجعة',      emoji: '🟡' },
};

function fmt(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export default function PrayerMapPanel({
  segments, onToggle, onApply, onSelectAll, isProcessing, onPreview,
}: PrayerMapPanelProps) {

  const stats = useMemo(() => {
    const toRemove  = segments.filter(s => s.enabled);
    const removedSec = toRemove.reduce((a, s) => a + s.durationSec, 0);
    const kept      = segments.filter(s => !s.enabled);
    const keptSec   = kept.reduce((a, s) => a + s.durationSec, 0);
    return { removeCount: toRemove.length, removedSec, keptCount: kept.length, keptSec };
  }, [segments]);

  return (
    <div className="space-y-4">
      {/* شريط الإحصائيات */}
      <div className="grid grid-cols-3 gap-2">
        <div className="bg-green-50 dark:bg-green-950 rounded-xl p-3 text-center">
          <p className="text-xs text-green-600 dark:text-green-400">يُبقى (تلاوة)</p>
          <p className="font-mono font-bold text-green-700 dark:text-green-300">{fmt(stats.keptSec)}</p>
        </div>
        <div className="bg-red-50 dark:bg-red-950 rounded-xl p-3 text-center">
          <p className="text-xs text-red-600 dark:text-red-400">يُحذف ({stats.removeCount})</p>
          <p className="font-mono font-bold text-red-700 dark:text-red-300">{fmt(stats.removedSec)}</p>
        </div>
        <div className="bg-slate-50 dark:bg-slate-800 rounded-xl p-3 text-center">
          <p className="text-xs text-slate-500">المقاطع</p>
          <p className="font-mono font-bold text-slate-700 dark:text-slate-300">{segments.length}</p>
        </div>
      </div>

      {/* أزرار التحديد السريع */}
      <div className="flex gap-2">
        <button
          onClick={() => onSelectAll(true)}
          className="flex-1 px-3 py-2 text-xs font-medium rounded-lg border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950 transition-colors"
        >
          تحديد كل الأركان للحذف
        </button>
        <button
          onClick={() => onSelectAll(false)}
          className="flex-1 px-3 py-2 text-xs font-medium rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors"
        >
          إلغاء الكل
        </button>
      </div>

      {/* قائمة المقاطع */}
      <div className="space-y-1.5 max-h-80 overflow-y-auto pr-1">
        {segments.map((seg) => {
          const cfg = CLASS_CONFIG[seg.classification] ?? CLASS_CONFIG.review;
          const isProtected = seg.classification === 'quran_likely' && seg.confidence >= 0.95;
          return (
            <div
              key={seg.id}
              className={`flex items-center gap-3 p-2.5 rounded-xl border transition-all ${
                seg.enabled
                  ? `border-red-200 dark:border-red-800 ${cfg.bg}`
                  : 'border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900'
              }`}
            >
              <span className="text-base flex-shrink-0">{cfg.emoji}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold" style={{ color: cfg.color }}>{cfg.label}</span>
                  <span className="text-xs text-slate-400 font-mono">{fmt(seg.startSec)} → {fmt(seg.endSec)}</span>
                </div>
                <div className="text-xs text-slate-400 font-mono mt-0.5">
                  {seg.durationSec.toFixed(1)}ث · ثقة {Math.round(seg.confidence * 100)}%
                </div>
              </div>
              {onPreview && (
                <button
                  onClick={() => onPreview(seg.startSec, seg.endSec)}
                  className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-violet-600 hover:bg-violet-50 dark:hover:bg-violet-950 transition-colors flex-shrink-0"
                  aria-label="استماع"
                  title="استمع لهذا المقطع"
                >
                  ▶
                </button>
              )}
              {isProtected ? (
                <span className="text-xs text-green-600 dark:text-green-400 flex-shrink-0">🔒 محمي</span>
              ) : (
                <button
                  onClick={() => onToggle(seg.id)}
                  className={`w-11 h-6 rounded-full relative transition-colors flex-shrink-0 ${
                    seg.enabled ? 'bg-red-500' : 'bg-slate-200 dark:bg-slate-700'
                  }`}
                  aria-label={seg.enabled ? 'إلغاء الحذف' : 'تحديد للحذف'}
                >
                  <span className={`absolute top-1 w-4 h-4 rounded-full bg-white transition-transform ${
                    seg.enabled ? 'right-1' : 'right-6'
                  }`} />
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* زر التطبيق */}
      <button
        onClick={onApply}
        disabled={isProcessing || stats.removeCount === 0}
        className="w-full py-3 rounded-xl bg-violet-600 hover:bg-violet-500 text-white font-semibold text-sm transition-colors disabled:opacity-40"
      >
        {isProcessing ? 'جاري الحذف...' : `احذف المحدد (${stats.removeCount} مقطع · ${fmt(stats.removedSec)})`}
      </button>
    </div>
  );
}
