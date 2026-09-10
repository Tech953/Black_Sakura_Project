---
name: Chromium CDP browser tests
description: Run local web UI regressions without adding Playwright when the workspace already provides Chromium.
---

The workspace's Chromium can be driven directly through Node's built-in WebSocket and the Chrome DevTools Protocol. Connect to the page target from `/json/list`, not the browser target from `/json/version`; use pointerdown/mousedown events for Radix menus, and wait for DOM state before assertions.

**Why:** There is no browser-test dependency in the web artifact, while real UI checks still need a browser. A local fixture can mock API responses and use a DEV-only auth state without creating Clerk users or handling credentials.

**How to apply:** Keep the fixture guarded by `import.meta.env.DEV`, run it against an isolated Vite port, set page-level download behavior, and always terminate Chromium before removing temporary profiles. Expo Router web tab labels may have visible text without `aria-label`; scope row actions by their visible row text rather than assuming accessibility attributes exist.

For Expo mobile export coverage, the browser path cannot use `expo-file-system` native writes. Route web exports through the existing `Share` fallback and reserve native file generation checks for an Android/iOS device or native test harness.

**Why:** The browser regression must exercise the real UI without pretending native file APIs exist on web, and broad accessibility-label selectors can mutate the wrong history row when several conversations are visible.