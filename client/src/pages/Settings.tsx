/**
 * Settings — إعدادات التطبيق المحلية
 * تعمل بدون server أو auth
 */

import { useState, useEffect } from "react";
import { Moon, Sun, Monitor, Trash2, ChevronLeft, Volume2, Sliders, Shield } from "lucide-react";
import { toast } from "sonner";
import { useLocalHistory } from "@/hooks/useLocalHistory";
import { useTheme } from "@/contexts/ThemeContext";

// ── Settings store ─────────────────────────────────────────────────────────

const SETTINGS_KEY = "sap_settings_v2";

export interface AppSettings {
  theme:               "light" | "dark" | "system";
  defaultExport:       "mp3_128" | "mp3_192" | "wav";
  maxFileMb:           number;
  autoHistory:         boolean;
  // إعدادات الصمت — تُستخدم في كل مكان
  silenceThresholdDb:  number;
  silenceMinDuration:  number;
  silenceGap:          number;
  silenceMode:         "prayer" | "precise";
}

const DEFAULT: AppSettings = {
  theme:              "system",
  defaultExport:      "mp3_128",
  maxFileMb:          100,
  autoHistory:        true,
  silenceThresholdDb: -20,
  silenceMinDuration: 5,
  silenceGap:         5,
  silenceMode:        "prayer",
};

function loadSettings(): AppSettings {
  try {
    const raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}");
    // Only copy known keys — prevents prototype pollution via __proto__ etc.
    const safe: Partial<AppSettings> = {};
    for (const key of Object.keys(DEFAULT) as Array<keyof AppSettings>) {
      if (Object.prototype.hasOwnProperty.call(raw, key)) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (safe as any)[key] = raw[key];
      }
    }
    return { ...DEFAULT, ...safe };
  }
  catch { return DEFAULT; }
}

function saveSettings(s: AppSettings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
}

export function useAppSettings() {
  const [settings, setSettings] = useState<AppSettings>(loadSettings);
  const update = (patch: Partial<AppSettings>) => {
    setSettings(prev => { const next = { ...prev, ...patch }; saveSettings(next); return next; });
  };
  return { settings, update };
}

// ── Silence settings hook (standalone — للاستخدام في Tools) ─────────────────
export function useSilenceSettings() {
  const { settings, update } = useAppSettings();
  return {
    thresholdDb:       settings.silenceThresholdDb,
    minDuration:       settings.silenceMinDuration,
    gap:               settings.silenceGap,
    mode:              settings.silenceMode,
    setThreshold:      (v: number) => update({ silenceThresholdDb: v }),
    setMinDuration:    (v: number) => update({ silenceMinDuration: v }),
    setGap:            (v: number) => update({ silenceGap: v }),
    setMode:           (v: "prayer" | "precise") => update({ silenceMode: v }),
  };
}

// ── UI Components ─────────────────────────────────────────────────────────

const Section = ({
  icon, title, sub, children,
}: { icon: React.ReactNode; title: string; sub?: string; children: React.ReactNode }) => (
  <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden">
    <div className="flex items-center gap-3 px-5 py-4 border-b border-slate-100 dark:border-slate-800">
      <div className="w-8 h-8 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center flex-shrink-0">
        {icon}
      </div>
      <div>
        <p className="text-sm font-bold text-slate-800 dark:text-slate-200">{title}</p>
        {sub && <p className="text-xs text-slate-400 mt-0.5">{sub}</p>}
      </div>
    </div>
    <div className="divide-y divide-slate-100 dark:divide-slate-800">{children}</div>
  </div>
);

const Row = ({ label, sub, children }: { label: string; sub?: string; children: React.ReactNode }) => (
  <div className="flex items-center justify-between px-5 py-4 gap-4">
    <div className="min-w-0 flex-1">
      <p className="text-sm font-medium text-slate-800 dark:text-slate-200">{label}</p>
      {sub && <p className="text-xs text-slate-400 mt-0.5">{sub}</p>}
    </div>
    <div className="flex-shrink-0">{children}</div>
  </div>
);

const SegControl = ({ options, value, onChange }: {
  options: { value: string; label: string; icon?: React.ReactNode }[];
  value: string;
  onChange: (v: string) => void;
}) => (
  <div className="flex gap-0.5 p-0.5 bg-slate-100 dark:bg-slate-800 rounded-xl">
    {options.map(o => (
      <button key={o.value} onClick={() => onChange(o.value)}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
          value === o.value
            ? "bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 shadow-sm"
            : "text-slate-500 hover:text-slate-700 dark:hover:text-slate-300"
        }`}>
        {o.icon}{o.label}
      </button>
    ))}
  </div>
);

const Slider = ({ value, min, max, step, onChange, unit }: {
  value: number; min: number; max: number; step: number;
  onChange: (v: number) => void; unit?: string;
}) => (
  <div className="flex items-center gap-3 w-full">
    <input type="range" min={min} max={max} step={step} value={value}
      onChange={e => onChange(parseFloat(e.target.value))}
      className="flex-1 h-1.5 rounded-full accent-blue-600"/>
    <span className="font-mono text-xs font-bold text-blue-600 dark:text-blue-400 w-16 text-left">
      {value}{unit}
    </span>
  </div>
);

// ── Main Component ─────────────────────────────────────────────────────────

export default function Settings() {
  const { settings, update } = useAppSettings();
  const { entries, clearAll } = useLocalHistory();
  const { theme, toggleTheme } = useTheme();
  const [confirmClear, setConfirmClear] = useState(false);
  const [saved, setSaved] = useState(false);

  const handleThemeChange = (v: string) => {
    update({ theme: v as AppSettings["theme"] });
    const root = document.documentElement;
    if (v === "dark") root.classList.add("dark");
    else if (v === "light") root.classList.remove("dark");
    else {
      window.matchMedia("(prefers-color-scheme: dark)").matches
        ? root.classList.add("dark") : root.classList.remove("dark");
    }
  };

  const handleClearHistory = () => {
    if (!confirmClear) { setConfirmClear(true); setTimeout(() => setConfirmClear(false), 3000); return; }
    clearAll(); setConfirmClear(false);
    toast.success("تم مسح السجل");
  };

  const handleSilencePreset = (mode: "prayer" | "precise") => {
    if (mode === "prayer") {
      update({ silenceMode:"prayer", silenceThresholdDb:-20, silenceMinDuration:5, silenceGap:5 });
    } else {
      update({ silenceMode:"precise", silenceThresholdDb:-30, silenceMinDuration:1.5, silenceGap:1 });
    }
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
    toast.success(`✓ تم تطبيق إعدادات ${mode === "prayer" ? "الصلاة" : "الدقيق"}`);
  };

  const storageUsed = (() => {
    let total = 0;
    for (let k in localStorage) {
      if (localStorage.hasOwnProperty(k)) total += localStorage[k].length * 2;
    }
    return (total / 1024).toFixed(1);
  })();

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      <div className="max-w-lg mx-auto px-4 py-6 space-y-4">

        {/* Header */}
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-3">
            <a href="/app/tools"
              className="w-8 h-8 flex items-center justify-center rounded-xl text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-800 transition-all"
              aria-label="رجوع">
              <ChevronLeft className="w-4 h-4"/>
            </a>
            <h1 className="text-xl font-bold text-slate-800 dark:text-slate-200">الإعدادات</h1>
          </div>
          {saved && (
            <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium flex items-center gap-1">
              ✓ تم الحفظ
            </span>
          )}
        </div>

        {/* ── 1. إعدادات الصمت ← الأهم ────────────────────────────────── */}
        <Section
          icon={<Volume2 className="w-4 h-4 text-violet-500"/>}
          title="إعدادات إزالة الصمت"
          sub="تُستخدم في كل أدوات إزالة الصمت بالبرنامج">

          {/* Presets */}
          <Row label="الوضع" sub="اختر إعداداً سريعاً أو خصّص يدوياً">
            <SegControl
              value={settings.silenceMode}
              onChange={v => handleSilencePreset(v as "prayer" | "precise")}
              options={[
                { value: "prayer",  label: "🕌 صلاة" },
                { value: "precise", label: "🎤 دقيق" },
              ]}
            />
          </Row>

          {/* Manual controls */}
          <div className="px-5 py-4 space-y-4 bg-slate-50/50 dark:bg-slate-800/30">
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <p className="text-xs font-semibold text-slate-600 dark:text-slate-400">عتبة الصمت</p>
                <p className="text-xs text-slate-400">كلما انخفضت القيمة، اكتُشف صمت أقوى فقط</p>
              </div>
              <Slider value={settings.silenceThresholdDb} min={-60} max={-5} step={1}
                onChange={v => update({ silenceThresholdDb: v })} unit=" dB"/>
            </div>
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <p className="text-xs font-semibold text-slate-600 dark:text-slate-400">الحد الأدنى لمدة الصمت</p>
                <p className="text-xs text-slate-400">أقل من هذا = لا يُحذف</p>
              </div>
              <Slider value={settings.silenceMinDuration} min={0.5} max={30} step={0.5}
                onChange={v => update({ silenceMinDuration: v })} unit=" ث"/>
            </div>
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <p className="text-xs font-semibold text-slate-600 dark:text-slate-400">الفجوة البديلة</p>
                <p className="text-xs text-slate-400">صمت قصير يُوضع بدلاً من الصمت الطويل</p>
              </div>
              <Slider value={settings.silenceGap} min={0} max={10} step={0.5}
                onChange={v => update({ silenceGap: v })} unit=" ث"/>
            </div>

            {/* Summary chip */}
            <div className="flex items-center gap-2 bg-violet-50 dark:bg-violet-950/30 border border-violet-200 dark:border-violet-800 rounded-xl px-3 py-2">
              <span className="text-xs text-violet-700 dark:text-violet-300 font-mono">
                {settings.silenceThresholdDb} dB
                · {settings.silenceMinDuration}ث min
                · {settings.silenceGap}ث gap
              </span>
              <button onClick={() => update({ silenceThresholdDb:-20, silenceMinDuration:5, silenceGap:5 })}
                className="mr-auto text-xs text-violet-400 hover:text-violet-600 transition-colors">
                إعادة للافتراضي
              </button>
            </div>
          </div>
        </Section>

        {/* ── 2. المظهر ──────────────────────────────────────────────────── */}
        <Section icon={<Moon className="w-4 h-4 text-slate-500"/>} title="المظهر">
          <Row label="وضع العرض" sub="يؤثر على ألوان التطبيق بالكامل">
            <SegControl
              value={settings.theme}
              onChange={handleThemeChange}
              options={[
                { value: "light",  label: "فاتح",   icon: <Sun className="w-3 h-3 ml-1"/> },
                { value: "system", label: "تلقائي", icon: <Monitor className="w-3 h-3 ml-1"/> },
                { value: "dark",   label: "داكن",   icon: <Moon className="w-3 h-3 ml-1"/> },
              ]}
            />
          </Row>
        </Section>

        {/* ── 3. التصدير ─────────────────────────────────────────────────── */}
        <Section icon={<Sliders className="w-4 h-4 text-blue-500"/>} title="التصدير الافتراضي">
          <Row label="صيغة التحميل" sub="تُستخدم عند ضغط تحميل سريع">
            <SegControl
              value={settings.defaultExport}
              onChange={v => update({ defaultExport: v as AppSettings["defaultExport"] })}
              options={[
                { value: "mp3_128", label: "MP3 128k" },
                { value: "mp3_192", label: "MP3 192k" },
                { value: "wav",     label: "WAV" },
              ]}
            />
          </Row>
        </Section>

        {/* ── 4. الخصوصية والبيانات ─────────────────────────────────────── */}
        <Section icon={<Shield className="w-4 h-4 text-emerald-500"/>} title="الخصوصية والبيانات">
          <Row label="حفظ السجل تلقائياً" sub="تسجيل كل عملية تصدير">
            <button onClick={() => update({ autoHistory: !settings.autoHistory })}
              aria-label="تفعيل/إيقاف حفظ السجل"
              className={`relative w-11 h-6 rounded-full transition-colors flex-shrink-0 ${
                settings.autoHistory ? "bg-blue-600" : "bg-slate-300 dark:bg-slate-600"
              }`}>
              <span className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
                settings.autoHistory ? "translate-x-5" : "translate-x-0.5"
              }`}/>
            </button>
          </Row>
          <Row
            label="السجل المحلي"
            sub={`${entries.length} ملف · ${storageUsed} KB`}>
            <button onClick={handleClearHistory}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-xl border transition-all ${
                confirmClear
                  ? "bg-red-600 border-red-600 text-white"
                  : "border-slate-300 dark:border-slate-600 text-slate-500 hover:border-red-400 hover:text-red-500"
              }`}>
              <Trash2 className="w-3.5 h-3.5"/>
              {confirmClear ? "تأكيد ؟" : "مسح السجل"}
            </button>
          </Row>
          <Row label="مسح جميع البيانات" sub="يشمل الإعدادات والسجل والتفضيلات">
            <button onClick={() => {
              if (!confirm("سيتم مسح جميع البيانات. هل أنت متأكد؟")) return;
              localStorage.clear();
              toast.success("تم مسح جميع البيانات");
              setTimeout(() => window.location.reload(), 1000);
            }}
              className="px-3 py-1.5 text-xs rounded-xl border border-red-300 dark:border-red-700 text-red-500 hover:bg-red-50 dark:hover:bg-red-950/40 transition-all">
              مسح الكل
            </button>
          </Row>
        </Section>

        {/* ── 5. عن البرنامج ────────────────────────────────────────────── */}
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 px-5 py-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-bold text-slate-800 dark:text-slate-200">معالج الصوت الذكي</p>
              <p className="text-xs text-slate-400 mt-0.5">
                v1.0 · يعمل كلياً في متصفحك · لا رفع للسحابة
              </p>
            </div>
            <span className="text-xs text-emerald-600 dark:text-emerald-400 font-semibold bg-emerald-50 dark:bg-emerald-950/40 px-2 py-1 rounded-lg">
              محلي ✓
            </span>
          </div>
        </div>

      </div>
    </div>
  );
}
