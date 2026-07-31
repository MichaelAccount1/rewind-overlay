/**
 * Browser-side data service for the standalone web overlay.
 *
 * Same live state machine as the desktop app (electron/live-engine.ts) minus
 * the desktop-only capabilities: no WheelWizard identity resolution (the
 * friend code comes from the URL), no demo auto-exit, no license auto-follow.
 * The rwfc.net API is CORS-open, so every visitor's browser polls it directly
 * -- there is no server of ours behind this.
 */
import { defaultPlayer } from "../../../electron/models";
import { buildUrls, fetchRoomStatus, findPlayerInRooms } from "../../../electron/rwfc";
import { LiveEngine, type OverlayPlayer } from "../../../electron/live-engine";
import type { WebSettings } from "./webConfig";

const OFFLINE_AFTER_MS = 45_000;

export interface WebStatus {
  phase: "starting" | "connected" | "waiting" | "offline" | "error";
  message: string;
  lastSuccessAt: string | null;
  lastPollAt: string | null;
  consecutiveErrors: number;
}

export interface WebSnapshot {
  player: OverlayPlayer;
  status: WebStatus;
}

type Listener = (snapshot: WebSnapshot) => void;

export class WebPoller {
  status: WebStatus = {
    phase: "starting",
    message: "Starting...",
    lastSuccessAt: null,
    lastPollAt: null,
    consecutiveErrors: 0
  };

  private engine = new LiveEngine(structuredClone(defaultPlayer));
  private listeners = new Set<Listener>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private busy = false;
  /** Friend code learned from a name match when the URL only carries ?name=. */
  private learnedFriendCode = "";
  private activeFriendCode = "";

  constructor(private settings: WebSettings) {}

  get player(): OverlayPlayer {
    return this.engine.player;
  }

  snapshot(): WebSnapshot {
    return { player: this.engine.player, status: this.status };
  }

  /** Fires immediately with the current snapshot, then on every change. */
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => this.listeners.delete(listener);
  }

  setSettings(next: WebSettings): void {
    const identityChanged =
      next.friendCode !== this.settings.friendCode || next.playerName !== this.settings.playerName;
    this.settings = next;
    if (identityChanged) {
      this.learnedFriendCode = "";
      this.activeFriendCode = "";
      this.engine.resetForNewPlayer({ friendCode: next.friendCode, name: next.playerName || undefined });
    }
    if (this.timer !== null) this.start();
  }

  start(): void {
    this.stop();
    const tick = () => {
      void this.poll().finally(() => {
        if (this.timer !== null) {
          this.timer = setTimeout(tick, this.settings.pollSeconds * 1000);
        }
      });
    };
    this.timer = setTimeout(tick, 0);
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private emitChange(): void {
    const snapshot = this.snapshot();
    for (const listener of this.listeners) listener(snapshot);
  }

  private async poll(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.status.lastPollAt = new Date().toISOString();
    try {
      if (this.settings.demo) {
        this.pollDemo();
        return;
      }
      await this.pollLive();
    } catch (error) {
      this.handleFailure(error);
    } finally {
      this.busy = false;
    }
  }

  private pollDemo(): void {
    this.engine.setPlayer({
      ...this.engine.player,
      name: this.settings.playerName || this.engine.player.name,
      tag: this.settings.tag,
      source: "demo"
    });
    this.status = {
      ...this.status,
      phase: "connected",
      message: "Preview mode",
      consecutiveErrors: 0,
      lastSuccessAt: new Date().toISOString()
    };
    this.emitChange();
  }

  private async pollLive(): Promise<void> {
    let friendCode = this.settings.friendCode || this.learnedFriendCode;
    if (!friendCode && !this.settings.playerName) {
      this.status = {
        ...this.status,
        phase: "waiting",
        message: "Add ?fc=XXXX-XXXX-XXXX (or ?name=) to the overlay URL",
        consecutiveErrors: 0
      };
      this.emitChange();
      return;
    }

    const urls = buildUrls(this.settings.config.data.groupsUrl, this.settings.config.data.leaderboardUrl);
    const roomStatus = await fetchRoomStatus(urls);

    if (!friendCode) {
      const seat = findPlayerInRooms(roomStatus, "", this.settings.playerName);
      if (seat) {
        this.learnedFriendCode = seat.player.friendCode;
        friendCode = seat.player.friendCode;
      }
    }

    const switched = Boolean(friendCode) && Boolean(this.activeFriendCode) && friendCode !== this.activeFriendCode;
    if (switched) this.engine.resetForNewPlayer({ friendCode });
    if (friendCode) this.activeFriendCode = friendCode;

    const result = await this.engine.update({
      urls,
      roomStatus,
      friendCode,
      fallbackName: this.settings.playerName,
      tag: this.settings.tag,
      displayName: this.settings.playerName,
      fallbackPlayerName: "",
      fallbackFriendCode: friendCode,
      fallbackVr: null,
      forceRefresh: switched
    });

    if (!result.hasData) {
      this.status = {
        ...this.status,
        phase: "waiting",
        message: friendCode
          ? "Waiting for the player to appear in a race or on the leaderboard"
          : "Waiting to spot the player name in a room",
        consecutiveErrors: 0
      };
      this.emitChange();
      return;
    }

    this.status = {
      ...this.status,
      phase: "connected",
      message: result.seated ? "Live: in a room" : "Live: idle (not in a room)",
      lastSuccessAt: new Date().toISOString(),
      consecutiveErrors: 0
    };
    this.emitChange();
  }

  private handleFailure(error: unknown): void {
    const errors = this.status.consecutiveErrors + 1;
    const lastSuccess = this.status.lastSuccessAt ? Date.parse(this.status.lastSuccessAt) : 0;
    const offline = Date.now() - lastSuccess > OFFLINE_AFTER_MS;
    this.status = {
      ...this.status,
      phase: offline && errors > 2 ? "offline" : "error",
      message: error instanceof Error ? error.message : "Unknown data error",
      consecutiveErrors: errors
    };
    // Last-good player data stays on screen; never blank the overlay mid-stream.
    this.emitChange();
  }
}
