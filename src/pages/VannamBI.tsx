// src/components/VannamBI.tsx (or your route file)
// SQL-only UI; add "Mark correct" + "Fix & save"; remove explanation box.

import * as React from "react";

const API_BASE = "/api"; // Vite proxy: /api -> backend
type Row = Record<string, any>;

type ChatItem = {
  localId: string;
  question: string;
  qid?: string;
  raw?: string;
  sql?: string;
  rows?: Row[];
  figJson?: string;
  followups?: string[];
  error?: string | null;
  busy?: { run: boolean; chart: boolean; follow: boolean; save: boolean };
  saved?: boolean;
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

async function jsonOrThrow(r: Response) {
  const j = await r.json().catch(() => ({}));
  if (!r.ok || (j && (j.type === "error" || j.detail))) {
    const msg = (j && (j.error || j.detail)) || `${r.status} ${r.statusText}`;
    throw new Error(msg);
  }
  return j;
}

function extractSql(raw: string): string {
  if (!raw) return "";
  const src = raw.replace(/\r/g, "");

  // custom: sql ... '''
  {
    const matches = [...src.matchAll(/(?:^|\n)\s*sql\b[:\-]?\s*([\s\S]*?)\s*'''/gi)];
    if (matches.length) {
      const block = (matches[matches.length - 1][1] || "").trim();
      return block;
    }
  }

  // fenced ```sql
  {
    const fence = src.match(/```(?:sql|postgresql|postgres)?\s*([\s\S]*?)```/i);
    if (fence && fence[1]) {
      const block = fence[1].trim();
      if (/^[ \t]*(WITH|SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|EXPLAIN|BEGIN|VALUES)\b/mi.test(block)) {
        return block;
      }
    }
  }

  // plain text fallback
  {
    const m = src.match(/^[ \t]*(WITH|SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|EXPLAIN|BEGIN|VALUES)\b[\s\S]*$/mi);
    if (m && (m.index ?? -1) >= 0) return src.slice(m.index!).trim();
  }
  return "";
}

const badge = "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs bg-muted";

export default function VannamBI() {
  const [status, setStatus] = React.useState<string>("Checking connection…");
  const [connectedInfo, setConnectedInfo] = React.useState<{ engine?: string; dbname?: string; host?: string } | null>(null);

  const [question, setQuestion] = React.useState("");
  const [allowSeeData, setAllowSeeData] = React.useState(true);

  const [messages, setMessages] = React.useState<ChatItem[]>([]);
  const [errTop, setErrTop] = React.useState<string | null>(null);

  // training drawer & connect modal
  const [showTraining, setShowTraining] = React.useState<boolean>(false);
  const [showConnect, setShowConnect] = React.useState<boolean>(false);
  const [training, setTraining] = React.useState<any[]>([]);
  const [trainBusy, setTrainBusy] = React.useState<boolean>(false);
  const [trainErr, setTrainErr] = React.useState<string | null>(null);

  const [connForm, setConnForm] = React.useState({
    host: "",
    dbname: "",
    user: "",
    password: "",
    port: "5432",
    sslmode: "require",
  });
  const [connBusy, setConnBusy] = React.useState(false);
  const [connErr, setConnErr] = React.useState<string | null>(null);

  const plotlyReady = usePlotly();
  const streamRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    connectionStatus();
  }, []);

  React.useEffect(() => {
    streamRef.current?.scrollTo({ top: streamRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.length]);

  React.useEffect(() => {
    if (showTraining) fetchTraining();
  }, [showTraining]);

  async function connectionStatus() {
    try {
      const r = await fetch(`${API_BASE}/vanna/v0/connection_status`);
      const j = await r.json();
      if (!j.connected) {
        setStatus("No database connected");
        setConnectedInfo(null);
      } else {
        const dbname = j?.details?.dbname || "";
        const host = j?.details?.host || "";
        setStatus("Connected");
        setConnectedInfo({ engine: j.engine, dbname, host });
      }
    } catch {
      setStatus("No database connected");
      setConnectedInfo(null);
    }
  }

  // -------- chat actions --------
  async function onAskSubmit(e?: React.FormEvent) {
    e?.preventDefault();
    const q = question.trim();
    if (!q) return;
    setErrTop(null);

    const userMsg: ChatItem = { localId: crypto.randomUUID(), question: q };
    setMessages((m) => [...m, userMsg]);

    try {
      const u = new URL(`${API_BASE}/vanna/v0/generate_sql`, location.origin);
      u.searchParams.set("question", q);
      u.searchParams.set("allow_llm_to_see_data", String(!!allowSeeData));
      const r = await fetch(u.toString());
      const j = await jsonOrThrow(r);

      const raw: string = j.raw ?? "";
      const sql: string = j.text ?? extractSql(raw);

      const botMsg: ChatItem = {
        localId: crypto.randomUUID(),
        question: q,
        qid: j.id,
        raw,
        sql,
        rows: undefined,
        figJson: "",
        busy: { run: false, chart: false, follow: false, save: false },
        error: null,
        saved: false,
      };
      setMessages((m) => [...m, botMsg]);
      setQuestion("");
    } catch (e: any) {
      setErrTop(e?.message || String(e));
    }
  }

  async function runSqlFor(localId: string) {
    setMessages((m) =>
      m.map((it) => (it.localId === localId ? { ...it, busy: { ...it.busy!, run: true }, error: null } : it))
    );
    try {
      const msg = messages.find((x) => x.localId === localId);
      if (!msg?.qid) throw new Error("No query id to run");
      const u = new URL(`${API_BASE}/vanna/v0/run_sql`, location.origin);
      u.searchParams.set("id", msg.qid);
      const r = await fetch(u.toString());
      const j = await jsonOrThrow(r);
      const data = JSON.parse(j.df) as Row[];
      setMessages((m) =>
        m.map((it) => (it.localId === localId ? { ...it, rows: data, busy: { ...it.busy!, run: false } } : it))
      );
    } catch (e: any) {
      setMessages((m) =>
        m.map((it) =>
          it.localId === localId
            ? { ...it, error: e?.message || String(e), rows: [], busy: { ...it.busy!, run: false } }
            : it
        )
      );
    }
  }

  async function chartFor(localId: string) {
    setMessages((m) =>
      m.map((it) => (it.localId === localId ? { ...it, busy: { ...it.busy!, chart: true }, error: null } : it))
    );
    try {
      const msg = messages.find((x) => x.localId === localId);
      if (!msg?.qid) throw new Error("No query id for chart");
      const u = new URL(`${API_BASE}/vanna/v0/generate_plotly_figure`, location.origin);
      u.searchParams.set("id", msg.qid);
      const r = await fetch(u.toString());
      const j = await jsonOrThrow(r);
      setMessages((m) =>
        m.map((it) => (it.localId === localId ? { ...it, figJson: j.fig || "", busy: { ...it.busy!, chart: false } } : it))
      );
    } catch (e: any) {
      setMessages((m) =>
        m.map((it) =>
          it.localId === localId
            ? { ...it, error: e?.message || String(e), figJson: "", busy: { ...it.busy!, chart: false } }
            : it
        )
      );
    }
  }

  function csvFor(localId: string) {
    const msg = messages.find((x) => x.localId === localId);
    if (!msg?.qid) return;
    const u = new URL(`${API_BASE}/vanna/v0/download_csv`, location.origin);
    u.searchParams.set("id", msg.qid);
    const a = document.createElement("a");
    a.href = u.toString();
    a.download = `${msg.qid}.csv`;
    a.target = "_blank";
    a.rel = "noopener";
    a.click();
  }

  async function markCorrect(localId: string) {
    setMessages((m) =>
      m.map((it) => (it.localId === localId ? { ...it, busy: { ...it.busy!, save: true }, error: null } : it))
    );
    try {
      const msg = messages.find((x) => x.localId === localId);
      if (!msg?.qid) throw new Error("No id to save");
      await fetch(`${API_BASE}/vanna/v0/mark_correct`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: msg.qid }),
      }).then(jsonOrThrow);
      setMessages((m) =>
        m.map((it) => (it.localId === localId ? { ...it, saved: true, busy: { ...it.busy!, save: false } } : it))
      );
    } catch (e: any) {
      setMessages((m) =>
        m.map((it) =>
          it.localId === localId
            ? { ...it, error: e?.message || String(e), busy: { ...it.busy!, save: false } }
            : it
        )
      );
    }
  }

  async function fixAndSave(localId: string) {
    const msg = messages.find((x) => x.localId === localId);
    if (!msg?.qid) return;
    const corrected = window.prompt("Paste the corrected SQL to save as the answer:", msg.sql || "");
    if (!corrected) return;
    setMessages((m) =>
      m.map((it) => (it.localId === localId ? { ...it, busy: { ...it.busy!, save: true }, error: null } : it))
    );
    try {
      await fetch(`${API_BASE}/vanna/v0/mark_correct`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: msg.qid, sql: corrected }),
      }).then(jsonOrThrow);
      setMessages((m) =>
        m.map((it) =>
          it.localId === localId
            ? { ...it, sql: corrected, saved: true, busy: { ...it.busy!, save: false } }
            : it
        )
      );
    } catch (e: any) {
      setMessages((m) =>
        m.map((it) =>
          it.localId === localId
            ? { ...it, error: e?.message || String(e), busy: { ...it.busy!, save: false } }
            : it
        )
      );
    }
  }

  // -------- training drawer API --------
  async function fetchTraining() {
    try {
      setTrainErr(null);
      const r = await fetch(`${API_BASE}/vanna/v0/get_training_data`);
      const j = await r.json();
      setTraining(j.records || []);
    } catch (e: any) {
      setTrainErr(e?.message || String(e));
    }
  }

  async function removeTraining(id: string) {
    try {
      const u = new URL(`${API_BASE}/vanna/v0/remove_training_data`, location.origin);
      u.searchParams.set("id", id);
      await fetch(u.toString(), { method: "DELETE" }).then(jsonOrThrow);
    } catch {}
    fetchTraining();
  }

  async function addTraining(payload: any) {
    setTrainBusy(true);
    setTrainErr(null);
    try {
      await fetch(`${API_BASE}/vanna/v0/train`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }).then(jsonOrThrow);
      fetchTraining();
    } catch (e: any) {
      setTrainErr(e?.message || String(e));
    } finally {
      setTrainBusy(false);
    }
  }

  async function uploadTraining(kind: "sql" | "json", file: File) {
    setTrainBusy(true);
    setTrainErr(null);
    try {
      const fd = new FormData();
      fd.append("file", file, file.name);
      await fetch(`${API_BASE}/vanna/v0/train_file?kind=${encodeURIComponent(kind)}`, {
        method: "POST",
        body: fd,
      }).then(jsonOrThrow);
      fetchTraining();
    } catch (e: any) {
      setTrainErr(e?.message || String(e));
    } finally {
      setTrainBusy(false);
    }
  }

  async function quickAutoTrain() {
    setTrainBusy(true);
    setTrainErr(null);
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

  // -------- connect modal actions --------
  async function submitConnect(e?: React.FormEvent) {
    e?.preventDefault();
    setConnBusy(true);
    setConnErr(null);
    try {
      await fetch(`${API_BASE}/vanna/v0/connect/postgres`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(connForm),
      }).then(jsonOrThrow);
      setShowConnect(false);
      connectionStatus();
    } catch (err: any) {
      setConnErr(err?.message || String(err));
    } finally {
      setConnBusy(false);
    }
  }

  async function doDisconnect() {
    try {
      await fetch(`${API_BASE}/vanna/v0/disconnect`, { method: "POST" }).then(jsonOrThrow);
      connectionStatus();
    } catch {}
  }

  // -------- UI --------
  return (
    <div className="flex flex-col h-screen bg-background text-foreground">
      {/* Header */}
      <header className="px-4 md:px-8 py-3 border-b flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold">Vanna.AI</h1>
          <span className="hidden md:inline text-xs text-muted-foreground">Ask → SQL → results → charts</span>
        </div>
        <div className="flex items-center gap-2">
          <span className={badge}>
            {connectedInfo
              ? `Connected: ${connectedInfo.dbname || "db"}${connectedInfo.host ? " @ " + connectedInfo.host : ""}`
              : status}
          </span>
          <button onClick={() => setShowConnect(true)} className="px-2 py-1.5 rounded border text-xs hover:bg-muted">
            {connectedInfo ? "Reconnect" : "Connect"}
          </button>
          {connectedInfo && (
            <button onClick={doDisconnect} className="px-2 py-1.5 rounded border text-xs hover:bg-muted">
              Disconnect
            </button>
          )}
        </div>
      </header>

      {/* Main: sidebar + chat */}
      <div className="flex-1 grid grid-cols-1 md:grid-cols-[260px,1fr] gap-4 md:gap-6 px-4 md:px-8 py-4 overflow-hidden">
        {/* Sidebar */}
        <aside className="hidden md:block border rounded-xl p-3 space-y-2">
          <div className="font-semibold text-sm">Navigation</div>
          <nav className="grid gap-2">
            <button
              onClick={() => setShowTraining((v) => !v)}
              className={`text-left px-3 py-2 rounded border hover:bg-muted ${showTraining ? "bg-muted" : ""}`}
              title={showTraining ? "Hide Training Data" : "Show Training Data"}
            >
              Training Data
            </button>
            <button onClick={() => setMessages([])} className="text-left px-3 py-2 rounded border hover:bg-muted">
              New chat
            </button>
          </nav>
        </aside>

        {/* Chat stream */}
        <section className="flex flex-col rounded-xl border overflow-hidden">
          <div ref={streamRef} className="flex-1 overflow-auto p-3 md:p-4 space-y-4">
            {messages.map((m) => {
              const isUser = !m.sql && !m.raw;
              return isUser ? (
                <div key={m.localId} className="flex justify-end">
                  <div className="max-w-[900px] w-full rounded-lg border bg-muted/30 px-3 py-2">
                    <div className="text-xs text-muted-foreground mb-1">You</div>
                    <div className="whitespace-pre-wrap">{m.question}</div>
                  </div>
                </div>
              ) : (
                <div key={m.localId} className="flex justify-start">
                  <div className="max-w-[1000px] w-full space-y-3">
                    {/* SQL box only */}
                    <div className="rounded-lg border p-3 bg-background/60">
                      <div className="text-xs text-muted-foreground mb-2">Generated SQL (id: {m.qid})</div>
                      <pre className="text-xs border rounded p-2 overflow-auto bg-muted/30 max-h-60">
                        {m.sql || "—"}
                      </pre>
                      <div className="mt-2 flex flex-wrap gap-2">
                        <button
                          onClick={() => runSqlFor(m.localId)}
                          disabled={!!m.busy?.run}
                          className="px-2.5 py-1.5 rounded border hover:bg-muted disabled:opacity-60 text-sm"
                        >
                          {m.busy?.run ? "Running…" : "Run"}
                        </button>
                        <button
                          onClick={() => chartFor(m.localId)}
                          disabled={!!m.busy?.chart}
                          className="px-2.5 py-1.5 rounded border hover:bg-muted disabled:opacity-60 text-sm"
                        >
                          {m.busy?.chart ? "Building…" : "Generate Chart"}
                        </button>
                        <button
                          onClick={() => csvFor(m.localId)}
                          className="px-2.5 py-1.5 rounded border hover:bg-muted text-sm"
                        >
                          Download CSV
                        </button>

                        <span className="mx-2 w-px bg-muted" />

                        <button
                          onClick={() => markCorrect(m.localId)}
                          disabled={!!m.busy?.save || m.saved}
                          className="px-2.5 py-1.5 rounded border hover:bg-muted disabled:opacity-60 text-sm"
                          title="Save this Q→SQL to training"
                        >
                          {m.saved ? "Saved ✓" : m.busy?.save ? "Saving…" : "Mark correct"}
                        </button>
                        <button
                          onClick={() => fixAndSave(m.localId)}
                          className="px-2.5 py-1.5 rounded border hover:bg-muted text-sm"
                          title="Paste a corrected SQL and save"
                        >
                          Fix & save
                        </button>
                      </div>
                      {m.error && <div className="text-red-500 mt-2 text-xs whitespace-pre-wrap">{m.error}</div>}
                    </div>

                    {/* chart */}
                    <div className="rounded-lg border p-3 bg-background/60">
                      <div className="text-xs text-muted-foreground mb-2">Chart</div>
                      <div className="h-[340px] w-full border rounded bg-muted/20 grid place-items-center">
                        {m.figJson ? (
                          plotlyReady ? (
                            <PlotlyFigure figJson={m.figJson} />
                          ) : (
                            <span className="text-xs">Loading Plotly…</span>
                          )
                        ) : (
                          <span className="text-xs text-muted-foreground">No chart yet</span>
                        )}
                      </div>
                      {!!m.figJson && (
                        <details className="text-xs mt-2">
                          <summary className="cursor-pointer">Figure JSON</summary>
                          <pre className="border rounded p-2 overflow-auto bg-muted/30 mt-1 max-h-64">{m.figJson}</pre>
                        </details>
                      )}
                    </div>

                    {/* results */}
                    <div className="rounded-lg border p-3 bg-background/60">
                      <div className="text-sm font-medium mb-2">Results</div>
                      <div className="overflow-auto border rounded">
                        <table className="min-w-full text-sm">
                          <thead className="bg-muted/50">
                            <tr>
                              {m.rows && m.rows[0]
                                ? Object.keys(m.rows[0]).map((k) => (
                                    <th key={k} className="px-3 py-2 text-left border-b">
                                      {k}
                                    </th>
                                  ))
                                : null}
                            </tr>
                          </thead>
                          <tbody>
                            {m.rows && m.rows.length ? (
                              m.rows.map((r, i) => (
                                <tr key={i} className="odd:bg-muted/20">
                                  {Object.keys(m.rows[0] || {}).map((k) => (
                                    <td key={k} className="px-3 py-2 border-b whitespace-pre-wrap">
                                      {String(r[k] ?? "")}
                                    </td>
                                  ))}
                                </tr>
                              ))
                            ) : (
                              <tr>
                                <td className="px-3 py-6 text-muted-foreground" colSpan={99}>
                                  No rows yet. Click <b>Run</b> to execute the SQL.
                                </td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
            {!messages.length && <div className="text-sm text-muted-foreground">Ask a question to get started.</div>}
          </div>

          {/* Composer */}
          <form onSubmit={onAskSubmit} className="border-t p-3 md:p-4 space-y-2">
            <div className="flex gap-2">
              <input
                className="flex-1 h-10 box-border px-3 rounded-md border border-muted bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-muted"
                placeholder='Ask anything, e.g. "Top 5 categories by rentals in 2007"'
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
              />
              <button type="submit" className="px-4 py-2 rounded bg-blue-600 text-white hover:bg-blue-500">
                Ask
              </button>
            </div>
            <label className="text-xs flex items-center gap-2">
              <input type="checkbox" checked={allowSeeData} onChange={(e) => setAllowSeeData(e.target.checked)} />
              Allow LLM to see schema/data (introspection)
            </label>
            {errTop && <div className="text-red-500 text-xs whitespace-pre-wrap">{errTop}</div>}
          </form>
        </section>
      </div>

      {/* TRAINING DRAWER */}
      <div
        className={`fixed inset-0 bg-black/30 transition-opacity duration-200 ${showTraining ? "opacity-100" : "opacity-0 pointer-events-none"}`}
        onClick={() => setShowTraining(false)}
      />
      <div
        className={`fixed top-0 right-0 h-full w-full sm:w-[560px] bg-background border-l shadow-2xl transition-transform duration-300
        ${showTraining ? "translate-x-0" : "translate-x-full"}`}
        role="dialog"
        aria-label="Training Data"
      >
        <div className="h-full flex flex-col">
          <div className="p-4 border-b flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="h-6 w-6 rounded-lg bg-primary/20" />
              <h2 className="text-base font-semibold">Training Data</h2>
            </div>
            <div className="flex items-center gap-2">
              <button onClick={fetchTraining} className="text-xs underline">refresh</button>
              <button
                onClick={quickAutoTrain}
                disabled={trainBusy}
                className="text-xs px-2 py-1 rounded border hover:bg-muted disabled:opacity-60"
              >
                {trainBusy ? "Training…" : "Auto-train schema"}
              </button>
              <button
                onClick={() => setShowTraining(false)}
                className="ml-2 px-2 py-1 rounded border hover:bg-muted text-xs"
                title="Minimize"
              >
                ✕
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-auto p-4 space-y-4">
            {trainErr && <div className="text-red-500 text-xs">{trainErr}</div>}

            {/* Records table */}
            <div className="rounded-xl border overflow-hidden">
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
                        <pre className="max-w-[520px] overflow-auto">
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

            {/* Adders */}
            <AddTrainingForms busy={trainBusy} onAdd={addTraining} onUpload={uploadTraining} />
          </div>
        </div>
      </div>

      {/* CONNECT MODAL */}
      <div
        className={`fixed inset-0 bg-black/30 transition-opacity duration-200 ${showConnect ? "opacity-100" : "opacity-0 pointer-events-none"}`}
        onClick={() => setShowConnect(false)}
      />
      <div
        className={`fixed top-1/2 left-1/2 w-[92vw] max-w-[540px] -translate-x-1/2 -translate-y-1/2 bg-background border rounded-xl shadow-xl transition-transform
        ${showConnect ? "scale-100 opacity-100" : "scale-95 opacity-0 pointer-events-none"}`}
      >
        <form onSubmit={submitConnect} className="p-4 space-y-3">
          <div className="text-base font-semibold">Connect to Postgres (DATA DB)</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <Input label="Host" value={connForm.host} onChange={(v) => setConnForm({ ...connForm, host: v })} />
            <Input label="Database" value={connForm.dbname} onChange={(v) => setConnForm({ ...connForm, dbname: v })} />
            <Input label="User" value={connForm.user} onChange={(v) => setConnForm({ ...connForm, user: v })} />
            <Input
              label="Password"
              type="password"
              value={connForm.password}
              onChange={(v) => setConnForm({ ...connForm, password: v })}
            />
            <Input label="Port" value={connForm.port} onChange={(v) => setConnForm({ ...connForm, port: v })} />
            <Input label="SSL Mode" value={connForm.sslmode} onChange={(v) => setConnForm({ ...connForm, sslmode: v })} />
          </div>
          {connErr && <div className="text-red-500 text-xs">{connErr}</div>}
          <div className="flex items-center gap-2 justify-end">
            <button type="button" onClick={() => setShowConnect(false)} className="px-3 py-1.5 rounded border">
              Cancel
            </button>
            <button type="submit" disabled={connBusy} className="px-3 py-1.5 rounded bg-blue-600 text-white">
              {connBusy ? "Connecting…" : "Connect"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function PlotlyFigure({ figJson }: { figJson: string }) {
  const mount = React.useRef<HTMLDivElement | null>(null);
  React.useEffect(() => {
    try {
      if (!mount.current) return;
      const fig = JSON.parse(figJson);
      (window as any).Plotly.newPlot(mount.current, fig.data, fig.layout || {});
    } catch {}
  }, [figJson]);
  return <div ref={mount} className="w-full h-full" />;
}

function Input({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
}) {
  return (
    <label className="text-xs grid gap-1">
      <span className="text-muted-foreground">{label}</span>
      <input
        className="h-9 box-border px-3 rounded-md border border-muted bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-muted"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        type={type}
      />
    </label>
  );
}

// ---------- Add training forms ----------
function AddTrainingForms({
  busy,
  onAdd,
  onUpload,
}: {
  busy: boolean;
  onAdd: (payload: any) => Promise<void>;
  onUpload: (kind: "sql" | "json", file: File) => Promise<void>;
}) {
  const [ddl, setDdl] = React.useState("");
  const [doc, setDoc] = React.useState("");
  const [q, setQ] = React.useState("");
  const [s, setS] = React.useState("");
  const [fileSql, setFileSql] = React.useState<File | null>(null);
  const [fileJson, setFileJson] = React.useState<File | null>(null);

  const inputCls =
    "w-full h-9 box-border px-3 rounded-md border border-muted bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-muted";
  const textareaCls =
    "w-full box-border rounded-md border border-muted bg-background text-foreground placeholder:text-muted-foreground p-2 leading-normal resize-y min-h-[100px] focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-muted";

  return (
    <div className="grid gap-4">
      <div className="rounded-xl border p-3 space-y-2">
        <div className="font-semibold text-sm">Add DDL</div>
        <textarea className={textareaCls} placeholder="CREATE TABLE ..." value={ddl} onChange={(e) => setDdl(e.target.value)} />
        <button onClick={() => onAdd({ ddl })} disabled={!ddl || busy} className="px-3 py-1.5 rounded border hover:bg-muted disabled:opacity-60 text-sm">
          Add
        </button>
      </div>

      <div className="rounded-xl border p-3 space-y-2">
        <div className="font-semibold text-sm">Add Documentation</div>
        <textarea
          className={textareaCls}
          placeholder="Describe tables, columns, business rules…"
          value={doc}
          onChange={(e) => setDoc(e.target.value)}
        />
        <button
          onClick={() => onAdd({ documentation: doc })}
          disabled={!doc || busy}
          className="px-3 py-1.5 rounded border hover:bg-muted disabled:opacity-60 text-sm"
        >
          Add
        </button>
      </div>

      <div className="rounded-xl border p-3 space-y-2">
        <div className="font-semibold text-sm">Add Q ↔ SQL</div>
        <input className={inputCls} placeholder="Question" value={q} onChange={(e) => setQ(e.target.value)} />
        <textarea className={textareaCls + " min-h-[80px]"} placeholder="SELECT …" value={s} onChange={(e) => setS(e.target.value)} />
        <button onClick={() => onAdd({ question: q, sql: s })} disabled={!q || !s || busy} className="px-3 py-1.5 rounded border hover:bg-muted disabled:opacity-60 text-sm">
          Add
        </button>
      </div>

      <div className="rounded-xl border p-3 space-y-2">
        <div className="font-semibold text-sm">Bulk upload</div>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-xs grid gap-1">
            <span className="text-muted-foreground">SQL file (.sql)</span>
            <input type="file" accept=".sql" onChange={(e) => setFileSql(e.target.files?.[0] || null)} />
          </label>
          <label className="text-xs grid gap-1">
            <span className="text-muted-foreground">JSON file (.json)</span>
            <input type="file" accept=".json" onChange={(e) => setFileJson(e.target.files?.[0] || null)} />
          </label>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => fileSql && onUpload("sql", fileSql)}
            disabled={!fileSql || busy}
            className="px-3 py-1.5 rounded border hover:bg-muted disabled:opacity-60 text-sm"
          >
            Upload .sql
          </button>
          <button
            onClick={() => fileJson && onUpload("json", fileJson)}
            disabled={!fileJson || busy}
            className="px-3 py-1.5 rounded border hover:bg-muted disabled:opacity-60 text-sm"
          >
            Upload .json
          </button>
        </div>
        <p className="text-xs text-muted-foreground">
          JSON format: list of objects like {"{ question, sql }"}, or entries containing {"ddl"} / {"documentation"}.
        </p>
      </div>
    </div>
  );
}
