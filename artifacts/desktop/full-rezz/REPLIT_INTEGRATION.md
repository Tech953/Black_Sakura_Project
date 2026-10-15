# FULL_REZZ 3.0 integration

This is a host-side integration, not a replacement for the existing chat or
archive system.

## Host behavior

- The chat UI can preview and import a FULL_REZZ reference pack into an existing
  writable engram, with explicit profile selection and provenance checks.
- Speech is requested only for an assistant reply already saved by the host.
  Imported character/context snapshots are retained as untrusted source data;
  they are not executed to produce a reply. FULL_REZZ conversation-history
  import/export is not exposed in the host UI yet.
- Speech uses the local FULL_REZZ worker and fails closed when the verified
  runtime is unavailable. No cloud speech fallback is provided.
- Per-owner workspace data, generated audio, audit records, and import
  provenance are kept separate from the immutable archive.

## Immutable archive boundary

The archived engram is read-only. Import, speech, review, rollback, and all
other mutating operations must reject an archival engram before starting the
worker or writing to the database. No bypass is implemented. Any future
exception requires multistage executive confirmation.

## Runtime and scope limits

The source package contains no model weights, Python runtime, or personal
reference media. The verified Windows installer must be safely extracted and
its model manifest, licenses, and hashes reviewed before runtime assets can be
staged. The installer is not executed by this integration. Native Windows
acceptance testing remains required.

The included `Studio Unit` is an original neutral demonstration asset. It is
not a likeness or substitute for any bound character. The shared browser and
desktop chat UI can open it beside generated speech: the presenter loads its
six supplied static PNG views and its skinned glTF model with the authored
animation clips. The 3D view has preset camera angles and pointer orbit; when
speech is playing, the selected authored clip follows the audio element clock.
This is not phoneme alignment, inferred lip sync, or character-specific
animation. The 2D views remain static, and no movie export or 60/120/240 fps
render pipeline is connected yet.

F5-TTS model assets are subject to the model's CC-BY-NC-4.0 license; they must
not be redistributed or used commercially without separate authorization.
See `THIRD_PARTY_NOTICES.md` for component-specific terms.
