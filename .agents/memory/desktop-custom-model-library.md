---
name: Desktop custom model library
description: Durable rules for managing multiple imported GGUF models in the desktop app
---

The desktop custom-model library keeps content-addressed GGUF files by SHA-256 and stores a display name plus last-used timestamp for each entry. The legacy single custom setting remains the selected-model compatibility field and is migrated into the library.

**Why:** Users need to switch models without re-importing, while failed activation and active-model removal must never destroy the last known-good runtime.

**How to apply:** Add imports to the library instead of replacing prior entries; activate through the existing health-checked transactional settings path; when removing the active entry, activate the safe fallback before deleting its file; enforce both per-file and aggregate storage limits.

Packaged multi-model smoke coverage may use a structure-valid synthetic secondary GGUF with the CI-only loopback runtime, because the library contract is the target of that path; keep the default single-model smoke path for real llama.cpp execution. Local NixOS real-runtime checks need glibc, GCC, OpenSSL, and OpenMP library directories in `LD_LIBRARY_PATH`.

**Why:** A second downloadable runnable model is unnecessarily large for a packaged library smoke, while omitting the real-runtime path would weaken native coverage; NixOS does not expose all packaged-binary dependencies through the default loader path.

**How to apply:** Gate the synthetic two-entry journey behind the multi-model smoke flag and retain the normal real-runtime journey when it is absent; when reproducing native runtime checks locally, include the directories reported by `ldd` for every unresolved library family.