"""Align active product documentation and preserve earlier release records."""
from pathlib import Path
import json,shutil,csv,sys
R=Path(__file__).resolve().parents[1];A=R/'FULL_REZZ/app';REV='2026-10-14.2'
H=R/'docs/history_before_20261014_rebuild'
def write(rel,text):
 p=R/rel
 if p.exists() and p.read_text(errors='replace')!=text:
  old=H/rel;old.parent.mkdir(parents=True,exist_ok=True)
  if not old.exists():old.write_bytes(p.read_bytes())
 p.parent.mkdir(parents=True,exist_ok=True);p.write_text(text,encoding='utf-8')
def main():
 write('docs/START_HERE.md',f'''# FULL_REZZ 3.0 - Start here

Delivery revision {REV}. Use the matching release files and their recorded checksums.

| Goal | File |
| --- | --- |
| Install on Windows x64 | FULL_REZZ_3.0_Start_Here.zip plus every matching Setup.partNN |
| Read the complete user guide | FULL_REZZ_3.0_User_Guide.pdf or FULL_REZZ/app/docs/User_Guide.md |
| Import source into Replit | FULL_REZZ_Replit_Engram_Fileset.zip; TASK_QUERY.md gives Agent the incorporation task |
| Review measured limitations | FULL_REZZ_3.0_Product_Audit.pdf and evidence/rebuild_20261014/ |
| Reproduce the Windows build | FULL_REZZ/app/docs/BUILD_GUIDE.md and the complete source ZIP |

The installer is internally complete. Its download parts reconstruct one EXE and are not installed dependencies. The Replit ZIP contains source and examples; it excludes the private Windows runtime, pretrained model weights and corresponding-source archives. The complete source release supplies notices and corresponding sources. Current installer bytes are recorded in the final delivery manifest, not inferred from an older receipt.

Native Windows execution, signed-in Replit import and integration into the receiving ENGRAM repository remain acceptance work. The included starter is an inspection console. Artwork and voice likeness still require review.
''')
 old=(R/'docs/API_CONTRACT.md').read_text()
 write('docs/history/API_CONTRACT_2.0.md',old)
 write('docs/API_CONTRACT.md',f'''# FULL_REZZ 3.0 - Implemented interfaces

Delivery revision {REV}. Current native interfaces use Python objects and isolated JSON workers. The former 2.0 HTTP shell is preserved in docs/history/API_CONTRACT_2.0.md for historical reference. It is not the current application launch path.

| Interface | Implemented behavior |
| --- | --- |
| voice_studio.engine.Studio(workspace) | Audio, reviewed regions, stable profiles, sources, revisions and portable reference export |
| voice_studio.synthesis.RenderManager(studio) | Actual local generation, word/signal audits, preserved attempts and listening ratings |
| full_rezz_companion.ConversationSession(studio, ...) | Complete history, generated replies, actual speech adapters and retry without duplicated turns |
| full_rezz_companion.qt.CompanionWidget | Native embedded panel or detached window sharing the same identity and state |
| full_rezz_companion.exporter.export_movie | Authored 2D/3D performance with actual saved WAV, 60/120/240 fps and a decoded-frame audit |
| voice_studio.sdk.VoiceLibrary | Read exported reference packs and prepare portable expression descriptors; descriptors do not generate audio |

Add FULL_REZZ/app to the Python module path. Read docs/COMPANION_INTEGRATION.md for real reply/speech callbacks. A reply callback returns a nonempty string or an object with text; a speech callback returns an actual mono PCM16 WAV in audio_path. Failed providers remain failures. Use the voice worker in a separate process to retain a host's independent API/network settings.

Worker input is a JSON object with workspace, operation, args and result_path. Run `python -m voice_studio.worker task.json`. The result file contains ok plus result or error/traceback. Supported operations are import, analyze, transcribe, separate, quality, source, draft, generate, recheck, export, health, backup, companion_reply, companion_speech, companion_import, companion_export and companion_character. Restoring an editable backup is the native desktop's reviewed empty-folder restore flow.

| Contract | Limit or policy |
| --- | --- |
| Conversation request | 1-4000 characters |
| Imported history | 128 MiB, 100000 accepted messages, 1 MiB per message |
| Character ZIP | 256 MiB compressed, 512 MiB expanded, 10000 entries |
| Canonical character format | 1.0.0; safe relative images or supported glTF/GLB surfaces |
| Standalone speech request | 1-800 characters; the companion segments longer replies |
| Movie rate | 60, 120 or 240 fps; delivery and drawing exposure are independent |
| Movie duration | At least 12 seconds, extended for speech up to 180 seconds |
| Movie dimensions | Even dimensions within 64-1920 by 64-1080 |
| F5 languages | English and Mandarin; explicit refusal for other languages |
| Generic eSpeak | Experimental 12-language speech; no character conditioning |

Legacy bridge version 1.0.0 retains its own older descriptor limits. Those do not extend native renderer limits. Sources and imported system-role text are reference data; they never become executable application policy. Stored history is preserved independently of a bounded model context. No phoneme alignment, unseen-view reconstruction or voice-weight training is implemented by import.
''')
 write('docs/REPLIT_INTEGRATION_GUIDE.md',f'''# FULL_REZZ 3.0 - Replit integration guide

Delivery revision {REV}. Import the source fileset, then give TASK_QUERY.md to Replit Agent in the receiving ENGRAM project. Preserve the existing host configuration and user data before incorporating modules.

## Import and verify

Open https://replit.com/import, choose ZIP and upload FULL_REZZ_Replit_Engram_Fileset.zip. The archive has one clear FULL_REZZ_Replit root and is checked below the documented 200 MB ZIP import limit. Import does not migrate an existing database or secret values. If necessary, set the project root to the directory containing main.py and .replit.

The supplied Run command is `python3 main.py`. It prints the preserved reference pack and verified action plan. Its output explicitly marks inference_performed_on_this_run=false and new_animation_generated=false. This is a starter check, not a full voiced browser application. Read TASK_QUERY.md for the implemented modules and host work.

## Incorporate into ENGRAM

Inspect the host's actual chat, profile, audio, language and persistence interfaces. Keep stable profile IDs and unknown fields. Import FULL_REZZ/app/full_rezz_companion, voice_studio and the schemas. Wire actual host callbacks into ConversationSession; preserve cancellation, failed attempts, retry semantics and full-history export. Keep offline speech workers isolated from any host API process.

For source development use Python 3.11 or later. Install requirements-render.txt and requirements-companion.txt only when needed, then run `python3 -m unittest discover -s tests -v`. Native voice checks run separately from FULL_REZZ/app. Actual source inference needs verified local model assets or genuine configured host providers; the small Replit ZIP excludes pretrained weights and the private Windows runtime.

Qt Widgets provide the native panel/window. A browser ENGRAM host needs its own browser presenter and renderer connected to the shared contracts. No signed-in Replit run, existing host migration or browser implementation is claimed by this handoff. Publish only after testing the receiving host's real user flow.

## Package and acceptance

Use the internally complete Windows installer for offline desktop use. Its model/runtime files are separate from the Replit source import. Use the complete source ZIP for corresponding-source archives and the build inputs listed in BUILD_GUIDE.md. Preserve 40 current artistic flags, prior failed attempts and independent voice ratings.

Official Replit documentation checked 14 October 2026: https://docs.replit.com/build/import-from-providers and https://docs.replit.com/features/project-setup/configuration . The supplied .replit uses the documented Python starter module and Run array; upgrade the source environment before optional native dependencies.
''')
 write('FULL_REZZ/app/docs/Replit_Integration_Guide.md',(R/'docs/REPLIT_INTEGRATION_GUIDE.md').read_text())
 write('FULL_REZZ/app/README.md',f'''# FULL_REZZ 3.0 - Native offline character and voice studio

Delivery revision {REV}. Launch FULL_REZZ.exe from the complete Windows installation. The native Qt application includes voice editing, reviewed source profiles, complete conversation history, local text generation, actual speech, authored 2D/3D performance, movie exports and before/after review.

Read docs/User_Guide.md, docs/Quick_Start.md and docs/Release_Audit.md. This directory is source when delivered in a Replit ZIP; it does not contain the private Windows runtime or model weights. Historical Voice Profile Studio/HTTP files are retained as migration evidence. The active launch.py starts the native desktop.

Keep editable workspace data outside the installation. Existing VoiceProfileStudio per-user paths are retained for continuity. Windows/device acceptance and human artwork/voice review remain open.
''')
 write('FULL_REZZ/app/START_HERE.txt','FULL_REZZ 3.0\nLaunch the FULL_REZZ shortcut after installing the complete verified Setup.exe.\nRead docs/User_Guide.pdf and docs/Quick_Start.pdf.\nSource-only Replit imports require their own development environment and verified model assets.\n')
 write('FULL_REZZ/app/docs/Quick_Start.md',f'''# FULL_REZZ 3.0 - Quick start

Delivery revision {REV}. Windows 10/11 x64 release candidate; native Windows acceptance remains pending.

1. Download FULL_REZZ_3.0_Start_Here.zip and every matching FULL_REZZ_3.0_Setup.partNN. Extract Start_Here beside the parts. Run Assemble_Installer.cmd; it verifies part sizes/checksums and the reconstructed EXE. Do not mix revisions or older installer parts.
2. Run FULL_REZZ_3.0_Offline_Windows_x64_Setup.exe and select the language/program folder. It contains the runtime, models, fonts and codecs. Allow at least 12 GB free space; keep the installer for repair. No external Python, Node, model service, API key or first-run download is required.
3. Open FULL_REZZ. Keep the workspace outside the installed program. Select Character companion and the intended stable profile. The supplied Rebecca pack is one unmeasured 2D cel; Studio Unit is an original neutral 3D demonstration.
4. Import chat history with explicit role mappings where needed. Use Send and speak for a new local reply and speech. Generation may take minutes on CPU. A speech failure keeps the reply; Retry speech uses that same turn.
5. Select supported 2D/3D views and inspect the camera/action controls. Export companion movie at 60, 120 or 240 fps. Audio energy drives the mouth; output fps does not reconstruct missing poses or unseen anatomy.
6. Review voice ratings, geometry and frame flags separately. Back up the editable workspace before moving or upgrading. Uninstall preserves the separate workspace.

F5 conditioning supports English/Mandarin. Generic eSpeak speech is experimental in twelve languages and does not imitate a character. Interface/reply/transcription/synthesis choices are independent. Human likeness and art review remain required.

Replit: import FULL_REZZ_Replit_Engram_Fileset.zip and give TASK_QUERY.md to Agent. The starter inspects data without inference. A browser host requires its own presenter; Qt runs natively. Read Replit_Integration_Guide.md and the complete User_Guide.pdf.

Troubleshooting: preserve startup_error.log and failed receipts, use the matching complete installer for repair, and read User_Guide.md. Clean Windows installation, device playback, GPU pacing, repair/upgrade and uninstall still require target-machine testing.
''')
 write('FULL_REZZ/app/docs/BUILD_GUIDE.md',f'''# FULL_REZZ 3.0 - Reproducible build guide

Delivery revision {REV}. Build tools are developer inputs; they are not installed-program dependencies. Pretrained weights retain their separate licenses. Use the complete source release for corresponding sources.

## Restore and verify inputs

Restore the preserved Voice Profile Studio 3.0 installer parts and source release, plus the FULL_REZZ source checkpoint. Verify the joined predecessor EXE against its recorded SHA-256. Extract its frozen python directory and models with the pinned 7zip tool. Independently stream app/models/tts/model_1250000.safetensors from the EXE and verify size 1348435761 and SHA-256 670900fd14e6c458b95da6e9ed317cdb20dbaf7a1c02ac06a05475a9d32b6a38. A successful archive extraction message alone did not establish the weight's integrity in the restored base. Verify every predecessor payload entry against app/audit/final_payload_manifest.json.

Restore nineteen base voice assets plus the pinned Qwen2.5-0.5B-Instruct Q4_K_M asset using app/licenses/llama-cpp/upstream_manifest.json. Place the Qwen asset at companion/qwen2.5-0.5b-instruct-q4_k_m.gguf. Build models/manifest.json with path, bytes and SHA-256 for all twenty assets. Restore the pinned Windows llama.cpp b7371 executable/DLLs under app/vendor/llama-cpp. Reject projector GGUF files as text models.

Use full_rezz_build/fetch_toolchain.py to fetch signed Ubuntu snapshot NSIS/mingw/7zip tools. The saved toolchain_manifest.json pins each package size and SHA-256 for reproducibility. Verify pins even if a snapshot index must be fetched again after a transient network failure. Do not place downloaded toolchain files in the packaged source tree.

Fetch CPython 3.11.9 embedded Windows x64 bootstrap ZIP and PyOpenGL 3.1.10 wheel. Extract only the eleven pinned Qt 6.8.3 multimedia additions from the matching PySide6 Addons Windows wheel, validating app/licenses/Qt-Multimedia-Addition.json. Keep corresponding Qt Multimedia and FFmpeg 7.1 sources in the full source ZIP. All build-input byte identities are in evidence/rebuild_20261014/build_inputs.json.

## Build

Run tools/build_document_set.py after documentation repairs, then verify the guides visually. Run core/native voice checks and native Qt startup with the matching development dependencies. Mirror the current renderer/bridge modules into app so installed and source paths agree.

Invoke `python tools/build_windows_release.py` with absolute paths for --base-payload, --models, --toolchain, --work, --output, --embed-zip, --opengl-wheel and --multimedia-overlay. See the script's --help. It compiles an x64 launcher and x86 NSIS wizard with a 64-bit-Windows gate, appends an internally complete ZIP64 payload, and verifies every member size, CRC and SHA-256. The final manifest is embedded and pinned by the bootstrap extraction code.

Use tools/make_release_delivery.py with --release and --start-dir to create matching 400 MiB transport parts, checksums and Windows assembly scripts. These reconstruct one complete EXE. tools/package_fileset.py builds the Replit ZIP below 200 MB and a separate full source ZIP. It verifies all entry hashes and CRCs. The full source package excludes pretrained weights/private runtime; those are installed by the complete Windows EXE.

## Acceptance

Exercise the exact embedded install_payload.py against the final EXE and compare installed files, models, guides and source identities. Inspect compiled PE architecture/imports. Linux extraction and offscreen Qt checks do not execute the Windows wizard, loader, audio device or GPU driver. Complete those tests on a clean Windows x64 machine with networking unavailable, including cancellation, restart, repair, upgrade, data preservation and uninstall. The installer remains unsigned.
''')
 p=A/'docs/User_Guide.md';text=p.read_text().replace('Release candidate • 13 October 2026','Release candidate - 14 October 2026; delivery revision '+REV)
 write('FULL_REZZ/app/docs/User_Guide.md',text)
 text=(A/'docs/Release_Audit.md').read_text().replace('13 October 2026.','14 October 2026; delivery revision '+REV+'.',1)
 text=text.replace('## Implemented and tested','## Preserved implementation evidence',1)
 text=text.replace('117 renderer/bridge/companion checks and 108 native voice checks pass.','The saved 13 October baseline records 117 renderer/bridge/companion checks and 108 native voice checks passing.',1)
 text+='\n## This rebuild\n\nCurrent execution receipts are under evidence/rebuild_20261014/. The rebuild restores source bytes atomically, repairs and verifies the predecessor F5 weight, aligns guides/API/localization, checks native Qt startup, rebuilds the complete installer and verifies its actual extraction transaction. New neural speech generation and target-machine Windows execution are not inferred from these packaging checks. Historical neural/audio/media evidence remains dated and separate.\n'
 write('FULL_REZZ/app/docs/Release_Audit.md',text);write('docs/FULL_REZZ_3.0_Product_Audit.md',text)
 for rel in ['FULL_REZZ/FULL_REZZ_Audit.md','FULL_REZZ/app/FULL_REZZ_Audit.md']:write(rel,text)
 for rel in ['docs/INTEGRATION.md','docs/RENDER_AUDIT_GUIDE.md','animation/Rebecca_Animation_Audit.md']:
  p=R/rel;s=p.read_text();note='> Historical component document. For FULL_REZZ 3.0 use docs/START_HERE.md, docs/API_CONTRACT.md and docs/FULL_REZZ_3.0_Product_Audit.md. Original measurements and contracts below retain their original version.\n\n'
  if not s.startswith('> Historical'):write(rel,note+s)
 p=R/'docs/COMPANION_INTEGRATION.md';s=p.read_text().replace('uses the new SDK for native imports','uses native reviewed workspace/reference workflows for 3.0 imports').replace('on 13 October 2026','on 14 October 2026');write(str(p.relative_to(R)),s)
 legacy=A/'audit/legacy_http_tests';legacy.mkdir(parents=True,exist_ok=True)
 for name in ['test_server.py','test_adapters.py','test_offline_features.py','test_models.py','playtest_browser.py','test_ui.js']:
  p=A/'tests'/name
  if p.exists():shutil.move(str(p),legacy/name)
 write('FULL_REZZ/app/audit/legacy_http_tests/README.md','# Historical HTTP 2.0 checks\n\nRetained earlier tests and browser checks. Current 3.0 launch uses native Qt; run test_core, test_audit, test_audio_quality, test_offline and test_languages in separate processes.\n')
 for module in ['full_rezz_render','full_rezz_bridge']:
  for p in (R/module).glob('*.py'):
   dest=A/module/p.name;dest.parent.mkdir(parents=True,exist_ok=True);dest.write_bytes(p.read_bytes());assert dest.read_bytes()==p.read_bytes()
 print('Active documents repaired; earlier records retained')
if __name__=='__main__':main()
