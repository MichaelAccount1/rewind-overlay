import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { defaultConfig, defaultPlayer } from "../../electron/models";
import type { Snapshot } from "../types";
import type { WebSettings } from "./data";
import { WebStudio } from "./WebStudio";

function fixture(): { settings: WebSettings; snapshot: Snapshot } {
  const config = structuredClone(defaultConfig);
  const settings: WebSettings = {
    config,
    friendCode: "",
    playerName: "",
    tag: "",
    demo: true,
    pollSeconds: 5
  };
  return {
    settings,
    snapshot: {
      config,
      player: structuredClone(defaultPlayer),
      status: {
        phase: "connected",
        message: "Preview mode",
        lastSuccessAt: null,
        lastPollAt: null,
        consecutiveErrors: 0,
        detectedFriendCode: ""
      }
    }
  };
}

describe("WebStudio", () => {
  it("turns a complete friend code into live browser settings", () => {
    const { settings, snapshot } = fixture();
    const onSettings = vi.fn();
    render(<WebStudio settings={settings} snapshot={snapshot} onSettings={onSettings} />);

    fireEvent.change(screen.getByPlaceholderText("1234-5678-9012"), {
      target: { value: "382252206288" }
    });

    expect(onSettings).toHaveBeenCalledWith(expect.objectContaining({
      friendCode: "3822-5220-6288",
      demo: false
    }));
  });

  it("exposes Mii removal in the hosted configurator", () => {
    const { settings, snapshot } = fixture();
    const onSettings = vi.fn();
    render(<WebStudio settings={settings} snapshot={snapshot} onSettings={onSettings} />);

    fireEvent.click(screen.getByRole("button", { name: /Content/ }));
    fireEvent.click(screen.getByRole("switch", { name: "Show Mii icon" }));

    expect(onSettings).toHaveBeenCalledWith(expect.objectContaining({
      config: expect.objectContaining({
        visibility: expect.objectContaining({ avatar: false })
      })
    }));
  });

  it("describes TikTok's hosted Link Source workflow", () => {
    const { settings, snapshot } = fixture();
    render(<WebStudio settings={settings} snapshot={snapshot} onSettings={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: /OBS & TikTok/ }));
    expect(screen.getByText(/TikTok Live Studio use Link \/ Web Page Source/i)).toBeInTheDocument();
  });
});
