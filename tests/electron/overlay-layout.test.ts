import { describe, expect, it } from "vitest";
import { defaultConfig } from "../../electron/models.js";
import {
  overlayCardHeight,
  overlayGlowMargin,
  overlayWindowSize
} from "../../electron/overlay-layout.js";

describe("desktop overlay layout", () => {
  it("reserves transparent native-window space for the complete glow", () => {
    const config = structuredClone(defaultConfig);
    const margin = overlayGlowMargin(config);
    const size = overlayWindowSize(config);

    expect(margin).toBeGreaterThanOrEqual(60);
    expect(size.width).toBe(config.layout.width + margin * 2);
    expect(size.height).toBe(150 + config.border.width * 2 + margin * 2);
  });

  it("keeps a small safety gutter when glow is disabled", () => {
    const config = structuredClone(defaultConfig);
    config.border.glow = false;

    expect(overlayGlowMargin(config)).toBe(8);
    expect(overlayWindowSize(config)).toEqual({ width: 576, height: 174 });
  });

  it("sizes for wrapped context rows and compact mode", () => {
    expect(overlayCardHeight(false, 0)).toBe(150);
    expect(overlayCardHeight(false, 4)).toBe(198);
    expect(overlayCardHeight(true, 1)).toBe(160);
    expect(overlayCardHeight(true, 4)).toBe(186);
  });

  it("scales the badge, border, and glow gutter together", () => {
    const config = structuredClone(defaultConfig);
    config.layout.scale = 2;
    const margin = overlayGlowMargin(config);

    expect(overlayWindowSize(config)).toEqual({
      width: config.layout.width * 2 + margin * 2,
      height: (150 + config.border.width * 2) * 2 + margin * 2
    });
  });
});
