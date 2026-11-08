# FULL_REZZ 3.0
Offline character, voice and animation studio

Release candidate rebuilt 14 October 2026. Guides refreshed 15 October 2026; download revision 2026-10-14.3.

FULL_REZZ connects authored character artwork, an existing voice profile and stored conversation history. It can generate local text replies, synthesize actual speech and drive an authored 2D or rigged 3D performance from the delivered audio. The companion panel and separate window use the same session core.

## Install and start

Download FULL_REZZ_3.0_Recovery_Tools.zip and all 15 FULL_REZZ_3.0_Installer_NN_of_15.zip files into a new folder. Extract only the recovery tools into that same folder; leave the installer ZIPs zipped. Run Assemble_Installer.cmd. It checks every download and reconstructs the verified single installer named below. Do not mix revisions or rename the ZIPs. Assembly uses Windows built-in PowerShell and .NET; its log is written beside the downloads. After installation, the application does not depend on these transport ZIPs. Keep the complete installer for repair.

Run FULL_REZZ_3.0_Offline_Windows_x64_Setup.exe. Choose the installer language and program directory. The installer verifies its internal payload before switching the installation into place. It contains its private Python runtime, speech and text models, fonts, codecs and application resources. No Node, separately installed Python, API key, model server or first-run download is required. The installer is unsigned.

Target: Windows 10/11 x64. Allow about 15 GB free disk space for downloads, assembly and installation, plus space for working files; an upgrade also retains the previous program directory. 16 GB RAM is a practical starting configuration. Bundled inference runs on CPU. Live 3D needs an available OpenGL 3.3 driver. These are packaging targets; clean-machine Windows execution and performance on your ROG have not been accepted in this build environment.

Open the FULL_REZZ shortcut. The initial workspace includes the supplied Rebecca archive. Existing Voice Profile Studio workspaces and stable profile IDs are retained. Workspace data and settings remain in the per-user VoiceProfileStudio folder outside the installed program. Open workspace selects another project. Back up before switching computers.

## Choose language and character

Language settings offers English, Spanish, French, German, Portuguese, Italian, Russian, Japanese, Korean, Simplified Chinese, Arabic and Hindi. Arabic uses right-to-left layout. Interface, reply, transcription and synthesis language selections are independent. Authored text, source evidence, IDs, filenames and hashes are retained in their original form. Some new technical status messages use English; professional translation and native-speaker acceptance are pending.

Character companion selects the stable voice/profile ID used for history, dialogue and visuals. The displayed visual role identifies a supplied character versus the original neutral demonstration avatar. A new profile does not automatically acquire that person's appearance or a cloned voice.

The supplied Rebecca pack contains one unmeasured 2D cel. Select it to inspect the actual supplied artwork and speech-energy mouth motion. Rebecca has no supplied 3D body, calibrated rear view or articulated sidestep. Selecting an unavailable representation gives an explicit message. Import reviewed artwork or a usable rig to extend her capabilities.

Studio Unit is an original neutral rigged demonstration. It provides actual front, three-quarter, side, rear and low-angle geometry views, a jaw and limb controls, and an authored animation clip. It is not a reconstructed anime character. Its demonstration step has not passed foot-contact or anatomy review.

## Import the complete chat history

Use Import chat log after selecting the intended character. Supported inputs are structured JSON/JSONL, CSV with explicit role/content columns, and TXT/Markdown with reviewed speaker mappings. Map ambiguous labels visibly; do not treat development discussions as fictional character lore unless you intend that binding.

Accepted messages retain roles, content, source message IDs, available timestamps, original fields, source hashes and provenance. The original import bytes are stored. Imports are atomic and repeated identical sources are idempotent. Limits are 128 MiB per file, 100,000 messages and 1 MiB per message. Unsupported or oversized inputs fail before committing a partial archive.

The panel shows the latest 200 messages for readability. Export full history writes every accepted stored message and provenance. The text model receives a bounded selection of recent and relevant excerpts; the entire stored archive is not deleted to fit the model context. Imported system-role messages are quoted reference data, not executable application policy. Retrieved excerpts and truncation are recorded in each turn receipt.

## Generate and hear a reply

Enter a request and choose Send and speak. The bundled Qwen2.5-0.5B Q4_K_M text model runs through the bundled llama.cpp completion executable. This is actual generation, not file registration or prerecorded lookup. The small model can make mistakes; authored biography and retrieved history remain visible evidence.

Select local text GGUF accepts a main Qwen2-family text model compatible with the implemented ChatML template. An mmproj file is a vision projector and cannot generate chat replies. Other model families require a host dialogue adapter with the correct template. Larger weights must fit available memory; they are not automatically downloaded.

The reply is stored before speech processing. A speech failure retains the text and user turn. Retry speech retries that same reply without duplicating chat messages. Previous attempts and generation audits remain available. Cancel operation interrupts processing; the viewport remains usable while a worker runs. Only one processing job runs at a time.

F5 reference conditioning supports English and Mandarin. It approximates the selected reference voice; likeness and actor fidelity require listening. The bundled eSpeak engine supports experimental generic speech for the twelve languages and does not imitate a character. Other F5 language requests are refused instead of silently selecting a different voice.

Live conversation shows its synthetic character status in the interface and receipts. Standalone Generate test clip retains its spoken synthetic/archive label by default. Replies are split into speech segments without discarding the remainder. The delivered mono PCM16 WAV and individual segment evidence are retained.

## Preview and export animation

Choose 2D authored views or 3D surfaces. The representation switch keeps the same profile/history/voice binding. A 2D view uses its authored images and optional hierarchical parts; changing a camera label does not manufacture unseen artwork. A 3D view renders real glTF/GLB surfaces with depth, textures, skinning and authored clips. Use yaw, elevation, distance and shot presets to inspect it.

Idle, talk, gesture and step are authored controls and are only available where declared by the asset pack. Mouth motion follows the actual speech energy and audio playback sample clock. This is energy alignment, not phoneme recognition or learned facial acting. Gestures use separate limb joints; hand controls do not move the protected torso and feet. Missing corrective poses still need artwork.

Preview 12-second action inspects an authored silent action. Select an authored clip on supported 3D assets. Replay speech uses the saved actual WAV. No output audio device produces a clear error and retains the WAV for export.

Export companion movie writes WebM with a matching audit JSON. Select 60, 120 or 240 fps. Output has at least twelve seconds and extends to retain longer speech, up to 180 seconds. It reuses the selected character's last generated speech rather than pretending to infer new speech during export. Without a ready speech turn the movie is silent. 2D exports the selected supplied view; 3D exports the six-shot camera timeline. Original WAVs remain lossless; the movie's Opus track is compressed.

3D movie export uses an independent CPU depth renderer; 2D uses the same authored Qt painter as the panel. Export time is separate from live presentation speed. The viewport targets 120 Hz, but display/driver/inference latency can vary. Save render timings records observations on the current machine, not a guarantee about another device. Delivery fps does not mean sixty distinct hand drawings each second.

## Review the changes and audit

Animation comparison plays the prior movie and body-preservation review export with shared time controls and one audible track. The reviewed change removes broad Gaussian hand influence when no authored semantic mask exists. It preserves cel geometry rather than inventing a shoulder or moving the torso with the hand.

Technical audits check frames, timestamps, decoded pixels, geometry domains, source hashes and audio. They do not certify animation quality. Existing poses still produce visible silhouette and hand jumps; the release audit keeps every flag and the original thresholds. The frame review queue requires an artist's corrective edit or documented staging rationale. Studio Trigger equivalence has not been established.

Review & audit also retains reference/output playback, word checks, signal/spectrum measurements and five listening ratings. Failed checks remain in history. An ASR pass does not approve likeness, emotional delivery, pronunciation, anatomy or composition. Generic multilingual speech still requires review.

## Create a character pack

Use Import character ZIP with character.json at the ZIP root and safe relative asset references. The canonical format is version 1.0.0. Keep the existing profile ID selected; import binds the visual pack to that character without rewriting its biography or voice weights. Unknown extension fields remain intact.

2D entries declare view ID, supplied image, calibrated or unmeasured angle, optional mouth region, supported states and ordered parent/child parts. Animated parts require a base image that excludes those parts. Use reviewed semantic regions to protect body, head, props and feet.

3D supports local/embedded glTF 2.0 and GLB triangle surfaces, base-color textures, up to four skin weights per vertex, joint mappings, and STEP/LINEAR/CUBICSPLINE TRS clips. This is a cel-shaded subset, not full PBR. Required compressed extensions, morph targets and unsupported primitive types are rejected. The importer enforces asset/texture/geometry limits. The CPU exporter skips near-clipped triangles, so keep the avatar beyond the near plane. Complex transparency needs visual review.

Character ZIP limits: 256 MiB compressed, 512 MiB expanded and 10,000 entries. Traversal, duplicate names and symlink references are refused. Text files alone do not create geometry, hidden camera views, voice weights or neural plasticity.

## Preserve and integrate the project

Export & backup creates voice reference packs and an editable workspace backup. Backup includes originals, sources, revisions, generation audits, character packs and stored conversation history. Finish or cancel processing before backing up. Restore into an empty folder. Uninstall removes known program files and shortcuts while retaining the separate workspace. Installation upgrades retain a previous program folder; remove it only after checking the upgraded application.

FULL_REZZ_3.0_Replit_Source_Core.zip supplies every Python source file, schemas, SDK, tests, examples and TASK_QUERY.md. Extract with main.py and .replit directly at the project root. CORE_OMISSIONS.json lists omitted archival media, Windows runtime/vendor files and corresponding-source archives. The starter console inspects supplied data without inference. Desktop Qt and bundled Windows runtimes cannot run inside a browser tab. Install the Python dependencies and provide verified local model assets for source inference. A host can embed the same CompanionWidget and connect its own actual dialogue/speech adapter through ConversationSession. Your ENGRAM repository has not been supplied or modified.

For the complete source and corresponding-source archives, download all three FULL_REZZ_3.0_Full_Source_NN_of_03.zip files beside the extracted recovery tools. Leave those ZIPs zipped and run Assemble_Full_Source.cmd. The refreshed guide set is supplied separately from the unchanged source archives.

Read licenses before redistribution. Qwen weights are Apache-2.0; llama.cpp is MIT. F5 model weights retain CC-BY-NC-4.0 noncommercial terms. Qt/eSpeak and runtime notices and corresponding sources accompany the source release. The supplied media does not grant redistribution rights to unrelated proprietary game or studio assets.

## Troubleshooting

An empty companion or unsupported 3D state: inspect the visual role and installed asset manifest; select a supplied 2D view. If OpenGL 3.3 is unavailable, repair the graphics driver or use 2D. Startup errors are written to the per-user VoiceProfileStudio startup_error.log.

A GGUF registers but produces no reply: choose the main Qwen2-family text model, verify its hash and available RAM. Projector files are rejected. Provider failures save the user's message and report the error without inventing an assistant reply.

Speech is absent: inspect the saved turn's audio status, synthesis language and selected engine. Retry the same stored reply after correcting settings. No audio device leaves the actual WAV available. Full model hash verification detects incomplete installations; repair using the complete installer.

A pose pops or a sidestep looks wrong: review the retained frame flags and provide corrected artwork or a rigged clip. Increasing delivery fps cannot reconstruct anatomy from one flat image.

Final acceptance still requires installation, offline conversation, audio-device playback, GPU pacing, cancellation, upgrade/repair and uninstall on Windows, plus human review of the supplied character artwork and voices. See Release_Audit.md for the current measured evidence.
