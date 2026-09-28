---
name: Expo native dependency pinning
description: Compatibility rule for adding native Expo modules to the mobile artifact.
---

Native Expo modules must use the version expected by the installed Expo SDK, rather than the newest package version or a broad major range.

**Why:** Expo compatibility checks can flag a dependency that installs successfully but targets a different SDK major, leaving Metro apparently healthy while the native app fails at runtime or during release builds.

**How to apply:** After adding or changing an Expo native package, run `expo install --check` (or `expo install <package>`), then run the mobile release preflight and restart the Expo workflow once.

The workspace-wide React type pins must stay compatible with Expo's expected React type range, not just the mobile package's local pin.

**Why:** Two `@types/react` peer versions caused pnpm to create distinct virtual-store installations of Expo and its native modules even though their package versions matched. Expo Doctor correctly reported duplicate native modules.

**How to apply:** When changing React typings or the Expo SDK, align the workspace catalog and mobile package ranges, regenerate the lockfile, then run Expo Doctor and inspect duplicate-native-module findings. Do not silence the check.

Run the full mobile unit suite and the release preflight serially when verifying a release-related dependency change manually; the automatic completion gate may still run them concurrently.

**Why:** The preflight launches browser-heavy regressions; running it beside Vitest can make the account-isolation test exceed its default time limit despite passing when run alone.

**How to apply:** A timeout during concurrent verification is not evidence that the native dependency change broke account isolation. Finish preflight, then run the mobile test suite without competing browser workloads. Tests that must survive automatic parallel verification need an explicit realistic per-test time limit rather than relying on Vitest's short default.