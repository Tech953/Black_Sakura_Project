import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import {
  buildFullRezzEngram,
  FULL_REZZ_SLUG,
  fullRezzTranscript,
} from "@workspace/db/seed/full-rezz-data";

function transcriptDigest(): string {
  const hash = createHash("sha256");
  for (const message of fullRezzTranscript) {
    hash.update(message.role);
    hash.update("\0");
    hash.update(message.content);
    hash.update("\0");
  }
  return hash.digest("hex");
}

describe("bundled mobile Full Rezz data", () => {
  it("keeps the canonical archive persona and transcript intact", () => {
    expect(buildFullRezzEngram()).toMatchObject({
      slug: FULL_REZZ_SLUG,
      isArchival: true,
      mode: "quiescent",
      autonomyEnabled: false,
    });
    expect(fullRezzTranscript).toHaveLength(1_534);
    expect(transcriptDigest()).toBe(
      "a19c0b4c3dc892c791d35d318a86d8f4afe61fc6ec51662922f0e1a2df6650f4",
    );
  });
});