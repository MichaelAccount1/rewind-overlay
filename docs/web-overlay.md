# Hosted web overlay

The hosted edition provides the same Rewind Overlay renderer and appearance controls without installing the companion app:

**https://michaelaccount1.github.io/rewind-overlay/**

## Set up

1. Enter the RetroWFC friend code for the license you want to show.
2. Optionally add a fallback player name and team tag.
3. Customize content, Mii backing, element placement, background, border lighting, and animations. A local background can be selected directly; it is resized, compressed, and embedded privately in the browser.
4. Open **OBS & TikTok** and copy the configured HTTPS URL.
5. Add that URL as an OBS **Browser Source** or TikTok LIVE Studio **Link / Web Page Source**.

A source size around 1000 × 300 works well. The page outside the badge is transparent.

Use **Export JSON** to download a portable copy of the complete player and visual profile, including a compressed, embedded background image. **Import JSON** accepts both hosted-web profiles and desktop Rewind Overlay profile files.

## Architecture and privacy

GitHub Pages serves only static HTML, CSS, and JavaScript. Each open overlay polls the public RWFC API directly from the browser. Rewind Overlay does not operate an intermediary data server, database, account system, or analytics service.

The configured source URL contains the friend code and complete visual profile. It contains no password or authentication token, but should still be treated as part of the stream setup rather than posted publicly.

The overlay preserves its last good player state during temporary network failures. A corrupt configuration blob falls back to safe defaults instead of blanking the source.

## Web limitations

Web browsers cannot silently inspect local Wheel Wizard, Dolphin, or RetroWFC save files. Therefore the web edition cannot:

- detect the active license automatically;
- follow another local license when it enters a room;
- create an always-on-top frameless desktop window.

Local web backgrounds are embedded in the configured source URL. Rewind automatically compresses them, but very detailed images can still produce a long URL; the Studio warns when an HTTPS-hosted image may be more compatible with a broadcast tool's URL limit. Use the desktop edition for automatic identity, multi-license following, tray controls, and the floating badge.

## Hosting and development

The `pages.yml` workflow builds `dist-web` and deploys it to GitHub Pages. No paid host is required.

```powershell
npm run build:web
npm run smoke:web
```

The smoke test opens the generated static Studio and transparent overlay in a packaged Chromium runtime and verifies both surfaces render.
