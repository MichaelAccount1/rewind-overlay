# Retro Rewind Overlay — Research & Data-Integration Design

> Author: CLAUDE · Date: 2026-07-29
> Status: all core findings **verified live on this machine** (marked ✅). Two research
> threads still pending (§9): general API etiquette details, prior-art/Dolphin-memory survey.

## 0. TL;DR — recommended architecture

- **Identity** comes from local files WheelWizard already maintains: `%APPDATA%\CT-MKWII\config.json`
  → Dolphin user folder → Riivolution-redirected save `rksys.dat` → PID → friend code
  (algorithm §5). Verified end-to-end on this machine: save PID `116944` → derived FC
  `3822-5220-6288` → RWFC server returned the same player (name `FoidBumper`, VR 1010,
  rank 70370). **No user input needed** for the common case; manual FC entry stays as fallback.
- **Live data** comes from the official RWFC HTTP API at `https://rwfc.net/api/*` (§2) —
  the same API WheelWizard itself polls. It provides: live VR, **global rank**, per-race VR
  deltas with timestamps, 24h/week/month VR stats, current room + track name + race counter,
  opponents with VR/Miis, and a **pre-rendered Mii PNG**. No Dolphin memory reading required
  for v1 (§8).
- **WheelWizard has no plugin API** (verified by source audit — §6). The correct shape is a
  companion desktop app + overlay renderer that reads WhWz's files and polls RWFC.

---

## 1. Visual reference

`example1.png` (workspace root, 285×88): rounded-rect pill overlay.

- Border: ~3px rainbow gradient ring around the whole pill (animated in motion — see Twitch
  VOD https://www.twitch.tv/videos/2831586934, rainbow hue cycles/slides around the pill).
- Left: Mii head icon (top-left corner) above the player tag `ZPL` (bold white, left-aligned).
- Right, stacked: small line `3 4 R` + green `+41` (last-race VR gain, green for +/red for −);
  huge white `87747` (current VR); below it an orange-outlined rounded badge `#279`
  (global leaderboard rank).
- Background: darkened in-game screenshot (space scene), vignette/dark overlay for contrast.

Note VR `87747` > 65535: RR VR exceeds u16 — display must handle 6 digits; data must come
from the API or `RRRating.pul` (float), **not** the u16 save field (§4, §4a).

## 2. RWFC HTTP API ✅ (all verified live 2026-07-29/30)

Base: `https://rwfc.net` (Cloudflare-fronted). These are the exact endpoints WheelWizard v2.4
uses (source: `WheelWizard/Features/RrRooms/Domain/IRwfcApi.cs`; also observed verbatim in
local WhWz logs `%APPDATA%\CT-MKWII\logs\*.txt`).

| # | Endpoint | Returns |
|---|----------|---------|
| 1 | `GET /api/roomstatus` | all live rooms + players (live VR, room, race counter, track) |
| 2 | `GET /api/leaderboard/top/{n}` | top-n leaderboard (server caps at **100** ✅) |
| 3 | `GET /api/leaderboard/player/{fc}` | one player: VR, **rank**, vrStats, Mii PNG |
| 4 | `GET /api/leaderboard/player/{fc}/history?days=N` | per-race VR change log |
| 5 | `GET /api/leaderboard/top/{n}?around={fc}` | leaderboard window centered on a player ✅ (WhWz doesn't use it; useful for "players near you") |

Auxiliary (WheelWizard-Data, GitHub raw): `https://raw.githubusercontent.com/TeamWheelWizard/WheelWizard-Data/main/badges.json`
(badge lists keyed by friend code) and `/status.json`.

### 2.1 `GET /api/roomstatus` — rooms + live players

Response `{ "rooms": [...] }`. Real sample (trimmed):

```json
{
  "rooms": [{
    "id": "KUEJYC", "type": "anybody",
    "created": "2026-07-29T18:02:55.2396027Z",
    "host": "115", "rk": "vs_10",
    "players": [{
      "pid": "110204", "name": "omoney¿",
      "friendCode": "3951-3710-1436",
      "vr": 77770, "br": 5000,
      "isOpenHost": true, "isSuspended": false,
      "mii": { "data": "gBYAbwBtAG8AbgBlAHkAvwAA…(base64, 74-byte Wii Mii)", "name": "omoney¿" },
      "connectionMap": ["2", "2"], "slotId": "115"
    }],
    "averageVR": 60976,
    "race": { "num": 127, "course": 335, "cc": 2, "trackName": "SW Shroom Ridge / DS Shroom Ridge" },
    "roomType": "Retro Tracks", "isPublic": true, "isJoinable": true, "isSuspended": false
  }]
}
```

Notes:
- `race.num` is a **monotonic race counter for the room** — increments each race. Perfect
  race-boundary detector: when `race.num` changes, sample VR delta / fire animations.
- `race.trackName` (human-readable, includes retro prefix) and `cc` are free overlay extras.
- `vr` here is the live server-side value and updates as races complete.
- `friendCode` is pre-formatted `XXXX-XXXX-XXXX` — direct string match against our derived FC.
- `mii.data` = base64 of the raw 74-byte Wii Mii block (same format as rksys/RFL_DB Miis).
- Payload ~54 KB total for all rooms. WheelWizard polls this every **40 s**; kevinvg207's
  rr-rooms site also polls it. For the overlay, 10–15 s while in-room is reasonable
  (see §7 cadence plan); response is `cf-cache-status: DYNAMIC` (no shared cache).
- Rooms can appear "merged"; WhWz splits them via mutual `connectionMap` components
  (credit: https://kevinvg207.github.io/rr-rooms/). For a single-player overlay we only need
  to find our player, so merging is irrelevant.

### 2.2 `GET /api/leaderboard/player/{friendCode}` — VR + global rank ✅

```json
{
  "pid": "110204", "name": "omoney¿", "friendCode": "3951-3710-1436",
  "vr": 77770, "rank": 408,
  "lastSeen": "2026-07-30T01:43:59.145113Z",
  "isSuspicious": false,
  "vrStats": { "last24Hours": 1363, "lastWeek": 1217, "lastMonth": -1670 },
  "miiImageBase64": "iVBORw0KGgo…(a real 64×64 PNG of the Mii, ready to use)",
  "miiData": "gBYAbwBt…(74-byte Wii Mii base64)",
  "badges": null
}
```

- `rank` = the "Global Ranking #279" number, straight from the server. No scraping needed.
- `vrStats` gives ready-made 24h / week / month VR deltas — great optional overlay stats.
- `miiImageBase64` is a **server-rendered PNG** of the player's Mii — zero-effort avatar.
  (Present on the player endpoint; `null` on `top/{n}` entries, which only carry `miiData`.)
- Works for inactive/low players too ✅ (verified with this machine's fresh profile:
  returned `vr: 1010, rank: 70370`). Unknown FCs need a 404/error path (untested — pending §9).

### 2.3 `GET /api/leaderboard/player/{fc}/history?days=N` — per-race deltas ✅

```json
{
  "playerId": "110204",
  "fromDate": "2026-07-28T01:46:14Z", "toDate": "2026-07-30T01:46:14Z",
  "history": [
    { "date": "2026-07-28T18:05:07.108083Z", "vrChange": 17,  "totalVR": 76556 },
    { "date": "2026-07-28T18:11:15.07347Z",  "vrChange": -83, "totalVR": 76473 },
    { "date": "2026-07-28T18:14:19.092802Z", "vrChange": 55,  "totalVR": 76528 }
  ],
  "totalVRChange": 1254, "startingVR": 76539, "endingVR": 77793
}
```

- One entry **per race** (timestamps a few minutes apart = race cadence). The most recent
  `vrChange` IS "VR gain/loss last race" — authoritative, survives overlay restarts
  (unlike diffing roomstatus ourselves, which loses state on restart).
- Also enables: session gain (sum since stream start), sparkline/graph, streaks.

### 2.4 `GET /api/leaderboard/top/{n}` — top list

Array of the player objects from §2.2 (with `rank`, `vrStats`, `miiData`; `miiImageBase64`
null). `n` is capped server-side at 100 (requested 500 → got 100) ✅.

### 2.5 Transport notes ✅

- Plain `curl` with default UA got Cloudflare-403 ("Just a moment…") on the HTML pages
  (`/groups`, `/`), but **the `/api/*` endpoints respond 200 without any challenge** even to
  curl. Still: send a real, identifying User-Agent (e.g. `RROverlay/1.0 (+github url)`) —
  polite and less likely to get filtered later.
- HTTPS works; HTTP redirects. JSON is camelCase. No auth, no API key.
- Update server (not needed by us, for reference): `https://update.rwfc.net/RetroRewind/…`.

## 3. WheelWizard local files ✅ (all verified on this machine)

WheelWizard ("WhWz", C#/Avalonia, repo `TeamWheelWizard/WheelWizard`, HEAD `4137cd3` /
v2.4.11) keeps everything we need in plain JSON.

### 3.1 App-data folder resolution (in priority order)

1. Portable: `portable-ww.txt` next to WheelWizard.exe → `.\CT-MKWII`
2. Registry override: `HKCU\Software\WheelWizard` value `AppDataLocation`
3. Default: `%APPDATA%\CT-MKWII` ← (this machine ✅)

### 3.2 `config.json` (this machine's actual content, paths elided)

```json
{
  "DolphinLocation": "…\\Dolphin-x64\\Dolphin.exe",
  "UserFolderPath": "C:\\Users\\Admin\\AppData\\Roaming\\Dolphin Emulator",
  "GameLocation": "…\\MarioKart.iso",
  "FavoriteUser": 0,          // ← selected license slot 0-3 ("FOCUSED_USER")
  "RR_Region": 2,             // 0 None, 1 America/RMCE, 2 Europe/RMCP, 3 Japan/RMCJ, 4 Korea/RMCK
  "WW_Language": "en", "...": "…"
}
```

`UserFolderPath` is the Dolphin **user dir**. If empty, replicate WhWz's Windows discovery:
`portable.txt` next to Dolphin.exe → `HKCU\Software\Dolphin Emulator\UserConfigPath` (also
`LocalUserConfig=1` → `<exe>\User`) → `Documents\Dolphin Emulator` → `%APPDATA%\Dolphin Emulator`.
Then honor `<UserFolder>\Config\Dolphin.ini` `[General] LoadPath` / `NANDRootPath` overrides;
defaults are `<UserFolder>\Load` and `<UserFolder>\Wii`.

### 3.3 The save file location (Riivolution redirect — NOT the NAND title path)

```
<Load>\Riivolution\WheelWizard\riivolution\save\RetroWFC\<RMCE|RMCP|RMCJ|RMCK>\rksys.dat
```

✅ Exists here (RMCP, 2,867,200 bytes). The vanilla NAND save at
`<Wii>\title\00010004\<gameid-hex>\data\rksys.dat` also exists but is **stale** — Retro
Rewind writes only the redirected one. `RetroRewind6.xml` declares the redirect:
`<savegame clone="true" external="/riivolution/save/RetroWFC/{$__gameid}{$__region}"/>`, and
the "Seperate Savegame" option variant uses `…/RetroWFC2/…` — scan **both** trees, prefer the
most recently modified `rksys.dat`. Region: use `RR_Region`; if `None`, scan all four folders
(WhWz's `RRRegionManager.GetValidRegions()` does the same).

## 4. `rksys.dat` format (big-endian) ✅ (offsets verified against local save)

File: `0x2BC000` bytes, magic `RKSD0006` @0x0. Four license blocks: `rkpd = 0x8 + slot*0x8CC0`,
valid iff magic `RKPD`. Per-license (relative to rkpd):

| Offset | Type | Field |
|---|---|---|
| +0x14 | UTF-16BE ×10 | license name (may differ from Mii name) |
| +0x28 | u32 | avatarId (Mii ID → RFL_DB.dat lookup) |
| +0x2C | u32 | clientId (console ID) |
| +0x5C | u32 | **PID** (RWFC profile ID) → friend code (§5) |
| +0x88/+0x8C | u32 | offline VS wins / losses |
| +0x98/+0x9C | u32 | online VS wins / losses |
| +0xB0 | u16 | VR ("ev") — **u16, capped; superseded by RRRating.pul in current RR** |
| +0xB2 | u16 | BR ("eb") |
| +0xB4 | u32 | total races |
| +0xDC | u32 | total first places |

Friend list: 30 slots @ rkpd+0x56D0, 0x1C0 each (`+0x04` friend PID, `+0x16/+0x18` VR/BR,
`+0x1A` 74-byte Mii). CRC32 (whole-file check) @0x27FFC over 0..0x27FFC — read-only app can skip.

Local probe of this machine's save ✅:
slot 0 `FoidBumper` pid=116944 vr=5000 br=5000; slot 3 `WiggerNet` pid=0 (never online — no FC).
Slots with pid=0 must be skipped when auto-picking identity (WhWz renders them as FC 0000-0000-0000).

### 4a. `RRRating.pul` — Retro Rewind's true rating store ✅

`<Wii>\shared2\Pulsar\RetroRewind6\RRRating.pul` — because RR VR exceeds u16 (leader has
162,510 VR), Pulsar stores ratings separately:

```
magic u32 'RRRT' (0x52525254) | version u16 =1 | count u16 =100
then 100 × 16B entries: { u32 pid, f32 vr, f32 br, u32 flags }   // all BE; flags bit0 = valid
displayed VR = round(vr * 100)
```

✅ Local file: entry pid=116944, vr=10.0, br=50.0 → VR 1000 / BR 5000 (server said 1010 —
file lags until Dolphin flushes the save; **API is authoritative when online**, local files
are identity + offline fallback). WhWz applies the pul value only when entry.pid == license
pid **and** the recomputed FC matches — replicate that guard.

### 4b. Mii avatar (offline path)

License stores only `avatarId`; the Mii lives in `<Wii>\shared2\menu\FaceLib\RFL_DB.dat`
(100 × 74-byte blocks starting @0x04; match u32 @block+0x18 == avatarId; Mii name UTF-16BE
@block+0x02). Simplest robust plan for the overlay: use the API's `miiImageBase64` (server
PNG) when online; offline, convert the 74-byte Wii Mii → Nintendo **Mii Studio** format
(public FaceThief/mii-js byte mapping, which WhWz's `MiiStudioDataSerializer.cs` ports) and
call `https://studio.mii.nintendo.com/miis/image.png?data=<hex>&type=face&width=270`; final
fallback = flat placeholder avatar. (WhWz v2.4 renders Miis fully offline with an FFL
resource blob — overkill for us.)

## 5. Friend code derivation ✅ (verified: matches server records)

```
pid  = u32BE @ rkpd+0x5C
buf  = pid as 4 bytes little-endian ++ "JCMR" (= "RMCJ" reversed; RWFC hardcodes RMCJ for ALL regions)
fc   = ((MD5(buf)[0] >> 1) << 32) | pid        // 12 decimal digits
display: "XXXX-XXXX-XXXX"
```

Reverse (input validation of a user-typed FC): pid = fc mod 2^32, recompute checksum byte.
✅ 116944 → `3822-5220-6288`, confirmed by server lookup returning the same profile.

## 6. WheelWizard has no plugin system (source-audited)

No plugin loader, no scripting, no IPC/local server in the WhWz codebase; only integration
surfaces are the `wheelwizard://` URL protocol (GameBanana installs) and its plain JSON
files. ⇒ Deliverables should be a **standalone companion app** (+ OBS integration), reading
WhWz files read-only. This matches what the user asked for (OBS plugin + floating window).

## 7. Data-flow design for the overlay backend

**State machine:** `IDLE` (not in any room) ⇄ `IN_ROOM` (our FC present in roomstatus).

Polling cadence (all jittered, ETag/If-Modified-Since if honored):
- `roomstatus`: 30 s in IDLE → 10 s in IN_ROOM. (WhWz uses 40 s; kevinvg207 site ~10 s.)
- `player/{fc}`: 60 s in IDLE; refresh immediately when a race boundary is detected.
- `history?days=1`: on startup (seed "last race Δ" + session baseline), then on each race
  boundary; periodic 60 s while IN_ROOM as safety net.

**Race boundary detection** (drives the VR-gain animation): primary = our room's `race.num`
increments; confirmation/value = new entry in `history` (authoritative `vrChange`), plus
`player.vr` change. Emit one consolidated `raceCompleted {vrDelta, newVr, newRank, track}` event.

**Rank change**: compare `rank` between `player/{fc}` polls → `rankChanged {old,new}` event
(drives the rank animation; note rank can change without us racing — others gain VR).

**Identity hot-reload:** file-watch `config.json` (license switch via `FavoriteUser`),
`rksys.dat` (new license created), re-resolve on change. Also detect Dolphin running
(process list: `Dolphin.exe`, window title contains `RMC`/`Retro Rewind`) purely as a UX
nicety ("game detected" indicator) — not required for data.

**Offline/degraded modes:** no WhWz install → manual FC entry (validate via §5 reverse);
no network → show save/pul VR, hide rank; API 5xx → exponential backoff, keep last-good data
on screen (never blank the overlay mid-stream).

**Server load:** worst case ~6 req/min tiny JSON + 1×54 KB/10 s — comparable to one open
rr-rooms browser tab; well within polite range. Identify with a custom UA + repo URL.

## 8. What the API can't give us (and whether we care)

Not available from RWFC API: live in-race position, points during a race, room chat.
Live-position overlays require Dolphin memory reading (e.g. dolphin-memory-engine approach).
**Recommendation: v1 ships API-only** (covers 100% of the requested features: VR, ΔVR, rank,
tag, room/track extras). Memory reading = v2 option, pending prior-art research (§9).

## 9. Pending research (agents in flight — will be appended)

1. General RWFC/WiiLink ecosystem notes, rate-limit etiquette, error shapes (404 body for
   unknown FC), Mii studio conversion reference.
2. Prior art survey (existing overlay projects incl. the one in the reference VOD) +
   Dolphin memory-reading feasibility notes.

## 10. Raw evidence index (local, outside repo)

`%LOCALAPPDATA%\Temp\rr-probe\`: `roomstatus.json`, `leaderboard.json`, `player.json`,
`hist.json`, `hist2.json`, `me.json`, probe scripts `probe.js`, `identity.js` (working
reference implementations of the rksys/pul/FC parsing in Node).
