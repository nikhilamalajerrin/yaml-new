# nl2yaml_engine.py
import os
import re
import json
from typing import Any, Dict, Optional, Tuple

import requests
import yaml as pyyaml

# -------- YAML block extractors ------------------------------------------------

_YAML_FENCE_RE = re.compile(r"```(?:yaml|yml)?\s*([\s\S]*?)```", re.IGNORECASE)
_YAML_DASH_RE  = re.compile(r"---\s*\n([\s\S]*?)\n(?:---|\Z)")

def _extract_yaml_block(text: str) -> Tuple[Optional[str], Optional[Dict[str, Any]]]:
    """Return (yaml_text, spec_dict) if a YAML block containing a nodes: tree is found."""
    # ```yaml ... ```
    for block in _YAML_FENCE_RE.findall(text or ""):
        try:
            spec = pyyaml.safe_load(block)
            if isinstance(spec, dict) and "nodes" in spec:
                return pyyaml.safe_dump(spec, sort_keys=False), spec
        except Exception:
            pass
    # --- ... ---
    for block in _YAML_DASH_RE.findall(text or ""):
        try:
            spec = pyyaml.safe_load(block)
            if isinstance(spec, dict) and "nodes" in spec:
                return pyyaml.safe_dump(spec, sort_keys=False), spec
        except Exception:
            pass
    # raw YAML body
    try:
        spec = pyyaml.safe_load(text)
        if isinstance(spec, dict) and "nodes" in spec:
            return pyyaml.safe_dump(spec, sort_keys=False), spec
    except Exception:
        pass
    return None, None

# -------- Heuristic fallback (no keys) ----------------------------------------

def _heuristic(prompt: str) -> Optional[Dict[str, Any]]:
    """Very light NL→YAML for 'read ... .csv' prompts when no LLM keys are set."""
    p = (prompt or "").lower()
    if "read" in p and ".csv" in p:
        m = re.search(r"([A-Za-z0-9_\-\.]+\.csv)", prompt)
        fname = m.group(1) if m else "data.csv"
        return {
            "nodes": {
                "read_csv_0": {
                    "function": "read_csv",
                    "params": {"filepath_or_buffer": fname},
                    "dependencies": [],
                }
            }
        }
    return None

# -------- Canonicalization / shaping ------------------------------------------

def _canonicalize(spec: Dict[str, Any]) -> Dict[str, Any]:
    """
    Normalize function names + read_* param aliases so the executor/UI match:
    - strip 'pandas.' / 'numpy.' prefixes
    - prefer DataFrame.rename / DataFrame.iloc / DataFrame.loc when applicable
    - for read_* functions, map filepath/path/path_or_buf/io/file_path -> filepath_or_buffer
    """
    READ_PARAM_ALIASES = {
        "filepath": "filepath_or_buffer",
        "file_path": "filepath_or_buffer",
        "path": "filepath_or_buffer",
        "path_or_buf": "filepath_or_buffer",
        "io": "filepath_or_buffer",
    }
    READ_FUNCS = {
        "read_csv", "read_json", "read_excel", "read_parquet", "read_feather",
        "read_pickle", "read_html", "read_xml", "read_table"
    }

    def is_read_func(fn: Optional[str]) -> bool:
        if not fn:
            return False
        base = fn.split(".")[-1]
        return base in READ_FUNCS or base.startswith("read_")

    out = {"nodes": {}}
    for nid, node in (spec.get("nodes") or {}).items():
        node = dict(node or {})
        fn = node.get("function")

        # 1) canonicalize function id
        if isinstance(fn, str):
            if fn.startswith("pandas."):
                fn = fn[len("pandas."):]
            if fn.startswith("numpy."):
                fn = fn[len("numpy."):]
            # normalize verbose fully-qualified df methods
            if fn.endswith(".rename") and not fn.startswith("DataFrame."):
                fn = "DataFrame.rename"
            if fn.endswith(".iloc") and not fn.startswith("DataFrame."):
                fn = "DataFrame.iloc"
            if fn.endswith(".loc") and not fn.startswith("DataFrame."):
                fn = "DataFrame.loc"

        # 2) normalize read_* parameter aliases
        params = dict(node.get("params") or {})
        if is_read_func(fn):
            if "filepath_or_buffer" not in params:
                for k in list(params.keys()):
                    if k in READ_PARAM_ALIASES:
                        params["filepath_or_buffer"] = params.pop(k)
                        break  # stop at first alias

        node["function"] = fn
        node["params"] = params
        out["nodes"][nid] = node

    return out

def _inject_receiver_if_missing(spec: Dict[str, Any], receiver: str) -> Dict[str, Any]:
    """
    For any DataFrame.* node (including iloc/loc) missing self/df/left,
    inject self: <receiver> and add dependency on <receiver>.
    """
    out = {"nodes": {}}
    for nid, node in (spec.get("nodes") or {}).items():
        node = dict(node or {})
        fn = node.get("function")
        params = dict(node.get("params") or {})
        deps = list(node.get("dependencies") or [])

        needs_self = isinstance(fn, str) and (
            fn.startswith("DataFrame.") or fn in ("DataFrame.iloc", "DataFrame.loc")
        )
        has_receiver = any(k in params for k in ("self", "df", "left"))

        if needs_self and not has_receiver and receiver:
            params["self"] = receiver
            if receiver not in deps:
                deps.append(receiver)

        node["params"] = params
        node["dependencies"] = deps
        out["nodes"][nid] = node
    return out

def _validate_requires_receiver(spec: Dict[str, Any]) -> Optional[str]:
    """
    Return comma-separated ids of nodes that need self but don't have it; None if ok.
    """
    missing = []
    for nid, node in (spec.get("nodes") or {}).items():
        fn = (node or {}).get("function")
        params = (node or {}).get("params") or {}
        needs_self = isinstance(fn, str) and (
            fn.startswith("DataFrame.") or fn in ("DataFrame.iloc", "DataFrame.loc")
        )
        has_receiver = any(k in params for k in ("self", "df", "left"))
        if needs_self and not has_receiver:
            missing.append(nid)
    return ", ".join(missing) if missing else None

# -------- Engine ----------------------------------------------------------------

class NL2YAMLEngine:
    """
    Converts NL to YAML using OpenRouter (DeepSeek) or native DeepSeek.
    Falls back to a tiny heuristic if no keys are provided.
    """
    def __init__(self) -> None:
        # OpenRouter (recommended for DeepSeek on OpenRouter)
        self.or_key   = os.getenv("OPENROUTER_API_KEY", "").strip()
        self.or_base  = os.getenv("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1").rstrip("/")
        self.or_model = os.getenv("OPENROUTER_MODEL", "deepseek/deepseek-r1-0528:free")
        self.or_ref   = os.getenv("OPENROUTER_SITE_URL", "")
        self.or_title = os.getenv("OPENROUTER_SITE_NAME", "")

        # Native DeepSeek (optional)
        self.ds_key   = os.getenv("DEEPSEEK_API_KEY", "").strip()
        self.ds_base  = os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com").rstrip("/")
        self.ds_model = os.getenv("DEEPSEEK_MODEL", "deepseek-chat")

    # ---- LLM callers ----------------------------------------------------------

    def _call_openrouter(self, user_msg: str) -> str:
        headers = {"Authorization": f"Bearer {self.or_key}", "Content-Type": "application/json"}
        if self.or_ref:   headers["HTTP-Referer"] = self.or_ref
        if self.or_title: headers["X-Title"]      = self.or_title
        body = {
            "model": self.or_model,
            "messages": [
                {"role": "system", "content": "You convert user requests into YAML pipeline specs. Output YAML only."},
                {"role": "user",   "content": user_msg},
            ],
            "temperature": 0.2,
        }
        r = requests.post(f"{self.or_base}/chat/completions", headers=headers, data=json.dumps(body), timeout=60)
        if r.status_code == 401:
            raise ValueError(f"OpenRouter auth error: {r.text}")
        if r.status_code >= 400:
            raise ValueError(f"OpenRouter error: {r.text}")
        data = r.json()
        return data.get("choices", [{}])[0].get("message", {}).get("content", "") or ""

    def _call_deepseek(self, user_msg: str) -> str:
        headers = {"Authorization": f"Bearer {self.ds_key}", "Content-Type": "application/json"}
        body = {
            "model": self.ds_model,
            "messages": [
                {"role": "system", "content": "You convert user requests into YAML pipeline specs. Output YAML only."},
                {"role": "user",   "content": user_msg},
            ],
            "temperature": 0.2,
        }
        r = requests.post(f"{self.ds_base}/chat/completions", headers=headers, data=json.dumps(body), timeout=60)
        if r.status_code == 401:
            raise ValueError(f"DeepSeek auth error: {r.text}")
        if r.status_code >= 400:
            raise ValueError(f"DeepSeek error: {r.text}")
        data = r.json()
        return data.get("choices", [{}])[0].get("message", {}).get("content", "") or ""

    # ---- Public entry ---------------------------------------------------------

    def generate(self, prompt: str, current_yaml: str, receiver: Optional[str]) -> Dict[str, Any]:
        """
        Produce a YAML spec string + parsed dict.
        If receiver is provided, auto-inject missing self for DataFrame.* nodes.
        """
        # No keys → heuristic only
        if not self.or_key and not self.ds_key:
            spec = _heuristic(prompt)
            if not spec:
                raise ValueError(
                    "Heuristic NL→YAML couldn't understand the request. "
                    "Configure OPENROUTER_API_KEY or DEEPSEEK_API_KEY for LLM mode."
                )
            spec = _canonicalize(spec)
            if receiver:
                spec = _inject_receiver_if_missing(spec, receiver)
            else:
                missing = _validate_requires_receiver(spec)
                if missing:
                    raise ValueError(f"Missing 'self' for nodes: {missing}. Provide a receiver.")
            return {"yaml": pyyaml.safe_dump(spec, sort_keys=False), "spec": spec}

        # Build instruction WITHOUT defaulting to any implicit input
        guideline_lines = [
            "Return ONLY YAML for a pipeline with this schema:",
            "nodes:",
            "  <id>:",
            "    function: <function id>",
            "    params: <dict>",
            "    dependencies: <list>",
            "",
            "- Use ids like read_csv_0, rename_1, iloc_2.",
            "- Use canonical ids: read_csv, DataFrame.rename, DataFrame.iloc, DataFrame.loc, merge, etc. Do NOT prefix with 'pandas.'.",
            "- Do not assume any default input.",
        ]
        if receiver:
            guideline_lines.append(
                f"- If a DataFrame.* method needs an input and the user doesn't specify one, set self: {receiver} and depend on {receiver}."
            )
        else:
            guideline_lines.append(
                "- If a DataFrame.* method needs an input, you MUST set self: <some_node_id> explicitly."
            )
        guideline_lines.extend([
            "- For iloc/loc use rows/cols with Python-like slices (e.g., rows: 1:10, cols: \":\" or 0:2).",
            "- No prose, no fences — YAML only.",
        ])
        guideline = "\n".join(guideline_lines)

        user_msg = f"CURRENT YAML:\n{current_yaml}\n\nREQUEST:\n{prompt}\n\n{guideline}"

        try:
            if self.or_key:
                text = self._call_openrouter(user_msg)
            else:
                text = self._call_deepseek(user_msg)
        except Exception as e:
            raise ValueError(str(e))

        yaml_out, spec = _extract_yaml_block(text)
        if not spec:
            raise ValueError(f"Model did not return valid YAML.\n---\n{text}\n---")

        spec = _canonicalize(spec)

        if receiver:
            spec = _inject_receiver_if_missing(spec, receiver)
        else:
            missing = _validate_requires_receiver(spec)
            if missing:
                raise ValueError(f"Missing 'self' for nodes: {missing}. Provide a receiver.")

        return {"yaml": pyyaml.safe_dump(spec, sort_keys=False), "spec": spec}
