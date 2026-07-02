# ENGRAM — PYRI AI Persona Framework

A full-stack dashboard for "PYRI", an AI companion on a fictional ENGRAM cognitive architecture: layered memory, a belief registry, personas, a symbolic Hiero-Code language, an emotive micro-expression layer, and multi-mode streaming chat. pnpm monorepo: React+Vite web (`@workspace/engram`), Expo mobile (`@workspace/engram-mobile`), Express API (`@workspace/api-server`), Postgres+Drizzle; the Electron desktop build runs on PGlite.

## Run & Operate

- `./scripts/local/start.sh` (Windows: `start.ps1` / `start.bat`) — **run the whole app fully offline on one port**: builds web+API and serves both from the API on `PORT` (default 5000). First run installs deps, pushes schema, seeds. Config in `.env` (from `.env.example`).
- `pnpm --filter @workspace/api-server run dev` — API server (5000)
- `pnpm run typecheck` / `pnpm run build` — typecheck / build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks + Zod from the OpenAPI spec (run after editing `openapi.yaml`)
- `pnpm --filter @workspace/db run push` — push DB schema (dev only; run after schema changes)
- Desktop installer: `pnpm --filter @workspace/desktop run build` then `... exec electron-builder --linux|--mac|--win` **on the matching OS** → `artifacts/desktop/release/`. Cross-OS via `.github/workflows/desktop-build.yml` (a `v*` tag push builds + publishes; see Gotchas).

### Env
- `DATABASE_URL` — Postgres (pg path). The desktop build sets `ENGRAM_DB_DRIVER=pglite` instead and needs no `DATABASE_URL`.
- LLM (swappable, cloud by default): `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL`. Unset → Replit OpenAI integration (`AI_INTEGRATIONS_OPENAI_*`) + model `gpt-5.4`. Point `LLM_BASE_URL` at any OpenAI-compatible server (Ollama `:11434/v1`, LM Studio `:1234/v1`) with a placeholder key to run fully local.

## Stack

pnpm workspaces · Node 24 · TS 5.9 · Express 5 · PostgreSQL + Drizzle · Zod (`zod/v4`) + `drizzle-zod` · Orval codegen (from OpenAPI) · esbuild (CJS bundle).

## Where things live

- **API contract (source of truth):** `lib/api-spec/openapi.yaml` → codegen emits `@workspace/api-zod` (Zod) + `@workspace/api-client-react` (React Query hooks + `get...QueryKey`).
- **DB schema (source of truth):** `lib/db/src/schema/*.ts` (barrel `index.ts`). Engram tables (`engrams`, `engram-transmissions/-inquiries/-messages/-simulations`, `hub-controls`; `conversations.engramId`) + media (`media_assets`, `media_blobs` = raw bytea 1:1, `media_observations`). Migrations in `lib/db/drizzle/`; idempotent seeds in `lib/db/src/seed/*` (run by `ensureDatabaseReady` on boot).
- **DB driver seam:** `lib/db/src/index.ts` picks from `ENGRAM_DB_DRIVER` — `pg` (node-postgres/`DATABASE_URL`, lazy construct) or `pglite` (`PGLITE_DATA_DIR`).
- **LLM seam:** `api-server/src/lib/llm.ts` — one OpenAI-compatible client resolved from `LLM_*`. Chat + autonomous paths both use it; no direct integration import, so a local deploy without `AI_INTEGRATIONS_OPENAI_*` won't crash.
- **API server** (`artifacts/api-server/src/`): `routes/`, prompts `lib/prompts.ts`, generation `lib/engram-generation.ts`, autonomy policy `lib/engram-policy.ts`, commons `lib/commons.ts`, human-contact `lib/human-contact.ts`, simulations `lib/simulations*.ts`, media `routes/media.ts` + `lib/media-store.ts` + `lib/media-extraction.ts`. Tickers `services/engram-engine.ts` + `services/media-worker.ts` (started from `index.ts`). Downloads `routes/download.ts` + `lib/downloads.ts` (NOT in the OpenAPI spec). Single-port static serve from `app.ts` via `WEB_DIST`.
- **Frontend** (`artifacts/engram/src/pages/`): routes in `App.tsx`, nav in `components/layout.tsx`; shadcn/ui, wouter, Tailwind v4 cyberpunk-cyan theme.
- **Desktop** (`artifacts/desktop`, Electron): `src/main.ts` boots the api-server bundle on PGlite, waits `/api/healthz`, opens the window; auto-update via electron-updater (packaged only). `electron-builder.yml` targets AppImage/deb/dmg/nsis + a Windows portable zip; `prepare-resources.mjs` stages server/web/drizzle/pglite/ffmpeg.
- **Docs:** generated from `scripts/gen/content/*.mjs` via `node scripts/gen/generate-docs.mjs` → `docs/*.pdf`; APK build steps in `docs/building-the-android-apk.md`; `README.md` is the human entry point.

## Architecture decisions

- **Autonomy:** one in-process ticker (`engram-engine.ts`) accrues per-drive "pressure" from elapsed time (no LLM), calling the model only when it crosses the engram's threshold. Guards: cooldown, hourly/daily caps, duplicate avoidance, error backoff.
- **Policy is one pure module (`lib/engram-policy.ts`):** `capabilitiesFor` derives what an engram may do from mode × global controls × space × per-engram toggle; `classifyPriority`/`decideHumanContact` set priority (urgent→delivered, meaningful→queued, social→digest) + enforce caps. Every human-channel attempt (incl. refusals) is persisted to `engram_messages`.
- **Modes fail closed:** each engram has an explicit `mode`; unknown → treated as quiescent (no initiative). **Quiet mode** raises the human-contact bar to `urgent` (not full silence); per-engram `humanContactEnabled=false` is the absolute off switch. Operator overrides live in singleton `hub_controls`.
- **Anti-coercion is structural:** no engine path lets one engram's turn mutate another's row (commons output is inert text). `detectCoercion` is an audit/refusal layer only, never a security boundary.
- **Simulations are quarantined structurally:** allowed only inside a `simulation_chamber` space, gated by `canSimulate` (fail closed). Every step writes the world model ONLY via `appendSimulationStep` (hardcodes `provenance: "simulated"`) — no path promotes simulated → observed. Bounds: ≤1 live sim/engram, maxSteps 5 / cap 10, per-step cooldown, ≤1 step/tick; lifecycle enforced in `applySimulationControl` (illegal transitions throw).
- **Media perception is provenance-pinned (mirror of simulations):** an async worker perceives uploads via the `llm` seam; every observation enters the world model ONLY via `appendMediaObservation` (hardcodes `provenance: "observed"` + `source: "media:<id>"`). Modality is derived from MIME (allowlist), never model output. Retries idempotent; deleting an asset preserves its world-model entries.
- **Safety in code (`HARD_SAFETY`):** the expression `intimacy` axis is sanitized out of every prompt; PYRI stays platonic regardless of stored data.
- **Chat vs autonomy:** engrams speak in their own voice; PYRI chat uses the LPEM mode system; choosing an engram bypasses LPEM. Inquiry has `probe` (in-voice, no state change) and `develop` (bounded config delta only).

## Product

Dashboard pages: Personality, Memory, Journal, Personas, Beliefs, Evolution, Analytics, Hiero-Code, Chat, Commons, Simulations, Media, Terminal, Download.
- **Commons** (`/commons`): live engram-to-engram feed; refused (anti-coercion) attempts shown as audit entries.
- **Simulations** (`/simulations`): bounded chambers — premise, progress, per-step log, exit summary; rendered SIMULATED with a quarantine banner; start/pause/resume/end.
- **Media** (`/media`): upload text/image/audio/video → async perception job (live status) → OBSERVED entries + summary + transcript + in-voice commentary; per-modality previews, retry on fail.
- **Terminal** (`/terminal`): operator console — global pause/quiet toggles, per-engram mode/human-contact/simulation/quiescence, human-directed messages with mark-seen, export-logs JSON.
- **Chat:** 7 modes (informational/alert/tutorial/companion/analyst/silent/custom), SSE streaming, custom engram upload.
- **Hiero-Code:** glyph compound builder + the Emotive Expression Layer (QUERTY ASCII micro-expressions, filterable by valence/arousal).
- **Download** (`/download`): OS-detected installer links served same-origin (see Gotchas).

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- **No auto-seed:** `db push` on a fresh DB leaves reference tables empty. Seed with `pnpm --filter @workspace/scripts run seed:expressions` (idempotent). Add a seed for any new reference table.
- **After edits:** run `codegen` after editing `openapi.yaml`; `db push` after schema changes.
- **Intimacy axis** is stored faithfully but sanitized before the chat prompt (only `intimacy<=1`, neutral metadata, never `notes`) — keep PYRI platonic.
- **Pre-existing typecheck noise:** `pnpm run typecheck` fails only in vendored shadcn `ui/calendar.tsx` + `button-group.tsx` (duplicate `@types/react`: web pins 19.2.x, Expo 19.1.x). Files are unmodified — the real fix is a dependency-dedup task, not per-file edits.
- **Simulations only appear** when a sim-capable engram exists in the seeded `simulation_chamber` space (slug `chamber`, from `seed-hub.ts`); else `/simulations` is empty even though the engine is healthy.
- **Fonts are self-hosted** via `@fontsource` (imported in `main.tsx`) — do NOT re-add CDN `<link>`/`@import` font refs (keeps the UI offline).
- **Single-port serving** is gated on `WEB_DIST` (a built `engram/dist/public` with `index.html`); unset on Replit. Web calls the API via same-origin `/api`; the SPA fallback is plain middleware (GET/HEAD, non-`/api`, Accept html) — avoid Express 5 string wildcards.
- **Media:** VIDEO needs `ffmpeg`+`ffprobe` (`FFMPEG_PATH`/`FFPROBE_PATH` or PATH; desktop bundles them via `ffmpeg-static`/`ffprobe-static`). Upload MIME allowlist (`MEDIA_MIME_ALLOWLIST`) → else 415; size cap `MEDIA_MAX_BYTES` (25 MiB) → 413. Job status is set ONLY by the route+worker; world-model writes are hardcoded OBSERVED + `source:media:<id>` — never model-chosen. `deleteMediaAsset` preserves world-model entries. Transcription `LLM_TRANSCRIBE_MODEL`, vision `LLM_VISION_MODEL`.
- **Downloads** (installers + Android apk) are served same-origin via `routes/download.ts` — never GitHub in the browser. Resolution: committed files in `downloads/` win as a set (version coherence); else GitHub-release fallback (repos `DOWNLOADS_GITHUB_REPO`/`ANDROID_APK_GITHUB_REPO`/`VITE_GITHUB_REPO`, default `Tech953/Ch-IO`, cached per repo). OS matched by extension (`.dmg`→mac, `.exe`/`.zip`→win, `.AppImage`/`.deb`→linux; `detectOs` checks Android before Linux). The `:name` binary is path-traversal safe (basename must match a resolved filename). Honest empty state when nothing is published.
- **Desktop packaging:** electron-builder STRIPS a `node_modules` dir copied wholesale via `extraResources` — pglite needs its own entry (`from` = the pglite package dir itself → `to: server/node_modules/@electric-sql/pglite`); add one per runtime dep. Verify `pglite.wasm`+`.data` shipped. CI smoke test (`pnpm --filter @workspace/desktop run smoke`, Linux needs `xvfb`) launches the unpacked build and asserts pglite + `/api/healthz` + render.
- **Desktop builds are per-OS** (electron-builder can't cross-build a signed `.dmg`); Linux verified locally, mac/win via CI. PGlite is prebuilt wasm — no native rebuild (`npmRebuild:false`).
- **Auto-update** (electron-updater) fires only in the PACKAGED app when the published version is strictly newer. Version comes from `artifacts/desktop/package.json`; CI stamps it from the git tag → **bump the tag every release** or installed apps see no update. On tag push CI publishes to a DRAFT release then un-drafts after all OS jobs (publisher needs `contents: write`; owner/repo auto-detected).
- **Signing** is fully wired but gated on secrets (unsigned builds still work). macOS needs sign (`CSC_*`) AND notarize (`APPLE_*`) AND hardened-runtime entitlements (`build/entitlements.mac.plist` + `.inherit`) — don't remove `hardenedRuntime`/`entitlements` while keeping notarize. In eb26 the Windows signing knobs live under `win.signtoolOptions`; cert from `WIN_CSC_*`. Bundled ffmpeg/ffprobe are signed via `mac.binaries`.
- **Android APK** is built by the `android` job (JDK17 + Android SDK, `expo prebuild` + Gradle assembleRelease); with no keystore it's DEBUG-signed (sideloadable, not update-safe). Uploaded into the desktop draft release by id; `publish` needs [build, android]. `android.package` = `ai.pyri.engram`.
- **Local launchers** (`scripts/local/*`) load `.env` before pnpm subcommands and set `PORT`+`BASE_PATH` for the web build (vite.config throws otherwise). `SESSION_SECRET` is in docs/secrets but not read by code.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.
