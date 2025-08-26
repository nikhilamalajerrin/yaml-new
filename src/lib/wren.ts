// src/lib/wren.ts
// Minimal client for your running Wren service (default http://localhost:5555)

const BASE = import.meta.env.VITE_WREN_BASE || "http://localhost:5555";

export type WrenConfig = {
  project_id?: string;
  language?: string;
  timezone?: { name: string; utc_offset: string };
};

export async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, "0")).join("");
}

/** Step 1: Prepare Semantics (indexes MDL into vector store) */
export async function prepareSemantics(opts: {
  mdl: string;
  project_id?: string;
}): Promise<{ mdl_hash: string }> {
  const mdl_hash = await sha256Hex(opts.mdl);
  const body = {
    mdl: opts.mdl,
    mdl_hash,
    project_id: opts.project_id ?? undefined,
  };
  const r = await fetch(`${BASE}/v1/semantics-preparations`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    throw new Error(`Semantics prepare failed: ${r.status} ${await r.text()}`);
  }
  return { mdl_hash };
}

export async function pollSemanticsStatus(mdl_hash: string, { timeoutMs = 60_000, intervalMs = 1500 } = {}) {
  const t0 = Date.now();
  while (true) {
    const r = await fetch(`${BASE}/v1/semantics-preparations/${encodeURIComponent(mdl_hash)}/status`);
    const j = await r.json(); // { status: "indexing" | "finished" | "failed", error? }
    if (j.status === "finished") return j;
    if (j.status === "failed") throw new Error(j?.error?.message || "Semantics preparation failed");
    if (Date.now() - t0 > timeoutMs) throw new Error("Timed out waiting for semantics indexing");
    await new Promise(res => setTimeout(res, intervalMs));
  }
}

/** Step 2: Ask (LLM→SQL) */
export async function ask(opts: {
  query: string;
  mdl_hash: string;
  project_id?: string;
  configurations?: WrenConfig;
}): Promise<{ query_id: string }> {
  const body = {
    query: opts.query,
    mdl_hash: opts.mdl_hash,
    project_id: opts.project_id ?? undefined,
    configurations: {
      language: opts.configurations?.language ?? "English",
      timezone: opts.configurations?.timezone ?? { name: "UTC", utc_offset: "" },
    },
    request_from: "api",
  };
  const r = await fetch(`${BASE}/v1/asks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`Ask failed: ${r.status} ${await r.text()}`);
  return r.json();
}

export type AskResult = {
  status: "understanding"|"searching"|"planning"|"generating"|"correcting"|"finished"|"failed"|"stopped";
  response: Array<{ sql: string; type: "llm"|"view"; viewId?: string }> | null;
  sql_generation_reasoning?: string | null;
  error?: { code: string; message: string } | null;
};

export async function pollAskResult(query_id: string, { timeoutMs = 90_000, intervalMs = 1200 } = {}): Promise<AskResult> {
  const t0 = Date.now();
  while (true) {
    const r = await fetch(`${BASE}/v1/asks/${encodeURIComponent(query_id)}/result`);
    const j: AskResult = await r.json();
    if (j.status === "finished") return j;
    if (j.status === "failed" || j.status === "stopped") {
      throw new Error(j.error?.message || "Ask failed");
    }
    if (Date.now() - t0 > timeoutMs) throw new Error("Timed out waiting for ask result");
    await new Promise(res => setTimeout(res, intervalMs));
  }
}

/** Step 3: Chart (Vega-Lite schema from SQL) */
export async function createChart(opts: {
  query: string;
  sql: string;
  project_id?: string;
}): Promise<{ query_id: string }> {
  const body = {
    query: opts.query,
    sql: opts.sql,
    project_id: opts.project_id ?? undefined,
    request_from: "api",
  };
  const r = await fetch(`${BASE}/v1/charts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`Chart create failed: ${r.status} ${await r.text()}`);
  return r.json();
}

export type ChartResult = {
  status: "fetching"|"generating"|"finished"|"failed"|"stopped";
  response: null | { reasoning: string; chart_type: string; chart_schema: any };
  error?: { code: string; message: string } | null;
};

export async function pollChart(query_id: string, { timeoutMs = 90_000, intervalMs = 1200 } = {}): Promise<ChartResult> {
  const t0 = Date.now();
  while (true) {
    const r = await fetch(`${BASE}/v1/charts/${encodeURIComponent(query_id)}`);
    const j: ChartResult = await r.json();
    if (j.status === "finished") return j;
    if (j.status === "failed" || j.status === "stopped") {
      throw new Error(j.error?.message || "Chart failed");
    }
    if (Date.now() - t0 > timeoutMs) throw new Error("Timed out waiting for chart");
    await new Promise(res => setTimeout(res, intervalMs));
  }
}
