# Changelog

## 1.1.2

- Add a local-image browser to the Web Overlay Studio with private client-side resizing, compression, and embedding.
- Carry background image bytes inside exported JSON profiles and materialize them on desktop import for true web/desktop portability.
- Warn when an embedded background produces a source URL that may exceed a broadcast tool's URL-length limit.

## 1.1.1

- Allow the hosted page to connect to the HTTPS RWFC API under its strict Content Security Policy.
- Add JSON profile import and export to the Web Overlay Studio, including desktop-profile import compatibility.

## 1.1.0

- Add a zero-install hosted Web Overlay Studio and transparent HTTPS source for OBS and TikTok LIVE Studio.
- Share the race-aware polling engine between desktop and browser builds.
- Detect live Wheel Wizard license renames and license-slot changes without restarting.
- Add automatic online-license following plus explicit slot pinning for multi-license players.
- Reset rank, delta, avatar, and prior-player state cleanly whenever the active license changes.
- Remove stale room and track context as soon as the player is no longer seated.
- Add independent size and placement controls for every badge element.
- Smoke-test packaged Windows, Linux/Xvfb, and macOS applications in CI and before releases.

## 1.0.3

- Add a dedicated Mii section with an explicit hide switch, solid and gradient backing colors, and a fully transparent backing.
- Clarify inside Studio and the OBS setup script that streams must use the independent Browser Source rather than capture the floating window.
- Confirm that the local data service and OBS event stream continue updating while the floating badge is hidden.
- Make the floating-window Hide action explicitly state that OBS remains live.

## 1.0.2

- Give the floating overlay a glow-aware transparent gutter so animated light is never clipped by the native window.
- Make the floating overlay self-sizing and non-resizable while preserving its screen position as its content changes.
- Stop rank, last-race VR, and celebration animations from replaying after unchanged background polls.
- Pan uploaded backgrounds on both axes after zooming, in both **Cover** and **Contain** modes.
- Add native-renderer checks for transparent glow boundaries and two-axis background movement.

## 1.0.1

- Accept nullable and inconsistent optional fields from the live RWFC room-status API instead of stopping updates.
- Detect a Wheel Wizard license while preview data is active and switch to live data automatically.
- Label sample statistics as **Preview Mode** on the overlay and explain automatic detection in Studio.
- Keep the pulse effect on the border instead of brightening the badge background.
- Make the desktop and OBS surfaces fully transparent outside the rounded badge.
- Wrap room, track, session, and 24-hour fields into additional rows without ellipsis.
- Use the correct red transition for VR losses.
- Add dedicated, centered Windows application and system-tray icons.

## 1.0.0

- Initial public release with automatic player identity, official RWFC polling, OBS integration, the floating desktop overlay, Studio customization, animated borders, backgrounds, profiles, and cross-platform packaging.
