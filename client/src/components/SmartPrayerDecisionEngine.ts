/**
 * SmartPrayerDecisionEngine
 * ─────────────────────────────────────────────────────────────────────────────
 * طبقة القرار الذكي لتسجيلات الصلاة والقرآن.
 *
 * المدخل:  EnrichedSegment[] من SmartPrayerAnalyzer
 * المخرج:  DecidedSegment[]  + GlobalDecisionSummary
 *
 * المبادئ:
 *   - Pure module — لا imports، لا side effects
 *   - O(n) overall — تمريرات خطية متعددة
 *   - لا تُعدّل SmartPrayerAnalyzer أو SilenceProcessor
 *   - قرارات domain-aware: تحافظ على طبيعة التلاوة
 */

// ─── Input types (from SmartPrayerAnalyzer) ───────────────────────────────────

export type SegmentType       = "short_pause" | "long_pause" | "rukoo_sujood";
export type RecommendedAction = "remove" | "review" | "keep";

export interface SegmentContext {
  gapBefore:        number | null;
  gapAfter:         number | null;
  localDensity:     number;
  relativeDuration: number;
}

/** الحد الأدنى من EnrichedSegment الذي يحتاجه المحرك */
export interface EnrichedSegment {
  id:                string;
  startSec:          number;
  endSec:            number;
  durationSec:       number;
  enabled:           boolean;
  type:              SegmentType;
  confidence:        number;
  avgDb:             number;
  variance:          number;
  recommendedAction: RecommendedAction;
  context:           SegmentContext;
}

// ─── Output types ─────────────────────────────────────────────────────────────

export type FinalDecision =
  | "remove"        // حذف الجزء بالكامل (مع preTail/postTail)
  | "partial_trim"  // تقليص الجزء (خاص بـ rukoo_sujood)
  | "review"        // يحتاج مراجعة يدوية
  | "keep";         // أبقِ كما هو

export interface TrimBoundaries {
  /** بداية الجزء الفعلي المحذوف (بعد preTail) */
  startSec: number;
  /** نهاية الجزء الفعلي المحذوف (قبل postTail) */
  endSec:   number;
  /** مدة الجزء المحذوف فعلياً */
  removedSec: number;
}

export interface DecidedSegment extends EnrichedSegment {
  decision:       FinalDecision;
  /** حدود الحذف الفعلي (موجودة إذا decision = "remove" أو "partial_trim") */
  trim?:          TrimBoundaries;
  /** سبب القرار — للتصحيح والشفافية */
  decisionReason: string;
}

export interface GlobalDecisionSummary {
  totalSegments:          number;
  removeCount:            number;
  partialTrimCount:       number;
  reviewCount:            number;
  keepCount:              number;
  estimatedRemovedSec:    number;
  totalAudioSec:          number;
  estimatedRemovedRatio:  number;   // 0–1
  safetyTriggered:        boolean;  // هل تدخّل الـ safety cap؟
  minGapEnforced:         number;   // عدد الأجزاء التي عُدِّلت بسبب min gap
}

// ─── Engine options ────────────────────────────────────────────────────────────

export interface DecisionEngineOptions {
  // ── Confidence thresholds per type ───────────────────────────────────────
  /** short_pause: اتخذ قرار الحذف فوق هذا الحد */
  shortPauseRemoveThreshold?: number;  // default: 0.60
  /** short_pause: أبقِ تحت هذا الحد */
  shortPauseKeepThreshold?:   number;  // default: 0.40
  /** long_pause: حذف فوق هذا الحد */
  longPauseRemoveThreshold?:  number;  // default: 0.75
  /** rukoo_sujood: أقل مدة يجب الاحتفاظ بها بعد partial_trim */
  minKeepDuration?:           number;  // default: 1.5 (seconds)

  // ── Transition tails ─────────────────────────────────────────────────────
  /** وقت نبقيه قبل بداية الحذف (لحظة الدخول) */
  preTailSec?:   number;  // default: 0.3
  /** وقت نبقيه بعد نهاية الحذف (لحظة الخروج) */
  postTailSec?:  number;  // default: 0.4

  // ── Safety constraints ───────────────────────────────────────────────────
  /** أقصى نسبة يمكن حذفها من الملف (0–1) */
  maxRemovableRatio?:  number;  // default: 0.40
  /** أدنى فجوة بين جزأين محذوفَيْن (ms) */
  minGapMs?:           number;  // default: 100

  // ── Long-segment protection ───────────────────────────────────────────────
  /**
   * long_pause: لا تحذف إذا كان الجزءان المجاوران أطول من هذا الحد.
   * يحمي من قطع الانتقالات الطبيعية بين الأجزاء الطويلة.
   */
  longNeighborProtectSec?: number;  // default: 5
}

// ─── Internal helpers ──────────────────────────────────────────────────────────

/** حساب حدود الحذف الفعلي بعد تطبيق preTail/postTail */
function buildTrimBoundaries(
  seg: EnrichedSegment,
  preTailSec: number,
  postTailSec: number
): TrimBoundaries {
  const start     = Math.min(seg.startSec + preTailSec, seg.endSec - 0.05);
  const end       = Math.max(seg.endSec   - postTailSec, start + 0.05);
  return {
    startSec:   start,
    endSec:     end,
    removedSec: Math.max(0, end - start),
  };
}

/**
 * buildPartialTrimBoundaries
 * ──────────────────────────
 * للـ rukoo_sujood: نحافظ على أول minKeep ثانية وآخر postTail ثانية.
 *
 * الناتج:
 *   |── minKeep ──|── CUT ──|── postTail ──|
 *   ^startSec                              ^endSec
 *
 * إذا كانت المدة الكلية أقل من minKeep + postTail → لا نحذف شيئاً.
 */
function buildPartialTrimBoundaries(
  seg: EnrichedSegment,
  minKeep:     number,
  postTailSec: number
): TrimBoundaries | null {
  const totalDur    = seg.durationSec;
  const minRequired = minKeep + postTailSec + 0.1; // 100ms هامش أمان

  if (totalDur < minRequired) return null; // قصير جداً → لا تقليص

  const cutStart = seg.startSec + minKeep;
  const cutEnd   = seg.endSec   - postTailSec;

  if (cutEnd <= cutStart) return null;

  return {
    startSec:   cutStart,
    endSec:     cutEnd,
    removedSec: cutEnd - cutStart,
  };
}

/**
 * applySafetyCap
 * ──────────────
 * O(n log n) لأننا نرتب الأجزاء المُقررة للحذف حسب الثقة.
 * لكن n هنا هو عدد الـ "remove" فقط — عادةً أقل بكثير من المجموع.
 * الفرز على قائمة جزئية لا يؤثر عملياً.
 *
 * الخوارزمية:
 *   1. احسب removedSec المتوقع
 *   2. إذا تجاوز الحد: رتّب الـ removes حسب confidence (أضعف أولاً)
 *   3. خفّض من "remove" إلى "review" حتى نصل تحت الحد
 */
function applySafetyCap(
  decisions:         FinalDecision[],
  trims:             (TrimBoundaries | undefined)[],
  segments:          EnrichedSegment[],
  totalAudioSec:     number,
  maxRatio:          number
): { triggered: boolean } {
  // حساب removedSec الكلي
  let totalRemoved = 0;
  for (let i = 0; i < segments.length; i++) {
    if (decisions[i] === "remove" || decisions[i] === "partial_trim") {
      totalRemoved += trims[i]?.removedSec ?? 0;
    }
  }

  if (totalAudioSec <= 0 || totalRemoved / totalAudioSec <= maxRatio) {
    return { triggered: false };
  }

  // جمع indices الـ removes مرتّبة حسب confidence (أضعف أولاً) — O(k log k)
  const removeIndices: Array<{ i: number; confidence: number }> = [];
  for (let i = 0; i < segments.length; i++) {
    if (decisions[i] === "remove") {
      removeIndices.push({ i, confidence: segments[i].confidence });
    }
  }
  removeIndices.sort((a, b) => a.confidence - b.confidence);

  // خفّض أضعف الأجزاء حتى نصل تحت الحد
  let excess = totalRemoved - maxRatio * totalAudioSec;
  for (const { i } of removeIndices) {
    if (excess <= 0) break;
    const removed = trims[i]?.removedSec ?? 0;
    decisions[i] = "review";
    trims[i]     = undefined;
    excess      -= removed;
  }

  return { triggered: true };
}

/**
 * enforceMinGap
 * ─────────────
 * O(n) — تمرير واحد.
 * إذا كان الفاصل بين نهاية trim[i] وبداية trim[i+1] < minGapSec:
 * ندمج الحدين (نأخذ أصغر start وأكبر end) وندمج الجزأين في "review" للضعيف.
 */
function enforceMinGap(
  decisions:   FinalDecision[],
  trims:       (TrimBoundaries | undefined)[],
  segments:    EnrichedSegment[],
  minGapSec:   number
): number {
  let enforced = 0;
  for (let i = 0; i + 1 < segments.length; i++) {
    if (
      (decisions[i] === "remove" || decisions[i] === "partial_trim") &&
      (decisions[i+1] === "remove" || decisions[i+1] === "partial_trim")
    ) {
      const endI    = trims[i]?.endSec   ?? segments[i].endSec;
      const startI1 = trims[i+1]?.startSec ?? segments[i+1].startSec;
      const gap     = startI1 - endI;

      if (gap < minGapSec && gap >= 0) {
        // الأضعف يُحوَّل إلى review
        const weakerIdx = segments[i].confidence <= segments[i+1].confidence ? i : i+1;
        decisions[weakerIdx] = "review";
        trims[weakerIdx]     = undefined;
        enforced++;
      }
    }
  }
  return enforced;
}

// ─── Local decision per segment ───────────────────────────────────────────────

interface LocalDecision {
  decision: FinalDecision;
  reason:   string;
}

function decideSegment(
  seg:     EnrichedSegment,
  opts: Required<DecisionEngineOptions>
): LocalDecision {
  const { confidence, type, context } = seg;

  // ── rukoo_sujood ─────────────────────────────────────────────────────────
  if (type === "rukoo_sujood") {
    // لا نحذف أبداً — فقط نقلّص
    return {
      decision: "partial_trim",
      reason:   `rukoo_sujood: partial_trim (conf=${confidence.toFixed(2)})`,
    };
  }

  // ── long_pause ────────────────────────────────────────────────────────────
  if (type === "long_pause") {
    // حماية: إذا كان محاطاً بأجزاء طويلة → review
    const prevLong = context.gapBefore !== null
      && (context.gapBefore === 0   // الجزء السابق مباشراً
      || (context.relativeDuration > 0 && context.relativeDuration < 0.7));

    const neighborLong =
      (context.gapBefore !== null && context.gapBefore < opts.longNeighborProtectSec) ||
      (context.gapAfter  !== null && context.gapAfter  < opts.longNeighborProtectSec);

    if (confidence > opts.longPauseRemoveThreshold && !neighborLong) {
      return {
        decision: "remove",
        reason:   `long_pause: high confidence (${confidence.toFixed(2)}) + no long neighbors`,
      };
    }
    if (confidence > opts.longPauseRemoveThreshold && neighborLong) {
      return {
        decision: "review",
        reason:   `long_pause: high confidence but surrounded by long segments → review`,
      };
    }
    return {
      decision: "review",
      reason:   `long_pause: confidence ${confidence.toFixed(2)} < threshold ${opts.longPauseRemoveThreshold}`,
    };
  }

  // ── short_pause ───────────────────────────────────────────────────────────
  // فجوة صغيرة جداً على الطرفين → احتمال كشف خاطئ
  if (
    context.gapBefore !== null && context.gapBefore < 0.3 &&
    context.gapAfter  !== null && context.gapAfter  < 0.3
  ) {
    return {
      decision: "keep",
      reason:   "short_pause: tiny gaps on both sides → likely mis-detection",
    };
  }

  if (confidence > opts.shortPauseRemoveThreshold) {
    return {
      decision: "remove",
      reason:   `short_pause: confidence ${confidence.toFixed(2)} > ${opts.shortPauseRemoveThreshold}`,
    };
  }
  if (confidence < opts.shortPauseKeepThreshold) {
    return {
      decision: "keep",
      reason:   `short_pause: low confidence ${confidence.toFixed(2)} < ${opts.shortPauseKeepThreshold}`,
    };
  }
  return {
    decision: "review",
    reason:   `short_pause: confidence in review range [${opts.shortPauseKeepThreshold}–${opts.shortPauseRemoveThreshold}]`,
  };
}

// ─── Main Engine ──────────────────────────────────────────────────────────────

export class SmartPrayerDecisionEngine {
  /**
   * decide
   * ──────
   * المدخل:  EnrichedSegment[] + مدة الملف الكلية + خيارات اختيارية
   * المخرج:  { segments: DecidedSegment[], summary: GlobalDecisionSummary }
   *
   * التعقيد:
   *   O(n)       — القرارات المحلية
   *   O(k log k) — safety cap sort (k = عدد الـ removes فقط)
   *   O(n)       — min gap enforcement
   *   O(n)       — بناء المخرجات
   *   ─────────────────────────────
   *   O(n) عملي للتسجيلات النموذجية
   */
  static decide(
    segments:     EnrichedSegment[],
    totalAudioSec: number,
    options:      DecisionEngineOptions = {}
  ): { segments: DecidedSegment[]; summary: GlobalDecisionSummary } {

    if (segments.length === 0) {
      return {
        segments: [],
        summary: {
          totalSegments:         0,
          removeCount:           0,
          partialTrimCount:      0,
          reviewCount:           0,
          keepCount:             0,
          estimatedRemovedSec:   0,
          totalAudioSec,
          estimatedRemovedRatio: 0,
          safetyTriggered:       false,
          minGapEnforced:        0,
        },
      };
    }

    // ── تطبيق الإعدادات الافتراضية ────────────────────────────────────────
    const opts: Required<DecisionEngineOptions> = {
      shortPauseRemoveThreshold: options.shortPauseRemoveThreshold ?? 0.60,
      shortPauseKeepThreshold:   options.shortPauseKeepThreshold   ?? 0.40,
      longPauseRemoveThreshold:  options.longPauseRemoveThreshold  ?? 0.75,
      minKeepDuration:           options.minKeepDuration            ?? 1.5,
      preTailSec:                options.preTailSec                 ?? 0.3,
      postTailSec:               options.postTailSec                ?? 0.4,
      maxRemovableRatio:         options.maxRemovableRatio          ?? 0.40,
      minGapMs:                  options.minGapMs                   ?? 100,
      longNeighborProtectSec:    options.longNeighborProtectSec     ?? 5,
    };

    const minGapSec = opts.minGapMs / 1000;
    const n         = segments.length;

    // ── الخطوة 1: قرارات محلية + حدود الحذف ──────────────────────────────
    const decisions: FinalDecision[]               = new Array(n);
    const trims:     (TrimBoundaries | undefined)[] = new Array(n);
    const reasons:   string[]                       = new Array(n);

    for (let i = 0; i < n; i++) {
      const seg    = segments[i];
      const local  = decideSegment(seg, opts);
      decisions[i] = local.decision;
      reasons[i]   = local.reason;

      if (local.decision === "remove") {
        trims[i] = buildTrimBoundaries(seg, opts.preTailSec, opts.postTailSec);
      } else if (local.decision === "partial_trim") {
        const pt = buildPartialTrimBoundaries(seg, opts.minKeepDuration, opts.postTailSec);
        if (pt) {
          trims[i] = pt;
        } else {
          // قصير جداً → أبقِ كما هو
          decisions[i] = "keep";
          reasons[i]   += " → too short for partial trim, kept";
        }
      }
    }

    // ── الخطوة 2: Safety cap ───────────────────────────────────────────────
    const safetyResult = applySafetyCap(
      decisions, trims, segments, totalAudioSec, opts.maxRemovableRatio
    );

    // ── الخطوة 3: Min gap enforcement ──────────────────────────────────────
    const gapEnforcedCount = enforceMinGap(decisions, trims, segments, minGapSec);

    // ── الخطوة 4: بناء المخرجات ────────────────────────────────────────────
    let removeCount      = 0;
    let partialCount     = 0;
    let reviewCount      = 0;
    let keepCount        = 0;
    let totalRemovedSec  = 0;

    const decided: DecidedSegment[] = segments.map((seg, i) => {
      const d = decisions[i];
      if (d === "remove")       removeCount++;
      else if (d === "partial_trim") partialCount++;
      else if (d === "review")  reviewCount++;
      else                      keepCount++;

      if (trims[i]) totalRemovedSec += trims[i]!.removedSec;

      return {
        ...seg,
        decision:       d,
        trim:           trims[i],
        decisionReason: reasons[i],
      };
    });

    const summary: GlobalDecisionSummary = {
      totalSegments:         n,
      removeCount,
      partialTrimCount:      partialCount,
      reviewCount,
      keepCount,
      estimatedRemovedSec:   totalRemovedSec,
      totalAudioSec,
      estimatedRemovedRatio: totalAudioSec > 0 ? totalRemovedSec / totalAudioSec : 0,
      safetyTriggered:       safetyResult.triggered,
      minGapEnforced:        gapEnforcedCount,
    };

    return { segments: decided, summary };
  }

  /**
   * toDeleteRanges
   * ──────────────
   * تُحوّل DecidedSegment[] إلى قائمة نطاقات جاهزة للـ deleteMultipleRanges.
   * تُدرج فقط الأجزاء المقررة للحذف الكلي أو الجزئي (وmutually enabled).
   */
  static toDeleteRanges(
    segments: DecidedSegment[]
  ): Array<{ start: number; end: number }> {
    return segments
      .filter(s =>
        s.enabled &&
        (s.decision === "remove" || s.decision === "partial_trim") &&
        s.trim !== undefined
      )
      .map(s => ({ start: s.trim!.startSec, end: s.trim!.endSec }));
  }

  /**
   * buildSummary
   * ─────────────
   * ملخص نصي للعرض في الـ UI.
   */
  static buildSummary(summary: GlobalDecisionSummary): string {
    const pct = (summary.estimatedRemovedRatio * 100).toFixed(1);
    const parts: string[] = [
      `${summary.totalSegments} جزء`,
      `${summary.removeCount} للحذف`,
      `${summary.partialTrimCount} للتقليص`,
      `${summary.reviewCount} للمراجعة`,
      `${summary.keepCount} للإبقاء`,
      `~${pct}% من الملف`,
    ];
    if (summary.safetyTriggered) parts.push("⚠ حد الأمان طُبِّق");
    if (summary.minGapEnforced > 0) parts.push(`${summary.minGapEnforced} فجوة أُصلحت`);
    return parts.join(" · ");
  }
}
