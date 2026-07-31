import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { api } from "../api";
import type { BorderEffect, ChangeAnimation, OverlayConfig, Snapshot } from "../types";
import { Overlay } from "./Overlay";
import { ColorInput, Field, Range, Section, Segmented, Toggle } from "./controls";
import "../styles/studio.css";

type Page = "live" | "identity" | "content" | "background" | "border" | "animation" | "output";
const pages: { id: Page; icon: string; label: string; detail: string }[] = [
  { id: "live", icon: "●", label: "Live", detail: "Status & preview" },
  { id: "identity", icon: "◎", label: "Player", detail: "Detection & data" },
  { id: "content", icon: "◫", label: "Content", detail: "Layout & fields" },
  { id: "background", icon: "▧", label: "Background", detail: "Image & filters" },
  { id: "border", icon: "◇", label: "Border & light", detail: "Color & motion" },
  { id: "animation", icon: "✦", label: "Animations", detail: "Race reactions" },
  { id: "output", icon: "↗", label: "OBS & desktop", detail: "Broadcast output" }
];

const visibilityLabels: Record<keyof OverlayConfig["visibility"], [string, string]> = {
  avatar: ["Player avatar", "Mii image when provided by RWFC"],
  name: ["Player name", "Live Mii name or manual fallback"],
  tag: ["Team tag", "Prepended to the player name"],
  vr: ["Versus rating", "Current live VR"],
  delta: ["Last-race change", "Authoritative gain or loss from race history"],
  rank: ["Global rank", "Leaderboard position"],
  rankDelta: ["Rank movement", "Places climbed or lost"],
  connection: ["Connection status", "Live, waiting, or reconnecting"],
  room: ["Room / mode", "Current matchmaking room type"],
  track: ["Current track", "Track reported by the live race"],
  sessionDelta: ["Session change", "VR gained or lost since launch"],
  dailyDelta: ["24-hour change", "Change reported by the leaderboard"]
};

export function Studio({ snapshot, connectionError }: { snapshot: Snapshot; connectionError: string }) {
  const [page, setPage] = useState<Page>("live");
  const [draft, setDraft] = useState(snapshot.config);
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const importRef = useRef<HTMLInputElement>(null);

  useEffect(() => setDraft(snapshot.config), [snapshot.config]);

  const patch = async <S extends keyof OverlayConfig, K extends keyof OverlayConfig[S]>(
    section: S, key: K, value: OverlayConfig[S][K]
  ) => {
    setDraft((current) => ({
      ...current,
      [section]: { ...(current[section] as object), [key]: value }
    }));
    setSaving(true);
    try { await api.config({ [section]: { [key]: value } }); setNotice(""); }
    catch (error) { setNotice(error instanceof Error ? error.message : "Could not save setting"); }
    finally { setSaving(false); }
  };

  const flash = (message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 2500);
  };

  const uploadBackground = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try { await api.background(String(reader.result)); flash("Background saved"); }
      catch (error) { setNotice(error instanceof Error ? error.message : "Upload failed"); }
    };
    reader.readAsDataURL(file);
  };

  const exportSettings = () => {
    const blob = new Blob([JSON.stringify(draft, null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = "rewind-overlay-profile.json";
    link.click();
    URL.revokeObjectURL(link.href);
    flash("Profile exported");
  };

  const importSettings = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text()) as unknown;
      await api.config(parsed);
      flash("Profile imported");
    } catch { setNotice("That profile is not valid JSON."); }
    event.target.value = "";
  };

  return (
    <div className="studio">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark"><i>R</i><i>R</i></div>
          <div><strong>Rewind</strong><span>Overlay Studio</span></div>
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
          <div><b>{snapshot.status.phase === "connected" ? "Overlay ready" : "Needs attention"}</b><small>Local port 19488</small></div>
        </div>
      </aside>

      <main className="studio-main">
        <header className="topbar">
          <div>
            <p className="eyebrow">RETRO REWIND BROADCAST TOOLS</p>
            <h1>{pages.find((item) => item.id === page)?.label}</h1>
          </div>
          <div className="top-actions">
            <span className={`save-state ${saving ? "is-saving" : ""}`}>{saving ? "Saving…" : "All changes saved"}</span>
            <button className="button button-ghost" onClick={exportSettings}>Export</button>
            <button className="button button-primary" onClick={() => api.window("show")}>Show overlay</button>
          </div>
        </header>

        <div className="workspace">
          <div className="editor">
            {page === "live" && <LivePanel snapshot={snapshot} connectionError={connectionError} />}
            {page === "identity" && <IdentityPanel config={draft} status={snapshot.status} patch={patch} />}
            {page === "content" && <ContentPanel config={draft} patch={patch} />}
            {page === "background" && <BackgroundPanel config={draft} patch={patch} upload={uploadBackground} />}
            {page === "border" && <BorderPanel config={draft} patch={patch} />}
            {page === "animation" && <AnimationPanel config={draft} patch={patch} />}
            {page === "output" && (
              <OutputPanel
                config={draft} patch={patch} flash={flash}
                exportSettings={exportSettings} importSettings={() => importRef.current?.click()}
              />
            )}
          </div>
          <aside className="preview-pane">
            <div className="preview-heading"><span>LIVE PREVIEW</span><b>16:9 safe area</b></div>
            <div className="preview-canvas">
              <div className="preview-grid" />
              <Overlay snapshot={{ ...snapshot, config: draft }} preview />
            </div>
            <div className="preview-events">
              <span>Test race result</span>
              <div>
                <button onClick={() => api.demo("gain")}>+ Gain</button>
                <button onClick={() => api.demo("loss")}>− Loss</button>
                <button onClick={() => api.demo("rank")}>↑ Rank</button>
              </div>
            </div>
          </aside>
        </div>
      </main>
      {notice && <div className="toast">{notice}</div>}
      <input ref={importRef} hidden type="file" accept="application/json,.json" onChange={importSettings} />
    </div>
  );
}

type Patch = <S extends keyof OverlayConfig, K extends keyof OverlayConfig[S]>(
  section: S, key: K, value: OverlayConfig[S][K]
) => Promise<void>;

function LivePanel({ snapshot, connectionError }: { snapshot: Snapshot; connectionError: string }) {
  const { player, status } = snapshot;
  return (
    <>
      <div className={`status-hero status-${status.phase}`}>
        <div className="status-orb"><span /></div>
        <div><p>DATA SERVICE</p><h2>{status.message}</h2><span>{connectionError || `Updated ${new Date(player.updatedAt).toLocaleTimeString()}`}</span></div>
      </div>
      <div className="metric-grid">
        <div><span>Current VR</span><strong>{player.vr.toLocaleString()}</strong><b className={(player.vrDelta ?? 0) >= 0 ? "positive" : "negative"}>{(player.vrDelta ?? 0) >= 0 ? "+" : ""}{player.vrDelta ?? "—"} last race</b></div>
        <div><span>Global rank</span><strong>{player.rank ? `#${player.rank.toLocaleString()}` : "—"}</strong><b>{player.rankDelta ? `${player.rankDelta > 0 ? "↑" : "↓"} ${Math.abs(player.rankDelta)} places` : "No movement"}</b></div>
        <div><span>Identity</span><strong className="metric-name">{player.name}</strong><b>{player.friendCode || "Preview profile"}</b></div>
        <div><span>Source</span><strong className="metric-name">{player.source === "demo" ? "Preview" : "Official RWFC"}</strong><b>{player.online ? player.room || "Online" : "Not in a room"}</b></div>
      </div>
      <Section title="Quick test" description="Trigger real overlay transitions before going live.">
        <div className="action-row">
          <button className="button button-success" onClick={() => api.demo("gain")}>Simulate VR gain</button>
          <button className="button button-danger" onClick={() => api.demo("loss")}>Simulate VR loss</button>
          <button className="button button-ghost" onClick={() => api.demo("rank")}>Simulate rank climb</button>
          <button className="button button-ghost" onClick={() => api.demo("reset")}>Reset preview</button>
        </div>
      </Section>
    </>
  );
}

function IdentityPanel({ config, status, patch }: { config: OverlayConfig; status: Snapshot["status"]; patch: Patch }) {
  return (
    <>
      <Section title="Player detection" description="Automatic mode reads the active Wheel Wizard / RetroWFC license locally.">
        <Field label="Identity source" hint="Console players can use a friend code">
          <Segmented value={config.identity.mode} onChange={(value) => patch("identity", "mode", value)} options={[
            { value: "auto", label: "Automatic" }, { value: "friendCode", label: "Friend code" }, { value: "manual", label: "Name only" }
          ]} />
        </Field>
        {config.identity.mode === "auto" && (
          <div className="detection-box"><span className={status.detectedFriendCode ? "ok" : ""}>◎</span><div>
            <b>{status.detectedFriendCode
              ? "Wheel Wizard license detected"
              : config.data.demoMode
                ? "Preview mode — watching for Wheel Wizard"
                : "Waiting for a local license"}</b>
            <small>{status.detectedFriendCode || (config.data.demoMode
              ? "Sample data is labeled on the badge and switches to live automatically when a license is found."
              : "Open Wheel Wizard once, or choose Friend code above.")}</small>
          </div></div>
        )}
        {status.identitySteps && status.identitySteps.length > 0 && (
          <details className="identity-trail">
            <summary>Detection details <span>{status.identitySteps.length} checks</span></summary>
            <ol>
              {status.identitySteps.map((step, index) => <li key={`${index}-${step}`}>{step}</li>)}
            </ol>
          </details>
        )}
        {config.identity.mode === "friendCode" && (
          <Field label="Friend code" hint="12 digits; dashes are optional">
            <input className="text-input" value={config.identity.friendCode} placeholder="1234-5678-9012" onChange={(event) => patch("identity", "friendCode", event.target.value)} />
          </Field>
        )}
        <Field label="Fallback name" hint="Used for preview and name matching">
          <input className="text-input" value={config.identity.playerName} onChange={(event) => patch("identity", "playerName", event.target.value)} />
        </Field>
        <Field label="Team / clan tag" hint="Optional, appears before your name">
          <input className="text-input short" value={config.identity.tag} placeholder="e.g. ZPL" onChange={(event) => patch("identity", "tag", event.target.value)} />
        </Field>
      </Section>
      <Section title="Official data service" description="Advanced options. Defaults target the public Retro WFC API.">
        <Field wide label="Room status endpoint"><input className="text-input url" value={config.data.groupsUrl} onChange={(event) => patch("data", "groupsUrl", event.target.value)} /></Field>
        <Field wide label="Player endpoint" hint="Use {friendCode} as the player placeholder"><input className="text-input url" value={config.data.leaderboardUrl} onChange={(event) => patch("data", "leaderboardUrl", event.target.value)} /></Field>
        <Field label="Poll interval" hint="Be considerate of the community service"><Range value={config.data.pollSeconds} min={3} max={30} unit="s" onChange={(value) => patch("data", "pollSeconds", value)} /></Field>
        <Field label="Preview mode" hint="Shows labeled sample data while automatic detection watches for a real license"><Toggle label="Preview mode" checked={config.data.demoMode} onChange={(value) => patch("data", "demoMode", value)} /></Field>
      </Section>
    </>
  );
}

function ContentPanel({ config, patch }: { config: OverlayConfig; patch: Patch }) {
  return (
    <>
      <Section title="Mii icon" description="Show the player's RWFC Mii, recolor its circular backing, or remove it completely.">
        <Field label="Show Mii icon" hint="Turn this off to remove the icon and reclaim its space">
          <Toggle label="Show Mii icon" checked={config.visibility.avatar} onChange={(value) => patch("visibility", "avatar", value)} />
        </Field>
        {config.visibility.avatar && (
          <>
            <Field label="Mii background">
              <Segmented value={config.avatar.background} onChange={(value) => patch("avatar", "background", value)} options={[
                { value: "gradient", label: "Gradient" },
                { value: "solid", label: "Solid" },
                { value: "transparent", label: "Clear" }
              ]} />
            </Field>
            {config.avatar.background !== "transparent" && (
              <Field label={config.avatar.background === "solid" ? "Background color" : "Gradient start"}>
                <ColorInput value={config.avatar.color1} onChange={(value) => patch("avatar", "color1", value)} />
              </Field>
            )}
            {config.avatar.background === "gradient" && (
              <Field label="Gradient end">
                <ColorInput value={config.avatar.color2} onChange={(value) => patch("avatar", "color2", value)} />
              </Field>
            )}
          </>
        )}
      </Section>
      <Section title="Visible information" description="Every data point can be enabled independently.">
        {(Object.keys(visibilityLabels) as (keyof OverlayConfig["visibility"])[]).filter((key) => key !== "avatar").map((key) => (
          <Field key={key} label={visibilityLabels[key][0]} hint={visibilityLabels[key][1]}>
            <Toggle label={visibilityLabels[key][0]} checked={config.visibility[key]} onChange={(value) => patch("visibility", key, value)} />
          </Field>
        ))}
      </Section>
      <Section title="Shape & scale">
        <Field label="Overlay width"><Range value={config.layout.width} min={340} max={900} step={10} unit="px" onChange={(value) => patch("layout", "width", value)} /></Field>
        <Field label="Desktop scale"><Range value={config.layout.scale} min={0.5} max={2} step={0.05} unit="×" onChange={(value) => patch("layout", "scale", value)} /></Field>
        <Field label="Compact height" hint="Better for dense stream layouts"><Toggle label="Compact height" checked={config.layout.compact} onChange={(value) => patch("layout", "compact", value)} /></Field>
      </Section>
      <Section title="Typography">
        <Field label="Text color"><ColorInput value={config.typography.textColor} onChange={(value) => patch("typography", "textColor", value)} /></Field>
        <Field label="Secondary color"><ColorInput value={config.typography.mutedColor} onChange={(value) => patch("typography", "mutedColor", value)} /></Field>
        <Field label="Font weight"><Range value={config.typography.weight} min={500} max={900} step={100} onChange={(value) => patch("typography", "weight", value)} /></Field>
      </Section>
    </>
  );
}

function BackgroundPanel({ config, patch, upload }: { config: OverlayConfig; patch: Patch; upload: (event: ChangeEvent<HTMLInputElement>) => void }) {
  const bg = config.background;
  return (
    <>
      <Section title="Artwork" description="Upload once, then frame it precisely with pan and zoom.">
        <label className="upload-zone">
          <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={upload} />
          <span className="upload-icon">＋</span>
          <div><b>{bg.imageUrl ? "Replace background image" : "Choose a background image"}</b><small>PNG, JPEG, WebP, or animated GIF · up to 20 MB</small></div>
        </label>
        <Field label="Image fit">
          <Segmented value={bg.fit} onChange={(value) => patch("background", "fit", value)} options={[
            { value: "cover", label: "Cover" }, { value: "contain", label: "Contain" }, { value: "stretch", label: "Stretch" }
          ]} />
        </Field>
        <Field label="Horizontal position"><Range value={bg.x} min={0} max={100} unit="%" onChange={(value) => patch("background", "x", value)} /></Field>
        <Field label="Vertical position"><Range value={bg.y} min={0} max={100} unit="%" onChange={(value) => patch("background", "y", value)} /></Field>
        <Field label="Zoom"><Range value={bg.zoom} min={1} max={3} step={0.05} unit="×" onChange={(value) => patch("background", "zoom", value)} /></Field>
      </Section>
      <Section title="Image treatment" description="Broadcast-safe contrast without editing your source file.">
        <Field label="Brightness"><Range value={bg.brightness} min={0.15} max={1.5} step={0.05} unit="×" onChange={(value) => patch("background", "brightness", value)} /></Field>
        <Field label="Contrast"><Range value={bg.contrast} min={0.5} max={2} step={0.05} unit="×" onChange={(value) => patch("background", "contrast", value)} /></Field>
        <Field label="Saturation"><Range value={bg.saturation} min={0} max={2} step={0.05} unit="×" onChange={(value) => patch("background", "saturation", value)} /></Field>
        <Field label="Blur"><Range value={bg.blur} min={0} max={18} unit="px" onChange={(value) => patch("background", "blur", value)} /></Field>
        <Field label="Glass softness"><Range value={bg.glass} min={0} max={1} step={0.05} onChange={(value) => patch("background", "glass", value)} /></Field>
        <Field label="Tint color"><ColorInput value={bg.overlayColor} onChange={(value) => patch("background", "overlayColor", value)} /></Field>
        <Field label="Tint strength"><Range value={bg.overlayOpacity} min={0} max={0.9} step={0.05} onChange={(value) => patch("background", "overlayOpacity", value)} /></Field>
      </Section>
    </>
  );
}

const borderOptions: { value: BorderEffect; label: string; detail: string }[] = [
  { value: "rainbow", label: "Prism", detail: "Full-spectrum rotation" },
  { value: "snake", label: "Chaser", detail: "Light snakes around edge" },
  { value: "pulse", label: "Pulse", detail: "Breathing color energy" },
  { value: "wave", label: "Wave", detail: "Colors travel side to side" },
  { value: "ghost", label: "Ghost", detail: "Sparse ethereal streaks" },
  { value: "solid", label: "Solid", detail: "Quiet single-color frame" },
  { value: "off", label: "None", detail: "No frame" }
];

function BorderPanel({ config, patch }: { config: OverlayConfig; patch: Patch }) {
  const border = config.border;
  return (
    <>
      <Section title="Light engine" description="Choose a motion language, then tune its character.">
        <div className="effect-grid">
          {borderOptions.map((option) => (
            <button key={option.value} className={border.effect === option.value ? "is-active" : ""} onClick={() => patch("border", "effect", option.value)}>
              <i className={`effect-swatch swatch-${option.value}`} /><span><b>{option.label}</b><small>{option.detail}</small></span>
            </button>
          ))}
        </div>
        <Field label="Animation speed"><Range value={border.speed} min={1} max={15} step={0.5} unit="s" onChange={(value) => patch("border", "speed", value)} /></Field>
        <Field label="Border width"><Range value={border.width} min={1} max={12} unit="px" onChange={(value) => patch("border", "width", value)} /></Field>
        <Field label="Corner radius"><Range value={border.radius} min={8} max={64} unit="px" onChange={(value) => patch("border", "radius", value)} /></Field>
      </Section>
      <Section title="Palette & glow">
        <Field label="Primary"><ColorInput value={border.color1} onChange={(value) => patch("border", "color1", value)} /></Field>
        <Field label="Secondary"><ColorInput value={border.color2} onChange={(value) => patch("border", "color2", value)} /></Field>
        <Field label="Accent"><ColorInput value={border.color3} onChange={(value) => patch("border", "color3", value)} /></Field>
        <Field label="Outer glow"><Toggle label="Outer glow" checked={border.glow} onChange={(value) => patch("border", "glow", value)} /></Field>
        {border.glow && <Field label="Glow strength"><Range value={border.glowStrength} min={0.1} max={1} step={0.05} onChange={(value) => patch("border", "glowStrength", value)} /></Field>}
      </Section>
    </>
  );
}

const animationOptions: { value: ChangeAnimation; label: string }[] = [
  { value: "count", label: "Count up" }, { value: "spring", label: "Spring" },
  { value: "flip", label: "Flip" }, { value: "burst", label: "Impact" }, { value: "none", label: "None" }
];

function AnimationPanel({ config, patch }: { config: OverlayConfig; patch: Patch }) {
  return (
    <>
      <Section title="Race-result reactions" description="VR and rank can use different transitions.">
        <Field label="VR change animation"><Segmented value={config.animations.vr} options={animationOptions} onChange={(value) => patch("animations", "vr", value)} /></Field>
        <Field label="Rank change animation"><Segmented value={config.animations.rank} options={animationOptions} onChange={(value) => patch("animations", "rank", value)} /></Field>
        <Field label="Animation duration"><Range value={config.animations.durationMs} min={200} max={2500} step={100} unit="ms" onChange={(value) => patch("animations", "durationMs", value)} /></Field>
        <Field label="Celebration threshold" hint="Confetti appears for VR gains at or above this amount"><Range value={config.animations.celebrateThreshold} min={0} max={1000} step={25} unit=" VR" onChange={(value) => patch("animations", "celebrateThreshold", value)} /></Field>
        <Field label="Reduce motion" hint="Disables decorative movement and transitions"><Toggle label="Reduce motion" checked={config.animations.reducedMotion} onChange={(value) => patch("animations", "reducedMotion", value)} /></Field>
      </Section>
      <div className="animation-demos">
        <button onClick={() => api.demo("gain")}><span className="positive">+241 VR</span><b>Preview gain</b></button>
        <button onClick={() => api.demo("loss")}><span className="negative">−137 VR</span><b>Preview loss</b></button>
        <button onClick={() => api.demo("rank")}><span>↑ 8</span><b>Preview rank</b></button>
      </div>
    </>
  );
}

function OutputPanel({ config, patch, flash, exportSettings, importSettings }: {
  config: OverlayConfig; patch: Patch; flash: (message: string) => void;
  exportSettings: () => void; importSettings: () => void;
}) {
  const obsUrl = "http://127.0.0.1:19488/overlay?obs=1";
  const copy = async () => { await navigator.clipboard.writeText(obsUrl); flash("OBS URL copied"); };
  return (
    <>
      <Section title="OBS Studio" description="The included OBS script adds this browser source in one click. Manual setup works everywhere.">
        <div className="obs-callout">
          <span className="obs-logo">◉</span>
          <div><b>Browser source is ready</b><small>Keep Rewind Overlay running while streaming.</small></div>
          <span className="ready-pill">READY</span>
        </div>
        <Field wide label="Local overlay URL"><span className="copy-field"><code>{obsUrl}</code><button onClick={copy}>Copy</button></span></Field>
        <div className="instruction-list">
          <span>1</span><p><b>Tools → Scripts → +</b><small>Select <code>rewind-overlay.lua</code> from the app's OBS folder.</small></p>
          <span>2</span><p><b>Click “Add overlay to current scene”</b><small>The plugin creates a transparent, hardware-accelerated browser source.</small></p>
          <span>3</span><p><b>Crop and position in your scene</b><small>All styling stays controlled here—no OBS property juggling.</small></p>
        </div>
      </Section>
      <Section title="Floating desktop overlay" description="A transparent, borderless window that remains above the game.">
        <div className="action-row output-buttons">
          <button className="button button-primary" onClick={() => api.window("show")}>Show window</button>
          <button className="button button-ghost" onClick={() => api.window("center")}>Center on screen</button>
          <button className="button button-ghost" onClick={() => api.window("hide")}>Hide</button>
        </div>
        <Field label="Always on top"><Toggle label="Always on top" checked={config.desktop.alwaysOnTop} onChange={(value) => patch("desktop", "alwaysOnTop", value)} /></Field>
        <Field label="Click through" hint="Use the tray menu to turn this off again"><Toggle label="Click through" checked={config.desktop.clickThrough} onChange={(value) => patch("desktop", "clickThrough", value)} /></Field>
        <Field label="Show in taskbar"><Toggle label="Show in taskbar" checked={config.desktop.showInTaskbar} onChange={(value) => patch("desktop", "showInTaskbar", value)} /></Field>
        <Field label="Window opacity"><Range value={config.desktop.opacity} min={0.2} max={1} step={0.05} onChange={(value) => patch("desktop", "opacity", value)} /></Field>
      </Section>
      <Section title="Profiles & portability">
        <div className="action-row"><button className="button button-ghost" onClick={exportSettings}>Export profile</button><button className="button button-ghost" onClick={importSettings}>Import profile</button><button className="button button-danger-outline" onClick={() => { if (confirm("Reset every appearance and data setting?")) void api.reset(); }}>Reset everything</button></div>
      </Section>
    </>
  );
}
