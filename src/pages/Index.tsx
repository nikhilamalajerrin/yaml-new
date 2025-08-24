// import DataSciencePipelinePage from "./DataSciencePipeline";

// const Index = () => {
//   return <DataSciencePipelinePage />;
// };

// export default Index;
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

function DashboardCard({
  title,
  value,
  subtitle,
}: {
  title: string;
  value: number | string;
  subtitle?: string;
}) {
  return (
    <div className="rounded-lg border border-border/50 p-4">
      <div className="text-sm text-muted-foreground">{title}</div>
      <div className="text-3xl font-semibold mt-2">{value}</div>
      {subtitle && (
        <div className="text-xs text-muted-foreground mt-1">{subtitle}</div>
      )}
    </div>
  );
}

function Dashboard({
  user,
  onRequestLogin,
  onLogout,
  stats,
  loading,
}: {
  user: User | null;
  onRequestLogin: () => void;
  onLogout: () => void;
  stats: Stats | null;
  loading: boolean;
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
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold">Pipeline Dashboard</h2>
          <div className="flex items-center gap-2">
            {user ? (
              <>
                <span className="text-sm text-muted-foreground">
                  Signed in as <span className="font-medium">{user.email}</span>
                </span>
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
            You’re viewing demo stats. <button
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

function FunctionsPlaceholder() {
  return (
    <div className="p-6">
      <div className="pipeline-panel p-6">
        <h2 className="text-xl font-bold mb-2">Functions</h2>
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
        <h2 className="text-xl font-bold mb-2">Settings</h2>
        <p className="text-sm text-muted-foreground">Workspace settings will go here.</p>
      </div>
    </div>
  );
}

export default function Index() {
  const [menu, setMenu] = React.useState<MenuKey>("editor");

  const [user, setUser] = React.useState<User | null>(null);
  const [showLogin, setShowLogin] = React.useState(false);
  const [stats, setStats] = React.useState<Stats | null>(null);
  const [loadingStats, setLoadingStats] = React.useState(false);

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
        onSuccess={(u) => {
          setUser(u);
          refreshStats();
        }}
      />
    </div>
  );
}
