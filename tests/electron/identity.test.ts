// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import {
  deriveFriendCode,
  formatFriendCode,
  friendCodeToPid,
  parsePulRatings,
  parseRksysLicenses,
  resolveIdentity,
  sourceStamp
} from "../../electron/identity.js";

/** Builds a minimal rksys.dat: valid header plus a single populated license slot. */
function syntheticSave(options: { name?: string; pid?: number; vr?: number; br?: number } = {}): Buffer {
  const save = Buffer.alloc(0x8 + 0x8cc0 * 4);
  save.write("RKSD0006", 0, "latin1");
  const base = 0x8;
  save.write("RKPD", base, "latin1");
  const name = options.name ?? "TestPlayer";
  for (let i = 0; i < Math.min(name.length, 10); i++) {
    save.writeUInt16BE(name.charCodeAt(i), base + 0x14 + i * 2);
  }
  save.writeUInt32BE(options.pid ?? 116944, base + 0x5c);
  save.writeUInt16BE(options.vr ?? 5000, base + 0xb0);
  save.writeUInt16BE(options.br ?? 5000, base + 0xb2);
  return save;
}

function syntheticPul(entries: { pid: number; vr: number; br: number }[]): Buffer {
  const pul = Buffer.alloc(8 + 100 * 16);
  pul.writeUInt32BE(0x52525254, 0); // 'RRRT'
  pul.writeUInt16BE(1, 4);
  pul.writeUInt16BE(100, 6);
  entries.forEach((entry, i) => {
    const base = 8 + i * 16;
    pul.writeUInt32BE(entry.pid, base);
    pul.writeFloatBE(entry.vr, base + 4);
    pul.writeFloatBE(entry.br, base + 8);
    pul.writeUInt32BE(1, base + 12);
  });
  return pul;
}

describe("friend code derivation", () => {
  // All three pairs were verified against live rwfc.net records (docs/research.md §5).
  it.each([
    [116944, "3822-5220-6288"],
    [110204, "3951-3710-1436"],
    [17063, "0000-0001-7063"]
  ])("derives the server-confirmed code for pid %i", (pid, expected) => {
    expect(deriveFriendCode(pid)).toBe(expected);
  });

  it("returns empty for pid 0 (license never went online)", () => {
    expect(deriveFriendCode(0)).toBe("");
  });

  it("round-trips friend code → pid with checksum validation", () => {
    expect(friendCodeToPid("3822-5220-6288")).toBe(116944);
    expect(friendCodeToPid("3951-3710-1436")).toBe(110204);
  });

  it("rejects a friend code with a corrupted checksum", () => {
    expect(friendCodeToPid("3952-3710-1436")).toBeNull();
  });

  it("rejects malformed input", () => {
    expect(friendCodeToPid("")).toBeNull();
    expect(friendCodeToPid("1234")).toBeNull();
  });

  it("formats 12-digit strings", () => {
    expect(formatFriendCode("382252206288")).toBe("3822-5220-6288");
    expect(formatFriendCode("3822-5220-6288")).toBe("3822-5220-6288");
  });
});

describe("rksys.dat parsing", () => {
  it("parses a populated license slot", () => {
    const licenses = parseRksysLicenses(syntheticSave({ name: "FoidBumper", pid: 116944, vr: 4321, br: 1234 }));
    expect(licenses).toHaveLength(1);
    expect(licenses[0]).toMatchObject({
      slot: 0,
      name: "FoidBumper",
      pid: 116944,
      friendCode: "3822-5220-6288",
      vr: 4321,
      br: 1234
    });
  });

  it("skips slots without the RKPD magic", () => {
    const save = syntheticSave();
    expect(parseRksysLicenses(save).map((license) => license.slot)).toEqual([0]);
  });

  it("rejects files without the RKSD0006 magic", () => {
    expect(parseRksysLicenses(Buffer.alloc(0x100))).toEqual([]);
  });
});

describe("RRRating.pul parsing", () => {
  it("parses valid entries and applies the ×100 scale", () => {
    const ratings = parsePulRatings(syntheticPul([{ pid: 116944, vr: 10.1, br: 50 }]));
    expect(ratings).toEqual([{ pid: 116944, vr: 1010, br: 5000 }]);
  });

  it("ignores empty slots and rejects bad magic", () => {
    expect(parsePulRatings(syntheticPul([]))).toEqual([]);
    expect(parsePulRatings(Buffer.alloc(64))).toEqual([]);
  });
});

describe("resolveIdentity (fixture tree)", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "rr-overlay-test-"));
  afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

  it("walks WheelWizard config → Dolphin save → Pulsar rating", () => {
    const dolphin = path.join(root, "dolphin");
    const saveDir = path.join(dolphin, "Load", "Riivolution", "WheelWizard", "riivolution", "save", "RetroWFC", "RMCP");
    const pulsarDir = path.join(dolphin, "Wii", "shared2", "Pulsar", "RetroRewind6");
    fs.mkdirSync(path.join(root, "CT-MKWII"), { recursive: true });
    fs.mkdirSync(saveDir, { recursive: true });
    fs.mkdirSync(pulsarDir, { recursive: true });
    fs.writeFileSync(
      path.join(root, "CT-MKWII", "config.json"),
      JSON.stringify({ UserFolderPath: dolphin, FavoriteUser: 0, RR_Region: 2 })
    );
    fs.writeFileSync(path.join(saveDir, "rksys.dat"), syntheticSave({ name: "FoidBumper", pid: 116944 }));
    fs.writeFileSync(path.join(pulsarDir, "RRRating.pul"), syntheticPul([{ pid: 116944, vr: 10.1, br: 50 }]));

    const probe = resolveIdentity({ appData: root, home: root, noRegistry: true });
    expect(probe.identity).not.toBeNull();
    expect(probe.identity).toMatchObject({
      friendCode: "3822-5220-6288",
      pid: 116944,
      name: "FoidBumper",
      slot: 0,
      vr: 1010, // Pulsar value beats the u16 save field
      br: 5000
    });
  });

  it("finds saves in the plain-Dolphin tree (no WheelWizard segment)", () => {
    const dolphin = path.join(root, "dolphin-plain");
    const saveDir = path.join(dolphin, "Load", "Riivolution", "riivolution", "save", "RetroWFC", "RMCE");
    fs.mkdirSync(saveDir, { recursive: true });
    fs.writeFileSync(path.join(saveDir, "rksys.dat"), syntheticSave({ name: "PlainUser", pid: 110204 }));
    const appData = path.join(root, "appdata-plain");
    fs.mkdirSync(path.join(appData, "CT-MKWII"), { recursive: true });
    fs.writeFileSync(
      path.join(appData, "CT-MKWII", "config.json"),
      JSON.stringify({ UserFolderPath: dolphin, FavoriteUser: 0 })
    );

    const probe = resolveIdentity({ appData, home: root, noRegistry: true });
    expect(probe.identity?.friendCode).toBe("3951-3710-1436");
    expect(probe.identity?.vr).toBe(5000); // no Pulsar file → save VR
  });

  it("changes the source stamp when a watched file is rewritten", () => {
    const file = path.join(root, "stamp-probe.bin");
    fs.writeFileSync(file, "one");
    const before = sourceStamp([file, path.join(root, "missing.bin")]);
    expect(before).toContain("stamp-probe.bin");
    expect(before).toContain("missing.bin:absent");

    const past = new Date(Date.now() - 60_000);
    fs.utimesSync(file, past, past);
    expect(sourceStamp([file, path.join(root, "missing.bin")])).not.toBe(before);
  });

  it("reports a helpful trail when nothing is installed", () => {
    const empty = path.join(root, "empty");
    fs.mkdirSync(empty, { recursive: true });
    const probe = resolveIdentity({ appData: empty, home: empty, noRegistry: true });
    expect(probe.identity).toBeNull();
    expect(probe.steps.length).toBeGreaterThan(0);
  });
});
