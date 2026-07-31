// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { imageFileToDataUrl, LINK_SIZE_WARNING_BYTES } from "../../src/web/data/embedImage";

interface CanvasStub {
  convertToBlob: ReturnType<typeof vi.fn>;
  drawImage: ReturnType<typeof vi.fn>;
  sizes: { width: number; height: number }[];
}

/** Installs browser image globals; convertToBlob yields the given byte sizes in order. */
function stubImagePipeline(bitmap: { width: number; height: number }, blobSizes: number[]): CanvasStub {
  const stub: CanvasStub = { convertToBlob: vi.fn(), drawImage: vi.fn(), sizes: [] };
  let call = 0;
  stub.convertToBlob.mockImplementation(async () => {
    const size = blobSizes[Math.min(call, blobSizes.length - 1)];
    call += 1;
    return new Blob([new Uint8Array(size)], { type: "image/jpeg" });
  });
  vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ ...bitmap, close: vi.fn() })));
  vi.stubGlobal(
    "OffscreenCanvas",
    class {
      constructor(width: number, height: number) {
        stub.sizes.push({ width, height });
      }
      getContext() {
        return { drawImage: stub.drawImage };
      }
      convertToBlob(options: unknown) {
        return stub.convertToBlob(options);
      }
    }
  );
  return stub;
}

afterEach(() => vi.unstubAllGlobals());

describe("imageFileToDataUrl", () => {
  it("downscales to the max dimension and returns a jpeg data URL", async () => {
    const stub = stubImagePipeline({ width: 3200, height: 2000 }, [120_000]);
    const result = await imageFileToDataUrl(new Blob(["x"]), { maxDimension: 1600 });
    expect(stub.sizes[0]).toEqual({ width: 1600, height: 1000 });
    expect(result.width).toBe(1600);
    expect(result.height).toBe(1000);
    expect(result.bytes).toBe(120_000);
    expect(result.dataUrl.startsWith("data:image/jpeg;base64,")).toBe(true);
  });

  it("never upscales small images", async () => {
    const stub = stubImagePipeline({ width: 640, height: 360 }, [50_000]);
    await imageFileToDataUrl(new Blob(["x"]), { maxDimension: 1600 });
    expect(stub.sizes[0]).toEqual({ width: 640, height: 360 });
  });

  it("steps quality down until the image fits the byte ceiling", async () => {
    const stub = stubImagePipeline({ width: 1600, height: 900 }, [2_000_000, 1_400_000, 800_000]);
    const result = await imageFileToDataUrl(new Blob(["x"]), { maxBytes: 900_000 });
    expect(result.bytes).toBe(800_000);
    expect(stub.convertToBlob).toHaveBeenCalledTimes(3);
    const qualities = stub.convertToBlob.mock.calls.map((call) => (call[0] as { quality: number }).quality);
    expect(qualities).toEqual([0.85, 0.75, 0.65]);
  });

  it("gives a user-presentable error when no quality fits", async () => {
    stubImagePipeline({ width: 1600, height: 900 }, [5_000_000]);
    await expect(imageFileToDataUrl(new Blob(["x"]))).rejects.toThrow(/host it as an https URL/);
  });

  it("gives a user-presentable error for non-images", async () => {
    vi.stubGlobal("createImageBitmap", vi.fn(async () => {
      throw new Error("decode failure");
    }));
    await expect(imageFileToDataUrl(new Blob(["not an image"]))).rejects.toThrow(/could not be read as an image/);
  });

  it("encodes bytes faithfully into the data URL", async () => {
    const payload = new Uint8Array([72, 101, 108, 108, 111]); // "Hello"
    vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ width: 10, height: 10, close: vi.fn() })));
    vi.stubGlobal(
      "OffscreenCanvas",
      class {
        getContext() {
          return { drawImage: vi.fn() };
        }
        async convertToBlob() {
          return new Blob([payload], { type: "image/jpeg" });
        }
      }
    );
    const result = await imageFileToDataUrl(new Blob(["x"]));
    expect(atob(result.dataUrl.split(",")[1])).toBe("Hello");
  });

  it("exposes the link-size warning threshold for the Studio UI", () => {
    expect(LINK_SIZE_WARNING_BYTES).toBeGreaterThan(0);
  });
});
