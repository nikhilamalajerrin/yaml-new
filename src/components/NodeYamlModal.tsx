// src/components/NodeYamlModal.tsx
import React, { useEffect, useMemo, useState } from "react";
import yaml from "yaml";
import { X } from "lucide-react";
import { YamlEditor } from "@/components/YamlEditor";

type KV = Record<string, any>;

export interface NodeYamlModalProps {
  open: boolean;
  nodeId: string | null;
  entry: { function: string; params?: KV; dependencies?: string[] } | null;
  onClose: () => void;

  /** Called when user hits Apply (Save in the editor). */
  onApply: (
    nodeId: string,
    next: { function: string; params?: KV; dependencies?: string[] }
  ) => void;

  /** Optionally preview this node (Run in the editor). */
  onRunPreview?: (nodeId: string) => void;
}

/* -------- helpers -------- */
function safeDump(obj: any) {
  try {
    return yaml.stringify(obj, { indent: 2 });
  } catch {
    return "nodes: {}";
  }
}
function safeLoad<T = any>(text: string): T | null {
  try {
    return (yaml.parse(text) as T) ?? null;
  } catch {
    return null;
  }
}
function canonicalizeFuncName(fn: string) {
  if (!fn) return fn;
  return fn.replace(/^pandas\./, "").replace(/^numpy\./, "");
}
function isReadFn(fn: string) {
  const base = canonicalizeFuncName(fn).split(".").pop() || "";
  return base.startsWith("read_")
    || ["read_csv","read_json","read_excel","read_parquet","read_feather","read_pickle","read_html","read_xml","read_table"].includes(base);
}
function canonicalizeReadParams(fn: string, params: KV = {}) {
  if (!isReadFn(fn)) return params;
  const p: KV = { ...params };
  const aliases = ["filepath_or_buffer", "filepath", "file_path", "path", "path_or_buf", "io"];
  let val = p.filepath_or_buffer;
  if (val == null) {
    for (const k of aliases) {
      if (k !== "filepath_or_buffer" && p[k] != null) {
        val = p[k];
        break;
      }
    }
  }
  for (const k of aliases) {
    if (k !== "filepath_or_buffer" && k in p) delete p[k];
  }
  if (val != null) p.filepath_or_buffer = val;
  return p;
}

/**
 * A modal that shows YAML for a **single node**, using the caller’s YamlEditor.
 * The editor shows a small document:
 *
 * nodes:
 *   <nodeId>:
 *     function: ...
 *     params: ...
 *     dependencies: [...]
 */
export function NodeYamlModal({
  open,
  nodeId,
  entry,
  onClose,
  onApply,
  onRunPreview,
}: NodeYamlModalProps) {
  const [text, setText] = useState<string>("nodes: {}");

  // Seed YAML whenever the modal opens or the entry changes
  useEffect(() => {
    if (!open || !nodeId) return;
    const doc = {
      nodes: {
        [nodeId]: {
          function: entry?.function ?? "python",
          params: entry?.params ?? {},
          dependencies: entry?.dependencies ?? [],
        },
      },
    };
    setText(safeDump(doc));
  }, [open, nodeId, entry]);

  // Parse the current YAML into a node spec (or null if invalid)
  const parsedNode = useMemo(() => {
    const spec = safeLoad<any>(text);
    if (!spec || typeof spec !== "object") return null;
    const nmap = spec.nodes ?? {};
    if (!nodeId || !nmap || typeof nmap !== "object" || !nmap[nodeId]) return null;
    const n = nmap[nodeId];
    const fn = canonicalizeFuncName(n?.function ?? "python");
    const params = isReadFn(fn)
      ? canonicalizeReadParams(fn, n?.params ?? {})
      : (n?.params ?? {});
    const deps = Array.isArray(n?.dependencies) ? n.dependencies : [];
    return { function: fn, params, dependencies: deps };
  }, [text, nodeId]);

  return (
    <div
      className={`fixed inset-0 z-[100] ${open ? "pointer-events-auto" : "pointer-events-none"}`}
      aria-hidden={!open}
    >
      {/* overlay */}
      <div
        className={`absolute inset-0 bg-black/60 transition-opacity ${open ? "opacity-100" : "opacity-0"}`}
        onClick={onClose}
      />
      {/* panel */}
      <div
        className={`absolute right-0 top-0 h-full w-full md:w-[720px] max-w-[96vw] bg-[#0b1220] border-l border-border/40 shadow-2xl transition-transform duration-200 ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
        role="dialog"
        aria-modal="true"
      >
        {/* close button */}
        <button
          onClick={onClose}
          className="absolute top-3 right-3 p-2 rounded-md hover:bg-white/10"
          aria-label="Close"
        >
          <X className="w-5 h-5 text-slate-300" />
        </button>

        {/* Embedded YAML editor */}
        <YamlEditor
          yamlText={text}
          onYamlChange={setText}
          // “Run” in editor → preview this node
          onRunPipeline={() => nodeId && onRunPreview?.(nodeId)}
          // We’ll reuse the “name” field to show the node id (read-only UX)
          name={nodeId ?? ""}
          onNameChange={() => {}}
          // “Save” in editor → Apply if YAML is valid
          onSave={() => {
            if (!nodeId || !parsedNode) return;
            onApply(nodeId, parsedNode);
            onClose();
          }}
          // no remote save happening here; so saving spinner is always false
          saving={false}
        />
      </div>
    </div>
  );
}
