---
name: Locale generation fallback
description: What to do when the AI-backed locale generator cannot authenticate or complete.
---

When the translation service is unavailable, keep every generated locale structurally identical to the English authoring tree by adding English fallback values for new keys. Do not leave generated locales partially updated or remove the new strings from the English source.

**Why:** The locale-key check is part of the project validation path, and a service outage should not block a feature or create runtime missing-key behavior.

**How to apply:** Run the generator first. If it fails before writing a locale, update each generated locale's new key set with English fallbacks, run the locale-key check, and retranslate only those namespaces once the service is healthy.