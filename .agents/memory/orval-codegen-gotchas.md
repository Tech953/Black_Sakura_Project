---
name: Orval codegen gotchas
description: Non-obvious constraints when using the OpenAPI→Orval React Query hooks/Zod codegen in this repo.
---

# Orval / api-spec codegen gotchas

**Avoid OpenAPI query parameters on operations.** Adding `parameters: [{in: query}]` makes Orval emit a `...Params` type whose name can collide with the path-params `...Params` type for the same operation, producing duplicate-identifier build breaks. Model optional filters as part of the request body or as separate paths instead.
**Why:** bit during the engram routes work; collisions are silent until the generated barrel fails to typecheck.

**Generated `useQuery` hooks require an explicit `queryKey` when you pass a `query` options object.** The generated `UseQueryOptions` type marks `queryKey` as required, so `{ query: { enabled, refetchInterval } }` fails TS2741. Supply the generated helper: `{ query: { enabled, refetchInterval, queryKey: getListXQueryKey(id ?? 0) } }`. The `get...QueryKey` helpers are exported from the same generated module.
**How to apply:** any time you customize a generated list/get hook's query options (enabled gating, polling), import and pass the matching `get...QueryKey(...)`.

**After editing `lib/api-spec/openapi.yaml`** run `pnpm --filter @workspace/api-spec run codegen`; do not hand-edit generated files. Do not change OpenAPI `info.title` — it controls generated filenames.

**Do not model multipart file bodies through this repo's shared OpenAPI-to-Zod server validator.** Document the upload endpoint, parse the multipart body at the route boundary, and use direct `FormData` from browser clients; keep non-file confirmation requests generated and validated normally.
**Why:** multipart `File`/`Blob` schemas make the shared Node package emit browser-global types or runtime references, breaking typechecks or startup even though the browser client itself supports them.
**How to apply:** for a new file-upload endpoint, follow the existing media/CSV upload pattern and omit only the multipart request-body schema from generated validation.
