import { useEffect, useRef, useState } from "react";
import type { Snapshot } from "../types";
import { Overlay } from "../components/Overlay";
import {
  WebPoller,
  parseWebSettings,
  serializeWebSettings,
  type WebSettings,
  type WebSnapshot
} from "./data";
import { WebStudio } from "./WebStudio";

const STORAGE_KEY = "rewind-overlay-web-settings";

function initialSettings(): WebSettings {
  const fromUrl = parseWebSettings(location.search);
  if (location.search.length > 1) return fromUrl;
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? parseWebSettings(saved) : fromUrl;
  } catch {
    return fromUrl;
  }
}

function rendererSnapshot(settings: WebSettings, current: WebSnapshot): Snapshot {
  return {
    config: settings.config,
    player: current.player,
    status: { ...current.status, detectedFriendCode: settings.friendCode }
  };
}

export function WebApp() {
  const initial = useRef<WebSettings>(initialSettings());
  const poller = useRef(new WebPoller(initial.current));
  const [settings, setSettingsState] = useState(initial.current);
  const [current, setCurrent] = useState(poller.current.snapshot());
  const overlayOnly = new URLSearchParams(location.search).get("view") === "overlay";

  useEffect(() => {
    const unsubscribe = poller.current.subscribe(setCurrent);
    poller.current.start();
    return () => {
      unsubscribe();
      poller.current.stop();
    };
  }, []);

  const setSettings = (next: WebSettings) => {
    setSettingsState(next);
    poller.current.setSettings(next);
    try {
      localStorage.setItem(STORAGE_KEY, serializeWebSettings({
        configPatch: next.config,
        friendCode: next.friendCode,
        playerName: next.playerName,
        tag: next.tag,
        demo: next.demo,
        pollSeconds: next.pollSeconds
      }));
    } catch {
      // The overlay remains usable when storage is blocked by browser privacy settings.
    }
  };

  const snapshot = rendererSnapshot(settings, current);
  if (overlayOnly) {
    document.documentElement.classList.add("overlay-document");
    return <main className="overlay-page"><Overlay snapshot={snapshot} /></main>;
  }

  return <WebStudio settings={settings} snapshot={snapshot} onSettings={setSettings} />;
}
