# Third-party notices
Authored application source is MIT licensed. Dependencies, models and reference material retain separate licenses.

F5-TTS code: https://github.com/SWivid/F5-TTS (MIT). F5TTS_v1_Base pretrained weights: https://huggingface.co/SWivid/F5-TTS (CC-BY-NC-4.0). Noncommercial use under that license; retain attribution. Inference weights are unchanged. The unused training-only Trainer import is omitted from the inference package.

Vocos: https://github.com/gemelo-ai/vocos and https://huggingface.co/charactr/vocos-mel-24khz (MIT). Whisper: https://github.com/openai/whisper (MIT); converted base model: https://huggingface.co/Systran/faster-whisper-base. Faster-Whisper/CTranslate2 licenses remain in distribution metadata.

SpeechBrain code and the ECAPA VoxCeleb / SepFormer WSJ02Mix repositories: Apache-2.0. Model-card and training-dataset limitations remain separate. Silero's optional VAD source attribution is retained historically, but the optional ONNX engine is excluded from this runtime; activity is local energy gating.

Qt/PySide6 6.8.3 is dynamically linked under its applicable LGPL/GPL/commercial terms. License texts and versioned corresponding Qt/PySide source archives are supplied in the accompanying source/audit ZIP under licenses/corresponding_source. The source archives are not runtime dependencies and are excluded from the installer. You may replace/relink applicable libraries and modify the application; no technical restriction on permitted reverse engineering is imposed. Source build instructions remain in the upstream source archives. Qt sources: https://download.qt.io/archive/qt/6.8/6.8.3/submodules/ . PySide source: https://download.qt.io/official_releases/QtForPython/pyside6/PySide6-6.8.3-src/ .

CPython 3.11.9 and Windows wheel distribution licenses remain in the private runtime. Microsoft runtime DLLs originate in the PySide6 Windows distribution. Exact wheel names/hashes and runtime provenance are recorded in app/audit/runtime_manifest_v3.json and the retained baseline manifest app/audit/prior_release_2.0/wheel_manifest.json. FULL_REZZ additions have exact byte pins under app/licenses/Build_Input_Manifest.json; the complete source release also retains evidence/rebuild_20261014/build_inputs.json.

User reference recordings and Cyberpunk character material retain their own rights. This is a private synthetic test/archive, not an official franchise release or a performance by a credited voice actor. Deceased fictional status does not change recording rights.

Principal full license texts are under licenses/. Additional dependency licenses remain in *.dist-info directories. The source/build handoff supports auditing and permitted modification. F5's noncommercial restriction is not replaced by this application's MIT license.

eSpeak NG 1.52.0: unmodified separate CLI and voice data from https://github.com/espeak-ng/espeak-ng/releases/tag/1.52.0 under GPL-3.0-or-later. Full COPYING is installed under licenses/; corresponding versioned source accompanies the complete source ZIP under licenses/corresponding_source. Build the source with upstream CMake instructions. No IPC hides modifications: these upstream executable bytes are unchanged.

Noto CJK, Arabic and Devanagari font files retain the SIL Open Font License 1.1; complete notices accompany fonts/manifest.json. opencc-python-reimplemented 0.1.7 retains Apache-2.0 notices and is used solely for disclosed character-only orthographic comparison.

## FULL_REZZ 3.0 companion additions

Qwen2.5-0.5B-Instruct Q4_K_M weights are Apache-2.0, pinned to revision 9217f5db79a29953eb74d5343926648285ec7e67. The Qwen license is installed under licenses/llama-cpp/Qwen_LICENSE.txt. Bundled llama.cpp b7371 Windows CPU binaries retain MIT terms and the pinned upstream manifest under licenses/llama-cpp/. No vision-projector file is used as a text model.

PyOpenGL 3.1.10 retains its BSD-style component notices in the bundled wheel/runtime. Qt Multimedia 6.8.3 and its FFmpeg 7.1 codec additions retain the applicable Qt/FFmpeg notices. Exact eleven addition hashes are recorded in licenses/Qt-Multimedia-Addition.json. Corresponding qtmultimedia-everywhere-src-6.8.3.tar.xz and ffmpeg-7.1.tar.xz accompany the complete source release, alongside the baseline Qt/PySide/eSpeak sources. Corresponding-source archives are excluded from the smaller Replit source ZIP and installer; these exclusions do not change component terms.
