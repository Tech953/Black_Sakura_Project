---
name: Desktop auto-update (electron-updater)
description: How the Electron desktop app self-updates, and the non-obvious constraints that make it actually fire.
---

The desktop app (`artifacts/desktop`) self-updates via `electron-updater`, wired in `main.ts`.

Rule: auto-update only fires in the **packaged** app (`app.isPackaged`) and only when the published release version is **strictly newer** than the installed one.

**Why:** electron-updater compares the running `app.getVersion()` (from the asar package.json) against the version in the release feed's `*-latest*.yml`. If the version isn't bumped per release, installed apps never see an update even though CI published one.

**How to apply:**
- The version source of truth is `artifacts/desktop/package.json` `version`. CI (`.github/workflows/desktop-build.yml`) overwrites it from the pushed git tag (`v1.2.3` → `1.2.3`) before packaging. So every release needs a NEW tag — re-tagging the same version is a no-op for updates.
- `electron-builder.yml` has `publish: provider: github` (owner/repo auto-detected from the git remote at package time), which makes electron-builder bake `app-update.yml` (the feed pointer) into the app and lets `--publish always` upload installers + `*-latest*.yml` manifests to the tag's GitHub Release.
- CI needs `permissions: contents: write` for the default `GITHUB_TOKEN` to create/upload the release.
- electron-updater is bundled into `main.cjs` by esbuild (it's a `dependencies` entry but NOT shipped via node_modules). This is fine because the `files` allowlist (`dist/**` + `package.json`) deliberately keeps node_modules out of the asar; the bundle carries it. Don't "fix" this by adding node_modules to `files`.
- On the install path: the embedded api-server child must be stopped before `quitAndInstall()` swaps app files (it holds the PGlite DB open — a mid-swap write can corrupt it). The DB-safe ordering + the shared SIGTERM→SIGKILL shutdown live in the electron-free `src/lifecycle.ts` (`stopProcess`, `installDownloadedUpdate`) so they're unit-testable without an Electron runtime (`src/lifecycle.test.ts`). main.ts's `stopServer` and the update-downloaded handler are thin wrappers over them; normal quit and the update path go through the *same* stop logic. "Later" defers to `autoInstallOnAppQuit` on the next normal quit.

Rule: separate macOS x64 and arm64 electron-builder jobs publish the same `latest-mac.yml` name; GitHubPublisher deletes and replaces a duplicate asset rather than merging its architecture entries.

**Why:** A completed architecture build can leave a valid-looking release with only its own updater archive in the shared manifest, so the other architecture cannot update from that feed.

**How to apply:** Aggregate the per-architecture manifest files or generate one combined manifest before publication, and keep the release gate requiring both `-x64.zip` and `-arm64.zip` entries.

The renderer's update surface should subscribe to the context-isolated status channel and also hydrate from `app:info`, because a download may already be in progress before the renderer listener is attached. Silent startup checks should remain quiet; only manual "up to date" results need a positive notice.

**Why:** Electron event delivery is live-only, while the main process owns the authoritative status. Showing every startup `not-available` result would also turn a silent background check into a recurring notification.

**How to apply:** broadcast status to every live renderer window, preserve a manual-check marker for checking/not-available states, and keep packaged-only behavior a no-op in development.

Rule: a renderer "Restart now" action must use a narrow main-process command, never a renderer-side Electron API. The main process should share and deduplicate that install operation with the native update prompt.

**Why:** The existing lifecycle-safe installer is responsible for stopping the embedded server before files are swapped; concurrent native and in-app actions must not run that shutdown twice.

**How to apply:** expose only a typed bridge method, validate the ready-update state in main, and keep "Later" as a presentation dismissal that leaves normal-quit installation enabled.

For the transient renderer notice, do not auto-focus the banner. Capture the focused dashboard element when the notice first appears, expose progress through a clamped progressbar, announce meaningful non-progress states, and restore focus after keyboard or button dismissal.

**Why:** Moving focus to a transient update message interrupts dashboard work, while a live region around every download tick creates repetitive announcements. Users need a predictable way back to the control they were using.

**How to apply:** keep silent background states out of the DOM, use manual-status flags to decide which notices render, make Escape and native buttons dismiss the notice, and preserve a separate polite/assertive announcement node from the progressbar.

In standalone Settings, download size and speed belong in a separate, non-live description of the progressbar, not in its label or a live region. Keep the details node outside the progressbar, reference it with `aria-describedby`, and do not add a tab stop.

**Why:** Transfer values can change on every download tick. A live region would repeat the same kind of announcement rapidly; a non-live description still exposes the latest values when assistive-technology users inspect the progressbar without changing keyboard focus order.

**How to apply:** Keep the progressbar's accessible name focused on percentage progress, update the localized size/speed description as values change, and preserve the sibling relationship because progressbar descendants are presentational.

Only show transfer metadata when transferred and total are nonnegative safe integers, total is positive, transferred does not exceed total, and bytes-per-second is finite, nonnegative, and no greater than `Number.MAX_SAFE_INTEGER`. Otherwise hide only the metadata and preserve percentage progress; do not coerce malformed values into plausible numbers.

**Why:** NaN, infinities, precision-losing magnitudes, negative values, and transferred counts beyond the total can render as convincing but false status text. A transfer rate may legitimately be fractional, unlike byte counts.

**How to apply:** Validate the renderer-facing stats before formatting them, allow zero transferred bytes, zero speed, and fractional speed when total is positive, and keep the percentage bar visible for downloading states with rejected details.

Treat update-status IPC payloads as runtime-untrusted even though the bridge exposes a typed callback. Missing or malformed status shapes should use localized fallback copy and clear stale progress; validate fields before formatting or branching, without expanding the bridge API.

**Why:** TypeScript assertions do not validate IPC data at runtime, so a malformed main-process event can otherwise throw or leave misleading download UI behind.

**How to apply:** Keep payload validation at the Settings renderer boundary, preserve the allowlisted bridge contract, and never coerce unexpected field types into plausible update values.
