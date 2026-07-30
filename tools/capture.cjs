const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
app.setPath("userData", path.join(root, ".capture-data"));

app.whenReady().then(async () => {
  const { ConfigStore } = await import("../dist-electron/store.js");
  const { PlayerPoller } = await import("../dist-electron/poller.js");
  const { LocalServer } = await import("../dist-electron/server.js");

  const store = new ConfigStore();
  store.reset();
  const poller = new PlayerPoller(store);
  const server = new LocalServer(store, poller, {
    getOverlay: () => null,
    showOverlay: () => {},
    hideOverlay: () => {},
    updateOverlay: () => {}
  });
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
    await window.loadURL(`http://127.0.0.1:19488${route}`);
    await new Promise((resolve) => setTimeout(resolve, 1700));
    const image = await window.webContents.capturePage();
    fs.writeFileSync(path.join(output, name), image.toPNG());
  }

  await capture("/studio", "studio.png", 1280, 820);
  await capture("/overlay?obs=1", "overlay.png", 900, 260);
  for (const window of windows) window.destroy();
  poller.stop();
  server.close();
  app.exit(0);
}).catch((error) => {
  console.error(error);
  app.exit(1);
});
