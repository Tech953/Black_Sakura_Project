# RTL release QA — Arabic

Date: 2026-09-12

## Automated and code-path verification

- `pnpm --filter @workspace/engram-mobile test` passed: 19 Vitest files, 85 tests, plus the 8 release-preflight tests.
- `pnpm --filter @workspace/engram-mobile run typecheck` passed.
- `lib/layout-direction.test.ts` covers Arabic base and regional language tags.
- `setUiLanguage()` persists the selected language before changing i18next, and returns whether native direction must change.
- `i18nReady` hydrates the persisted language before the root layout renders. On native, a direction change calls `reloadAppAsync()` once; the next launch sees the persisted direction and does not reload again.
- Native tabs remain in the declared order and rely on `I18nManager` to mirror. Web tabs explicitly reverse their order because document direction alone does not reorder Expo Router tabs.
- Settings, chat, transmission text, score numbers, URL fields, and download/import progress styles contain RTL-specific alignment or writing-direction handling.

## Expo web evidence

`qa/rtl-expo-web-shell.jpg` records the available 402×874 Expo-web preview. It shows the unauthenticated sign-in shell; a signed-in session was not available in the preview, so populated chat bubbles, feed transmission cards, and the native modal back affordance were not visually exercised there.

## Physical-device results

Not executed in this workspace:

- Android: `adb devices` reported no connected device or emulator.
- iOS: the Linux workspace has no `xcrun` or `ios-deploy`, and no iOS device target is attached.

Therefore Android/iOS restart behavior, native tab-bar mirroring, native modal back controls, populated chat/feed layouts, and right-origin progress bars remain release-QA checks for a connected Android phone and iPhone. The implementation and automated/web checks above do not replace that device sign-off.

## Device checklist

On one Android phone and one iPhone:

1. Start in English, open Settings, switch to Arabic, and confirm exactly one reload.
2. Confirm tabs, Settings, Chat, Feed, URL fields, populated chat bubbles, transmission cards, and score/progress bars mirror from the right.
3. Force-close and reopen; confirm Arabic remains active without another reload loop.
4. Switch Arabic back to English; confirm exactly one reload and restored LTR order.
5. Force-close and reopen again; confirm English remains active without a reload loop.