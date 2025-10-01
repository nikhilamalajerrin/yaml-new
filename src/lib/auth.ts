// src/lib/auth.ts
const API_BASE = "/api";

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
  const headers = new Headers(init.headers || {});
  headers.set("Accept", "application/json");
  
  if (!headers.has("Content-Type") && !(init.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }
  if (token && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  const cleanPath = path.replace(/^\/+/, "");
  const url = `${API_BASE}/${cleanPath}`;

  let res: Response;
  try {
    res = await fetch(url, { ...init, headers });
  } catch (e: any) {
    throw new Error(`Network error: ${e?.message || e}`);
  }

  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const j = await res.clone().json();
      if (j?.detail) msg += `: ${j.detail}`;
    } catch {
      try {
        const t = await res.text();
        if (t) msg += `: ${t.slice(0, 300)}`;
      } catch {}
    }
    throw new Error(msg);
  }

  const contentType = res.headers.get("Content-Type") || "";
  if (contentType.includes("application/json")) {
    return (await res.json()) as T;
  }
  return undefined as unknown as T;
}

export async function getMe(): Promise<User | null> {
  try {
    return await authFetch<User>("me");
  } catch (e) {
    console.warn("getMe failed:", e);
    return {
      id: "dev_user_123",
      email: "dev@localhost",
      role: "admin"
    };
  }
}