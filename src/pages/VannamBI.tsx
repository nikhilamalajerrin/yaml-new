import * as React from "react";

// If your project already exports this, feel free to swap it in
const API_BASE = "/api"; // Vite proxy points /api -> backend

type Row = Record<string, any>;

type PgConn = {
  host: string;
  port: number;
  dbname: string;
  user: string;
  password: string;
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
      document.head.removeChild(s);
    };
  }, []);
  return loaded;
}

export default function VannamBI() {
  // --- app state ---
  const [active, setActive] = React.useState<"ask" | "training" | "history">("ask");
  const [status, setStatus] = React.useState<string>("Checking connection…");
  const [connecting, setConnecting] = React.useState(false);
  const [pg, setPg] = React.useState<PgConn>({
    host: "localhost",
    port: 5432,
    dbname: "postgres",
    user: "postgres",
    password: "",
  });

  const [question, setQuestion] = React.useState("");
  const [allowSeeData, setAllowSeeData] = React.useState(true);
  const [qid, setQid] = React.useState<string>("");
  const [sql, setSql] = React.useState<string>("");
  const [rows, setRows] = React.useState<Row[]>([]);
  const [followups, setFollowups] = React.useState<string[]>([]);
  const [figJson, setFigJson] = React.useState<string>("");
  const [suggested, setSuggested] = React.useState<string[]>([]);
  const [history, setHistory] = React.useState<{ id: string; question: string }[]>([]);
  const [training, setTraining] = React.useState<any[]>([]);
  const [trainBusy, setTrainBusy] = React.useState(false);
  const [errors, setErrors] = React.useState<string | null>(null);

  const plotlyReady = usePlotly();
  const chartRef = React.useRef<HTMLDivElement | null>(null);

  // --- effects ---
  React.useEffect(() => {
    connectionStatus();
    fetchSuggested();
    fetchHistory();
    if (active === "training") fetchTraining();
    // eslint-disable-next-line
  }, [active]);

  React.useEffect(() => {
    if (!plotlyReady || !figJson || !chartRef.current) return;
    try {
      const fig = JSON.parse(figJson);
      (window as any).Plotly.newPlot(chartRef.current, fig.data, fig.layout || {});
    } catch (err) {
      // show JSON below if plotting fails
    }
  }, [plotlyReady, figJson]);

  // --- helpers: API ---
  async function connectionStatus() {
    try {
      const r = await fetch(`${API_BASE}/vanna/v0/connection_status`);
      const s = await r.json();
      if (!s.connected) setStatus("No database connected");
      else setStatus(`Connected to ${s.engine} (${s.details?.dbname || ""})`);
    } catch {
      setStatus("No database connected");
    }
  }

  async function connectPg() {
    setConnecting(true);
    setErrors(null);
    try {
      const r = await fetch(`${API_BASE}/vanna/v0/connect/postgres`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(pg),
      });
      const j = await r.json();
      if (j.success) {
        setStatus(`Connected to postgres (${pg.dbname})`);
      } else {
        setStatus("Connection failed");
        setErrors(j.error || "Connection failed");
      }
    } catch (e: any) {
      setStatus("Connection failed");
      setErrors(e?.message || String(e));
    } finally {
      setConnecting(false);
    }
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
      const j = await r.json();
      setQid(j.id);
      setQuestion(j.question || "");
      setSql(j.sql || "");
      try {
        setRows(j.df ? JSON.parse(j.df) : []);
      } catch {
        setRows([]);
      }
      setFigJson(j.fig || "");
      setFollowups(j.followup_questions || []);
      setActive("ask");
    } catch {}
  }

  async function onGenerateSql(q?: string) {
    const ask = (q ?? question).trim();
    if (!ask) return;
    const u = new URL(`${API_BASE}/vanna/v0/generate_sql`, location.origin);
    u.searchParams.set("question", ask);
    u.searchParams.set("allow_llm_to_see_data", String(!!allowSeeData));
    const r = await fetch(u.toString());
    const j = await r.json();
    setQid(j.id);
    setSql(j.text || "");
    setRows([]);
    setFollowups([]);
    setFigJson("");
    fetchHistory();
  }

  async function onRun() {
    if (!qid) return;
    const u = new URL(`${API_BASE}/vanna/v0/run_sql`, location.origin);
    u.searchParams.set("id", qid);
    const r = await fetch(u.toString());
    const j = await r.json();
    try {
      const data = JSON.parse(j.df) as Row[];
      setRows(data);
    } catch {
      setRows([]);
    }
  }

  async function onChart() {
    if (!qid) return;
    const u = new URL(`${API_BASE}/vanna/v0/generate_plotly_figure`, location.origin);
    u.searchParams.set("id", qid);
    const r = await fetch(u.toString());
    const j = await r.json();
    setFigJson(j.fig || "");
  }

  async function onFollowups() {
    if (!qid) return;
    const u = new URL(`${API_BASE}/vanna/v0/followups`, location.origin);
    u.searchParams.set("id", qid);
    const r = await fetch(u.toString());
    const j = await r.json();
    setFollowups(j.questions || []);
  }

  function downloadCsv() {
    if (!qid) return;
    const u = new URL(`${API_BASE}/vanna/v0/download_csv`, location.origin);
    u.searchParams.set("id", qid);
    const a = document.createElement("a");
    a.href = u.toString();
    a.download = `${qid}.csv`;
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
    const r = await fetch(u.toString(), { method: "DELETE" });
    await r.json();
    fetchTraining();
  }

  async function addTraining(kind: "ddl" | "documentation" | "question_sql", payload: any) {
    setTrainBusy(true);
    try {
      let url = `${API_BASE}/vanna/v0/train`;
      if (kind === "ddl" || kind === "documentation" || kind === "question_sql") {
        // use unified /train endpoint for simplicity
      }
      const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      await r.json();
      fetchTraining();
    } finally {
      setTrainBusy(false);
    }
  }

  // --- UI helpers ---
  function Sidebar() {
    return (
      <aside className="w-full md:w-64 shrink-0 space-y-3">
        <div className="rounded-xl border bg-background/60 p-3">
          <div className="font-semibold text-sm mb-2">Navigation</div>
          <nav className="grid gap-2">
            <button onClick={() => setActive("training")} className={`text-left px-3 py-2 rounded border hover:bg-muted ${active === "training" ? "bg-muted" : ""}`}>Training Data</button>
            <button onClick={() => setActive("ask")} className={`text-left px-3 py-2 rounded border hover:bg-muted ${active === "ask" ? "bg-muted" : ""}`}>New question</button>
            <button onClick={() => setActive("history")} className={`text-left px-3 py-2 rounded border hover:bg-muted ${active === "history" ? "bg-muted" : ""}`}>History</button>
          </nav>
        </div>

        <div className="rounded-xl border bg-background/60 p-3">
          <div className="flex items-center justify-between mb-2">
            <div className="font-semibold text-sm">Suggested Questions</div>
            <button onClick={fetchSuggested} className="text-xs underline">refresh</button>
          </div>
          <div className="flex flex-col gap-2">
            {suggested.map((q) => (
              <button key={q} onClick={() => { setQuestion(q); onGenerateSql(q); }} className="text-left text-xs px-2 py-1 rounded border hover:bg-muted">
                {q}
              </button>
            ))}
            {!suggested.length && <div className="text-xs text-muted-foreground">No suggestions yet</div>}
          </div>
        </div>

        <div className="rounded-xl border bg-background/60 p-3 space-y-2">
          <div className="font-semibold text-sm">Connection</div>
          <div className="text-xs px-2 py-1 rounded bg-muted border inline-block">{status}</div>
          <details className="text-xs mt-2">
            <summary className="cursor-pointer">Configure Postgres</summary>
            <div className="grid grid-cols-1 gap-2 mt-2">
              <input className="border rounded px-2 py-1" placeholder="host" value={pg.host} onChange={(e)=>setPg({...pg, host: e.target.value})} />
              <input className="border rounded px-2 py-1" placeholder="port" type="number" value={pg.port} onChange={(e)=>setPg({...pg, port: Number(e.target.value)})} />
              <input className="border rounded px-2 py-1" placeholder="dbname" value={pg.dbname} onChange={(e)=>setPg({...pg, dbname: e.target.value})} />
              <input className="border rounded px-2 py-1" placeholder="user" value={pg.user} onChange={(e)=>setPg({...pg, user: e.target.value})} />
              <input className="border rounded px-2 py-1" placeholder="password" type="password" value={pg.password} onChange={(e)=>setPg({...pg, password: e.target.value})} />
              <button onClick={connectPg} disabled={connecting} className="px-3 py-1.5 rounded bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-60">{connecting ? "Connecting…" : "Connect"}</button>
              {errors && <div className="text-red-500">{errors}</div>}
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
            <input className="flex-1 border rounded px-3 py-2" placeholder='e.g., "Total orders per day last 7 days"' value={question} onChange={(e)=>setQuestion(e.target.value)} />
            <button onClick={()=>onGenerateSql()} className="px-4 py-2 rounded bg-blue-600 text-white hover:bg-blue-500">Generate SQL</button>
          </div>
          <label className="text-xs flex items-center gap-2">
            <input type="checkbox" checked={allowSeeData} onChange={(e)=>setAllowSeeData(e.target.checked)} />
            Allow LLM to see schema/data (introspection)
          </label>
          {!!sql && (
            <div className="text-xs">
              <div className="text-muted-foreground mb-1">Generated SQL (id: {qid})</div>
              <pre className="border rounded p-3 overflow-auto bg-muted/30 max-h-64">{sql}</pre>
              <div className="mt-2 flex flex-wrap gap-2">
                <button onClick={onRun} className="px-3 py-1.5 rounded border hover:bg-muted">Run</button>
                <button onClick={onChart} className="px-3 py-1.5 rounded border hover:bg-muted">Generate Chart</button>
                <button onClick={onFollowups} className="px-3 py-1.5 rounded border hover:bg-muted">Follow-ups</button>
                <button onClick={downloadCsv} className="px-3 py-1.5 rounded border hover:bg-muted">Download CSV</button>
              </div>
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
                    {rows[0] && Object.keys(rows[0]).map((k)=> (
                      <th key={k} className="px-3 py-2 text-left border-b">{k}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r,i)=> (
                    <tr key={i} className="odd:bg-muted/20">
                      {Object.keys(rows[0]||{}).map((k)=> (
                        <td key={k} className="px-3 py-2 border-b whitespace-pre-wrap">{String(r[k] ?? "")}</td>
                      ))}
                    </tr>
                  ))}
                  {!rows.length && (
                    <tr><td className="px-3 py-6 text-muted-foreground" colSpan={99}>No rows yet. Generate & run SQL to see results.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
          <div className="rounded-xl border p-4 bg-background/60">
            <h3 className="text-sm font-semibold mb-2">Chart</h3>
            <div ref={chartRef} className="h-[360px] w-full border rounded mb-2 bg-muted/20 grid place-items-center">
              {!figJson && <span className="text-xs text-muted-foreground">No chart yet</span>}
              {figJson && !plotlyReady && <span className="text-xs">Loading Plotly…</span>}
            </div>
            {!!figJson && (
              <details className="text-xs">
                <summary className="cursor-pointer">Figure JSON</summary>
                <pre className="border rounded p-2 overflow-auto bg-muted/30 mt-1 max-h-64">{figJson}</pre>
              </details>
            )}
          </div>
        </div>

        {followups.length > 0 && (
          <section className="rounded-xl border p-4 bg-background/60">
            <h3 className="text-sm font-semibold mb-2">Follow-up Questions</h3>
            <div className="flex flex-wrap gap-2">
              {followups.map((q) => (
                <button key={q} onClick={() => { setQuestion(q); onGenerateSql(q); }} className="text-xs px-2 py-1 rounded border hover:bg-muted">{q}</button>
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
        await fetch(`${API_BASE}/vanna/v0/train`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}) });
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
              <button onClick={()=>fetchTraining()} className="text-xs underline">refresh</button>
              <button onClick={quickAutoTrain} disabled={trainBusy} className="text-xs px-2 py-1 rounded border hover:bg-muted">{trainBusy?"Training…":"Auto-train schema"}</button>
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
                    <td className="px-3 py-2 border-b whitespace-nowrap text-xs">{r.id}</td>
                    <td className="px-3 py-2 border-b whitespace-nowrap text-xs">{r.type}</td>
                    <td className="px-3 py-2 border-b text-xs">
                      <pre className="max-w-[600px] overflow-auto">{(r.text || r.ddl || r.documentation || r.sql || "").toString()}</pre>
                    </td>
                    <td className="px-3 py-2 border-b whitespace-nowrap">
                      <button onClick={()=>removeTraining(r.id)} className="text-xs px-2 py-1 rounded border hover:bg-muted">Remove</button>
                    </td>
                  </tr>
                ))}
                {!training.length && (
                  <tr><td className="px-3 py-6 text-muted-foreground" colSpan={99}>No training data yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <div className="rounded-xl border p-4 bg-background/60 space-y-2">
            <div className="font-semibold text-sm">Add DDL</div>
            <textarea className="w-full border rounded p-2 text-sm min-h-[120px]" placeholder="CREATE TABLE ..." value={ddl} onChange={(e)=>setDdl(e.target.value)} />
            <button onClick={()=>addTraining("ddl", { ddl })} disabled={!ddl || trainBusy} className="px-3 py-1.5 rounded border hover:bg-muted disabled:opacity-60">Add</button>
          </div>

          <div className="rounded-xl border p-4 bg-background/60 space-y-2">
            <div className="font-semibold text-sm">Add Documentation</div>
            <textarea className="w-full border rounded p-2 text-sm min-h-[120px]" placeholder="Describe tables, columns, business rules…" value={doc} onChange={(e)=>setDoc(e.target.value)} />
            <button onClick={()=>addTraining("documentation", { documentation: doc })} disabled={!doc || trainBusy} className="px-3 py-1.5 rounded border hover:bg-muted disabled:opacity-60">Add</button>
          </div>

          <div className="rounded-xl border p-4 bg-background/60 space-y-2">
            <div className="font-semibold text-sm">Add Q ↔ SQL</div>
            <input className="border rounded px-2 py-1 text-sm w-full" placeholder="Question" value={q} onChange={(e)=>setQ(e.target.value)} />
            <textarea className="w-full border rounded p-2 text-sm min-h-[80px]" placeholder="SELECT ..." value={s} onChange={(e)=>setS(e.target.value)} />
            <button onClick={()=>addTraining("question_sql", { question: q, sql: s })} disabled={!q || !s || trainBusy} className="px-3 py-1.5 rounded border hover:bg-muted disabled:opacity-60">Add</button>
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
          <button onClick={fetchHistory} className="text-xs underline">refresh</button>
        </div>
        <div className="grid gap-2">
          {history.map((h) => (
            <button key={h.id} onClick={()=>loadHistory(h.id)} className="text-left px-3 py-2 rounded border hover:bg-muted text-sm">
              <div className="text-xs text-muted-foreground">{h.id}</div>
              <div>{h.question}</div>
            </button>
          ))}
          {!history.length && <div className="text-sm text-muted-foreground">No history yet</div>}
        </div>
      </section>
    );
  }

  return (
    <div className="p-4 lg:p-8 max-w-[1400px] mx-auto">
      <header className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold">Vanna.AI</h1>
          <p className="text-sm text-muted-foreground">Ask questions → SQL → results → charts</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs px-2 py-1 rounded bg-muted border">{status}</span>
        </div>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-[260px,1fr] gap-6">
        <Sidebar />
        {active === "ask" && <AskPanel />}
        {active === "training" && <TrainingPanel />}
        {active === "history" && <HistoryPanel />}
      </div>
    </div>
  );
}
