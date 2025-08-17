import React, { useEffect, useRef, useState } from "react";
import { Search, Zap } from "lucide-react";

interface PandasParam {
  name: string;
  kind?: string;
  required?: boolean;
  default?: string | null;
  annotation?: string | null;
}

interface PandasFunction {
  name: string;
  doc?: string;
  params?: PandasParam[];
  category?: string;
  library?: string;
}

interface SearchBarProps {
  // Parent can keep this empty; we fetch live.
  functions?: PandasFunction[];
  onSelect: (func: PandasFunction) => void;
}

/** API base:
 * - Uses Vite proxy by default (`/api` -> FastAPI 127.0.0.1:8000)
 * - Can be overridden with VITE_API_BASE (e.g., http://127.0.0.1:8000)
 */
const API_BASE = "http://127.0.0.1:8000";

/** Safe JSON fetch helper (avoids parsing HTML error pages) */
async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`HTTP ${res.status}: ${txt.slice(0, 200)}`);
  }
  return res.json() as Promise<T>;
}

export function SearchBar({ onSelect }: SearchBarProps) {
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const debouncedQuery = useDebounced(query, 120);

  useEffect(() => {
    if (!debouncedQuery.trim()) {
      setSuggestions([]);
      setOpen(false);
      return;
    }

    // cancel previous request
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    (async () => {
      try {
        const data = await getJson<{ suggestions: string[] }>(
          `${API_BASE}/pandas/suggest?q=${encodeURIComponent(debouncedQuery)}`,
          { signal: ac.signal }
        );
        setSuggestions((data?.suggestions ?? []).slice(0, 50));
        setOpen(true);
      } catch (e: any) {
        if (e?.name !== "AbortError") {
          console.error("suggest error:", e);
          setSuggestions([]);
          setOpen(false);
        }
      }
    })();

    return () => ac.abort();
  }, [debouncedQuery]);

  // ESC closes dropdown
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const handlePick = async (name: string) => {
    setOpen(false);
    setQuery("");

    try {
      const details = await getJson<PandasFunction>(
        `${API_BASE}/pandas/function/${encodeURIComponent(name)}`
      );
      onSelect(details?.name ? details : { name });
    } catch (e) {
      console.error("fetch details error:", e);
      onSelect({ name }); // fallback minimal object
    }
  };

  return (
    <div className="relative">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <input
          className="pipeline-input pl-10 w-64"
          placeholder="Search pandas/numpy…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => suggestions.length && setOpen(true)}
        />
      </div>

      {open && suggestions.length > 0 && (
        <div className="pipeline-search-dropdown animate-slide-up">
          {suggestions.map((name, idx) => (
            <div
              key={name + idx}
              className="pipeline-search-item flex items-center gap-3"
              onClick={() => handlePick(name)}
            >
              <div className="p-1 rounded bg-primary/20">
                <Zap className="w-3 h-3 text-primary" />
              </div>
              <div className="flex-1">
                <div className="font-medium">{name}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** tiny debounce hook */
function useDebounced<T>(value: T, ms = 150) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export default SearchBar;
