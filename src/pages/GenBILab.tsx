// src/pages/GenBILab.tsx
import React from "react";
import { Loader2, Send, Database, Image as ChartIcon, CheckCircle2, Hash } from "lucide-react";
import {
  prepareSemantics,
  pollSemanticsStatus,
  ask,
  pollAskResult,
  createChart,
  pollChart,
} from "@/lib/wren";

type Stage = "idle" | "indexing" | "ready" | "asking" | "charting" | "error";

function Badge({ children, tone = "default" }: { children: React.ReactNode; tone?: "default"|"ok"|"warn"|"err" }) {
  const map: Record<string,string> = {
    default: "bg-muted text-foreground/90",
    ok: "bg-emerald-500/15 text-emerald-500",
    warn: "bg-amber-500/15 text-amber-500",
    err: "bg-red-500/15 text-red-500",
  };
  return <span className={`px-2 py-0.5 rounded text-xs font-medium ${map[tone]}`}>{children}</span>;
}

// Optional lightweight vega-embed loader (no build-time dependency)
function useVegaEmbed() {
  const [ready, setReady] = React.useState<boolean>(!!(window as any).vegaEmbed);
  React.useEffect(() => {
    if ((window as any).vegaEmbed) { setReady(true); return; }
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/vega-embed@6";
    s.async = true;
    s.onload = () => setReady(true);
    document.head.appendChild(s);
    return () => { document.head.removeChild(s); };
  }, []);
  return ready;
}

export default function GenBILab() {
  const [projectId, setProjectId] = React.useState("demo");
  const [mdl, setMdl] = React.useState<string>(
    `{
  "catalog": "local",
  "schema": "public",
  "models": [
    { "name": "dummy", "refSql": "select 1 as x" }
  ]
}`
  );
  const [mdlHash, setMdlHash] = React.useState<string>("");
  const [stage, setStage] = React.useState<Stage>("idle");
  const [err, setErr] = React.useState<string>("");

  const [question, setQuestion] = React.useState<string>("Top 10 rows from dummy");
  const [sql, setSql] = React.useState<string>("");
  const [reasoning, setReasoning] = React.useState<string>("");

  const [chartSpec, setChartSpec] = React.useState<any>(null);
  const vegaReady = useVegaEmbed();
  const chartRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!vegaReady || !chartSpec || !chartRef.current) return;
    const embed = (window as any).vegaEmbed as (el: any, spec: any, opts?: any) => Promise<any>;
    embed(chartRef.current, chartSpec, { actions: false }).catch(() => {});
  }, [vegaReady, chartSpec]);

  async function doPrepare() {
    setErr("");
    setStage("indexing");
    try {
      const { mdl_hash } = await prepareSemantics({ mdl, project_id: projectId });
      setMdlHash(mdl_hash);
      await pollSemanticsStatus(mdl_hash);
      setStage("ready");
    } catch (e: any) {
      setErr(e?.message || String(e));
      setStage("error");
    }
  }

  async function doAsk() {
    if (!mdlHash) { setErr("Prepare semantics first."); setStage("error"); return; }
    setErr("");
    setSql("");
    setReasoning("");
    setChartSpec(null);
    setStage("asking");
    try {
      const { query_id } = await ask({
        query: question,
        mdl_hash: mdlHash,
        project_id: projectId,
      });
      const res = await pollAskResult(query_id);
      const first = Array.isArray(res.response) ? res.response[0] : null;
      if (!first?.sql) throw new Error("No SQL returned.");
      setSql(first.sql);
      setReasoning(res.sql_generation_reasoning || "");
      setStage("ready");
    } catch (e: any) {
      setErr(e?.message || String(e));
      setStage("error");
    }
  }

  async function doChart() {
    if (!sql) { setErr("No SQL to chart. Ask a question first."); setStage("error"); return; }
    setErr("");
    setChartSpec(null);
    setStage("charting");
    try {
      const { query_id } = await createChart({ query: question, sql, project_id: projectId });
      const res = await pollChart(query_id);
      const spec = res.response?.chart_schema;
      if (!spec) throw new Error("Chart schema missing.");
      setChartSpec(spec);
      setStage("ready");
    } catch (e: any) {
      setErr(e?.message || String(e));
      setStage("error");
    }
  }

  return (
    <div className="p-6">
      <div className="grid lg:grid-cols-2 gap-6">
        {/* LEFT: MDL & Prepare */}
        <div className="pipeline-panel p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 rounded-lg bg-primary/20"><Database className="w-4 h-4 text-primary" /></div>
            <h2 className="text-xl font-bold">Wren Semantics</h2>
          </div>

          <div className="flex items-center gap-2 mb-3">
            <label className="text-sm text-muted-foreground">Project ID</label>
            <input
              className="pipeline-input"
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              placeholder="demo"
              style={{ maxWidth: 240 }}
            />
          </div>

          <label className="text-sm font-medium">MDL (JSON)</label>
          <textarea
            className="pipeline-input mt-1 font-mono text-xs"
            rows={12}
            value={mdl}
            onChange={(e) => setMdl(e.target.value)}
          />

          <div className="mt-3 flex items-center gap-2">
            <button onClick={doPrepare} className="pipeline-button flex items-center gap-2">
              {stage === "indexing" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Hash className="w-4 h-4" />}
              Prepare Semantics
            </button>
            {mdlHash && <Badge tone="ok">hash: {mdlHash.slice(0, 12)}…</Badge>}
            {stage === "ready" && <Badge tone="ok" ><CheckCircle2 className="w-3 h-3 inline -mt-0.5 mr-1" />Ready</Badge>}
          </div>

          {err && (
            <div className="mt-3 text-sm text-red-500 whitespace-pre-wrap">
              {err}
            </div>
          )}
        </div>

        {/* RIGHT: Ask → SQL → Chart */}
        <div className="pipeline-panel p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 rounded-lg bg-primary/20"><Send className="w-4 h-4 text-primary" /></div>
            <h2 className="text-xl font-bold">Ask → SQL → Chart</h2>
            <div className="flex-1" />
            <Badge tone={stage === "asking" || stage === "charting" ? "warn" : "default"}>
              {stage}
            </Badge>
          </div>

          <div className="flex gap-2">
            <input
              className="pipeline-input flex-1"
              placeholder="Ask a question in English…"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") doAsk(); }}
            />
            <button onClick={doAsk} className="pipeline-button flex items-center gap-2">
              {stage === "asking" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              Ask
            </button>
            <button onClick={doChart} className="pipeline-button-secondary flex items-center gap-2">
              {stage === "charting" ? <Loader2 className="w-4 h-4 animate-spin" /> : <ChartIcon className="w-4 h-4" />}
              Chart
            </button>
          </div>

          {/* SQL + Reasoning */}
          <div className="mt-4 grid gap-3">
            {reasoning && (
              <div className="rounded-md border border-border/60 bg-muted/20 p-3">
                <div className="text-xs uppercase text-muted-foreground mb-1">Reasoning</div>
                <pre className="text-xs whitespace-pre-wrap">{reasoning}</pre>
              </div>
            )}

            {sql && (
              <div className="rounded-md border border-border/60 bg-muted/20 p-3">
                <div className="text-xs uppercase text-muted-foreground mb-1">SQL</div>
                <pre className="text-xs overflow-auto">{sql}</pre>
              </div>
            )}

            {/* Chart */}
            <div className="rounded-md border border-border/60 bg-muted/10 p-3 min-h-[220px]">
              <div className="text-xs uppercase text-muted-foreground mb-1">Chart</div>
              {!chartSpec && <div className="text-xs text-muted-foreground">No chart yet. Click “Chart”.</div>}
              <div ref={chartRef} />
              {/* Fallback: show raw schema if vega-embed not ready */}
              {chartSpec && !vegaReady && (
                <pre className="text-xs overflow-auto mt-2">{JSON.stringify(chartSpec, null, 2)}</pre>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
