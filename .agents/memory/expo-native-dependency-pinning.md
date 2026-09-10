---
name: Expo native dependency pinning
description: Compatibility rule for adding native Expo modules to the mobile artifact.
---

Native Expo modules must use the version expected by the installed Expo SDK, rather than the newest package version or a broad major range.

**Why:** Expo compatibility checks can flag a dependency that installs successfully but targets a different SDK major, leaving Metro apparently healthy while the native app fails at runtime or during release builds.

**How to apply:** After adding or changing an Expo native package, run `expo install --check` (or `expo install <package>`), then run the mobile release preflight and restart the Expo workflow once.