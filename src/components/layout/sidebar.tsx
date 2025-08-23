import React from "react";
import {
  LayoutDashboard,
  Workflow,
  Code2,
  Database,
  Settings as SettingsIcon,
} from "lucide-react";

export type MenuKey = "dashboard" | "editor" | "functions" | "sources" | "settings";

type Props = {
  active: MenuKey;
  onNavigate: (k: MenuKey) => void;
};

const items: { key: MenuKey; label: string; icon: React.ElementType }[] = [
  { key: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { key: "editor", label: "Pipeline Editor", icon: Workflow },
  { key: "functions", label: "Functions", icon: Code2 },
  { key: "sources", label: "Data Sources", icon: Database },
  { key: "settings", label: "Settings", icon: SettingsIcon },
];

export default function Sidebar({ active, onNavigate }: Props) {
  return (
    <aside className="hidden md:flex w-64 shrink-0 flex-col border-r border-border/50 bg-background/60 backdrop-blur">
      <div className="px-4 py-5 border-b border-border/50">
        <div className="text-xl font-bold">Tharavu Dappa</div>
        <div className="text-xs text-muted-foreground">Pipeline Builder</div>
      </div>

      <nav className="flex-1 overflow-auto py-3">
        {items.map(({ key, label, icon: Icon }) => {
          const isActive = key === active;
          return (
            <button
              key={key}
              onClick={() => onNavigate(key)}
              className={[
                "w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-colors",
                isActive
                  ? "text-primary bg-primary/10"
                  : "text-foreground/80 hover:bg-muted/40",
              ].join(" ")}
            >
              <span
                className={[
                  "p-1.5 rounded-md",
                  isActive ? "bg-primary/20" : "bg-muted/40",
                ].join(" ")}
              >
                <Icon className={isActive ? "w-4 h-4 text-primary" : "w-4 h-4"} />
              </span>
              <span className="truncate">{label}</span>
            </button>
          );
        })}
      </nav>

      <div className="px-4 py-4 text-xs text-muted-foreground border-t border-border/50">
        v1 · local
      </div>
    </aside>
  );
}
