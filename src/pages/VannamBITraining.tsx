import * as React from "react";

type Row = Record<string, any>;
const API_BASE = "/api";

export default function VannamBITraining() {
  const [rows, setRows] = React.useState<Row[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [err, setErr] = React.useState<string>("");

  const [ddl, setDdl] = React.useState("");
  const [documentation, setDocumentation] = React.useState("");
  const [sql, setSql] = React.useState("");
  const [question, setQuestion] = React.useState("");

  async function jsonOrThrow(r: Response) {
    const j = await r.json().catch(() => ({}));
    if (!r.ok || (j && j.type === "error")) {
      const msg = j?.error || `${r.status} ${r.statusText}`;
      throw new Error(msg);
    }
    return j;
  }

  async function refresh() {
    setLoading(true);
    setErr("");
    try {
      const r = await fetch(`${API_BASE}/vanna/v0/get_training_data`);
      const j = await jsonOrThrow(r);
      const data = Array.isArray(j.records) ? j.records : JSON.parse(j.df || "[]");
      setRows(Array.isArray(data) ? data : []);
    } catch (e: any) {
      setErr(e?.message || "Failed to load training data");
    } finally {
      setLoading(false);
    }
  }

  React.useEffect(() => {
    refresh();
  }, []);

  async function add(kind: "ddl" | "documentation" | "sql" | "question") {
    const payload: any = {};
    if (kind === "ddl" && ddl.trim()) payload.ddl = ddl.trim();
    if (kind === "documentation" && documentation.trim()) payload.documentation = documentation.trim();
    if (kind === "sql" && sql.trim()) payload.sql = sql.trim();
    if (kind === "question" && question.trim()) payload.question = question.trim();
    if (!Object.keys(payload).length) return;

    try {
      await fetch(`${API_BASE}/vanna/v0/train`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }).then(jsonOrThrow);
      if (kind === "ddl") setDdl("");
      if (kind === "documentation") setDocumentation("");
      if (kind === "sql") setSql("");
      if (kind === "question") setQuestion("");
      await refresh();
    } catch (e: any) {
      alert(e?.message || "Training failed");
    }
  }

  async function remove(id: string) {
    if (!confirm(`Remove training id ${id}?`)) return;
    try {
      const u = new URL(`${API_BASE}/vanna/v0/remove_training_data`, location.origin);
      u.searchParams.set("id", id);
      const r = await fetch(u.toString(), { method: "DELETE" });
      const j = await r.json().catch(() => ({}));
      // Backend returns { ok: true } (not { success: true })
      if (j?.ok || j?.success) {
        await refresh();
      } else {
        throw new Error(j?.error || "Remove failed");
      }
    } catch (e: any) {
      alert(e?.message || "Remove failed");
    }
  }

  return (
    <div className="p-4 lg:p-8 max-w-[1200px] mx-auto space-y-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">VannamBI — Training</h1>
          <p className="text-sm text-muted-foreground">
            Add DDL, documentation, SQL, or seed questions to improve SQL generation (RAG).
          </p>
        </div>
        <a href="/vannam-bi" className="text-xs underline">← Back to VannamBI</a>
      </header>

      {/* Add training */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="rounded-xl border p-4 bg-background/60 space-y-3">
          <h2 className="text-sm font-semibold">Add DDL</h2>
          <textarea
            className="w-full min-h-[140px] border rounded p-2 font-mono text-xs"
            placeholder={`CREATE TABLE IF NOT EXISTS my_table (...);`}
            value={ddl}
            onChange={(e) => setDdl(e.target.value)}
          />
          <button onClick={() => add("ddl")} className="px-3 py-1.5 rounded border hover:bg-muted">
            Train DDL
          </button>
        </div>

        <div className="rounded-xl border p-4 bg-background/60 space-y-3">
          <h2 className="text-sm font-semibold">Add Documentation</h2>
          <textarea
            className="w-full min-h-[140px] border rounded p-2 text-sm"
            placeholder={`Explain business terms, KPIs, definitions...`}
            value={documentation}
            onChange={(e) => setDocumentation(e.target.value)}
          />
          <button onClick={() => add("documentation")} className="px-3 py-1.5 rounded border hover:bg-muted">
            Train Documentation
          </button>
        </div>

        <div className="rounded-xl border p-4 bg-background/60 space-y-3">
          <h2 className="text-sm font-semibold">Add SQL Examples</h2>
          <textarea
            className="w-full min-h-[140px] border rounded p-2 font-mono text-xs"
            placeholder={`SELECT * FROM my_table WHERE ...;`}
            value={sql}
            onChange={(e) => setSql(e.target.value)}
          />
          <button onClick={() => add("sql")} className="px-3 py-1.5 rounded border hover:bg-muted">
            Train SQL
          </button>
        </div>

        <div className="rounded-xl border p-4 bg-background/60 space-y-3">
          <h2 className="text-sm font-semibold">Add Seed Questions</h2>
          <textarea
            className="w-full min-h-[140px] border rounded p-2 text-sm"
            placeholder={`"What are daily orders?" (optional, Vanna can auto-generate too)`}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
          />
          <button onClick={() => add("question")} className="px-3 py-1.5 rounded border hover:bg-muted">
            Train Question
          </button>
        </div>
      </section>

      {/* List training data */}
      <section className="rounded-xl border p-4 bg-background/60">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-semibold">Training Data</h2>
          <button onClick={refresh} className="px-3 py-1.5 rounded border hover:bg-muted text-xs">
            Refresh
          </button>
        </div>
        {loading ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : err ? (
          <div className="text-sm text-red-500">{err}</div>
        ) : (
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
                {rows.map((r: any, i: number) => {
                  const id = String(r.id ?? r.ID ?? r.key ?? i);
                  const type = r.type ?? r.Type ?? r.kind ?? "";
                  const content = (r.text || r.ddl || r.documentation || r.sql || r.plan || "").toString();
                  return (
                    <tr key={id} className="odd:bg-muted/20 align-top">
                      <td className="px-3 py-2 border-b font-mono text-xs whitespace-nowrap">{id}</td>
                      <td className="px-3 py-2 border-b text-xs whitespace-nowrap">{type}</td>
                      <td className="px-3 py-2 border-b text-xs">
                        <pre className="max-w-[600px] overflow-auto">{content}</pre>
                      </td>
                      <td className="px-3 py-2 border-b whitespace-nowrap">
                        <button
                          onClick={() => remove(id)}
                          className="px-2 py-1 text-xs rounded border hover:bg-muted"
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  );
                })}
                {!rows.length && (
                  <tr>
                    <td className="px-3 py-6 text-muted-foreground" colSpan={99}>
                      No training data yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
