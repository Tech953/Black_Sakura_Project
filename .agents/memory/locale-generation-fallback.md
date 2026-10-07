---
name: Locale generation fallback
description: What to do when the AI-backed locale generator cannot authenticate or complete.
---

When the translation service is unavailable, keep every generated locale structurally identical to the English authoring tree by adding English fallback values for new keys. Do not leave generated locales partially updated or remove the new strings from the English source.

**Why:** The locale-key check is part of the project validation path, and a service outage should not block a feature or create runtime missing-key behavior.

**How to apply:** Run the generator first. If it fails before writing a locale, update each generated locale's new key set with English fallbacks, run the locale-key check, and retranslate only those namespaces once the service is healthy.

**Operational note:** A 405 from `models.list()` may mean the provider does not implement model listing; it is not itself proof that chat completions are unavailable. Continue with a scoped chat-completion request. A 401 from the chat request is an actual authentication/configuration failure; the generator writes a locale only after completing its namespace pass, so the failed locale remains unchanged.

**Why:** Model-list preflight is optional for an OpenAI-compatible chat endpoint, while a rejected chat request cannot generate translations. Repeating an unchanged 401 request does not improve output; the English fallback path keeps runtime key trees complete.

**How to apply:** After a model-list 405, try one scoped chat translation. If chat returns 401, stop generation, confirm exact key parity, preserve English fallbacks unless the task requires completed translations through another available route, and retry once the provider is healthy.