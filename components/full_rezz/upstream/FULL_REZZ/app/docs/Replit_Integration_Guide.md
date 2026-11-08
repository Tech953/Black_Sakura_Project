# FULL_REZZ 3.0 - Replit integration guide

Delivery revision 2026-10-14.2. Import the source fileset, then give TASK_QUERY.md to Replit Agent in the receiving ENGRAM project. Preserve the existing host configuration and user data before incorporating modules.

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
