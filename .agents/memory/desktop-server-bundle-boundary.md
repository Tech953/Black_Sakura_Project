---
name: Desktop server bundle boundary
description: Runtime dependency rule for the standalone API bundle shipped inside the Electron desktop app.
---

The desktop API child is shipped with a deliberately small runtime directory: PGlite is externalized and copied explicitly, while ordinary server dependencies must be bundled into the API artifact. In particular, do not externalize Google Cloud packages unless the desktop resource staging also ships their complete dependency tree.

**Why:** The desktop health check runs before any window opens. A missing external package makes the child exit immediately, but the Electron UI only sees the later generic “embedded server did not become healthy” timeout.

**How to apply:** When changing the API bundler’s external list, run the built server from `artifacts/desktop/resources/server` with PGlite and migration paths pointed at the staged resources, then request `/api/healthz` before trusting the desktop package.

The Electron launcher should also race the health check against the child process's `error`/early `exit` events and include bounded stderr in the startup error.

**Why:** A missing runtime import otherwise looks like a generic 60-second health timeout, hiding the actual package-boundary failure from both users and release debugging.

**How to apply:** Keep the server child startup transactional: fail immediately on pre-health exit, clean up the child, and preserve enough recent stderr to diagnose a packaged-resource problem.