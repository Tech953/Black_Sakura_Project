/**
 * Moved to @workspace/engram-core (pure, DB-free helpers) so the mobile app's
 * offline mode can reuse them. This shim preserves existing imports.
 */
export {
  WORLD_MODEL_PROVENANCE_ORDER,
  ProvenanceImmutableError,
  clampConfidence,
  applyWorldModelPatch,
  isReservedRebeccaAdaptiveSource,
  REBECCA_ADAPTIVE_SEED_SOURCE_PREFIX,
  summarizeWorldModel,
  TRUSTED_REBECCA_ADAPTIVE_SOURCES,
  type WorldModelEntryView,
  type WorldModelPatchFields,
  type WorldModelMergedPatch,
  type SummarizeOptions,
} from "@workspace/engram-core";
