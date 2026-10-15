---
name: Desktop packaged updater smoke
description: Constraints for exercising packaged Electron updater wiring without a production release.
---

The packaged updater smoke should use a CI-only updater fixture that emits the same updater events as the production flow, while invoking the real desktop bridge and lifecycle install path. The updater bridge is exposed on the Settings window rather than the dashboard; use the dashboard loopback origin separately for server-health assertions.

**Why:** the release check must prove status propagation, deferred restart behavior, and server shutdown ordering without depending on a published update. Treating the fixture, bridge target, and health target as interchangeable causes false failures or skips the actual IPC path.

**How to apply:** classify failures as feed setup, download handling, or shutdown ordering; record bounded phase markers and require `server-stopped` before `quit-and-install`. Keep the seam disabled unless the app is packaged and running in the CI smoke environment.

For a real disposable Linux feed, route metadata by URL pathname because
electron-updater adds a `noCache` query, and provide a disposable `APPIMAGE`
path even when testing full downloads. Disable differential downloading for the
fixture and suppress install-on-quit so the fake artifact cannot replace or
execute the smoke binary.

**Why:** `AppImageUpdater` requires `APPIMAGE` before it downloads, and its
provider requests cache-busted metadata URLs. A fake downloaded AppImage must
prove the download event without entering the install path.

**How to apply:** keep the generic feed override loopback-only and CI-gated;
record bounded request diagnostics and clean the feed server plus the temporary
user-data directory in separate cleanup phases.