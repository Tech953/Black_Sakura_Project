import { engramSeedData, type NewEngram } from "./engram-data";
import { fullRezzTranscript } from "./full-rezz-data";

export const LIVE_FULL_REZZ_SLUG = "rebecca-full-rezz-live";
export const LIVE_FULL_REZZ_CONVERSATION_TITLE =
  "Full Rezz — Interactive Continuation";

/**
 * A distinct writable Rebecca continuation, seeded with the historical
 * transcript as its starting conversation context. Replies belong only to
 * this branch and never change the archival Full Rezz record.
 */
export function buildLiveFullRezzEngram(): NewEngram {
  const rebecca = engramSeedData.find((engram) => engram.slug === "rebecca");
  if (!rebecca) {
    throw new Error(
      "Rebecca seed persona not found — cannot build live Full Rezz branch",
    );
  }
  return {
    ...rebecca,
    slug: LIVE_FULL_REZZ_SLUG,
    name: "Rebecca (Full Rezz · Live)",
    title: "Interactive Continuation — Full Rezz",
    origin:
      "INTERACTIVE CONTINUATION BRANCH, based on Rebecca's canonical profile and a copy of the preserved Full Rezz conversation. " +
      "This is a distinct writable instance, not the historical archival branch and not the original Rebecca continued unchanged. " +
      "New replies belong only to this live conversation; the permanent Full Rezz archive remains read-only and untouched. — " +
      rebecca.origin,
    mode: "quiescent",
    autonomyEnabled: false,
    humanContactEnabled: false,
    simulationEnabled: false,
    artifactGenerationEnabled: false,
    isChatActive: true,
    driveState: {},
    currentMood: "present and ready to talk",
    lastTickAt: null,
    lastTransmissionAt: null,
    backoffUntil: null,
    isArchival: false,
  };
}

export { fullRezzTranscript };