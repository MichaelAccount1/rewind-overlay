/**
 * Typed client for the Retro WFC (rwfc.net) HTTP API.
 *
 * Endpoints, schemas and polling etiquette are documented in docs/research.md --
 * every field consumed here was verified against live responses. The server is
 * Cloudflare-fronted and rate-limited at 2000 req/min/IP; the app keeps a single
 * shared poller far below that, and identifies itself with an honest User-Agent.
 */
import { z } from "zod";

export const USER_AGENT = "RewindOverlay/1.0 (+https://github.com/MichaelAccount1/rewind-overlay)";
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

// --- Schemas ---------------------------------------------------------------
// Every field must survive null, absence, and type drift: the live feed sends
// null for fields like room.rk (battle/private rooms), and a single bad field
// in one of ~25 rooms must never take down the whole overlay (v1.0.0 bug).

/** string; null/missing/garbage -> fallback */
const lenientString = (fallback = "") =>
  z
    .string()
    .nullish()
    .transform((value) => value ?? fallback)
    .catch(fallback);

/** string from string|number ids; null/missing/garbage -> "" */
const lenientIdString = z
  .union([z.string(), z.number()])
  .nullish()
  .transform((value) => (value == null ? "" : String(value)))
  .catch("");

/** number; null/missing/garbage/NaN -> null */
const lenientNumber = z.coerce
  .number()
  .nullish()
  .transform((value) => (typeof value === "number" && Number.isFinite(value) ? value : null))
  .catch(null);

/** number; null/missing/garbage/NaN -> 0 */
const lenientCount = z.coerce
  .number()
  .nullish()
  .transform((value) => (typeof value === "number" && Number.isFinite(value) ? value : 0))
  .catch(0);

/** boolean; null/missing/garbage -> fallback */
const lenientBoolean = (fallback: boolean) =>
  z
    .boolean()
    .nullish()
    .transform((value) => value ?? fallback)
    .catch(fallback);

const roomPlayerSchema = z.object({
  pid: lenientIdString,
  name: lenientString(),
  friendCode: lenientString(),
  vr: lenientNumber,
  br: lenientNumber,
  isOpenHost: lenientBoolean(false),
  isSuspended: lenientBoolean(false),
  mii: z
    .object({ data: lenientString(), name: lenientString() })
    .nullish()
    .catch(null)
    .transform((value) => value ?? null),
  slotId: lenientIdString
});

const roomSchema = z.object({
  id: lenientString(),
  type: lenientString(),
  created: lenientString(),
  host: lenientIdString,
  rk: lenientString(),
  players: z
    .array(roomPlayerSchema)
    .nullish()
    .transform((value) => value ?? [])
    .catch([]),
  averageVR: lenientNumber,
  race: z
    .object({
      num: lenientNumber,
      course: lenientNumber,
      cc: lenientNumber,
      trackName: lenientString()
    })
    .nullish()
    .catch(null)
    .transform((value) => value ?? null),
  roomType: lenientString(),
  isPublic: lenientBoolean(true),
  isJoinable: lenientBoolean(true),
  isSuspended: lenientBoolean(false)
});

const roomStatusSchema = z.object({
  rooms: z
    .array(roomSchema)
    .nullish()
    .transform((value) => value ?? [])
    .catch([]),
  timestamp: lenientString().nullish()
});

const vrStatsSchema = z.object({
  last24Hours: lenientCount,
  lastWeek: lenientCount,
  lastMonth: lenientCount
});

const playerProfileSchema = z.object({
  pid: lenientIdString,
  name: lenientString(),
  friendCode: lenientString(),
  vr: lenientCount,
  rank: lenientNumber,
  lastSeen: lenientString().nullish(),
  isSuspicious: lenientBoolean(false),
  vrStats: vrStatsSchema
    .nullish()
    .catch(null)
    .transform((value) => value ?? null),
  miiImageBase64: lenientString().nullish()
});

const historyEntrySchema = z.object({
  date: lenientString(),
  vrChange: lenientCount,
  totalVR: lenientCount
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
