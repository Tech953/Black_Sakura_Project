---
name: Hub controls updates
description: Partial global-control updates must preserve flags that were not included by the caller.
---

Hub control update paths must build the database patch from defined fields instead of spreading an input object containing optional keys.

**Why:** HTTP clients commonly update one control at a time, and passing an omitted key through can overwrite the other persisted flag in adapters or test doubles.

**How to apply:** Keep omitted `paused` and `quietMode` values out of the update payload; test both one-field and two-field updates.