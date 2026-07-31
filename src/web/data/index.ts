/**
 * Single import surface for the web overlay shell.
 *
 * The shell assembles the same snapshot shape the desktop renderer consumes
 * ({ config, player, status }), so Overlay.tsx works unchanged:
 *
 *   const settings = parseWebSettings(location.search);
 *   const poller = new WebPoller(settings);
 *   poller.subscribe(({ player, status }) => render({ config: settings.config, player, status }));
 *   poller.start();
 */
export { WebPoller, type WebSnapshot, type WebStatus } from "./webPoller";
export {
  parseWebSettings,
  serializeWebSettings,
  normalizeFriendCode,
  type WebSettings
} from "./webConfig";
export {
  imageFileToDataUrl,
  LINK_SIZE_WARNING_BYTES,
  type EmbeddedImage,
  type EmbedImageOptions
} from "./embedImage";
export type { OverlayPlayer, PlayerExtras } from "../../../electron/live-engine";
export type { OverlayConfig } from "../../../electron/models";
export { defaultConfig } from "../../../electron/models";
