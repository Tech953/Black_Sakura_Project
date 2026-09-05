---
name: Mobile crash recovery
description: Reliability and privacy invariants for device-local release crash diagnostics.
---

# Mobile crash recovery

**Rule:** fatal JavaScript and React-boundary failures leave a bounded device-local report for the next launch. Wrap and forward the existing React Native global handler exactly once; do not replace or bypass it. A launch breadcrumb is written only after JavaScript reaches the root layout and removed only after the normal UI remains rendered, so an unfinished marker is a useful startup-stage signal rather than permanent crash state.

**Why:** release builds have no developer console, and calling the platform handler before AsyncStorage flushes loses the only actionable stack. Leaving the launch marker forever, failing to clear reports after Continue, or recording nonfatal errors creates recovery loops and overwrites the evidence users need.

**How to apply:** keep reports on-device unless a separate, explicit consent flow is added. Bound message/stack sizes, tolerate malformed storage, keep the recovery screen independent of server readiness, and ensure new startup gates update or preserve the breadcrumb. Pure native failures before JavaScript begins require separate native tombstone handling.