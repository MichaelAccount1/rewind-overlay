/**
 * Settings-in-the-URL for the standalone web overlay.
 *
 * A fully configured overlay is one shareable link: human-friendly shortcuts
 * for the identity basics plus an optional `cfg` blob (base64url JSON, deep
 * partial of OverlayConfig) for everything the web Studio can style.
 *
 *   /overlay?fc=3822-5220-6288&tag=ZPL&poll=10&cfg=eyJib3JkZXIiOns...
 *
 * No local uploads exist on the web: background.imageUrl only accepts
 * absolute http(s)/data URLs and is blanked otherwise.
 */
import { defaultConfig, type OverlayConfig } from "../../../electron/models";

export interface WebSettings {
  config: OverlayConfig;
  friendCode: string;
  playerName: string;
  tag: string;
  demo: boolean;
  pollSeconds: number;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function deepMerge<T>(base: T, patch: unknown): T {
  if (!isRecord(base) || !isRecord(patch)) return (patch ?? base) as T;
  const output: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    output[key] = isRecord(value) && isRecord(output[key]) ? deepMerge(output[key], value) : value;
  }
  return output as T;
}

export function normalizeFriendCode(input: string): string {
  const digits = input.replace(/\D/g, "").slice(0, 12);
  if (digits.length !== 12) return "";
  return `${digits.slice(0, 4)}-${digits.slice(4, 8)}-${digits.slice(8, 12)}`;
}

function encodeBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decodeBase64Url(encoded: string): string {
  const padded = encoded.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(encoded.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

const clampPoll = (value: number): number => Math.max(3, Math.min(60, Math.round(value)));

/** Parse `location.search` (or a full query/hash string) into web overlay settings. */
export function parseWebSettings(searchAndHash: string): WebSettings {
  const query = searchAndHash.replace(/^[?#]/, "");
  const params = new URLSearchParams(query);

  let config = structuredClone(defaultConfig);
  const blob = params.get("cfg");
  if (blob) {
    try {
      const patch: unknown = JSON.parse(decodeBase64Url(blob));
      config = deepMerge(config, patch);
    } catch {
      // A corrupt cfg blob must never take the overlay down; defaults win.
    }
  }

  const friendCode = normalizeFriendCode(params.get("fc") ?? config.identity.friendCode);
  // Only an explicitly provided name counts as an identity; the default
  // display name from defaultConfig must not become a room matcher.
  const configuredName = config.identity.playerName !== defaultConfig.identity.playerName
    ? config.identity.playerName
    : "";
  const playerName = params.get("name") ?? configuredName;
  const tag = params.get("tag") ?? config.identity.tag;
  const pollSeconds = clampPoll(Number(params.get("poll")) || config.data.pollSeconds);
  // Demo is explicit on the web (`demo=1`); an identity means live by default.
  const demo = params.get("demo") === "1" || (!friendCode && !playerName);

  config.identity = {
    ...config.identity,
    mode: friendCode ? "friendCode" : "manual",
    friendCode: friendCode.replace(/\D/g, ""),
    playerName,
    tag
  };
  config.data = { ...config.data, pollSeconds, demoMode: demo };
  if (!/^(https?:|data:)/i.test(config.background.imageUrl)) {
    config.background.imageUrl = "";
  }

  return { config, friendCode, playerName, tag, demo, pollSeconds };
}

/** Build the shareable query string. `configPatch` should be a deep partial of OverlayConfig. */
export function serializeWebSettings(input: {
  configPatch?: unknown;
  friendCode?: string;
  playerName?: string;
  tag?: string;
  demo?: boolean;
  pollSeconds?: number;
}): string {
  const params = new URLSearchParams();
  const friendCode = normalizeFriendCode(input.friendCode ?? "");
  if (friendCode) params.set("fc", friendCode);
  if (input.playerName) params.set("name", input.playerName);
  if (input.tag) params.set("tag", input.tag);
  if (input.demo) params.set("demo", "1");
  if (input.pollSeconds) params.set("poll", String(clampPoll(input.pollSeconds)));
  if (input.configPatch && isRecord(input.configPatch) && Object.keys(input.configPatch).length > 0) {
    params.set("cfg", encodeBase64Url(JSON.stringify(input.configPatch)));
  }
  return params.toString();
}
