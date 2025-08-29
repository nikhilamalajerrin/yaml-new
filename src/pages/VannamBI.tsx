// src/pages/VannamBI.tsx
import * as React from "react";

const API_BASE = "/api"; // Vite proxy: /api -> backend

type Row = Record<string, any>;

type PgConn = {
  host: string;
  port: number;
  dbname: string;
  user: string;
  password: string;
  sslmode?: "require" | "disable";
};

function usePlotly() {
  const [loaded, setLoaded] = React.useState<boolean>(!!(window as any).Plotly);

  React.useEffect(() => {
    if ((window as any).Plotly) return;
    const s = document.createElement("script");
    s.src = "https://cdn.plot.ly/plotly-latest.min.js";
    s.async = true;
    s.onload = () => setLoaded(true);
    s.onerror = () => setLoaded(false);
    document.head.appendChild(s);
    return () => {
      if (document.head.contains(s)) document.head.removeChild(s);
    };
  }, []);

  return loaded;
}

// Stable input/textarea styles
const inputCls =
  "w-full h-10 box-border px-3 rounded-md border border-muted bg-background " +
  "text-foreground placeholder:text-muted-foreground leading-normal appearance-none " +
  "focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-muted";

const textareaCls =
  "w-full box-border rounded-md border border-muted bg-background text-foreground " +
  "placeholder:text-muted-foreground p-2 leading-normal resize-y min-h-[120px] " +
  "focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-muted";

// fetch -> JSON with error surfacing
async function jsonOrThrow(r: Response) {
  const j = await r.json().catch(() => ({}));
  if (!r.ok || (j && j.type === "error")) {
    const msg = j?.error || `${r.status} ${r.statusText}`;
    throw new Error(msg);
  }
  return j;
}

export default function VannamBI() {
  // --- app state ---
  const [active, setActive] = React.useState<"ask" | "training" | "history">("ask");
  const [status, setStatus] = React.useState<string>("Checking connection…");
  const [connecting, setConnecting] = React.useState(false);

  const [pg, setPg] = React.useState<PgConn>({
    host: "",
    port: 5432,
    dbname: "",
    user: "",
    password: "",
  });

  // SSL toggle — default ON
  const [sslRequire, setSslRequire] = React.useState<boolean>(true);

  const [question, setQuestion] = React.useState("");
  const [allowSeeData, setAllowSeeData] = React.useState(true);

  const [qid, setQid] = React.useState<string>("");
  const [sql, setSql] = React.useState<string>("");

  const [rows, setRows] = React.useState<Row[]>([]);
  const [figJson, setFigJson] = React.useState<string>("");
  const [followups, setFollowups] = React.useState<string[]>([]);

  const [suggested, setSuggested] = React.useState<string[]>([]);
  const [history, setHistory] = React.useState<{ id: string; question: string }[]>([]);
  const [training, setTraining] = React.useState<any[]>([]);
  const [trainBusy, setTrainBusy] = React.useState(false);

  // per-action loading / errors
  const [busy, setBusy] = React.useState<{ run: boolean; chart: boolean; follow: boolean }>({
    run: false,
    chart: false,
    follow: false,
  });
  const [err, setErr] = React.useState<string | null>(null);

  const plotlyReady = usePlotly();
  const chartRef = React.useRef<HTMLDivElement | null>(null);

  // --- effects ---
  React.useEffect(() => {
    connectionStatus();
    fetchSuggested();
    fetchHistory();
    if (active === "training") fetchTraining();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  React.useEffect(() => {
    if (!plotlyReady || !figJson || !chartRef.current) return;
    try {
      const fig = JSON.parse(figJson);
      (window as any).Plotly.newPlot(chartRef.current, fig.data, fig.layout || {});
    } catch {
      // if plotting fails, raw JSON is shown below
    }
  }, [plotlyReady, figJson]);

  // --- API calls ---
  async function connectionStatus() {
    try {
      const r = await fetch(`${API_BASE}/vanna/v0/connection_status`);
      const j = await r.json();
      if (!j.connected) setStatus("No database connected");
      else setStatus(`Connected to ${j.engine}${j.details?.dbname ? ` (${j.details.dbname})` : ""}`);
    } catch {
      setStatus("No database connected");
    }
  }

  async function connectPg() {
    setConnecting(true);
    setErr(null);
    try {
      const r = await fetch(`${API_BASE}/vanna/v0/connect/postgres`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...pg,
          sslmode: sslRequire ? "require" : "disable",
          // some backends look for 'ssl' boolean — harmless to send both
          ssl: sslRequire,
        }),
      });
      const j = await jsonOrThrow(r);
      if (j.success) {
        setStatus(`Connected to postgres (${pg.dbname || ""})`);
      } else {
        setStatus("Connection failed");
      }
    } catch (e: any) {
      setStatus("Connection failed");
      setErr(e?.message || String(e));
    } finally {
      setConnecting(false);
    }
  }

  async function disconnectPg() {
    try {
      await fetch(`${API_BASE}/vanna/v0/disconnect`, { method: "POST" });
    } catch {}
    setStatus("Disconnected");
    setQid("");
    setSql("");
    setRows([]);
    setFigJson("");
    setFollowups([]);
    setErr(null);
  }

  async function fetchSuggested() {
    try {
      const r = await fetch(`${API_BASE}/vanna/v0/generate_questions`);
      const j = await r.json();
      setSuggested(j?.questions || []);
    } catch {}
  }

  async function fetchHistory() {
    try {
      const r = await fetch(`${API_BASE}/vanna/v0/get_question_history`);
      const j = await r.json();
      setHistory((j?.questions || []).filter((x: any) => !!x.question));
    } catch {}
  }

  async function loadHistory(id: string) {
    try {
      const u = new URL(`${API_BASE}/vanna/v0/load_question`, location.origin);
      u.searchParams.set("id", id);
      const r = await fetch(u.toString());
      const j = await jsonOrThrow(r);

      setQid(j.id);
      setQuestion(j.question || "");
      setSql(j.sql || "");
      setFigJson(j.fig || "");
      setFollowups(j.followup_questions || []);

      try {
        setRows(j.df ? JSON.parse(j.df) : []);
      } catch {
        setRows([]);
      }
      setActive("ask");
      setErr(null);
    } catch (e: any) {
      setErr(e?.message || String(e));
    }
  }

  async function onGenerateSql(q?: string) {
    const ask = (q ?? question).trim();
    if (!ask) return;

    setErr(null);
    try {
      const u = new URL(`${API_BASE}/vanna/v0/generate_sql`, location.origin);
      u.searchParams.set("question", ask);
      // backend ignores this param if unsupported — harmless
      u.searchParams.set("allow_llm_to_see_data", String(!!allowSeeData));

      const r = await fetch(u.toString());
      const j = await jsonOrThrow(r);

      setQid(j.id);
      setSql(j.text || "");
      setRows([]);
      setFigJson("");
      setFollowups([]);
      fetchHistory();
    } catch (e: any) {
      setSql("");
      setErr(e?.message || String(e));
    }
  }

  async function onRun() {
    if (!qid) return;
    setBusy((b) => ({ ...b, run: true }));
    setErr(null);

    try {
      const u = new URL(`${API_BASE}/vanna/v0/run_sql`, location.origin);
      u.searchParams.set("id", qid);
      const r = await fetch(u.toString());
      const j = await jsonOrThrow(r);

      try {
        const data = JSON.parse(j.df) as Row[];
        setRows(data);
      } catch {
        setRows([]);
        throw new Error("Bad rows payload from server");
      }
    } catch (e: any) {
      setRows([]);
      setErr(e?.message || String(e));
    } finally {
      setBusy((b) => ({ ...b, run: false }));
    }
  }

  async function onChart() {
    if (!qid) return;
    setBusy((b) => ({ ...b, chart: true }));
    setErr(null);

    try {
      const u = new URL(`${API_BASE}/vanna/v0/generate_plotly_figure`, location.origin);
      u.searchParams.set("id", qid);
      const r = await fetch(u.toString());
      const j = await jsonOrThrow(r);
      setFigJson(j.fig || "");
    } catch (e: any) {
      setFigJson("");
      setErr(e?.message || String(e));
    } finally {
      setBusy((b) => ({ ...b, chart: false }));
    }
  }

  async function onFollowups() {
    if (!qid) return;
    setBusy((b) => ({ ...b, follow: true }));
    setErr(null);

    try {
      const u = new URL(`${API_BASE}/vanna/v0/followups`, location.origin);
      u.searchParams.set("id", qid);
      const r = await fetch(u.toString());
      const j = await jsonOrThrow(r);
      setFollowups(j.questions || []);
    } catch (e: any) {
      setFollowups([]);
      setErr(e?.message || String(e));
    } finally {
      setBusy((b) => ({ ...b, follow: false }));
    }
  }

  function downloadCsv() {
    if (!qid) return;
    const u = new URL(`${API_BASE}/vanna/v0/download_csv`, location.origin);
    u.searchParams.set("id", qid);

    const a = document.createElement("a");
    a.href = u.toString();
    a.download = `${qid}.csv`;
    a.target = "_blank";
    a.rel = "noopener";
    a.click();
  }

  // --- Training APIs ---
  async function fetchTraining() {
    try {
      const r = await fetch(`${API_BASE}/vanna/v0/get_training_data`);
      const j = await r.json();
      setTraining(j.records || []);
    } catch {}
  }

  async function removeTraining(id: string) {
    const u = new URL(`${API_BASE}/vanna/v0/remove_training_data`, location.origin);
    u.searchParams.set("id", id);
    await fetch(u.toString(), { method: "DELETE" }).catch(() => {});
    fetchTraining();
  }

  async function addTraining(kind: "ddl" | "documentation" | "question_sql", payload: any) {
    setTrainBusy(true);
    try {
      const url = `${API_BASE}/vanna/v0/train`;
      await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }).then(jsonOrThrow);
      fetchTraining();
    } catch (e: any) {
      setErr(e?.message || String(e));
    } finally {
      setTrainBusy(false);
    }
  }

  // --- UI helpers ---
  function Sidebar() {
    return (
      <aside className="w-full md:w-72 shrink-0 space-y-3">
        <div className="rounded-xl border bg-background/60 p-3">
          <div className="font-semibold text-sm mb-2">Navigation</div>
          <nav className="grid gap-2">
            <button
              onClick={() => setActive("training")}
              className={`text-left px-3 py-2 rounded border hover:bg-muted ${
                active === "training" ? "bg-muted" : ""
              }`}
            >
              Training Data
            </button>
            <button
              onClick={() => setActive("ask")}
              className={`text-left px-3 py-2 rounded border hover:bg-muted ${
                active === "ask" ? "bg-muted" : ""
              }`}
            >
              New question
            </button>
            <button
              onClick={() => setActive("history")}
              className={`text-left px-3 py-2 rounded border hover:bg-muted ${
                active === "history" ? "bg-muted" : ""
              }`}
            >
              History
            </button>
          </nav>
        </div>

        <div className="rounded-xl border bg-background/60 p-3">
          <div className="flex items-center justify-between mb-2">
            <div className="font-semibold text-sm">Suggested Questions</div>
            <button onClick={fetchSuggested} className="text-xs underline">
              refresh
            </button>
          </div>
          <div className="flex flex-col gap-2">
            {suggested.map((q) => (
              <button
                key={q}
                onClick={() => {
                  setQuestion(q);
                  onGenerateSql(q);
                }}
                className="text-left text-xs px-2 py-1 rounded border hover:bg-muted"
              >
                {q}
              </button>
            ))}
            {!suggested.length && (
              <div className="text-xs text-muted-foreground">No suggestions yet</div>
            )}
          </div>
        </div>

        <div className="rounded-xl border bg-background/60 p-3 space-y-2">
          <div className="font-semibold text-sm">Connection</div>
          <div className="text-xs px-2 py-1 rounded border inline-block bg-muted">
            {status}
          </div>

          <details className="text-xs mt-2" open>
            <summary className="cursor-pointer">Configure Postgres</summary>
            <div className="grid grid-cols-1 gap-2 mt-2">
              <input
                className={inputCls}
                placeholder="host (e.g. your-pg-host)"
                value={pg.host}
                onChange={(e) => setPg({ ...pg, host: e.target.value })}
                spellCheck={false}
              />
              <input
                className={inputCls}
                placeholder="port"
                type="number"
                inputMode="numeric"
                value={pg.port}
                onChange={(e) => setPg({ ...pg, port: Number(e.target.value) })}
              />
              <input
                className={inputCls}
                placeholder="user"
                value={pg.user}
                onChange={(e) => setPg({ ...pg, user: e.target.value })}
                spellCheck={false}
              />
              <input
                className={inputCls}
                placeholder="database"
                value={pg.dbname}
                onChange={(e) => setPg({ ...pg, dbname: e.target.value })}
                spellCheck={false}
              />
              <input
                className={inputCls}
                placeholder="password"
                type="password"
                value={pg.password}
                onChange={(e) => setPg({ ...pg, password: e.target.value })}
              />

              <label className="flex items-center gap-2 select-none">
                <input
                  type="checkbox"
                  checked={sslRequire}
                  onChange={(e) => setSslRequire(e.target.checked)}
                />
                <span>SSL (sends sslmode={sslRequire ? "require" : "disable"})</span>
              </label>

              <div className="flex items-center gap-2">
                <button
                  onClick={connectPg}
                  disabled={connecting}
                  className="px-3 py-1.5 rounded bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-60"
                >
                  {connecting ? "Connecting…" : "Connect"}
                </button>
                <button
                  onClick={disconnectPg}
                  className="px-3 py-1.5 rounded border hover:bg-muted"
                >
                  Disconnect
                </button>
              </div>
              {err && <div className="text-red-500 whitespace-pre-wrap">{err}</div>}
            </div>
          </details>
        </div>
      </aside>
    );
  }

  function AskPanel() {
    return (
      <section className="space-y-4">
        <div className="rounded-xl border p-4 bg-background/60 space-y-3">
          <div className="flex items-center gap-2">
            <input
              className={inputCls + " flex-1"}
              placeholder='e.g., "Total orders per day last 7 days"'
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
            />
            <button
              onClick={() => onGenerateSql()}
              className="px-4 py-2 rounded bg-blue-600 text-white hover:bg-blue-500"
            >
              Generate SQL
            </button>
          </div>

          <label className="text-xs flex items-center gap-2">
            <input
              type="checkbox"
              checked={allowSeeData}
              onChange={(e) => setAllowSeeData(e.target.checked)}
            />
            Allow LLM to see schema/data (introspection)
          </label>

          {!!sql && (
            <div className="text-xs">
              <div className="text-muted-foreground mb-1">
                Generated SQL (id: {qid || "—"})
              </div>
              <pre className="border rounded p-3 overflow-auto bg-muted/30 max-h-64">{sql}</pre>
              <div className="mt-2 flex flex-wrap gap-2">
                <button
                  onClick={onRun}
                  disabled={busy.run}
                  className="px-3 py-1.5 rounded border hover:bg-muted disabled:opacity-60"
                >
                  {busy.run ? "Running…" : "Run"}
                </button>
                <button
                  onClick={onChart}
                  disabled={busy.chart}
                  className="px-3 py-1.5 rounded border hover:bg-muted disabled:opacity-60"
                >
                  {busy.chart ? "Building…" : "Generate Chart"}
                </button>
                <button
                  onClick={onFollowups}
                  disabled={busy.follow}
                  className="px-3 py-1.5 rounded border hover:bg-muted disabled:opacity-60"
                >
                  {busy.follow ? "Thinking…" : "Follow-ups"}
                </button>
                <button
                  onClick={downloadCsv}
                  className="px-3 py-1.5 rounded border hover:bg-muted"
                >
                  Download CSV
                </button>
              </div>
              {err && <div className="text-red-500 mt-2 whitespace-pre-wrap">{err}</div>}
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="rounded-xl border p-4 bg-background/60">
            <h3 className="text-sm font-semibold mb-2">Results</h3>
            <div className="overflow-auto border rounded">
              <table className="min-w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    {rows[0] &&
                      Object.keys(rows[0]).map((k) => (
                        <th key={k} className="px-3 py-2 text-left border-b">
                          {k}
                        </th>
                      ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i} className="odd:bg-muted/20">
                      {Object.keys(rows[0] || {}).map((k) => (
                        <td
                          key={k}
                          className="px-3 py-2 border-b whitespace-pre-wrap"
                        >
                          {String(r[k] ?? "")}
                        </td>
                      ))}
                    </tr>
                  ))}
                  {!rows.length && (
                    <tr>
                      <td className="px-3 py-6 text-muted-foreground" colSpan={99}>
                        No rows yet. Generate & run SQL to see results.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="rounded-xl border p-4 bg-background/60">
            <h3 className="text-sm font-semibold mb-2">Chart</h3>
            <div
              ref={chartRef}
              className="h-[360px] w-full border rounded mb-2 bg-muted/20 grid place-items-center"
            >
              {!figJson && (
                <span className="text-xs text-muted-foreground">No chart yet</span>
              )}
              {figJson && !plotlyReady && (
                <span className="text-xs">Loading Plotly…</span>
              )}
            </div>
            {!!figJson && (
              <details className="text-xs">
                <summary className="cursor-pointer">Figure JSON</summary>
                <pre className="border rounded p-2 overflow-auto bg-muted/30 mt-1 max-h-64">
                  {figJson}
                </pre>
              </details>
            )}
          </div>
        </div>

        {followups.length > 0 && (
          <section className="rounded-xl border p-4 bg-background/60">
            <h3 className="text-sm font-semibold mb-2">Follow-up Questions</h3>
            <div className="flex flex-wrap gap-2">
              {followups.map((q) => (
                <button
                  key={q}
                  onClick={() => {
                    setQuestion(q);
                    onGenerateSql(q);
                  }}
                  className="text-xs px-2 py-1 rounded border hover:bg-muted"
                >
                  {q}
                </button>
              ))}
            </div>
          </section>
        )}
      </section>
    );
  }

  function TrainingPanel() {
    // local form state
    const [ddl, setDdl] = React.useState("");
    const [doc, setDoc] = React.useState("");
    const [q, setQ] = React.useState("");
    const [s, setS] = React.useState("");

    async function quickAutoTrain() {
      setTrainBusy(true);
      try {
        await fetch(`${API_BASE}/vanna/v0/train`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({}),
        }).then(jsonOrThrow);
        fetchTraining();
      } finally {
        setTrainBusy(false);
      }
    }

    return (
      <section className="space-y-4">
        <div className="rounded-xl border p-4 bg-background/60">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold">Training Data</h2>
            <div className="flex items-center gap-2">
              <button onClick={() => fetchTraining()} className="text-xs underline">
                refresh
              </button>
              <button
                onClick={quickAutoTrain}
                disabled={trainBusy}
                className="text-xs px-2 py-1 rounded border hover:bg-muted"
              >
                {trainBusy ? "Training…" : "Auto-train schema"}
              </button>
            </div>
          </div>

          <div className="overflow-auto border rounded">
            <table className="min-w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="px-3 py-2 text-left border-b">id</th>
                  <th className="px-3 py-2 text-left border-b">type</th>
                  <th className="px-3 py-2 text-left border-b">content</th>
                  <th className="px-3 py-2 text-left border-b">actions</th>
                </tr>
              </thead>
              <tbody>
                {training.map((r: any) => (
                  <tr key={r.id} className="odd:bg-muted/20 align-top">
                    <td className="px-3 py-2 border-b whitespace-nowrap text-xs">
                      {r.id}
                    </td>
                    <td className="px-3 py-2 border-b whitespace-nowrap text-xs">
                      {r.type}
                    </td>
                    <td className="px-3 py-2 border-b text-xs">
                      <pre className="max-w-[600px] overflow-auto">
                        {(r.text || r.ddl || r.documentation || r.sql || "").toString()}
                      </pre>
                    </td>
                    <td className="px-3 py-2 border-b whitespace-nowrap">
                      <button
                        onClick={() => removeTraining(r.id)}
                        className="text-xs px-2 py-1 rounded border hover:bg-muted"
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
                {!training.length && (
                  <tr>
                    <td className="px-3 py-6 text-muted-foreground" colSpan={99}>
                      No training data yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="rounded-xl border p-4 bg-background/60 space-y-2">
            <div className="font-semibold text-sm">Add DDL</div>
            <textarea
              className={textareaCls}
              placeholder="CREATE TABLE ..."
              value={ddl}
              onChange={(e) => setDdl(e.target.value)}
            />
            <button
              onClick={() => addTraining("ddl", { ddl })}
              disabled={!ddl || trainBusy}
              className="px-3 py-1.5 rounded border hover:bg-muted disabled:opacity-60"
            >
              Add
            </button>
          </div>

          <div className="rounded-xl border p-4 bg-background/60 space-y-2">
            <div className="font-semibold text-sm">Add Documentation</div>
            <textarea
              className={textareaCls}
              placeholder="Describe tables, columns, business rules…"
              value={doc}
              onChange={(e) => setDoc(e.target.value)}
            />
            <button
              onClick={() => addTraining("documentation", { documentation: doc })}
              disabled={!doc || trainBusy}
              className="px-3 py-1.5 rounded border hover:bg-muted disabled:opacity-60"
            >
              Add
            </button>
          </div>

          <div className="rounded-xl border p-4 bg-background/60 space-y-2">
            <div className="font-semibold text-sm">Add Q ↔ SQL</div>
            <input
              className={inputCls}
              placeholder="Question"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
            <textarea
              className={textareaCls + " min-h-[80px]"}
              placeholder="SELECT ..."
              value={s}
              onChange={(e) => setS(e.target.value)}
            />
            <button
              onClick={() => addTraining("question_sql", { question: q, sql: s })}
              disabled={!q || !s || trainBusy}
              className="px-3 py-1.5 rounded border hover:bg-muted disabled:opacity-60"
            >
              Add
            </button>
          </div>
        </div>
      </section>
    );
  }

  function HistoryPanel() {
    return (
      <section className="rounded-xl border p-4 bg-background/60">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold">Question History</h2>
          <button onClick={fetchHistory} className="text-xs underline">
            refresh
          </button>
        </div>
        <div className="grid gap-2">
          {history.map((h) => (
            <button
              key={h.id}
              onClick={() => loadHistory(h.id)}
              className="text-left px-3 py-2 rounded border hover:bg-muted text-sm"
            >
              <div className="text-xs text-muted-foreground">{h.id}</div>
              <div>{h.question}</div>
            </button>
          ))}
          {!history.length && (
            <div className="text-sm text-muted-foreground">No history yet</div>
          )}
        </div>
      </section>
    );
  }

  return (
    <div className="p-4 lg:p-8 max-w-[1400px] mx-auto">
      <header className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold">Vanna.AI</h1>
          <p className="text-sm text-muted-foreground">
            Ask questions → SQL → results → charts
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs px-2 py-1 rounded bg-muted border">{status}</span>
        </div>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-[288px,1fr] gap-6">
        <Sidebar />
        {active === "ask" && <AskPanel />}
        {active === "training" && <TrainingPanel />}
        {active === "history" && <HistoryPanel />}
      </div>
    </div>
  );
}
