// import DataSciencePipelinePage from "./DataSciencePipeline";

// const Index = () => {
//   return <DataSciencePipelinePage />;
// };

// export default Index;
import React from "react";
import Sidebar, { type MenuKey } from "@/components/layout/sidebar";
import DataSciencePipelinePage from "./DataSciencePipeline";
import DataSourcesPage from "./Datasources";

function Dashboard() {
  return (
    <div className="p-6">
      <div className="pipeline-panel p-6">
        <h2 className="text-xl font-bold mb-4">Pipeline Dashboard</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-lg border border-border/50 p-4">
            <div className="text-sm text-muted-foreground">Total Pipelines</div>
            <div className="text-3xl font-semibold mt-2">2</div>
            <div className="text-xs text-muted-foreground mt-1">+12% from last month</div>
          </div>
          <div className="rounded-lg border border-border/50 p-4">
            <div className="text-sm text-muted-foreground">Running</div>
            <div className="text-3xl font-semibold mt-2">1</div>
            <div className="text-xs text-muted-foreground mt-1">Active pipelines</div>
          </div>
          <div className="rounded-lg border border-border/50 p-4">
            <div className="text-sm text-muted-foreground">Functions</div>
            <div className="text-3xl font-semibold mt-2">3</div>
            <div className="text-xs text-muted-foreground mt-1">Custom functions</div>
          </div>
          <div className="rounded-lg border border-border/50 p-4">
            <div className="text-sm text-muted-foreground">Data Sources</div>
            <div className="text-3xl font-semibold mt-2">1</div>
            <div className="text-xs text-muted-foreground mt-1">Connected sources</div>
          </div>
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

  return (
    <div className="flex min-h-screen">
      <Sidebar active={menu} onNavigate={setMenu} />
      <main className="flex-1">
        {menu === "dashboard" && <Dashboard />}
        {menu === "editor" && <DataSciencePipelinePage />}
        {menu === "functions" && <FunctionsPlaceholder />}
        {menu === "sources" && <DataSourcesPage />}
        {menu === "settings" && <SettingsPlaceholder />}
      </main>
    </div>
  );
}
