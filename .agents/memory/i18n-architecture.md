---
name: i18n architecture
description: How internationalization works across web, mobile, and engram replies; the non-obvious constraints when adding strings or languages.
---

# i18n architecture (ENGRAM)

- Shared package `@workspace/i18n` (lib/i18n): English namespace JSONs under `src/en/` are the ONLY authored source. `src/generated/<lang>.json` are machine-translated full trees — never hand-edit them; rerun `pnpm --filter @workspace/scripts run generate:locales [langs...]` (resumable: reuses namespaces whose key sets still match, so it's cheap after small English edits; run per-language batches to fit shell timeout windows).
- **Adding/changing English strings requires regenerating locales**, or the other 11 languages silently fall back to English (returnEmptyString: false + fallbackLng).
- If the translation provider is unavailable, preserve the generated locale key trees with English fallback values and regenerate translations later; key parity still must pass the locale check.
- Namespaces are one-per-web-page plus `mobile` (all mobile strings) and shared `common`/`nav`/`settings`. Keep page work in its own namespace file to allow parallel edits without index.ts conflicts.
- Reply language ≠ UI language. Chat + inquiry POST bodies accept optional `language` (BCP-47); the server maps it through `responseLanguageInstruction()` — an allowlist, so arbitrary input never becomes prompt text. All three online generation paths must honor it: chat (PYRI + engram), inquiry probe, inquiry develop (develop also needs the instruction inside its JSON-output situation for the "response" field).
- Prompt builders in engram-core take `responseLanguageInstruction` as a pre-built string (engram-core does NOT depend on @workspace/i18n; callers build the instruction).
- Web: settings in localStorage (`engram.uiLang`, `engram.replyLang` = match|auto|code) via `src/i18n.ts`; RTL handled by `document.dir` (ar).
- Mobile: AsyncStorage is async — all reads go through the exported `i18nReady` hydration promise and `resolveReplyLanguage()` is async (await it at send time); selection-version guards stop a slow hydration read from clobbering a newer in-session choice. Arabic applies native RTL through `I18nManager`; direction changes trigger one guarded app reload, while web updates the document direction immediately.
