---
name: Desktop release draft ownership
description: Concurrency and trigger rules that prevent failed tag retries from deleting a newer draft release.
---

`prepare-draft` creates one draft per workflow attempt and stores a hidden owner marker in its body. electron-builder still selects drafts by tag and ignores the marker, so preparation must fail closed when a same-tag draft belongs to another attempt or is ambiguous. Cleanup filters by tag plus marker and rechecks ownership before deletion.

**Why:** electron-builder uploads to the first draft matching the tag, while stale cleanup must never delete another attempt's release. The marker protects cleanup and the preflight collision check prevents matrix jobs from uploading into a foreign draft.

**How to apply:** keep tag concurrency `cancel-in-progress` false; run workflow guard validation before draft preparation; require `github.event_name == 'push' && github.ref_type == 'tag'` for release-only actions; keep manual dispatches artifact-only even when the selected ref is a tag.

The workflow guard CI pins actionlint to v1.7.7 until the legacy `macos-13` runner labels are migrated.

**Why:** actionlint v1.7.12 reports `macos-13` as an unknown runner label in both desktop matrices, even though the current release configuration still uses it.

**How to apply:** upgrade actionlint together with the runner-label migration rather than suppressing or overlooking the diagnostic.

Cleanup observability belongs in the workflow step summary via the runner-provided `$GITHUB_STEP_SUMMARY` shell variable, not an `env` expression lookup.

**Why:** The summary path is injected as a default runner environment variable; resolving it through the workflow `env` context can produce an empty path and hide the audit result.

**How to apply:** write only tag, counts, release IDs, and outcome text to the summary; keep API credentials exclusively in the step environment used by `gh`.