---
name: Multipart upload cancellation
description: Client-aborted media uploads using XHR and Multer memory storage.
---

Abort the client's XHR while bytes are still being sent. Multer's memory storage only reaches the route callback with a complete file or a parsing error, so partial bytes are not persisted. Before database writes, check `req.aborted` and `res.destroyed`.

Do not use `req.destroyed` as the cancellation condition: a normally completed request can already be marked destroyed by the time Multer invokes its callback. Returning on that flag leaves valid upload clients waiting forever.

**Why:** A route guard using `req.destroyed` caused normal multipart uploads to hang; the real abort signal is `req.aborted`.

**How to apply:** When adding cancellation to another multipart route, keep the abort guard narrow and test a real HTTP request that disconnects mid-body alongside normal successful uploads.
