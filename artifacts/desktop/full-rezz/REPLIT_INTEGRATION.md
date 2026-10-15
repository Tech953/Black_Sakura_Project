# FULL_REZZ 3.0 integration

This is a host-side integration, not a replacement for the existing chat or
archive system.

## Host behavior

- The chat UI can preview and import a FULL_REZZ reference pack into an existing
  writable engram, with explicit profile selection and provenance checks.
- Speech is requested only for an assistant reply already saved by the host.
  Imported prompts and history are retained as untrusted reference data; they
  are not executed to produce a reply.
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
not a likeness or substitute for any bound character. This change does not
yet connect a 3D presenter, animation controls, or a frame-rate/export
pipeline to the chat UI.

F5-TTS model assets are subject to the model's CC-BY-NC-4.0 license; they must
not be redistributed or used commercially without separate authorization.
See `THIRD_PARTY_NOTICES.md` for component-specific terms.
