import { useAuth } from "@/_core/hooks/useAuth";
import { useLocation } from "wouter";
import { Scissors, MicOff, Sliders, Layers, ArrowLeft, Mic2, Zap, Info, Upload, Download } from "lucide-react";
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
          <p className="text-xs font-bold text-slate-400 uppercase tracking-widest text-center mb-2">كيف يعمل</p>
          <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100 text-center mb-6">ثلاث خطوات بسيطة</h2>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {[
              { step:"01", icon:<Upload   className="w-10 h-10"/>, label:"ارفع",  desc:"اسحب ملفك الصوتي أو اختره من جهازك. يبدأ التحرير مباشرة في المتصفح." },
              { step:"02", icon:<Sliders  className="w-10 h-10"/>, label:"عدّل",  desc:"قص، أزل الصمت، ادمج، أو حسّن الوضوح بخطوات واضحة وبدون تعقيد." },
              { step:"03", icon:<Download className="w-10 h-10"/>, label:"احفظ",  desc:"حمّل ملفك الجاهز بعد المعالجة، واحتفظ بالنسخة المناسبة لاستخدامك." },
            ].map(s => (
              <div key={s.step} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-7 text-center flex flex-col items-center gap-3">
                <span className="text-xs font-mono text-[#0F7D86] tracking-widest uppercase">{s.step}</span>
                <div className="text-[#0F7D86]">{s.icon}</div>
                <p className="font-bold text-slate-800 dark:text-slate-200 text-base">{s.label}</p>
                <p className="text-xs text-slate-400 leading-relaxed">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>

        {/* ── Features / Tools ───────────────────────────────────────────── */}
        <div id="tools" className="bg-slate-50 dark:bg-slate-900/50 border-t border-b border-slate-100 dark:border-slate-800 py-12">
          <div className="max-w-3xl mx-auto px-5">
            <p className="text-xs font-bold text-slate-400 uppercase tracking-widest text-center mb-2">
              الأدوات
            </p>
            <h2 className="text-xl font-bold text-slate-800 dark:text-slate-100 text-center mb-6">
              كل ما تحتاجه لتحرير الصوت
            </h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {[
                { icon:<Scissors className="w-5 h-5"/>, label:"تقطيع الصوت",  tag:false, desc:"قص المقاطع بدقة واحفظ الجزء الذي تحتاجه فقط." },
                { icon:<MicOff   className="w-5 h-5"/>, label:"إزالة الصمت",  tag:false, desc:"قلل الفواصل الطويلة تلقائيًا مع الحفاظ على الكلام." },
                { icon:<Layers   className="w-5 h-5"/>, label:"دمج الملفات",  tag:false, desc:"اجمع أكثر من ملف صوتي في ملف واحد بسهولة." },
                { icon:<Sliders  className="w-5 h-5"/>, label:"تحسين الصوت", tag:true,  desc:"حسّن الوضوح وقلّل بعض الضوضاء حسب جودة التسجيل." },
                { icon:<Mic2     className="w-5 h-5"/>, label:"استخراج النص", tag:false, desc:"استخرج نصًا قابلًا للمراجعة من الكلام الواضح في الملف الصوتي." },
              ].map(f => (
                <div key={f.label} className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 flex flex-col gap-3">
                  <div className="w-10 h-10 rounded-xl bg-[#E3EEEE] dark:bg-[#0F7D86]/10 text-[#0F7D86] flex items-center justify-center flex-shrink-0">
                    {f.icon}
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-bold text-slate-800 dark:text-slate-200 leading-tight flex items-center gap-2">
                      {f.label}
                      {f.tag && <span className="text-[10px] font-mono uppercase tracking-wider bg-slate-100 dark:bg-slate-800 text-slate-400 rounded px-1.5 py-0.5">تجريبي</span>}
                    </p>
                    <p className="text-xs text-slate-400 mt-1 leading-relaxed">{f.desc}</p>
                  </div>
                  <a href="/app/tools" className="inline-flex items-center gap-1 text-xs font-semibold text-[#0F7D86] mt-auto">
                    استخدم الأداة
                    <ArrowLeft className="w-3 h-3"/>
                  </a>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── Honest Note ──────────────────────────────────────────────── */}
        <div className="max-w-3xl mx-auto px-5 py-10">
          <div className="flex gap-4 items-start bg-[#FBF7EE] border border-[#D8CAAA] rounded-2xl px-6 py-5 max-w-2xl mx-auto">
            <Info className="w-6 h-6 text-[#C79A4E] flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-bold text-[#4A3810] mb-1.5">ملاحظة حول تحسين الصوت</p>
              <p className="text-sm text-[#6B5030] leading-relaxed">
                تعتمد جودة التحسين على جودة التسجيل الأصلي. تساعد الأداة على تحسين الوضوح وتقليل بعض الضوضاء، لكنها لا تَعِد بجودة استوديو ولا بإزالة كاملة للضوضاء.
              </p>
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
