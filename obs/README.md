# OBS integration

Two ways to get the overlay into OBS. Both require the Rewind Overlay app to be
running (it serves the overlay locally and feeds it live Retro Rewind data).

> **Use a Browser source — do not screen-capture the floating badge.**
> The floating badge is for *your* eyes while you play. OBS gets its own private
> copy of the overlay through the browser source below, straight from the app —
> it keeps rendering and updating even when the badge is hidden, minimized, or
> the game is fullscreen over it. If you instead point Window/Display/Game
> Capture at the badge, your stream loses the overlay the moment the badge is
> minimized or hidden, because Windows stops drawing windows that are not on
> screen. Hide the badge freely; the browser source doesn't care.

## Option A — setup script (recommended)

1. OBS → **Tools → Scripts** → **+** → select `rewind-overlay.lua`
   (installed builds ship it in the app's `resources/obs` folder; from a repo
   checkout it is `obs/rewind-overlay.lua`).
2. Click **Add overlay to current scene**.
3. Drag the source where you want it. Everything else (size, border effects,
   background, animations, what is shown) is controlled live from the app's
   Studio window.

The button is idempotent: click it again to repair the source (refresh URL and
size) or to add the existing source to another scene.

## Option B — manual browser source

Add a **Browser** source with:

| Setting | Value |
|---|---|
| URL | `http://127.0.0.1:19488/overlay?obs=1` |
| Width | `720` |
| Height | `220` |
| Custom FPS | `60` (for smooth border animation) |
| Shutdown source when not visible | **off** |

## Troubleshooting

- **Overlay disappears from the stream when the badge is minimized/hidden** —
  the scene is using Window Capture or Display Capture of the floating badge.
  Delete that capture and add the overlay as a **Browser** source (Option A or
  B above). The browser source is fed directly by the app and works with the
  badge hidden — verified: the app's data stream keeps broadcasting with the
  overlay window fully hidden.
- **Black/empty source** — the app isn't running, or another program took port
  19488. The Studio window shows the exact URL it is serving.
- **Overlay shows but no data** — check the connection panel in Studio; it
  displays the identity-detection trail (WheelWizard config → save file →
  friend code) and the last server response.
- **Border animation is choppy** — enable *Custom FPS: 60* on the browser
  source; OBS defaults browser sources to 30 fps.
- **OBS on a different PC** — the app binds to 127.0.0.1 only, by design.
  Run the app on the streaming PC.
