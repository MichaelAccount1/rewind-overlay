// @vitest-environment node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const paths = vi.hoisted(() => ({ userData: "" }));
vi.mock("electron", () => ({
  app: { getPath: () => paths.userData }
}));

import { ConfigStore } from "../../electron/store.js";

beforeEach(() => {
  paths.userData = fs.mkdtempSync(path.join(os.tmpdir(), "rewind-store-test-"));
});

afterEach(() => {
  fs.rmSync(paths.userData, { recursive: true, force: true });
});

describe("ConfigStore portable backgrounds", () => {
  it("exports a stored local background as an embedded data URL", () => {
    const store = new ConfigStore();
    const original = "data:image/png;base64,SGVsbG8=";

    const imageUrl = store.setBackground(original);

    expect(imageUrl).toMatch(/^\/user-assets\/background\.png\?v=/);
    expect(store.exportBackground()).toBe(original);
  });

  it("keeps already-portable and hosted backgrounds unchanged", () => {
    const store = new ConfigStore();
    store.update({ background: { imageUrl: "https://example.com/background.webp" } });
    expect(store.exportBackground()).toBe("https://example.com/background.webp");

    store.update({ background: { imageUrl: "" } });
    expect(store.exportBackground()).toBe("");
  });
});
