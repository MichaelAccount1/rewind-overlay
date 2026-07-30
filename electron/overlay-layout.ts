import type { OverlayConfig } from "./models.js";

export function overlayContextCount(config: OverlayConfig): number {
  return [
    config.visibility.room,
    config.visibility.track,
    config.visibility.sessionDelta,
    config.visibility.dailyDelta
  ].filter(Boolean).length;
}

export function overlayCardHeight(compact: boolean, contextCount: number): number {
  if (contextCount > 2) return compact ? 186 : 198;
  if (contextCount > 0) return compact ? 160 : 176;
  return compact ? 118 : 150;
}

export function overlayGlowMargin(config: OverlayConfig): number {
  const scale = config.layout.scale;
  const borderWidth = config.border.effect === "off" ? 0 : config.border.width;
  if (!config.border.glow || config.border.effect === "off") return Math.ceil(8 * scale);

  // CSS drop-shadow blur has a soft tail well beyond its nominal radius.
  // Reserve enough native-window space for that tail plus animated pulse glow.
  const blur = 8 + 18 * config.border.glowStrength;
  return Math.ceil((blur * 2.6 + borderWidth + 4) * scale);
}

export function overlayWindowSize(config: OverlayConfig): { width: number; height: number } {
  const scale = config.layout.scale;
  const borderWidth = config.border.effect === "off" ? 0 : config.border.width;
  const cardHeight = overlayCardHeight(config.layout.compact, overlayContextCount(config));
  const margin = overlayGlowMargin(config);
  return {
    width: Math.ceil(config.layout.width * scale + margin * 2),
    height: Math.ceil((cardHeight + borderWidth * 2) * scale + margin * 2)
  };
}
