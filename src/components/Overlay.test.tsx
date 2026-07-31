import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { defaultConfig, defaultPlayer } from "../../electron/models";
import type { Snapshot } from "../types";
import { Overlay } from "./Overlay";

const snapshot = (overrides: Partial<Snapshot> = {}): Snapshot => ({
  config: structuredClone(defaultConfig),
  player: structuredClone(defaultPlayer),
  status: {
    phase: "connected",
    message: "Preview mode",
    lastSuccessAt: new Date().toISOString(),
    lastPollAt: new Date().toISOString(),
    consecutiveErrors: 0,
    detectedFriendCode: ""
  },
  ...overrides
});

describe("Overlay", () => {
  it("renders VR, last-race delta, global rank, and player identity", () => {
    render(<Overlay snapshot={snapshot()} preview />);
    expect(screen.getByText("ZPL")).toBeInTheDocument();
    expect(screen.getByText("87,747")).toBeInTheDocument();
    expect(screen.getByText("+41")).toBeInTheDocument();
    expect(screen.getByText("#279")).toBeInTheDocument();
    expect(screen.getByText("PREVIEW MODE")).toBeInTheDocument();
  });

  it("honors field visibility settings", () => {
    const config = structuredClone(defaultConfig);
    config.visibility.delta = false;
    config.visibility.rank = false;
    render(<Overlay snapshot={snapshot({ config })} preview />);
    expect(screen.queryByText("+41")).not.toBeInTheDocument();
    expect(screen.queryByText("#279")).not.toBeInTheDocument();
    expect(screen.getByText("87,747")).toBeInTheDocument();
  });

  it("can hide the Mii icon completely", () => {
    const config = structuredClone(defaultConfig);
    config.visibility.avatar = false;
    const { container } = render(<Overlay snapshot={snapshot({ config })} preview />);
    expect(container.querySelector(".avatar")).not.toBeInTheDocument();
  });

  it("supports solid and transparent Mii backgrounds", () => {
    const config = structuredClone(defaultConfig);
    config.avatar = { background: "solid", color1: "#ff2244", color2: "#113355" };
    const { container, rerender } = render(<Overlay snapshot={snapshot({ config })} preview />);
    const stage = container.querySelector<HTMLElement>(".overlay-stage")!;
    expect(container.querySelector(".avatar")).toHaveClass("avatar-solid");
    expect(stage.style.getPropertyValue("--avatar-color-1")).toBe("#ff2244");

    config.avatar = { ...config.avatar, background: "transparent" };
    rerender(<Overlay snapshot={snapshot({ config })} preview />);
    expect(container.querySelector(".avatar")).toHaveClass("avatar-transparent");
  });

  it("positions and scales elements independently without touching their animation nodes", () => {
    const config = structuredClone(defaultConfig);
    config.elements.vr = { x: -24, y: 11, scale: 1.35 };
    config.elements.rank = { x: 18, y: -7, scale: 0.8 };
    const { container } = render(<Overlay snapshot={snapshot({ config })} preview />);

    expect(container.querySelector<HTMLElement>(".element-vr")?.style.transform)
      .toBe("translate(-24px, 11px) scale(1.35)");
    expect(container.querySelector<HTMLElement>(".element-rank")?.style.transform)
      .toBe("translate(18px, -7px) scale(0.8)");
    expect(screen.getByText("87,747")).toHaveClass("animated-value");
    expect(screen.getByText("#279").closest(".rank-chip")).toHaveClass("anim-flip");
  });

  it("announces the player overlay for assistive technology", () => {
    render(<Overlay snapshot={snapshot()} preview />);
    expect(screen.getByRole("region", { name: /retro rewind player overlay for zpl/i })).toBeInTheDocument();
  });

  it("uses a red change animation for a VR loss", () => {
    const player = structuredClone(defaultPlayer);
    player.vrDelta = -137;
    render(<Overlay snapshot={snapshot({ player })} preview />);
    expect(screen.getByText("87,747").closest(".vr-value")).toHaveClass("change-negative");
  });

  it("wraps dense context fields without truncating their text", () => {
    const config = structuredClone(defaultConfig);
    config.visibility.room = true;
    config.visibility.track = true;
    config.visibility.sessionDelta = true;
    config.visibility.dailyDelta = true;
    const { container } = render(<Overlay snapshot={snapshot({ config })} preview />);
    expect(screen.getByText("GBA Rainbow Road")).toBeInTheDocument();
    expect(screen.getByText("Retro Tracks")).toBeInTheDocument();
    expect(container.querySelector(".overlay-card")).toHaveClass("context-dense");
  });

  it("does not replay delta, rank, or celebration animations for a timestamp-only poll", () => {
    const config = structuredClone(defaultConfig);
    config.animations.celebrateThreshold = 40;
    const player = structuredClone(defaultPlayer);
    const { container, rerender } = render(<Overlay snapshot={snapshot({ config, player })} preview />);
    const delta = screen.getByText("+41");
    const rank = screen.getByText("#279").closest(".rank-chip");
    const celebration = container.querySelector(".celebration");

    rerender(<Overlay snapshot={snapshot({
      config,
      player: { ...player, updatedAt: new Date(Date.now() + 5_000).toISOString() }
    })} preview />);

    expect(screen.getByText("+41")).toBe(delta);
    expect(screen.getByText("#279").closest(".rank-chip")).toBe(rank);
    expect(container.querySelector(".celebration")).toBe(celebration);
  });

  it("restarts value animations when the displayed race values actually change", () => {
    const player = structuredClone(defaultPlayer);
    const { rerender } = render(<Overlay snapshot={snapshot({ player })} preview />);
    const delta = screen.getByText("+41");
    const rank = screen.getByText("#279").closest(".rank-chip");

    rerender(<Overlay snapshot={snapshot({
      player: { ...player, vr: 87_805, vrDelta: 58, rank: 277 }
    })} preview />);

    expect(screen.getByText("+58")).not.toBe(delta);
    expect(screen.getByText("#277").closest(".rank-chip")).not.toBe(rank);
  });

  it("provides two-axis zoom pan in both cover and contain modes", () => {
    const config = structuredClone(defaultConfig);
    config.background = { ...config.background, fit: "cover", zoom: 1.8, x: 25, y: 75 };
    const { container, rerender } = render(<Overlay snapshot={snapshot({ config })} preview />);
    const stage = container.querySelector<HTMLElement>(".overlay-stage")!;
    expect(stage.style.getPropertyValue("--bg-pan-x")).toBe("20%");
    expect(stage.style.getPropertyValue("--bg-pan-y")).toBe("-20%");

    config.background = { ...config.background, fit: "contain" };
    rerender(<Overlay snapshot={snapshot({ config })} preview />);
    expect(stage.style.getPropertyValue("--bg-pan-x")).toBe("20%");
    expect(stage.style.getPropertyValue("--bg-pan-y")).toBe("-20%");
  });
});
