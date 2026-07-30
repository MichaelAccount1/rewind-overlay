import { app, BrowserWindow, Menu, nativeImage, shell, Tray } from "electron";
import { ConfigStore } from "./store.js";
import { PlayerPoller } from "./poller.js";
import { LocalServer, OVERLAY_PORT } from "./server.js";

const isDevelopment = Boolean(process.env.VITE_DEV_SERVER_URL);
let studioWindow: BrowserWindow | null = null;
let overlayWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let store: ConfigStore;
let poller: PlayerPoller;
let server: LocalServer;
let quitting = false;

const appUrl = (route: string): string =>
  isDevelopment ? `${process.env.VITE_DEV_SERVER_URL}${route}` : `http://127.0.0.1:${OVERLAY_PORT}${route}`;

function createStudio(): BrowserWindow {
  if (studioWindow && !studioWindow.isDestroyed()) {
    studioWindow.show();
    studioWindow.focus();
    return studioWindow;
  }
  studioWindow = new BrowserWindow({
    width: 1280, height: 820, minWidth: 980, minHeight: 680,
    backgroundColor: "#090b12", title: "Rewind Overlay Studio", show: false,
    webPreferences: { contextIsolation: true, sandbox: true }
  });
  void studioWindow.loadURL(appUrl("/studio"));
  studioWindow.once("ready-to-show", () => studioWindow?.show());
  studioWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });
  studioWindow.on("close", (event) => {
    if (!quitting) { event.preventDefault(); studioWindow?.hide(); }
  });
  return studioWindow;
}

function createOverlay(): BrowserWindow {
  if (overlayWindow && !overlayWindow.isDestroyed()) return overlayWindow;
  const config = store.get();
  overlayWindow = new BrowserWindow({
    width: Math.round(config.layout.width * config.layout.scale),
    height: Math.round((config.layout.compact ? 126 : 158) * config.layout.scale),
    minWidth: 280, minHeight: 80, transparent: true, frame: false, resizable: true,
    alwaysOnTop: config.desktop.alwaysOnTop, skipTaskbar: !config.desktop.showInTaskbar,
    hasShadow: false, backgroundColor: "#00000000", show: false,
    webPreferences: { contextIsolation: true, sandbox: true }
  });
  overlayWindow.setAlwaysOnTop(config.desktop.alwaysOnTop, "screen-saver");
  overlayWindow.setIgnoreMouseEvents(config.desktop.clickThrough, { forward: true });
  overlayWindow.setOpacity(config.desktop.opacity);
  void overlayWindow.loadURL(appUrl("/overlay?desktop=1"));
  overlayWindow.once("ready-to-show", () => overlayWindow?.showInactive());
  overlayWindow.on("closed", () => { overlayWindow = null; });
  return overlayWindow;
}

function updateOverlay(): void {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;
  const config = store.get();
  overlayWindow.setAlwaysOnTop(config.desktop.alwaysOnTop, "screen-saver");
  overlayWindow.setIgnoreMouseEvents(config.desktop.clickThrough, { forward: true });
  overlayWindow.setSkipTaskbar(!config.desktop.showInTaskbar);
  overlayWindow.setOpacity(config.desktop.opacity);
  overlayWindow.setSize(
    Math.round(config.layout.width * config.layout.scale),
    Math.round((config.layout.compact ? 126 : 158) * config.layout.scale),
    true
  );
}

function refreshTrayMenu(): void {
  if (!tray) return;
  const config = store.get();
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Open Studio", click: () => createStudio() },
    { label: "Show Overlay", click: () => createOverlay().showInactive() },
    { label: "Hide Overlay", click: () => overlayWindow?.hide() },
    {
      label: "Click-through",
      type: "checkbox",
      checked: config.desktop.clickThrough,
      click: (item) => {
        store.update({ desktop: { clickThrough: item.checked } });
        updateOverlay();
        refreshTrayMenu();
      }
    },
    { type: "separator" },
    { label: "Quit", click: () => { quitting = true; app.quit(); } }
  ]));
}

function createTray(): void {
  const traySvg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><defs><linearGradient id="g"><stop stop-color="#27d9fa"/><stop offset=".55" stop-color="#7168ff"/><stop offset="1" stop-color="#ff7347"/></linearGradient></defs><rect width="32" height="32" rx="9" fill="url(#g)"/><text x="6" y="22" fill="white" font-family="Arial" font-size="15" font-weight="700">RR</text></svg>`;
  const icon = nativeImage.createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(traySvg).toString("base64")}`);
  tray = new Tray(icon);
  tray.setToolTip("Rewind Overlay");
  refreshTrayMenu();
  tray.on("double-click", () => createStudio());
}

const ownsInstance = app.requestSingleInstanceLock();
if (!ownsInstance) {
  app.quit();
} else {
  app.on("second-instance", () => createStudio());
}

app.whenReady().then(async () => {
  if (!ownsInstance) return;
  store = new ConfigStore();
  poller = new PlayerPoller(store);
  server = new LocalServer(store, poller, {
    getOverlay: () => overlayWindow,
    showOverlay: () => createOverlay().showInactive(),
    hideOverlay: () => overlayWindow?.hide(),
    updateOverlay
  });
  await server.start();
  poller.start();
  createStudio();
  createOverlay();
  createTray();
  app.on("activate", () => createStudio());
});

app.on("before-quit", () => {
  quitting = true;
  poller?.stop();
  server?.close();
});

app.on("window-all-closed", () => {
  // Tray application: keep the data service and OBS source alive.
});
