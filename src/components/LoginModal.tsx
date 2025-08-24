// src/components/LoginModal.tsx
import React, { useState } from "react";
import { API_BASE } from "@/lib/api";
import { setToken, type User } from "@/lib/auth";

type Props = {
  open: boolean;
  onClose: () => void;
  onSuccess: (u: User) => void;
};

export default function LoginModal({ open, onClose, onSuccess }: Props) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  if (!open) return null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr("");

    try {
      const res = await fetch(`${API_BASE.replace(/\/+$/, "")}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(txt || "Login failed");
      }
      const data = await res.json(); // { token, user }
      setToken(data.token);
      onSuccess(data.user);
      onClose();
    } catch (e: any) {
      setErr(e?.message || "Login failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="pipeline-modal" onClick={onClose}>
      <div
        className="pipeline-modal-content w-full max-w-md"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-semibold mb-4">Sign in</h3>
        <form className="space-y-3" onSubmit={submit}>
          <div>
            <label className="text-sm text-muted-foreground">Email</label>
            <input
              className="pipeline-input w-full mt-1"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              placeholder="you@example.com"
            />
          </div>
          <div>
            <label className="text-sm text-muted-foreground">Password</label>
            <input
              className="pipeline-input w-full mt-1"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              placeholder="••••••••"
            />
          </div>

          {err && (
            <div className="text-sm text-destructive mt-1">{err}</div>
          )}

          <div className="flex items-center gap-2 pt-2">
            <button
              className="pipeline-button"
              type="submit"
              disabled={busy}
            >
              {busy ? "Signing in…" : "Sign in"}
            </button>
            <button
              className="pipeline-button-secondary"
              type="button"
              onClick={onClose}
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
