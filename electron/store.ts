import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
import { defaultConfig, type OverlayConfig } from "./models.js";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function merge<T>(base: T, patch: unknown): T {
  if (isRecord(base) && !isRecord(patch)) return base;
  if (!isRecord(base)) return (typeof patch === typeof base ? patch : base) as T;
  if (!isRecord(patch)) return base;
  const output: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (!Object.hasOwn(base, key) || key === "__proto__" || key === "constructor" || key === "prototype") continue;
    output[key] = isRecord(value) && isRecord(output[key]) ? merge(output[key], value) : value;
  }
  return output as T;
}

export class ConfigStore {
  private config: OverlayConfig = structuredClone(defaultConfig);
  private readonly configPath: string;
  readonly userAssetsPath: string;

  constructor() {
    const directory = app.getPath("userData");
    this.configPath = path.join(directory, "config.json");
    this.userAssetsPath = path.join(directory, "assets");
    fs.mkdirSync(this.userAssetsPath, { recursive: true });
    this.load();
  }

  get(): OverlayConfig { return structuredClone(this.config); }

  update(patch: unknown): OverlayConfig {
    this.config = merge(this.config, patch);
    this.sanitise();
    this.save();
    return this.get();
  }

  reset(): OverlayConfig {
    this.config = structuredClone(defaultConfig);
    this.save();
    return this.get();
  }

  setBackground(dataUrl: string): string {
    const match = /^data:(image\/(?:png|jpeg|webp|gif));base64,([A-Za-z0-9+/=\s]+)$/.exec(dataUrl);
    if (!match) throw new Error("Choose a PNG, JPEG, WebP, or GIF image.");
    const bytes = Buffer.from(match[2], "base64");
    if (bytes.byteLength > 20 * 1024 * 1024) throw new Error("Backgrounds must be smaller than 20 MB.");
    const extension = match[1] === "image/jpeg" ? "jpg" : match[1].slice(6);
    const filePath = path.join(this.userAssetsPath, `background.${extension}`);
    fs.writeFileSync(filePath, bytes);
    this.config.background.imageUrl = `/user-assets/${path.basename(filePath)}?v=${Date.now()}`;
    this.save();
    return this.config.background.imageUrl;
  }

  private load(): void {
    try {
      if (fs.existsSync(this.configPath)) {
        this.config = merge(defaultConfig, JSON.parse(fs.readFileSync(this.configPath, "utf8")));
        this.sanitise();
      }
    } catch { this.config = structuredClone(defaultConfig); }
  }

  private sanitise(): void {
    const config = this.config;
    config.data.pollSeconds = Math.max(2, Math.min(60, Number(config.data.pollSeconds) || 5));
    config.layout.scale = Math.max(0.5, Math.min(2, Number(config.layout.scale) || 1));
    config.layout.width = Math.max(340, Math.min(1000, Number(config.layout.width) || 560));
    config.desktop.opacity = Math.max(0.2, Math.min(1, Number(config.desktop.opacity) || 1));
    config.identity.friendCode = config.identity.friendCode.replace(/\D/g, "").slice(0, 12);
    const licenseSlot = Number(config.identity.licenseSlot);
    config.identity.licenseSlot = Number.isInteger(licenseSlot)
      ? Math.max(-1, Math.min(3, licenseSlot))
      : defaultConfig.identity.licenseSlot;
    config.identity.followOnlineLicense = Boolean(config.identity.followOnlineLicense);
    if (!["gradient", "solid", "transparent"].includes(config.avatar.background)) {
      config.avatar.background = defaultConfig.avatar.background;
    }
    if (!/^#[0-9a-f]{6}$/i.test(config.avatar.color1)) config.avatar.color1 = defaultConfig.avatar.color1;
    if (!/^#[0-9a-f]{6}$/i.test(config.avatar.color2)) config.avatar.color2 = defaultConfig.avatar.color2;
  }

  private save(): void {
    fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2), "utf8");
  }
}
