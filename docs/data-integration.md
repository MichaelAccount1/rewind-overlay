# Data integration — how the overlay knows who you are and what happened

Developer-facing companion to [research.md](research.md) (which holds the raw
evidence). This describes what `electron/identity.ts`, `electron/rwfc.ts` and
`electron/poller.ts` actually do, and the contract the renderer consumes.

## Architecture

```
WheelWizard files (read-only)          rwfc.net API (polled)
  config.json ─┐                         /api/roomstatus        every poll tick (default 5 s)
  rksys.dat ───┼─► identity.ts ─► FC ─►  /api/leaderboard/player/{fc}          every 60 s
  RRRating.pul ┘                         /api/leaderboard/player/{fc}/history/recent   seed + per race
                                            │
                                            ▼
                                     poller.ts (state machine)
                                            │  "change" events
                                            ▼
                              server.ts SSE  /api/events + /api/snapshot
                                            │
                        ┌───────────────────┼──────────────────────┐
                        ▼                   ▼                      ▼
                 OBS browser source   floating window        Studio preview
```

One poller feeds every surface; adding overlay windows costs zero extra
requests against rwfc.net.

## Identity resolution (`identity.ts`)

Order of precedence, mirroring WheelWizard's own logic (research.md §3–§5):

1. WheelWizard app-data dir: registry `HKCU\Software\WheelWizard\AppDataLocation`
   → `%APPDATA%\CT-MKWII`.
2. `config.json` → `UserFolderPath` (Dolphin user dir), `FavoriteUser`
   (license slot 0–3), `RR_Region`.
3. Dolphin user dir fallbacks: `HKCU\Software\Dolphin Emulator\UserConfigPath`
   → `Documents\Dolphin Emulator` → `%APPDATA%\Dolphin Emulator`.
4. `Config\Dolphin.ini` `[General] LoadPath/NANDRootPath` overrides are honored.
5. Save discovery — all of these are scanned, newest mtime wins, preferred
   region first:
   `Load\Riivolution\[WheelWizard\]riivolution\save\{RetroWFC,RetroWFC2}\{RMCE,RMCP,RMCJ,RMCK}\rksys.dat`
6. `rksys.dat` license slot `FavoriteUser` (fallback: first slot with a
   non-zero PID) → license name, PID, u16 VR/BR.
7. Friend code = `((MD5(pid_le ‖ "JCMR")[0] >> 1) << 32) | pid`, 12 digits.
   Verified against live server records; `friendCodeToPid()` validates
   user-typed codes by recomputing the checksum.
8. `Wii\shared2\Pulsar\RetroRewind6\RRRating.pul` overrides VR/BR when it has
   an entry for the license PID (RR's real rating exceeds the u16 save field).

Every step appends to a human-readable `steps` trail (`IdentityProbe.steps`) —
surface this in Studio's troubleshooting panel.

The resolver never writes to any WheelWizard/Dolphin file.

## Poll loop (`poller.ts`)

- **roomstatus** every `config.data.pollSeconds` (clamped 2–60, default 5;
  the server-side snapshot refreshes every 10 s, and rate limits are 2000
  req/min/IP, so this is comfortably polite).
- **player profile** every 60 s — the server's leaderboard sync only runs once
  a minute, faster polling is wasted — or immediately when a race boundary is
  detected.
- **history/recent** once at startup (seeds "last race ±VR" across restarts),
  then after each race boundary until the settled entry appears (retry ≥15 s
  apart).

**Race boundary** = our room's `race.num` incremented, or our `vr` moved in
the room feed. The VR delta is applied *provisionally* from the live feed
(instant animation), then reconciled with the authoritative per-race
`vrChange` from history (which can lag up to ~60 s).

**Failure policy**: last-good data stays on screen, `status.phase` walks
`error` → `offline` (after `offlineAfterSeconds`), and recovery is automatic.
The overlay is never blanked mid-stream.

**Demo mode** (`config.data.demoMode`) never touches the network; the
`/api/demo/{gain|loss|rank|reset}` routes drive preview animations.

## Renderer contract

`GET /api/snapshot` and each SSE message on `/api/events` deliver
`{ config, player, status }`:

- `player` is `PlayerState` (see `electron/models.ts`): `name`, `tag`,
  `friendCode`, `vr`, `previousVr`, `vrDelta` (last race ±VR), `rank`,
  `previousRank`, `rankDelta` (positive = climbed), `avatarUrl` (data-URL PNG
  of the Mii when available), `room`, `race`, `online`, `updatedAt`, `source`.
- `player.extras` (additive, may be absent — hide the widget when missing):

| Field | Type | Meaning |
|---|---|---|
| `trackName` | string | current track, e.g. `"SW Shroom Ridge / DS Shroom Ridge"` |
| `roomKind` | string | `"Retro Tracks"`, `"Custom Tracks"`, … |
| `roomId` | string | 6-char room code |
| `cc` | string | `"150cc"` / `"200cc"` / `""` |
| `averageVr` | number\|null | room average VR |
| `roomPlayerCount` | number\|null | players in the room |
| `vrStats` | object\|null | `{last24Hours, lastWeek, lastMonth}` VR deltas |
| `sessionDelta` | number\|null | VR gained/lost since the app started |
| `recentChanges` | array | last ~12 races: `{date, vrChange, totalVr}` (sparkline-ready) |
| `lastSeen` | string\|null | server-side last-seen timestamp |

- `status`: `phase` (`starting|connected|waiting|offline|error`), `message`,
  `detectedFriendCode`, `lastSuccessAt`, `consecutiveErrors` — for the Studio
  connection panel.

Display note: Retro Rewind VR caps at **1,000,000** — budget 7 digits.

## Tests

`tests/electron/*.test.ts` (node environment) cover the friend-code algorithm
against server-verified pairs, rksys/pul parsing on synthetic buffers,
schema parsing on real captured fixtures (`tests/fixtures/`), race-boundary
and reconciliation flows, rank changes, manual-mode name matching, and the
failure policy. Run with `npx vitest run tests/electron`.
