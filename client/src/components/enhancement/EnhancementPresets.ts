import type { EnhancementOptions } from "./types";

export type PresetId =
  | "quran_clean"
  | "mosque_recording_repair_basic"
  | "podcast_voice_clean_basic"
  | "phone_recording_fix_basic"
  | "custom_manual";

export interface PresetDef {
  id:            PresetId;
  labelAr:       string;
  descriptionAr: string;
  icon:          string;
  options:       EnhancementOptions;
}

// ─── Presets ──────────────────────────────────────────────────────────────────

export const ENHANCEMENT_PRESETS: Record<PresetId, PresetDef> = {

  // 1. Conservative — ideal for Quran recitation
  quran_clean: {
    id:            "quran_clean",
    labelAr:       "قرآن نظيف",
    descriptionAr: "وضوح التلاوة مع حفاظ على الطبيعية",
    icon:          "🕌",
    options: {
      presetId: "quran_clean",
      highPassHz:      80,
      presenceBoostHz: 3000,
      presenceBoostDb: 2.5,
      presenceQ:       1.0,
      airBoostHz:      10000,
      airBoostDb:      1.0,
      warmthHz:        0,
      warmthDb:        0,
      compressor: {
        enabled:      true,
        threshold:    -22,
        knee:         10,
        ratio:        3,
        attack:       0.01,
        release:      0.20,
        makeupGainDb: 2,
      },
      limiter:           { enabled: true, ceilingDb: -1 },
      normalize:         true,
      normalizeTargetDb: -1,
      humRemoval:        { enabled: false, frequencyHz: 50, strength: "light" },
      noiseReduction:    { enabled: true,  strength: "light",  mode: "broadband" },
      deReverb:          { enabled: true,  amount: "light" },
    },
  },

  // 2. Mosque recording — heavier HP + presence, stronger compression + hum/de-reverb
  mosque_recording_repair_basic: {
    id:            "mosque_recording_repair_basic",
    labelAr:       "تسجيل مسجد",
    descriptionAr: "إصلاح تسجيلات المساجد والقاعات",
    icon:          "🎙",
    options: {
      presetId: "mosque_recording_repair_basic",
      highPassHz:      100,
      presenceBoostHz: 2500,
      presenceBoostDb: 3.0,
      presenceQ:       1.2,
      airBoostHz:      0,
      airBoostDb:      0,
      warmthHz:        0,
      warmthDb:        0,
      compressor: {
        enabled:      true,
        threshold:    -20,
        knee:         8,
        ratio:        4,
        attack:       0.005,
        release:      0.15,
        makeupGainDb: 3,
      },
      limiter:           { enabled: true, ceilingDb: -1 },
      normalize:         true,
      normalizeTargetDb: -1,
      humRemoval:        { enabled: true,  frequencyHz: 50, strength: "medium" },
      noiseReduction:    { enabled: true,  strength: "medium", mode: "broadband" },
      deReverb:          { enabled: true,  amount: "medium" },
    },
  },

  // 3. Podcast — warmth + brightness + tighter dynamics
  podcast_voice_clean_basic: {
    id:            "podcast_voice_clean_basic",
    labelAr:       "صوت بودكاست",
    descriptionAr: "وضوح ودفء للصوت البشري",
    icon:          "🎧",
    options: {
      presetId: "podcast_voice_clean_basic",
      highPassHz:      100,
      presenceBoostHz: 3500,
      presenceBoostDb: 2.0,
      presenceQ:       1.0,
      airBoostHz:      10000,
      airBoostDb:      1.5,
      warmthHz:        200,
      warmthDb:        1.5,
      compressor: {
        enabled:      true,
        threshold:    -18,
        knee:         8,
        ratio:        5,
        attack:       0.003,
        release:      0.10,
        makeupGainDb: 4,
      },
      limiter:           { enabled: true, ceilingDb: -1 },
      normalize:         true,
      normalizeTargetDb: -1,
      humRemoval:        { enabled: false, frequencyHz: 60, strength: "light" },
      noiseReduction:    { enabled: true,  strength: "medium", mode: "broadband" },
      deReverb:          { enabled: false, amount: "light" },
    },
  },

  // 4. Phone recording — aggressive HP, tame harshness, normalize
  phone_recording_fix_basic: {
    id:            "phone_recording_fix_basic",
    labelAr:       "تسجيل هاتف",
    descriptionAr: "تحسين جودة التسجيل الهاتفي",
    icon:          "📱",
    options: {
      presetId: "phone_recording_fix_basic",
      highPassHz:      150,
      presenceBoostHz: 2500,
      presenceBoostDb: 2.5,
      presenceQ:       1.4,
      airBoostHz:      8000,
      airBoostDb:      -1.5,
      warmthHz:        0,
      warmthDb:        0,
      compressor: {
        enabled:      true,
        threshold:    -20,
        knee:         10,
        ratio:        4,
        attack:       0.005,
        release:      0.15,
        makeupGainDb: 3,
      },
      limiter:           { enabled: true, ceilingDb: -1 },
      normalize:         true,
      normalizeTargetDb: -1,
      humRemoval:        { enabled: false, frequencyHz: 50, strength: "light" },
      noiseReduction:    { enabled: true,  strength: "light",  mode: "broadband" },
      deReverb:          { enabled: false, amount: "light" },
    },
  },

  // 5. Manual — baseline settings, user adjusts via UI
  custom_manual: {
    id:            "custom_manual",
    labelAr:       "يدوي",
    descriptionAr: "ضبط يدوي كامل",
    icon:          "⚙",
    options: {
      presetId: "custom_manual",
      highPassHz:      80,
      presenceBoostHz: 0,
      presenceBoostDb: 0,
      presenceQ:       1.2,
      airBoostHz:      0,
      airBoostDb:      0,
      warmthHz:        0,
      warmthDb:        0,
      compressor: {
        enabled:      true,
        threshold:    -24,
        knee:         10,
        ratio:        4,
        attack:       0.005,
        release:      0.15,
        makeupGainDb: 0,
      },
      limiter:           { enabled: true, ceilingDb: -1 },
      normalize:         true,
      normalizeTargetDb: -1,
      humRemoval:        { enabled: false, frequencyHz: 50, strength: "medium" },
      noiseReduction:    { enabled: false, strength: "light",  mode: "broadband" },
      deReverb:          { enabled: false, amount: "light" },
    },
  },
};

export const DEFAULT_PRESET_ID: PresetId = "quran_clean";

export const PRESET_LIST: PresetDef[] = Object.values(ENHANCEMENT_PRESETS);
