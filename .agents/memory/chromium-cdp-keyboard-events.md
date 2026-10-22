---
name: Chromium CDP keyboard activation
description: CDP key dispatch did not synthesize implicit native button clicks in the workspace browser harness.
---

When a browser regression needs to activate a native button, do not treat `Input.dispatchKeyEvent` as proof that Enter triggered the button. Verify the control is a native button and use the existing pointer event helper unless a real keyboard driver is available.

**Why:** Both `keyDown` and `rawKeyDown` sequences focused the button but did not produce the browser's implicit click in this Chromium/CDP setup, leaving the UI unchanged.

**How to apply:** Keep keyboard accessibility protected by native-element/type assertions or a browser runner that exercises real key input; use CDP pointer/mouse events for deterministic interaction coverage.