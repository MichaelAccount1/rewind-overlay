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

  it("announces the player overlay for assistive technology", () => {
    render(<Overlay snapshot={snapshot()} preview />);
    expect(screen.getByRole("region", { name: /retro rewind player overlay for zpl/i })).toBeInTheDocument();
  });
});
