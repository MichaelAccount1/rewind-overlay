/**
 * Live player-data service (desktop).
 *
 * One poller feeds every overlay surface (OBS browser source, floating window,
 * Studio preview) through the local server's SSE stream. Data flow, endpoint
 * semantics and cadence rationale live in docs/research.md S7:
 *
 *   roomstatus (every poll tick)  -> are we in a room, live VR, race counter, track
 *   player/{fc} (60 s, or forced) -> global rank, vrStats, Mii image
 *   history/recent (seed + after each race) -> authoritative per-race VR change
 *
 * The state machine itself (race boundaries, provisional delta + history
 * reconciliation, value-stable snapshots) lives in live-engine.ts and is
 * shared with the standalone web overlay; this class adds what only the
 * desktop has: WheelWizard identity resolution with hot-reload, license
 * pinning/auto-follow, demo mode, and config-store integration.
 */
import { EventEmitter } from "node:events";
import type { ConfigStore } from "./store.js";
import { defaultPlayer, type OverlayConfig, type RuntimeStatus } from "./models.js";
import { resolveIdentity, formatFriendCode, sourceStamp, type License, type ResolvedIdentity } from "./identity.js";
import { buildUrls, fetchRoomStatus, findPlayerInRooms, type RwfcUrls } from "./rwfc.js";
import { LiveEngine, playerFingerprint, type OverlayPlayer, type PlayerExtras } from "./live-engine.js";

export type { OverlayPlayer, PlayerExtras };

const IDENTITY_RETRY_MS = 60_000;
const DEMO_IDENTITY_RETRY_MS = 15_000; // snappier probing so preview goes live soon after WhWz setup

/**
 * Additive status fields: the identity-detection trail for Studio's
 * troubleshooting panel, and the save's usable licenses for the license picker.
 */
export type OverlayStatus = RuntimeStatus & {
  identitySteps?: string[];
  licenses?: { slot: number; name: string; friendCode: string; active: boolean }[];
};

export class PlayerPoller extends EventEmitter {
  status: OverlayStatus = {
    phase: "starting",
    message: "Starting data service...",
    lastSuccessAt: null,
    lastPollAt: null,
    consecutiveErrors: 0,
    detectedFriendCode: ""
  };

  private engine = new LiveEngine(structuredClone(defaultPlayer));
  private timer: NodeJS.Timeout | null = null;
  private busy = false;
  private identity: ResolvedIdentity | null = null;
  private identityCheckedAt = 0;
  private identityStamp = "";
  /** The friend code the current player state belongs to; changing it resets race state. */
  private activeFriendCode = "";
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

  get player(): OverlayPlayer {
    return this.engine.player;
  }

  start(): void {
    this.stop();
    this.identity = null;
    this.identityCheckedAt = 0;
    this.identityStamp = "";
    this.activeFriendCode = "";
    this.manualModeFriendCode = "";
    this.engine.resetPolling();
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
      this.engine.player = structuredClone(defaultPlayer);
    } else {
      const player = this.engine.player;
      const vrChange = kind === "loss" ? -137 : kind === "gain" ? 241 : 0;
      const rankChange = kind === "rank" ? 8 : vrChange > 0 ? 2 : vrChange < 0 ? -1 : 0;
      const oldVr = player.vr;
      const oldRank = player.rank ?? 279;
      this.engine.player = {
        ...player,
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
    this.engine.setPlayer({
      ...this.engine.player,
      name: config.identity.playerName || this.engine.player.name,
      tag: config.identity.tag,
      source: "demo"
    });
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

    if (config.identity.mode === "manual" && !this.manualModeFriendCode) {
      const seat = findPlayerInRooms(roomStatus, friendCode, config.identity.playerName);
      if (seat) {
        this.manualModeFriendCode = seat.player.friendCode;
        friendCode = seat.player.friendCode;
      }
    }

    const switched = Boolean(friendCode) && Boolean(this.activeFriendCode) && friendCode !== this.activeFriendCode;
    if (switched) {
      const license = this.identity?.licenses.find((entry) => entry.friendCode === friendCode);
      this.engine.resetForNewPlayer({ friendCode, name: license?.name });
    }
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

    const result = await this.engine.update({
      urls,
      roomStatus,
      friendCode,
      fallbackName: config.identity.playerName,
      tag: config.identity.tag,
      displayName: config.identity.playerName,
      fallbackPlayerName: this.identity?.name ?? "",
      fallbackFriendCode: this.identity?.friendCode ?? "",
      fallbackVr: this.identity?.vr ?? null,
      forceRefresh: switched
    });

    if (!result.hasData) {
      this.becomeWaiting(config, friendCode
        ? "Waiting for the player to appear in a race or on the leaderboard"
        : "Waiting to spot the player name in a room");
      return;
    }

    this.status = {
      ...this.status,
      phase: "connected",
      message: result.seated ? "Live: in a room" : "Live: idle (not in a room)",
      lastSuccessAt: new Date().toISOString(),
      consecutiveErrors: 0
    };
    this.emit("change");
  }

  private becomeWaiting(config: OverlayConfig, message: string): void {
    // Keep something meaningful on screen: the save-file VR beats a blank panel.
    // Room-scoped data must never linger while we are not seated in a room
    // (user report: track names appearing while matchmaking).
    const player = this.engine.player;
    const next: OverlayPlayer = this.identity && player.source !== "rwfc"
      ? {
          ...player,
          name: this.identity.name || config.identity.playerName || player.name,
          tag: config.identity.tag,
          friendCode: this.identity.friendCode,
          vr: this.identity.vr ?? player.vr,
          online: false,
          room: "",
          race: null,
          extras: undefined,
          updatedAt: new Date().toISOString(),
          source: "manual"
        }
      : {
          ...player,
          online: false,
          room: "",
          race: null,
          extras: undefined,
          updatedAt: new Date().toISOString()
        };
    this.engine.setPlayer(next);
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

export { playerFingerprint };
