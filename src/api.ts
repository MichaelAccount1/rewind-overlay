import type { Snapshot } from "./types";

export const API_ORIGIN = window.location.port === "5173" ? "http://127.0.0.1:19488" : "";

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_ORIGIN}${path}`, {
    ...options,
    cache: "no-store",
    headers: { "Content-Type": "application/json", ...options?.headers }
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: response.statusText })) as { error?: string };
    throw new Error(body.error || `Request failed (${response.status})`);
  }
  return response.json() as Promise<T>;
}

export const api = {
  snapshot: () => request<Snapshot>("/api/snapshot"),
  config: (patch: unknown) => request<{ config: Snapshot["config"] }>("/api/config", {
    method: "PATCH", body: JSON.stringify(patch)
  }),
  reset: () => request<{ config: Snapshot["config"] }>("/api/config/reset", { method: "POST" }),
  background: (dataUrl: string) => request<{ imageUrl: string }>("/api/background", {
    method: "POST", body: JSON.stringify({ dataUrl })
  }),
  exportBackground: () => request<{ dataUrl: string }>("/api/background/export"),
  demo: (kind: "gain" | "loss" | "rank" | "reset") =>
    request<Snapshot>(`/api/demo/${kind}`, { method: "POST" }),
  window: (action: "show" | "hide" | "center" | "clickthrough", body?: unknown) =>
    request<{ ok: boolean }>(`/api/window/${action}`, { method: "POST", body: JSON.stringify(body ?? {}) })
};
