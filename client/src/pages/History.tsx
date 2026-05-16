/**
 * History — سجل الملفات المحلي
 * يعمل بدون server أو auth — يقرأ من localStorage
 */

import { useState, useMemo } from "react";
import { Trash2, FileAudio, Search, Clock, Mic2, Scissors, Activity, MicOff, Layers } from "lucide-react";
import { toast } from "sonner";
import { useLocalHistory } from "@/hooks/useLocalHistory";

const fmtDur = (s: number) => {
  if (!s) return "—";
  const m = Math.floor(s / 60), sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
};

const fmtDate = (iso: string) => {
  try {
    const d = new Date(iso), now = new Date();
    const diffMin = Math.floor((now.getTime() - d.getTime()) / 60000);
    const diffH = Math.floor(diffMin / 60), diffD = Math.floor(diffH / 24);
    if (diffMin < 1)  return "الآن";
    if (diffMin < 60) return `قبل ${diffMin} دقيقة`;
    if (diffH   < 24) return `قبل ${diffH} ساعة`;
    if (diffD   < 7)  return `قبل ${diffD} يوم`;
    return d.toLocaleDateString("ar-SA");
  } catch { return iso; }
};

const OP_META: Record<string, { icon: React.ReactNode; cls: string }> = {
  "إزالة الصمت":  { icon: <MicOff className="w-3 h-3"/>,    cls: "bg-violet-100 dark:bg-violet-950 text-violet-700 dark:text-violet-300 border-violet-200 dark:border-violet-800" },
  "تقطيع يدوي":   { icon: <Scissors className="w-3 h-3"/>,  cls: "bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800" },
  "تحسين الوضوح": { icon: <Mic2 className="w-3 h-3"/>,      cls: "bg-sky-100 dark:bg-sky-950 text-sky-700 dark:text-sky-300 border-sky-200 dark:border-sky-800" },
  "ضغط الصوت":    { icon: <Activity className="w-3 h-3"/>,  cls: "bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800" },
  "دمج ملفات":    { icon: <Layers className="w-3 h-3"/>,     cls: "bg-indigo-100 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800" },
};

export default function History() {
  const { entries, removeEntry, clearAll } = useLocalHistory();
  const [search, setSearch]           = useState("");
  const [confirmClear, setConfirmClear] = useState(false);

  const filtered = useMemo(() => {
    if (!search.trim()) return entries;
    const q = search.toLowerCase();
    return entries.filter(e => e.name.toLowerCase().includes(q));
  }, [entries, search]);

  const handleDelete = (id: string, name: string) => {
    removeEntry(id);
    toast.success(`تم حذف "${name}" من السجل`);
  };

  const handleClearAll = () => {
    if (!confirmClear) { setConfirmClear(true); setTimeout(() => setConfirmClear(false), 3000); return; }
    clearAll(); setConfirmClear(false);
    toast.success("تم مسح السجل بالكامل");
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <div className="max-w-2xl mx-auto px-4 py-8 space-y-5">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-slate-800 dark:text-slate-200">سجل الملفات</h1>
            <p className="text-xs text-slate-400 mt-0.5">
              {entries.length > 0 ? `${entries.length} ملف محفوظ محلياً` : "لا يوجد سجل بعد"}
            </p>
          </div>
          {entries.length > 0 && (
            <button onClick={handleClearAll}
              className={`px-3 py-1.5 text-xs rounded-xl border transition-all ${
                confirmClear
                  ? "bg-red-600 border-red-600 text-white"
                  : "border-slate-300 dark:border-slate-600 text-slate-500 hover:border-red-400 hover:text-red-500"
              }`}>
              {confirmClear ? "تأكيد المسح ؟" : "مسح الكل"}
            </button>
          )}
        </div>

        {/* Search */}
        {entries.length > 3 && (
          <div className="relative">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400"/>
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="ابحث في السجل..."
              className="w-full pr-9 pl-4 py-2.5 text-sm bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl focus:outline-none focus:ring-2 focus:ring-blue-400 text-slate-700 dark:text-slate-300"/>
          </div>
        )}

        {/* Empty */}
        {entries.length === 0 && (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="w-16 h-16 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center mb-4">
              <Clock className="w-7 h-7 text-slate-400"/>
            </div>
            <p className="text-base font-semibold text-slate-600 dark:text-slate-400 mb-1">لا يوجد سجل بعد</p>
            <p className="text-sm text-slate-400 mb-5">سيظهر هنا كل ملف تُعدّله أو تُصدّره</p>
            <a href="/app/tools"
              className="px-5 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold rounded-xl transition-colors">
              ابدأ التحرير ←
            </a>
          </div>
        )}

        {/* No results */}
        {entries.length > 0 && filtered.length === 0 && (
          <p className="text-center text-slate-400 text-sm py-10">لا نتائج لـ "{search}"</p>
        )}

        {/* List */}
        {filtered.map(entry => (
          <div key={entry.id}
            className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 flex items-start gap-3 group hover:border-slate-300 dark:hover:border-slate-700 transition-all">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-100 to-violet-100 dark:from-blue-950 dark:to-violet-950 flex items-center justify-center flex-shrink-0 mt-0.5">
              <FileAudio className="w-5 h-5 text-blue-600 dark:text-blue-400"/>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-slate-800 dark:text-slate-200 truncate">{entry.name}</p>
              <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                <span className="text-xs text-slate-400 font-mono">{fmtDur(entry.duration)}</span>
                {entry.sizeMb > 0 && <span className="text-xs text-slate-400">{entry.sizeMb.toFixed(1)} MB</span>}
                <span className="text-xs text-slate-400">{fmtDate(entry.date)}</span>
                {entry.exportFmt && (
                  <span className="text-xs font-mono px-1.5 py-0.5 rounded bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                    {entry.exportFmt.toUpperCase()}
                  </span>
                )}
              </div>
              {entry.operations.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {entry.operations.map(op => {
                    const m = OP_META[op];
                    return (
                      <span key={op} className={`flex items-center gap-1 text-xs px-2 py-0.5 rounded-full border font-medium ${m?.cls ?? "bg-slate-100 dark:bg-slate-800 text-slate-500 border-slate-200"}`}>
                        {m?.icon}{op}
                      </span>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="flex items-center gap-1 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-all">
              {/* فتح في المحرر — يوجّه لصفحة الأدوات */}
              <a href="/app/tools"
                className="w-8 h-8 flex items-center justify-center rounded-xl text-slate-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-950/40 transition-all"
                title="فتح محرر لملف جديد بنفس النوع">
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14"/>
                </svg>
              </a>
              {/* حذف */}
              <button onClick={() => handleDelete(entry.id, entry.name)}
                className="w-8 h-8 flex items-center justify-center rounded-xl text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40 transition-all"
                title="حذف من السجل">
                <Trash2 className="w-3.5 h-3.5"/>
              </button>
            </div>
          </div>
        ))}

        {entries.length > 0 && (
          <p className="text-center text-xs text-slate-400 pb-4">
            السجل محفوظ محلياً على هذا الجهاز فقط
          </p>
        )}
      </div>
    </div>
  );
}
