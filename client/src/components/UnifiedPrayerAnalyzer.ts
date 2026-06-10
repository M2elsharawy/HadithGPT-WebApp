/**
 * UnifiedPrayerAnalyzer
 * تحليل موحّد يصنّف مقاطع الملف بناءً على شكل الطاقة:
 * - الكثافة الزمنية (temporal density): كم % من المقطع نشط صوتياً
 * - تباين الطاقة (energy variance): هل متصل أم متقطع
 * لا يعتمد على المدة الثابتة — يعمل مع أي قارئ أو محاضر.
 */

export type SegmentKind =
  | 'recitation'   // تلاوة — يُبقى
  | 'ritual'       // ركن/تكبير — يُحذف
  | 'silence'      // صمت — يُحذف
  | 'review';      // غير متأكد — مراجعة

export interface UnifiedSegment {
  id:              string;
  startSec:        number;
  endSec:          number;
  durationSec:     number;
  avgRmsDb:        number;   // متوسط الطاقة
  temporalDensity: number;   // 0-1: نسبة الوقت النشط صوتياً
  energyVariance:  number;   // تباين الطاقة (متصل=منخفض، متقطع=عالٍ)
  kind:            SegmentKind;
  confidence:      number;   // 0-1
  protected:       boolean;  // محمي من الحذف
  enabled:         boolean;  // محدد للحذف
}

export interface UnifiedAnalysisResult {
  segments:      UnifiedSegment[];
  totalSec:      number;
  recitationSec: number;
  removableSec:  number;
}

export interface UnifiedOptions {
  silenceThresholdDb?: number;  // عتبة الصمت (افتراضي -35)
  frameMs?:            number;  // حجم الإطار للتحليل (افتراضي 20ms)
  minSegmentSec?:      number;  // أقصر مقطع يُعتبر (افتراضي 0.3s)
}

export class UnifiedPrayerAnalyzer {

  static analyze(
    audioBuffer: AudioBuffer,
    options: UnifiedOptions = {},
  ): UnifiedAnalysisResult {
    const silenceThresholdDb = options.silenceThresholdDb ?? -35;
    const frameMs            = options.frameMs ?? 20;
    const minSegmentSec      = options.minSegmentSec ?? 0.3;

    const sampleRate = audioBuffer.sampleRate;
    const channel    = audioBuffer.getChannelData(0);
    const frameSize  = Math.floor((frameMs / 1000) * sampleRate);
    const numFrames  = Math.floor(channel.length / frameSize);

    // ── 1. احسب RMS لكل إطار صغير (20ms) ──────────────────────────────
    const frameRms: number[] = new Array(numFrames);
    const frameDb:  number[] = new Array(numFrames);
    for (let f = 0; f < numFrames; f++) {
      let sum = 0;
      const start = f * frameSize;
      for (let i = 0; i < frameSize; i++) {
        const s = channel[start + i] || 0;
        sum += s * s;
      }
      const rms = Math.sqrt(sum / frameSize);
      frameRms[f] = rms;
      frameDb[f]  = rms > 0 ? 20 * Math.log10(rms) : -100;
    }

    // ── 2. صنّف كل إطار: نشط أم صامت ───────────────────────────────────
    const frameActive: boolean[] = frameDb.map(db => db > silenceThresholdDb);

    // ── 3. قسّم لمقاطع (تجميع الإطارات مع تسامح للفجوات القصيرة) ────────
    const frameSec = frameMs / 1000;
    const segments: UnifiedSegment[] = [];

    const minSilenceFrames = Math.floor(0.4 / frameSec); // 400ms صمت = فاصل
    let segStart = 0;
    let silenceRun = 0;
    let inSegment = frameActive[0] ?? false;

    const flushSegment = (endFrame: number) => {
      const sSec = segStart * frameSec;
      const eSec = endFrame * frameSec;
      const dur  = eSec - sSec;
      if (dur < minSegmentSec) return;

      let activeCount = 0;
      let dbSum = 0;
      const dbValues: number[] = [];
      for (let f = segStart; f < endFrame; f++) {
        if (frameActive[f]) activeCount++;
        dbSum += frameDb[f];
        dbValues.push(frameDb[f]);
      }
      const total = endFrame - segStart;
      const temporalDensity = total > 0 ? activeCount / total : 0;
      const avgRmsDb = total > 0 ? dbSum / total : -100;

      // تباين الطاقة (انحراف معياري للـ dB)
      const mean = avgRmsDb;
      let varSum = 0;
      for (const db of dbValues) varSum += (db - mean) ** 2;
      const energyVariance = dbValues.length > 0
        ? Math.sqrt(varSum / dbValues.length)
        : 0;

      segments.push({
        id:              `seg_${segments.length}_${Math.floor(sSec)}`,
        startSec:        sSec,
        endSec:          eSec,
        durationSec:     dur,
        avgRmsDb,
        temporalDensity,
        energyVariance,
        kind:            'review',
        confidence:      0.3,
        protected:       false,
        enabled:         false,
      });
    };

    for (let f = 1; f < numFrames; f++) {
      if (frameActive[f]) {
        if (silenceRun >= minSilenceFrames && inSegment) {
          flushSegment(f - silenceRun);
          segStart = f;
        }
        silenceRun = 0;
        inSegment = true;
      } else {
        silenceRun++;
      }
    }
    if (inSegment) flushSegment(numFrames);

    // ── 4. احسب العتبات المتكيّفة من توزيع الكثافة ─────────────────────
    const maxDuration  = segments.reduce((m, s) => Math.max(m, s.durationSec), 1);
    const protectedMin = Math.max(maxDuration * 0.5, 6);
    // مدة تكيّفية "قصيرة جداً" — أقل من 15% من أطول مقطع، وأقل من 5s مطلقاً
    const shortMax = Math.min(maxDuration * 0.15, 5);

    // ── 5. صنّف كل مقطع بناءً على شكل الطاقة ───────────────────────────
    for (const seg of segments) {
      // حماية: أطول من نصف أطول مقطع = تلاوة مؤكدة
      if (seg.durationSec >= protectedMin) {
        seg.kind       = 'recitation';
        seg.confidence = 0.97;
        seg.protected  = true;
        seg.enabled    = false;
        continue;
      }

      // صمت: طاقة منخفضة جداً
      if (seg.avgRmsDb < silenceThresholdDb + 5) {
        seg.kind       = 'silence';
        seg.confidence = 0.9;
        seg.enabled    = true;
        continue;
      }

      // قصير جداً (حتى لو كانت كثافته عالية): تكبير أو ركن
      if (seg.durationSec <= shortMax) {
        seg.kind       = 'ritual';
        seg.confidence = 0.75;
        seg.enabled    = true;
        continue;
      }

      // المعيار الذهبي: كثافة عالية + تباين منخفض = تلاوة متصلة
      const highDensity = seg.temporalDensity >= 0.7;
      const lowVariance = seg.energyVariance   <= 12;

      if (highDensity && lowVariance) {
        seg.kind       = 'recitation';
        seg.confidence = 0.85;
        seg.enabled    = false;
      } else if (!highDensity || seg.energyVariance > 18) {
        // كثافة منخفضة أو تباين عالٍ = متقطع = ركن/تكبير
        seg.kind       = 'ritual';
        seg.confidence = 0.8;
        seg.enabled    = true;
      } else {
        seg.kind       = 'review';
        seg.confidence = 0.4;
        seg.enabled    = false;
      }
    }

    // ── 5b. أنشئ مقاطع صمت صريحة للفجوات ≥ 1.5s ────────────────────────────
    const minGapSec  = 1.5;
    const totalDurSec = audioBuffer.duration;
    const voiced     = [...segments]; // نسخة من المقاطع الصوتية فقط

    // فجوة قبل أول مقطع
    if (voiced.length > 0 && voiced[0].startSec >= minGapSec) {
      segments.push({
        id: 'sil_0_0', startSec: 0, endSec: voiced[0].startSec,
        durationSec: voiced[0].startSec, avgRmsDb: -100,
        temporalDensity: 0, energyVariance: 0,
        kind: 'silence', confidence: 0.95, protected: false, enabled: true,
      });
    }
    // فجوات بين المقاطع الصوتية
    for (let i = 0; i < voiced.length - 1; i++) {
      const gapStart = voiced[i].endSec;
      const gapEnd   = voiced[i + 1].startSec;
      const gapDur   = gapEnd - gapStart;
      if (gapDur >= minGapSec) {
        segments.push({
          id:          `sil_${i + 1}_${Math.floor(gapStart)}`,
          startSec:    gapStart,
          endSec:      gapEnd,
          durationSec: gapDur,
          avgRmsDb:    -100,
          temporalDensity: 0,
          energyVariance:  0,
          kind:        'silence',
          confidence:  0.95,
          protected:   false,
          enabled:     true,
        });
      }
    }
    // فجوة بعد آخر مقطع
    if (voiced.length > 0) {
      const lastEnd  = voiced[voiced.length - 1].endSec;
      const trailDur = totalDurSec - lastEnd;
      if (trailDur >= minGapSec) {
        segments.push({
          id: `sil_trail_${Math.floor(lastEnd)}`,
          startSec: lastEnd, endSec: totalDurSec, durationSec: trailDur,
          avgRmsDb: -100, temporalDensity: 0, energyVariance: 0,
          kind: 'silence', confidence: 0.95, protected: false, enabled: true,
        });
      }
    }
    // رتّب الكل حسب وقت البداية
    segments.sort((a, b) => a.startSec - b.startSec);

    // ── 6. احسب الإحصائيات ─────────────────────────────────────────────
    const recitationSec = segments
      .filter(s => s.kind === 'recitation')
      .reduce((a, s) => a + s.durationSec, 0);
    const removableSec = segments
      .filter(s => s.enabled)
      .reduce((a, s) => a + s.durationSec, 0);

    return {
      segments,
      totalSec: audioBuffer.duration,
      recitationSec,
      removableSec,
    };
  }
}
