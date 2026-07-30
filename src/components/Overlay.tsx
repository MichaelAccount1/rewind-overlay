import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { API_ORIGIN } from "../api";
import type { Snapshot } from "../types";
import { overlayCardHeight } from "../../electron/overlay-layout";

type Vars = CSSProperties & Record<`--${string}`, string | number>;

function formatRank(rank: number | null): string {
  return rank ? `#${rank.toLocaleString()}` : "UNRANKED";
}

function initials(name: string): string {
  return name.trim().split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase() || "RR";
}

function AnimatedNumber({ value, animation, duration }: {
  value: number; animation: string; duration: number;
}) {
  const previous = useRef(value);
  const [display, setDisplay] = useState(value);
  useEffect(() => {
    if (animation !== "count" || previous.current === value) {
      setDisplay(value);
      previous.current = value;
      return;
    }
    const from = previous.current;
    const started = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      const progress = Math.min(1, (now - started) / duration);
      const eased = 1 - Math.pow(1 - progress, 4);
      setDisplay(Math.round(from + (value - from) * eased));
      if (progress < 1) frame = requestAnimationFrame(tick);
      else previous.current = value;
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, animation, duration]);
  return <span key={`${value}-${animation}`} className={`animated-value anim-${animation}`}>{display.toLocaleString()}</span>;
}

export function Overlay({ snapshot, desktop = false, preview = false }: {
  snapshot: Snapshot; desktop?: boolean; preview?: boolean;
}) {
  const { config, player, status } = snapshot;
  const deltaPositive = (player.vrDelta ?? 0) >= 0;
  const rankPositive = (player.rankDelta ?? 0) >= 0;
  const extras = player.extras;
  const name = [config.visibility.tag ? config.identity.tag || player.tag : "", player.name].filter(Boolean).join(" ");
  const contextCount = [
    config.visibility.room && Boolean(player.room),
    config.visibility.track && Boolean(extras?.trackName),
    config.visibility.sessionDelta && extras?.sessionDelta !== null && extras?.sessionDelta !== undefined,
    config.visibility.dailyDelta && Boolean(extras?.vrStats)
  ].filter(Boolean).length;
  const background = config.background;
  const zoomPan = Math.max(0, background.zoom - 1) * 50;
  const border = config.border;
  const reduce = config.animations.reducedMotion;
  const style = useMemo<Vars>(() => ({
    "--badge-width": `${config.layout.width}px`,
    "--badge-scale": preview ? 1 : config.layout.scale,
    "--border-width": `${border.effect === "off" ? 0 : border.width}px`,
    "--border-radius": `${border.radius}px`,
    "--effect-speed": `${reduce ? 0 : border.speed}s`,
    "--glow-strength": border.glow ? border.glowStrength : 0,
    "--color-1": border.color1,
    "--color-2": border.color2,
    "--color-3": border.color3,
    "--text-color": config.typography.textColor,
    "--muted-color": config.typography.mutedColor,
    "--font-body": config.typography.family,
    "--font-number": config.typography.numberFamily,
    "--font-weight": config.typography.weight,
    "--bg-fit": background.fit === "stretch" ? "100% 100%" : background.fit,
    "--bg-x": `${background.x}%`,
    "--bg-y": `${background.y}%`,
    "--bg-pan-x": `${((50 - background.x) / 50) * zoomPan}%`,
    "--bg-pan-y": `${((50 - background.y) / 50) * zoomPan}%`,
    "--bg-zoom": background.zoom,
    "--bg-blur": `${background.blur}px`,
    "--bg-brightness": background.brightness,
    "--bg-saturation": background.saturation,
    "--bg-contrast": background.contrast,
    "--overlay-color": background.overlayColor,
    "--overlay-opacity": background.overlayOpacity,
    "--glass": background.glass,
    "--card-height": `${overlayCardHeight(config.layout.compact, contextCount)}px`,
    "--animation-duration": `${reduce ? 0 : config.animations.durationMs}ms`
  }), [background, border, config, contextCount, preview, reduce, zoomPan]);

  return (
    <section
      className={`overlay-stage ${desktop ? "is-desktop" : ""} ${preview ? "is-preview" : ""}`}
      style={style}
      aria-label={`Retro Rewind player overlay for ${player.name}`}
    >
      <div className={`overlay-shell border-${border.effect} ${border.glow ? "has-glow" : ""}`}>
        <article className={[
          "overlay-card",
          config.layout.compact ? "is-compact" : "",
          contextCount > 0 ? "has-context" : "",
          contextCount > 2 ? "context-dense" : ""
        ].filter(Boolean).join(" ")}>
          <div
            className="background-layer"
            style={background.imageUrl ? {
              backgroundImage: `url("${background.imageUrl.startsWith("/") ? API_ORIGIN : ""}${background.imageUrl}")`
            } : undefined}
          />
          <div className="background-fallback" />
          <div className="background-shade" />
          <div className="card-content">
            <div className="identity-block">
              {config.visibility.avatar && (
                <div className="avatar" aria-hidden="true">
                  {player.avatarUrl
                    ? <img src={player.avatarUrl} alt="" />
                    : <span>{initials(player.name)}</span>}
                </div>
              )}
              <div className="identity-copy">
                {config.visibility.name && <div className="player-name">{name}</div>}
                {config.visibility.connection && (
                  <div className={`connection connection-${status.phase}`}>
                    <i />{player.online ? player.room || "Online" : "Waiting for room"}
                  </div>
                )}
                {(config.visibility.room || config.visibility.track || config.visibility.sessionDelta || config.visibility.dailyDelta) && (
                  <div className="context-line">
                    {config.visibility.room && player.room && <span>{player.room}</span>}
                    {config.visibility.track && extras?.trackName && <span className="context-track">{extras.trackName}</span>}
                    {config.visibility.sessionDelta && extras?.sessionDelta !== null && extras?.sessionDelta !== undefined && (
                      <span className={extras.sessionDelta >= 0 ? "positive" : "negative"}>
                        SESSION {extras.sessionDelta >= 0 ? "+" : ""}{extras.sessionDelta.toLocaleString()}
                      </span>
                    )}
                    {config.visibility.dailyDelta && extras?.vrStats && (
                      <span className={extras.vrStats.last24Hours >= 0 ? "positive" : "negative"}>
                        24H {extras.vrStats.last24Hours >= 0 ? "+" : ""}{extras.vrStats.last24Hours.toLocaleString()}
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>

            <div className="rating-block">
              {config.visibility.vr && (
                <div className="vr-line">
                  <div className={`vr-value ${(player.vrDelta ?? 0) < 0 ? "change-negative" : "change-positive"}`}>
                    <AnimatedNumber
                      value={player.vr}
                      animation={config.animations.vr}
                      duration={config.animations.durationMs}
                    />
                  </div>
                  {config.visibility.delta && player.vrDelta !== null && (
                    <div key={`${player.vr}-${player.vrDelta}`} className={`delta ${deltaPositive ? "positive" : "negative"}`}>
                      <span className="delta-arrow">{deltaPositive ? "▲" : "▼"}</span>
                      {deltaPositive ? "+" : ""}{player.vrDelta.toLocaleString()}
                    </div>
                  )}
                </div>
              )}
              <div className="meta-line">
                {config.visibility.rank && (
                  <div key={player.rank ?? "unranked"} className={`rank-chip anim-${config.animations.rank}`}>
                    <span>{formatRank(player.rank)}</span>
                    {config.visibility.rankDelta && player.rankDelta !== null && player.rankDelta !== 0 && (
                      <b className={rankPositive ? "positive" : "negative"}>
                        {rankPositive ? "▲" : "▼"} {Math.abs(player.rankDelta)}
                      </b>
                    )}
                  </div>
                )}
                <span className="vr-label">VR</span>
              </div>
            </div>
          </div>
          {player.source === "demo" && <div className="preview-mode-pill">PREVIEW MODE</div>}
          {Math.abs(player.vrDelta ?? 0) >= config.animations.celebrateThreshold && player.vrDelta! > 0 && (
            <div key={`burst-${player.vr}-${player.vrDelta}`} className="celebration" aria-hidden="true">
              {Array.from({ length: 12 }, (_, index) => <i key={index} />)}
            </div>
          )}
        </article>
        {desktop && !config.desktop.clickThrough && <div className="drag-hint">DRAG TO MOVE</div>}
      </div>
    </section>
  );
}
