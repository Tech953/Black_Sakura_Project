---
name: Desktop pre-release smoke
description: CI separation between fast Linux launch checks for code changes and the full native release matrix.
---

The desktop workflow should run the packaged Linux launch smoke on relevant branch pushes and pull requests, while reserving the three-OS installer matrix, Android build, and release publishing for tags or explicit manual runs.

**Why:** packaging-only regressions can land on the main branch long before a release tag exercises the real embedded server and staged resources.

**How to apply:** keep the pre-release job path-filtered and publish-disabled; reuse API/web/resource staging and the real packaged Electron smoke rather than substituting a unit test or unbundled server launch.