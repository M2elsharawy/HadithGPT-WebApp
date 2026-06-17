import { useAuth } from "@/_core/hooks/useAuth";
import { useLocation } from "wouter";
import { Scissors, MicOff, Sliders, Layers, ShieldCheck, ArrowLeft, Mic2, Zap } from "lucide-react";
import { useEffect } from "react";
import { CLIENT_ONLY_MODE } from "@/lib/clientMode";

export default function Home() {
  const { isAuthenticated } = useAuth();
  const [, setLocation] = useLocation();

  useEffect(() => {
    // In client-only mode the auth stub always returns isAuthenticated=true,
    // so we skip the redirect to let users see the landing page.
    if (isAuthenticated && !CLIENT_ONLY_MODE) setLocation("/app/tools");
  }, [isAuthenticated]);

  return (
    <div dir="rtl" className="min-h-screen bg-white dark:bg-slate-950 flex flex-col selection:bg-[#0F7D86]/20">

      {/* ── Nav ─────────────────────────────────────────────────────────── */}
      <nav className="sticky top-0 z-50 bg-white/80 dark:bg-slate-950/80 backdrop-blur-xl border-b border-slate-100 dark:border-slate-800">
        <div className="max-w-5xl mx-auto flex items-center justify-between px-5 py-3.5">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-[#0F7D86] flex items-center justify-center shadow-sm">
              <span className="text-white text-sm">🎙</span>
            </div>
            <span dir="ltr" className="font-bold text-slate-800 dark:text-slate-200 text-sm tracking-tight">SawtWave</span>
          </div>
          <div className="flex items-center gap-2">
            <a href="#steps"
              className="px-4 py-2 text-sm text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors font-medium">
              كيف يعمل
            </a>
            <a href="#tools"
              className="px-4 py-2 text-sm text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white transition-colors font-medium">
              الأدوات
            </a>
            <a href="/app/tools"
              className="flex items-center gap-1.5 px-4 py-2 bg-[#0F7D86] hover:bg-[#0B5A61] text-white text-sm font-bold rounded-xl transition-all shadow-sm active:scale-95">
              ابدأ الآن
              <ArrowLeft className="w-3.5 h-3.5"/>
            </a>
          </div>
        </div>
      </nav>

      {/* ── Hero ────────────────────────────────────────────────────────── */}
      <main className="flex-1">
        <div className="max-w-3xl mx-auto px-5 pt-16 pb-12 text-center">

          {/* Eyebrow */}
          <p className="text-sm font-semibold text-[#0F7D86] mb-6 tracking-wide">
            أدوات صوتية في متصفحك
          </p>

          <h1 className="text-4xl sm:text-5xl font-black text-slate-900 dark:text-white leading-tight tracking-tight mb-4">
            ارفع. عدّل. احفظ.
          </h1>

          <p className="text-lg text-slate-500 dark:text-slate-400 leading-relaxed max-w-xl mx-auto mb-8">
            احذف الصمت تلقائياً، قطّع وادمج الملفات، وصدّر للواتساب — بدون خبرة تقنية
          </p>

          {/* Primary CTAs */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 mb-4">
            <a href="/app/tools"
              className="flex items-center gap-2 px-8 py-3.5 bg-[#0F7D86] hover:bg-[#0B5A61] text-white font-bold rounded-2xl text-base transition-all shadow-lg shadow-[#0F7D86]/20 dark:shadow-none active:scale-[0.97]">
              <Zap className="w-4 h-4"/>
              ابدأ الآن
            </a>
            <a href="#tools"
              className="flex items-center gap-2 px-8 py-3.5 border-2 border-slate-200 dark:border-slate-700 hover:border-[#0F7D86] dark:hover:border-[#0F7D86] text-slate-700 dark:text-slate-300 font-bold rounded-2xl text-base transition-all">
              استكشف الأدوات ←
            </a>
          </div>
          <p className="text-xs text-slate-400">لا تسجيل حساب · مجاني تماماً · يعمل بدون إنترنت</p>
        </div>

        {/* ── How it works ───────────────────────────────────────────────── */}
        <div id="steps" className="max-w-3xl mx-auto px-5 pb-12">
          <div className="grid grid-cols-3 gap-4 text-center">
            {[
              { step:"1", icon:"⬆", label:"ارفع الملف", sub:"MP3 أو WAV أو M4A" },
              { step:"2", icon:"✨", label:"اختر الأداة", sub:"تقطيع أو إزالة صمت أو تحسين" },
              { step:"3", icon:"⬇", label:"حمّل النتيجة", sub:"MP3 جاهز للواتساب" },
            ].map(s => (
              <div key={s.step} className="relative">
                <div className="w-12 h-12 rounded-2xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-xl mx-auto mb-3">
                  {s.icon}
                </div>
                <p className="font-bold text-slate-800 dark:text-slate-200 text-sm mb-0.5">{s.label}</p>
                <p className="text-xs text-slate-400">{s.sub}</p>
              </div>
            ))}
          </div>
        </div>

        {/* ── Features / Tools ───────────────────────────────────────────── */}
        <div id="tools" className="bg-slate-50 dark:bg-slate-900/50 border-t border-b border-slate-100 dark:border-slate-800 py-12">
          <div className="max-w-3xl mx-auto px-5">
            <p className="text-xs font-bold text-slate-400 uppercase tracking-widest text-center mb-6">
              الأدوات
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {[
                { icon:<MicOff className="w-4 h-4"/>,   label:"إزالة الصمت التلقائية", sub:"ذكاء اصطناعي للصلاة",        color:"violet" },
                { icon:<Scissors className="w-4 h-4"/>, label:"تقطيع يدوي دقيق",        sub:"موجة تفاعلية كاملة",         color:"blue"   },
                { icon:<Sliders className="w-4 h-4"/>,  label:"تحسين الجودة",           sub:"معادل + وضوح + ضغط",         color:"amber"  },
                { icon:<Layers className="w-4 h-4"/>,   label:"دمج ملفات",              sub:"ادمج تسجيلات عدة معاً",       color:"indigo" },
                { icon:<Mic2 className="w-4 h-4"/>,     label:"استخراج النص",            sub:"نسخ التلاوة كتابةً",          color:"teal"   },
                { icon:<ShieldCheck className="w-4 h-4"/>, label:"خصوصية 100%",          sub:"لا شيء يغادر جهازك",         color:"emerald"},
              ].map(f => {
                const cls: Record<string,string> = {
                  violet: "bg-violet-100 dark:bg-violet-950/60 text-violet-600 dark:text-violet-400",
                  blue:   "bg-blue-100 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400",
                  amber:  "bg-amber-100 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400",
                  indigo: "bg-indigo-100 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400",
                  teal:   "bg-teal-100 dark:bg-teal-950/60 text-teal-600 dark:text-teal-400",
                  emerald:"bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400",
                };
                return (
                  <div key={f.label} className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 flex items-start gap-3">
                    <div className={`w-8 h-8 rounded-xl flex items-center justify-center flex-shrink-0 ${cls[f.color]}`}>
                      {f.icon}
                    </div>
                    <div>
                      <p className="text-sm font-bold text-slate-800 dark:text-slate-200 leading-tight">{f.label}</p>
                      <p className="text-xs text-slate-400 mt-0.5">{f.sub}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* ── Final CTA ──────────────────────────────────────────────────── */}
        <div className="max-w-lg mx-auto px-5 py-14 text-center">
          <p className="text-2xl font-black text-slate-800 dark:text-slate-200 mb-2">جاهز للبدء؟</p>
          <p className="text-slate-400 text-sm mb-6">لا تسجيل، لا دفع، لا انتظار</p>
          <a href="/app/tools"
            className="inline-flex items-center gap-2 px-10 py-4 bg-[#0F7D86] hover:bg-[#0B5A61] text-white font-black rounded-2xl text-base transition-all shadow-xl shadow-[#0F7D86]/20 dark:shadow-none active:scale-[0.97]">
            <Zap className="w-5 h-5"/>
            ابدأ الآن — مجاناً
          </a>
        </div>
      </main>

      {/* ── Footer ──────────────────────────────────────────────────────── */}
      <footer className="border-t border-slate-100 dark:border-slate-800 py-5 text-center">
        <p className="text-xs text-slate-400">
          <span dir="ltr">SawtWave</span> · يعمل في متصفحك · مجاني بالكامل
        </p>
      </footer>
    </div>
  );
}
