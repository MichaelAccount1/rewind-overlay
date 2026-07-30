const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const capturePort = 19489;
app.setPath("userData", path.join(root, ".capture-data"));

app.whenReady().then(async () => {
  const { ConfigStore } = await import("../dist-electron/store.js");
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

  await capture("/studio", "studio.png", 1280, 820);
  await capture("/overlay?obs=1", "overlay.png", 900, 260);
  store.update({
    visibility: { connection: true, room: true, track: true, sessionDelta: true, dailyDelta: true }
  });
  await capture("/overlay?obs=1", "overlay-dense.png", 900, 320);
  for (const window of windows) window.destroy();
  poller.stop();
  server.close();
  app.exit(0);
}).catch((error) => {
  console.error(error);
  app.exit(1);
});
