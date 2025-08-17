// src/lib/api.ts
export const API_BASE =
  (import.meta.env.VITE_API_BASE as string) || "/api";

export async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const txt = await res.text(); // avoid JSON parse on HTML error pages
    throw new Error(`HTTP ${res.status}: ${txt.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}
