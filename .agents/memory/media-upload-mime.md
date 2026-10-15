---
name: Media upload MIME handling
description: Safe normalization rules for browser and native picker upload headers
---

Infer a media MIME type from the filename only when the client reports an empty or generic `application/octet-stream` value and the extension is unambiguous. Canonicalize known aliases and strip parameters; preserve specific unsupported types so the server can reject them clearly.

**Why:** Browser and native document pickers disagree on aliases and generic headers, but guessing from every conflicting header would let a mislabeled file bypass byte validation.

**How to apply:** Keep the client normalizer and server canonicalizer aligned when adding an allowed media format, and cover browser plus native picker examples in tests.