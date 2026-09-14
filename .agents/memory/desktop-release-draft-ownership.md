---
name: Desktop release draft ownership
description: Concurrency and trigger rules that prevent failed tag retries from deleting a newer draft release.
---

Tag release drafts are currently located by tag/name rather than an explicit workflow-attempt owner.

**Why:** If same-tag workflow runs overlap, cleanup from an older failed attempt can delete a newer attempt's draft. The workflow therefore must serialize tag runs through cleanup; branch and PR validation can still cancel in progress.

**How to apply:** keep tag concurrency `cancel-in-progress` false, require `github.event_name == 'push' && github.ref_type == 'tag'` for every release-only action, and keep manual dispatches artifact-only even when the selected ref is a tag. An explicit release-attempt marker would be a future hardening option.

Cleanup observability belongs in the workflow step summary via the runner-provided `$GITHUB_STEP_SUMMARY` shell variable, not an `env` expression lookup.

**Why:** The summary path is injected as a default runner environment variable; resolving it through the workflow `env` context can produce an empty path and hide the audit result.

**How to apply:** write only tag, counts, release IDs, and outcome text to the summary; keep API credentials exclusively in the step environment used by `gh`.