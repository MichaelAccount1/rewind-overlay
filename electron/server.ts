import express, { type Express } from "express";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, type BrowserWindow } from "electron";
import type { ConfigStore } from "./store.js";
import type { PlayerPoller } from "./poller.js";

export const OVERLAY_PORT = 19488;

interface WindowActions {
  getOverlay: () => BrowserWindow | null;
  showOverlay: () => void;
  hideOverlay: () => void;
  updateOverlay: () => void;
}

export class LocalServer {
  private readonly web: Express;
  private server: http.Server | null = null;
  private clients = new Set<express.Response>();

  constructor(
    private readonly store: ConfigStore,
    private readonly poller: PlayerPoller,
    private readonly windows: WindowActions,
    private readonly port = OVERLAY_PORT
  ) {
    this.web = express();
    this.web.disable("x-powered-by");
    this.web.use((req, res, next) => {
      if (req.headers.origin === "http://127.0.0.1:5173") {
        res.setHeader("Access-Control-Allow-Origin", req.headers.origin);
        res.setHeader("Access-Control-Allow-Methods", "GET, PATCH, POST, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type");
      }
      if (req.method === "OPTIONS") return res.sendStatus(204);
      return next();
    });
    this.web.use(express.json({ limit: "28mb" }));
    this.routes();
    this.poller.on("change", () => this.broadcast());
  }

  async start(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      this.server = this.web.listen(this.port, "127.0.0.1", () => resolve());
      this.server.once("error", reject);
    });
  }

  close(): void {
    for (const client of this.clients) client.end();
    this.server?.close();
  }

  private snapshot() {
    return { config: this.store.get(), player: this.poller.player, status: this.poller.status };
  }

  private routes(): void {
    this.web.get("/api/health", (_req, res) => res.json({ ok: true, version: app.getVersion() }));
    this.web.get("/api/snapshot", (_req, res) => res.json(this.snapshot()));
    this.web.get("/api/events", (req, res) => {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.flushHeaders();
      res.write(`data: ${JSON.stringify(this.snapshot())}\n\n`);
      this.clients.add(res);
      req.on("close", () => this.clients.delete(res));
    });
    this.web.patch("/api/config", (req, res) => {
      try {
        const before = this.store.get();
        const config = this.store.update(req.body);
        if (JSON.stringify(before.data) !== JSON.stringify(config.data) ||
            JSON.stringify(before.identity) !== JSON.stringify(config.identity)) this.poller.restart();
        this.windows.updateOverlay();
        this.broadcast();
        res.json({ config });
      } catch (error) {
        res.status(400).json({ error: error instanceof Error ? error.message : "Invalid settings" });
      }
    });
    this.web.post("/api/config/reset", (_req, res) => {
      const config = this.store.reset();
      this.poller.restart();
      this.windows.updateOverlay();
      this.broadcast();
      res.json({ config });
    });
    this.web.post("/api/background", (req, res) => {
      try {
        const imageUrl = this.store.setBackground(String(req.body?.dataUrl ?? ""));
        this.broadcast();
        res.json({ imageUrl });
      } catch (error) {
        res.status(400).json({ error: error instanceof Error ? error.message : "Could not save image" });
      }
    });
    this.web.post("/api/demo/:kind", (req, res) => {
      const kind = req.params.kind;
      if (!["gain", "loss", "rank", "reset"].includes(kind)) {
        return res.status(400).json({ error: "Unknown preview event" });
      }
      this.poller.triggerDemo(kind as "gain" | "loss" | "rank" | "reset");
      return res.json(this.snapshot());
    });
    this.web.post("/api/window/:action", (req, res) => {
      const overlay = this.windows.getOverlay();
      switch (req.params.action) {
        case "show": this.windows.showOverlay(); break;
        case "hide": this.windows.hideOverlay(); break;
        case "center": overlay?.center(); break;
        case "clickthrough":
          this.store.update({ desktop: { clickThrough: Boolean(req.body?.enabled) } });
          this.windows.updateOverlay();
          this.broadcast();
          break;
        default: return res.status(400).json({ error: "Unknown window action" });
      }
      return res.json({ ok: true });
    });

    const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
    const root = path.resolve(moduleDirectory, "..");
    this.web.use("/user-assets", express.static(this.store.userAssetsPath, { fallthrough: false }));
    this.web.use(express.static(path.join(root, "dist")));
    this.web.get("/{*path}", (_req, res) => res.sendFile(path.join(root, "dist", "index.html")));
  }

  private broadcast(): void {
    const message = `data: ${JSON.stringify(this.snapshot())}\n\n`;
    for (const client of this.clients) client.write(message);
  }
}
