---
name: Native export cleanup
description: Lifecycle rule for temporary mobile Markdown, text, PDF, and DOCX exports.
---

The native export helper owns the temporary file lifecycle: share the generated file first, then delete it idempotently in cleanup whether sharing succeeds or fails.

**Why:** Expo native exports use cache files as share hand-offs; leaving them behind makes repeated exports consume device storage, while deleting before the share promise completes can invalidate the hand-off.

**How to apply:** Inject filesystem deletion alongside the existing write, validation, print, and share seams. Treat the original generation/share error as primary, but surface cleanup failure after an otherwise successful share instead of silently accepting a leak.

Keep native export failures in the export sheet with localized retry guidance; classify platform cancellation separately when the native error exposes it, while treating unknown errors as retryable failures.

**Why:** Closing the sheet without feedback makes generation and share failures look like successful exports, and platform cancellation should not be reported as a broken file.

**How to apply:** Convert the helper's native error into a small failure-kind enum at the chat boundary, keep the sheet open on either failure kind, and close it only after a confirmed successful share.