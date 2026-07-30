// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildUrls,
  fetchPlayerProfile,
  fetchRecentHistory,
  fetchRoomStatus,
  findPlayerInRooms,
  PlayerNotFoundError
} from "../../electron/rwfc.js";

const fixture = (name: string): unknown =>
  JSON.parse(fs.readFileSync(path.join(__dirname, "..", "fixtures", name), "utf8"));

const jsonResponse = (data: unknown, status = 200) =>
  ({ ok: status < 400, status, json: async () => data }) as Response;

const urls = buildUrls("https://rwfc.net/api/roomstatus", "https://rwfc.net/api/leaderboard/player/{friendCode}");

afterEach(() => vi.unstubAllGlobals());

describe("buildUrls", () => {
  it("expands the player template and derives sibling endpoints", () => {
    expect(urls.player("3951-3710-1436")).toBe("https://rwfc.net/api/leaderboard/player/3951-3710-1436");
    expect(urls.historyRecent("3951-3710-1436", 12)).toBe(
      "https://rwfc.net/api/leaderboard/player/3951-3710-1436/history/recent?count=12"
    );
    expect(urls.miiImage("3951-3710-1436")).toBe(
      "https://rwfc.net/api/leaderboard/player/3951-3710-1436/mii/image"
    );
  });

  it("tolerates a base URL without the placeholder", () => {
    const custom = buildUrls("https://mirror.example/api/roomstatus", "https://mirror.example/api/leaderboard/player");
    expect(custom.player("0000-0001-7063")).toBe("https://mirror.example/api/leaderboard/player/0000-0001-7063");
  });
});

describe("response parsing (real fixture payloads)", () => {
  it("parses roomstatus and keeps race/track metadata", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(fixture("roomstatus.json"))));
    const status = await fetchRoomStatus(urls);
    expect(status.rooms).toHaveLength(2);
    expect(status.rooms[0].race?.num).toBe(127);
    expect(status.rooms[0].race?.trackName).toContain("Shroom Ridge");
    expect(status.rooms[0].players[0].vr).toBe(77770);
  });

  it("parses the player profile", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(fixture("player.json"))));
    const profile = await fetchPlayerProfile(urls, "3951-3710-1436");
    expect(profile.rank).toBe(408);
    expect(profile.vrStats?.last24Hours).toBe(1363);
    expect(profile.miiImageBase64).toMatch(/^iVBOR/);
  });

  it("maps 404 on the profile to PlayerNotFoundError", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({}, 404)));
    await expect(fetchPlayerProfile(urls, "0000-0001-7063")).rejects.toBeInstanceOf(PlayerNotFoundError);
  });

  it("parses recent history in oldest→newest order", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(fixture("history-recent.json"))));
    const history = await fetchRecentHistory(urls, "3951-3710-1436");
    expect(history).toHaveLength(5);
    expect(history.at(-1)).toMatchObject({ vrChange: 23, totalVR: 77770 });
  });

  it("treats 404 history as an empty log (new player)", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({}, 404)));
    await expect(fetchRecentHistory(urls, "0000-0001-7063")).resolves.toEqual([]);
  });
});

describe("findPlayerInRooms", () => {
  it("matches by friend code regardless of formatting", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(fixture("roomstatus.json"))));
    const status = await fetchRoomStatus(urls);
    const seat = findPlayerInRooms(status, "395137101436");
    expect(seat?.player.name).toBe("omoney¿");
    expect(seat?.room.id).toBe("KUEJYC");
  });

  it("falls back to name matching only when no friend code is known", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(fixture("roomstatus.json"))));
    const status = await fetchRoomStatus(urls);
    expect(findPlayerInRooms(status, "", "cooper")?.player.friendCode).toBe("0085-9005-3475");
    // A known friend code that is not present must NOT fall back to the name.
    expect(findPlayerInRooms(status, "9999-9999-9999", "cooper")).toBeNull();
  });
});
