# Architecture

Rewind Overlay is a local companion application with a shared HTML renderer.
The design avoids Dolphin process injection and avoids duplicating animation
logic between desktop and OBS.

## Processes and boundaries

### Electron main process

- creates Studio and the transparent overlay `BrowserWindow`;
- maintains always-on-top, taskbar, opacity and click-through behavior;
- persists a versioned JSON configuration in Electron's user-data directory;
- resolves local Wheel Wizard/Dolphin identity;
- polls the official RWFC endpoints through typed adapters;
- serves the built renderer and a small JSON/SSE API on
  `127.0.0.1:19488`.

### Renderer

React renders either `/studio` or `/overlay` based on the route. The Overlay
component is pure with respect to a `{ config, player, status }` snapshot.
Studio edits configuration through the local API. Server-sent events update
Studio, the desktop window and every OBS source immediately.

### OBS integration

The Lua integration creates and manages OBS's built-in Browser Source. It does
not draw independently and does not contact RWFC. The source loads
`/overlay?obs=1`, so theme and event behavior match the desktop output.

## State lifecycle

1. Settings load and are merged with defaults for forward compatibility.
2. Identity resolution produces a friend code or an actionable waiting state.
3. The poller requests room status and the selected player.
4. Per-race history determines the last completed race change.
5. Mapped state is compared to the previous state and emitted over SSE.
6. Renderers key transitions by the changed values/timestamp.

Transient network errors retain the most recent good player state. Status
changes separately, allowing the overlay to remain visually stable during a
brief outage.

## Local API

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/health` | readiness/version |
| `GET` | `/api/snapshot` | configuration, player and service status |
| `GET` | `/api/events` | SSE snapshot stream |
| `PATCH` | `/api/config` | merge and persist a partial configuration |
| `POST` | `/api/background` | validate and persist a data-URL image |
| `GET` | `/api/background/export` | inline the current local background for a portable profile |
| `POST` | `/api/demo/:kind` | trigger a preview transition |
| `POST` | `/api/window/:action` | local desktop window controls |

The service binds to loopback and is intentionally unauthenticated. Do not
change it to `0.0.0.0` without adding authentication and origin protection.
