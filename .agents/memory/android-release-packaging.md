---
name: Android release packaging
description: Android release-build packaging behavior for duplicate dependency metadata.
---

Android release packaging must exclude the duplicate `META-INF/versions/9/OSGI-INF/MANIFEST.MF` resource emitted by the okhttp logging interceptor and jspecify dependencies.

**Why:** The warmed native release build reached packaging and failed when the Android Gradle plugin treated the two identical metadata paths as a fatal merge collision.

**How to apply:** Keep the exclusion in the app module's `packagingOptions.resources` block when upgrading AGP, Expo, or the networking dependencies; re-run a release APK build after dependency changes.