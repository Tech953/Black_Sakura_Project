# FULL_REZZ 3.0 - Reproducible build guide

Delivery revision 2026-10-14.2. Build tools are developer inputs; they are not installed-program dependencies. Pretrained weights retain their separate licenses. Use the complete source release for corresponding sources.

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
