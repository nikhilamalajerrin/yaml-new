import React from "react";
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

interface Parameter {
  name: string;
  default?: any;
  kind?: string;
  required?: boolean;
}

interface ParameterSelectorProps {
  open: boolean;
  onClose: () => void;
  funcDef: {
    name: string;
    doc?: string;
    params?: Parameter[];
  } | null;
  initialParams: Record<string, any>;
  onApply: (params: Record<string, any>) => void;
}

export function ParameterSelector({
  open,
  onClose,
  funcDef,
  initialParams,
  onApply,
}: ParameterSelectorProps) {
  const [selectedParams, setSelectedParams] = React.useState<Record<string, boolean>>({});
  const [paramValues, setParamValues] = React.useState<Record<string, any>>(initialParams || {});

  React.useEffect(() => {
    if (!funcDef?.params) return;
    const selected: Record<string, boolean> = {};
    const values: Record<string, any> = {};

    funcDef.params.forEach((p) => {
      const hasInitial = initialParams[p.name] !== undefined;
      selected[p.name] = hasInitial || !!p.required; // pre-check required
      values[p.name] = hasInitial ? initialParams[p.name] : "";
    });

    setSelectedParams(selected);
    setParamValues(values);
  }, [funcDef, initialParams]);

  const handleApply = () => {
    const finalParams: Record<string, any> = {};
    Object.entries(selectedParams).forEach(([name, isOn]) => {
      const val = paramValues[name];
      if (isOn && val !== undefined && val !== "") {
        finalParams[name] = val;
      }
    });
    onApply(finalParams);
    onClose();
  };

  if (!open || !funcDef) return null;

  return (
    <Dialog open={open} onOpenChange={onClose}>
      {/* keep content constrained and prevent children from overflowing */}
      <DialogContent
        className="w-full max-w-[760px] overflow-hidden p-0"
        aria-describedby={undefined}
      >
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
              const isChecked = selectedParams[param.name] || false;
              const kindLabel = (param.kind?.replace("Parameter.", "") || "param");
              const placeholder =
                param.default !== undefined && param.default !== null
                  ? String(param.default)
                  : "Enter value...";

              return (
                <div
                  key={param.name}
                  className="rounded-lg border border-border/40 bg-background px-3 py-3"
                >
                  <div className="grid grid-cols-[auto,1fr,auto] items-start gap-3">
                    {/* Toggle */}
                    <div className="pt-1">
                      <Checkbox
                        checked={isChecked}
                        onCheckedChange={(c) =>
                          setSelectedParams((prev) => ({ ...prev, [param.name]: !!c }))
                        }
                        disabled={param.required}
                      />
                    </div>

                    {/* Main content */}
                    <div className="min-w-0 space-y-2">
                      <div className="flex items-center gap-2">
                        <div className="truncate font-medium text-foreground">
                          {param.name}
                        </div>
                        {param.required && (
                          <span className="rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-xs text-primary">
                            required
                          </span>
                        )}
                        <span className="rounded-full bg-secondary/20 px-2 py-0.5 text-xs text-secondary">
                          {kindLabel}
                        </span>
                      </div>

                      <Input
                        className={`w-full ${isChecked ? "" : "opacity-50"} `}
                        disabled={!isChecked}
                        value={paramValues[param.name] ?? ""}
                        placeholder={placeholder}
                        onChange={(e) =>
                          setParamValues((prev) => ({ ...prev, [param.name]: e.target.value }))
                        }
                      />
                    </div>

                    {/* Default chip (right) */}
                    <div className="pt-1 text-right">
                      {param.default !== undefined && (
                        <button
                          type="button"
                          onClick={() =>
                            setParamValues((prev) => ({
                              ...prev,
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
                </div>
              );
            })}
          </div>
        </div>

        {/* Sticky footer */}
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
