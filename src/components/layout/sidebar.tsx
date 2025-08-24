// src/components/layout/sidebar.tsx
import React from "react";
import {
  Home,
  Workflow,
  Code2,
  Database,
  Settings as Gear,
  ChevronRight,
} from "lucide-react";
import { authFetch, getMe, getToken, type User } from "@/lib/auth";

export type MenuKey = "dashboard" | "editor" | "functions" | "sources" | "settings";

type SidebarProps = {
  active: MenuKey;
  onNavigate: (k: MenuKey) => void;
};

type Pipeline = {
  id: string;
  name: string;
  yaml: string;
  created_at: string;
  updated_at: string;
};

function initialsFromEmail(email?: string | null) {
  if (!email) return "TD";
  const [left] = email.split("@");
  const parts = left.replace(/[._-]+/g, " ").split(" ").filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

export default function Sidebar({ active, onNavigate }: SidebarProps) {
  const [user, setUser] = React.useState<User | null>(null);
  const [pipelines, setPipelines] = React.useState<Pipeline[]>([]);
  const [openRecent, setOpenRecent] = React.useState(true);

  // fetch user + pipelines (if logged in)
  React.useEffect(() => {
    (async () => {
      if (!getToken()) return;
      const u = await getMe();
      if (!u) return;
      setUser(u);
      try {
        const data = await authFetch<{ pipelines: Pipeline[] }>("/pipelines");
        const list = (data?.pipelines || []).sort(
          (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()
        );
        setPipelines(list.slice(0, 6)); // show last 6
      } catch {
        setPipelines([]);
      }
    })();
  }, []);

  function importPipeline(p: Pipeline) {
    try {
      localStorage.setItem("td_open_pipeline", JSON.stringify({ id: p.id, name: p.name, yaml: p.yaml }));
    } catch {}
    onNavigate("editor");
  }

  const navItem =
    (key: MenuKey, label: string, Icon: any) =>
      (
        <button
          key={key}
          onClick={() => onNavigate(key)}
          className={`w-full flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors
            ${active === key
              ? "bg-primary/15 text-primary border border-primary/30"
              : "hover:bg-muted/40 text-foreground/90 border border-transparent"}`}
        >
          <Icon className={`h-4 w-4 ${active === key ? "text-primary" : "text-muted-foreground"}`} />
          <span className="truncate">{label}</span>
        </button>
      );

  return (
    <aside className="w-[240px] shrink-0 border-r border-border/60 bg-background/80 backdrop-blur supports-[backdrop-filter]:bg-background/70 p-3 flex flex-col">
      {/* Top: Brand */}
      <div className="mb-3 px-1">
        <div className="text-sm font-semibold tracking-wide text-muted-foreground">Tharavu Dappa</div>
        <div className="text-[10px] text-muted-foreground/80">Pipeline Builder</div>
      </div>

      {/* Nav */}
      <nav className="flex flex-col gap-1">
        {navItem("dashboard", "Dashboard", Home)}
        {navItem("editor", "Pipeline Editor", Workflow)}
        {navItem("functions", "Functions", Code2)}
        {navItem("sources", "Data Sources", Database)}
        {navItem("settings", "Settings", Gear)}
      </nav>

      {/* Recent Pipelines (collapsible) */}
      {user && pipelines.length > 0 && (
        <div className="mt-4">
          <button
            className="w-full flex items-center justify-between text-xs text-muted-foreground px-1 py-1 hover:text-foreground transition-colors"
            onClick={() => setOpenRecent((v) => !v)}
          >
            <span>Recent Pipelines</span>
            <ChevronRight
              className={`h-3.5 w-3.5 transition-transform ${openRecent ? "rotate-90" : ""}`}
            />
          </button>

          {openRecent && (
            <ul className="mt-1 space-y-1">
              {pipelines.map((p) => (
                <li key={p.id}>
                  <button
                    onClick={() => importPipeline(p)}
                    className="w-full text-left truncate rounded-md px-3 py-1.5 text-xs border border-border/30 hover:bg-muted/40"
                    title="Open in editor"
                  >
                    {p.name}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Spacer */}
      <div className="flex-1" />

      {/* Bottom: Workspace card with avatar + email */}
      <div className="rounded-2xl border border-border/60 bg-muted/20 p-3">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-primary/25 to-primary/10 grid place-items-center text-sm font-bold text-primary">
            {initialsFromEmail(user?.email)}
          </div>
          <div className="min-w-0">
            <div className="text-sm font-semibold">Workspace</div>
            <div className="text-[11px] text-muted-foreground truncate">
              {user?.email || "Build data pipelines"}
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}
