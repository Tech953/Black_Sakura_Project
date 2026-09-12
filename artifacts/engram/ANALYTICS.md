# ENGRAM web analytics

Replit injects the Umami tracker for an enabled, published website. The app
uses `src/lib/analytics.ts` as the only custom-event entry point. Events are
optional and carry only fixed, non-personal dimensions; development builds and
deployments without the injected tracker are safe no-ops.

## Events

| Event name | Description |
| --- | --- |
| `desktop_promo_clicked` | A visitor opens the desktop download page from the Overview call-out. Includes `location=overview_callout`. |
| `desktop_promo_dismissed` | A visitor dismisses the Overview desktop call-out. Includes `location=overview_callout`. |
| `installer_clicked` | A visitor selects an installer on the download page. Includes `location=download_page`, `os` (`mac`, `win`, `linux`, or `android`), and `installer_type` (for example `dmg`, `exe`, `appimage`, `deb`, or `apk`). |

## Funnel

Automatic pageviews provide the starting point. The desktop promotion funnel is:

1. Overview pageview
2. `desktop_promo_clicked` with `location=overview_callout`
3. Download pageview
4. `installer_clicked` with `location=download_page`, plus OS and installer type

`desktop_promo_dismissed` is the alternative branch from the Overview pageview.
Together, these events show whether the call-out leads visitors to the
download page and which installer they choose.