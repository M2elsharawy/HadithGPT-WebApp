/**
 * SmartPrayerAnalyzer  v2
 * ────────────────────────────────────────────────────────────────────────────
 * تحليل سياقي تكيّفي لأجزاء الصمت في تسجيلات الصلاة.
 *
 * مبادئ التصميم:
 *   - Pure module: لا imports خارجية، لا side effects
 *   - O(n) overall: quickselect للـ percentiles، two-pointer للـ localDensity
 *   - كل segment يُحلَّل في السياق الكامل للملف
 *   - لا تعديل على SilenceProcessor أو AudioTrimmerEngine
 */

// ─── Input types ──────────────────────────────────────────────────────────────

export interface RawSegment {
  id: string;
  startSec: number;
  endSec: number;
  durationSec: number;
  enabled: boolean;
}

export type RmsFrames = Float32Array | number[];

export interface AnalyzerOptions {
  thresholdDb: number;
  sampleRate: number;
  windowSize: number;

  // Adaptive thresholds
  shortPauseMaxSec?: number;   // fallback إذا عدد الأجزاء < minSegmentsForAdaptive
  longPauseMaxSec?: number;    // fallback
  minSegmentsForAdaptive?: number; // default: 5

  // Context window
  localDensityWindowSec?: number; // default: 10 (±10s)

  // Confidence thresholds
  removeThreshold?: number;    // default: 0.75
  reviewThreshold?: number;    // default: 0.50

  // Confidence weights (يجب أن يجمعها 1)
  weightDuration?:  number;    // default: 0.35
  weightDepth?:     number;    // default: 0.40
  weightStability?: number;    // default: 0.25

  // Context adjustment limits
  maxContextAdj?: number;      // default: 0.15 — أقصى تعديل لكل عامل سياقي
}

// ─── Output types ─────────────────────────────────────────────────────────────

export type SegmentType =
  | "short_pause"
  | "long_pause"
  | "rukoo_sujood";

export type RecommendedAction = "remove" | "review" | "keep";

export interface SegmentContext {
  gapBefore:        number | null; // فجوة من نهاية الجزء السابق (null إذا لا يوجد)
  gapAfter:         number | null; // فجوة حتى بداية الجزء التالي
  localDensity:     number;        // عدد الأجزاء ضمن ±window (لا يشمل الجزء نفسه)
  relativeDuration: number;        // 0–1 مقارنةً بمتوسط المجاورين
}

export interface EnrichedSegment extends RawSegment {
  type:                SegmentType;
  confidence:          number;         // 0–1
  avgDb:               number;
  variance:            number;
  recommendedAction:   RecommendedAction;
  context:             SegmentContext;
  _scores: {
    duration:   number;
    depth:      number;
    stability:  number;
    contextAdj: number; // التعديل الكلي المُطبَّق على الثقة
  };
}

// ─── Internal: Quickselect (O(n) average) ────────────────────────────────────
// نستخدمها لإيجاد percentile بدون فرز كامل

function partition(arr: number[], lo: number, hi: number, pivotIdx: number): number {
  const pivot = arr[pivotIdx];
  [arr[pivotIdx], arr[hi]] = [arr[hi], arr[pivotIdx]];
  let store = lo;
  for (let i = lo; i < hi; i++) {
    if (arr[i] < pivot) {
      [arr[i], arr[store]] = [arr[store], arr[i]];
      store++;
    }
  }
  [arr[store], arr[hi]] = [arr[hi], arr[store]];
  return store;
}

/** إيجاد k-th أصغر عنصر في O(n) average — يُعدّل arr in-place */
function quickselect(arr: number[], k: number): number {
  let lo = 0;
  let hi = arr.length - 1;
  while (lo < hi) {
    const pivotIdx = lo + Math.floor(Math.random() * (hi - lo + 1));
    const pos = partition(arr, lo, hi, pivotIdx);
    if (pos === k) break;
    else if (pos < k) lo = pos + 1;
    else              hi = pos - 1;
  }
  return arr[k];
}

/**
 * حساب percentile بكفاءة على نسخة من المصفوفة.
 * نسخ صغيرة (n < 200) — لا تأثير يُذكر على الأداء.
 */
function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  if (values.length === 1) return values[0];
  const copy = values.slice();
  const idx  = Math.max(0, Math.min(copy.length - 1,
    Math.floor(p * copy.length)));
  return quickselect(copy, idx);
}

// ─── Internal: RMS metrics per segment ───────────────────────────────────────

interface RmsMetrics { avgDb: number; variance: number }

function computeRmsMetrics(
  seg: RawSegment,
  rmsFrames: RmsFrames,
  sampleRate: number,
  windowSize: number,
  thresholdDb: number
): RmsMetrics {
  const totalFrames = rmsFrames.length;
  const fStart = Math.max(0,
    Math.min(totalFrames - 1, Math.floor((seg.startSec * sampleRate) / windowSize)));
  const fEnd   = Math.max(fStart,
    Math.min(totalFrames - 1, Math.floor((seg.endSec   * sampleRate) / windowSize)));

  // Welford's online algorithm — single pass, numerically stable
  let mean   = 0;
  let M2     = 0;
  let validN = 0;

  for (let i = fStart; i <= fEnd; i++) {
    const db = rmsFrames[i] as number;
    if (!isFinite(db)) continue;
    validN++;
    const delta  = db - mean;
    mean        += delta / validN;
    M2          += delta * (db - mean);
  }

  return {
    avgDb:    validN > 0 ? mean            : thresholdDb - 30,
    variance: validN > 1 ? M2 / (validN - 1) : 0,
  };
}

// ─── Internal: Adaptive thresholds ───────────────────────────────────────────

interface AdaptiveThresholds {
  shortMax: number; // < shortMax → short_pause
  longMax:  number; // shortMax–longMax → long_pause, > longMax → rukoo_sujood
  adaptive: boolean;
}

function computeAdaptiveThresholds(
  durations: number[],
  minSegments: number,
  fallbackShort: number,
  fallbackLong: number
): AdaptiveThresholds {
  if (durations.length < minSegments) {
    return { shortMax: fallbackShort, longMax: fallbackLong, adaptive: false };
  }
  // p50 = median, p80 = top 20% boundary
  const p50 = percentile(durations, 0.50);
  const p80 = percentile(durations, 0.80);

  return {
    shortMax: Math.max(0.5, p50),        // لا تقل عن 0.5s
    longMax:  Math.max(p50 + 0.1, p80),  // يجب أن تكون > shortMax
    adaptive: true,
  };
}

// ─── Internal: Context features ──────────────────────────────────────────────

interface ContextFeature {
  gapBefore:        number | null;
  gapAfter:         number | null;
  localDensity:     number;
  relativeDuration: number;
  prevDuration:     number | null; // للـ confidence adjustment
  nextDuration:     number | null;
}

/**
 * Two-pointer sliding window — O(n) total.
 *
 * المؤشران left وright يتقدمان فقط للأمام —
 * لا نُعيد ضبطهما لكل segment من الصفر.
 */
function computeContextFeatures(
  segments: RawSegment[],
  windowSec: number
): ContextFeature[] {
  const n       = segments.length;
  const result: ContextFeature[] = new Array(n);

  // إحصاء durations المجاورة لكل segment ضمن ±windowSec
  // نُشغّل مؤشريَن منفصلَيْن: أحدهما للشمال والآخر للجنوب
  let left  = 0; // أصغر index داخل النافذة
  let right = 0; // أكبر index + 1 داخل النافذة

  for (let i = 0; i < n; i++) {
    const seg     = segments[i];
    const wStart  = seg.startSec - windowSec;
    const wEnd    = seg.endSec   + windowSec;

    // قدّم left حتى يبدأ من النافذة
    while (left < i && segments[left].endSec < wStart) left++;

    // قدّم right حتى يخرج من النافذة
    while (right < n && segments[right].startSec <= wEnd) right++;

    // عدد الأجزاء داخل النافذة (بدون الجزء نفسه)
    const density = (right - left) - 1;

    // حساب متوسط duration المجاورين (بدون نفسه) للـ relativeDuration
    let neighborDurSum = 0;
    let neighborCount  = 0;
    for (let j = left; j < right; j++) {
      if (j === i) continue;
      neighborDurSum += segments[j].durationSec;
      neighborCount++;
    }
    const neighborAvg    = neighborCount > 0 ? neighborDurSum / neighborCount : seg.durationSec;
    const relativeDur    = neighborAvg > 0 ? seg.durationSec / neighborAvg : 1;

    // الجزء السابق والتالي المباشران
    const prev = i > 0     ? segments[i - 1] : null;
    const next = i < n - 1 ? segments[i + 1] : null;

    result[i] = {
      gapBefore:        prev ? Math.max(0, seg.startSec - prev.endSec)   : null,
      gapAfter:         next ? Math.max(0, next.startSec - seg.endSec)   : null,
      localDensity:     Math.max(0, density),
      relativeDuration: relativeDur,
      prevDuration:     prev?.durationSec ?? null,
      nextDuration:     next?.durationSec ?? null,
    };
  }

  return result;
}

// ─── Internal: Confidence components ─────────────────────────────────────────

const sigmoid = (x: number): number => 1 / (1 + Math.exp(-x));

const durationScore  = (dur: number): number => sigmoid((dur - 3) / 2);
const depthScore     = (avgDb: number, thr: number): number => sigmoid((thr - avgDb) / 10);
const stabilityScore = (variance: number): number => 1 / (1 + variance / 25);

/**
 * تعديلات الثقة بناءً على السياق.
 * كل تعديل في [-maxAdj, +maxAdj].
 * الحصيلة الكلية تُقيَّد لاحقاً في [0, 1].
 */
function contextAdjustment(
  ctx: ContextFeature,
  seg: RawSegment,
  maxAdj: number
): number {
  let adj = 0;

  // ── التعديل 1: المجاورون الطويلون ───────────────────────────────────────
  // إذا كانت الأجزاء المجاورة أطول → زيادة الثقة (محاط بصمت حقيقي)
  if (ctx.prevDuration !== null && ctx.nextDuration !== null) {
    const avgNeighbor = (ctx.prevDuration + ctx.nextDuration) / 2;
    if (avgNeighbor > seg.durationSec * 1.5) {
      // الجزء أقصر بكثير من جيرانه — قد يكون توقفاً عَرَضياً
      adj -= maxAdj * 0.5;
    } else if (avgNeighbor > 3) {
      // محاط بأجزاء طويلة — صمت حقيقي
      adj += maxAdj * 0.4;
    }
  } else if (ctx.prevDuration === null && ctx.nextDuration !== null) {
    // أول جزء في الملف — أقل ثقة
    adj -= maxAdj * 0.2;
  }

  // ── التعديل 2: الجزء المعزول بين فجوات صغيرة جداً ──────────────────────
  // gapBefore وgapAfter < 0.3s → احتمال كشف خاطئ
  const TINY_GAP = 0.3;
  if (
    ctx.gapBefore !== null && ctx.gapBefore < TINY_GAP &&
    ctx.gapAfter  !== null && ctx.gapAfter  < TINY_GAP
  ) {
    adj -= maxAdj * 0.8; // تخفيض حاد — قد يكون نبضة غير مقصودة
  } else if (
    ctx.gapBefore !== null && ctx.gapBefore < TINY_GAP &&
    ctx.gapAfter  !== null && ctx.gapAfter  > 2
  ) {
    // فجوة قبله صغيرة لكن بعده فترة صوت طويلة — مقبول
    adj += maxAdj * 0.1;
  }

  // ── التعديل 3: الكثافة المحلية ─────────────────────────────────────────
  // كثافة عالية (أجزاء كثيرة قريبة) → المنطقة غير مستقرة → أقل ثقة
  if (ctx.localDensity > 6) {
    adj -= maxAdj * 0.3;
  } else if (ctx.localDensity <= 2) {
    // أجزاء قليلة حوله — صمت واسع ونادر → أكثر ثقة
    adj += maxAdj * 0.2;
  }

  // ── التعديل 4: المدة النسبية ────────────────────────────────────────────
  // الجزء أطول بكثير من متوسط جيرانه → ركوع/سجود محتمل → زيادة الثقة
  if (ctx.relativeDuration > 2.0) {
    adj += maxAdj * 0.5;
  } else if (ctx.relativeDuration < 0.5) {
    // أقصر بكثير من المتوسط
    adj -= maxAdj * 0.3;
  }

  // قيّد كل تعديل في [-maxAdj, +maxAdj]
  return Math.max(-maxAdj, Math.min(maxAdj, adj));
}

// ─── Main Analyzer ────────────────────────────────────────────────────────────

export class SmartPrayerAnalyzer {
  /**
   * analyze  (الواجهة الرئيسية)
   * ───────
   * يُحلّل الأجزاء بشكل سياقي ويُعيد نسخاً مُثرَّاة.
   *
   * التعقيد الكلي:
   *   O(n) quickselect  للـ adaptive thresholds
   *   O(F) Welford      للـ rmsMetrics (F = مجموع frames في كل الأجزاء)
   *   O(n) two-pointer  للـ localDensity
   *   O(n) تمرير أخير  للتصنيف والثقة
   */
  static analyze(
    segments: RawSegment[],
    rmsFrames: RmsFrames,
    options: AnalyzerOptions
  ): EnrichedSegment[] {
    if (segments.length === 0) return [];

    // ── الإعدادات الافتراضية ────────────────────────────────────────────────
    const {
      thresholdDb,
      sampleRate,
      windowSize,
      shortPauseMaxSec       = 2,
      longPauseMaxSec        = 5,
      minSegmentsForAdaptive = 5,
      localDensityWindowSec  = 10,
      removeThreshold        = 0.75,
      reviewThreshold        = 0.50,
      weightDuration         = 0.35,
      weightDepth            = 0.40,
      weightStability        = 0.25,
      maxContextAdj          = 0.15,
    } = options;

    const n = segments.length;

    // ── الخطوة 1: Adaptive thresholds ──────────────────────────────────────
    const durations  = segments.map(s => s.durationSec);
    const thresholds = computeAdaptiveThresholds(
      durations, minSegmentsForAdaptive, shortPauseMaxSec, longPauseMaxSec
    );

    // ── الخطوة 2: RMS metrics لكل جزء ─────────────────────────────────────
    const metricsArr = segments.map(seg =>
      computeRmsMetrics(seg, rmsFrames, sampleRate, windowSize, thresholdDb)
    );

    // ── الخطوة 3: Context features — O(n) two-pointer ─────────────────────
    const contextArr = computeContextFeatures(segments, localDensityWindowSec);

    // ── الخطوة 4: تجميع النتائج ────────────────────────────────────────────
    return segments.map((seg, i): EnrichedSegment => {
      const { avgDb, variance } = metricsArr[i];
      const ctx = contextArr[i];

      // التصنيف (adaptive أو fixed)
      let type: SegmentType;
      if (seg.durationSec > thresholds.longMax) {
        type = "rukoo_sujood";
      } else if (seg.durationSec > thresholds.shortMax) {
        type = "long_pause";
      } else {
        type = "short_pause";
      }

      // مكوّنات الثقة الأساسية
      const scoreDur  = durationScore(seg.durationSec);
      const scoreDep  = depthScore(avgDb, thresholdDb);
      const scoreSta  = stabilityScore(variance);

      const baseConf = (
        weightDuration  * scoreDur  +
        weightDepth     * scoreDep  +
        weightStability * scoreSta
      );

      // تعديل سياقي
      const adj          = contextAdjustment(ctx, seg, maxContextAdj);
      const confidence   = Math.min(1, Math.max(0, baseConf + adj));

      // قرار الإجراء
      let recommendedAction: RecommendedAction;
      if (confidence >= removeThreshold)      recommendedAction = "remove";
      else if (confidence >= reviewThreshold) recommendedAction = "review";
      else                                    recommendedAction = "keep";

      return {
        ...seg,
        type,
        confidence,
        avgDb,
        variance,
        recommendedAction,
        context: {
          gapBefore:        ctx.gapBefore,
          gapAfter:         ctx.gapAfter,
          localDensity:     ctx.localDensity,
          relativeDuration: ctx.relativeDuration,
        },
        _scores: {
          duration:   scoreDur,
          depth:      scoreDep,
          stability:  scoreSta,
          contextAdj: adj,
        },
      };
    });
  }

  // ─── Utility methods ───────────────────────────────────────────────────────

  /**
   * suggestThreshold — يقترح عتبة صمت تلقائية من noise floor.
   * percentile 10 من الـ rmsFrames + headroom.
   * O(n) quickselect.
   */
  static suggestThreshold(
    rmsFrames: RmsFrames,
    headroomDb = 6
  ): { suggestedThresholdDb: number; noiseFloorDb: number } {
    const valid: number[] = [];
    for (let i = 0; i < rmsFrames.length; i++) {
      const v = rmsFrames[i] as number;
      if (isFinite(v)) valid.push(v);
    }
    if (valid.length === 0) {
      return { suggestedThresholdDb: -50, noiseFloorDb: -80 };
    }
    const noiseFloorDb = percentile(valid, 0.10);
    return {
      noiseFloorDb,
      suggestedThresholdDb: Math.min(-20, noiseFloorDb + headroomDb),
    };
  }

  /** تصفية سريعة حسب الإجراء */
  static filterByAction(
    segments: EnrichedSegment[],
    action: RecommendedAction
  ): EnrichedSegment[] {
    return segments.filter(s => s.recommendedAction === action);
  }

  /** ملخص إحصائي للعرض في الـ UI */
  static summaryStats(segments: EnrichedSegment[]): {
    total: number;
    toRemove: number;
    toReview: number;
    toKeep: number;
    avgConfidence: number;
    totalDurationSec: number;
    adaptiveThresholdsUsed: boolean;
    byType: Record<SegmentType, number>;
  } {
    const byType: Record<SegmentType, number> = {
      short_pause: 0, long_pause: 0, rukoo_sujood: 0,
    };
    let sumConf = 0, sumDur = 0;

    for (const s of segments) {
      sumConf += s.confidence;
      sumDur  += s.durationSec;
      byType[s.type]++;
    }

    return {
      total:                  segments.length,
      toRemove:               segments.filter(s => s.recommendedAction === "remove").length,
      toReview:               segments.filter(s => s.recommendedAction === "review").length,
      toKeep:                 segments.filter(s => s.recommendedAction === "keep").length,
      avgConfidence:          segments.length > 0 ? sumConf / segments.length : 0,
      totalDurationSec:       sumDur,
      adaptiveThresholdsUsed: segments.length >= 5,
      byType,
    };
  }
}
