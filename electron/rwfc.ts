/**
 * Typed client for the Retro WFC (rwfc.net) HTTP API.
 *
 * Endpoints, schemas and polling etiquette are documented in docs/research.md --
 * every field consumed here was verified against live responses. The server is
 * Cloudflare-fronted and rate-limited at 2000 req/min/IP; the app keeps a single
 * shared poller far below that, and identifies itself with an honest User-Agent.
 */
import { z } from "zod";

export const USER_AGENT = "RewindOverlay/1.0 (+https://github.com/rewind-overlay)";
const TIMEOUT_MS = 10_000;

/** Distinguishes "player has never been seen by the leaderboard" from real failures. */
export class PlayerNotFoundError extends Error {
  constructor(friendCode: string) {
    super(`Player ${friendCode} is not on the RWFC leaderboard yet`);
    this.name = "PlayerNotFoundError";
  }
}

export class RwfcHttpError extends Error {
  constructor(readonly status: number, url: string) {
    super(`HTTP ${status} from ${new URL(url).host}`);
    this.name = "RwfcHttpError";
  }
}

// --- Schemas (deliberately lenient: unknown fields pass through, absent ones default) ---

const roomPlayerSchema = z.object({
  pid: z.coerce.string().default(""),
  name: z.string().default(""),
  friendCode: z.string().default(""),
  vr: z.coerce.number().nullish(),
  br: z.coerce.number().nullish(),
  isOpenHost: z.boolean().default(false),
  isSuspended: z.boolean().default(false),
  mii: z.object({ data: z.string().default(""), name: z.string().default("") }).nullish(),
  slotId: z.coerce.string().default("")
});

const roomSchema = z.object({
  id: z.string().default(""),
  type: z.string().default(""),
  created: z.string().default(""),
  host: z.coerce.string().default(""),
  rk: z.string().default(""),
  players: z.array(roomPlayerSchema).default([]),
  averageVR: z.coerce.number().nullish(),
  race: z
    .object({
      num: z.coerce.number().nullish(),
      course: z.coerce.number().nullish(),
      cc: z.coerce.number().nullish(),
      trackName: z.string().nullish()
    })
    .nullish(),
  roomType: z.string().default(""),
  isPublic: z.boolean().default(true),
  isJoinable: z.boolean().default(true),
  isSuspended: z.boolean().default(false)
});

const roomStatusSchema = z.object({
  rooms: z.array(roomSchema).default([]),
  timestamp: z.string().nullish()
});

const vrStatsSchema = z.object({
  last24Hours: z.coerce.number().default(0),
  lastWeek: z.coerce.number().default(0),
  lastMonth: z.coerce.number().default(0)
});

const playerProfileSchema = z.object({
  pid: z.coerce.string().default(""),
  name: z.string().default(""),
  friendCode: z.string().default(""),
  vr: z.coerce.number().default(0),
  rank: z.coerce.number().nullish(),
  lastSeen: z.string().nullish(),
  isSuspicious: z.boolean().default(false),
  vrStats: vrStatsSchema.nullish(),
  miiImageBase64: z.string().nullish()
});

const historyEntrySchema = z.object({
  date: z.string().default(""),
  vrChange: z.coerce.number().default(0),
  totalVR: z.coerce.number().default(0)
});

export type RoomStatus = z.infer<typeof roomStatusSchema>;
export type Room = z.infer<typeof roomSchema>;
export type RoomPlayer = z.infer<typeof roomPlayerSchema>;
export type PlayerProfile = z.infer<typeof playerProfileSchema>;
export type HistoryEntry = z.infer<typeof historyEntrySchema>;

/** Human-readable names for the `rk` room-kind codes (docs/research.md S2). */
export const ROOM_KIND_NAMES: Record<string, string> = {
  vs_10: "Retro Tracks",
  vs_11: "Online Time Trial",
  vs_12: "200cc",
  vs_13: "Item Rain",
  vs_14: "Regular Battle",
  vs_15: "Elimination Battle",
  vs_20: "Custom Tracks",
  vs_21: "Vanilla Tracks",
  vs_22: "Custom Tracks 200cc"
};

export interface RwfcUrls {
  roomStatus: string;
  player: (friendCode: string) => string;
  historyRecent: (friendCode: string, count: number) => string;
  miiImage: (friendCode: string) => string;
}

/**
 * The store keeps two user-overridable URLs (self-hosters/mirrors): the room
 * status URL and the player URL template. Sibling endpoints are derived from
 * the player template so a mirrored base keeps everything consistent.
 */
export function buildUrls(groupsUrl: string, leaderboardUrl: string): RwfcUrls {
  const playerTemplate = leaderboardUrl.includes("{friendCode}")
    ? leaderboardUrl
    : leaderboardUrl.replace(/\/+$/, "") + "/{friendCode}";
  const player = (fc: string) => playerTemplate.replace("{friendCode}", encodeURIComponent(fc));
  return {
    roomStatus: groupsUrl,
    player,
    historyRecent: (fc, count) => `${player(fc)}/history/recent?count=${count}`,
    miiImage: (fc) => `${player(fc)}/mii/image`
  };
}

async function fetchJson(url: string): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json", "User-Agent": USER_AGENT }
    });
    if (response.status === 404) throw new RwfcHttpError(404, url);
    if (!response.ok) throw new RwfcHttpError(response.status, url);
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchRoomStatus(urls: RwfcUrls): Promise<RoomStatus> {
  return roomStatusSchema.parse(await fetchJson(urls.roomStatus));
}

export async function fetchPlayerProfile(urls: RwfcUrls, friendCode: string): Promise<PlayerProfile> {
  try {
    return playerProfileSchema.parse(await fetchJson(urls.player(friendCode)));
  } catch (error) {
    if (error instanceof RwfcHttpError && error.status === 404) throw new PlayerNotFoundError(friendCode);
    throw error;
  }
}

export async function fetchRecentHistory(
  urls: RwfcUrls,
  friendCode: string,
  count = 10
): Promise<HistoryEntry[]> {
  try {
    const parsed = z.array(historyEntrySchema).parse(await fetchJson(urls.historyRecent(friendCode, count)));
    // Server returns oldest->newest; keep that order and let callers take .at(-1).
    return parsed;
  } catch (error) {
    if (error instanceof RwfcHttpError && error.status === 404) return [];
    throw error;
  }
}

/** Find the room (and player entry) a friend code is currently sitting in, if any. */
export function findPlayerInRooms(
  status: RoomStatus,
  friendCode: string,
  fallbackName = ""
): { room: Room; player: RoomPlayer } | null {
  const digits = friendCode.replace(/\D/g, "");
  const wanted = fallbackName.trim().toLocaleLowerCase();
  let nameMatch: { room: Room; player: RoomPlayer } | null = null;
  for (const room of status.rooms) {
    for (const player of room.players) {
      if (digits && player.friendCode.replace(/\D/g, "") === digits) return { room, player };
      if (!nameMatch && wanted && player.name.trim().toLocaleLowerCase() === wanted) {
        nameMatch = { room, player };
      }
    }
  }
  // Name matching only backs up manual mode (no friend code known yet).
  return digits ? null : nameMatch;
}
