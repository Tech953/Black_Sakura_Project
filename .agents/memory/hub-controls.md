---
name: Hub controls updates
description: Partial global-control updates must preserve flags that were not included by the caller.
---

Hub control update paths must build the database patch from defined fields instead of spreading an input object containing optional keys.

**Why:** HTTP clients commonly update one control at a time, and passing an omitted key through can overwrite the other persisted flag in adapters or test doubles.

**How to apply:** Keep omitted `paused` and `quietMode` values out of the update payload; test both one-field and two-field updates.

Control writes and their `controls.changed` publication must share one per-owner serialization boundary. The event must be emitted before the next same-owner update can publish, or a stale returned row can become the last event after a newer row is already persisted.

**Why:** concurrent partial updates can each succeed while their asynchronous post-write event emissions complete out of order, leaving subscribers with a stale final control state even though the database is correct.

**How to apply:** Queue the database write and event publication together per owner; keep the durable flags in the database and treat the in-process queue only as event-order protection.