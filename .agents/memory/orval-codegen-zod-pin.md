---
name: Orval and Zod generation pin
description: Keep generated API validation compatible with the workspace's Zod 3 runtime.
---

Orval 8.18.0 is the compatible generator for this workspace's Zod 3 setup. Newer Orval output can emit `zod.int()`, which is a Zod 4 API and causes the generated library to fail typechecking.

**Why:** The API schemas and generated client are shared by the server, web, and desktop paths; upgrading only the generator silently changes every integer validator and breaks all consumers.

**How to apply:** Keep `lib/api-spec` on the compatible Orval pin when regenerating API bindings, and run the library typecheck immediately after code generation.