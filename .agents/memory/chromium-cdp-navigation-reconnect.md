---
name: Chromium CDP navigation reconnect
description: A Chromium CDP browser regression harness must recover its Runtime session after page reloads.
---

Page reloads can invalidate the current CDP target socket while the page target itself remains available. A subsequent Runtime.evaluate may fail with `Inspected target navigated or closed`; reconnect to the current page target and retry the evaluation before treating the browser regression as an app failure.

**Why:** The group-chat browser regression encountered this Chromium behavior during its existing reload-based persistence checks; the application was healthy and the next target was still discoverable.

**How to apply:** In CDP harnesses that call `Page.reload`, make Runtime evaluation recover once by closing the stale socket, reconnecting to the page target, and retrying the same expression.