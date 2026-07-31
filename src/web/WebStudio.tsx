import { useState } from "react";
import { defaultConfig, normalizeFriendCode, serializeWebSettings, type WebSettings } from "./data";
import type { ChangeAnimation, OverlayConfig } from "../types";
import { Overlay } from "../components/Overlay";
import {
  BorderPanel,
  ContentPanel,
  ElementLayoutPanel,
  type ConfigPatch
} from "../components/Studio";
import { ColorInput, Field, Range, Section, Segmented, Toggle } from "../components/controls";
import type { Snapshot } from "../types";
import "../styles/studio.css";
import "../styles/web.css";

type Page = "connect" | "content" | "elements" | "background" | "border" | "animation" | "publish";
const pages: { id: Page; icon: string; label: string; detail: string }[] = [
  { id: "connect", icon: "●", label: "Connect", detail: "Player & live data" },
  { id: "content", icon: "◫", label: "Content", detail: "Fields & typography" },
  { id: "elements", icon: "⌖", label: "Elements", detail: "Size & placement" },
  { id: "background", icon: "▧", label: "Background", detail: "Artwork & filters" },
  { id: "border", icon: "◇", label: "Border & light", detail: "Color & motion" },
  { id: "animation", icon: "✦", label: "Animations", detail: "Race reactions" },
  { id: "publish", icon: "↗", label: "OBS & TikTok", detail: "Copy your source" }
];

const animationOptions: { value: ChangeAnimation; label: string }[] = [
  { value: "count", label: "Count up" },
  { value: "spring", label: "Spring" },
  { value: "flip", label: "Flip" },
  { value: "burst", label: "Impact" },
  { value: "none", label: "None" }
];

function partialFriendCode(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 12);
  return [digits.slice(0, 4), digits.slice(4, 8), digits.slice(8, 12)].filter(Boolean).join("-");
}

export function WebStudio({ settings, snapshot, onSettings }: {
  settings: WebSettings;
  snapshot: Snapshot;
  onSettings: (next: WebSettings) => void;
}) {
  const [page, setPage] = useState<Page>("connect");
  const [friendCodeDraft, setFriendCodeDraft] = useState(settings.friendCode);
  const [notice, setNotice] = useState("");

  const updateConfig = (config: OverlayConfig, extras: Partial<WebSettings> = {}) => {
    onSettings({ ...settings, ...extras, config });
  };

  const patch: ConfigPatch = async (section, key, value) => {
    const config = {
      ...settings.config,
      [section]: { ...(settings.config[section] as object), [key]: value }
    };
    const extras: Partial<WebSettings> = {};
    if (section === "data" && key === "pollSeconds") extras.pollSeconds = value as number;
    updateConfig(config, extras);
  };

  const flash = (message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 2600);
  };

  const resetElements = async () => {
    updateConfig({ ...settings.config, elements: structuredClone(defaultConfig.elements) });
    flash("Element layout reset");
  };

  const sourceQuery = serializeWebSettings({
    configPatch: settings.config,
    friendCode: settings.friendCode,
    playerName: settings.playerName,
    tag: settings.tag,
    demo: settings.demo,
    pollSeconds: settings.pollSeconds
  });
  const baseUrl = new URL(import.meta.env.BASE_URL, location.origin);
  const overlayUrl = `${baseUrl.href}?view=overlay&${sourceQuery}`;
  const copySource = async () => {
    await navigator.clipboard.writeText(overlayUrl);
    flash("Hosted overlay URL copied");
  };

  return (
    <div className="studio web-studio">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark"><i>R</i><i>R</i></div>
          <div><strong>Rewind</strong><span>Web Overlay Studio</span></div>
        </div>
        <nav aria-label="Settings sections">
          {pages.map((item) => (
            <button key={item.id} className={page === item.id ? "is-active" : ""} onClick={() => setPage(item.id)}>
              <span className="nav-icon">{item.icon}</span>
              <span><b>{item.label}</b><small>{item.detail}</small></span>
            </button>
          ))}
        </nav>
        <div className="sidebar-footer">
          <div className={`service-dot service-${snapshot.status.phase}`} />
          <div><b>{snapshot.status.phase === "connected" ? "Web overlay ready" : "Configure player"}</b><small>No companion app required</small></div>
        </div>
      </aside>

      <main className="studio-main">
        <header className="topbar">
          <div><p className="eyebrow">RETRO REWIND · ZERO-INSTALL BROADCAST TOOLS</p><h1>{pages.find((item) => item.id === page)?.label}</h1></div>
          <div className="top-actions">
            <span className="save-state">Saved in this browser</span>
            <button className="button button-ghost" onClick={() => window.open(overlayUrl, "_blank")}>Open overlay</button>
            <button className="button button-primary" onClick={() => void copySource()}>Copy source URL</button>
          </div>
        </header>

        <div className="workspace">
          <div className="editor">
            {page === "connect" && (
              <>
                <div className={`status-hero status-${snapshot.status.phase}`}>
                  <div className="status-orb"><span /></div>
                  <div><p>RWFC DATA SERVICE</p><h2>{snapshot.status.message}</h2><span>Fetched directly by your browser—no Rewind server in the middle.</span></div>
                </div>
                <Section title="Player identity" description="The browser cannot read Wheel Wizard files, so enter a friend code once. This stays in your browser and in the source URL.">
                  <Field label="Friend code" hint="Recommended; all 12 digits">
                    <input
                      className="text-input"
                      value={friendCodeDraft}
                      placeholder="1234-5678-9012"
                      onChange={(event) => {
                        const draft = partialFriendCode(event.target.value);
                        setFriendCodeDraft(draft);
                        const friendCode = normalizeFriendCode(draft);
                        if (friendCode) {
                          const config = { ...settings.config, identity: { ...settings.config.identity, friendCode: friendCode.replace(/\D/g, ""), mode: "friendCode" as const } };
                          updateConfig(config, { friendCode, demo: false });
                        } else if (!draft) {
                          const config = { ...settings.config, identity: { ...settings.config.identity, friendCode: "", mode: "manual" as const } };
                          updateConfig(config, { friendCode: "" });
                        }
                      }}
                    />
                  </Field>
                  <Field label="Player name" hint="Fallback display name; can locate you while in a room">
                    <input className="text-input" value={settings.playerName} onChange={(event) => {
                      const playerName = event.target.value;
                      updateConfig({ ...settings.config, identity: { ...settings.config.identity, playerName } }, { playerName });
                    }} />
                  </Field>
                  <Field label="Team / clan tag" hint="Optional prefix before your name">
                    <input className="text-input short" value={settings.tag} placeholder="e.g. ZPL" onChange={(event) => {
                      const tag = event.target.value;
                      updateConfig({ ...settings.config, identity: { ...settings.config.identity, tag } }, { tag });
                    }} />
                  </Field>
                  <Field label="Preview mode" hint="Use polished sample data while designing">
                    <Toggle label="Preview mode" checked={settings.demo} onChange={(demo) => {
                      updateConfig({ ...settings.config, data: { ...settings.config.data, demoMode: demo } }, { demo });
                    }} />
                  </Field>
                  <Field label="Poll interval" hint="The public API is contacted directly">
                    <Range value={settings.pollSeconds} min={3} max={30} unit="s" onChange={(pollSeconds) => {
                      updateConfig({ ...settings.config, data: { ...settings.config.data, pollSeconds } }, { pollSeconds });
                    }} />
                  </Field>
                </Section>
                <div className="web-privacy-note"><b>Private by design</b><span>This is a static page. Your settings are encoded into your URL; no account or hosted database is used.</span></div>
              </>
            )}
            {page === "content" && <ContentPanel config={settings.config} patch={patch} />}
            {page === "elements" && <ElementLayoutPanel config={settings.config} patch={patch} resetAll={resetElements} />}
            {page === "background" && <WebBackgroundPanel config={settings.config} patch={patch} />}
            {page === "border" && <BorderPanel config={settings.config} patch={patch} />}
            {page === "animation" && <WebAnimationPanel config={settings.config} patch={patch} />}
            {page === "publish" && <PublishPanel overlayUrl={overlayUrl} copy={() => void copySource()} />}
          </div>
          <aside className="preview-pane">
            <div className="preview-heading"><span>LIVE PREVIEW</span><b>Same renderer as desktop</b></div>
            <div className="preview-canvas">
              <div className="preview-grid" />
              <Overlay snapshot={snapshot} preview />
            </div>
            <div className="web-preview-status">
              <span className={`service-dot service-${snapshot.status.phase}`} />
              <div><b>{snapshot.player.name}</b><small>{snapshot.player.friendCode || "Preview profile"}</small></div>
              <strong>{snapshot.player.vr.toLocaleString()} VR</strong>
            </div>
          </aside>
        </div>
      </main>
      {notice && <div className="toast">{notice}</div>}
    </div>
  );
}

function WebBackgroundPanel({ config, patch }: { config: OverlayConfig; patch: ConfigPatch }) {
  const bg = config.background;
  return (
    <>
      <Section title="Hosted artwork" description="Paste an HTTPS image address so OBS and TikTok can load it. Browser security prevents a local upload from being shared into a separate source.">
        <Field wide label="Background image URL" hint="PNG, JPEG, WebP, GIF, or another browser-readable image">
          <input className="text-input url" value={bg.imageUrl} placeholder="https://example.com/background.png" onChange={(event) => patch("background", "imageUrl", event.target.value)} />
        </Field>
        <Field label="Image fit"><Segmented value={bg.fit} onChange={(value) => patch("background", "fit", value)} options={[
          { value: "cover", label: "Cover" }, { value: "contain", label: "Contain" }, { value: "stretch", label: "Stretch" }
        ]} /></Field>
        <Field label="Horizontal position"><Range value={bg.x} min={0} max={100} unit="%" onChange={(value) => patch("background", "x", value)} /></Field>
        <Field label="Vertical position"><Range value={bg.y} min={0} max={100} unit="%" onChange={(value) => patch("background", "y", value)} /></Field>
        <Field label="Zoom"><Range value={bg.zoom} min={1} max={3} step={0.05} unit="×" onChange={(value) => patch("background", "zoom", value)} /></Field>
      </Section>
      <Section title="Image treatment" description="Broadcast-safe contrast without editing the original image.">
        <Field label="Brightness"><Range value={bg.brightness} min={0.15} max={1.5} step={0.05} unit="×" onChange={(value) => patch("background", "brightness", value)} /></Field>
        <Field label="Contrast"><Range value={bg.contrast} min={0.5} max={2} step={0.05} unit="×" onChange={(value) => patch("background", "contrast", value)} /></Field>
        <Field label="Saturation"><Range value={bg.saturation} min={0} max={2} step={0.05} unit="×" onChange={(value) => patch("background", "saturation", value)} /></Field>
        <Field label="Blur"><Range value={bg.blur} min={0} max={18} unit="px" onChange={(value) => patch("background", "blur", value)} /></Field>
        <Field label="Tint color"><ColorInput value={bg.overlayColor} onChange={(value) => patch("background", "overlayColor", value)} /></Field>
        <Field label="Tint strength"><Range value={bg.overlayOpacity} min={0} max={0.9} step={0.05} onChange={(value) => patch("background", "overlayOpacity", value)} /></Field>
      </Section>
    </>
  );
}

function WebAnimationPanel({ config, patch }: { config: OverlayConfig; patch: ConfigPatch }) {
  return (
    <Section title="Race-result reactions" description="VR and rank can use different transitions.">
      <Field label="VR change animation"><Segmented value={config.animations.vr} options={animationOptions} onChange={(value) => patch("animations", "vr", value)} /></Field>
      <Field label="Rank change animation"><Segmented value={config.animations.rank} options={animationOptions} onChange={(value) => patch("animations", "rank", value)} /></Field>
      <Field label="Animation duration"><Range value={config.animations.durationMs} min={200} max={2500} step={100} unit="ms" onChange={(value) => patch("animations", "durationMs", value)} /></Field>
      <Field label="Celebration threshold" hint="Confetti appears at or above this gain"><Range value={config.animations.celebrateThreshold} min={0} max={1000} step={25} unit=" VR" onChange={(value) => patch("animations", "celebrateThreshold", value)} /></Field>
      <Field label="Reduce motion"><Toggle label="Reduce motion" checked={config.animations.reducedMotion} onChange={(value) => patch("animations", "reducedMotion", value)} /></Field>
    </Section>
  );
}

function PublishPanel({ overlayUrl, copy }: { overlayUrl: string; copy: () => void }) {
  return (
    <>
      <Section title="Hosted browser source" description="One HTTPS link works in OBS and TikTok Live Studio without the desktop companion running.">
        <div className="obs-callout">
          <span className="obs-logo">◎</span>
          <div><b>Zero-install overlay is ready</b><small>The page polls RWFC directly and keeps last-good data on screen during a network interruption.</small></div>
          <span className="ready-pill">HTTPS</span>
        </div>
        <Field wide label="Your private configured URL"><span className="copy-field"><code>{overlayUrl}</code><button onClick={copy}>Copy</button></span></Field>
        <div className="instruction-list">
          <span>1</span><p><b>Add a browser or web source</b><small>In OBS use Browser Source. In TikTok Live Studio use Link / Web Page Source.</small></p>
          <span>2</span><p><b>Paste this HTTPS URL</b><small>Use a transparent source at roughly 1000 × 300, then resize it in your scene.</small></p>
          <span>3</span><p><b>Keep the URL private</b><small>It contains your friend code and complete visual profile, but no password or token.</small></p>
        </div>
      </Section>
      <Section title="Desktop edition" description="Use the downloadable app when you want automatic Wheel Wizard identity, multi-license following, local image uploads, or a floating always-on-top badge.">
        <div className="action-row"><a className="button button-ghost web-button-link" href="https://github.com/MichaelAccount1/rewind-overlay/releases/latest">Download desktop app</a></div>
      </Section>
    </>
  );
}
