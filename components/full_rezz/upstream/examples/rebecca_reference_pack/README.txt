VOICE REFERENCE PACK

Open manifest.json first. All clip paths are relative to this folder.
clips/: native sample rate, mono FLOAT32 snippets with source timestamps and review status.
quality_report.json: source/output checks, applied processing, and excluded clips with reasons.
Original files are retained in the local application, not included in this export.
transcript.jsonl: source-time word/region records; absent ASR means no invented transcript.
segments.csv: editable annotations and eligible reference durations.
SRT/VTT files use source recording timestamps. Clips are separate; these times are not clip offsets.
No emotion, accent, gender, medical traits, or cross-file identity is inferred.
Expression metadata conditions a compatible external renderer; it does not train or clone a voice.
