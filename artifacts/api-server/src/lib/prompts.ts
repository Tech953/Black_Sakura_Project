/**
 * Moved to @workspace/engram-core so the mobile app's offline mode shares the exact
 * same persona prompts and hard safety constraints. This shim preserves existing
 * imports ("../lib/prompts") across the api-server.
 */
export * from "@workspace/engram-core";
