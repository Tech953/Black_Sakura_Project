# Local voice repair candidate — user guide

## Voice input

A writable chat has controls for recording, transcription language, speech language, and speech engine. These settings are independent of the interface and reply-language preferences. Transcription recognizes speech; it does not translate it. Automatic asks the local multilingual Whisper model to detect the language.

Record a short excerpt, stop it, and review the resulting draft. Existing draft text is retained when the transcript is appended. Only the normal Send action submits it as a chat message. Cancel stops recording or pending transcription. Switching conversations or leaving the view releases the microphone and prevents a late transcript from reaching another conversation.

The browser controls require microphone permission and a secure context. Device-permission failure is shown without sending audio. A missing local runtime disables recording. Generic media attachments follow the host's separate media-perception configuration; they are not the local microphone path.

Temporary microphone audio is not imported into a voice profile, recording library, or history store. It is deleted after processing, failure, or cancellation. A transcript is retained only if the operator subsequently sends or saves it. Limits are one file, 12 MiB, and 60 decoded seconds. Browser recording stops slightly earlier to allow container overhead.

## Voice output and references

Bind a reference pack to an explicitly selected writable engram. Preserve its source manifest, profile mapping, hashes, transcripts, and unknown metadata. A reference pack contains audio conditioning data; it is not model weights or a previously generated reply. The recovered Rebecca reference is one English concern-style excerpt, 4.35 seconds at 44.1 kHz, mono Float32. Its purity is user-declared and listening approval is pending.

F5 reference conditioning supports English and Mandarin. Unsupported languages fail rather than changing voice automatically. Explicitly selected eSpeak offers experimental generic speech across twelve language choices; it does not imitate the bound character. Text agreement, language menus, and model availability do not establish native-speaker quality. The repair's new host controls and technical diagnostics currently use English labels.

Saved-reply speech preserves the host's message identity and text. Inspect every generated clip's word checks, source and output measurements, and five listening ratings. Keep failed attempts and uncertainty visible. Tone and inflection depend on circumstances; spectrum and pitch are separate measurements.

## Profiling, cleanup, and isolation

Original audio remains separate from derived clips. Native-rate Float32 processing, PCM24/PCM16 exports, reversible cleanup, noise-interval selection, and clipping/bandwidth checks remain available. Disabled cleanup preserves working samples exactly. Denoising does not prove speaker purity or repair clipped source detail.

Clustering returns anonymous labels requiring review; it is not named identity verification or overlap detection. Missing optional models report unavailable. The declared Windows asset stage now includes pinned ECAPA and SepFormer model files. Separation yields two anonymous 8 kHz estimates of excerpts up to 30 seconds. Source swaps, bleed, and artifacts require listening. High-fidelity export rejects this bandwidth; upsampling cannot restore detail.

## Acceptance and troubleshooting

A successful runtime probe establishes a bounded diagnostic, not a fresh-install or voice-quality acceptance. Test clean installation with networking disabled, real microphone capture and playback, cancellation, restart, upgrade/repair, and uninstall/data preservation on Windows. Measure peak RAM, disk use, and latency on the target ROG. The CPU models do not promise real-time operation.

Keep separate editable-workspace backups. Never overwrite the immutable archival branch or replace a bound character with a neutral diagnostic voice. See `Release_Audit.md` for the validation scope and `Replit_Integration_Guide.md` for packaging and API contracts.
