/**
 * Local background images for the hosted overlay, without a server.
 *
 * The picked file is downscaled and compressed in the browser, then embedded
 * as a data: URL in config.background.imageUrl. Data URLs pass the web
 * sanitizer, persist in localStorage, survive JSON profile export/import,
 * and travel inside the shareable cfg link -- which is how the image reaches
 * the separate browser inside OBS / TikTok Live Studio.
 *
 * The tradeoff is link size: past LINK_SIZE_WARNING_BYTES the Studio should
 * suggest a hosted https image instead, since very long URLs are less
 * portable across broadcast tools.
 */

export interface EmbedImageOptions {
  /** Longest edge of the output; backgrounds never need more than this. */
  maxDimension?: number;
  /** Hard ceiling for the encoded image; quality steps down to fit. */
  maxBytes?: number;
}

export interface EmbeddedImage {
  dataUrl: string;
  bytes: number;
  width: number;
  height: number;
}

export const LINK_SIZE_WARNING_BYTES = 1_500_000;

const DEFAULT_MAX_DIMENSION = 1600;
const DEFAULT_MAX_BYTES = 900_000;
const QUALITY_STEPS = [0.85, 0.75, 0.65, 0.55, 0.45];

async function blobToDataUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return `data:${blob.type};base64,${btoa(binary)}`;
}

/**
 * Compress an image file into an embeddable data: URL.
 * Throws with a user-presentable message when the file is not an image or
 * cannot be compressed under the byte ceiling.
 */
export async function imageFileToDataUrl(file: Blob, options: EmbedImageOptions = {}): Promise<EmbeddedImage> {
  const maxDimension = options.maxDimension ?? DEFAULT_MAX_DIMENSION;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error("That file could not be read as an image.");
  }

  try {
    const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Image processing is not available in this browser.");
    context.drawImage(bitmap, 0, 0, width, height);

    for (const quality of QUALITY_STEPS) {
      const blob = await canvas.convertToBlob({ type: "image/jpeg", quality });
      if (blob.size <= maxBytes) {
        return { dataUrl: await blobToDataUrl(blob), bytes: blob.size, width, height };
      }
    }
    throw new Error("That image is too detailed to embed -- host it as an https URL instead.");
  } finally {
    bitmap.close();
  }
}
