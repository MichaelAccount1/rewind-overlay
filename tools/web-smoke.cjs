const { app, BrowserWindow } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const output = path.join(root, ".capture-data");
const port = 4174;
app.setPath("userData", path.join(output, "web-user-data"));
if (process.platform === "linux") {
  app.commandLine.appendSwitch("no-sandbox");
  app.disableHardwareAcceleration();
}

app.whenReady().then(async () => {
  const { preview } = await import("vite");
  const server = await preview({
    root,
    mode: "web",
    preview: { host: "127.0.0.1", port, strictPort: true }
  });
  const windows = [];

  try {
    const studio = new BrowserWindow({
      width: 1280,
      height: 820,
      show: false,
      backgroundColor: "#090b12",
      webPreferences: { contextIsolation: true, sandbox: true }
    });
    windows.push(studio);
    await studio.loadURL(`http://127.0.0.1:${port}/rewind-overlay/?demo=1`);
    await new Promise((resolve) => setTimeout(resolve, 800));
    const result = await studio.webContents.executeJavaScript(`({
      studio: Boolean(document.querySelector(".web-studio")),
      preview: Boolean(document.querySelector(".preview-canvas .overlay-card")),
      pages: document.querySelectorAll(".sidebar nav button").length
    })`);
    if (!result.studio || !result.preview || result.pages < 7) {
      throw new Error(`Hosted Studio did not render completely: ${JSON.stringify(result)}`);
    }
    fs.mkdirSync(output, { recursive: true });
    fs.writeFileSync(path.join(output, "web-studio.png"), (await studio.webContents.capturePage()).toPNG());

    const overlay = new BrowserWindow({
      width: 1000,
      height: 300,
      show: false,
      transparent: true,
      backgroundColor: "#00000000",
      webPreferences: { contextIsolation: true, sandbox: true }
    });
    windows.push(overlay);
    await overlay.loadURL(`http://127.0.0.1:${port}/rewind-overlay/?view=overlay&demo=1`);
    await new Promise((resolve) => setTimeout(resolve, 500));
    const surface = await overlay.webContents.executeJavaScript(`({
      card: Boolean(document.querySelector(".overlay-card")),
      document: getComputedStyle(document.documentElement).backgroundColor,
      body: getComputedStyle(document.body).backgroundColor,
      root: getComputedStyle(document.getElementById("root")).backgroundColor
    })`);
    if (!surface.card || [surface.document, surface.body, surface.root].some((color) => color !== "rgba(0, 0, 0, 0)")) {
      throw new Error(`Hosted overlay is missing or opaque: ${JSON.stringify(surface)}`);
    }
    console.log("Hosted web Studio and transparent overlay smoke test passed.");
  } finally {
    for (const window of windows) window.destroy();
    await server.httpServer.close();
  }
  app.exit(0);
}).catch((error) => {
  console.error(error);
  app.exit(1);
});
