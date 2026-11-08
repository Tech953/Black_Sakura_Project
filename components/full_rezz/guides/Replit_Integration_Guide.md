# FULL_REZZ 3.0 - Replit integration

Guides refreshed 15 October 2026; download revision 2026-10-14.3. Give TASK_QUERY.md to Replit Agent in the receiving ENGRAM project. Back up its configuration and user data before incorporation.

## Import and verify

Open https://replit.com/import and import FULL_REZZ_3.0_Replit_Source_Core.zip (91,851,964 bytes; 91.9 MB decimal). The archive has a flat project root: main.py and .replit are directly at the root. Preserve the receiving project's existing configuration. Import does not migrate a database or secret values.

The Run command is `python3 main.py`. It prints the reference pack and action plan, reporting inference_performed_on_this_run=false and new_animation_generated=false. This checks the starter. Read TASK_QUERY.md for implemented modules and host work.

The compact ZIP retains every Python source file. CORE_OMISSIONS.json lists omitted historical media, generated arrays, Windows runtime/vendor binaries and corresponding-source archives. Source inference needs separately provisioned models. These refreshed guides accompany the unchanged source archives.

## Incorporate into ENGRAM

Inspect the host's actual chat, profile, audio, language and persistence interfaces. Keep stable profile IDs and unknown fields. Incorporate FULL_REZZ/app/full_rezz_companion, voice_studio and the schemas. Wire actual host callbacks into ConversationSession; preserve cancellation, failed attempts, retries and full-history export. Isolate offline speech workers from any host API process.

Use Python 3.11 or later for source development. Install requirements-render.txt and requirements-companion.txt only when needed, then run `python3 -m unittest discover -s tests -v`. Native voice checks run separately from FULL_REZZ/app. Actual source inference requires verified local model assets or genuine configured host providers.

The recorded repair run had 96 core tests pass and 21 optional raster tests skip because PyAV was unavailable. Rerun in the receiving environment and retain skipped results. Signed-in Replit execution and host migration remain untested.

Qt Widgets provide the native panel/window. A browser host needs its own presenter and renderer. Test its real user flow before publishing. The ENGRAM repository has not been supplied or modified.

## Package and acceptance

For offline desktop use, download all 15 installer ZIPs and FULL_REZZ_3.0_Recovery_Tools.zip. Extract only the tools, leave the installer ZIPs zipped and run Assemble_Installer.cmd. Native Windows acceptance remains pending.

For full corresponding sources and BUILD_GUIDE.md inputs, download all three FULL_REZZ_3.0_Full_Source_NN_of_03.zip files beside the extracted tools and run Assemble_Full_Source.cmd. Preserve 40 open artistic flags, prior failed attempts, independent voice ratings and license notices.

Reference documentation (checked for the preceding 14 October handoff): https://docs.replit.com/build/import-from-providers and https://docs.replit.com/features/project-setup/configuration . Validate the receiving environment before installing optional native dependencies.
