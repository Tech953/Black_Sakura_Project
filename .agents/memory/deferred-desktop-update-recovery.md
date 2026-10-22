---
name: Deferred desktop updater recovery
description: Persistence and privacy rules for deferred desktop update install failures
---

Deferred desktop install failures must survive process restarts as a generic, retryable updater status. Persist only a marker that rehydrates to fixed recovery-safe copy; never persist or render provider exceptions, filesystem paths, or stack traces. Clear the marker when a user starts a manual retry or a later update reaches a successful terminal state, while preserving it across silent feed-check failures.

**Why:** The updater can fail during the quit/install handoff after the Settings window is gone, so in-memory status alone loses the only actionable explanation on the next launch.

**How to apply:** Keep retry and release-page actions behind narrow main-process IPC. The retry should reuse the existing manual check flow, and the release action should open a fixed validated repository URL from the main process.