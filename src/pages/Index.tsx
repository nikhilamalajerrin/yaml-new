// src/pages/Index.tsx
import React from "react";
import Sidebar, { type MenuKey } from "@/components/layout/sidebar";
import DataSciencePipelinePage from "./DataSciencePipeline";
import DataSourcesPage from "./Datasources";

import LoginModal from "@/components/LoginModal";
import { authFetch, clearToken, getMe, getToken, type User } from "@/lib/auth";

type Stats = {
  pipelines: number;
  functions: number;
  sources: number;
  users: number;
  running: number;
};

type Pipeline = {
  id: string;
  name: string;
  yaml: string;
  created_at: string;
  updated_at: string;
};

/* ----------------- small helpers ----------------- */
function initialsFromEmail(email: string) {
  const base = (email || "").split("@")[0].replace(/[^a-zA-Z0-9]/g, " ").trim();
  const parts = base.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "U";
  const a = parts[0][0] || "";
  const b = parts[1]?.[0] || "";
  return (a + b).toUpperCase();
}

/* ----------------- tiny modal (no extra lib) ----------------- */
function Modal({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        className="w-[min(720px,92vw)] max-h-[85vh] overflow-hidden rounded-xl border border-border/50 bg-background shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border/50 px-5 py-3">
          <div className="font-semibold">{title}</div>
          <button className="text-sm text-muted-foreground" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="max-h-[70vh] overflow-y-auto p-5">{children}</div>
      </div>
    </div>
  );
}

/* ----------------- dashboard cards ----------------- */
function DashboardCard({
  title,
  value,
  subtitle,
  onClick,
}: {
  title: string;
  value: number | string;
  subtitle?: string;
  onClick?: () => void;
}) {
  const clickable = !!onClick;
  return (
    <div
      onClick={onClick}
      className={`rounded-lg border border-border/50 p-4 ${
        clickable
          ? "cursor-pointer transition hover:border-primary/40 hover:shadow-[0_0_0_2px_hsl(var(--primary)/.25)]"
          : ""
      }`}
    >
      <div className="text-sm text-muted-foreground">{title}</div>
      <div className="mt-2 text-3xl font-semibold">{value}</div>
      {subtitle && (
        <div className="mt-1 text-xs text-muted-foreground">{subtitle}</div>
      )}
    </div>
  );
}

/* ----------------- dashboard ----------------- */
function Dashboard({
  user,
  onRequestLogin,
  onLogout,
  stats,
  loading,
  onOpenPipelines,
}: {
  user: User | null;
  onRequestLogin: () => void;
  onLogout: () => void;
  stats: Stats | null;
  loading: boolean;
  onOpenPipelines: () => void;
}) {
  const s: Stats = stats || {
    pipelines: 0,
    functions: 0,
    sources: 0,
    users: 0,
    running: 0,
  };

  return (
    <div className="p-6">
      <div className="pipeline-panel p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-bold">Pipeline Dashboard</h2>
          <div className="flex items-center gap-3">
            {user ? (
              <>
                <div className="flex items-center gap-2 rounded-full bg-muted/40 px-2 py-1">
                  <div className="grid h-7 w-7 place-items-center rounded-full bg-primary/20 text-xs font-semibold text-primary">
                    {initialsFromEmail(user.email)}
                  </div>
                  <span className="text-sm text-muted-foreground">
                    Signed in as <span className="font-medium">{user.email}</span>
                  </span>
                </div>
                <button className="pipeline-button-secondary" onClick={onLogout}>
                  Logout
                </button>
              </>
            ) : (
              <button className="pipeline-button" onClick={onRequestLogin}>
                Login
              </button>
            )}
          </div>
        </div>

        {!user && (
          <div className="mb-4 text-sm text-muted-foreground">
            You’re viewing demo stats.{" "}
            <button
              className="underline underline-offset-2"
              onClick={onRequestLogin}
            >
              Sign in
            </button>{" "}
            to see your workspace numbers.
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <DashboardCard
            title="Total Pipelines"
            value={loading ? "—" : s.pipelines}
            subtitle={user ? "+12% from last month" : undefined}
            onClick={user ? onOpenPipelines : undefined}
          />
          <DashboardCard
            title="Running"
            value={loading ? "—" : s.running}
            subtitle="Active pipelines"
          />
          <DashboardCard
            title="Functions"
            value={loading ? "—" : s.functions}
            subtitle="Custom functions"
          />
          <DashboardCard
            title="Data Sources"
            value={loading ? "—" : s.sources}
            subtitle={user ? "Connected sources" : undefined}
          />
        </div>
      </div>
    </div>
  );
}

/* ----------------- placeholders ----------------- */
function FunctionsPlaceholder() {
  return (
    <div className="p-6">
      <div className="pipeline-panel p-6">
        <h2 className="mb-2 text-xl font-bold">Functions</h2>
        <p className="text-sm text-muted-foreground">
          Placeholder. You’ll be able to create, edit, and version Python functions here.
        </p>
      </div>
    </div>
  );
}

function SettingsPlaceholder() {
  return (
    <div className="p-6">
      <div className="pipeline-panel p-6">
        <h2 className="mb-2 text-xl font-bold">Settings</h2>
        <p className="text-sm text-muted-foreground">Workspace settings will go here.</p>
      </div>
    </div>
  );
}

/* ----------------- main page ----------------- */
export default function Index() {
  const [menu, setMenu] = React.useState<MenuKey>("editor");

  const [user, setUser] = React.useState<User | null>(null);
  const [showLogin, setShowLogin] = React.useState(false);
  const [stats, setStats] = React.useState<Stats | null>(null);
  const [loadingStats, setLoadingStats] = React.useState(false);

  // pipelines picker state
  const [pickerOpen, setPickerOpen] = React.useState(false);
  const [pipelines, setPipelines] = React.useState<Pipeline[]>([]);
  const [search, setSearch] = React.useState("");

  // Try to recover session on load
  React.useEffect(() => {
    (async () => {
      if (!getToken()) return;
      const u = await getMe();
      if (u) {
        setUser(u);
        await refreshStats();
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function refreshStats() {
    try {
      setLoadingStats(true);
      const data = await authFetch<Stats>("/stats");
      setStats(data);
    } catch {
      setStats(null);
    } finally {
      setLoadingStats(false);
    }
  }

  function handleLogout() {
    clearToken();
    setUser(null);
    setStats(null);
  }

  /* ----- saved pipelines modal flow ----- */
  async function openPipelines() {
    if (!user) {
      setShowLogin(true);
      return;
    }
    try {
      const data = await authFetch<{ pipelines: Pipeline[] }>("/pipelines");
      const list = (data?.pipelines || []).sort(
        (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
      );
      setPipelines(list);
    } catch {
      setPipelines([]);
    } finally {
      setSearch("");
      setPickerOpen(true);
    }
  }

  function importPipeline(p: Pipeline) {
    try {
      localStorage.setItem(
        "td_open_pipeline",
        JSON.stringify({ id: p.id, name: p.name, yaml: p.yaml })
      );
    } catch {}
    setPickerOpen(false);
    setMenu("editor");
  }

  const filtered = React.useMemo(() => {
    const t = search.trim().toLowerCase();
    if (!t) return pipelines;
    return pipelines.filter(
      (p) =>
        p.name.toLowerCase().includes(t) ||
        (p.yaml || "").toLowerCase().includes(t)
    );
  }, [search, pipelines]);

  return (
    <div className="flex min-h-screen">
      <Sidebar active={menu} onNavigate={setMenu} />
      <main className="flex-1">
        {menu === "dashboard" && (
          <Dashboard
            user={user}
            stats={stats}
            loading={loadingStats}
            onRequestLogin={() => setShowLogin(true)}
            onLogout={handleLogout}
            onOpenPipelines={openPipelines}
          />
        )}
        {menu === "editor" && <DataSciencePipelinePage />}
        {menu === "functions" && <FunctionsPlaceholder />}
        {menu === "sources" && <DataSourcesPage />}
        {menu === "settings" && <SettingsPlaceholder />}
      </main>

      <LoginModal
        open={showLogin}
        onClose={() => setShowLogin(false)}
        onSuccess={async (u) => {
          setUser(u);
          await refreshStats();
        }}
      />

      {/* Pipelines picker */}
      <Modal
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        title="Open a saved pipeline"
      >
        <input
          className="pipeline-input mb-3 w-full"
          placeholder="Search by name or YAML…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {filtered.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            No pipelines found.
          </div>
        ) : (
          <ul className="space-y-2">
            {filtered.map((p) => (
              <li
                key={p.id}
                className="flex items-center justify-between gap-4 rounded-lg border border-border/40 bg-background px-3 py-2 hover:bg-muted/30"
              >
                <div className="min-w-0">
                  <div className="truncate font-medium">{p.name}</div>
                  <div className="text-[11px] text-muted-foreground">
                    Updated {new Date(p.updated_at).toLocaleString()}
                  </div>
                </div>
                <button
                  className="pipeline-button-secondary py-1 text-xs"
                  onClick={() => importPipeline(p)}
                >
                  Open
                </button>
              </li>
            ))}
          </ul>
        )}
      </Modal>
    </div>
  );
}
