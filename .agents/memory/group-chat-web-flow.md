---
name: Group chat web flow
description: The active chat conversation must be tracked locally during creation so a newly created group is recognized before list-query refresh.
---

The chat page should treat the conversation returned by creation or loaded by ID as the active conversation immediately; do not derive first-send group behavior only from the asynchronously refreshed conversation list.

**Why:** The first message can be sent before the list query finishes refreshing. Without a local active snapshot, the client misclassifies a new group as a single chat and can mishandle its attributed SSE turns.

**How to apply:** Keep the active conversation object in page state, use it for group participant IDs and rendering, and let query invalidation refresh the sidebar independently.