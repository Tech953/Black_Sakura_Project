# FULL_REZZ 3.0 integration

This is a host-side integration, not a replacement for the existing chat or
archive system.

## Host behavior

- The chat UI can preview and import a FULL_REZZ reference pack into an existing
  writable engram, with explicit profile selection and provenance checks.
- Speech is requested only for an assistant reply already saved by the host.
  Imported character/context snapshots are retained as untrusted source data;
  they are not executed to produce a reply.
- Conversation history supports previewed JSON, JSONL, mapped CSV, and reviewed
  speaker-label TXT/MD imports, paged inspection, and complete JSON export.
  Original uploaded bytes, source hashes, mappings, message provenance, and
  retrieval receipts are retained in a per-owner SQLite store outside engram
  records. Context retrieval is bounded; the stored history is not truncated.
  Imported `system` and `tool` roles remain transcript labels and are never
  promoted to host policy or executable instructions.
- Movie export uses the actual saved-reply WAV and the shared FULL_REZZ
  renderer. It supports 2D or 3D `.webm` output at 60, 120, or 240 fps, with
  cancellation, progress, and a downloadable frame/audio audit JSON. Export
  does not generate new speech, infer geometry, or claim artistic acceptance.
- Speech uses the local FULL_REZZ worker and fails closed when the verified
  runtime is unavailable. No cloud speech fallback is provided.
- Per-owner workspace data, generated audio, audit records, and import
  provenance are kept separate from the immutable archive.

## Immutable archive boundary

The archived engram is read-only. History preview/import/export, speech,
movie export, review, rollback, and all other operations reject an archival
engram before starting the worker or writing to the database. No bypass is
implemented. Any future exception requires multistage executive confirmation.

## Runtime and scope limits

The source package contains no model weights, Python runtime, or personal
reference media. The verified Windows installer must be safely extracted and
its model manifest, licenses, and hashes reviewed before runtime assets can be
staged. The installer is not executed by this integration. This source-only
checkout does not include the packaged runtime, so these endpoints return an
explicit unavailable status until verified runtime assets are staged. Native
Windows acceptance testing remains required.

The included `Studio Unit` is an original neutral demonstration asset. It is
not a likeness or substitute for any bound character. The shared browser and
desktop chat UI can open it beside generated speech: the presenter loads its
six supplied static PNG views and its skinned glTF model with the authored
animation clips. The 3D view has preset camera angles and pointer orbit; when
speech is playing, the selected authored clip follows the audio element clock.
This is not phoneme alignment, inferred lip sync, or character-specific
animation. Movie export uses the neutral Studio Unit unless a character asset
set is separately authored in the FULL_REZZ workspace; it does not imply that
the engram is represented by that demo asset.

F5-TTS model assets are subject to the model's CC-BY-NC-4.0 license; they must
not be redistributed or used commercially without separate authorization.
See `THIRD_PARTY_NOTICES.md` for component-specific terms.
