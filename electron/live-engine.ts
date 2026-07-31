/**
 * Shared live-overlay state machine, used by BOTH the desktop app's poller
 * (electron/poller.ts) and the standalone web overlay (src/web/data/).
 *
 * Browser-safe: imports only models.js and rwfc.js (like overlay-layout.ts).
 * Everything machine-specific -- WheelWizard identity resolution, demo mode,
 * license auto-follow, config storage -- stays in the callers; this module
 * owns the hard part they must not diverge on:
 *
 *   seat finding, race-boundary detection, provisional VR delta + history
 *   reconciliation, leaderboard fetch cadences, and value-stable player
 *   snapshots (unchanged data keeps the same object + updatedAt so renderer
 *   animations don't replay).
 */
import type { PlayerState } from "./models.js";
import {
  fetchPlayerProfile,
  fetchRecentHistory,
  findPlayerInRooms,
  PlayerNotFoundError,
  ROOM_KIND_NAMES,
  type HistoryEntry,
  type PlayerProfile,
  type RoomStatus,
  type RwfcUrls
} from "./rwfc.js";

export const PROFILE_INTERVAL_MS = 60_000; // rank/vrStats only refresh server-side once a minute
export const RECONCILE_RETRY_MS = 15_000;
export const HISTORY_COUNT = 12;

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
export const playerFingerprint = (player: OverlayPlayer): string =>
  JSON.stringify({ ...player, updatedAt: "" });

interface TrackedRace {
  roomId: string;
  raceNum: number | null;
}

export interface LiveUpdateInput {
  urls: RwfcUrls;
  /** Fetched by the caller so it can run license auto-follow / manual name learning first. */
  roomStatus: RoomStatus;
  friendCode: string;
  /** Name used for room matching when no friend code is known (manual mode). */
  fallbackName: string;
  tag: string;
  /** Display fallbacks when neither the room nor the profile knows the player. */
  displayName: string;
  fallbackPlayerName: string;
  fallbackFriendCode: string;
  fallbackVr: number | null;
  /** Force profile/history fetches now (e.g. the caller just switched licenses). */
  forceRefresh: boolean;
}

export interface LiveUpdateResult {
  seated: boolean;
  /** false = no room seat AND no leaderboard profile; caller shows its waiting state. */
  hasData: boolean;
}

export class LiveEngine {
  player: OverlayPlayer;

  private profile: PlayerProfile | null = null;
  private profileFetchedAt = 0;
  private history: HistoryEntry[] = [];
  private historyFetchedAt = 0;
  private awaitingHistoryAfter: string | null = null;
  private lastRace: TrackedRace | null = null;
  private sessionStartVr: number | null = null;

  constructor(initialPlayer: OverlayPlayer) {
    this.player = initialPlayer;
  }

  /** Fingerprint-guarded replace: unchanged values keep the old object + updatedAt. */
  setPlayer(next: OverlayPlayer): void {
    if (playerFingerprint(next) !== playerFingerprint(this.player)) {
      this.player = next;
    }
  }

  /** Restart polling state without touching the on-screen player or session baseline. */
  resetPolling(): void {
    this.profile = null;
    this.profileFetchedAt = 0;
    this.history = [];
    this.historyFetchedAt = 0;
    this.awaitingHistoryAfter = null;
    this.lastRace = null;
  }

  /**
   * The tracked player changed (license switch, new friend code): everything
   * race-related belongs to the old player and must not leak into the new
   * one's display (user report: inherited rank +/- after switching licenses).
   */
  resetForNewPlayer(patch: { friendCode: string; name?: string }): void {
    this.resetPolling();
    this.sessionStartVr = null;
    this.player = {
      ...this.player,
      name: patch.name ?? this.player.name,
      friendCode: patch.friendCode,
      previousVr: null,
      vrDelta: null,
      rank: null,
      previousRank: null,
      rankDelta: null,
      avatarUrl: "",
      updatedAt: new Date().toISOString()
    };
  }

  async update(input: LiveUpdateInput): Promise<LiveUpdateResult> {
    const seat = findPlayerInRooms(input.roomStatus, input.friendCode, input.fallbackName);

    const raceEvent = seat ? this.detectRaceBoundary(seat.room.id, seat.room.race?.num ?? null) : false;
    const liveVr = seat?.player.vr ?? null;
    const vrMoved = seat !== null && liveVr !== null && this.player.source === "rwfc" &&
      this.player.online && liveVr !== this.player.vr;

    if (input.friendCode) {
      await this.refreshLeaderboardData(input.urls, input.friendCode, raceEvent || vrMoved || input.forceRefresh);
    }

    if (!seat && !this.profile) {
      return { seated: false, hasData: false };
    }

    this.applyLiveState(input, seat, liveVr, vrMoved);
    return { seated: seat !== null, hasData: true };
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
    input: LiveUpdateInput,
    seat: ReturnType<typeof findPlayerInRooms>,
    liveVr: number | null,
    vrMoved: boolean
  ): void {
    const profile = this.profile;
    const latestChange = this.history.at(-1);
    const vr = liveVr ?? profile?.vr ?? input.fallbackVr ?? this.player.vr;

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
    const name = seat?.player.name || profile?.name || input.fallbackPlayerName || input.displayName || "Player";
    const friendCode = seat?.player.friendCode || profile?.friendCode || input.fallbackFriendCode || "";

    const next: OverlayPlayer = {
      name,
      tag: input.tag,
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
    this.setPlayer(next);
  }
}
