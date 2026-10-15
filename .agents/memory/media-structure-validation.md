---
name: Media binary structure validation
description: Durable boundary rule for preventing malformed or truncated media from reaching extraction.
---

Validate media bytes against the claimed MIME using bounded container structure checks at both the upload boundary and the worker boundary.

**Why:** Upload validation does not protect against legacy rows, direct database writes, or corrupted stored blobs. Rechecking before clearing observations or invoking extraction prevents known-invalid bytes from causing late ffmpeg/transcription failures or partial retry state.

**How to apply:** Keep the byte validator pure and deterministic, reject incomplete container lengths and required structural markers, return a clear MIME mismatch error from the worker, and preserve the existing transactional observation/retry behavior.