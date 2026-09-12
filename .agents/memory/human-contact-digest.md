---
name: Human contact digests
description: Durable invariants for bundling low-priority human-channel messages into operator-facing summaries.
---

Digest summaries are ordinary human-channel message rows with an explicit summary marker; source rows are claimed with a nullable timestamp inside the same transaction that creates the summary. The ticker must also discover pending digest owners independently of current autonomy enablement.

**Why:** a process restart or concurrent engine tick must not create duplicate operator notifications, and disabling autonomy after contact is queued must not strand the pending digest.

**How to apply:** keep source selection locked and filtered by `isDigest = false`, unseen, digest status, and a null claim timestamp. Exclude generated summaries from rate-limit input and follow-up selection as the implementation evolves.