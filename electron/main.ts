import { app, BrowserWindow, Menu, nativeImage, shell, Tray } from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ConfigStore } from "./store.js";
import { PlayerPoller } from "./poller.js";
import { LocalServer, OVERLAY_PORT } from "./server.js";
import { overlayWindowSize } from "./overlay-layout.js";

const isDevelopment = Boolean(process.env.VITE_DEV_SERVER_URL);
let studioWindow: BrowserWindow | null = null;
let overlayWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let store: ConfigStore;
let poller: PlayerPoller;
let server: LocalServer;
let quitting = false;
const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));

const resourcePath = (name: string): string =>
  app.isPackaged
    ? path.join(process.resourcesPath, name)
    : path.join(moduleDirectory, "..", "build", name);

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
    icon: resourcePath("icon.png"),
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
  const size = overlayWindowSize(config);
  overlayWindow = new BrowserWindow({
    width: size.width, height: size.height,
    transparent: true, frame: false, resizable: false, maximizable: false, fullscreenable: false,
    alwaysOnTop: config.desktop.alwaysOnTop, skipTaskbar: !config.desktop.showInTaskbar,
    hasShadow: false, backgroundColor: "#00000000", show: false, icon: resourcePath("icon.png"),
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
  const size = overlayWindowSize(config);
  const bounds = overlayWindow.getBounds();
  overlayWindow.setBounds({
    x: Math.round(bounds.x + (bounds.width - size.width) / 2),
    y: Math.round(bounds.y + (bounds.height - size.height) / 2),
    width: size.width,
    height: size.height
  });
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
  const source = nativeImage.createFromPath(resourcePath("tray.png"));
  const icon = nativeImage.createEmpty();
  icon.addRepresentation({ scaleFactor: 1, buffer: source.resize({ width: 16, height: 16, quality: "best" }).toPNG() });
  icon.addRepresentation({ scaleFactor: 2, buffer: source.resize({ width: 32, height: 32, quality: "best" }).toPNG() });
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
  app.setAppUserModelId("net.rewindoverlay.app");
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
