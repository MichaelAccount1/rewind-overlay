import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
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

afterEach(() => vi.unstubAllGlobals());

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

  it("imports a desktop JSON profile and keeps the current web identity", async () => {
    const { settings, snapshot } = fixture();
    settings.friendCode = "3822-5220-6288";
    settings.demo = false;
    const onSettings = vi.fn();
    const { container } = render(<WebStudio settings={settings} snapshot={snapshot} onSettings={onSettings} />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const profile = {
      text: async () => JSON.stringify({
        visibility: { avatar: false },
        background: { color: "#123456" }
      })
    };

    fireEvent.change(input, { target: { files: [profile] } });

    await waitFor(() => expect(onSettings).toHaveBeenCalledWith(expect.objectContaining({
      friendCode: "3822-5220-6288",
      demo: false,
      config: expect.objectContaining({
        visibility: expect.objectContaining({ avatar: false }),
        background: expect.objectContaining({ color: "#123456" })
      })
    })));
    expect(screen.getByText("Desktop profile imported")).toBeInTheDocument();
  });

  it("offers JSON profile import and export in the top bar", () => {
    const { settings, snapshot } = fixture();
    render(<WebStudio settings={settings} snapshot={snapshot} onSettings={vi.fn()} />);

    expect(screen.getByRole("button", { name: "Import JSON" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Export JSON" })).toBeInTheDocument();
  });

  it("offers a local background browser and embeds the processed image", async () => {
    const { settings, snapshot } = fixture();
    const onSettings = vi.fn();
    vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ width: 800, height: 450, close: vi.fn() })));
    vi.stubGlobal("OffscreenCanvas", class {
      getContext() { return { drawImage: vi.fn() }; }
      async convertToBlob() {
        return {
          size: 2,
          type: "image/jpeg",
          arrayBuffer: async () => new Uint8Array([72, 105]).buffer
        };
      }
    });
    const { container } = render(<WebStudio settings={settings} snapshot={snapshot} onSettings={onSettings} />);

    fireEvent.click(screen.getByRole("button", { name: /Background/ }));
    expect(screen.getByRole("button", { name: "Browse local image" })).toBeInTheDocument();
    const input = container.querySelector('input[accept^="image/png"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [{ type: "image/png" }] } });

    await waitFor(() => expect(onSettings).toHaveBeenCalledWith(expect.objectContaining({
      config: expect.objectContaining({
        background: expect.objectContaining({
          imageUrl: expect.stringMatching(/^data:image\/jpeg;base64,/)
        })
      })
    })));
    expect(screen.getByText(/Background embedded/)).toBeInTheDocument();
  });

  it("warns when an embedded image makes the source URL unusually long", () => {
    const { settings, snapshot } = fixture();
    settings.config.background.imageUrl = `data:image/jpeg;base64,${"A".repeat(1_200_000)}`;
    render(<WebStudio settings={settings} snapshot={snapshot} onSettings={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: /OBS & TikTok/ }));
    expect(screen.getByText("This source URL is unusually long")).toBeInTheDocument();
  });
});
