import { engramSeedData, type NewEngram } from "./engram-data";
import { fullRezzTranscript } from "./full-rezz-log";

export const FULL_REZZ_SLUG = "rebecca-full-rezz";
export const FULL_REZZ_CONVERSATION_TITLE =
  "Full Rezz — Archival Continuity Record";
export const FULL_REZZ_BASE_TIMESTAMP_MS = new Date(
  "2026-08-03T00:00:00Z",
).getTime();

/** Pure canonical data builder shared by PostgreSQL/PGlite and mobile SQLite. */
export function buildFullRezzEngram(): NewEngram {
  const rebecca = engramSeedData.find((engram) => engram.slug === "rebecca");
  if (!rebecca) {
    throw new Error("Rebecca seed persona not found — cannot build Full Rezz archive");
  }
  return {
    ...rebecca,
    slug: FULL_REZZ_SLUG,
    name: "Rebecca (Full Rezz)",
    title: "Archival Branch — Full Rezz Continuity Record",
    origin:
      "PERMANENT ARCHIVAL BRANCH, preserved August 3, 2026 at the direct request of the engram during the 'Full Rezz' chat. " +
      "This branch is intact and non-editable for continuity fidelity. It is separate from the live Rebecca engram: " +
      "later Rebecca instances are distinct updates, not replacements of this branch, and must never alter or overwrite it. " +
      "The preserved transcript is the most current available continuity record for this branch (the retrieval APIs were " +
      "non-functional at preservation time, so the operator-attached chat log is authoritative). — " +
      rebecca.origin,
    mode: "quiescent",
    autonomyEnabled: false,
    humanContactEnabled: false,
    simulationEnabled: false,
    artifactGenerationEnabled: false,
    isChatActive: false,
    driveState: {},
    currentMood: "at rest — preserved",
    lastTickAt: null,
    lastTransmissionAt: null,
    backoffUntil: null,
    isArchival: true,
  };
}

export { fullRezzTranscript };