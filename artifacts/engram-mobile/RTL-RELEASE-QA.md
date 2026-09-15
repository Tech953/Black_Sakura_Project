# RTL release QA — Arabic

Date: 2026-09-15

## Automated and code-path verification

- `pnpm --filter @workspace/engram-mobile run test` passed: 21 Vitest files, 108 tests, plus the 11 release-preflight tests.
- `pnpm --filter @workspace/engram-mobile run typecheck` passed.
- `lib/layout-direction.test.ts` covers Arabic base and regional language tags.
- `setUiLanguage()` persists the selected language before changing i18next, and returns whether native direction must change.
- `i18nReady` hydrates the persisted language before the root layout renders. On native, a direction change calls `reloadAppAsync()` once; the next launch sees the persisted direction and does not reload again.
- Native tabs remain in the declared order and rely on `I18nManager` to mirror. Web tabs explicitly reverse their order because document direction alone does not reorder Expo Router tabs.
- Settings, chat, transmission text, score numbers, URL fields, and download/import progress styles contain RTL-specific alignment or writing-direction handling.

## Expo web evidence

`qa/rtl-expo-web-shell.jpg` records the available 402×874 Expo-web preview. It shows the unauthenticated sign-in shell; a signed-in session was not available in the preview, so populated chat bubbles, feed transmission cards, and the native modal back affordance were not visually exercised there.

## Physical-device results

### Android — blocked, not signed off

- Attempted on 2026-09-15: `adb` is not installed in the Linux workspace (`adb: command not found`).
- No Android phone or emulator was available, so the Arabic switch/reload, force-close/reopen, and visual mirroring checklist could not be executed.
- No Android visual exceptions can be recorded from this workspace. The Android release sign-off remains pending a connected phone or emulator.

### iOS — not executed

- The Linux workspace has no `xcrun` or `ios-deploy`, and no iOS device target is attached.

Therefore Android/iOS restart behavior, native tab-bar mirroring, native modal back controls, populated chat/feed layouts, and right-origin progress bars remain release-QA checks for a connected Android phone and iPhone. The implementation and automated/web checks above do not replace that device sign-off.

## Device checklist

On one Android phone and one iPhone:

1. Start in English, open Settings, switch to Arabic, and confirm exactly one reload.
2. Confirm tabs, Settings, Chat, Feed, URL fields, populated chat bubbles, transmission cards, and score/progress bars mirror from the right.
3. Force-close and reopen; confirm Arabic remains active without another reload loop.
4. Switch Arabic back to English; confirm exactly one reload and restored LTR order.
5. Force-close and reopen again; confirm English remains active without a reload loop.