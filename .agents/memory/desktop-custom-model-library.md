---
name: Desktop custom model library
description: Durable rules for managing multiple imported GGUF models in the desktop app
---

The desktop custom-model library keeps content-addressed GGUF files by SHA-256 and stores a display name plus last-used timestamp for each entry. The legacy single custom setting remains the selected-model compatibility field and is migrated into the library.

**Why:** Users need to switch models without re-importing, while failed activation and active-model removal must never destroy the last known-good runtime.

**How to apply:** Add imports to the library instead of replacing prior entries; activate through the existing health-checked transactional settings path; when removing the active entry, activate the safe fallback before deleting its file; enforce both per-file and aggregate storage limits.