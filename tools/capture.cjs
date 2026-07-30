const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const path = require("node:path");
const sharp = require("sharp");

const root = path.resolve(__dirname, "..");
const capturePort = 19489;
app.setPath("userData", path.join(root, ".capture-data"));

app.whenReady().then(async () => {
  const { ConfigStore } = await import("../dist-electron/store.js");
  const { overlayWindowSize } = await import("../dist-electron/overlay-layout.js");
  const { PlayerPoller } = await import("../dist-electron/poller.js");
  const { LocalServer } = await import("../dist-electron/server.js");

  const store = new ConfigStore();
  store.reset();
  // Keep documentation captures deterministic even when this machine has a
  // usable Wheel Wizard license that would automatically leave Preview Mode.
  store.update({ identity: { mode: "manual" } });
  const poller = new PlayerPoller(store);
  const server = new LocalServer(store, poller, {
    getOverlay: () => null,
    showOverlay: () => {},
    hideOverlay: () => {},
    updateOverlay: () => {}
  }, capturePort);
  await server.start();
  poller.start();

  const output = path.join(root, "docs", "images");
  fs.mkdirSync(output, { recursive: true });
  const windows = [];

  async function capture(route, name, width, height) {
    const window = new BrowserWindow({
      width,
      height,
      show: false,
      backgroundColor: route.startsWith("/overlay") ? "#00000000" : "#090b12",
      transparent: route.startsWith("/overlay"),
      webPreferences: { contextIsolation: true, sandbox: true }
    });
    windows.push(window);
    await window.loadURL(`http://127.0.0.1:${capturePort}${route}`);
    await new Promise((resolve) => setTimeout(resolve, 1700));
    const png = (await window.webContents.capturePage()).toPNG();
    fs.writeFileSync(path.join(output, name), png);
    if (route.startsWith("/overlay")) {
      const surfaces = await window.webContents.executeJavaScript(`({
        body: getComputedStyle(document.body).backgroundColor,
        root: getComputedStyle(document.getElementById("root")).backgroundColor,
        page: getComputedStyle(document.querySelector(".overlay-page")).backgroundColor
      })`);
      const transparent = Object.values(surfaces).every((color) => color === "rgba(0, 0, 0, 0)");
      if (!transparent) {
        throw new Error(`Overlay renderer is opaque; expected transparent surfaces. ${JSON.stringify(surfaces)}`);
      }
      if (name === "overlay-dense.png") {
        const dense = await window.webContents.executeJavaScript(`(async () => {
          const latest = await fetch("/api/snapshot", { cache: "no-store" }).then((response) => response.json());
          return {
            className: document.querySelector(".overlay-card")?.className,
            text: document.querySelector(".context-line")?.textContent,
            visibility: latest.config.visibility
          };
        })()`);
        if (!dense.className?.includes("context-dense") || !dense.text?.includes("SESSION") || !dense.text?.includes("24H")) {
          throw new Error(`Dense overlay did not render every context row. ${JSON.stringify(dense)}`);
        }
      }
    }
  }

  async function verifyDesktopSurface() {
    store.update({ border: { effect: "pulse", glow: true, glowStrength: 1, speed: 0.2 } });
    const config = store.get();
    const size = overlayWindowSize(config);
    const window = new BrowserWindow({
      ...size,
      frame: false,
      resizable: false,
      show: false,
      transparent: true,
      backgroundColor: "#00000000",
      webPreferences: { contextIsolation: true, sandbox: true }
    });
    windows.push(window);
    await window.loadURL(`http://127.0.0.1:${capturePort}/overlay?desktop=1`);
    await new Promise((resolve) => setTimeout(resolve, 900));

    const png = (await window.webContents.capturePage()).toPNG();
    const { data, info } = await sharp(png).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    let maxEdgeAlpha = 0;
    const alphaAt = (x, y) => data[(y * info.width + x) * info.channels + 3];
    for (let x = 0; x < info.width; x += 1) {
      maxEdgeAlpha = Math.max(maxEdgeAlpha, alphaAt(x, 0), alphaAt(x, info.height - 1));
    }
    for (let y = 0; y < info.height; y += 1) {
      maxEdgeAlpha = Math.max(maxEdgeAlpha, alphaAt(0, y), alphaAt(info.width - 1, y));
    }
    if (maxEdgeAlpha > 4) {
      throw new Error(`Desktop glow reaches the native window edge (alpha ${maxEdgeAlpha}); increase its gutter.`);
    }

    for (const fit of ["cover", "contain"]) {
      await window.webContents.executeJavaScript(`fetch("/api/config", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ background: { fit: "${fit}", zoom: 1.8, x: 25, y: 75 } })
      }).then((response) => response.json())`);
      await new Promise((resolve) => setTimeout(resolve, 150));
      const transform = await window.webContents.executeJavaScript(`(() => {
        const matrix = new DOMMatrixReadOnly(getComputedStyle(document.querySelector(".background-layer")).transform);
        return { x: matrix.e, y: matrix.f };
      })()`);
      if (Math.abs(transform.x) < 1 || Math.abs(transform.y) < 1) {
        throw new Error(`${fit} background did not apply two-axis pan. ${JSON.stringify(transform)}`);
      }
    }
  }

  await capture("/studio", "studio.png", 1280, 820);
  await capture("/overlay?obs=1", "overlay.png", 900, 260);
  store.update({
    visibility: { connection: true, room: true, track: true, sessionDelta: true, dailyDelta: true }
  });
  await capture("/overlay?obs=1", "overlay-dense.png", 900, 320);
  await verifyDesktopSurface();
  for (const window of windows) window.destroy();
  poller.stop();
  server.close();
  app.exit(0);
}).catch((error) => {
  console.error(error);
  app.exit(1);
});
