# Rebecca portable voice reference pack

[FULL_REZZ_Rebecca_Reference_Pack.zip](FULL_REZZ_Rebecca_Reference_Pack.zip) is the complete audio-bearing import ZIP requested for Task #798. It contains the actual 4.35-second, 44,100 Hz mono Float32 WAV, matching reference transcript, profile/context data, source evidence, original quality/review status and binding notes.

The existing [extracted reference pack](../upstream/examples/rebecca_reference_pack/) contains the same 47 original files byte-for-byte. The ZIP also includes its four standalone delivery/validation files. The checked-in source reference is reused; it is not a generated reply or a newly trained voice model.

| Binding field | Value |
| --- | --- |
| Portable schema | `1.1.0` |
| Pack ID | `pack_27e39b3817c8490d` |
| Original profile ID | `voice_57373fea79f3473e` |
| Reference style | `concern` |
| Reference duration | 4.35 seconds |
| Reference rate and encoding | 44,100 Hz, mono IEEE Float32 WAV |
| ZIP bytes | 760,180 |
| ZIP SHA-256 | `ed4ea88937aefc99efe1745735099663575690f7974ab4cfde4c934a4397d153` |

## Import and bind

Upload the ZIP through the existing chat panel's FULL_REZZ import flow. Preview it, select the original profile above, and import into the intended account-owned writable continuation. The authenticated preview/import routes and the local worker retain their existing ownership, archive and runtime checks. A verified local runtime remains necessary for the host flow.

The import receipt supplies the remapped local profile ID. Use that returned mapping in the host binding and preserve newer host persona fields. The permanent Full Rezz archival engram remains read-only; this component import does not change an account's engrams, conversations or database.

For direct SDK access, pass `components/full_rezz/upstream/examples/rebecca_reference_pack` to the repository's `full_rezz_bridge.ReferencePack` or `voice_studio.sdk.VoiceLibrary`. Select the original profile with style `concern`; reference paths are relative to that extracted pack directory. Use `profiles[].references` for available audio. Three other transcript entries describe historical unreviewed recordings and are not extra exported references.

The source manifest retains its original producer version, identifiers and declared hashes. Reference purity remains `user_declared_single_voice`, with human listening/likeness review pending. Existing source evidence and third-party rights remain applicable. The ZIP adds no model weights or runtime and does not wire microphone transcription or execute new speech. See the [host integration notes](../../../artifacts/desktop/full-rezz/REPLIT_INTEGRATION.md).

## Verification

[VALIDATION.json](VALIDATION.json) records validation against the current repository's bridge and voice SDK, exact agreement with all 47 original checked-in files, ZIP CRC and internal checksums, and finite decoded audio samples. [CHECKSUMS.sha256](CHECKSUMS.sha256) covers this supplement's ZIP, documentation and validation record. The component's `.gitattributes` preserves exact bytes on Windows checkouts. No neural inference, Windows execution or live account binding was performed by this packaging check.
