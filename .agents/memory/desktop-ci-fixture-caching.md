---
name: Desktop CI fixture caching
description: Durable rules for caching the pinned llama runtime and GGUF smoke fixture in GitHub Actions.
---

Use exact GitHub Actions cache keys containing the target platform, architecture, pinned runtime version, and archive checksum; use the smoke model checksum as its cache key.

**Why:** GitHub Actions cache entries are immutable, so version/checksum keys prevent stale fixtures from being treated as current, while a restored corrupt entry cannot be repaired remotely in place.

**How to apply:** Verify every restored archive or model locally before use. On mismatch, remove the restored file, download to a process-specific partial path, checksum it again, and atomically rename it into place. Keep the downloader safe on both cache hits and cache misses.