import { Overlay } from "./components/Overlay";
import { Studio } from "./components/Studio";
import { useSnapshot } from "./hooks/useSnapshot";

export function App() {
  const { snapshot, error } = useSnapshot();
  const overlayRoute = window.location.pathname.startsWith("/overlay");

  // Electron's transparent BrowserWindow still paints the HTML canvas unless
  // its root surface is explicitly cleared after the overlay route mounts.
  if (overlayRoute) {
    document.documentElement.style.background = "transparent";
    document.body.style.background = "transparent";
  }

  if (!snapshot) {
    return overlayRoute
      ? null
      : <div className="boot"><div className="boot-mark">RR</div><p>{error || "Starting Rewind Overlay…"}</p></div>;
  }

  return overlayRoute
    ? <main className="overlay-page"><Overlay snapshot={snapshot} desktop={new URLSearchParams(location.search).has("desktop")} /></main>
    : <Studio snapshot={snapshot} connectionError={error} />;
}
