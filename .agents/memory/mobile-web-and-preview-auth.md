---
name: Mobile web and preview authentication
description: Constraints for running the Expo mobile artifact in a browser and authenticating web API requests through the preview proxy.
---

The Expo web bundle imports the offline SQLite adapter at startup, so Metro must treat the expo-sqlite wa-sqlite WebAssembly file as an asset. The web dashboard also needs a Clerk bearer token fallback because preview routing can separate the UI and API origins even when browser cookies appear available.

**Why:** Without the wasm asset, Expo repeatedly fails and reloads before rendering. Without the bearer fallback, protected API calls arrive as 401 and the UI can mislabel an authentication failure as an unreachable API.

**How to apply:** Keep wasm in the mobile Metro asset extensions, and configure the web Clerk provider to supply the shared API client’s token getter. Preserve explicit HTTP-status messaging for manual streaming calls.