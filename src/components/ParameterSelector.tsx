// src/components/ParameterSelector.tsx
import React from "react";
import yaml from "yaml";
import { Settings, Save, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type Parameter = {
  name: string;
  default?: any;
  kind?: string;
  required?: boolean;
};

type FuncDef = {
  name: string;
  doc?: string;
  params?: Parameter[];
};

interface ParameterSelectorProps {
  open: boolean;
  onClose: () => void;
  funcDef: FuncDef | null;
  initialParams: Record<string, any>;
  onApply: (params: Record<string, any>) => void;
}

/* ---------- helpers ---------- */
const RECEIVER_KEYS = new Set(["self", "df", "left", "right"]);

function toDisplayString(v: any): string {
  if (v === undefined || v === null) return "";
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
    return String(v);
  }
  // object / array → YAML
  try {
    const s = yaml.stringify(v).trim();
    return s;
  } catch {
    try {
      return JSON.stringify(v, null, 2);
    } catch {
      return String(v);
    }
  }
}

function looksStructured(s: string): boolean {
  const t = s.trim();
  if (!t) return false;
  if (t.startsWith("{") || t.startsWith("[") || t.includes(":\n") || t.includes(": ")) return true;
  // heuristic: contains commas and isn’t a plain number
  if (t.includes(",") && !/^-?\d+(\.\d+)?$/.test(t)) return true;
  return false;
}

function parseInputValue(name: string, raw: string): any {
  const s = raw?.trim() ?? "";

  // Never coerce node references
  if (RECEIVER_KEYS.has(name)) return s;

  if (s === "") return undefined;

  // Try YAML (handles JSON too)
  if (looksStructured(s)) {
    try {
      return yaml.parse(s);
    } catch {
      // fall back to primitive coercions
    }
  }

  // primitives
  if (/^(true|false)$/i.test(s)) return /^true$/i.test(s);
  if (/^-?\d+$/.test(s)) return parseInt(s, 10);
  if (/^-?\d+\.\d+$/.test(s)) return parseFloat(s);

  return s;
}

export function ParameterSelector({
  open,
  onClose,
  funcDef,
  initialParams,
  onApply,
}: ParameterSelectorProps) {
  const [selected, setSelected] = React.useState<Record<string, boolean>>({});
  const [values, setValues] = React.useState<Record<string, string>>({});

  // Build field list (params from def + any extra already in YAML)
  const fields = React.useMemo<Parameter[]>(() => {
    const fromDef = (funcDef?.params || []) as Parameter[];
    const extras = Object.keys(initialParams || {})
      .filter((k) => !fromDef.find((p) => p.name === k))
      .map((k) => ({ name: k }));
    const merged: Parameter[] = [];
    [...fromDef, ...extras].forEach((p) => {
      if (!merged.find((x) => x.name === p.name)) merged.push(p);
    });
    // keep receivers near the top for convenience
    const order = (n: string) => (RECEIVER_KEYS.has(n) ? 0 : 1);
    merged.sort((a, b) => {
      const oa = order(a.name);
      const ob = order(b.name);
      if (oa !== ob) return oa - ob;
      return a.name.localeCompare(b.name);
    });
    return merged;
  }, [funcDef, initialParams]);

  // Sync modal state when opening / function changes / YAML changes
  React.useEffect(() => {
    if (!open) return;

    const nextSelected: Record<string, boolean> = {};
    const nextValues: Record<string, string> = {};

    fields.forEach((p) => {
      const hasInitial = initialParams[p.name] !== undefined;
      const v = hasInitial ? initialParams[p.name] : "";
      nextSelected[p.name] = hasInitial || !!p.required;
      nextValues[p.name] = toDisplayString(v);
    });

    setSelected(nextSelected);
    setValues(nextValues);
  }, [open, fields, initialParams]);

  if (!open || !funcDef) return null;

  const kindLabel = (k?: string) => (k ? k.replace("Parameter.", "") : "param");

  const handleApply = () => {
    const out: Record<string, any> = {};
    for (const [name, isOn] of Object.entries(selected)) {
      if (!isOn) continue;
      const raw = values[name];
      const parsed = parseInputValue(name, raw);
      if (parsed !== undefined) out[name] = parsed;
    }
    onApply(out);
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="w-full max-w-[760px] overflow-hidden p-0" aria-describedby={undefined}>
        {/* Header */}
        <div className="px-6 pt-6">
          <DialogHeader className="space-y-2">
            <DialogTitle className="flex items-center gap-2">
              <Settings className="w-5 h-5" />
              Configure {funcDef.name} Parameters
            </DialogTitle>
          </DialogHeader>
          {funcDef.doc && (
            <div className="mt-4 rounded-lg border border-border/50 bg-muted/30 p-3">
              <p className="text-sm text-muted-foreground line-clamp-3">{funcDef.doc}</p>
            </div>
          )}
        </div>

        {/* Body */}
        <div className="mt-4 max-h-[56vh] overflow-y-auto px-6 pb-2">
          <div className="grid gap-3">
            {fields.map((param) => {
              const isOn = !!selected[param.name];
              const val = values[param.name] ?? "";
              const placeholder =
                param.default !== undefined && param.default !== null
                  ? String(param.default)
                  : "Enter value…";
              const isReceiver = RECEIVER_KEYS.has(param.name);
              const useTextarea = !isReceiver && (looksStructured(val) || val.includes("\n"));

              return (
                <div key={param.name} className="rounded-lg border border-border/40 bg-background px-3 py-3">
                  <div className="grid grid-cols-[auto,1fr,auto] items-start gap-3">
                    {/* toggle */}
                    <div className="pt-1">
                      <Checkbox
                        checked={isOn}
                        onCheckedChange={(c) =>
                          setSelected((prev) => ({ ...prev, [param.name]: !!c || !!param.required }))
                        }
                        disabled={param.required}
                      />
                    </div>

                    {/* editor */}
                    <div className="min-w-0 space-y-2">
                      <div className="flex items-center gap-2">
                        <div className="truncate font-medium text-foreground">{param.name}</div>
                        {param.required && (
                          <span className="rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-xs text-primary">
                            required
                          </span>
                        )}
                        <span className="rounded-full bg-secondary/20 px-2 py-0.5 text-xs text-secondary">
                          {isReceiver ? "node id" : `${kindLabel(param.kind)} (YAML / JSON / scalar)`}
                        </span>
                      </div>

                      {useTextarea ? (
                        <textarea
                          className={`w-full resize-y rounded-md bg-neutral-800 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 ring-fuchsia-500/60 ${isOn ? "" : "opacity-50"}`}
                          disabled={!isOn}
                          rows={Math.min(10, Math.max(3, val.split("\n").length))}
                          value={val}
                          placeholder={placeholder}
                          onChange={(e) =>
                            setValues((prev) => ({ ...prev, [param.name]: e.target.value }))
                          }
                        />
                      ) : (
                        <Input
                          className={`w-full ${isOn ? "" : "opacity-50"}`}
                          disabled={!isOn}
                          value={val}
                          placeholder={isReceiver ? "node_id (e.g., rename_1)" : placeholder}
                          onChange={(e) =>
                            setValues((prev) => ({ ...prev, [param.name]: e.target.value }))
                          }
                        />
                      )}
                    </div>

                    {/* default chip */}
                    <div className="pt-1 text-right">
                      {param.default !== undefined && (
                        <button
                          type="button"
                          onClick={() =>
                            setValues((prev) => ({ ...prev, [param.name]: toDisplayString(param.default) }))
                          }
                          className="select-none rounded-md border border-border/50 bg-muted/40 px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted/60"
                          title="Use default"
                        >
                          default
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 mt-2 flex items-center justify-between gap-3 border-t border-border/50 bg-background/95 px-6 py-4 backdrop-blur supports-[backdrop-filter]:bg-background/70">
          <Button variant="outline" onClick={onClose}>
            <X className="mr-2 h-4 w-4" />
            Cancel
          </Button>
          <Button onClick={handleApply} className="pipeline-button">
            <Save className="mr-2 h-4 w-4" />
            Apply Parameters
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default ParameterSelector;
