/**
 * @workspace/engram-core — pure, runtime-agnostic engram logic shared between the
 * api-server (cloud/desktop) and the mobile app's on-device offline mode.
 *
 * CRITICAL: this package is the single source of truth for persona system prompts
 * and the hard safety constraints (HARD_SAFETY, expression-layer intimacy filter).
 * Keeping one copy guarantees the on-device model is governed by exactly the same
 * safety boundary as the server. Nothing here may import Node builtins, Express,
 * or the DB driver — type-only imports from @workspace/db are allowed.
 */
export * from "./prompts";
export * from "./world-model";
