"""
Tharavu Dappa Backend — Light index + Robust pipeline executor + NL→YAML
- /pandas/search + /pandas/suggest include synthetic DataFrame.iloc / DataFrame.loc
- /pipeline/run executes pipelines with param coercion & reference resolution
- Special handling for .iloc / .loc accepts Python-like slice text (1:10, :, 0:2, lists…)
- /nl2yaml converts natural language to YAML (OpenRouter DeepSeek or heuristic fallback)
"""

import os
import re
import json
import inspect
import importlib
from functools import lru_cache
from typing import Any, Dict, List, Optional, Tuple, Set

import requests
import numpy as np
import pandas as pd
from fastapi import FastAPI, HTTPException, UploadFile, Form
from fastapi.middleware.cors import CORSMiddleware
import uvicorn
import yaml as pyyaml
from io import BytesIO

app = FastAPI(title="Tharavu Dappa Backend", version="3.5.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ======================== Utilities ========================

def _callable(x) -> bool:
    try:
        return callable(x) and not inspect.isclass(x)
    except Exception:
        return False

def _safe_sig(obj):
    try:
        return inspect.signature(obj)
    except Exception:
        return None

def get_function_signature(func: Any) -> Dict[str, Any]:
    sig = _safe_sig(func)
    params = []
    if sig:
        for name, p in sig.parameters.items():
            params.append({
                "name": name,
                "kind": str(p.kind),
                "required": p.default == inspect.Parameter.empty,
                "default": None if p.default == inspect.Parameter.empty else repr(p.default),
                "annotation": None if p.annotation == inspect.Parameter.empty else str(p.annotation),
            })
    return {
        "name": getattr(func, "__name__", "unknown"),
        "doc": inspect.getdoc(func) or "No documentation available",
        "params": params,
        "module": getattr(func, "__module__", "unknown"),
    }

def _add(functions: List[Dict[str, Any]], names: Set[str],
         obj: Any, suggestion: str, library: str, category: str, canonical: str):
    info = get_function_signature(obj)
    info["library"] = library
    info["category"] = category
    info["name"] = canonical
    functions.append(info)
    names.add(suggestion)

def _add_synthetic(functions: List[Dict[str, Any]], names: Set[str],
                   canonical: str, doc: str, params: List[Dict[str, Any]],
                   library="pandas", category="DataFrame"):
    info = {
        "name": canonical,
        "doc": doc,
        "params": params,
        "module": "pandas.core.frame",
        "library": library,
        "category": category,
    }
    functions.append(info)
    short = canonical.split(".")[-1]
    names.add(short)
    names.add(canonical)

def _collect_light() -> Tuple[List[Dict[str, Any]], List[str]]:
    functions: List[Dict[str, Any]] = []
    suggestions: Set[str] = set()

    # pandas top-level
    for name in dir(pd):
        if name.startswith("_"): continue
        try:
            obj = getattr(pd, name)
        except Exception:
            continue
        if _callable(obj):
            _add(functions, suggestions, obj, name, "pandas", "pandas", name)

    # key pandas classes/methods
    for cls in filter(None, [getattr(pd,"DataFrame",None),
                             getattr(pd,"Series",None),
                             getattr(pd,"Index",None),
                             getattr(pd,"Categorical",None)]):
        cls_name = getattr(cls, "__name__", "PandasClass")
        for m in dir(cls):
            if m.startswith("_"): continue
            try:
                meth = getattr(cls, m)
            except Exception:
                continue
            if _callable(meth):
                _add(functions, suggestions, meth, m, "pandas", cls_name, f"{cls_name}.{m}")
                suggestions.add(f"{cls_name}.{m}")

    # synthetic indexers for search
    _add_synthetic(
        functions, suggestions,
        "DataFrame.iloc",
        "Integer-location based indexer: use rows/cols with ints, slices '1:10', lists '0,2,4'.",
        [
            {"name": "self", "kind": "POSITIONAL_OR_KEYWORD", "required": True},
            {"name": "rows", "kind": "POSITIONAL_OR_KEYWORD", "required": False, "default": None},
            {"name": "cols", "kind": "POSITIONAL_OR_KEYWORD", "required": False, "default": None},
        ],
    )
    _add_synthetic(
        functions, suggestions,
        "DataFrame.loc",
        "Label-based indexer: use rows/cols with labels, slices ':', lists, booleans.",
        [
            {"name": "self", "kind": "POSITIONAL_OR_KEYWORD", "required": True},
            {"name": "rows", "kind": "POSITIONAL_OR_KEYWORD", "required": False, "default": None},
            {"name": "cols", "kind": "POSITIONAL_OR_KEYWORD", "required": False, "default": None},
        ],
    )

    # pandas submodules (light)
    for sub in ("io", "plotting"):
        try:
            submod = getattr(pd, sub)
            for a in dir(submod):
                if a.startswith("_"): continue
                try:
                    obj = getattr(submod, a)
                except Exception:
                    continue
                if _callable(obj):
                    _add(functions, suggestions, obj, a, "pandas", f"pandas.{sub}", f"{sub}.{a}")
                    suggestions.add(f"{sub}.{a}")
        except Exception:
            pass

    # numpy top-level + light submodules
    for a in dir(np):
        if a.startswith("_"): continue
        try:
            obj = getattr(np, a)
        except Exception:
            continue
        if _callable(obj):
            _add(functions, suggestions, obj, a, "numpy", "NumPy", a)
    for sub in ("linalg", "random", "fft"):
        try:
            submod = getattr(np, sub)
            for a in dir(submod):
                if a.startswith("_"): continue
                try:
                    obj = getattr(submod, a)
                except Exception:
                    continue
                if _callable(obj):
                    _add(functions, suggestions, obj, f"{sub}.{a}", "numpy", f"numpy.{sub}", f"{sub}.{a}")
                    suggestions.add(a)
        except Exception:
            pass

    seen = set()
    out = []
    for f in functions:
        key = (f.get("library"), f.get("name"))
        if key in seen: continue
        seen.add(key); out.append(f)
    return out, sorted(suggestions)

@lru_cache(maxsize=1)
def get_index() -> Tuple[List[Dict[str, Any]], List[str]]:
    return _collect_light()

# ======================== Function resolution ========================

def get_callable_from_name(func_name: str):
    """Resolve a pandas/numpy function or pandas method by canonical/name."""
    # module path (pandas.x.y or numpy.x.y)
    if func_name.startswith("pandas.") or func_name.startswith("numpy."):
        parts = func_name.split(".")
        for cut in range(len(parts), 0, -1):
            mod_name = ".".join(parts[:cut])
            try:
                mod = importlib.import_module(mod_name)
                obj = mod
                ok = True
                for p in parts[cut:]:
                    if not hasattr(obj, p):
                        ok = False; break
                    obj = getattr(obj, p)
                if ok and _callable(obj):
                    return obj
            except Exception:
                continue

    # short submodule form like "linalg.norm" or "plotting.scatter_matrix"
    if "." in func_name:
        head, tail = func_name.split(".", 1)
        if hasattr(np, head):
            sub = getattr(np, head)
            if hasattr(sub, tail):
                cand = getattr(sub, tail)
                if _callable(cand): return cand
        if hasattr(pd, head):
            sub = getattr(pd, head)
            if hasattr(sub, tail):
                cand = getattr(sub, tail)
                if _callable(cand): return cand

    # pandas top-level
    if hasattr(pd, func_name):
        cand = getattr(pd, func_name)
        if _callable(cand): return cand

    # pandas methods like "DataFrame.rename"
    pandas_classes = {
        "DataFrame": getattr(pd, "DataFrame", None),
        "Series": getattr(pd, "Series", None),
        "Index": getattr(pd, "Index", None),
        "Categorical": getattr(pd, "Categorical", None),
    }
    if "." in func_name:
        cls_name, meth = func_name.split(".", 1)
        # .iloc / .loc are not callables — handled specially by executor
        if cls_name == "DataFrame" and meth in ("iloc", "loc"):
            return None
        cls = pandas_classes.get(cls_name)
        if cls and hasattr(cls, meth):
            cand = getattr(cls, meth)
            if _callable(cand): return cand

    # numpy top-level
    if hasattr(np, func_name):
        cand = getattr(np, func_name)
        if _callable(cand): return cand

    raise ValueError(f"Function '{func_name}' not found")

# ======================== Param coercion & indexer parsing ========================

_slice_re = re.compile(r"^\s*-?\d*\s*:\s*-?\d*(\s*:\s*-?\d*)?\s*$")  # 1:10, :10, 1:, 1:10:2, :

def _looks_like_mapping_str(s: str) -> bool:
    """True for 'OLD:NEW' style, but NOT for slice-like text ('1:10', ':')."""
    s = s.strip()
    if _slice_re.match(s):
        return False
    return ":" in s and not (s.startswith("{") and s.endswith("}"))

def _looks_like_list_str(s: str) -> bool:
    st = s.strip()
    return "," in st or (st.startswith("[") and st.endswith("]"))

def _try_yaml_or_json_scalar(s: str) -> Any:
    try:
        return pyyaml.safe_load(s)
    except Exception:
        return s

def _coerce_value(v: Any) -> Any:
    if isinstance(v, str):
        sv = v.strip()
        if _looks_like_mapping_str(sv) and ("\n" not in sv):
            left, _, right = sv.partition(":")
            if left and right:
                return {left.strip(): right.strip()}
        if _looks_like_list_str(sv):
            if sv.startswith("[") and sv.endswith("]"):
                return _try_yaml_or_json_scalar(sv)
            else:
                return [s.strip() for s in sv.split(",") if s.strip()]
        return _try_yaml_or_json_scalar(sv)
    return v

def coerce_params(params: Dict[str, Any]) -> Dict[str, Any]:
    return {k: _coerce_value(v) for k, v in params.items()}

def extract_param_node_refs(params: Dict[str, Any]) -> Set[str]:
    refs = set()
    for v in params.values():
        if isinstance(v, str):
            refs.add(v)
        elif isinstance(v, (list, tuple)):
            for x in v:
                if isinstance(x, str):
                    refs.add(x)
        elif isinstance(v, dict):
            for x in v.values():
                if isinstance(x, str):
                    refs.add(x)
    return refs

def resolve_param_references(params: Dict[str, Any], executed: Dict[str, Any]) -> Dict[str, Any]:
    def resolve(v):
        if isinstance(v, str) and v in executed:
            return executed[v]
        if isinstance(v, list):
            return [resolve(x) for x in v]
        if isinstance(v, tuple):
            return tuple(resolve(x) for x in v)
        if isinstance(v, dict):
            return {k: resolve(x) for k, x in v.items()}
        return v
    return {k: resolve(v) for k, v in params.items()}

def _to_int_or_none(x):
    if x is None or x == "":
        return None
    try:
        return int(x)
    except Exception:
        raise ValueError(f"Expected integer in slice, got {x!r}")

def _parse_slice_like_text(s: str) -> slice:
    s = s.strip()
    if s == ":":
        return slice(None)
    parts = [p.strip() for p in s.split(":")]
    if len(parts) == 2:
        return slice(_to_int_or_none(parts[0]), _to_int_or_none(parts[1]))
    if len(parts) == 3:
        return slice(_to_int_or_none(parts[0]), _to_int_or_none(parts[1]), _to_int_or_none(parts[2]))
    raise ValueError(f"Bad slice text: {s!r}")

def _normalize_indexer(v: Any, *, iloc: bool):
    if v is None:
        return slice(None)
    if isinstance(v, dict) and len(v) == 1:  # YAML unquoted 1:10 => {1:10}
        (k, val), = v.items()
        return slice(_to_int_or_none(str(k)), _to_int_or_none(str(val)))
    if isinstance(v, int):
        return v
    if isinstance(v, list):
        return [int(x) for x in v] if iloc else v
    if isinstance(v, str):
        s = v.strip()
        if _slice_re.match(s):
            return _parse_slice_like_text(s)
        if s.startswith("[") and s.endswith("]"):
            arr = pyyaml.safe_load(s)
            return [int(x) for x in arr] if iloc else arr
        if "," in s:
            parts = [p.strip() for p in s.split(",") if p.strip() != ""]
            return [int(p) for p in parts] if iloc else parts
        try:
            return int(s) if iloc else (int(s) if s.isdigit() else s)
        except Exception:
            return s
    return v

# ======================== IO param normalization ========================

READ_ARG_ALIASES = {
    "filepath": "filepath_or_buffer",
    "file_path": "filepath_or_buffer",
    "path": "filepath_or_buffer",
    "path_or_buf": "filepath_or_buffer",
    "io": "filepath_or_buffer",
}

def is_read_function(func_name: str) -> bool:
    if not func_name:
        return False
    fn = func_name.split(".")[-1]
    return fn.startswith("read_") or fn in {
        "read_csv", "read_json", "read_excel", "read_parquet", "read_feather",
        "read_pickle", "read_html", "read_xml", "read_table"
    }

def normalize_read_params(func_name: str, params: Dict[str, Any]) -> Dict[str, Any]:
    if not isinstance(params, dict) or not is_read_function(func_name):
        return params
    p = dict(params)
    if "filepath_or_buffer" not in p:
        for k in list(p.keys()):
            if k in READ_ARG_ALIASES:
                p["filepath_or_buffer"] = p.pop(k)
                break
    return p

# ======================== Pipeline executor ========================

@app.post("/pipeline/run")
async def pipeline_run(
    # Accept BOTH names to be backward-compatible with the frontend
    yaml_text: Optional[str] = Form(None),
    yaml: Optional[str] = Form(None),
    preview_node: Optional[str] = Form(None),
    file: Optional[UploadFile] = None,
):
    raw_yaml = yaml_text if yaml_text is not None else yaml
    if not raw_yaml:
        raise HTTPException(status_code=400, detail="Missing 'yaml' string")

    try:
        spec = pyyaml.safe_load(raw_yaml) or {}
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid YAML: {e}")

    if not isinstance(spec, dict) or "nodes" not in spec or not isinstance(spec["nodes"], dict):
        raise HTTPException(status_code=400, detail="YAML must contain 'nodes' dict")

    nodes: Dict[str, Any] = spec["nodes"]
    executed: Dict[str, Any] = {}
    remaining = set(nodes.keys())

    uploaded_bytes = await file.read() if file else None

    while remaining:
        made_progress = False

        for node_id in list(remaining):
            node_def = nodes[node_id]
            func_name = node_def.get("function")
            raw_params = dict(node_def.get("params", {}))
            deps = list(node_def.get("dependencies", []))

            # unify IO params early so pandas won't complain
            raw_params = normalize_read_params(func_name, raw_params)

            # recognize indexers
            is_indexer = func_name in ("DataFrame.iloc", "DataFrame.loc")

            # Implicit deps: any param that looks like a node id
            implicit_refs = extract_param_node_refs(raw_params)
            all_deps = set(deps) | (implicit_refs & set(nodes.keys()))
            if any(d not in executed for d in all_deps):
                continue

            # Receiver for methods (self/df/left)
            recv = None
            if "self" in raw_params:
                k = raw_params["self"]
                recv = executed.get(k) if isinstance(k, str) else k
                raw_params.pop("self", None)
            elif "df" in raw_params:
                k = raw_params["df"]
                recv = executed.get(k) if isinstance(k, str) else k
                raw_params.pop("df", None)
            elif "left" in raw_params and func_name and func_name.endswith(".merge"):
                k = raw_params["left"]
                recv = executed.get(k) if isinstance(k, str) else k
                raw_params.pop("left", None)

            # read_* auto: feed uploaded file bytes (using canonical key)
            if uploaded_bytes is not None and is_read_function(func_name or ""):
                # ensure canonical key exists then override with BytesIO
                raw_params = normalize_read_params(func_name, raw_params)
                raw_params["filepath_or_buffer"] = BytesIO(uploaded_bytes)

            try:
                if is_indexer:
                    if recv is None:
                        raise HTTPException(status_code=400, detail=f"Node '{node_id}' ({func_name}) requires 'self' (a DataFrame/Series)")
                    iloc = (func_name == "DataFrame.iloc")
                    rows = _normalize_indexer(raw_params.pop("rows", None), iloc=iloc)
                    cols = _normalize_indexer(raw_params.pop("cols", None), iloc=iloc)
                    idxer = getattr(recv, "iloc" if iloc else "loc")
                    result = idxer[rows] if (cols is None or (isinstance(cols, slice) and cols == slice(None))) else idxer[rows, cols]
                else:
                    func = get_callable_from_name(func_name)
                    params = coerce_params(raw_params)
                    params = resolve_param_references(params, executed)

                    if func is pd.merge:
                        left_obj = params.pop("left", None)
                        right_obj = params.pop("right", None)
                        if isinstance(left_obj, str): left_obj = executed.get(left_obj)
                        if isinstance(right_obj, str): right_obj = executed.get(right_obj)
                        if left_obj is None or right_obj is None:
                            raise HTTPException(status_code=400, detail=f"Node '{node_id}': pd.merge requires left and right")
                        result = func(left_obj, right_obj, **params)
                    else:
                        if recv is not None:
                            result = func(recv, **params)
                        else:
                            result = func(**params)

            except HTTPException:
                raise
            except Exception as e:
                raise HTTPException(status_code=500, detail=f"Error executing node '{node_id}' ({func_name}): {e}")

            executed[node_id] = result
            remaining.remove(node_id)
            made_progress = True

            if preview_node and node_id == preview_node:
                return serialize_result(result)

        if not made_progress:
            raise HTTPException(status_code=400, detail="Pipeline has cyclic or unsatisfied dependencies.")

    last_key = list(executed.keys())[-1]
    return serialize_result(executed[last_key])

# ======================== Result serialization ========================

def serialize_result(result: Any):
    if isinstance(result, pd.DataFrame):
        return {"columns": list(result.columns), "rows": result.astype(str).values.tolist()}
    if isinstance(result, pd.Series):
        return {"columns": [result.name or "value"], "rows": [[str(v)] for v in result.values]}
    if isinstance(result, np.ndarray):
        return {"columns": ["value"], "rows": [[str(v)] for v in result.flatten()]}
    return {"columns": ["value"], "rows": [[str(result)]]}

# ======================== Search & details ========================

@app.get("/")
async def root():
    return {"ok": True}

@app.get("/healthz")
async def health():
    return {"status": "ready"}

@app.get("/pandas/functions")
async def functions_all():
    funcs, _ = get_index()
    return {"functions": funcs, "total_count": len(funcs)}

@app.get("/pandas/suggest")
async def suggest(q: Optional[str] = ""):
    _, names = get_index()
    if not q:
        return {"suggestions": names[:50]}
    q = q.lower()
    starts = [n for n in names if n.lower().startswith(q)]
    contains = [n for n in names if q in n.lower() and n not in starts]
    starts.sort(key=lambda n: (len(n), n.lower()))
    contains.sort(key=lambda n: (len(n), n.lower()))
    return {"suggestions": (starts + contains)[:100]}

@app.get("/pandas/search")
async def search(query: str):
    funcs, _ = get_index()
    q = (query or "").strip().lower()
    if not q:
        return {"functions": funcs[:50], "total_count": len(funcs)}
    results = []
    for f in funcs:
        name = f["name"]
        plain = name.split(".")[-1].lower()
        doc = (f.get("doc") or "").lower()
        cat = (f.get("category") or "").lower()
        score = 0
        if name.lower() == q or plain == q: score += 120
        elif name.lower().startswith(q) or plain.startswith(q): score += 90
        elif q in name.lower() or q in plain: score += 70
        elif q in doc: score += 25
        elif q in cat: score += 15
        if score:
            g = dict(f); g["relevance_score"] = score; results.append(g)
    results.sort(key=lambda x: x["relevance_score"], reverse=True)
    return {"functions": results[:50], "total_count": len(results)}

@app.get("/pandas/function/{function_name}")
async def function_details(function_name: str):
    if function_name in ("DataFrame.iloc", "DataFrame.loc", "iloc", "loc"):
        canonical = "DataFrame.iloc" if "iloc" in function_name else "DataFrame.loc"
        doc = "Integer-location based indexer." if canonical.endswith("iloc") else "Label-based indexer."
        return {
            "name": canonical,
            "doc": doc + " Use parameters: self, rows, cols.",
            "params": [
                {"name": "self", "kind": "POSITIONAL_OR_KEYWORD", "required": True},
                {"name": "rows", "kind": "POSITIONAL_OR_KEYWORD", "required": False, "default": None},
                {"name": "cols", "kind": "POSITIONAL_OR_KEYWORD", "required": False, "default": None},
            ],
            "module": "pandas.core.frame",
            "library": "pandas",
        }

    try:
        func = get_callable_from_name(function_name)
    except Exception as e:
        raise HTTPException(status_code=404, detail=str(e))
    if func is None:
        raise HTTPException(status_code=404, detail=f"Function '{function_name}' not found")
    info = get_function_signature(func)
    info["library"] = "pandas" if (info.get("module","").startswith("pandas")) else "numpy"
    return info

# ======================== NL → YAML ========================

_YAML_FENCE_RE = re.compile(r"```(?:yaml|yml)?\s*([\s\S]*?)```", re.IGNORECASE)
_YAML_DASH_RE  = re.compile(r"---\s*\n([\s\S]*?)\n(?:---|\Z)")

def _extract_yaml_block(text: str):
    for block in _YAML_FENCE_RE.findall(text or ""):
        try:
            spec = pyyaml.safe_load(block)
            if isinstance(spec, dict) and "nodes" in spec:
                return pyyaml.safe_dump(spec, sort_keys=False), spec
        except Exception:
            pass
    for block in _YAML_DASH_RE.findall(text or ""):
        try:
            spec = pyyaml.safe_load(block)
            if isinstance(spec, dict) and "nodes" in spec:
                return pyyaml.safe_dump(spec, sort_keys=False), spec
        except Exception:
            pass
    try:
        spec = pyyaml.safe_load(text)
        if isinstance(spec, dict) and "nodes" in spec:
            return pyyaml.safe_dump(spec, sort_keys=False), spec
    except Exception:
        pass
    return None, None

def _heuristic_nl_to_yaml(prompt: str) -> Optional[Dict[str, Any]]:
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

@app.post("/nl2yaml")
async def nl2yaml(
    prompt: str = Form(...),
    current_yaml: str = Form("nodes: {}"),
    mode: str = Form("append"),
):
    try:
        _ = pyyaml.safe_load(current_yaml) or {}
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid current_yaml: {e}")

    or_key = os.getenv("OPENROUTER_API_KEY", "").strip()
    ds_key = os.getenv("DEEPSEEK_API_KEY", "").strip()

    if not or_key and not ds_key:
        spec = _heuristic_nl_to_yaml(prompt)
        if not spec:
            raise HTTPException(status_code=400, detail="Heuristic NL→YAML couldn't understand the request. Configure OPENROUTER_API_KEY or DEEPSEEK_API_KEY for LLM mode.")
        return {"yaml": pyyaml.safe_dump(spec, sort_keys=False), "spec": spec, "mode": mode}

    guideline = (
        "Return ONLY YAML for a pipeline with this schema:\n"
        "nodes:\n"
        "  <id>:\n"
        "    function: <function id>\n"
        "    params: <dict>\n"
        "    dependencies: <list>\n\n"
        "- Use ids like read_csv_0, rename_1, iloc_2.\n"
        "- Use canonical ids: read_csv, DataFrame.rename, DataFrame.iloc, DataFrame.loc, merge, etc. Do NOT prefix with 'pandas.'.\n"
        "- Do not assume any default input. If a DataFrame.* method needs an input, you MUST set self: <some_node_id> explicitly.\n"
        "- For iloc/loc use rows/cols with Python-like slices (e.g., rows: 1:10, cols: \":\" or 0:2).\n"
        "- No prose, no fences — YAML only."
    )
    user_msg = f"CURRENT YAML:\n{current_yaml}\n\nREQUEST:\n{prompt}\n\n{guideline}"

    text = None
    try:
        if or_key:
            url = "https://openrouter.ai/api/v1/chat/completions"
            model = os.getenv("OPENROUTER_MODEL", "deepseek/deepseek-r1-0528:free")
            headers = {
                "Authorization": f"Bearer {or_key}",
                "Content-Type": "application/json",
            }
            site_url = os.getenv("OPENROUTER_SITE_URL", "")
            site_name = os.getenv("OPENROUTER_SITE_NAME", "")
            if site_url: headers["HTTP-Referer"] = site_url
            if site_name: headers["X-Title"] = site_name

            payload = {
                "model": model,
                "messages": [
                    {"role": "system", "content": "You convert user requests into YAML pipeline specs. Output YAML only."},
                    {"role": "user", "content": user_msg},
                ],
                "temperature": 0.2,
            }
            r = requests.post(url, headers=headers, data=json.dumps(payload), timeout=60)
            if r.status_code == 401: raise HTTPException(status_code=401, detail=f"OpenRouter auth error: {r.text}")
            if r.status_code >= 400: raise HTTPException(status_code=r.status_code, detail=f"OpenRouter error: {r.text}")
            obj = r.json()
            text = obj.get("choices", [{}])[0].get("message", {}).get("content", "")
        else:
            url = os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com")
            model = os.getenv("DEEPSEEK_MODEL", "deepseek-chat")
            headers = {
                "Authorization": f"Bearer {ds_key}",
                "Content-Type": "application/json",
            }
            payload = {
                "model": model,
                "messages": [
                    {"role": "system", "content": "You convert user requests into YAML pipeline specs. Output YAML only."},
                    {"role": "user", "content": user_msg},
                ],
                "temperature": 0.2,
            }
            r = requests.post(f"{url}/chat/completions", headers=headers, data=json.dumps(payload), timeout=60)
            if r.status_code == 401: raise HTTPException(status_code=401, detail=f"DeepSeek error: {r.text}")
            if r.status_code >= 400: raise HTTPException(status_code=r.status_code, detail=f"DeepSeek error: {r.text}")
            obj = r.json()
            text = obj.get("choices", [{}])[0].get("message", {}).get("content", "")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"LLM request failed: {e}")

    yaml_out, spec = _extract_yaml_block(text or "")
    if not spec:
        raise HTTPException(status_code=502, detail=f"Model did not return valid YAML.\n---\n{text}\n---")

    # normalize read param names in the returned spec, too
    if isinstance(spec, dict) and "nodes" in spec:
        for nid, node in (spec.get("nodes") or {}).items():
            fn = node.get("function")
            node["params"] = normalize_read_params(fn, node.get("params") or {})
            spec["nodes"][nid] = node

    return {"yaml": yaml_out, "spec": spec, "mode": mode}

# ======================== Main ========================

if __name__ == "__main__":
    # Run with: uvicorn main:app --reload --host 0.0.0.0 --port 8000
    uvicorn.run(app, host="0.0.0.0", port=8000)
