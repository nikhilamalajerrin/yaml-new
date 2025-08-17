import React, { useEffect, useMemo, useRef, useState } from "react";
import { Search, Plus, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

interface PandasParam {
  name: string;
  kind?: string;
  required?: boolean;
  default?: string | null;
  annotation?: string | null;
}
interface PandasFunction {
  name: string;        // may be fully qualified (e.g., pandas.io.api.read_csv)
  doc?: string;
  params?: PandasParam[];
  category?: string;   // module/category from backend
  library?: string;
  relevance_score?: number;
}
interface FunctionSearchProps {
  onSelectFunction: (func: PandasFunction) => void;
}

/** Point to proxy or env override */
const API_BASE = (import.meta.env.VITE_API_BASE as string) || "/api";

/* ---------- helpers for nicer display ---------- */
function splitName(full: string) {
  const parts = (full || "").split(".");
  const short = parts[parts.length - 1] || full;
  const module = parts.length > 1 ? parts.slice(0, parts.length - 1).join(".") : "";
  return { short, module };
}

function moduleBadge(func: PandasFunction) {
  // Prefer the module derived from name; fallback to category/library
  const { module } = splitName(func.name);
  if (module) return module;
  if (func.category) return func.category;
  if (func.library) return func.library;
  return "pandas";
}

function cleanDoc(s?: string, max = 220) {
  if (!s) return "";
  // Strip markdown/code ticks and long URLs
  let t = s
    .replace(/`+/g, "")
    .replace(/\[(.*?)\]\((.*?)\)/g, "$1")
    .replace(/https?:\/\/\S+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (t.length > max) t = t.slice(0, max - 1) + "…";
  return t;
}

export function FunctionSearch({ onSelectFunction }: FunctionSearchProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<PandasFunction[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const debouncedQuery = useDebounced(query, 150);

  useEffect(() => {
    if (!open) return;
    if (!debouncedQuery.trim()) {
      setResults([]);
      return;
    }

    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    (async () => {
      setLoading(true);
      try {
        const url = `${API_BASE}/pandas/search?query=${encodeURIComponent(debouncedQuery)}`;
        const res = await fetch(url, { signal: ac.signal });
        const ctype = res.headers.get("content-type") || "";
        if (!res.ok) {
          const txt = await res.text();
          throw new Error(`HTTP ${res.status}: ${txt.slice(0, 200)}`);
        }
        if (!ctype.includes("application/json")) {
          const txt = await res.text();
          throw new Error(`Non-JSON response (${ctype}): ${txt.slice(0, 200)}`);
        }
        const data = await res.json();
        const items: PandasFunction[] = Array.isArray(data?.functions) ? data.functions : [];
        setResults(items);
      } catch (e: any) {
        if (e?.name !== "AbortError") {
          console.error("FunctionSearch fetch error:", e);
          setResults([]);
        }
      } finally {
        setLoading(false);
      }
    })();

    return () => ac.abort();
  }, [debouncedQuery, open]);

  const handleSelect = (func: PandasFunction) => {
    onSelectFunction(func);
    setOpen(false);
    setQuery("");
    setResults([]);
  };

  const display = useMemo(() => {
    const list = [...results];
    list.sort(
      (a, b) =>
        (b.relevance_score ?? 0) - (a.relevance_score ?? 0) ||
        a.name.localeCompare(b.name)
    );
    return list;
  }, [results]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="pipeline-button flex items-center gap-2">
          <Plus className="w-4 h-4" />
          Add Function
        </Button>
      </DialogTrigger>

      <DialogContent
        className="max-w-3xl w-full max-h-[82vh] overflow-hidden p-0"
        aria-describedby={undefined}
      >
        {/* Header */}
        <div className="px-6 pt-6">
          <DialogHeader className="space-y-2">
            <DialogTitle className="flex items-center gap-2">
              <Search className="w-5 h-5" />
              Search Pandas Functions
            </DialogTitle>
          </DialogHeader>

          <div className="relative mt-4">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              className="pl-10"
              placeholder="Search (e.g., read_, isna, merge, to_parquet)"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoFocus
            />
          </div>
        </div>

        {/* Scrollable list */}
        <div className="mt-4 max-h-[60vh] overflow-y-auto px-6 pb-4 space-y-3">
          {loading && (
            <div className="text-center py-8 text-muted-foreground">Searching…</div>
          )}

          {!loading && display.length > 0 ? (
            display.slice(0, 100).map((func, idx) => {
              const { short } = splitName(func.name);
              const badge = moduleBadge(func);
              const params = func.params || [];
              const shown = params.slice(0, 3).map((p) => p.name).join(", ");
              const rest = params.length > 3 ? ` +${params.length - 3} more` : "";

              return (
                <div
                  key={func.name + idx}
                  className="group rounded-xl border border-border/60 bg-background/60 hover:bg-muted/30 transition-colors duration-150"
                >
                  <div
                    className="flex items-start gap-3 p-4 cursor-pointer"
                    onClick={() => handleSelect(func)}
                  >
                    <div className="p-2 mt-0.5 rounded bg-primary/15 shrink-0">
                      <Settings className="w-4 h-4 text-primary" />
                    </div>

                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex items-center gap-2">
                        <h4 className="font-medium text-foreground truncate">
                          {short}
                        </h4>
                        <span className="shrink-0 rounded-full bg-secondary/20 text-secondary px-2 py-0.5 text-[11px]">
                          {badge}
                        </span>
                      </div>

                      {func.doc && (
                        <p className="text-sm text-muted-foreground line-clamp-2">
                          {cleanDoc(func.doc)}
                        </p>
                      )}

                      {params.length > 0 && (
                        <div className="text-xs text-muted-foreground">
                          Parameters: {shown}
                          {rest}
                        </div>
                      )}
                    </div>

                    <Button size="sm" variant="outline" className="shrink-0">
                      Add
                    </Button>
                  </div>
                </div>
              );
            })
          ) : (
            !loading && (
              <div className="text-center py-10 text-muted-foreground">
                {query ? (
                  <>
                    <p>No functions found for “{query}”.</p>
                    <p className="text-xs mt-2">
                      Try: <code>read_</code>, <code>isna</code>, <code>merge</code>,{" "}
                      <code>to_</code>
                    </p>
                  </>
                ) : (
                  <>
                    <p>Start typing to search pandas/numpy functions</p>
                    <p className="text-xs mt-2">Substring search. Prefix results first.</p>
                  </>
                )}
              </div>
            )
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function useDebounced<T>(value: T, ms = 200) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}
