// src/pages/DataSciencePipelinePage.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlowProvider,
  useNodesState,
  useEdgesState,
  type NodeChange,
  type Edge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import yaml from "yaml";
import { Database, Settings, Wand2, Loader2, Save, Play } from "lucide-react";

import NotebookPanel from "@/components/NotebookPanel";
import { TableModal } from "@/components/TableModal";
import { PipelineFlow } from "@/components/PipelineFlow";
import { FunctionSearch } from "@/components/FunctionSearch";
import { ParameterSelector } from "@/components/ParameterSelector";
import { StepReviewModal } from "@/components/StepReviewModal";
import { NodeYamlModal } from "@/components/NodeYamlModal";

import { getSelectedFile, onSelectedFile } from "@/lib/files";
import { authFetch, getToken } from "@/lib/auth";
import * as NB from "@/lib/notebookBridge";

const API_BASE = (import.meta.env.VITE_API_BASE as string) || "/api";

/* -------------------- helpers -------------------- */
function shortName(full: string) {
  const parts = (full || "").split(".");
  return parts[parts.length - 1] || full;
}
function canonicalizeFuncName(fn: string) {
  if (!fn) return fn;
  return fn.replace(/^pandas\./, "").replace(/^numpy\./, "");
}
function safeParse<T = any>(text: string): T {
  try { return (yaml.parse(text) as T) || ({} as T); }
  catch { return {} as T; }
}
function stringify(obj: any) {
  try { return yaml.stringify(obj); }
  catch { return "nodes: {}"; }
}
function isReadFn(fn: string) {
  const base = canonicalizeFuncName(fn).split(".").pop() || "";
  return base.startsWith("read_") || [
    "read_csv","read_json","read_excel","read_parquet","read_feather",
    "read_pickle","read_html","read_xml","read_table",
  ].includes(base);
}
function canonicalizeReadParams(fn: string, params: Record<string, any> = {}) {
  if (!isReadFn(fn)) return params;
  const p: Record<string, any> = { ...params };
  const aliases = ["filepath_or_buffer","filepath","file_path","path","path_or_buf","io"];
  let val = p.filepath_or_buffer;
  if (val == null) for (const k of aliases) if (k !== "filepath_or_buffer" && p[k] != null) { val = p[k]; break; }
  for (const k of aliases) if (k !== "filepath_or_buffer" && k in p) delete p[k];
  if (val != null) p.filepath_or_buffer = val;
  return p;
}
function needsReceiver(fn: string) { return canonicalizeFuncName(fn).startsWith("DataFrame."); }

/* -------------------- main page -------------------- */

function DataSciencePipelineInner() {
  const [nodes, setNodes, onNodesChangeBase] = useNodesState<any>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [yamlText, setYamlText] = useState("nodes: {}");

  const [pipelineName, setPipelineName] = useState("");
  const [saving, setSaving] = useState(false);

  const [selectedFile, setSelectedFile] = useState<File | null>(getSelectedFile());

  const [tableModal, setTableModal] = useState<{ open: boolean; table: any | null }>({
    open: false, table: null,
  });

  const [paramModal, setParamModal] = useState<{
    open: boolean; nodeId: string | null; funcDef: any | null;
    params: Record<string, any>; dependencies: string[];
  }>({ open: false, nodeId: null, funcDef: null, params: {}, dependencies: [] });

  // YAML drawer (double-click)
  const [yamlModal, setYamlModal] = useState<{ open: boolean; nodeId: string | null }>({ open: false, nodeId: null });

  // Step-through (OK → next)
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewOrder, setReviewOrder] = useState<string[]>([]);
  const [reviewIndex, setReviewIndex] = useState(0);

  const [nlPrompt, setNlPrompt] = useState("");
  const [genBusy, setGenBusy] = useState(false);

  const stopWatchRef = useRef<null | (() => void)>(null);
  const lastSigRef = useRef<string>("");
  const isProgrammaticUpdateRef = useRef<boolean>(false);

  // global file bus
  useEffect(() => {
    setSelectedFile(getSelectedFile());
    const off = onSelectedFile((f) => setSelectedFile(f));
    return off;
  }, []);

  // Real-time notebook → flow (use YOUR existing watcher)
  useEffect(() => {
    if (stopWatchRef.current) stopWatchRef.current();
    stopWatchRef.current = NB.watchNotebook(
      (cells) => {
        if (isProgrammaticUpdateRef.current) return;
        applyNotebookCellsToFlow(cells);
      },
      { nbPath: NB.DEFAULT_NOTEBOOK_PATH, ms: 150 }
    );
    return () => { stopWatchRef.current?.(); stopWatchRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function nodeStyle(): React.CSSProperties {
    return {
      background: "hsl(var(--card))",
      border: "2px solid hsl(var(--primary))",
      borderRadius: "12px",
      minWidth: "220px",
      minHeight: "64px",
      padding: "8px",
      boxShadow: "0 4px 20px hsl(var(--primary) / 0.3)",
    };
  }

  function upsertYamlNode(id: string, fn: string, params: Record<string, any>, deps: string[]) {
    const parsed: any = safeParse<any>(yamlText);
    if (!parsed.nodes) parsed.nodes = {};
    parsed.nodes[id] = {
      function: canonicalizeFuncName(fn),
      params: isReadFn(fn) ? canonicalizeReadParams(fn, params) : params,
      dependencies: deps || [],
    };
    setYamlText(stringify(parsed));
  }

  function makeLabel(id: string, labelFn: string, isPython: boolean) {
    // prevent ReactFlow drag from swallowing the click on the gear
    const stopAll = (e: React.SyntheticEvent) => {
      e.stopPropagation();
      // @ts-ignore
      if (e.nativeEvent?.stopImmediatePropagation) e.nativeEvent.stopImmediatePropagation();
    };

    return (
      <div
        className="flex items-center gap-2 px-3 py-2"
        onMouseDown={stopAll}
        onPointerDown={stopAll}
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
      >
        <div className="p-1 rounded bg-primary/20"><Database className="w-3 h-3 text-primary" /></div>
        <span className="flex-1 truncate">{isPython ? `${id} · python` : `${id} · ${labelFn}`}</span>
        {!isPython && (
          <button
            type="button"
            draggable={false}
            className="p-1 rounded bg-secondary/20 hover:bg-secondary/30"
            title="Edit Parameters"
            onMouseDown={stopAll}
            onPointerDown={stopAll}
            onClick={(e) => { e.stopPropagation(); openParamEditorFromYaml(id); }}
            onDoubleClick={(e) => e.stopPropagation()}
          >
            <Settings className="w-3 h-3 text-secondary" />
          </button>
        )}
      </div>
    );
  }

  /* ---------- notebook → YAML + Flow + EDGES ---------- */
  function applyNotebookCellsToFlow(
    cells: Array<{ index: number; source: string; id?: string; fn?: string; params?: any; cell_type?: string; metadata?: any }>
  ) {
    const sig = JSON.stringify(
      cells
        .filter((c) => !c.cell_type || c.cell_type === "code")
        .map((c) => ({
          i: c.index,
          id: c.id || `cell_${(c.index ?? 0) + 1}`,
          fn: canonicalizeFuncName(c.fn || "python"),
          p: c.params || null,
          s: (c.source || "").slice(0, 120),
        }))
    );
    if (sig === lastSigRef.current) return;
    lastSigRef.current = sig;

    const nextYamlNodes: Record<string, any> = {};
    const nextFlowNodes: any[] = [];
    const order: string[] = [];

    const posMap = new Map(nodes.map((n) => [n.id, n.position]));

    const codeCells = cells.filter((c) => !c.cell_type || c.cell_type === "code");
    codeCells.forEach((c, idx) => {
      const nid = c.id || `cell_${(c.index ?? idx) + 1}`;
      const fnCanon = canonicalizeFuncName(c.fn || "python");
      const isPython = fnCanon === "python";
      const params = isPython ? { code: c.source || "" } : (c.params || {});
      const cleanParams = isReadFn(fnCanon) ? canonicalizeReadParams(fnCanon, params) : params;

      order.push(nid);
      nextYamlNodes[nid] = { function: fnCanon, params: cleanParams, dependencies: [] };
      const oldPos = posMap.get(nid);
      const fallbackPos = { x: 240 + ((idx % 2) * 280), y: 80 + idx * 110 };
      nextFlowNodes.push({
        id: nid,
        data: { label: makeLabel(nid, isPython ? "python" : shortName(fnCanon), isPython) },
        position: oldPos ?? fallbackPos,
        style: nodeStyle(),
      });
    });

    const nextEdges: Edge[] = [];
    for (let i = 1; i < order.length; i++) {
      nextEdges.push({
        id: `${order[i - 1]}->${order[i]}`,
        source: order[i - 1],
        target: order[i],
        animated: true,
        style: { stroke: "hsl(var(--primary))", strokeWidth: 3 },
        type: "smoothstep",
      });
    }

    setYamlText(stringify({ nodes: nextYamlNodes }));
    setNodes(nextFlowNodes);
    setEdges(nextEdges);
    setReviewOrder(order);
  }

  /* -------------------- gear → Parameter selector -------------------- */
  async function openParamEditorFromYaml(nodeId: string) {
    const spec: any = safeParse<any>(yamlText);
    let entry = spec?.nodes?.[nodeId];

    // Fallback: consult notebook if YAML isn't ready yet
    if (!entry) {
      try {
        const cells = await NB.listTdCells(NB.DEFAULT_NOTEBOOK_PATH);
        const hit = cells.find((c) => c.id === nodeId);
        if (hit?.fn) {
          entry = { function: hit.fn, params: hit.params ?? {}, dependencies: [] };
        }
      } catch { /* ignore */ }
    }

    if (!entry) return;

    const canon = canonicalizeFuncName(entry.function);

    if (canon === "python") {
      setParamModal({
        open: true, nodeId,
        funcDef: { name: "python", params: [{ name: "code", required: true }] },
        params: { code: entry?.params?.code ?? "" },
        dependencies: entry.dependencies || [],
      });
      return;
    }

    fetch(`${API_BASE}/pandas/function/${encodeURIComponent(canon)}`, { mode: "cors" })
      .then((r) => r.json())
      .then((funcDef) => {
        const initial = isReadFn(canon)
          ? canonicalizeReadParams(canon, entry.params || {})
          : (entry.params || {});
        setParamModal({
          open: true, nodeId, funcDef: { ...funcDef, name: canon },
          params: initial, dependencies: entry.dependencies || [],
        });
      })
      .catch(() => {
        setParamModal({
          open: true, nodeId, funcDef: { name: canon, params: [] },
          params: isReadFn(canon) ? canonicalizeReadParams(canon, entry.params || {}) : (entry.params || {}),
          dependencies: entry.dependencies || [],
        });
      });
  }

  /* -------------------- Add Function -------------------- */
  function addFunctionNode(func: any) {
    setParamModal({ open: true, nodeId: null, funcDef: func, params: {}, dependencies: [] });
  }

  async function syncOneCell(id: string, fnCanon: string, params: Record<string, any>) {
    try { await NB.upsertCellForNode?.(id, { name: fnCanon }, params, NB.DEFAULT_NOTEBOOK_PATH); }
    catch (e) { console.warn("[notebook] upsertCellForNode failed", e); }
  }

  function createNodeWithParams(func: any, selectedParams: Record<string, any>) {
    const spec: any = safeParse<any>(yamlText);
    const count = Object.keys(spec?.nodes || {}).length;
    const id = `${shortName(func.name)}_${count}`;

    const fnCanon = canonicalizeFuncName(func.name);
    const deps: string[] = [];

    if (needsReceiver(fnCanon)) {
      const last = nodes[nodes.length - 1]?.id;
      if (last && !selectedParams.self && !selectedParams.df && !selectedParams.left) {
        selectedParams.self = last; deps.push(last);
      }
    }

    if (isReadFn(fnCanon)) {
      selectedParams = canonicalizeReadParams(fnCanon, selectedParams);
      if (selectedParams.filepath_or_buffer == null && selectedFile) {
        selectedParams.filepath_or_buffer = selectedFile.name;
      }
    }

    upsertYamlNode(id, fnCanon, selectedParams, deps);
    syncOneCell(id, fnCanon, selectedParams);
  }

  function handleApplyParams(newParams: Record<string, any>) {
    const { nodeId, funcDef, dependencies } = paramModal;
    if (!nodeId) {
      createNodeWithParams(funcDef, newParams);
    } else {
      const fnCanon = canonicalizeFuncName(funcDef.name);
      if (fnCanon === "python") {
        const spec: any = safeParse<any>(yamlText);
        if (!spec.nodes) spec.nodes = {};
        spec.nodes[nodeId] = {
          function: "python",
          params: { code: newParams?.code ?? "" },
          dependencies: dependencies || [],
        };
        setYamlText(stringify(spec));
      } else {
        const cleanParams = isReadFn(fnCanon) ? canonicalizeReadParams(fnCanon, newParams) : newParams;
        upsertYamlNode(nodeId, fnCanon, cleanParams, dependencies || []);
        syncOneCell(nodeId, fnCanon, cleanParams);
      }
    }
    setParamModal({ open: false, nodeId: null, funcDef: null, params: {}, dependencies: [] });
  }

  /* 🔧 FLOW → NOTEBOOK with watcher pause (delete box = delete cell) */
  async function onNodesChange(changes: NodeChange[]) {
    onNodesChangeBase(changes);

    const removed = changes.filter((c) => c.type === "remove").map((c: any) => c.id);
    if (removed.length === 0) return;

    isProgrammaticUpdateRef.current = true;

    try {
      // Update YAML to drop nodes + references
      const parsed: any = safeParse<any>(yamlText);
      if (parsed.nodes) {
        removed.forEach((id) => {
          delete parsed.nodes[id];
          Object.values(parsed.nodes).forEach((n: any) => {
            if (Array.isArray(n.dependencies)) n.dependencies = n.dependencies.filter((d: string) => d !== id);
            if (n.params) ["self","df","left","right"].forEach((k) => { if ((n.params as any)[k] === id) delete (n.params as any)[k]; });
          });
        });
        setYamlText(stringify(parsed));
      }

      // Delete corresponding cells (now reliable thanks to auto-tagging)
      await NB.deleteCellsForNodeIds(removed, NB.DEFAULT_NOTEBOOK_PATH);
      await new Promise((r) => setTimeout(r, 250));
    } catch (e) {
      console.warn("[notebook] deleteCellsForNodeIds failed", e);
    } finally {
      isProgrammaticUpdateRef.current = false;
    }
  }

  /* 👉 double-click: OPEN YAML drawer for ANY node */
  function handleNodeDoubleClick(e: any, node: any) {
    e?.stopPropagation?.();
    setYamlModal({ open: true, nodeId: node.id });
  }

  // YAML drawer → Apply → update YAML + notebook cell
  const yamlEntryFor = (nodeId: string) => {
    const spec: any = safeParse<any>(yamlText);
    const entry = spec?.nodes?.[nodeId] || null;
    return entry ? { function: entry.function, params: entry.params || {}, dependencies: entry.dependencies || [] } : null;
  };

  async function applyNodeYaml(nodeId: string, next: { function: string; params?: any; dependencies?: string[] }) {
    const spec: any = safeParse<any>(yamlText);
    spec.nodes = spec.nodes || {};
    const fnCanon = canonicalizeFuncName(next.function);
    const cleanParams = isReadFn(fnCanon) ? canonicalizeReadParams(fnCanon, next.params || {}) : (next.params || {});
    spec.nodes[nodeId] = { function: fnCanon, params: cleanParams, dependencies: next.dependencies || [] };
    setYamlText(stringify(spec));
    await syncOneCell(nodeId, fnCanon, cleanParams);
  }

  async function runPipeline() {
    if (nodes.length === 0) { alert("Add at least one node first."); return; }
    const last = nodes[nodes.length - 1];
    const fd = new FormData();
    fd.append("yaml", yamlText);
    fd.append("preview_node", last.id);
    if (selectedFile) fd.append("file", selectedFile, selectedFile.name);

    try {
      const res = await fetch(`${API_BASE}/pipeline/run`, { method: "POST", body: fd, mode: "cors" });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
      const data = await res.json();
      setTableModal({
        open: true,
        table: { columns: Array.isArray(data?.columns) ? data.columns : [], data: Array.isArray(data?.rows) ? data.rows.slice(0, 200) : [] },
      });
    } catch (err: any) {
      alert(String(err?.message || err || "Unknown error"));
    }
  }

  /* -------- SAVE PIPELINE (DB) -------- */
  async function savePipeline() {
    if (!pipelineName.trim()) { alert("Please enter a pipeline name before saving."); return; }
    if (!getToken()) { alert("Please log in to save pipelines."); return; }
    setSaving(true);
    try {
      const body = { name: pipelineName.trim(), yaml: yamlText };
      const res = await authFetch<{ id: string; name: string; yaml: string }>("/pipelines/save", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      });
      alert(`Saved pipeline: ${res.name || pipelineName}`);
    } catch (e: any) {
      alert(String(e?.message || e));
    } finally { setSaving(false); }
  }

  /* --------------- NL → YAML --------------- */
  async function generateFromPrompt() {
    if (!nlPrompt.trim()) return;
    setGenBusy(true);
    try {
      const cur: any = safeParse<any>(yamlText);
      const orderedIds = Object.keys(cur?.nodes || {});
      const receiver = orderedIds.length ? orderedIds[orderedIds.length - 1] : "";

      const fd = new FormData();
      fd.append("prompt", nlPrompt);
      fd.append("yaml", yamlText);
      fd.append("yaml_text", yamlText);
      fd.append("current_yaml", yamlText);
      if (receiver) fd.append("receiver", receiver);
      fd.append("mode", "append");

      const res = await fetch(`${API_BASE}/nl2yaml`, { method: "POST", body: fd, mode: "cors" });
      if (!res.ok) throw new Error(`NL2YAML HTTP ${res.status}: ${await res.text()}`);

      const data = await res.json();
      const addSpec = data?.spec || safeParse<any>(data?.yaml || "");
      const newNodes: Record<string, any> = (addSpec?.nodes || {}) as Record<string, any>;

      for (const [id, node] of Object.entries(newNodes)) {
        const fnCanon = canonicalizeFuncName((node as any).function || "");
        const params = isReadFn(fnCanon)
          ? canonicalizeReadParams(fnCanon, (node as any).params || {})
          : (node as any).params || {};
        const deps = Array.isArray((node as any).dependencies) ? (node as any).dependencies : [];
        upsertYamlNode(id, fnCanon, params, deps);
        await NB.upsertCellForNode?.(id, { name: fnCanon }, params, NB.DEFAULT_NOTEBOOK_PATH);
      }
    } catch (e: any) {
      alert(String(e?.message || e));
    } finally {
      setGenBusy(false);
    }
  }

  /* --------------------------- RENDER --------------------------- */

  const yamlEntry = useMemo(() => {
    if (!yamlModal.nodeId) return null;
    return yamlEntryFor(yamlModal.nodeId);
  }, [yamlModal, yamlText]);

  return (
    <div className="pipeline-container">
      <div className="container mx-auto p-6">
        {/* Left: Notebook | Right: Flow */}
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 h-[80vh]">
          {/* LEFT: NOTEBOOK */}
          <div className="flex flex-col min-h-0">
            <NotebookPanel />
          </div>

          {/* RIGHT: FLOW + TOOLBAR */}
          <div className="pipeline-panel flex flex-col">
            <div className="p-6 border-b border-border/50">
              <div className="flex flex-col gap-3">
                <div className="flex items-center gap-2">
                  <input
                    className="pipeline-input w-full"
                    placeholder="Untitled pipeline"
                    value={pipelineName}
                    onChange={(e) => setPipelineName(e.target.value)}
                  />
                  <button onClick={savePipeline} disabled={saving} className="pipeline-button flex items-center gap-2" title="Save pipeline">
                    <Save className="w-4 h-4" /> Save
                  </button>
                  <button onClick={runPipeline} className="pipeline-button flex items-center gap-2" title="Run preview from last node">
                    <Play className="w-4 h-4" /> Run
                  </button>
                </div>

                {/* Add Function (search only) */}
                <div className="flex items-center gap-3">
                  <FunctionSearch onSelectFunction={addFunctionNode} />
                </div>

                {/* NL → YAML prompt */}
                <div className="flex items-stretch gap-2">
                  <div className="relative flex-1">
                    <Wand2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <input
                      className="pipeline-input pl-9 w-full"
                      placeholder='e.g., "Load check.csv, rename REDHILLS -> RED, select rows 1:10"'
                      value={nlPrompt}
                      onChange={(e) => setNlPrompt(e.target.value)}
                      onKeyDown={(e) => { if (e.key === "Enter") generateFromPrompt(); }}
                    />
                  </div>
                  <button
                    onClick={generateFromPrompt}
                    disabled={genBusy || !nlPrompt.trim()}
                    className="pipeline-button flex items-center gap-2 disabled:opacity-60"
                    title="Let AI generate/append YAML steps"
                  >
                    {genBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Wand2 className="w-4 h-4" />}
                    Generate
                  </button>

                  <button
                    className="pipeline-button-secondary"
                    onClick={() => {
                      const order = Object.keys(safeParse<any>(yamlText)?.nodes || {});
                      setReviewOrder(order);
                      setReviewIndex(0);
                      setReviewOpen(true);
                    }}
                    title="Review cells one by one"
                  >
                    Review
                  </button>
                </div>
              </div>
            </div>

            <div className="flex-1 p-6 min-h-0">
              <PipelineFlow
                nodes={nodes}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onNodeDoubleClick={handleNodeDoubleClick}
              />
            </div>
          </div>
        </div>
      </div>

      <ParameterSelector
        key={paramModal.nodeId || "new"}
        open={paramModal.open}
        onClose={() => setParamModal({ ...paramModal, open: false })}
        funcDef={paramModal.funcDef}
        initialParams={paramModal.params}
        onApply={handleApplyParams}
      />

      <NodeYamlModal
        open={yamlModal.open}
        nodeId={yamlModal.nodeId}
        entry={yamlEntry}
        onClose={() => setYamlModal({ open: false, nodeId: null })}
        onApply={applyNodeYaml}
        onRunPreview={async (nid) => {
          const fd = new FormData();
          fd.append("yaml", yamlText);
          fd.append("preview_node", nid);
          if (selectedFile) fd.append("file", selectedFile, selectedFile.name);
          try {
            const res = await fetch(`${API_BASE}/pipeline/run`, { method: "POST", body: fd, mode: "cors" });
            if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
            const data = await res.json();
            setTableModal({ open: true, table: {
              columns: Array.isArray(data?.columns) ? data.columns : [],
              data: Array.isArray(data?.rows) ? data.rows.slice(0, 200) : [],
            }});
          } catch (e: any) { alert(String(e?.message || e)); }
        }}
      />

      <TableModal
        open={tableModal.open}
        onClose={() => setTableModal({ open: false, table: null })}
        table={tableModal.table}
      />

      <StepReviewModal
        open={reviewOpen}
        onClose={() => setReviewOpen(false)}
        yamlText={yamlText}
        order={reviewOrder}
        index={reviewIndex}
        onIndexChange={setReviewIndex}
        onEditNode={(id) => { setYamlModal({ open: true, nodeId: id }); }}
      />
    </div>
  );
}

export default function DataSciencePipelinePage() {
  return (
    <ReactFlowProvider>
      <DataSciencePipelineInner />
    </ReactFlowProvider>
  );
}
