// src/lib/api.ts

/**
 * Single source of truth for the backend base URL.
 * In development, default to the Vite proxy at "/api".
 * In production, set VITE_API_BASE to an absolute URL if needed.
 */
const rawBase = (import.meta.env.VITE_API_BASE as string | undefined) || "";
export const API_BASE = rawBase.trim() ? rawBase.replace(/\/+$/, "") : "/api";

/** Join base + path safely */
export function buildApiUrl(path: string): string {
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${API_BASE}${p}`;
}

/** Allow passing a path ("/x") or a full URL ("http://...") */
function resolveUrl(urlOrPath: string): string {
  if (/^https?:\/\//i.test(urlOrPath)) return urlOrPath;
  return buildApiUrl(urlOrPath);
}

/** Low-level fetch that defaults to CORS mode and uses the proxy */
export async function apiFetch(urlOrPath: string, init: RequestInit = {}): Promise<Response> {
  const url = resolveUrl(urlOrPath);
  return fetch(url, { mode: "cors", ...init });
}

/** GET + JSON helper (path or absolute URL) */
export async function getJson<T>(urlOrPath: string, init?: RequestInit): Promise<T> {
  const res = await apiFetch(urlOrPath, init);
  if (!res.ok) {
    const txt = await res.text(); // don't assume JSON for error pages
    throw new Error(`HTTP ${res.status}: ${txt.slice(0, 200)}`);
  }
  try {
    return (await res.json()) as T;
  } catch {
    // allow empty/204 bodies
    return undefined as unknown as T;
  }
}

/** POST JSON helper */
export async function postJson<T>(
  urlOrPath: string,
  body: any,
  init?: RequestInit
): Promise<T> {
  const headers = new Headers(init?.headers || {});
  if (!headers.has("Accept")) headers.set("Accept", "application/json");
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");

  const res = await apiFetch(urlOrPath, {
    method: init?.method || "POST",
    ...init,
    headers,
    body: JSON.stringify(body ?? {}),
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`HTTP ${res.status}: ${txt.slice(0, 200)}`);
  }
  try {
    return (await res.json()) as T;
  } catch {
    return undefined as unknown as T;
  }
}

/** Multipart/form-data upload helper (do NOT set Content-Type manually) */
export async function uploadJson<T>(
  urlOrPath: string,
  form: FormData,
  init?: RequestInit
): Promise<T> {
  const headers = new Headers(init?.headers || {});
  if (!headers.has("Accept")) headers.set("Accept", "application/json");

  const res = await apiFetch(urlOrPath, {
    method: init?.method || "POST",
    ...init,
    headers, // let the browser set the multipart boundary
    body: form,
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`HTTP ${res.status}: ${txt.slice(0, 200)}`);
  }
  try {
    return (await res.json()) as T;
  } catch {
    return undefined as unknown as T;
  }
}
