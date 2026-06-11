/**
 * PipelineVariants
 *
 * Defines named pipeline stage orderings for AudioEnhancementEngine.
 * Selecting a variant changes only the execution order of stages —
 * no processing algorithm is modified.
 *
 * The "legacy" variant is always the default. Passing pipelineVariant
 * in EnhancementOptions does nothing until AudioEnhancementEngine reads
 * it; until then it is a no-op and existing behaviour is fully preserved.
 */

export type PipelineVariantId =
  | "legacy"          // HumRemoval → NoiseReduction → DeReverb → Dynamics (original order)
  | "dereverb_first"  // HumRemoval → DeReverb → NoiseReduction → Dynamics (experimental)
  | "no_dereverb";    // HumRemoval → NoiseReduction → Dynamics (skip de-reverb)

export type PipelineStageId =
  | "hum_removal"
  | "noise_reduction"
  | "de_reverb"
  | "dynamics";

export interface PipelineVariantDef {
  readonly id:          PipelineVariantId;
  readonly description: string;
  readonly stageOrder:  readonly PipelineStageId[];
}

export const PIPELINE_VARIANTS: Record<PipelineVariantId, PipelineVariantDef> = {

  legacy: {
    id:          "legacy",
    description: "Original order: HumRemoval → NoiseReduction → DeReverb → Dynamics",
    stageOrder:  ["hum_removal", "noise_reduction", "de_reverb", "dynamics"],
  },

  // Not the default — requires explicit opt-in via pipelineVariant option.
  // Better noise floor estimation for reverberant rooms; experimental.
  dereverb_first: {
    id:          "dereverb_first",
    description: "DeReverb before NoiseReduction — more accurate noise profiling in reverberant rooms",
    stageOrder:  ["hum_removal", "de_reverb", "noise_reduction", "dynamics"],
  },

  // Not the default — requires explicit opt-in via pipelineVariant option.
  // For dry studio recordings where de-reverb adds no benefit.
  no_dereverb: {
    id:          "no_dereverb",
    description: "Skip DeReverb stage — for dry recordings with no significant room reverb",
    stageOrder:  ["hum_removal", "noise_reduction", "dynamics"],
  },

};

export const DEFAULT_PIPELINE_VARIANT: PipelineVariantId = "legacy";
