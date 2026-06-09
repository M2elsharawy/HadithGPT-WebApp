import { describe, it, expect } from 'vitest';
import { UnifiedPrayerAnalyzer } from '../UnifiedPrayerAnalyzer';

const SR = 44100;

function makeBuffer(
  seconds: number,
  signal: (i: number, sampleRate: number) => number
): AudioBuffer {
  const length = Math.floor(seconds * SR);
  const data   = new Float32Array(length);
  for (let i = 0; i < length; i++) data[i] = signal(i, SR);
  return {
    sampleRate: SR, duration: seconds, length,
    numberOfChannels: 1,
    getChannelData: () => data,
  } as unknown as AudioBuffer;
}

const sine  = (freq: number) => (i: number, sr: number) =>
  Math.sin(2 * Math.PI * freq * i / sr) * 0.5;

const burst = (freq: number, onSec: number, offSec: number) =>
  (i: number, sr: number) => {
    const cycle = (onSec + offSec) * sr;
    return (i % cycle) < onSec * sr
      ? Math.sin(2 * Math.PI * freq * i / sr) * 0.5
      : 0;
  };

describe('UnifiedPrayerAnalyzer', () => {

  it('تلاوة متصلة → recitation (كثافة عالية + تباين منخفض)', () => {
    const buf    = makeBuffer(30, sine(440));
    const result = UnifiedPrayerAnalyzer.analyze(buf, { silenceThresholdDb: -35 });

    console.log('\n=== تلاوة متصلة 30s ===');
    result.segments.forEach(s =>
      console.log(`  ${s.startSec.toFixed(1)}-${s.endSec.toFixed(1)}s | density=${s.temporalDensity.toFixed(3)} | var=${s.energyVariance.toFixed(1)} | kind=${s.kind} | prot=${s.protected}`)
    );
    console.log(`  recitationSec=${result.recitationSec.toFixed(1)} removableSec=${result.removableSec.toFixed(1)}`);

    const recSegs = result.segments.filter(s => s.kind === 'recitation');
    expect(recSegs.length).toBeGreaterThan(0);
    expect(result.recitationSec).toBeGreaterThan(20);
  });

  it('تلاوة طويلة + تكبيرات قصيرة → التكبيرات ritual والتلاوة recitation', () => {
    // سيناريو واقعي: 40s تلاوة + 2s صمت + 4× (1s تكبير + 2s صمت)
    const SR_LOCAL = 44100;
    const totalSec = 52;
    const length   = Math.floor(totalSec * SR_LOCAL);
    const data     = new Float32Array(length);

    for (let i = 0; i < length; i++) {
      const t = i / SR_LOCAL;
      if (t < 40) {
        // تلاوة متصلة 40s
        data[i] = Math.sin(2 * Math.PI * 440 * i / SR_LOCAL) * 0.5;
      } else if (t < 42) {
        // صمت 2s
        data[i] = 0;
      } else {
        // 4× تكبير: 1s صوت + 2s صمت
        const offset = t - 42;
        const cycle  = offset % 3;
        data[i] = cycle < 1 ? Math.sin(2 * Math.PI * 300 * i / SR_LOCAL) * 0.5 : 0;
      }
    }

    const buf = {
      sampleRate: SR_LOCAL, duration: totalSec, length,
      numberOfChannels: 1, getChannelData: () => data,
    } as unknown as AudioBuffer;

    const result = UnifiedPrayerAnalyzer.analyze(buf, { silenceThresholdDb: -35 });

    console.log('\n=== تلاوة 40s + تكبيرات 1s ===');
    result.segments.forEach(s =>
      console.log(`  ${s.startSec.toFixed(1)}-${s.endSec.toFixed(1)}s | dur=${s.durationSec.toFixed(1)} | density=${s.temporalDensity.toFixed(3)} | var=${s.energyVariance.toFixed(1)} | kind=${s.kind} | prot=${s.protected}`)
    );
    console.log(`  recitationSec=${result.recitationSec.toFixed(1)} removableSec=${result.removableSec.toFixed(1)}`);

    const ritualSegs   = result.segments.filter(s => s.kind === 'ritual');
    const recitSegs    = result.segments.filter(s => s.kind === 'recitation');
    expect(recitSegs.length).toBeGreaterThan(0);
    expect(ritualSegs.length).toBeGreaterThan(0);
    expect(result.recitationSec).toBeGreaterThan(30);
  });

  it('أطول مقطع محمي من الحذف', () => {
    const buf    = makeBuffer(30, sine(440));
    const result = UnifiedPrayerAnalyzer.analyze(buf, { silenceThresholdDb: -35 });

    const protectedSegs = result.segments.filter(s => s.protected);
    console.log('\n=== مقاطع محمية ===');
    protectedSegs.forEach(s =>
      console.log(`  ${s.startSec.toFixed(1)}-${s.endSec.toFixed(1)}s | dur=${s.durationSec.toFixed(1)} | kind=${s.kind}`)
    );

    expect(protectedSegs.length).toBeGreaterThan(0);
    expect(protectedSegs.every(s => s.enabled === false)).toBe(true);
  });

  it('قيم density و variance في النطاق المتوقع', () => {
    const contBuf  = makeBuffer(10, sine(440));
    const burstBuf = makeBuffer(10, burst(300, 0.3, 1.2));

    const contResult  = UnifiedPrayerAnalyzer.analyze(contBuf,  { silenceThresholdDb: -35 });
    const burstResult = UnifiedPrayerAnalyzer.analyze(burstBuf, { silenceThresholdDb: -35 });

    console.log('\n=== مقارنة الكثافة والتباين ===');
    console.log('متصل  :', contResult.segments.map(s =>
      `density=${s.temporalDensity.toFixed(3)} var=${s.energyVariance.toFixed(1)}`).join(' | '));
    console.log('متقطع :', burstResult.segments.map(s =>
      `density=${s.temporalDensity.toFixed(3)} var=${s.energyVariance.toFixed(1)}`).join(' | '));

    // كل المقاطع يجب أن تكون في النطاق الصحيح
    [...contResult.segments, ...burstResult.segments].forEach(s => {
      expect(s.temporalDensity).toBeGreaterThanOrEqual(0);
      expect(s.temporalDensity).toBeLessThanOrEqual(1);
      expect(s.energyVariance).toBeGreaterThanOrEqual(0);
      expect(s.confidence).toBeGreaterThan(0);
    });
  });

  it('تقارير إحصائية صحيحة', () => {
    const buf    = makeBuffer(10, sine(440));
    const result = UnifiedPrayerAnalyzer.analyze(buf, { silenceThresholdDb: -35 });

    expect(result.totalSec).toBeCloseTo(10, 0);
    expect(result.recitationSec).toBeGreaterThanOrEqual(0);
    expect(result.removableSec).toBeGreaterThanOrEqual(0);
    expect(result.recitationSec + result.removableSec).toBeLessThanOrEqual(result.totalSec + 1);
  });

});
