// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebPoller } from "../../src/web/data/webPoller";
import { parseWebSettings } from "../../src/web/data/webConfig";

const fixture = (name: string): unknown =>
  JSON.parse(fs.readFileSync(path.join(__dirname, "..", "fixtures", name), "utf8"));

const FC = "3951-3710-1436";

function stubRoutes(routes: Record<string, unknown | (() => unknown)>): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      for (const [prefix, data] of Object.entries(routes)) {
        if (url === prefix || url.startsWith(prefix)) {
          const value = typeof data === "function" ? (data as () => unknown)() : data;
          if (value instanceof Error) throw value;
          if (typeof value === "number") return { ok: value < 400, status: value, json: async () => ({}) } as Response;
          return { ok: true, status: 200, json: async () => value } as Response;
        }
      }
      return { ok: false, status: 404, json: async () => ({}) } as Response;
    })
  );
}

const poll = (poller: WebPoller): Promise<void> =>
  (poller as unknown as { poll: () => Promise<void> }).poll();

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-07-31T02:00:00Z"));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("WebPoller", () => {
  it("serves live data for a URL friend code, same shape as the desktop poller", async () => {
    stubRoutes({
      "https://rwfc.net/api/roomstatus": fixture("roomstatus.json"),
      [`https://rwfc.net/api/leaderboard/player/${FC}/history/recent`]: fixture("history-recent.json"),
      [`https://rwfc.net/api/leaderboard/player/${FC}`]: fixture("player.json")
    });
    const poller = new WebPoller(parseWebSettings(`?fc=${FC}&tag=OMY`));
    await poll(poller);

    expect(poller.status.phase).toBe("connected");
    expect(poller.player).toMatchObject({
      name: "omoney¿",
      tag: "OMY",
      friendCode: FC,
      vr: 77770,
      rank: 408,
      room: "Retro Tracks",
      online: true,
      source: "rwfc"
    });
    expect(poller.player.vrDelta).toBe(23); // seeded from authoritative history
    expect(poller.player.extras?.trackName).toContain("Shroom Ridge");
    expect(poller.player.avatarUrl.startsWith("data:image/png;base64,")).toBe(true);
  });

  it("learns the friend code from a name-only URL", async () => {
    stubRoutes({
      "https://rwfc.net/api/roomstatus": fixture("roomstatus.json"),
      "https://rwfc.net/api/leaderboard/player/0085-9005-3475/history/recent": [],
      "https://rwfc.net/api/leaderboard/player/0085-9005-3475": {
        pid: "118883", name: "Cooper", friendCode: "0085-9005-3475", vr: 51309, rank: 1234
      }
    });
    const poller = new WebPoller(parseWebSettings("?name=Cooper"));
    await poll(poller);
    expect(poller.player.friendCode).toBe("0085-9005-3475");
    expect(poller.player.rank).toBe(1234);
  });

  it("keeps snapshots value-stable across unchanged polls", async () => {
    stubRoutes({
      "https://rwfc.net/api/roomstatus": fixture("roomstatus.json"),
      [`https://rwfc.net/api/leaderboard/player/${FC}/history/recent`]: fixture("history-recent.json"),
      [`https://rwfc.net/api/leaderboard/player/${FC}`]: fixture("player.json")
    });
    const poller = new WebPoller(parseWebSettings(`?fc=${FC}`));
    await poll(poller);
    const before = poller.player;
    vi.setSystemTime(new Date("2026-07-31T02:00:10Z"));
    await poll(poller);
    expect(poller.player).toBe(before);
  });

  it("stays in preview mode for demo URLs and never fetches", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const poller = new WebPoller(parseWebSettings("?demo=1&name=Preview"));
    await poll(poller);
    expect(poller.status.phase).toBe("connected");
    expect(poller.player.source).toBe("demo");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("asks for an identity when the URL has none and demo is off", async () => {
    const settings = parseWebSettings("");
    settings.demo = false;
    const poller = new WebPoller(settings);
    await poll(poller);
    expect(poller.status.phase).toBe("waiting");
    expect(poller.status.message).toContain("?fc=");
  });

  it("keeps last-good data and reports errors on API failure", async () => {
    stubRoutes({
      "https://rwfc.net/api/roomstatus": fixture("roomstatus.json"),
      [`https://rwfc.net/api/leaderboard/player/${FC}/history/recent`]: fixture("history-recent.json"),
      [`https://rwfc.net/api/leaderboard/player/${FC}`]: fixture("player.json")
    });
    const poller = new WebPoller(parseWebSettings(`?fc=${FC}`));
    await poll(poller);
    expect(poller.player.vr).toBe(77770);

    stubRoutes({ "https://rwfc.net/api/roomstatus": new Error("network down") });
    await poll(poller);
    expect(poller.status.phase).toBe("error");
    expect(poller.player.vr).toBe(77770);
  });

  it("notifies subscribers immediately and on changes", async () => {
    stubRoutes({
      "https://rwfc.net/api/roomstatus": fixture("roomstatus.json"),
      [`https://rwfc.net/api/leaderboard/player/${FC}/history/recent`]: fixture("history-recent.json"),
      [`https://rwfc.net/api/leaderboard/player/${FC}`]: fixture("player.json")
    });
    const poller = new WebPoller(parseWebSettings(`?fc=${FC}`));
    const seen: string[] = [];
    poller.subscribe(({ status }) => seen.push(status.phase));
    expect(seen).toEqual(["starting"]);
    await poll(poller);
    expect(seen.at(-1)).toBe("connected");
  });

  it("resets per-player state when settings switch identities", async () => {
    stubRoutes({
      "https://rwfc.net/api/roomstatus": fixture("roomstatus.json"),
      [`https://rwfc.net/api/leaderboard/player/${FC}/history/recent`]: fixture("history-recent.json"),
      [`https://rwfc.net/api/leaderboard/player/${FC}`]: fixture("player.json")
    });
    const poller = new WebPoller(parseWebSettings(`?fc=${FC}`));
    await poll(poller);
    expect(poller.player.rank).toBe(408);

    stubRoutes({
      "https://rwfc.net/api/roomstatus": { rooms: [] },
      "https://rwfc.net/api/leaderboard/player/0085-9005-3475/history/recent": [],
      "https://rwfc.net/api/leaderboard/player/0085-9005-3475": {
        pid: "118883", name: "Cooper", friendCode: "0085-9005-3475", vr: 51309, rank: 1234
      }
    });
    poller.setSettings(parseWebSettings("?fc=0085-9005-3475"));
    await poll(poller);
    expect(poller.player.friendCode).toBe("0085-9005-3475");
    expect(poller.player.rank).toBe(1234);
    expect(poller.player.vrDelta).toBeNull();
    expect(poller.player.rankDelta).toBeNull();
  });
});
