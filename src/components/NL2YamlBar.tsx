import React, { useState } from "react";
import { Wand2, Plus, Replace } from "lucide-react";

const API_BASE = (import.meta.env.VITE_API_BASE as string) || "/api";
type Mode = "append" | "replace";

interface Props {
  currentYaml: string;
  onMerge: (spec: any, mode: Mode) => Promise<void>;
}

export function NL2YamlBar({ currentYaml, onMerge }: Props) {
  const [q, setQ] = useState("");
  const [mode, setMode] = useState<Mode>("append");
  const [busy, setBusy] = useState(false);

  const run = async () => {
    if (!q.trim() || busy) return;
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("prompt", q);
      fd.append("mode", mode);
      fd.append("current_yaml", currentYaml || "nodes: {}");

      const res = await fetch(`${API_BASE}/nl2yaml`, { method: "POST", body: fd });
      if (!res.ok) throw new Error(await res.text());
      const out = await res.json(); // { yaml, spec, mode }
      await onMerge(out?.spec || {}, (out?.mode as Mode) || mode);
      setQ("");
    } catch (e: any) {
      alert(`NL->YAML failed:\n${e?.message || e}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex w-full gap-2 items-center">
      <div className="relative flex-1">
        <Wand2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <input
          className="pipeline-input pl-10 w-full"
          placeholder='e.g. "read check.csv, drop CHEMBARAMBAKKAM, keep rows 1:10"'
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && run()}
          disabled={busy}
        />
      </div>

      <select
        className="pipeline-input w-28"
        value={mode}
        onChange={(e) => setMode(e.target.value as Mode)}
        disabled={busy}
      >
        <option value="append">Append</option>
        <option value="replace">Replace</option>
      </select>

      <button onClick={run} disabled={busy} className="pipeline-button flex items-center gap-2">
        {mode === "append" ? <Plus className="w-4 h-4" /> : <Replace className="w-4 h-4" />}
        Magic
      </button>
    </div>
  );
}

export default NL2YamlBar;
