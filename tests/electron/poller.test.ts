// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PlayerPoller } from "../../electron/poller.js";
import { defaultConfig, type OverlayConfig } from "../../electron/models.js";
import type { ConfigStore } from "../../electron/store.js";
import type { IdentityProbe } from "../../electron/identity.js";

// Identity resolution reads real machine state; tests must control it.
const { resolveIdentityMock } = vi.hoisted(() => ({ resolveIdentityMock: vi.fn() }));
vi.mock("../../electron/identity.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../electron/identity.js")>();
  return { ...actual, resolveIdentity: resolveIdentityMock };
});

const noInstallProbe: IdentityProbe = { identity: null, steps: ["WheelWizard folder not found (mock)"] };
const foundProbe: IdentityProbe = {
  identity: {
    friendCode: "3951-3710-1436",
    pid: 110204,
    name: "omoney¿",
    slot: 0,
    vr: 77000,
    br: 5000,
    savePath: "C:\\mock\\rksys.dat",
    saveModifiedAt: "2026-07-30T00:00:00.000Z",
    licenses: []
  },
  steps: ["License slot 0 \"omoney¿\" -> friend code 3951-3710-1436 (mock)"]
};

const fixture = (name: string): unknown =>
  JSON.parse(fs.readFileSync(path.join(__dirname, "..", "fixtures", name), "utf8"));

const FC = "3951-3710-1436";

function makeConfig(patch: Partial<OverlayConfig["identity"]> = {}): OverlayConfig {
  const config = structuredClone(defaultConfig);
  config.data.demoMode = false;
  config.identity = { mode: "friendCode", friendCode: "395137101436", playerName: "", tag: "OMY", ...patch };
  return config;
}

/** Fake store whose update() mutates the held config, like the real one. */
function makeStore(config: OverlayConfig): ConfigStore & { updates: unknown[] } {
  const updates: unknown[] = [];
  return {
    get: () => structuredClone(config),
    update: (patch: { data?: Partial<OverlayConfig["data"]> }) => {
      updates.push(patch);
      if (patch?.data) Object.assign(config.data, patch.data);
      return structuredClone(config);
    },
    updates
  } as unknown as ConfigStore & { updates: unknown[] };
}

/** URL-keyed fetch mock; tests mutate `routes` between polls to simulate server change. */
function stubRoutes(routes: Record<string, unknown | (() => unknown)>): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      for (const [prefixOrExact, data] of Object.entries(routes)) {
        if (url === prefixOrExact || url.startsWith(prefixOrExact)) {
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

const poll = (poller: PlayerPoller): Promise<void> =>
  (poller as unknown as { poll: () => Promise<void> }).poll();

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-07-30T02:00:00Z"));
  resolveIdentityMock.mockReset();
  resolveIdentityMock.mockReturnValue(noInstallProbe);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("demo mode", () => {
  it("stays in preview and never touches the network", async () => {
    const config = makeConfig();
    config.data.demoMode = true;
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const poller = new PlayerPoller(makeStore(config));
    await poll(poller);
    expect(poller.status.phase).toBe("connected");
    expect(poller.player.source).toBe("demo");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("auto-switches preview to live once a license is detected (auto mode)", async () => {
    resolveIdentityMock.mockReturnValue(foundProbe);
    stubRoutes({
      "https://rwfc.net/api/roomstatus": fixture("roomstatus.json"),
      [`https://rwfc.net/api/leaderboard/player/${FC}/history/recent`]: fixture("history-recent.json"),
      [`https://rwfc.net/api/leaderboard/player/${FC}`]: fixture("player.json")
    });
    const config = makeConfig({ mode: "auto", friendCode: "" });
    config.data.demoMode = true;
    const store = makeStore(config);
    const poller = new PlayerPoller(store);

    await poll(poller); // license found -> preview flips off
    expect(config.data.demoMode).toBe(false);
    expect(store.updates).toEqual([{ data: { demoMode: false } }]);
    expect(poller.status.message).toContain("switching to live data");
    expect(poller.status.detectedFriendCode).toBe(FC);
    expect(poller.status.identitySteps).toEqual(foundProbe.steps);

    await poll(poller); // next tick is live
    expect(poller.player.source).toBe("rwfc");
    expect(poller.player.vr).toBe(77770);
    expect(poller.player.rank).toBe(408);
  });

  it("keeps probing while preview is on and no install exists yet", async () => {
    const config = makeConfig({ mode: "auto", friendCode: "" });
    config.data.demoMode = true;
    const store = makeStore(config);
    const poller = new PlayerPoller(store);

    await poll(poller);
    expect(config.data.demoMode).toBe(true);
    expect(poller.player.source).toBe("demo");
    expect(poller.status.identitySteps).toEqual(noInstallProbe.steps);
    expect(resolveIdentityMock).toHaveBeenCalledTimes(1);

    // WheelWizard gets set up mid-session; the next probe (15 s cadence) finds it.
    resolveIdentityMock.mockReturnValue(foundProbe);
    vi.setSystemTime(new Date("2026-07-30T02:00:20Z"));
    await poll(poller);
    expect(config.data.demoMode).toBe(false);
  });

  it("does not fight the user: re-enabled preview stays in preview", async () => {
    resolveIdentityMock.mockReturnValue(foundProbe);
    stubRoutes({
      "https://rwfc.net/api/roomstatus": fixture("roomstatus.json"),
      [`https://rwfc.net/api/leaderboard/player/${FC}/history/recent`]: fixture("history-recent.json"),
      [`https://rwfc.net/api/leaderboard/player/${FC}`]: fixture("player.json")
    });
    const config = makeConfig({ mode: "auto", friendCode: "" });
    config.data.demoMode = true;
    const store = makeStore(config);
    const poller = new PlayerPoller(store);

    await poll(poller); // auto-exit consumed
    expect(config.data.demoMode).toBe(false);

    config.data.demoMode = true; // user turns preview back on in Studio
    await poll(poller);
    expect(config.data.demoMode).toBe(true);
    expect(poller.player.source).toBe("demo");
    expect(store.updates).toHaveLength(1); // no second forced exit
  });

  it("never auto-exits preview for explicit friend-code or manual identities", async () => {
    resolveIdentityMock.mockReturnValue(foundProbe);
    const config = makeConfig(); // mode: "friendCode"
    config.data.demoMode = true;
    const poller = new PlayerPoller(makeStore(config));
    await poll(poller);
    expect(config.data.demoMode).toBe(true);
    expect(poller.player.source).toBe("demo");
  });
});

describe("live polling", () => {
  it("populates the full player state when the player is racing", async () => {
    stubRoutes({
      "https://rwfc.net/api/roomstatus": fixture("roomstatus.json"),
      [`https://rwfc.net/api/leaderboard/player/${FC}/history/recent`]: fixture("history-recent.json"),
      [`https://rwfc.net/api/leaderboard/player/${FC}`]: fixture("player.json")
    });
    const poller = new PlayerPoller(makeStore(makeConfig()));
    await poll(poller);

    expect(poller.status.phase).toBe("connected");
    expect(poller.player).toMatchObject({
      name: "omoney¿",
      tag: "OMY",
      friendCode: FC,
      vr: 77770,
      rank: 408,
      room: "Retro Tracks",
      race: 127,
      online: true,
      source: "rwfc"
    });
    // Last-race delta seeded from authoritative history, not guessed.
    expect(poller.player.vrDelta).toBe(23);
    expect(poller.player.previousVr).toBe(77747);
    expect(poller.player.avatarUrl.startsWith("data:image/png;base64,")).toBe(true);
    expect(poller.player.extras).toMatchObject({
      trackName: "SW Shroom Ridge / DS Shroom Ridge",
      cc: "150cc",
      roomId: "KUEJYC",
      averageVr: 60976,
      roomPlayerCount: 2,
      vrStats: { last24Hours: 1363, lastWeek: 1217, lastMonth: -1670 }
    });
  });

  it("detects a race boundary and applies the provisional VR delta", async () => {
    const roomstatus = structuredClone(fixture("roomstatus.json")) as {
      rooms: { race: { num: number }; players: { vr: number }[] }[];
    };
    stubRoutes({
      "https://rwfc.net/api/roomstatus": () => roomstatus,
      [`https://rwfc.net/api/leaderboard/player/${FC}/history/recent`]: fixture("history-recent.json"),
      [`https://rwfc.net/api/leaderboard/player/${FC}`]: fixture("player.json")
    });
    const poller = new PlayerPoller(makeStore(makeConfig()));
    await poll(poller);
    expect(poller.player.vr).toBe(77770);

    // Next race finishes: counter bumps, VR moves +41 in the room feed.
    roomstatus.rooms[0].race.num = 128;
    roomstatus.rooms[0].players[0].vr = 77811;
    await poll(poller);

    expect(poller.player.vr).toBe(77811);
    expect(poller.player.vrDelta).toBe(41);
    expect(poller.player.previousVr).toBe(77770);
    expect(poller.player.race).toBe(128);
  });

  it("reconciles the provisional delta once history catches up", async () => {
    const roomstatus = structuredClone(fixture("roomstatus.json")) as {
      rooms: { race: { num: number }; players: { vr: number }[] }[];
    };
    const history = structuredClone(fixture("history-recent.json")) as {
      date: string;
      vrChange: number;
      totalVR: number;
    }[];
    stubRoutes({
      "https://rwfc.net/api/roomstatus": () => roomstatus,
      [`https://rwfc.net/api/leaderboard/player/${FC}/history/recent`]: () => history,
      [`https://rwfc.net/api/leaderboard/player/${FC}`]: fixture("player.json")
    });
    const poller = new PlayerPoller(makeStore(makeConfig()));
    await poll(poller);

    roomstatus.rooms[0].race.num = 128;
    roomstatus.rooms[0].players[0].vr = 77811;
    await poll(poller); // provisional +41, history still stale

    // Leaderboard sync lands (~60 s later) with the settled per-race value.
    history.push({ date: "2026-07-30T02:01:30.000000Z", vrChange: 41, totalVR: 77811 });
    vi.setSystemTime(new Date("2026-07-30T02:02:00Z"));
    await poll(poller);

    expect(poller.player.vrDelta).toBe(41);
    expect(poller.player.extras?.recentChanges.at(-1)).toMatchObject({ vrChange: 41, totalVr: 77811 });
  });

  it("tracks rank changes across profile refreshes", async () => {
    const profile = structuredClone(fixture("player.json")) as { rank: number };
    stubRoutes({
      "https://rwfc.net/api/roomstatus": fixture("roomstatus.json"),
      [`https://rwfc.net/api/leaderboard/player/${FC}/history/recent`]: fixture("history-recent.json"),
      [`https://rwfc.net/api/leaderboard/player/${FC}`]: () => profile
    });
    const poller = new PlayerPoller(makeStore(makeConfig()));
    await poll(poller);
    expect(poller.player.rank).toBe(408);

    profile.rank = 405;
    vi.setSystemTime(new Date("2026-07-30T02:02:00Z")); // past the 60 s profile cadence
    await poll(poller);

    expect(poller.player.rank).toBe(405);
    expect(poller.player.previousRank).toBe(408);
    expect(poller.player.rankDelta).toBe(3); // positive = climbed
  });

  it("keeps serving leaderboard data when the player is not in a room", async () => {
    stubRoutes({
      "https://rwfc.net/api/roomstatus": { rooms: [] },
      [`https://rwfc.net/api/leaderboard/player/${FC}/history/recent`]: fixture("history-recent.json"),
      [`https://rwfc.net/api/leaderboard/player/${FC}`]: fixture("player.json")
    });
    const poller = new PlayerPoller(makeStore(makeConfig()));
    await poll(poller);

    expect(poller.player.online).toBe(false);
    expect(poller.player.vr).toBe(77770);
    expect(poller.player.rank).toBe(408);
    expect(poller.status.phase).toBe("connected");
    expect(poller.status.message).toContain("idle");
  });

  it("waits gracefully for a brand-new player unknown to the leaderboard", async () => {
    stubRoutes({
      "https://rwfc.net/api/roomstatus": { rooms: [] },
      [`https://rwfc.net/api/leaderboard/player/${FC}`]: 404
    });
    const poller = new PlayerPoller(makeStore(makeConfig()));
    await poll(poller);
    expect(poller.status.phase).toBe("waiting");
    expect(poller.player.online).toBe(false);
  });

  it("keeps last-good data on API failure and escalates to offline", async () => {
    stubRoutes({
      "https://rwfc.net/api/roomstatus": fixture("roomstatus.json"),
      [`https://rwfc.net/api/leaderboard/player/${FC}/history/recent`]: fixture("history-recent.json"),
      [`https://rwfc.net/api/leaderboard/player/${FC}`]: fixture("player.json")
    });
    const poller = new PlayerPoller(makeStore(makeConfig()));
    await poll(poller);
    expect(poller.player.vr).toBe(77770);

    stubRoutes({ "https://rwfc.net/api/roomstatus": new Error("network down") });
    await poll(poller);
    expect(poller.status.phase).toBe("error");
    expect(poller.player.vr).toBe(77770); // never blank mid-stream

    vi.setSystemTime(new Date("2026-07-30T02:10:00Z")); // beyond offlineAfterSeconds
    await poll(poller);
    await poll(poller);
    expect(poller.status.phase).toBe("offline");
    expect(poller.player.vr).toBe(77770);
  });

  it("exposes the identity trail on status for the Studio troubleshooting panel", async () => {
    stubRoutes({
      "https://rwfc.net/api/roomstatus": { rooms: [] },
      [`https://rwfc.net/api/leaderboard/player/${FC}/history/recent`]: [],
      [`https://rwfc.net/api/leaderboard/player/${FC}`]: fixture("player.json")
    });
    const poller = new PlayerPoller(makeStore(makeConfig()));
    await poll(poller);
    expect(poller.status.identitySteps).toEqual([`Using friend code from settings: ${FC}`]);
  });

  it("learns the friend code from a name match in manual mode", async () => {
    stubRoutes({
      "https://rwfc.net/api/roomstatus": fixture("roomstatus.json"),
      "https://rwfc.net/api/leaderboard/player/0085-9005-3475/history/recent": [],
      "https://rwfc.net/api/leaderboard/player/0085-9005-3475": {
        pid: "118883", name: "Cooper", friendCode: "0085-9005-3475", vr: 51309, rank: 1234
      }
    });
    const config = makeConfig({ mode: "manual", friendCode: "", playerName: "Cooper" });
    const poller = new PlayerPoller(makeStore(config));
    await poll(poller);

    expect(poller.player.friendCode).toBe("0085-9005-3475");
    expect(poller.player.rank).toBe(1234);
  });
});
