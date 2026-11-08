# Implemented FULL_REZZ 2.0 interfaces

The code in `FULL_REZZ/app/voice_studio/server.py` is authoritative. The server binds to `127.0.0.1` and an ephemeral port in the desktop shell. It accepts only its exact local Host and same-origin requests. The UI receives a per-session token from its HTML; mutation requests send `X-Studio-Token`. There is no remote authentication-token endpoint.

| Method / path | Input / output |
| --- | --- |
| `GET /api/state` | Version, recordings, profiles, capabilities, jobs and saved renders |
| `GET /api/audio/{rec_id}` | Local recording audio |
| `GET /api/renders/{render_id}/speech.wav` | Rendered 24 kHz WAV; `?download=1` requests download |
| `GET /api/renders/{render_id}/reference.wav` | Exact selected conditioning reference |
| `GET /api/renders/{render_id}/receipt.json` | Render request, hashes, measures, model/license details and review history |
| `GET /api/exports/{pack_id}.zip` | Portable reference snapshot |
| `GET /guide`, `/quick-start`, `/animation` | Local help and the existing demonstration |
| `POST /api/jobs` | JSON job kind and parameters; one active task at a time |
| `POST /api/render-review` | `{render_id, status, notes}`; status: `approved`, `needs_revision`, `unreviewed` |
| `POST /api/portable-import` | Raw ZIP body, transactional restore with byte-preserved original archive |
| `POST /api/import?name=...` | Raw audio body; 250 MiB input, 512 MiB decoded, 30 minutes, up to 8 channels |
| `POST /api/profiles` | `{name, notes, language}` |
| `POST /api/character` | `{profile_id, character, name, notes, language, expected_revision}` |
| `POST /api/segments` | `{recording_id, segments, expected_revision}` |
| `POST /api/source-import?profile_id=...&name=...` | Raw locally imported source document |

Render job body:

```json
{
  "kind": "render",
  "profile_id": "voice_57373fea79f3473e",
  "text": "The offline archive is ready.",
  "style": "concern",
  "rate": 1,
  "pitch": 0,
  "volume": 0,
  "steps": 32,
  "seed": 42,
  "reference_text": "",
  "scene_notes": "",
  "quality_policy": "high_fidelity"
}
```

Use the actual assigned ID in the local project, not the example ID after an import remapping. The bridge request `body` omits `kind`; add `kind: "render"` only for the HTTP job route. The direct worker delegates to `render_store.generate` without this HTTP field.

| Constraint | Value |
| --- | --- |
| Speech text | 1–500 nonblank characters |
| Reference style label | 1–80 characters; a user label, not inferred emotion |
| Rate | 0.5–2.0 |
| Pitch | −12 to +12 semitones |
| Volume | −20 to +6 dB, then output headroom protection |
| Steps | Integer 16 or 32 |
| Seed | Integer 0–2,147,483,647 |
| Reference annotation override | Up to 2,000 characters |
| Scene notes | Up to 10,000 characters; recorded context, not an acting engine |
| Selected reference duration | 3–12 seconds; signal checks and listening review remain separate |
| Estimated output | At most 30 seconds before inference |
| Output | 24 kHz FLOAT32 WAV, peak target no higher than −1 dBFS, 5 ms boundary fades |
| Quality policy | `high_fidelity` or `standard` |

English tiny.en ASR is bundled and runs without the ONNX VAD path. ECAPA uses energy windows and cosine grouping; it does not identify performers or detect overlaps. SepFormer produces two anonymous 8 kHz estimates and limits input to 30 seconds. F5 v1 + Vocos performs actual speech rendering. Character/source prompts are not executed by the speech renderer. Bass/mid/treble measures describe spectrum and do not infer emotion, age, gender or identity.

The SDK's `expression_request` permits up to 20,000 characters as a portable descriptor. That limit does not extend the implemented 500-character F5 render limit. Use the bridge's `speech_body` validator when creating executable render jobs.
