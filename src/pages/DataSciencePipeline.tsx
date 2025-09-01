// src/pages/DataSciencePipeline.tsx
import React, { useState, useEffect } from "react";
import { useNodesState, useEdgesState, NodeChange } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import yaml from "yaml";
import { Database, Settings, Wand2, Loader2 } from "lucide-react";

import { TableModal } from "@/components/TableModal";
import { PipelineFlow } from "@/components/PipelineFlow";
import { YamlEditor } from "@/components/YamlEditor";
import { FunctionSearch } from "@/components/FunctionSearch";
import { ParameterSelector } from "@/components/ParameterSelector";

// use the global file bus so the file chosen in "Data Sources" is available here
import { getSelectedFile, onSelectedFile } from "@/lib/files";
import { authFetch, getToken } from "@/lib/auth";

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

function safeParseYaml<T = any>(text: string): T {
  try {
    return (yaml.parse(text) as T) || ({} as T);
  } catch {
    return {} as T;
  }
}

function stringifyYaml(obj: any) {
  try {
    return yaml.stringify(obj);
  } catch {
    return "nodes: {}";
  }
}

function makeUniqueId(base: string, taken: Set<string>) {
  if (!taken.has(base)) return base;
  let i = 1;
  while (taken.has(`${base}_${i}`)) i++;
  return `${base}_${i}`;
}

function rewriteRefs(obj: any, fromId: string, toId: string) {
  if (obj == null) return obj;
  if (typeof obj === "string") return obj === fromId ? toId : obj;
  if (Array.isArray(obj)) return obj.map((v) => rewriteRefs(v, fromId, toId));
  if (typeof obj === "object") {
    const out: any = {};
    for (const [k, v] of Object.entries(obj)) {
      out[k] = rewriteRefs(v, fromId, toId);
    }
    return out;
  }
  return obj;
}

/** read_* canonicalization:
 *  - ensure ONLY `filepath_or_buffer` exists (remove aliases)
 *  - fill from the first present alias if canonical missing
 */
const READ_FN_SET = new Set([
  "read_csv",
  "read_json",
  "read_excel",
  "read_parquet",
  "read_feather",
  "read_pickle",
  "read_html",
  "read_xml",
  "read_table",
]);
const READ_ALIASES = ["filepath_or_buffer", "filepath", "file_path", "path", "path_or_buf", "io"];

function isReadFn(fn: string) {
  const base = canonicalizeFuncName(fn).split(".").pop() || "";
  return base.startsWith("read_") || READ_FN_SET.has(base);
}

function canonicalizeReadParams(fn: string, params: Record<string, any> = {}) {
  if (!isReadFn(fn)) return params;
  const p: Record<string, any> = { ...params };

  // Resolve value
  let val = p.filepath_or_buffer;
  if (val == null) {
    for (const k of READ_ALIASES) {
      if (k !== "filepath_or_buffer" && p[k] != null) {
        val = p[k];
        break;
      }
    }
  }

  // Remove all aliases
  for (const k of READ_ALIASES) {
    if (k !== "filepath_or_buffer" && k in p) delete p[k];
  }

  // Set canonical if present
  if (val != null) p.filepath_or_buffer = val;

  return p;
}

function needsReceiver(fn: string) {
  // Heuristic: any DataFrame.* method requires a receiver (“self”)
  return canonicalizeFuncName(fn).startsWith("DataFrame.");
}

/** If a DataFrame.* node lacks `self`, add the most obvious one:
 *  1) last dependency if given
 *  2) otherwise the immediately previous node in spec order
 */
function autoWireReceiverForNode(
  spec: any,
  id: string,
  idxInOrder: number,
  orderedIds: string[]
) {
  const node = spec.nodes[id] || {};
  const fn = canonicalizeFuncName(node.function || "");
  node.function = fn;

  // canonicalize all read_* params (only keep filepath_or_buffer)
  if (isReadFn(fn)) {
    node.params = canonicalizeReadParams(fn, node.params || {});
  }

  if (!needsReceiver(fn)) {
    spec.nodes[id] = node;
    return;
  }

  const params = node.params || {};
  if (params.self) {
    spec.nodes[id] = node;
    return; // already wired
  }

  const deps: string[] = Array.isArray(node.dependencies) ? node.dependencies : [];
  const candidate = deps[deps.length - 1] || orderedIds[idxInOrder - 1];

  if (candidate) {
    node.params = { ...params, self: candidate };
    if (!deps.includes(candidate)) {
      node.dependencies = [...deps, candidate];
    }
  }

  // write back
  spec.nodes[id] = node;
}

/** Normalize a YAML spec after an NL→YAML merge or manual paste. */
function normalizeSpec(spec: any) {
  if (!spec || !spec.nodes) return spec;
  const ids = Object.keys(spec.nodes);
  ids.forEach((id, i) => autoWireReceiverForNode(spec, id, i, ids));
  return spec;
}

/* -------------------- main -------------------- */

export default function DataSciencePipelinePage() {
  const [nodes, setNodes, onNodesChangeBase] = useNodesState([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);
  const [yamlText, setYamlText] = useState("nodes: {}");

  // NEW: Pipeline name + save state
  const [pipelineName, setPipelineName] = useState("");
  const [saving, setSaving] = useState(false);

  // File is supplied by the Data Sources page via global bus
  const [selectedFile, setSelectedFile] = useState<File | null>(getSelectedFile());

  const [preloaded, setPreloaded] = useState<any[]>([]);
  const [tableModal, setTableModal] = useState<{ open: boolean; table: any | null }>({
    open: false,
    table: null,
  });
  const [paramModal, setParamModal] = useState<{
    open: boolean;
    nodeId: string | null;
    funcDef: any | null;
    params: Record<string, any>;
    dependencies: string[];
  }>({
    open: false,
    nodeId: null,
    funcDef: null,
    params: {},
    dependencies: [],
  });

  // NL → YAML prompt UI state
  const [nlPrompt, setNlPrompt] = useState("");
  const [genBusy, setGenBusy] = useState(false);

  // Subscribe to file bus
  useEffect(() => {
    setSelectedFile(getSelectedFile());
    const off = onSelectedFile((f) => setSelectedFile(f));
    return off;
  }, []);
  
  useEffect(() => { //from gpt
    try {
      const raw = localStorage.getItem("td_open_pipeline");
      if (!raw) return;
      const data = JSON.parse(raw);
      if (data?.yaml) setYamlText(data.yaml);
    } finally {
      localStorage.removeItem("td_open_pipeline");
    }
  }, []);
  


  // preload some pandas funcs (so we can auto-add read_csv)
  useEffect(() => {
    fetch(`${API_BASE}/pandas/search?query=read_`)
      .then((r) => r.json())
      .then((d) => Array.isArray(d?.functions) && setPreloaded(d.functions))
      .catch(() => {});
  }, []);

  // Auto-add read_csv when a file is chosen and there are no nodes yet
  useEffect(() => {
    if (selectedFile && nodes.length === 0) {
      const readCsv = preloaded.find((f: any) => shortName(f.name) === "read_csv");
      if (readCsv) {
        createNodeWithParams(readCsv, { filepath_or_buffer: selectedFile.name });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedFile, preloaded]);

  function nodeStyle() {
    return {
      background: "hsl(var(--card))",
      border: "2px solid hsl(var(--primary))",
      borderRadius: "12px",
      minWidth: "180px",
      minHeight: "60px",
      padding: "8px",
      boxShadow: "0 4px 20px hsl(var(--primary) / 0.3)",
    } as React.CSSProperties;
  }

  function addFunctionNode(func: any) {
    setParamModal({
      open: true,
      nodeId: null,
      funcDef: func,
      params: {},
      dependencies: [],
    });
  }

  function openParamEditorFromYaml(nodeId: string) {
    const spec = safeParseYaml<any>(yamlText);
    const entry = spec?.nodes?.[nodeId];
    if (!entry) return;

    const canon = canonicalizeFuncName(entry.function);

    fetch(`${API_BASE}/pandas/function/${encodeURIComponent(canon)}`)
      .then((r) => r.json())
      .then((funcDef) => {
        // canonicalize read_* params so the modal shows ONLY filepath_or_buffer
        const initial = isReadFn(canon)
          ? canonicalizeReadParams(canon, entry.params || {})
          : (entry.params || {});
        setParamModal({
          open: true,
          nodeId,
          funcDef: { ...funcDef, name: canon },
          params: initial,
          dependencies: entry.dependencies || [],
        });
      })
      .catch(() => {
        setParamModal({
          open: true,
          nodeId,
          funcDef: { name: canon, params: [] },
          params: isReadFn(canon) ? canonicalizeReadParams(canon, entry.params || {}) : (entry.params || {}),
          dependencies: entry.dependencies || [],
        });
      });
  }

  function createNodeWithParams(func: any, selectedParams: Record<string, any>) {
    const id = `${shortName(func.name)}_${Object.keys(safeParseYaml<any>(yamlText).nodes || {}).length}`;
    let dependencies: string[] = [];

    // wire to previous if function needs a receiver and user didn’t pick one
    const fnCanon = canonicalizeFuncName(func.name);
    if (needsReceiver(fnCanon) && nodes.length > 0) {
      const prev = nodes[nodes.length - 1].id;
      if (!selectedParams.self && !selectedParams.df && !selectedParams.left) {
        selectedParams.self = prev;
        dependencies = [prev];
      }
    }

    // auto-fill filename for read_* if available (from global bus)
    if (selectedFile && isReadFn(fnCanon)) {
      selectedParams = canonicalizeReadParams(fnCanon, selectedParams);
      if (selectedParams.filepath_or_buffer == null) {
        selectedParams.filepath_or_buffer = selectedFile.name;
      }
    } else if (isReadFn(fnCanon)) {
      // still canonicalize even without selected file
      selectedParams = canonicalizeReadParams(fnCanon, selectedParams);
    }

    // visual node
    setNodes((n) => [
      ...n,
      {
        id,
        data: {
          label: (
            <div className="flex items-center gap-2 px-3 py-2">
              <div className="p-1 rounded bg-primary/20">
                <Database className="w-3 h-3 text-primary" />
              </div>
              <span className="flex-1 truncate">{shortName(fnCanon)}</span>
              <button
                className="p-1 rounded bg-secondary/20 hover:bg-secondary/30"
                onClick={(e) => {
                  e.stopPropagation();
                  setParamModal({
                    open: true,
                    nodeId: id,
                    funcDef: { ...func, name: fnCanon },
                    params: selectedParams,
                    dependencies,
                  });
                }}
                title="Edit Parameters"
              >
                <Settings className="w-3 h-3 text-secondary" />
              </button>
            </div>
          ),
        },
        position: { x: 220 + Math.random() * 100, y: 90 + 90 * nodes.length },
        style: nodeStyle(),
      },
    ]);

    // YAML update
    const parsed = safeParseYaml<any>(yamlText);
    if (!parsed.nodes) parsed.nodes = {};
    parsed.nodes[id] = { function: fnCanon, params: selectedParams, dependencies };
    setYamlText(stringifyYaml(parsed));
  }

  /* --------- sync visual nodes from YAML (for NL->YAML or manual edits) --------- */
  function syncNodesFromYaml() {
    const spec = safeParseYaml<any>(yamlText);
    const yNodes: Record<string, any> = spec?.nodes || {};
    const known = new Set(nodes.map((n) => n.id));
    const toAdd: any[] = [];

    let i = nodes.length;
    for (const [id, value] of Object.entries(yNodes)) {
      if (known.has(id)) continue;
      const funcName = canonicalizeFuncName((value as any)?.function ?? id);
      const label = (
        <div className="flex items-center gap-2 px-3 py-2">
          <div className="p-1 rounded bg-primary/20">
            <Database className="w-3 h-3 text-primary" />
          </div>
          <span className="flex-1 truncate">{shortName(funcName)}</span>
          <button
            className="p-1 rounded bg-secondary/20 hover:bg-secondary/30"
            onClick={(e) => {
              e.stopPropagation();
              openParamEditorFromYaml(id);
            }}
            title="Edit Parameters"
          >
            <Settings className="w-3 h-3 text-secondary" />
          </button>
        </div>
      );

      const dep = Array.isArray((value as any).dependencies) && (value as any).dependencies[0];
      const depNode = nodes.find((n) => n.id === dep);
      const baseX = depNode ? (depNode?.position?.x || 200) + 200 : 220 + Math.random() * 100;
      const baseY = depNode ? depNode?.position?.y || 80 : 90 + 90 * i;

      toAdd.push({
        id,
        data: { label },
        position: { x: baseX, y: baseY + (i % 5) * 12 },
        style: nodeStyle(),
      });
      i++;
    }

    if (toAdd.length) setNodes((n) => [...n, ...toAdd]);
  }

  /* --------- EDGE SYNC ---------- */
  useEffect(() => {
    const parsed = safeParseYaml<any>(yamlText);
    const newEdges: any[] = [];
    const nodeMap: Record<string, any> = parsed.nodes || {};
    const nodeIds = new Set(Object.keys(nodeMap));

    const collectRefs = (val: any, acc: Set<string>) => {
      if (!val) return;
      const t = typeof val;
      if (t === "string") {
        if (nodeIds.has(val)) acc.add(val);
      } else if (Array.isArray(val)) {
        val.forEach((v) => collectRefs(v, acc));
      } else if (t === "object") {
        for (const v of Object.values(val)) collectRefs(v, acc);
      }
    };

    if (nodeMap) {
      Object.entries(nodeMap).forEach(([id, value]: [string, any]) => {
        const edgesFrom = new Set<string>(Array.isArray(value?.dependencies) ? value.dependencies : []);
        const refs = new Set<string>();
        collectRefs(value?.params, refs);
        refs.forEach((r) => edgesFrom.add(r));

        edgesFrom.forEach((dep) => {
          if (!nodeIds.has(dep)) return;
          newEdges.push({
            id: `${dep}->${id}`,
            source: dep,
            target: id,
            animated: true,
            style: { stroke: "hsl(var(--primary))", strokeWidth: 3 },
            type: "smoothstep",
          });
        });
      });
    }
    setEdges(newEdges);
    syncNodesFromYaml();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [yamlText, nodes.length, setEdges]);

  /* 🔧 keep YAML in sync when nodes are removed */
  function onNodesChange(changes: NodeChange[]) {
    onNodesChangeBase(changes);

    const removed = changes.filter((c) => c.type === "remove").map((c: any) => c.id);
    if (removed.length === 0) return;

    const parsed = safeParseYaml<any>(yamlText);
    if (!parsed.nodes) return;

    removed.forEach((id) => {
      delete parsed.nodes[id];
      Object.values(parsed.nodes).forEach((n: any) => {
        if (Array.isArray(n.dependencies)) {
          n.dependencies = n.dependencies.filter((d: string) => d !== id);
        }
        if (n.params) {
          ["self", "df", "left", "right"].forEach((k) => {
            if (n.params[k] === id) delete n.params[k];
          });
        }
      });
    });

    setYamlText(stringifyYaml(parsed));
  }

  /* 👉 double-click: preview */
  async function handleNodeDoubleClick(e: any, node: any) {
    e?.stopPropagation?.();

    const fd = new FormData();
    fd.append("yaml", yamlText);
    fd.append("preview_node", node.id);
    // attach the globally-selected file if present
    if (selectedFile) fd.append("file", selectedFile, selectedFile.name);

    try {
      const res = await fetch(`${API_BASE}/pipeline/run`, { method: "POST", body: fd });

      if (!res.ok) {
        // If it's the classic "requires 'self'" complaint, open the editor so user can pick input
        let detail = "";
        try {
          const ct = res.headers.get("content-type") || "";
          if (ct.includes("application/json")) {
            const j = await res.json();
            detail = j?.detail || "";
          } else {
            detail = await res.text();
          }
        } catch {}

        if ((detail || "").includes("requires 'self'")) {
          openParamEditorFromYaml(node.id);
        }

        const msg = `HTTP ${res.status} while previewing "${node?.id}":\n` + (detail || "(no response body)");
        throw new Error(msg);
      }

      const data = await res.json();
      setTableModal({
        open: true,
        table: {
          columns: Array.isArray(data?.columns) ? data.columns : [],
          data: Array.isArray(data?.rows) ? data.rows.slice(0, 200) : [],
        },
      });
    } catch (err: any) {
      console.error("Preview error:", err);
      alert(String(err?.message || err || "Unknown error"));
    }
  }

  async function runPipeline() {
    if (nodes.length === 0) {
      alert("Add at least one node first.");
      return;
    }
    await handleNodeDoubleClick({ stopPropagation() {} } as any, nodes[nodes.length - 1]);
  }

  function handleApplyParams(newParams: Record<string, any>) {
    const { nodeId, funcDef, dependencies } = paramModal;

    if (!nodeId) {
      createNodeWithParams(funcDef, newParams);
    } else {
      const parsed = safeParseYaml<any>(yamlText);
      if (!parsed.nodes) parsed.nodes = {};

      // write normalized function name
      const fnCanon = canonicalizeFuncName(funcDef.name);
      const cleanParams = isReadFn(fnCanon)
        ? canonicalizeReadParams(fnCanon, newParams)
        : newParams;

      parsed.nodes[nodeId] = {
        function: fnCanon,
        params: cleanParams,
        dependencies: dependencies || [],
      };

      // Normalize (auto-wire) the spec so preview doesn’t fail
      normalizeSpec(parsed);

      setYamlText(stringifyYaml(parsed));
    }

    setParamModal({
      open: false,
      nodeId: null,
      funcDef: null,
      params: {},
      dependencies: [],
    });
  }

  /* --------- NL → YAML (generate & merge, then normalize) ---------- */
  async function generateFromPrompt() {
    if (!nlPrompt.trim()) return;
    setGenBusy(true);
    try {
      // find the "current" node to continue from
      const cur = safeParseYaml<any>(yamlText);
      const orderedIds = Object.keys(cur?.nodes || {});
      const receiver = orderedIds.length ? orderedIds[orderedIds.length - 1] : "";

      const fd = new FormData();
      fd.append("prompt", nlPrompt);

      // send all three names for backward/forward compat with the backend
      fd.append("yaml", yamlText);
      fd.append("yaml_text", yamlText);
      fd.append("current_yaml", yamlText);

      // tell backend which node to continue from
      if (receiver) fd.append("receiver", receiver);

      fd.append("mode", "append");

      const res = await fetch(`${API_BASE}/nl2yaml`, { method: "POST", body: fd });
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`NL2YAML HTTP ${res.status}: ${txt.slice(0, 400)}`);
      }

      const data = await res.json(); // { yaml, spec, mode }
      const addSpec = data?.spec || safeParseYaml<any>(data?.yaml || "");

      const curSpec = safeParseYaml<any>(yamlText);
      if (!curSpec.nodes) curSpec.nodes = {};
      const taken = new Set(Object.keys(curSpec.nodes));
      const newNodes: Record<string, any> = (addSpec?.nodes || {}) as Record<string, any>;

      // resolve id collisions but DO NOT create duplicates; we just keep unique ids
      const renameMap = new Map<string, string>();
      for (const id of Object.keys(newNodes)) {
        if (taken.has(id)) {
          // if exact duplicate node already exists, just skip adding it
          const existing = curSpec.nodes[id];
          const incoming = newNodes[id];
          if (
            existing &&
            existing.function === incoming.function &&
            JSON.stringify(existing.params || {}) === JSON.stringify(incoming.params || {})
          ) {
            continue;
          }
          // otherwise, make a unique id
          const uid = makeUniqueId(id, taken);
          renameMap.set(id, uid);
          taken.add(uid);
        } else {
          taken.add(id);
        }
      }

      const patched: Record<string, any> = {};
      for (const [id, node] of Object.entries(newNodes)) {
        const newId = renameMap.get(id) || id;
        const deps = Array.isArray((node as any).dependencies) ? (node as any).dependencies : [];
        const params = (node as any).params || {};

        const deps2 = deps.map((d: string) => renameMap.get(d) || d);

        let params2 = rewriteRefs(params, id, newId);
        for (const [oldId, newOne] of renameMap.entries()) {
          if (oldId !== id) params2 = rewriteRefs(params2, oldId, newOne);
        }

        const fnCanon = canonicalizeFuncName((node as any).function || "");
        const finalParams = isReadFn(fnCanon)
          ? canonicalizeReadParams(fnCanon, params2)
          : params2;

        patched[newId] = {
          ...node,
          function: fnCanon,
          dependencies: deps2,
          params: finalParams,
        };
      }

      // merge then normalize (auto-wire receivers if missing)
      const mergedSpec = { nodes: { ...curSpec.nodes, ...patched } };
      normalizeSpec(mergedSpec);

      const merged = stringifyYaml(mergedSpec);
      setYamlText(merged);
      setNlPrompt("");
    } catch (e: any) {
      console.error(e);
      alert(String(e?.message || e));
    } finally {
      setGenBusy(false);
    }
  }

  /* -------- SAVE PIPELINE (DB) -------- */
  async function savePipeline() {
    if (!pipelineName.trim()) {
      alert("Please enter a pipeline name before saving.");
      return;
    }
    if (!getToken()) {
      alert("Please log in to save pipelines.");
      return;
    }
    setSaving(true);
    try {
      const body = { name: pipelineName.trim(), yaml: yamlText };
      // expects backend route: POST /pipelines { name, yaml } → { id, name, yaml }
      const res = await authFetch<{ id: string; name: string; yaml: string }>("/pipelines", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      // simple confirmation
      alert(`Saved pipeline: ${res.name}`);
    } catch (e: any) {
      console.error(e);
      alert(String(e?.message || e));
    } finally {
      setSaving(false);
    }
  }
   

  // Auto-import a pipeline chosen from the dashboard/sidebar

  /* --------------------------- RENDER --------------------------- */

  return (
    <div className="pipeline-container">
      {/* No hero/header; tighter top padding */}
      <div className="container mx-auto p-6">
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 h-[80vh]">
          <YamlEditor
            yamlText={yamlText}
            onYamlChange={setYamlText}
            onRunPipeline={runPipeline}
            // NEW
            name={pipelineName}
            onNameChange={setPipelineName}
            onSave={savePipeline}
            saving={saving}
          />

          <div className="pipeline-panel flex flex-col">
            <div className="p-6 border-b border-border/50">
              <div className="flex flex-col gap-4">
                {/* Upload block was moved to Data Sources page – keep only search */}
                <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center">
                  <FunctionSearch onSelectFunction={addFunctionNode} />
                </div>

                {/* NL → YAML prompt bar */}
                <div className="flex items-stretch gap-2">
                  <div className="relative flex-1">
                    <Wand2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                    <input
                      className="pipeline-input pl-9 w-full"
                      placeholder='e.g., "Load check.csv, rename REDHILLS -> RED, select rows 1:10"'
                      value={nlPrompt}
                      onChange={(e) => setNlPrompt(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") generateFromPrompt();
                      }}
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
                </div>
              </div>
            </div>

            <div className="flex-1 p-6">
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

      <TableModal
        open={tableModal.open}
        onClose={() => setTableModal({ open: false, table: null })}
        table={tableModal.table}
      />
    </div>
  );
}
