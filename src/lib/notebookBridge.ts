// src/lib/notebookBridge.ts
// Two-way bridge between your React flow and a live Jupyter notebook.

export type PandasFunction = { name: string };
type KV = Record<string, any>;

const JUPYTER_URL =
  (import.meta.env.VITE_JUPYTER_URL as string) || "http://localhost:8888";
const JUPYTER_TOKEN = (import.meta.env.VITE_JUPYTER_TOKEN as string) || "";
export const DEFAULT_NOTEBOOK_PATH =
  (import.meta.env.VITE_NOTEBOOK_PATH as string) || "Untitled1.ipynb";

/** First-line tag we both read and write for stable round-trips. */
export const TD_TAG_RE =
  /^#\s*td:function=([a-zA-Z0-9_\.]+)\s+params=(\{[\s\S]*\})\s*$/m;

function jHeaders(): Headers {
  const h = new Headers();
  if (JUPYTER_TOKEN) h.set("Authorization", `Token ${JUPYTER_TOKEN}`);
  h.set("Content-Type", "application/json");
  return h;
}
function api(path: string) {
  return `${JUPYTER_URL.replace(/\/+$/, "")}${path}`;
}

function emptyNb(): any {
  return {
    cells: [],
    metadata: {
      kernelspec: { display_name: "Python 3", name: "python3", language: "python" },
      language_info: { name: "python" },
      td_synced: true,
    },
    nbformat: 4,
    nbformat_minor: 5,
  };
}

export async function ensureNotebook(nbPath = DEFAULT_NOTEBOOK_PATH): Promise<void> {
  const got = await fetch(api(`/api/contents/${encodeURIComponent(nbPath)}`), {
    method: "GET",
    headers: jHeaders(),
    credentials: "include",
    mode: "cors",
  });
  if (got.ok) return;

  if (got.status === 404) {
    const body = { type: "notebook", format: "json", content: emptyNb() };
    const put = await fetch(api(`/api/contents/${encodeURIComponent(nbPath)}`), {
      method: "PUT",
      headers: jHeaders(),
      credentials: "include",
      mode: "cors",
      body: JSON.stringify(body),
    });
    if (!put.ok) throw new Error(`Create notebook failed: ${put.status} ${await put.text()}`);
    return;
  }

  throw new Error(`Read notebook failed: ${got.status} ${await got.text()}`);
}

export async function loadNotebook(nbPath = DEFAULT_NOTEBOOK_PATH): Promise<any> {
  const res = await fetch(api(`/api/contents/${encodeURIComponent(nbPath)}`), {
    method: "GET",
    headers: jHeaders(),
    credentials: "include",
    mode: "cors",
  });
  if (!res.ok) throw new Error(`GET contents failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  if (!data || data.type !== "notebook") throw new Error(`Path is not a notebook: ${nbPath}`);
  return data.content;
}

async function saveNotebook(nb: any, nbPath = DEFAULT_NOTEBOOK_PATH): Promise<void> {
  const body = { type: "notebook", format: "json", content: nb };
  const res = await fetch(api(`/api/contents/${encodeURIComponent(nbPath)}`), {
    method: "PUT",
    headers: jHeaders(),
    credentials: "include",
    mode: "cors",
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`PUT contents failed: ${res.status} ${await res.text()}`);
}

export function toPyIdent(id: string): string {
  const x = id.replace(/[^A-Za-z0-9_]/g, "_");
  return /^[A-Za-z_]/.test(x) ? x : `n_${x}`;
}

function pyKwargs(params: KV): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(params || {})) {
    if (v === undefined || v === null) continue;
    if (typeof v === "string") {
      if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(v)) parts.push(`${k}=${v}`);
      else parts.push(`${k}=${JSON.stringify(v)}`);
    } else if (Array.isArray(v) || typeof v === "object") {
      parts.push(`${k}=${JSON.stringify(v)}`);
    } else {
      parts.push(`${k}=${String(v)}`);
    }
  }
  return parts.join(", ");
}

/** Build the td header line. Always the very first line of the cell. */
function tdHeader(fnName: string, params: KV): string {
  return `# td:function=${fnName} params=${JSON.stringify(params ?? {})}`;
}

/** Build code for a node. Handles python/read_ */
export function codeForNode(nodeId: string, func: PandasFunction, params: KV): string {
  const varName = toPyIdent(nodeId);
  const fn = func.name;
  const p = { ...(params || {}) };
  const imports = ["import pandas as pd", "import numpy as np"].join("\n");
  const header = tdHeader(fn, p);

  // Python freeform cell
  if (fn === "python") {
    const body = typeof p.code === "string" ? p.code : "";
    const safeBody = body.trim() ? body : "# python";
    return `${header}
${safeBody}`.trimEnd() + "\n";
  }

  // Figure method receiver (allow several aliases; remove from kwargs)
  const receiver = (p.self as string) || (p.df as string) || (p.left as string) || undefined;
  delete p.self; delete p.df;

  // DataFrame methods
  if (fn.startsWith("DataFrame.")) {
    const method = fn.split(".")[1];
    if (!receiver) {
      return `${header}
${imports}
# TODO: set receiver for ${fn}
# ${varName} = <receiver>.${method}()\n`;
    }
    if (method === "iloc" || method === "loc") {
      const rows = p.rows ?? ":";
      const cols = p.cols ?? ":";
      return `${header}
${imports}
${varName} = ${toPyIdent(receiver)}.${method}[${String(rows)}, ${String(cols)}]\n`;
    }
    const kwargs = pyKwargs(p);
    return `${header}
${imports}
${varName} = ${toPyIdent(receiver)}.${method}(${kwargs})\n`;
  }

  // pd.merge and friends
  if (fn === "merge" || fn.endsWith(".merge")) {
    const left = p.left ? toPyIdent(String(p.left)) : "LEFT_MISSING";
    const right = p.right ? toPyIdent(String(p.right)) : "RIGHT_MISSING";
    const { left: _l, right: _r, ...rest } = p;
    const kw = pyKwargs(rest);
    const call = kw ? `${left}, ${right}, ${kw}` : `${left}, ${right}`;
    return `${header}
${imports}
${varName} = pd.merge(${call})\n`;
  }

  // read_* → positional first arg
  if (fn.startsWith("read_")) {
    const { filepath_or_buffer, ...rest } = p;
    const kw = pyKwargs(rest);
    const first = filepath_or_buffer !== undefined ? JSON.stringify(filepath_or_buffer) : "";
    const call = kw ? `${first ? `${first}, ` : ""}${kw}` : first;
    return `${header}
${imports}
${varName} = pd.${fn}(${call})\n`;
  }

  // submodule dotted calls e.g., 'plotting.scatter_matrix' or 'numpy.linalg.norm'
  if (fn.includes(".")) {
    const head = fn.split(".")[0];
    const remain = fn.split(".").slice(1).join(".");
    const kwargs = pyKwargs(p);
    return `${header}
${imports}
${varName} = (getattr(pd, "${head}", None) or getattr(np, "${head}", None)).${remain}(${kwargs})\n`;
  }

  // default pandas top-level
  const kwargs = pyKwargs(p);
  return `${header}
${imports}
${varName} = pd.${fn}(${kwargs})\n`;
}

/** Append a new code cell for a node. */
export async function appendCellForNode(
  nodeId: string,
  func: PandasFunction,
  params: KV,
  nbPath = DEFAULT_NOTEBOOK_PATH
): Promise<void> {
  await ensureNotebook(nbPath);
  const nb = await loadNotebook(nbPath);
  const code = codeForNode(nodeId, func, params);

  nb.cells.push({
    cell_type: "code",
    execution_count: null,
    metadata: { td_node_id: nodeId, td_function: func.name, td_params: params },
    source: code.endsWith("\n") ? code : code + "\n",
    outputs: [],
  });

  await saveNotebook(nb, nbPath);
}

/** Update an existing cell (matched by td_node_id). If not found, append. */
export async function updateCellForNode(
  nodeId: string,
  func: PandasFunction,
  params: KV,
  nbPath = DEFAULT_NOTEBOOK_PATH
): Promise<void> {
  await ensureNotebook(nbPath);
  const nb = await loadNotebook(nbPath);
  const code = codeForNode(nodeId, func, params);

  const idx = (nb.cells || []).findIndex(
    (c: any) => c?.cell_type === "code" && (c?.metadata?.td_node_id === nodeId)
  );

  const cell = {
    cell_type: "code",
    execution_count: null,
    metadata: { td_node_id: nodeId, td_function: func.name, td_params: params },
    source: code.endsWith("\n") ? code : code + "\n",
    outputs: [],
  };

  if (idx >= 0) nb.cells[idx] = cell;
  else nb.cells.push(cell);

  await saveNotebook(nb, nbPath);
}

/** Upsert a cell by nodeId (prefer update, else append). */
export async function upsertCellForNode(
  nodeId: string,
  func: PandasFunction,
  params: KV,
  nbPath = DEFAULT_NOTEBOOK_PATH
): Promise<void> {
  const i = await findCellByNodeId(nodeId, nbPath);
  if (i !== -1) {
    await updateCellForNode(nodeId, func, params, nbPath);
  } else {
    await appendCellForNode(nodeId, func, params, nbPath);
  }
}

/** Delete cells for the given node ids. */
export async function deleteCellsForNodeIds(
  nodeIds: string[],
  nbPath = DEFAULT_NOTEBOOK_PATH
): Promise<void> {
  if (!nodeIds?.length) return;
  await ensureNotebook(nbPath);
  const nb = await loadNotebook(nbPath);
  nb.cells = (nb.cells || []).filter(
    (c: any) => !(c?.metadata?.td_node_id && nodeIds.includes(c.metadata.td_node_id))
  );
  await saveNotebook(nb, nbPath);
}

/* ---------- Cells → Nodes sync ---------- */

export function inferCellSpecFromSource(src: string): { fn?: string; params?: KV } {
  const first = (src || "").split(/\r?\n/)[0] || "";
  const m = first.match(/^\s*#\s*td:function\s*=\s*([A-Za-z0-9_.]+)\s*(?:params\s*=\s*(\{.*\}))?\s*$/);
  if (!m) return {};
  const fn = m[1];
  let params: KV | undefined;
  try { params = m[2] ? JSON.parse(m[2]) : undefined; } catch { /* ignore */ }
  return { fn, params };
}

export type TdCell = {
  index: number;
  id?: string;
  fn?: string;
  params?: KV;
  source: string;
};

/**
 * IMPORTANT: Auto-assign stable ids to any code cell that doesn't have one yet.
 * This makes flow → notebook deletions reliable even for cells created outside the app.
 */
export async function listTdCells(nbPath = DEFAULT_NOTEBOOK_PATH): Promise<TdCell[]> {
  await ensureNotebook(nbPath);
  const nb = await loadNotebook(nbPath);

  let modified = false;
  const out: TdCell[] = [];

  (nb.cells || []).forEach((c: any, i: number) => {
    if (c.cell_type !== "code") return;

    // ensure metadata object
    c.metadata = c.metadata || {};

    // 1) Auto-tag missing td_node_id (stable: cell_{index+1})
    if (!c.metadata.td_node_id) {
      c.metadata.td_node_id = `cell_${i + 1}`;
      modified = true;
    }

    // 2) Build output view (we also allow reading a header tag, if present)
    const src = Array.isArray(c.source) ? c.source.join("") : c.source || "";
    const inferred = inferCellSpecFromSource(src);

    out.push({
      index: i,
      id: c.metadata.td_node_id,
      fn: c.metadata.td_function || inferred.fn,
      params: c.metadata.td_params || inferred.params,
      source: src,
    });
  });

  if (modified) {
    await saveNotebook(nb, nbPath);
  }

  return out;
}

/** Find a code cell index by td_node_id; returns -1 if not found. */
export async function findCellByNodeId(
  nodeId: string,
  nbPath = DEFAULT_NOTEBOOK_PATH
): Promise<number> {
  await ensureNotebook(nbPath);
  const nb = await loadNotebook(nbPath);
  return (nb.cells || []).findIndex(
    (c: any) => c?.cell_type === "code" && (c?.metadata?.td_node_id === nodeId)
  );
}

/** Poll notebook every `ms` and call back with current cells. Returns a stop() function. */
export function watchNotebook(
  onCells: (cells: TdCell[]) => void,
  { nbPath = DEFAULT_NOTEBOOK_PATH, ms = 300 }: { nbPath?: string; ms?: number } = {}
): () => void {
  let timer: any = null;
  let lastSig = "";

  const tick = async () => {
    try {
      const cells = await listTdCells(nbPath);
      const sig = JSON.stringify(
        cells.map((c) => ({ i: c.index, id: c.id, fn: c.fn, p: c.params, s: c.source.slice(0, 140) }))
      );
      if (sig !== lastSig) {
        lastSig = sig;
        onCells(cells);
      }
    } catch {
      // swallow transient errors
    } finally {
      timer = setTimeout(tick, ms);
    }
  };

  tick();
  return () => timer && clearTimeout(timer);
}

/** Used by UI to force iframe reload if needed. */
export function nextIframeBuster(): string {
  return String(Date.now());
}
