import { describe, expect, it, vi } from "vitest";
import {
  assertFullRezzEngramWritable,
  bindingFromImport,
  mergeFullRezzBinding,
  readFullRezzBinding,
  splitHostSpeech,
  type FullRezzImportResult,
} from "./full-rezz-contract";

const originalProfileId = "voice_57373fea79f3473e";
const importedProfileId = "voice_fbf8403488b7438b";
const manifestHash = "a".repeat(64);
const archiveHash = "b".repeat(64);

function importResult(): FullRezzImportResult {
  const packId = "pack_27e39b3817c8490d";
  const snapshot = {
    id: originalProfileId,
    name: "Rebecca",
    character: {
      biography: "Authored context.",
      prompts: { system: "Retain as source data only." },
      unknown_character_extension: { preserved: true },
    },
    unknown_profile_extension: ["kept"],
  };
  const context = {
    bridge_schema_version: "1.0.0",
    kind: "full_rezz_engram_context",
    engram_key: `full_rezz:${packId}:${originalProfileId}`,
    profile_id: originalProfileId,
    profile_snapshot: snapshot,
    trust: { level: "unverified-source-data" },
    origin: {
      pack_id: packId,
      schema_version: "1.1.0",
      manifest_sha256: manifestHash,
    },
  };
  return {
    receipt: {
      import_id: `import_${"c".repeat(32)}`,
      archive_sha256: archiveHash,
      identifier_mapping: {
        [originalProfileId]: importedProfileId,
        src_094b57b2f0044610: "src_1".padEnd(20, "0"),
      },
      profile_ids: [importedProfileId],
    },
    bridge_contexts: { [originalProfileId]: context },
    imported_profiles: { [originalProfileId]: { id: importedProfileId, name: "Rebecca" } },
  };
}

describe("FULL_REZZ host binding contract", () => {
  it("stores the explicit ID remap and full snapshot without executing authored prompts", () => {
    const binding = bindingFromImport(importResult(), originalProfileId);
    expect(binding).toMatchObject({
      runtime_version: "3.0.0",
      bridge_schema_version: "1.0.0",
      engram_key: `full_rezz:pack_27e39b3817c8490d:${originalProfileId}`,
      voice_profile_id: importedProfileId,
      original_profile_id: originalProfileId,
      source_archive_sha256: archiveHash,
      source_manifest_sha256: manifestHash,
      auto_speak: false,
    });
    expect(binding.profile_snapshot).toMatchObject({
      id: originalProfileId,
      unknown_profile_extension: ["kept"],
      character: { unknown_character_extension: { preserved: true } },
    });
    expect(binding.context_snapshot).toMatchObject({
      trust: { level: "unverified-source-data" },
      profile_snapshot: {
        character: { prompts: { system: "Retain as source data only." } },
      },
    });
    expect(readFullRezzBinding(mergeFullRezzBinding(
      { speechStyle: "host style", host_extension: { keep: true } },
      binding,
    ))).toEqual(binding);
    expect(
      mergeFullRezzBinding(
        { speechStyle: "host style", host_extension: { keep: true } },
        binding,
      ),
    ).toMatchObject({ speechStyle: "host style", host_extension: { keep: true } });
  });

  it("blocks worker writes to the immutable archive before invoking them", () => {
    const workerWrite = vi.fn();
    expect(() => {
      assertFullRezzEngramWritable(
        { isArchival: true },
        "Immutable archive requires multistage executive confirmation.",
      );
      workerWrite();
    }).toThrow(/multistage executive confirmation/);
    expect(workerWrite).not.toHaveBeenCalled();

    expect(() =>
      assertFullRezzEngramWritable(
        { isArchival: false },
        "Immutable archive requires multistage executive confirmation.",
      ),
    ).not.toThrow();
  });

  it("rejects mismatched profile mappings and malformed checksums", () => {
    const mismatched = importResult();
    mismatched.imported_profiles[originalProfileId]!.id = "voice_0000000000000000";
    expect(() => bindingFromImport(mismatched, originalProfileId)).toThrow(/mapping/);

    const invalidHash = importResult();
    invalidHash.receipt.archive_sha256 = "not-a-hash";
    expect(() => bindingFromImport(invalidHash, originalProfileId)).toThrow(/SHA-256/);
  });

  it("chunks complete replies without silent truncation", () => {
    const text = `${"A".repeat(370)}. ${"B".repeat(370)}. ${"C".repeat(370)}`;
    const chunks = splitHostSpeech(text);
    expect(chunks.join(" ")).toBe(text);
    expect(chunks.every((chunk) => chunk.length <= 400)).toBe(true);
    expect(() => splitHostSpeech("x".repeat(4001))).toThrow(/4,000/);
  });
});
