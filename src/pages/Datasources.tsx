// src/pages/DataSourcesPage.tsx
import * as React from "react";
import { FileUpload } from "@/components/FileUpload";
import { getSelectedFile, setSelectedFile } from "@/lib/files";

const API_BASE = "/api"; // Vite proxy

type PgConn = {
  host: string;
  port: number;
  dbname: string;
  user: string;
  password: string;
  sslmode?: "require" | "disable";
};

type ConnDetails = { dbname?: string; host?: string; port?: number; user?: string; sslmode?: string };

function cls(...a: (string | false | null | undefined)[]) {
  return a.filter(Boolean).join(" ");
}

export default function DataSourcesPage() {
  // -------- Files (unchanged) --------
  const [file, setFile] = React.useState<File | null>(getSelectedFile());

  // -------- DB connection --------
  const [pg, setPg] = React.useState<PgConn>(() => {
    const saved = localStorage.getItem("vanna_pg_conn");
    return saved
      ? JSON.parse(saved)
      : { host: "", port: 5432, dbname: "", user: "", password: "", sslmode: "require" };
  });
  React.useEffect(() => {
    localStorage.setItem("vanna_pg_conn", JSON.stringify(pg));
  }, [pg]);

  const [connecting, setConnecting] = React.useState(false);
  const [connected, setConnected] = React.useState(false);
  const [details, setDetails] = React.useState<ConnDetails>({});
  const [statusText, setStatusText] = React.useState("Checking connection…");
  const [err, setErr] = React.useState<string | null>(null);

  // poll backend so we stay “logged in” until /disconnect
  React.useEffect(() => {
    let t: any;
    const check = async () => {
      try {
        const r = await fetch(`${API_BASE}/vanna/v0/connection_status`);
        const j = await r.json();
        if (j.connected) {
          setConnected(true);
          setDetails(j.details || {});
          setStatusText(`postgres • ${j.details?.dbname ?? ""}`);
        } else {
          setConnected(false);
          setDetails({});
          setStatusText("No database connected");
        }
      } catch {
        setConnected(false);
        setDetails({});
        setStatusText("No database connected");
      }
      t = setTimeout(check, 4000);
    };
    check();
    return () => clearTimeout(t);
  }, []);

  async function connectPg() {
    setConnecting(true);
    setErr(null);
    try {
      const r = await fetch(`${API_BASE}/vanna/v0/connect/postgres`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(pg),
      });
      const j = await r.json();
      if (j.success) {
        setConnected(true);
        setDetails(j.details || {});
        setStatusText(`postgres • ${j.details?.dbname ?? ""}`);
      } else {
        setErr(j.error || "Connection failed");
        setConnected(false);
      }
    } catch (e: any) {
      setErr(e?.message || String(e));
      setConnected(false);
    } finally {
      setConnecting(false);
    }
  }

  async function disconnectPg() {
    setErr(null);
    try {
      await fetch(`${API_BASE}/vanna/v0/disconnect`, { method: "POST" });
    } catch {}
    setConnected(false);
    setDetails({});
    setStatusText("Disconnected");
  }

  return (
    <div className="p-6 relative">
      {/* top status bar */}
      <div className="mb-3">
        <span className="text-xs px-2 py-1 rounded bg-muted border">
          {connected ? `Connected: ${details.dbname ?? ""} @ ${details.host ?? ""}` : "Disconnected"}
        </span>
      </div>

      <div className="pipeline-panel p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/20" />
            <h2 className="text-xl font-bold">Data Sources</h2>
          </div>
          <div className="text-xs px-2 py-1 rounded border bg-muted">
            {statusText}
          </div>
        </div>

        {/* Files */}
        <p className="text-sm text-muted-foreground mb-6">
          Add CSV/Excel/Text files. When you select a file, we’ll make it available to the Pipeline Editor.
        </p>

        <FileUpload
          selectedFile={file}
          onFileSelected={(f) => {
            setFile(f);
            setSelectedFile(f);
          }}
        />

        {file && (
          <p className="mt-3 text-xs text-muted-foreground">
            Selected: <span className="font-medium">{file.name}</span>
          </p>
        )}

        {/* PostgreSQL connector */}
        <div className="mt-10">
          <h3 className="text-sm font-semibold mb-2">PostgreSQL</h3>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <input
              className="pipeline-input"
              placeholder="host"
              value={pg.host}
              onChange={(e) => setPg({ ...pg, host: e.target.value })}
              spellCheck={false}
            />
            <input
              className="pipeline-input"
              placeholder="port"
              type="number"
              inputMode="numeric"
              value={pg.port}
              onChange={(e) => setPg({ ...pg, port: Number(e.target.value) })}
            />
            <input
              className="pipeline-input"
              placeholder="database"
              value={pg.dbname}
              onChange={(e) => setPg({ ...pg, dbname: e.target.value })}
              spellCheck={false}
            />
            <input
              className="pipeline-input"
              placeholder="user"
              value={pg.user}
              onChange={(e) => setPg({ ...pg, user: e.target.value })}
              spellCheck={false}
            />
            <input
              className="pipeline-input"
              placeholder="password"
              type="password"
              value={pg.password}
              onChange={(e) => setPg({ ...pg, password: e.target.value })}
            />
            <label className="text-xs flex items-center gap-2">
              <input
                type="checkbox"
                checked={pg.sslmode !== "disable"}
                onChange={(e) => setPg({ ...pg, sslmode: e.target.checked ? "require" : "disable" })}
              />
              <span>SSL (sslmode={pg.sslmode ?? "require"})</span>
            </label>
          </div>

          <div className="mt-3 flex items-center gap-3">
            <button
              onClick={connectPg}
              disabled={connecting}
              className={cls(
                "pipeline-button",
                "px-3 py-2 rounded bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-60"
              )}
            >
              {connecting ? "Connecting…" : "Connect"}
            </button>
            <button
              onClick={disconnectPg}
              className="pipeline-button-secondary"
            >
              Disconnect
            </button>
            <span className="text-xs text-muted-foreground">
              You’ll stay connected until you click Disconnect.
            </span>
          </div>

          {!!err && (
            <div className="text-red-500 text-xs mt-2 whitespace-pre-wrap">{err}</div>
          )}
        </div>

        {/* Other connectors (stub buttons kept) */}
        <div className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <button className="pipeline-button-secondary">Connect MySQL</button>
          <button className="pipeline-button-secondary">Connect BigQuery</button>
          <button className="pipeline-button-secondary opacity-50 cursor-not-allowed">More soon</button>
        </div>

        <p className="mt-6 text-xs text-muted-foreground">
          Looking for the <span className="font-medium">Training Table</span>? Open the <span className="font-medium">Training Data</span> panel in the main Vanna page. (It lists items, lets you auto-train schema, add DDL/Docs/Q↔SQL, and remove entries.)
        </p>
      </div>

      {/* tiny bottom-left pill mirrors global connection */}
      <div className="fixed left-3 bottom-3 text-xs px-2 py-1 rounded bg-background/80 border backdrop-blur">
        <span
          className={cls(
            "inline-block w-2 h-2 rounded-full mr-2",
            connected ? "bg-green-500" : "bg-red-500"
          )}
        />
        {connected
          ? `Connected: ${details.dbname ?? ""} @ ${details.host ?? ""}`
          : "Disconnected"}
      </div>
    </div>
  );
}
