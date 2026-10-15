---
name: CDP Radix switch limitation
description: A Chromium CDP limitation observed while testing controlled Radix switches in the ENGRAM DEV auth fixture.
---

Controlled Radix switches can deadlock Chromium CDP input dispatch when their React mutation handler runs under the local DEV auth fixture. The page can render normally and other controls remain testable, but synthetic click and mouse events may never return.

**Why:** The browser regression harness must not become a permanently hanging release check because of a tooling-specific event-dispatch failure.

**How to apply:** Assert the switch's rendered checked state in the browser, then exercise and verify the same PATCH contract from the browser page when direct switch input is unavailable. Revisit with a fresh browser/auth harness before treating this as an application bug.