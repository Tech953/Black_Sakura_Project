---
name: Native export cleanup
description: Lifecycle rule for temporary mobile Markdown, text, PDF, and DOCX exports.
---

The native export helper owns the temporary file lifecycle: share the generated file first, then delete it idempotently in cleanup whether sharing succeeds or fails.

**Why:** Expo native exports use cache files as share hand-offs; leaving them behind makes repeated exports consume device storage, while deleting before the share promise completes can invalidate the hand-off.

**How to apply:** Inject filesystem deletion alongside the existing write, validation, print, and share seams. Treat the original generation/share error as primary, but surface cleanup failure after an otherwise successful share instead of silently accepting a leak.