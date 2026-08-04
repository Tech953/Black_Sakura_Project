/**
 * Moved to @workspace/engram-core (pure, DB-free helpers) so the mobile app's
 * offline mode can reuse them. This shim preserves existing imports.
 */
export {
  WORLD_MODEL_PROVENANCE_ORDER,
  ProvenanceImmutableError,
  clampConfidence,
  applyWorldModelPatch,
  summarizeWorldModel,
  type WorldModelEntryView,
  type WorldModelPatchFields,
  type WorldModelMergedPatch,
  type SummarizeOptions,
} from "@workspace/engram-core";
