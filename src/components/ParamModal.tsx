import React, { useEffect, useMemo, useState } from "react";
import { X, Settings, Save } from "lucide-react";

/* ---------- helpers ---------- */
const shortName = (full?: string) =>
  (full || "").split(".").pop() || full || "";

type ParamDef = {
  name: string;
  default?: any;
  kind?: string;
  required?: boolean;
};

interface ParamModalProps {
  open: boolean;
  onClose: () => void;
  funcDef: { name: string; doc?: string; params?: ParamDef[] } | null;
  params: Record<string, any>;
  onParamsChange: (params: Record<string, any>) => void; // kept for compatibility
  onApply: (params: Record<string, any>) => void;
}

export function ParamModal({
  open,
  onClose,
  funcDef,
  params,
  onParamsChange,
  onApply,
}: ParamModalProps) {
  const [localParams, setLocalParams] = useState<Record<string, any>>(params || {});

  // Reset values whenever the function changes or the modal reopens
  useEffect(() => {
    setLocalParams(params || {});
  }, [params, funcDef?.name, open]);

  // Build a stable key so the modal *re-mounts* per function
  const remountKey = useMemo(() => funcDef?.name ?? "modal", [funcDef?.name]);

  if (!open || !funcDef) return null;

  const handleApply = () => {
    // filter out empty-string values
    const cleaned: Record<string, any> = {};
    for (const [k, v] of Object.entries(localParams)) {
      if (v !== "" && v !== undefined) cleaned[k] = v;
    }
    onParamsChange(cleaned); // keep parent in sync if they rely on this
    onApply(cleaned);
    onClose();
  };

  return (
    <div className="pipeline-modal" key={remountKey}>
      <div className="pipeline-modal-content max-w-[760px] p-0 animate-slide-up overflow-hidden">
        {/* Header */}
        <div className="px-6 pt-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/20">
                <Settings className="w-5 h-5 text-primary" />
              </div>
              <div className="min-w-0">
                <h3 className="text-xl font-bold text-foreground truncate">
                  {shortName(funcDef.name)}
                </h3>
                <p className="text-sm text-muted-foreground">
                  Configure function parameters
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 rounded-lg hover:bg-muted/50 transition-colors duration-200"
              aria-label="Close"
            >
              <X className="w-5 h-5 text-muted-foreground" />
            </button>
          </div>

          {funcDef.doc && (
            <div className="mt-4 rounded-lg bg-muted/30 border border-border/50 p-3">
              <p className="text-sm text-muted-foreground line-clamp-3">
                {funcDef.doc}
              </p>
            </div>
          )}
        </div>

        {/* Scrollable body */}
        <div className="mt-4 max-h-[56vh] overflow-y-auto px-6 pb-2">
          <div className="grid gap-3">
            {funcDef.params?.map((param) => {
              const placeholder =
                param.default !== undefined && param.default !== null
                  ? String(param.default)
                  : "Enter value...";

              return (
                <div
                  key={param.name}
                  className="rounded-lg border border-border/40 bg-background px-3 py-3"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <label className="text-sm font-medium text-foreground truncate">
                          {param.name}
                        </label>
                        {param.required && (
                          <span className="rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[11px] text-primary">
                            required
                          </span>
                        )}
                        <span className="rounded-full bg-secondary/20 px-2 py-0.5 text-[11px] text-secondary">
                          {(param.kind?.replace("Parameter.", "") || "param")}
                        </span>
                      </div>

                      <input
                        className="pipeline-input w-full"
                        value={localParams[param.name] ?? ""}
                        placeholder={placeholder}
                        onChange={(e) =>
                          setLocalParams((p) => ({ ...p, [param.name]: e.target.value }))
                        }
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleApply();
                        }}
                      />
                    </div>

                    {param.default !== undefined && (
                      <button
                        type="button"
                        onClick={() =>
                          setLocalParams((p) => ({
                            ...p,
                            [param.name]: String(param.default ?? ""),
                          }))
                        }
                        className="select-none rounded-md border border-border/50 bg-muted/40 px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted/60"
                        title="Use default"
                      >
                        default
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Sticky footer */}
        <div className="sticky bottom-0 mt-2 flex items-center justify-between gap-3 border-t border-border/50 bg-background/95 px-6 py-4 backdrop-blur supports-[backdrop-filter]:bg-background/70">
          <button
            onClick={onClose}
            className="px-6 py-2 rounded-lg font-medium border border-border/50 text-muted-foreground hover:bg-muted/30 transition-colors duration-200"
          >
            Cancel
          </button>
          <button className="pipeline-button flex items-center gap-2" onClick={handleApply}>
            <Save className="w-4 h-4" />
            Apply Parameters
          </button>
        </div>
      </div>
    </div>
  );
}
