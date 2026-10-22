---
name: Desktop pre-release smoke
description: CI separation between fast Linux launch checks for code changes and the full native release matrix.
---

The desktop workflow should run the packaged Linux launch smoke on relevant branch pushes and pull requests, while reserving the three-OS installer matrix, Android build, and release publishing for tags or explicit manual runs.

**Why:** packaging-only regressions can land on the main branch long before a release tag exercises the real embedded server and staged resources.

**How to apply:** keep the pre-release job path-filtered and publish-disabled; reuse API/web/resource staging and the real packaged Electron smoke rather than substituting a unit test or unbundled server launch.

Native macOS release coverage must use explicit Intel and Apple Silicon runner labels, not only cross-architecture `otool` inspection; the packaged app and llama.cpp executable both need architecture assertions before launch.

**Why:** A Mach-O archive can pass dependency inspection for a target that was never executed, leaving packaging, signing, or native model startup failures until users install the release.

**How to apply:** Build and smoke the x64 package on macOS Intel and the arm64 package on Apple Silicon, run the real local-GGUF request only on those native jobs, and retain stage-specific diagnostics for packaging, signing, dylib loading, and model startup.