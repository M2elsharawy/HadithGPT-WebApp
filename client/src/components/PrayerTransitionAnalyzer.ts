/**
 * PrayerTransitionAnalyzer
 * ─────────────────────────────────────────────────────────────────────────────
 * طبقة تحليل ثانية تعمل بعد اكتشاف الصمت.
 * تكشف المقاطع الصوتية القصيرة المعزولة (تكبيرات، انتقالات، سلام، إقامة)
 * وتُصنّفها بقواعد حتمية — بدون ذكاء اصطناعي.
 *
 * المبدأ الأساسي:
 *   الحذف الخاطئ للقرآن أسوأ من إبقاء صوت إضافي.
 *   لا يُحذف أي مقطع تلقائياً — فقط يُقترح للمراجعة.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export type TransitionClass =
  | "quran_likely"          // مقطع طويل — محتمل أنه قرآن
  | "takbeer_candidate"     // مقطع قصير معزول بين فترات صمت طويلة
  | "transition_candidate"  // انتقال (ركوع/سجود) — قصير بعد/قبل مقطع طويل
  | "iqama_or_intro"        // قبل أول مقطع قرآن طويل
  | "salam_or_outro"        // بعد آخر مقطع قرآن طويل
  | "review";               // غير محدد — يحتاج مراجعة بشرية

export interface VoicedSegment {
  id:            string;
  startSec:      number;
  endSec:        number;
  durationSec:   number;
  rmsDb:         number;   // مستوى RMS بالـ dB
  peakDb:        number;   // مستوى الذروة بالـ dB
  silenceBefore: number;   // مدة الصمت قبله بالثواني
  silenceAfter:  number;   // مدة الصمت بعده بالثواني
  positionRatio: number;   // موقعه في الملف (0 = بداية، 1 = نهاية)
  classification: TransitionClass;
  confidence:    number;   // 0–1 — مستوى الثقة في التصنيف
  safeToRemove:  boolean;  // true فقط للمقاطع عالية الثقة وغير القرآنية
  enabled:       boolean;  // هل المستخدم قرر حذفه؟ (false افتراضياً)
}

export interface TransitionAnalysisResult {
  voicedSegments:       VoicedSegment[];
  quranLikeCount:       number;
  takbeerCount:         number;
  transitionCount:      number;
  iqamaCount:           number;
  salamCount:           number;
  reviewCount:          number;
  totalDurationToRemove: number; // مجموع مدد المقاطع المُقترح حذفها
}

// ─── Constants (قابلة للتعديل) ────────────────────────────────────────────────

const MIN_VOICED_SEC        = 0.3;   // أقل من هذا = ضجيج، لا نحلله
const MAX_TAKBEER_SEC       = 4.0;   // أقصى مدة للتكبير
const MAX_TRANSITION_SEC    = 6.0;   // أقصى مدة للانتقال
const MIN_QURAN_BLOCK_SEC   = 8.0;   // الحد الأدنى للمقطع القرآني الطويل
const MIN_SILENCE_ISOLATION = 2.0;   // صمت "طويل" حول المقطع المعزول
const HIGH_ENERGY_DB        = -25;   // مستوى طاقة عالٍ (تكبير/صوت واضح)
const MIN_CONFIDENCE_REMOVE = 0.72;  // ثقة دنيا للاقتراح بالحذف

// ─── Main Analyzer ────────────────────────────────────────────────────────────

export class PrayerTransitionAnalyzer {

  private static computeAdaptiveThreshold(durations: number[]): {
    shortMax:     number;
    longMin:      number;
    protectedMin: number;
  } {
    if (durations.length < 3) {
      return { shortMax: 4, longMin: 8, protectedMin: 8 };
    }

    const sorted = [...durations].sort((a, b) => a - b);
    const maxDuration = sorted[sorted.length - 1];
    const median      = sorted[Math.floor(sorted.length / 2)];

    const longSegs  = sorted.filter(d => d > median);
    const shortSegs = sorted.filter(d => d <= median);

    const longMin  = longSegs.length  > 0 ? Math.min(...longSegs)  : median;
    const shortMax = shortSegs.length > 0 ? Math.max(...shortSegs) : median;

    const protectedMin = Math.max(maxDuration * 0.5, 6);

    return { shortMax, longMin, protectedMin };
  }

  /**
   * التحليل الرئيسي
   * @param audioBuffer  الـ buffer الصوتي (بعد إزالة الصمت أو الأصلي)
   * @param silenceThresholdDb  نفس عتبة SilenceProcessor
   */
  static analyze(
    audioBuffer: AudioBuffer,
    silenceThresholdDb = -20
  ): TransitionAnalysisResult {

    const sr      = audioBuffer.sampleRate;
    const ch0     = audioBuffer.getChannelData(0);
    const totalSec = audioBuffer.duration;

    // ── 1. حساب RMS لكل 50ms ─────────────────────────────────────────────────
    const WIN_SEC  = 0.05; // نافذة 50ms
    const WIN_SAMP = Math.floor(WIN_SEC * sr);
    const numWin   = Math.floor(ch0.length / WIN_SAMP);

    const rmsDb = new Float32Array(numWin);
    const threshLinear = Math.pow(10, silenceThresholdDb / 20);

    for (let w = 0; w < numWin; w++) {
      const s = w * WIN_SAMP;
      const e = Math.min(s + WIN_SAMP, ch0.length);
      let sum = 0;
      for (let i = s; i < e; i++) sum += ch0[i] * ch0[i];
      const rms = Math.sqrt(sum / (e - s));
      rmsDb[w] = rms < 1e-9 ? -100 : 20 * Math.log10(rms);
    }

    // ── 2. تحديد مناطق الصمت والصوت ─────────────────────────────────────────
    // Hold: 3 نوافذ (150ms) لتجنب قطع نهايات الكلمات
    const HOLD_WIN = 3;
    const isSilent = new Uint8Array(numWin);
    for (let w = 0; w < numWin; w++) {
      if (rmsDb[w] < silenceThresholdDb) isSilent[w] = 1;
    }
    // تطبيق Hold: إذا بعد نافذة صوت يوجد صمت قصير → اعتبره صوت
    for (let w = 0; w < numWin - HOLD_WIN; w++) {
      if (isSilent[w] === 0) {
        for (let h = 1; h <= HOLD_WIN; h++) isSilent[w + h] = 0;
      }
    }

    // ── 3. استخراج مقاطع الصوت المتجاورة ────────────────────────────────────
    interface RawSegment {
      startWin: number; endWin: number;
      startSec: number; endSec: number; durationSec: number;
      peakRmsDb: number; avgRmsDb: number;
    }

    const rawSegs: RawSegment[] = [];
    let inVoiced = false;
    let segStart = 0;

    for (let w = 0; w <= numWin; w++) {
      const silent = w === numWin || isSilent[w] === 1;
      if (!inVoiced && !silent) {
        inVoiced = true; segStart = w;
      } else if (inVoiced && silent) {
        inVoiced = false;
        const dur = (w - segStart) * WIN_SEC;
        if (dur >= MIN_VOICED_SEC) {
          // حساب Peak + Avg RMS
          let sumDb = 0, peakDb = -100;
          for (let i = segStart; i < w; i++) {
            sumDb += rmsDb[i];
            if (rmsDb[i] > peakDb) peakDb = rmsDb[i];
          }
          rawSegs.push({
            startWin: segStart, endWin: w,
            startSec: segStart * WIN_SEC,
            endSec: w * WIN_SEC,
            durationSec: dur,
            peakRmsDb: peakDb,
            avgRmsDb: sumDb / (w - segStart),
          });
        }
      }
    }

    // ── 4. حساب الصمت قبل وبعد كل مقطع ─────────────────────────────────────
    const getSilenceDuration = (fromWin: number, direction: 1 | -1): number => {
      let count = 0;
      let w = fromWin;
      while (w >= 0 && w < numWin && isSilent[w] === 1) {
        count++;
        w += direction;
      }
      return count * WIN_SEC;
    };

    // ── 5. عتبات تكيّفية ─────────────────────────────────────────────────────
    const { shortMax, longMin, protectedMin } =
      PrayerTransitionAnalyzer.computeAdaptiveThreshold(rawSegs.map(s => s.durationSec));

    // ── 6. تصنيف كل مقطع ────────────────────────────────────────────────────
    const voicedSegments: VoicedSegment[] = rawSegs.map((seg, idx) => {
      const silBefore = getSilenceDuration(seg.startWin - 1, -1);
      const silAfter  = getSilenceDuration(seg.endWin,      +1);
      const posRatio  = seg.startSec / totalSec;

      let classification: TransitionClass = "review";
      let confidence = 0.3;
      let safeToRemove = false;

      if (seg.durationSec >= protectedMin) {
        // مقطع محمي — طويل جداً بالنسبة لأطول مقطع
        classification = "quran_likely";
        confidence = 0.97;
        safeToRemove = false;

      } else if (seg.durationSec >= longMin) {
        // مقطع طويل نسبياً = قرآن على الأرجح
        classification = "quran_likely";
        confidence = 0.90;
        safeToRemove = false;

      } else if (seg.durationSec <= shortMax && (silBefore >= 1 || silAfter >= 1)) {
        // مقطع قصير بجانب صمت = تكبير أو انتقال
        classification = "takbeer_candidate";
        confidence = 0.80;
        safeToRemove = true;

      } else {
        // بين القصير والطويل — غير محدد
        classification = "review";
        confidence = 0.35;
        safeToRemove = false;
      }

      return {
        id:            `tr_${idx}_${Math.floor(seg.startSec)}`,
        startSec:      seg.startSec,
        endSec:        seg.endSec,
        durationSec:   seg.durationSec,
        rmsDb:         seg.avgRmsDb,
        peakDb:        seg.peakRmsDb,
        silenceBefore: silBefore,
        silenceAfter:  silAfter,
        positionRatio: posRatio,
        classification,
        confidence,
        safeToRemove,
        enabled:       false, // المستخدم يختار — لا حذف تلقائي
      };
    });

    // ── 7. إحصائيات ──────────────────────────────────────────────────────────
    const counts = {
      quranLikeCount:   voicedSegments.filter(s => s.classification === "quran_likely").length,
      takbeerCount:     voicedSegments.filter(s => s.classification === "takbeer_candidate").length,
      transitionCount:  voicedSegments.filter(s => s.classification === "transition_candidate").length,
      iqamaCount:       voicedSegments.filter(s => s.classification === "iqama_or_intro").length,
      salamCount:       voicedSegments.filter(s => s.classification === "salam_or_outro").length,
      reviewCount:      voicedSegments.filter(s => s.classification === "review").length,
    };

    const totalDurationToRemove = voicedSegments
      .filter(s => s.safeToRemove)
      .reduce((acc, s) => acc + s.durationSec, 0);

    return { voicedSegments, ...counts, totalDurationToRemove };
  }

  /** تسمية عربية لكل تصنيف */
  static classLabel(cls: TransitionClass): string {
    return {
      quran_likely:         "تلاوة",
      takbeer_candidate:    "تكبير محتمل",
      transition_candidate: "انتقال محتمل",
      iqama_or_intro:       "إقامة أو افتتاح",
      salam_or_outro:       "تسليم أو خاتمة",
      review:               "يحتاج مراجعة",
    }[cls];
  }

  /** لون كل تصنيف للواجهة */
  static classColor(cls: TransitionClass): string {
    return {
      quran_likely:         "#10b981", // أخضر
      takbeer_candidate:    "#f59e0b", // أصفر
      transition_candidate: "#6366f1", // بنفسجي
      iqama_or_intro:       "#3b82f6", // أزرق
      salam_or_outro:       "#8b5cf6", // بنفسجي فاتح
      review:               "#94a3b8", // رمادي
    }[cls];
  }

  /** وصف مختصر للتصنيف */
  static classDescription(cls: TransitionClass): string {
    return {
      quran_likely:         "مقطع طويل — على الأرجح تلاوة قرآنية",
      takbeer_candidate:    "مقطع قصير معزول بين فترات صمت — محتمل تكبير",
      transition_candidate: "مقطع قصير بجانب صمت — محتمل انتقال",
      iqama_or_intro:       "في بداية التسجيل قبل التلاوة",
      salam_or_outro:       "في نهاية التسجيل بعد التلاوة",
      review:               "غير محدد — يحتاج مراجعة",
    }[cls];
  }

  /** تنسيق الثواني */
  static fmt(sec: number): string {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  }
}
