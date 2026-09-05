---
name: Desktop server bundle boundary
description: Runtime dependency rule for the standalone API bundle shipped inside the Electron desktop app.
---

The desktop API child is shipped with a deliberately small runtime directory: PGlite is externalized and copied explicitly, while ordinary server dependencies must be bundled into the API artifact. In particular, do not externalize Google Cloud packages unless the desktop resource staging also ships their complete dependency tree.

**Why:** The desktop health check runs before any window opens. A missing external package makes the child exit immediately, but the Electron UI only sees the later generic “embedded server did not become healthy” timeout.

**How to apply:** When changing the API bundler’s external list, run the built server from `artifacts/desktop/resources/server` with PGlite and migration paths pointed at the staged resources, then request `/api/healthz` before trusting the desktop package.