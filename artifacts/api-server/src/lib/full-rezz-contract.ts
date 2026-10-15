export interface FullRezzBinding {
  runtime_version: "3.0.0";
  bridge_schema_version: "1.0.0";
  engram_key: string;
  pack_id: string;
  pack_schema_version: "1.0.0" | "1.1.0";
  voice_profile_id: string;
  original_profile_id: string;
  import_id: string;
  source_archive_sha256: string;
  source_manifest_sha256: string;
  identifier_mapping: Record<string, string>;
  profile_snapshot: Record<string, unknown>;
  context_snapshot: Record<string, unknown>;
  imported_at: string;
  auto_speak: boolean;
}

export interface FullRezzImportResult {
  receipt: {
    import_id: string;
    archive_sha256: string;
    identifier_mapping: Record<string, string>;
    profile_ids: string[];
  };
  bridge_contexts: Record<string, Record<string, unknown>>;
  imported_profiles: Record<string, Record<string, unknown>>;
}

/**
 * Keep every FULL_REZZ write away from an immutable archive. Call before
 * starting worker-side imports, and again inside the database transaction.
 */
export function assertFullRezzEngramWritable(
  engram: { isArchival?: unknown },
  readOnlyError: string,
): asserts engram is { isArchival: false } {
  if (engram.isArchival !== false) throw new Error(readOnlyError);
}

const profileIdPattern = /^voice_[a-f0-9]{16}$/;
const importIdPattern = /^import_[a-f0-9]{32}$/;
const packIdPattern = /^pack_[a-f0-9]{16}$/;
const sha256Pattern = /^[a-f0-9]{64}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`FULL_REZZ import is missing ${label}.`);
  }
  return value;
}

function requireProfileId(value: unknown, label: string): string {
  const id = requireString(value, label);
  if (!profileIdPattern.test(id)) throw new Error(`FULL_REZZ import has an invalid ${label}.`);
  return id;
}

function requireSha256(value: unknown, label: string): string {
  const digest = requireString(value, label);
  if (!sha256Pattern.test(digest)) throw new Error(`FULL_REZZ import has an invalid ${label}.`);
  return digest;
}

/**
 * Validate the remapping receipt before it is attached to an existing engram.
 * The authored profile snapshot remains data: this function never turns its
 * prompt fields into host instructions.
 */
export function bindingFromImport(
  result: FullRezzImportResult,
  originalProfileId: string,
  importedAt = new Date().toISOString(),
): FullRezzBinding {
  if (!isRecord(result) || !isRecord(result.receipt)) {
    throw new Error("FULL_REZZ worker returned no import receipt.");
  }
  const receipt = result.receipt;
  const originalId = requireProfileId(originalProfileId, "original profile ID");
  const importId = requireString(receipt.import_id, "import ID");
  if (!importIdPattern.test(importId)) throw new Error("FULL_REZZ import has an invalid import ID.");
  const mapping = receipt.identifier_mapping;
  if (!isRecord(mapping)) throw new Error("FULL_REZZ import returned no identifier mapping.");
  const importedProfileId = requireProfileId(mapping[originalId], "remapped profile ID");
  const context = result.bridge_contexts?.[originalId];
  const profile = result.imported_profiles?.[originalId];
  if (!isRecord(context) || !isRecord(profile)) {
    throw new Error("FULL_REZZ import did not return the selected profile context.");
  }
  if (context.kind !== "full_rezz_engram_context" || context.bridge_schema_version !== "1.0.0") {
    throw new Error("FULL_REZZ import returned an unsupported bridge context.");
  }
  const origin = context.origin;
  const snapshot = context.profile_snapshot;
  if (!isRecord(origin) || !isRecord(snapshot)) {
    throw new Error("FULL_REZZ import is missing its profile snapshot or origin record.");
  }
  const packId = requireString(origin.pack_id, "pack ID");
  if (!packIdPattern.test(packId)) throw new Error("FULL_REZZ import has an invalid pack ID.");
  const packSchemaVersion = origin.schema_version;
  if (packSchemaVersion !== "1.0.0" && packSchemaVersion !== "1.1.0") {
    throw new Error("FULL_REZZ import uses an unsupported reference-pack schema.");
  }
  if (
    requireProfileId(context.profile_id, "context profile ID") !== originalId ||
    requireProfileId(snapshot.id, "snapshot profile ID") !== originalId ||
    requireProfileId(profile.id, "imported profile ID") !== importedProfileId
  ) {
    throw new Error("FULL_REZZ import profile mapping does not match the selected character.");
  }
  if (
    !Array.isArray(receipt.profile_ids) ||
    !receipt.profile_ids.includes(importedProfileId)
  ) {
    throw new Error("FULL_REZZ import receipt does not contain the remapped profile.");
  }
  const engramKey = requireString(context.engram_key, "namespaced engram key");
  if (engramKey !== `full_rezz:${packId}:${originalId}`) {
    throw new Error("FULL_REZZ import returned an invalid namespaced engram key.");
  }

  const identifierMapping: Record<string, string> = {};
  for (const [sourceId, targetId] of Object.entries(mapping)) {
    if (
      !/^(?:voice|src)_[a-f0-9]{16}$/.test(sourceId) ||
      typeof targetId !== "string" ||
      !/^(?:voice|src)_[a-f0-9]{16}$/.test(targetId)
    ) {
      throw new Error("FULL_REZZ import contains an invalid identifier remapping.");
    }
    identifierMapping[sourceId] = targetId;
  }

  return {
    runtime_version: "3.0.0",
    bridge_schema_version: "1.0.0",
    engram_key: engramKey,
    pack_id: packId,
    pack_schema_version: packSchemaVersion,
    voice_profile_id: importedProfileId,
    original_profile_id: originalId,
    import_id: importId,
    source_archive_sha256: requireSha256(receipt.archive_sha256, "archive SHA-256"),
    source_manifest_sha256: requireSha256(origin.manifest_sha256, "manifest SHA-256"),
    identifier_mapping: identifierMapping,
    profile_snapshot: snapshot,
    context_snapshot: context,
    imported_at: importedAt,
    auto_speak: false,
  };
}

/** Merge only the FULL_REZZ binding; all existing and unknown host fields survive. */
export function mergeFullRezzBinding(
  voiceProfile: Record<string, unknown>,
  binding: FullRezzBinding,
): Record<string, unknown> {
  return { ...voiceProfile, full_rezz: binding };
}

export function readFullRezzBinding(
  voiceProfile: unknown,
): FullRezzBinding | null {
  if (!isRecord(voiceProfile) || !isRecord(voiceProfile.full_rezz)) return null;
  const binding = voiceProfile.full_rezz;
  if (
    binding.runtime_version !== "3.0.0" ||
    binding.bridge_schema_version !== "1.0.0" ||
    typeof binding.voice_profile_id !== "string" ||
    !profileIdPattern.test(binding.voice_profile_id) ||
    typeof binding.original_profile_id !== "string" ||
    !profileIdPattern.test(binding.original_profile_id) ||
    typeof binding.auto_speak !== "boolean"
  ) {
    return null;
  }
  return binding as unknown as FullRezzBinding;
}

export function splitHostSpeech(text: string, maximum = 400): string[] {
  if (typeof text !== "string" || !text.trim()) {
    throw new Error("There is no saved reply text to speak.");
  }
  const remainingText = text.trim();
  if (remainingText.length > 4000) {
    throw new Error("A FULL_REZZ reply can contain at most 4,000 characters.");
  }
  const chunks: string[] = [];
  let remaining = remainingText;
  while (remaining) {
    let cut = Math.min(maximum, remaining.length);
    if (cut < remaining.length) {
      const boundary = Math.max(
        remaining.lastIndexOf(". ", cut),
        remaining.lastIndexOf("! ", cut),
        remaining.lastIndexOf("? ", cut),
        remaining.lastIndexOf("; ", cut),
        remaining.lastIndexOf(" ", cut),
      );
      if (boundary > 0) cut = boundary + 1;
    }
    const chunk = remaining.slice(0, cut).trim();
    if (!chunk) throw new Error("FULL_REZZ speech chunking could not preserve the reply.");
    chunks.push(chunk);
    remaining = remaining.slice(cut).trim();
  }
  return chunks;
}
