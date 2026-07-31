/**
 * Live player-data service.
 *
 * One poller feeds every overlay surface (OBS browser source, floating window,
 * Studio preview) through the local server's SSE stream. Data flow, endpoint
 * semantics and cadence rationale live in docs/research.md S7:
 *
 *   roomstatus (every poll tick)  -> are we in a room, live VR, race counter, track
 *   player/{fc} (60 s, or forced) -> global rank, vrStats, Mii image
 *   history/recent (seed + after each race) -> authoritative per-race VR change
 *
 * Race boundaries are detected from the room's race counter / live VR movement;
 * the provisional delta is reconciled against the server's per-race history,
 * which the leaderboard sync writes within ~60 s.
 */
import { EventEmitter } from "node:events";
import type { ConfigStore } from "./store.js";
import { defaultPlayer, type OverlayConfig, type PlayerState, type RuntimeStatus } from "./models.js";
import { resolveIdentity, formatFriendCode, sourceStamp, type License, type ResolvedIdentity } from "./identity.js";
import {
  buildUrls,
  fetchPlayerProfile,
  fetchRecentHistory,
  fetchRoomStatus,
  findPlayerInRooms,
  PlayerNotFoundError,
  ROOM_KIND_NAMES,
  type HistoryEntry,
  type PlayerProfile,
  type RwfcUrls
} from "./rwfc.js";

const PROFILE_INTERVAL_MS = 60_000; // rank/vrStats only refresh server-side once a minute
const IDENTITY_RETRY_MS = 60_000;
const DEMO_IDENTITY_RETRY_MS = 15_000; // snappier probing so preview goes live soon after WhWz setup
const RECONCILE_RETRY_MS = 15_000;
const HISTORY_COUNT = 12;

/** Additive payload for the renderer; absent fields simply hide their widgets. */
export interface PlayerExtras {
  trackName: string;
  roomKind: string;
  roomId: string;
  cc: string;
  averageVr: number | null;
  roomPlayerCount: number | null;
  vrStats: { last24Hours: number; lastWeek: number; lastMonth: number } | null;
  sessionDelta: number | null;
  recentChanges: { date: string; vrChange: number; totalVr: number }[];
  lastSeen: string | null;
}

export type OverlayPlayer = PlayerState & { extras?: PlayerExtras };

/**
 * Value identity ignoring the timestamp: polls that change nothing must not
 * produce a new player object or updatedAt, because renderer animations key
 * on them and would replay on every poll (v1.0.1 user report).
 */
const playerFingerprint = (player: OverlayPlayer): string =>
  JSON.stringify({ ...player, updatedAt: "" });

/**
 * Additive status fields: the identity-detection trail for Studio's
 * troubleshooting panel, and the save's usable licenses for the license picker.
 */
export type OverlayStatus = RuntimeStatus & {
  identitySteps?: string[];
  licenses?: { slot: number; name: string; friendCode: string; active: boolean }[];
};

interface TrackedRace {
  roomId: string;
  raceNum: number | null;
}

export class PlayerPoller extends EventEmitter {
  player: OverlayPlayer = structuredClone(defaultPlayer);
  status: OverlayStatus = {
    phase: "starting",
    message: "Starting data service...",
    lastSuccessAt: null,
    lastPollAt: null,
    consecutiveErrors: 0,
    detectedFriendCode: ""
  };

  private timer: NodeJS.Timeout | null = null;
  private busy = false;
  private identity: ResolvedIdentity | null = null;
  private identityCheckedAt = 0;
  private identityStamp = "";
  /** The friend code the current player state belongs to; changing it resets race state. */
  private activeFriendCode = "";
  private profile: PlayerProfile | null = null;
  private profileFetchedAt = 0;
  private history: HistoryEntry[] = [];
  private historyFetchedAt = 0;
  private awaitingHistoryAfter: string | null = null;
  private lastRace: TrackedRace | null = null;
  private sessionStartVr: number | null = null;
  private manualModeFriendCode = "";
  /**
   * Preview auto-exits to live data once per process when a license is found,
   * so first-run users never sit on fake numbers. Deliberately NOT reset by
   * restart(): re-enabling preview in Studio afterwards must stick.
   */
  private demoAutoExited = false;

  constructor(private readonly store: ConfigStore) {
    super();
  }

  start(): void {
    this.stop();
    this.identity = null;
    this.identityCheckedAt = 0;
    this.identityStamp = "";
    this.activeFriendCode = "";
    this.profile = null;
    this.profileFetchedAt = 0;
    this.history = [];
    this.historyFetchedAt = 0;
    this.awaitingHistoryAfter = null;
    this.lastRace = null;
    this.manualModeFriendCode = "";
    const tick = () => {
      void this.poll().finally(() => {
        if (this.timer !== null) {
          this.timer = setTimeout(tick, this.store.get().data.pollSeconds * 1000);
        }
      });
    };
    this.timer = setTimeout(tick, 0);
  }

  restart(): void {
    this.start();
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  triggerDemo(kind: "gain" | "loss" | "rank" | "reset"): void {
    if (kind === "reset") {
      this.player = structuredClone(defaultPlayer);
    } else {
      const vrChange = kind === "loss" ? -137 : kind === "gain" ? 241 : 0;
      const rankChange = kind === "rank" ? 8 : vrChange > 0 ? 2 : vrChange < 0 ? -1 : 0;
      const oldVr = this.player.vr;
      const oldRank = this.player.rank ?? 279;
      this.player = {
        ...this.player,
        previousVr: oldVr,
        vr: Math.max(1, oldVr + vrChange),
        vrDelta: vrChange,
        previousRank: oldRank,
        rank: Math.max(1, oldRank - rankChange),
        rankDelta: rankChange,
        updatedAt: new Date().toISOString(),
        online: true,
        source: "demo"
      };
    }
    this.status = {
      ...this.status,
      phase: "connected",
      message: "Preview data active",
      lastSuccessAt: new Date().toISOString()
    };
    this.emit("change");
  }

  private async poll(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    const config = this.store.get();
    this.status.lastPollAt = new Date().toISOString();
    try {
      if (config.data.demoMode) {
        this.pollDemo(config);
        return;
      }
      const friendCode = this.resolveFriendCode(config);
      const urls = buildUrls(config.data.groupsUrl, config.data.leaderboardUrl);
      await this.pollLive(config, urls, friendCode);
    } catch (error) {
      this.handleFailure(config, error);
    } finally {
      this.busy = false;
    }
  }

  private pollDemo(config: OverlayConfig): void {
    // Preview keeps probing for a real identity (local files only, no network)
    // so a first-run user goes live automatically once WheelWizard/RR is set up.
    if (config.identity.mode === "auto") {
      const now = Date.now();
      if (!this.identity && now - this.identityCheckedAt > DEMO_IDENTITY_RETRY_MS) {
        this.identityCheckedAt = now;
        const probe = resolveIdentity();
        this.identity = probe.identity;
        this.status.identitySteps = probe.steps;
        this.identityStamp = probe.identity ? sourceStamp(probe.identity.sourcePaths) : "";
      }
      this.status.detectedFriendCode = this.identity?.friendCode ?? "";
      if (this.identity && !this.demoAutoExited) {
        this.demoAutoExited = true;
        this.store.update({ data: { demoMode: false } });
        this.status = {
          ...this.status,
          phase: "connected",
          message: `License "${this.identity.name}" detected -- switching to live data`,
          consecutiveErrors: 0,
          lastSuccessAt: new Date().toISOString()
        };
        this.emit("change");
        return; // next tick reads the updated config and takes the live path
      }
    }
    const next: OverlayPlayer = {
      ...this.player,
      name: config.identity.playerName || this.player.name,
      tag: config.identity.tag,
      source: "demo"
    };
    if (playerFingerprint(next) !== playerFingerprint(this.player)) {
      this.player = next;
    }
    this.status = {
      ...this.status,
      phase: "connected",
      message: "Preview mode",
      consecutiveErrors: 0,
      lastSuccessAt: new Date().toISOString()
    };
    this.emit("change");
  }

  /** Identity precedence: explicit friend code > WheelWizard auto-detection > name match. */
  private resolveFriendCode(config: OverlayConfig): string {
    if (config.identity.mode === "friendCode") {
      const friendCode = formatFriendCode(config.identity.friendCode);
      this.status.identitySteps = [`Using friend code from settings: ${friendCode || "(empty)"}`];
      return friendCode;
    }
    if (config.identity.mode === "manual") {
      this.status.identitySteps = [
        this.manualModeFriendCode
          ? `Matched "${config.identity.playerName}" in a room -> ${this.manualModeFriendCode}`
          : `Watching rooms for player name "${config.identity.playerName}"`
      ];
      return this.manualModeFriendCode; // learned from a name match in a room, if ever
    }
    const now = Date.now();
    if (this.identity) {
      // Hot-reload: the user renamed a license, switched slots in WheelWizard,
      // or the game flushed its save. Stamping mtimes is cheap enough per tick.
      const stamp = sourceStamp(this.identity.sourcePaths);
      if (stamp !== this.identityStamp) {
        this.identityStamp = stamp;
        const probe = resolveIdentity();
        this.status.identitySteps = probe.steps;
        if (probe.identity) {
          this.identity = probe.identity;
          this.identityStamp = sourceStamp(probe.identity.sourcePaths);
        }
        // A probe that fails mid-session keeps the last-good identity on screen.
      }
    } else if (now - this.identityCheckedAt > IDENTITY_RETRY_MS) {
      this.identityCheckedAt = now;
      const probe = resolveIdentity();
      this.identity = probe.identity;
      this.status.identitySteps = probe.steps;
      this.identityStamp = probe.identity ? sourceStamp(probe.identity.sourcePaths) : "";
    }
    this.status.detectedFriendCode = this.identity?.friendCode ?? "";
    return this.effectiveLicense(config)?.friendCode ?? this.identity?.friendCode ?? "";
  }

  /** The license the overlay should show: pinned slot if configured, else WheelWizard's pick. */
  private effectiveLicense(config: OverlayConfig): License | null {
    if (!this.identity) return null;
    const usable = this.identity.licenses.filter((license) => license.pid !== 0);
    if (config.identity.licenseSlot >= 0) {
      const pinned = usable.find((license) => license.slot === config.identity.licenseSlot);
      if (pinned) return pinned;
    }
    const identity = this.identity;
    return usable.find((license) => license.slot === identity.slot) ?? usable[0] ?? null;
  }

  /**
   * The player switched licenses (pin, WheelWizard change, or auto-follow):
   * everything race-related belongs to the old license and must not leak into
   * the new one's display (user report: inherited rank +/- after switching).
   */
  private resetForIdentitySwitch(friendCode: string): void {
    this.profile = null;
    this.profileFetchedAt = 0;
    this.history = [];
    this.historyFetchedAt = 0;
    this.awaitingHistoryAfter = null;
    this.lastRace = null;
    this.sessionStartVr = null;
    const license = this.identity?.licenses.find((entry) => entry.friendCode === friendCode);
    this.player = {
      ...this.player,
      name: license?.name ?? this.player.name,
      friendCode,
      previousVr: null,
      vrDelta: null,
      rank: null,
      previousRank: null,
      rankDelta: null,
      avatarUrl: "",
      updatedAt: new Date().toISOString()
    };
  }

  private async pollLive(config: OverlayConfig, urls: RwfcUrls, friendCode: string): Promise<void> {
    if (!friendCode && config.identity.mode !== "manual") {
      this.becomeWaiting(config, config.identity.mode === "auto"
        ? "WheelWizard/Retro Rewind save not found -- set a friend code in Studio"
        : "Enter a friend code in Studio");
      return;
    }

    const roomStatus = await fetchRoomStatus(urls);

    // Auto-follow: whichever of the save's licenses is actually online wins
    // (players commonly rotate between licenses mid-session).
    if (
      config.identity.mode === "auto" &&
      this.identity &&
      config.identity.followOnlineLicense &&
      config.identity.licenseSlot < 0
    ) {
      const online = this.identity.licenses
        .filter((license) => license.pid !== 0)
        .map((license) => license.friendCode)
        .filter((code) => findPlayerInRooms(roomStatus, code) !== null);
      if (online.length > 0 && !online.includes(friendCode)) {
        friendCode = online[0];
      }
    }

    let seat = findPlayerInRooms(roomStatus, friendCode, config.identity.playerName);
    if (config.identity.mode === "manual" && seat && !this.manualModeFriendCode) {
      this.manualModeFriendCode = seat.player.friendCode;
      friendCode = seat.player.friendCode;
      seat = findPlayerInRooms(roomStatus, friendCode);
    }

    const switched = Boolean(friendCode) && Boolean(this.activeFriendCode) && friendCode !== this.activeFriendCode;
    if (switched) this.resetForIdentitySwitch(friendCode);
    if (friendCode) this.activeFriendCode = friendCode;
    if (config.identity.mode === "auto") {
      this.status.detectedFriendCode = friendCode || this.status.detectedFriendCode;
      this.status.licenses = this.identity
        ? this.identity.licenses
            .filter((license) => license.pid !== 0)
            .map((license) => ({
              slot: license.slot,
              name: license.name,
              friendCode: license.friendCode,
              active: license.friendCode === friendCode
            }))
        : undefined;
    } else {
      this.status.licenses = undefined;
    }

    const raceEvent = seat ? this.detectRaceBoundary(seat.room.id, seat.room.race?.num ?? null) : false;
    const liveVr = seat?.player.vr ?? null;
    const vrMoved = seat !== null && liveVr !== null && this.player.source === "rwfc" &&
      this.player.online && liveVr !== this.player.vr;

    if (friendCode) {
      await this.refreshLeaderboardData(urls, friendCode, raceEvent || vrMoved || switched);
    }

    if (!seat && !this.profile) {
      this.becomeWaiting(config, friendCode
        ? "Waiting for the player to appear in a race or on the leaderboard"
        : "Waiting to spot the player name in a room");
      return;
    }

    this.applyLiveState(config, seat, liveVr, vrMoved);
  }

  /** Rank, vrStats and Mii refresh on a 60 s cadence; a race boundary forces both fetches. */
  private async refreshLeaderboardData(urls: RwfcUrls, friendCode: string, force: boolean): Promise<void> {
    const now = Date.now();
    if (force || !this.profile || now - this.profileFetchedAt > PROFILE_INTERVAL_MS) {
      try {
        this.profile = await fetchPlayerProfile(urls, friendCode);
        this.profileFetchedAt = now;
      } catch (error) {
        if (!(error instanceof PlayerNotFoundError)) throw error;
        this.profile = null; // brand-new player: valid FC, no leaderboard row yet
        this.profileFetchedAt = now;
      }
    }

    const seeding = this.historyFetchedAt === 0;
    const reconciling = this.awaitingHistoryAfter !== null && now - this.historyFetchedAt > RECONCILE_RETRY_MS;
    if (seeding || force || reconciling) {
      const history = await fetchRecentHistory(urls, friendCode, HISTORY_COUNT);
      this.historyFetchedAt = now;
      const latest = history.at(-1);
      if (this.awaitingHistoryAfter && latest && latest.date > this.awaitingHistoryAfter) {
        this.awaitingHistoryAfter = null; // the settled per-race value replaces the provisional diff
      }
      this.history = history;
    }
  }

  private detectRaceBoundary(roomId: string, raceNum: number | null): boolean {
    const previous = this.lastRace;
    this.lastRace = { roomId, raceNum };
    return previous !== null && previous.roomId === roomId &&
      previous.raceNum !== null && raceNum !== null && raceNum > previous.raceNum;
  }

  private applyLiveState(
    config: OverlayConfig,
    seat: ReturnType<typeof findPlayerInRooms>,
    liveVr: number | null,
    vrMoved: boolean
  ): void {
    const profile = this.profile;
    const latestChange = this.history.at(-1);
    const vr = liveVr ?? profile?.vr ?? this.identity?.vr ?? this.player.vr;

    if (this.sessionStartVr === null) this.sessionStartVr = vr;
    if (vrMoved && liveVr !== null) {
      // Provisional last-race delta from the live room feed; history reconciles it.
      this.player.previousVr = this.player.vr;
      this.player.vrDelta = liveVr - this.player.vr;
      this.awaitingHistoryAfter = latestChange?.date ?? new Date(0).toISOString();
    } else if (latestChange && !this.awaitingHistoryAfter) {
      this.player.vrDelta = latestChange.vrChange;
      this.player.previousVr = latestChange.totalVR - latestChange.vrChange;
    }

    const oldRank = this.player.source === "rwfc" ? this.player.rank : null;
    const rank = profile?.rank ?? null;
    const rankChanged = oldRank !== null && rank !== null && rank !== oldRank;

    const room = seat?.room ?? null;
    const name = seat?.player.name || profile?.name || this.identity?.name || config.identity.playerName || "Player";
    const friendCode = seat?.player.friendCode || profile?.friendCode || this.identity?.friendCode || "";

    const next: OverlayPlayer = {
      name,
      tag: config.identity.tag,
      friendCode,
      vr,
      previousVr: this.player.previousVr,
      vrDelta: this.player.vrDelta,
      rank,
      previousRank: rankChanged ? oldRank : this.player.previousRank,
      rankDelta: rankChanged && oldRank !== null && rank !== null ? oldRank - rank : this.player.rankDelta,
      avatarUrl: profile?.miiImageBase64
        ? `data:image/png;base64,${profile.miiImageBase64}`
        : this.player.avatarUrl,
      room: room ? room.roomType || ROOM_KIND_NAMES[room.rk] || room.rk : "",
      race: room?.race?.num ?? null,
      online: seat !== null,
      updatedAt: new Date().toISOString(),
      source: "rwfc",
      extras: {
        trackName: room?.race?.trackName ?? "",
        roomKind: room ? ROOM_KIND_NAMES[room.rk] ?? room.rk : "",
        roomId: room?.id ?? "",
        cc: room?.race?.cc === 1 ? "200cc" : room?.race?.cc === 2 ? "150cc" : "",
        averageVr: room?.averageVR ?? null,
        roomPlayerCount: room ? room.players.length : null,
        vrStats: profile?.vrStats ?? null,
        sessionDelta: this.sessionStartVr !== null ? vr - this.sessionStartVr : null,
        recentChanges: this.history.map((entry) => ({
          date: entry.date,
          vrChange: entry.vrChange,
          totalVr: entry.totalVR
        })),
        lastSeen: profile?.lastSeen ?? null
      }
    };
    if (playerFingerprint(next) !== playerFingerprint(this.player)) {
      this.player = next;
    }
    this.status = {
      ...this.status,
      phase: "connected",
      message: seat ? "Live: in a room" : "Live: idle (not in a room)",
      lastSuccessAt: new Date().toISOString(),
      consecutiveErrors: 0
    };
    this.emit("change");
  }

  private becomeWaiting(config: OverlayConfig, message: string): void {
    // Keep something meaningful on screen: the save-file VR beats a blank panel.
    // Room-scoped data must never linger while we are not seated in a room
    // (user report: track names appearing while matchmaking).
    const next: OverlayPlayer = this.identity && this.player.source !== "rwfc"
      ? {
          ...this.player,
          name: this.identity.name || config.identity.playerName || this.player.name,
          tag: config.identity.tag,
          friendCode: this.identity.friendCode,
          vr: this.identity.vr ?? this.player.vr,
          online: false,
          room: "",
          race: null,
          extras: undefined,
          updatedAt: new Date().toISOString(),
          source: "manual"
        }
      : {
          ...this.player,
          online: false,
          room: "",
          race: null,
          extras: undefined,
          updatedAt: new Date().toISOString()
        };
    if (playerFingerprint(next) !== playerFingerprint(this.player)) {
      this.player = next;
    }
    this.status = {
      ...this.status,
      phase: "waiting",
      message,
      consecutiveErrors: 0,
      lastSuccessAt: this.status.lastSuccessAt
    };
    this.emit("change");
  }

  private handleFailure(config: OverlayConfig, error: unknown): void {
    const errors = this.status.consecutiveErrors + 1;
    const lastSuccess = this.status.lastSuccessAt ? Date.parse(this.status.lastSuccessAt) : 0;
    const offline = Date.now() - lastSuccess > config.data.offlineAfterSeconds * 1000;
    this.status = {
      ...this.status,
      phase: offline && errors > 2 ? "offline" : "error",
      message: error instanceof Error ? error.message : "Unknown data error",
      consecutiveErrors: errors
    };
    // Last-good player data stays on screen; never blank the overlay mid-stream.
    this.emit("change");
  }
}
