import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultConfig, defaultPlayer } from "../../electron/models";
import type { Snapshot } from "../types";
import { Studio } from "./Studio";

const snapshot = (): Snapshot => ({
  config: structuredClone(defaultConfig),
  player: structuredClone(defaultPlayer),
  status: {
    phase: "connected",
    message: "Live data connected",
    lastSuccessAt: new Date().toISOString(),
    lastPollAt: new Date().toISOString(),
    consecutiveErrors: 0,
    detectedFriendCode: "1111-2222-3333",
    licenses: [
      { slot: 0, name: "Primary", friendCode: "1111-2222-3333", active: true },
      { slot: 2, name: "Alternate", friendCode: "4444-5555-6666", active: false }
    ]
  }
});

afterEach(() => vi.unstubAllGlobals());

describe("Studio license picker", () => {
  it("shows every detected license and lets the user pin a slot", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ config: defaultConfig })
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<Studio snapshot={snapshot()} connectionError="" />);
    fireEvent.click(screen.getByRole("button", { name: /player detection & data/i }));

    expect(screen.getByText("Primary")).toBeInTheDocument();
    expect(screen.getByText("Alternate")).toBeInTheDocument();
    expect(screen.getByText("Follow online license")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /slot 3 alternate/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/config",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ identity: { licenseSlot: 2 } })
      })
    ));
    expect(screen.getByText(/automatic following is paused/i)).toBeInTheDocument();
  });

  it("edits an element offset from the dedicated Elements tab", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ config: defaultConfig })
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<Studio snapshot={snapshot()} connectionError="" />);
    fireEvent.click(screen.getByRole("button", { name: /elements size & placement/i }));
    expect(screen.getByText("Badge elements")).toBeInTheDocument();

    fireEvent.change(screen.getAllByRole("slider")[0], { target: { value: "32" } });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/config",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ elements: { vr: { x: 32, y: 0, scale: 1 } } })
      })
    ));
    expect(screen.getByText("CUSTOM")).toBeInTheDocument();
  });

  it("materializes an embedded web-profile background before importing it", async () => {
    const fetchMock = vi.fn(async (url: string) => ({
      ok: true,
      json: async () => url === "/api/background"
        ? { imageUrl: "/user-assets/background.jpg?v=123" }
        : { config: defaultConfig }
    }));
    vi.stubGlobal("fetch", fetchMock);
    const { container } = render(<Studio snapshot={snapshot()} connectionError="" />);
    const input = container.querySelector('input[accept*=".json"]') as HTMLInputElement;
    const profile = {
      text: async () => JSON.stringify({
        format: "rewind-overlay-web-profile",
        config: {
          visibility: { avatar: false },
          background: { imageUrl: "data:image/jpeg;base64,SGVsbG8=" }
        }
      })
    };

    fireEvent.change(input, { target: { files: [profile] } });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock).toHaveBeenNthCalledWith(1, "/api/background", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ dataUrl: "data:image/jpeg;base64,SGVsbG8=" })
    }));
    expect(fetchMock).toHaveBeenNthCalledWith(2, "/api/config", expect.objectContaining({
      method: "PATCH",
      body: JSON.stringify({
        visibility: { avatar: false },
        background: { imageUrl: "/user-assets/background.jpg?v=123" }
      })
    }));
    expect(screen.getByText("Portable profile imported")).toBeInTheDocument();
  });
});
