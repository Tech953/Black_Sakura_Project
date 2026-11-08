/** Optional data types for an existing TypeScript host. No Node runtime is needed by the Python bridge. */
export type VoiceId = `voice_${string}`;
export type ReviewStatus = "unreviewed" | "needs_revision" | "approved";
export type JsonObject = { [key: string]: unknown };
export interface EngramContext extends JsonObject {
  bridge_schema_version: "1.0.0";
  kind: "full_rezz_engram_context";
  engram_key: string;
  profile_id: VoiceId;
  authored_character: JsonObject;
  source_evidence: JsonObject[];
  profile_snapshot: JsonObject;
  origin: JsonObject & { pack_id: string; manifest_sha256: string };
  trust: JsonObject & { prompts_executed: false; reasoning_engine_executed: false; engram_embedding_generated: false };
}
export interface RenderBody {
  profile_id: VoiceId; text: string; style?: string; rate?: number; pitch?: number; volume?: number;
  steps?: 16 | 32; seed?: number; reference_text?: string; scene_notes?: string;
  quality_policy?: "high_fidelity" | "standard";
}
export interface RenderRequest extends JsonObject {
  bridge_schema_version: "1.0.0"; kind: "full_rezz_render_request";
  body: RenderBody; reference_candidate: JsonObject; generates_audio: false;
}
export interface AuthoredAction extends JsonObject {
  bridge_schema_version: "1.0.0"; kind: "full_rezz_authored_action"; profile_id: VoiceId;
  fps: number; frame_count: number; duration_seconds: number; voice_offset_seconds: number;
  voice_duration_seconds: number; media_path: string; media_sha256: string; voice_path: string;
  voice_sha256: string; statement: string; automatic_reanimation: false;
  events: (JsonObject & { frame: number; pose_id: string; time_seconds?: number })[];
}
export interface VerifiedRender extends JsonObject {
  bridge_schema_version: "1.0.0"; kind: "full_rezz_verified_render"; profile_id: VoiceId;
  receipt: JsonObject; integrity_checked: true; review_status: ReviewStatus;
  audio_decoded_here: false; human_listening_performed_by_adapter: false;
}

/** Optional source renderer; independent of the frozen desktop and bridge versions. */
export type FullRezzRenderPreset = "preview" | "production" | "ultra";
export interface FullRezzMotionReviewFlag {
  kind: "silhouette_change" | "hand_landmark_jump";
  frame: number;
  authored_pose_boundary: boolean;
  fraction?: number;
  pixels?: number;
}
export interface FullRezzRenderAudit {
  schema_version: "1.0.0";
  passed: number;
  failed: number;
  technical_status: "passed" | "failed";
  audit_coverage: "exhaustive" | "portable subset" | "failed";
  human_quality_review: "pending";
  studio_equivalence_validated: false;
  review_flags: FullRezzMotionReviewFlag[];
  metrics: Record<string, unknown>;
}

/** Authored geometry guides; world axes are right-handed and y-up. */
export type FullRezzPoint3 = [number, number, number];
export type FullRezzGuideCamera = { eye: FullRezzPoint3; target: FullRezzPoint3; up: FullRezzPoint3; near: number; far: number }
  & ({ projection: "orthographic"; vertical_span: number } | { projection: "perspective"; vertical_fov_degrees: number });
export interface FullRezzSceneLayout {
  schema_version: "1.0.0"; canvas: [1280, 720];
  provenance: { kind: "authored_guide"; metric_geometry_verified: boolean; notes: string };
  camera: FullRezzGuideCamera;
  anchors: { id: string; world: FullRezzPoint3; contact_index: 0 | 1 }[];
  objects: { id: string; vertices: FullRezzPoint3[]; edges: [number, number][] }[];
  background_regions: { id: string; rect: [number, number, number, number] }[];
  thresholds: { projection_error_design_pixels: number; background_mean_absolute_error_rgb: number; minimum_region_samples: number };
}
export interface FullRezzSceneContinuityReport {
  schema_version: "1.0.0"; passed: number; failed: number;
  checks: { name: string; status: "passed" | "failed"; detail?: string }[];
  metrics: Record<string, unknown>; layout_sha256: string; render_receipt_sha256: string; movie_sha256: string;
  human_quality_review: "pending"; studio_equivalence_validated: false; measurement_limits: string[];
}

/** Implemented companion protocol; separately versioned from legacy action plans. */
export interface CompanionTurn {
  turn_id: string; profile_id: string; reply_text: string;
  voice_binding: string; visual_binding: string; full_history_retained: true;
  presentation_source?: string | null;
  audio_status: "ready" | "failed" | "not_requested";
  context_message_ids: string[];
  speech?: {audio_path: string; generation_ids?: string[]; full_reply_spoken?: boolean;
    performance: {audio_sha256: string; duration_seconds: number; alignment: "energy_only";
      phoneme_alignment: false; protocol_version: "1.0.0"}};
  speech_error?: string;
}
export interface CompanionMovieReceipt {
  profile_id: string; mode: "2d" | "3d"; fps: 60 | 120 | 240;
  frames: number; duration_seconds: number; path: string; sha256: string;
  live_frame_rate_benchmark: false; artistic_acceptance: false;
}
