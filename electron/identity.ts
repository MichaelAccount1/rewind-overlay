/**
 * Automatic player-identity resolution.
 *
 * Reads the same files WheelWizard maintains (read-only, no writes ever):
 *   WheelWizard config.json  ->  Dolphin user folder + selected license slot
 *   Riivolution-redirected rksys.dat  ->  license name + PID  ->  friend code
 *   Pulsar RRRating.pul  ->  Retro Rewind's true VR/BR (exceeds the u16 save field)
 *
 * File formats, offsets and the friend-code algorithm are documented with
 * evidence in docs/research.md S3-S5; all of it was verified against a live
 * install and the RWFC server before being encoded here.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const RKSYS_MAGIC = "RKSD0006";
const RKPD_MAGIC = "RKPD";
const LICENSE_SIZE = 0x8cc0;
const REGION_FOLDERS = ["RMCE", "RMCP", "RMCJ", "RMCK"] as const;
const RR_REGION_TO_FOLDER: Record<number, string> = { 1: "RMCE", 2: "RMCP", 3: "RMCJ", 4: "RMCK" };

export interface License {
  slot: number;
  name: string;
  pid: number;
  friendCode: string;
  vr: number;
  br: number;
}

export interface PulRating {
  pid: number;
  vr: number;
  br: number;
}

export interface ResolvedIdentity {
  friendCode: string;
  pid: number;
  name: string;
  slot: number;
  /** Best local VR/BR guess (Pulsar file preferred over the capped u16 save field). */
  vr: number | null;
  br: number | null;
  savePath: string;
  saveModifiedAt: string;
  licenses: License[];
  /** Files this identity was derived from; stamp them to detect changes cheaply. */
  sourcePaths: string[];
}

/**
 * Change stamp over the identity's source files (mtimes). The poller compares
 * stamps between polls to re-resolve when the user renames a license, switches
 * slots in WheelWizard, or the game flushes its save -- without re-parsing the
 * 2.8 MB save every tick.
 */
export function sourceStamp(paths: string[]): string {
  return paths
    .map((file) => {
      try {
        return `${file}:${fs.statSync(file).mtimeMs}`;
      } catch {
        return `${file}:absent`;
      }
    })
    .join("|");
}

export interface IdentityProbe {
  identity: ResolvedIdentity | null;
  /** Human-readable trail of what was checked, for the Studio troubleshooting panel. */
  steps: string[];
}

/** Overridable roots so tests (and unusual setups) can point at fixture trees. */
export interface IdentityRoots {
  appData?: string;
  home?: string;
  /** Skip registry queries (non-Windows and tests). */
  noRegistry?: boolean;
}

// --- Friend code algorithm (verified: pid 116944 -> 3822-5220-6288 matches the server) ---

/** RWFC derives friend codes with the game ID hardcoded to RMCJ for all regions. */
export function deriveFriendCode(pid: number): string {
  if (!pid) return "";
  const buffer = Buffer.from([
    pid & 0xff, (pid >>> 8) & 0xff, (pid >>> 16) & 0xff, (pid >>> 24) & 0xff,
    0x4a, 0x43, 0x4d, 0x52 // "JCMR" = "RMCJ" little-endian
  ]);
  const checksum = crypto.createHash("md5").update(buffer).digest()[0] >> 1;
  const value = (BigInt(checksum) << 32n) + BigInt(pid >>> 0);
  return formatFriendCode(value.toString().padStart(12, "0"));
}

export function formatFriendCode(digits: string): string {
  const clean = digits.replace(/\D/g, "").slice(0, 12);
  if (clean.length !== 12) return clean;
  return `${clean.slice(0, 4)}-${clean.slice(4, 8)}-${clean.slice(8, 12)}`;
}

/** PID is the low 32 bits of the friend code; recomputing validates the checksum digit. */
export function friendCodeToPid(friendCode: string): number | null {
  const digits = friendCode.replace(/\D/g, "");
  if (digits.length !== 12) return null;
  const pid = Number(BigInt(digits) & 0xffffffffn);
  if (!pid) return null;
  return deriveFriendCode(pid).replace(/\D/g, "") === digits ? pid : null;
}

// --- Binary parsers ---

export function parseRksysLicenses(save: Buffer): License[] {
  if (save.length < 8 || save.toString("latin1", 0, 8) !== RKSYS_MAGIC) return [];
  const licenses: License[] = [];
  for (let slot = 0; slot < 4; slot++) {
    const base = 0x8 + slot * LICENSE_SIZE;
    if (base + 0xb4 > save.length) break;
    if (save.toString("latin1", base, base + 4) !== RKPD_MAGIC) continue;
    let name = "";
    for (let i = 0; i < 10; i++) {
      const code = save.readUInt16BE(base + 0x14 + i * 2);
      if (!code) break;
      name += String.fromCharCode(code);
    }
    const pid = save.readUInt32BE(base + 0x5c);
    licenses.push({
      slot,
      name,
      pid,
      friendCode: deriveFriendCode(pid),
      vr: save.readUInt16BE(base + 0xb0),
      br: save.readUInt16BE(base + 0xb2)
    });
  }
  return licenses;
}

/** RRRating.pul: 'RRRT' v1, 100 x {u32 pid, f32 vr, f32 br, u32 flags} big-endian; VR = f32 x 100. */
export function parsePulRatings(pul: Buffer): PulRating[] {
  if (pul.length < 8 || pul.readUInt32BE(0) !== 0x52525254 || pul.readUInt16BE(4) !== 1) return [];
  const ratings: PulRating[] = [];
  const count = pul.readUInt16BE(6);
  for (let i = 0; i < count; i++) {
    const base = 8 + i * 16;
    if (base + 16 > pul.length) break;
    const pid = pul.readUInt32BE(base);
    const flags = pul.readUInt32BE(base + 12);
    if (!pid || !(flags & 1)) continue;
    ratings.push({
      pid,
      vr: Math.round(pul.readFloatBE(base + 4) * 100),
      br: Math.round(pul.readFloatBE(base + 8) * 100)
    });
  }
  return ratings;
}

// --- Filesystem discovery ---

function readRegistryString(key: string, value: string): string {
  try {
    const result = spawnSync("reg", ["query", key, "/v", value], { encoding: "utf8", timeout: 3000 });
    const match = /REG_SZ\s+(.+)/.exec(result.stdout ?? "");
    return match ? match[1].trim() : "";
  } catch {
    return "";
  }
}

function readJson(file: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Minimal INI value lookup, enough for Dolphin.ini [General] paths. */
function readIniValue(file: string, section: string, key: string): string {
  try {
    let inSection = false;
    for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
      const header = /^\s*\[(.+)]\s*$/.exec(line);
      if (header) {
        inSection = header[1].trim().toLowerCase() === section.toLowerCase();
        continue;
      }
      if (!inSection) continue;
      const pair = /^\s*([^=;#]+?)\s*=\s*(.*)\s*$/.exec(line);
      if (pair && pair[1].toLowerCase() === key.toLowerCase()) return pair[2];
    }
  } catch {
    // Missing/unreadable INI just means "no override".
  }
  return "";
}

function locateWheelWizardDir(roots: IdentityRoots, steps: string[]): string {
  if (!roots.noRegistry && process.platform === "win32") {
    const override = readRegistryString("HKCU\\Software\\WheelWizard", "AppDataLocation");
    if (override && fs.existsSync(override)) {
      steps.push(`WheelWizard folder from registry override: ${override}`);
      return override;
    }
  }
  const appData = roots.appData ?? process.env.APPDATA ?? "";
  const fallback = path.join(appData, "CT-MKWII");
  steps.push(fs.existsSync(fallback)
    ? `WheelWizard folder: ${fallback}`
    : `WheelWizard folder not found (looked in ${fallback})`);
  return fallback;
}

function locateDolphinUserDir(configured: string, roots: IdentityRoots, steps: string[]): string {
  if (configured && fs.existsSync(configured)) {
    steps.push(`Dolphin user folder from WheelWizard config: ${configured}`);
    return configured;
  }
  if (!roots.noRegistry && process.platform === "win32") {
    const fromRegistry = readRegistryString("HKCU\\Software\\Dolphin Emulator", "UserConfigPath");
    if (fromRegistry && fs.existsSync(fromRegistry)) {
      steps.push(`Dolphin user folder from registry: ${fromRegistry}`);
      return fromRegistry;
    }
  }
  const home = roots.home ?? os.homedir();
  const appData = roots.appData ?? process.env.APPDATA ?? "";
  for (const candidate of [path.join(home, "Documents", "Dolphin Emulator"), path.join(appData, "Dolphin Emulator")]) {
    if (candidate && fs.existsSync(candidate)) {
      steps.push(`Dolphin user folder: ${candidate}`);
      return candidate;
    }
  }
  steps.push("Dolphin user folder not found");
  return "";
}

/**
 * Save-redirect trees seen in the wild: WheelWizard launches use
 * Riivolution/WheelWizard/... while plain Dolphin+Riivolution uses Riivolution/...
 * directly; each has RetroWFC (default) and RetroWFC2 ("Seperate Savegame")
 * variants. When several rksys.dat files exist, the most recently written one
 * is the live save.
 */
function findSaveFile(loadDir: string, preferredRegion: string, steps: string[]): string {
  const candidates: { file: string; mtime: number; preferred: boolean }[] = [];
  const roots = [
    path.join(loadDir, "Riivolution", "WheelWizard", "riivolution", "save"),
    path.join(loadDir, "Riivolution", "riivolution", "save")
  ];
  for (const root of roots) {
    for (const tree of ["RetroWFC", "RetroWFC2"]) {
      for (const region of REGION_FOLDERS) {
        const file = path.join(root, tree, region, "rksys.dat");
        try {
          const stat = fs.statSync(file);
          candidates.push({ file, mtime: stat.mtimeMs, preferred: region === preferredRegion });
        } catch {
          // Absent region folders are expected.
        }
      }
    }
  }
  if (candidates.length === 0) {
    steps.push(`No Retro Rewind save found under ${path.join(loadDir, "Riivolution")}`);
    return "";
  }
  candidates.sort((a, b) => Number(b.preferred) - Number(a.preferred) || b.mtime - a.mtime);
  steps.push(`Save file: ${candidates[0].file}`);
  return candidates[0].file;
}

// --- Top-level resolution ---

export function resolveIdentity(roots: IdentityRoots = {}): IdentityProbe {
  const steps: string[] = [];
  const whwzDir = locateWheelWizardDir(roots, steps);
  const config = readJson(path.join(whwzDir, "config.json")) ?? {};
  const favoriteSlot = typeof config.FavoriteUser === "number" ? config.FavoriteUser : 0;
  const regionFolder = RR_REGION_TO_FOLDER[Number(config.RR_Region)] ?? "";

  const userDir = locateDolphinUserDir(String(config.UserFolderPath ?? ""), roots, steps);
  if (!userDir) return { identity: null, steps };

  const loadDir = readIniValue(path.join(userDir, "Config", "Dolphin.ini"), "General", "LoadPath")
    || path.join(userDir, "Load");
  const wiiDir = readIniValue(path.join(userDir, "Config", "Dolphin.ini"), "General", "NANDRootPath")
    || path.join(userDir, "Wii");

  const savePath = findSaveFile(loadDir, regionFolder, steps);
  if (!savePath) return { identity: null, steps };

  let save: Buffer;
  try {
    save = fs.readFileSync(savePath);
  } catch (error) {
    steps.push(`Could not read save: ${error instanceof Error ? error.message : String(error)}`);
    return { identity: null, steps };
  }

  const licenses = parseRksysLicenses(save);
  const usable = licenses.filter((license) => license.pid !== 0);
  if (usable.length === 0) {
    steps.push("Save has no license that has been online (all PIDs are 0)");
    return { identity: null, steps };
  }
  const chosen = usable.find((license) => license.slot === favoriteSlot) ?? usable[0];
  steps.push(`License slot ${chosen.slot} "${chosen.name}" -> friend code ${chosen.friendCode}`);

  const pulPath = path.join(wiiDir, "shared2", "Pulsar", "RetroRewind6", "RRRating.pul");
  let vr: number | null = chosen.vr;
  let br: number | null = chosen.br;
  try {
    const pul = fs.readFileSync(pulPath);
    const rating = parsePulRatings(pul).find((entry) => entry.pid === chosen.pid);
    if (rating) {
      vr = rating.vr;
      br = rating.br;
      steps.push(`Pulsar rating file: VR ${vr} / BR ${br}`);
    }
  } catch {
    steps.push("No Pulsar rating file (older Retro Rewind) -- using save VR");
  }

  let saveModifiedAt = "";
  try {
    saveModifiedAt = fs.statSync(savePath).mtime.toISOString();
  } catch {
    // Keep empty when unavailable.
  }

  return {
    identity: {
      friendCode: chosen.friendCode,
      pid: chosen.pid,
      name: chosen.name,
      slot: chosen.slot,
      vr,
      br,
      savePath,
      saveModifiedAt,
      licenses,
      sourcePaths: [path.join(whwzDir, "config.json"), savePath, pulPath]
    },
    steps
  };
}
