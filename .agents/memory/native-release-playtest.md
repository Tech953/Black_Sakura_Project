---
name: Native release playtest constraints
description: What native APK/Windows playtesting can and cannot prove from the Linux workspace, plus artifact freshness checks.
---

Native release sign-off requires both artifact freshness and a real target runtime. A checked-in Android manifest can be hardened while an older APK still embeds a permissive manifest, so inspect the packaged APK itself before treating source checks as release evidence.

**Why:** The workspace had a stale APK whose embedded `allowBackup` policy contradicted the current manifest, and no ADB/emulator or Windows/Wine runtime was available to launch the target artifacts.

**How to apply:** Record artifact hashes and build dates, run the APK/Windows package directly on their target platforms, and label Linux desktop smoke or static ZIP checks as proxies rather than native playtests. If packaged model activation exits 127, inspect runtime library resolution before attributing it to renderer code.