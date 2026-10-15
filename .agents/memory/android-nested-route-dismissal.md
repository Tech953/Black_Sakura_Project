---
name: Android nested-route dismissal
description: Safe navigation back to the root tab route after an action on a nested Expo Router screen.
---

When a mobile action completes on a nested screen, dismiss to the known root route rather than assuming the Android back stack contains the expected parent.

**Why:** Android can restore or deep-link into a nested route with a different stack shape; an unconditional back action can leave the tab navigator without a handled route and make a successful action look like an app crash.

**How to apply:** Use Expo Router's stack-aware root dismissal for post-action navigation, and keep the nested screen mounted when the action fails so transient API errors do not silently navigate away.