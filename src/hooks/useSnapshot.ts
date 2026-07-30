import { useEffect, useState } from "react";
import { API_ORIGIN, api } from "../api";
import type { Snapshot } from "../types";

export function useSnapshot(): { snapshot: Snapshot | null; error: string } {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    api.snapshot().then((next) => alive && setSnapshot(next)).catch((reason: Error) => setError(reason.message));
    const events = new EventSource(`${API_ORIGIN}/api/events`);
    events.onmessage = (event) => {
      if (!alive) return;
      try { setSnapshot(JSON.parse(event.data) as Snapshot); setError(""); }
      catch { setError("Received invalid live data"); }
    };
    events.onerror = () => setError("Reconnecting to the local overlay service…");
    return () => { alive = false; events.close(); };
  }, []);

  return { snapshot, error };
}

