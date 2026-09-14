---
name: Desktop packaged updater smoke
description: Constraints for exercising packaged Electron updater wiring without a production release.
---

The packaged updater smoke should use a CI-only updater fixture that emits the same updater events as the production flow, while invoking the real desktop bridge and lifecycle install path. The updater bridge is exposed on the Settings window rather than the dashboard; use the dashboard loopback origin separately for server-health assertions.

**Why:** the release check must prove status propagation, deferred restart behavior, and server shutdown ordering without depending on a published update. Treating the fixture, bridge target, and health target as interchangeable causes false failures or skips the actual IPC path.

**How to apply:** classify failures as feed setup, download handling, or shutdown ordering; record bounded phase markers and require `server-stopped` before `quit-and-install`. Keep the seam disabled unless the app is packaged and running in the CI smoke environment.