// src/lib/auth.ts
import { API_BASE } from "./api";

export type User = { id: string; email: string; role: string };

const TOKEN_KEY = "td_token";

export function getToken(): string {
  try {
    return localStorage.getItem(TOKEN_KEY) || "";
  } catch {
    return "";
  }
}

export function setToken(t: string) {
  try {
    localStorage.setItem(TOKEN_KEY, t);
  } catch {}
}

export function clearToken() {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {}
}

export async function authFetch<T = any>(
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    ...(init.headers as Record<string, string>),
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  // Ensure we join API_BASE and path safely
  const url =
    API_BASE.replace(/\/+$/, "") + "/" + path.replace(/^\/+/, "");

  const res = await fetch(url, { ...init, headers });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`HTTP ${res.status}: ${txt.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

export async function getMe(): Promise<User | null> {
  try {
    return await authFetch<User>("/me");
  } catch {
    return null;
  }
}
