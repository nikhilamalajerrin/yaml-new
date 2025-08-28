# """
# Tharavu Dappa Backend — Light index + Robust pipeline executor + NL→YAML
# - /pandas/search + /pandas/suggest include synthetic DataFrame.iloc / DataFrame.loc
# - /pipeline/run executes pipelines with param coercion & reference resolution
# - Special handling for .iloc / .loc accepts Python-like slice text (1:10, :, 0:2, lists…)
# - /nl2yaml converts natural language to YAML (OpenRouter DeepSeek or heuristic fallback)
# - /pipelines/save, /pipelines (per-user), /stats (per-user), /pipelines/{id}
# """

# import os
# import re
# import json
# import inspect
# import importlib
# from functools import lru_cache
# from typing import Any, Dict, List, Optional, Tuple, Set
# from pathlib import Path
# import requests
# import numpy as np
# import pandas as pd
# from fastapi import FastAPI, HTTPException, UploadFile, Form, Header, Request
# from fastapi.middleware.cors import CORSMiddleware
# import uvicorn
# import yaml as pyyaml
# from io import BytesIO
# from vanna_router import router as vanna_router, auto_connect_from_env
# app = FastAPI(title="Tharavu Dappa Backend", version="3.6.0")

# app.add_middleware(
#     CORSMiddleware,
#     allow_origins=["*"],
#     allow_credentials=True,
#     allow_methods=["*"],
#     allow_headers=["*"],
# )
# # === Shared file upload for GenBI ===
# from pathlib import Path
# import unicodedata, string

# # Host folder that is mounted into ibis-server at /usr/src/app/data
# # Keep this the SAME as ${LOCAL_STORAGE} used in docker-compose for ibis-server.
# LOCAL_STORAGE = os.getenv("LOCAL_STORAGE", ".")
# DATA_ROOT = Path(LOCAL_STORAGE).resolve()
# UPLOADS_DIR = (DATA_ROOT / "uploads")
# UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
# app.include_router(vanna_router)
# # Path INSIDE the ibis-server container
# IBIS_DATA_PATH = "/usr/src/app/data"

# def _safe_filename(name: str) -> str:
#     keep = f"-_.() {string.ascii_letters}{string.digits}"
#     cleaned = "".join(c for c in unicodedata.normalize("NFKD", name) if c in keep).strip().replace(" ", "_")
#     return cleaned or "file"

# @app.on_event("startup")
# async def _startup():
#     auto_connect_from_env()

# @app.post("/files/upload")
# async def files_upload(file: UploadFile):
#     """
#     Save an uploaded file to a host folder that ibis-server can read.
#     Returns an MDL snippet you can drop into GenBI Lab directly.
#     """
#     if not file or not file.filename:
#         raise HTTPException(status_code=400, detail="No file provided")

#     fname = _safe_filename(file.filename)
#     dest = UPLOADS_DIR / fname
#     data = await file.read()
#     dest.write_bytes(data)

#     # Where the ibis container will see it
#     ibis_abs = f"{IBIS_DATA_PATH}/uploads/{fname}"
#     # DuckDB/ibis can read a csv directly:
#     ref_sql = f"select * from read_csv_auto('{ibis_abs}')"

#     mdl = {
#         "catalog": "local",
#         "schema": "public",
#         "models": [
#             {"name": Path(fname).stem, "refSql": ref_sql}
#         ],
#     }

#     return {
#         "ok": True,
#         "filename": fname,
#         "saved_to": str(dest),         # host path
#         "ibis_path": ibis_abs,         # path inside ibis container
#         "refSql": ref_sql,
#         "mdl": mdl,
#     }


# def _callable(x) -> bool:
#     try:
#         return callable(x) and not inspect.isclass(x)
#     except Exception:
#         return False

# def _safe_sig(obj):
#     try:
#         return inspect.signature(obj)
#     except Exception:
#         return None

# def get_function_signature(func: Any) -> Dict[str, Any]:
#     sig = _safe_sig(func)
#     params = []
#     if sig:
#         for name, p in sig.parameters.items():
#             params.append({
#                 "name": name,
#                 "kind": str(p.kind),
#                 "required": p.default == inspect.Parameter.empty,
#                 "default": None if p.default == inspect.Parameter.empty else repr(p.default),
#                 "annotation": None if p.annotation == inspect.Parameter.empty else str(p.annotation),
#             })
#     return {
#         "name": getattr(func, "__name__", "unknown"),
#         "doc": inspect.getdoc(func) or "No documentation available",
#         "params": params,
#         "module": getattr(func, "__module__", "unknown"),
#     }

# def _add(functions: List[Dict[str, Any]], names: Set[str],
#          obj: Any, suggestion: str, library: str, category: str, canonical: str):
#     info = get_function_signature(obj)
#     info["library"] = library
#     info["category"] = category
#     info["name"] = canonical
#     functions.append(info)
#     names.add(suggestion)

# def _add_synthetic(functions: List[Dict[str, Any]], names: Set[str],
#                    canonical: str, doc: str, params: List[Dict[str, Any]],
#                    library="pandas", category="DataFrame"):
#     info = {
#         "name": canonical,
#         "doc": doc,
#         "params": params,
#         "module": "pandas.core.frame",
#         "library": library,
#         "category": category,
#     }
#     functions.append(info)
#     short = canonical.split(".")[-1]
#     names.add(short)
#     names.add(canonical)

# def _collect_light() -> Tuple[List[Dict[str, Any]], List[str]]:
#     functions: List[Dict[str, Any]] = []
#     suggestions: Set[str] = set()

#     # pandas top-level
#     for name in dir(pd):
#         if name.startswith("_"): continue
#         try:
#             obj = getattr(pd, name)
#         except Exception:
#             continue
#         if _callable(obj):
#             _add(functions, suggestions, obj, name, "pandas", "pandas", name)

#     # key pandas classes/methods
#     for cls in filter(None, [getattr(pd,"DataFrame",None),
#                              getattr(pd,"Series",None),
#                              getattr(pd,"Index",None),
#                              getattr(pd,"Categorical",None)]):
#         cls_name = getattr(cls, "__name__", "PandasClass")
#         for m in dir(cls):
#             if m.startswith("_"): continue
#             try:
#                 meth = getattr(cls, m)
#             except Exception:
#                 continue
#             if _callable(meth):
#                 _add(functions, suggestions, meth, m, "pandas", cls_name, f"{cls_name}.{m}")
#                 suggestions.add(f"{cls_name}.{m}")

#     # synthetic indexers for search
#     _add_synthetic(
#         functions, suggestions,
#         "DataFrame.iloc",
#         "Integer-location based indexer: use rows/cols with ints, slices '1:10', lists '0,2,4'.",
#         [
#             {"name": "self", "kind": "POSITIONAL_OR_KEYWORD", "required": True},
#             {"name": "rows", "kind": "POSITIONAL_OR_KEYWORD", "required": False, "default": None},
#             {"name": "cols", "kind": "POSITIONAL_OR_KEYWORD", "required": False, "default": None},
#         ],
#     )
#     _add_synthetic(
#         functions, suggestions,
#         "DataFrame.loc",
#         "Label-based indexer: use rows/cols with labels, slices ':', lists, booleans.",
#         [
#             {"name": "self", "kind": "POSITIONAL_OR_KEYWORD", "required": True},
#             {"name": "rows", "kind": "POSITIONAL_OR_KEYWORD", "required": False, "default": None},
#             {"name": "cols", "kind": "POSITIONAL_OR_KEYWORD", "required": False, "default": None},
#         ],
#     )

#     # pandas submodules (light)
#     for sub in ("io", "plotting"):
#         try:
#             submod = getattr(pd, sub)
#             for a in dir(submod):
#                 if a.startswith("_"): continue
#                 try:
#                     obj = getattr(submod, a)
#                 except Exception:
#                     continue
#                 if _callable(obj):
#                     _add(functions, suggestions, obj, a, "pandas", f"pandas.{sub}", f"{sub}.{a}")
#                     suggestions.add(f"{sub}.{a}")
#         except Exception:
#             pass

#     # numpy top-level + light submodules
#     for a in dir(np):
#         if a.startswith("_"): continue
#         try:
#             obj = getattr(np, a)
#         except Exception:
#             continue
#         if _callable(obj):
#             _add(functions, suggestions, obj, a, "numpy", "NumPy", a)
#     for sub in ("linalg", "random", "fft"):
#         try:
#             submod = getattr(np, sub)
#             for a in dir(submod):
#                 if a.startswith("_"): continue
#                 try:
#                     obj = getattr(submod, a)
#                 except Exception:
#                     continue
#                 if _callable(obj):
#                     _add(functions, suggestions, obj, f"{sub}.{a}", "numpy", f"numpy.{sub}", f"{sub}.{a}")
#                     suggestions.add(a)
#         except Exception:
#             pass

#     seen = set()
#     out = []
#     for f in functions:
#         key = (f.get("library"), f.get("name"))
#         if key in seen: continue
#         seen.add(key); out.append(f)
#     return out, sorted(suggestions)

# @lru_cache(maxsize=1)
# def get_index() -> Tuple[List[Dict[str, Any]], List[str]]:
#     return _collect_light()

# # ======================== Function resolution ========================

# def get_callable_from_name(func_name: str):
#     """Resolve a pandas/numpy function or pandas method by canonical/name."""
#     # module path (pandas.x.y or numpy.x.y)
#     if func_name.startswith("pandas.") or func_name.startswith("numpy."):
#         parts = func_name.split(".")
#         for cut in range(len(parts), 0, -1):
#             mod_name = ".".join(parts[:cut])
#             try:
#                 mod = importlib.import_module(mod_name)
#                 obj = mod
#                 ok = True
#                 for p in parts[cut:]:
#                     if not hasattr(obj, p):
#                         ok = False; break
#                     obj = getattr(obj, p)
#                 if ok and _callable(obj):
#                     return obj
#             except Exception:
#                 continue

#     # short submodule form like "linalg.norm" or "plotting.scatter_matrix"
#     if "." in func_name:
#         head, tail = func_name.split(".", 1)
#         if hasattr(np, head):
#             sub = getattr(np, head)
#             if hasattr(sub, tail):
#                 cand = getattr(sub, tail)
#                 if _callable(cand): return cand
#         if hasattr(pd, head):
#             sub = getattr(pd, head)
#             if hasattr(sub, tail):
#                 cand = getattr(sub, tail)
#                 if _callable(cand): return cand

#     # pandas top-level
#     if hasattr(pd, func_name):
#         cand = getattr(pd, func_name)
#         if _callable(cand): return cand

#     # pandas methods like "DataFrame.rename"
#     pandas_classes = {
#         "DataFrame": getattr(pd, "DataFrame", None),
#         "Series": getattr(pd, "Series", None),
#         "Index": getattr(pd, "Index", None),
#         "Categorical": getattr(pd, "Categorical", None),
#     }
#     if "." in func_name:
#         cls_name, meth = func_name.split(".", 1)
#         # .iloc / .loc are not callables — handled specially by executor
#         if cls_name == "DataFrame" and meth in ("iloc", "loc"):
#             return None
#         cls = pandas_classes.get(cls_name)
#         if cls and hasattr(cls, meth):
#             cand = getattr(cls, meth)
#             if _callable(cand): return cand

#     # numpy top-level
#     if hasattr(np, func_name):
#         cand = getattr(np, func_name)
#         if _callable(cand): return cand

#     raise ValueError(f"Function '{func_name}' not found")

# # ======================== Param coercion & indexer parsing ========================

# _slice_re = re.compile(r"^\s*-?\d*\s*:\s*-?\d*(\s*:\s*-?\d*)?\s*$")  # 1:10, :10, 1:, 1:10:2, :

# def _looks_like_mapping_str(s: str) -> bool:
#     """True for 'OLD:NEW' style, but NOT for slice-like text ('1:10', ':')."""
#     s = s.strip()
#     if _slice_re.match(s):
#         return False
#     return ":" in s and not (s.startswith("{") and s.endswith("}"))

# def _looks_like_list_str(s: str) -> bool:
#     st = s.strip()
#     return "," in st or (st.startswith("[") and st.endswith("]"))

# def _try_yaml_or_json_scalar(s: str) -> Any:
#     try:
#         return pyyaml.safe_load(s)
#     except Exception:
#         return s

# def _coerce_value(v: Any) -> Any:
#     if isinstance(v, str):
#         sv = v.strip()
#         if _looks_like_mapping_str(sv) and ("\n" not in sv):
#             left, _, right = sv.partition(":")
#             if left and right:
#                 return {left.strip(): right.strip()}
#         if _looks_like_list_str(sv):
#             if sv.startswith("[") and sv.endswith("]"):
#                 return _try_yaml_or_json_scalar(sv)
#             else:
#                 return [s.strip() for s in sv.split(",") if s.strip()]
#         return _try_yaml_or_json_scalar(sv)
#     return v

# def coerce_params(params: Dict[str, Any]) -> Dict[str, Any]:
#     return {k: _coerce_value(v) for k, v in params.items()}

# def extract_param_node_refs(params: Dict[str, Any]) -> Set[str]:
#     refs = set()
#     for v in params.values():
#         if isinstance(v, str):
#             refs.add(v)
#         elif isinstance(v, (list, tuple)):
#             for x in v:
#                 if isinstance(x, str):
#                     refs.add(x)
#         elif isinstance(v, dict):
#             for x in v.values():
#                 if isinstance(x, str):
#                     refs.add(x)
#     return refs

# def resolve_param_references(params: Dict[str, Any], executed: Dict[str, Any]) -> Dict[str, Any]:
#     def resolve(v):
#         if isinstance(v, str) and v in executed:
#             return executed[v]
#         if isinstance(v, list):
#             return [resolve(x) for x in v]
#         if isinstance(v, tuple):
#             return tuple(resolve(x) for x in v)
#         if isinstance(v, dict):
#             return {k: resolve(x) for k, x in v.items()}
#         return v
#     return {k: resolve(v) for k, v in params.items()}

# def _to_int_or_none(x):
#     if x is None or x == "":
#         return None
#     try:
#         return int(x)
#     except Exception:
#         raise ValueError(f"Expected integer in slice, got {x!r}")

# def _parse_slice_like_text(s: str) -> slice:
#     s = s.strip()
#     if s == ":":
#         return slice(None)
#     parts = [p.strip() for p in s.split(":")]
#     if len(parts) == 2:
#         return slice(_to_int_or_none(parts[0]), _to_int_or_none(parts[1]))
#     if len(parts) == 3:
#         return slice(_to_int_or_none(parts[0]), _to_int_or_none(parts[1]), _to_int_or_none(parts[2]))
#     raise ValueError(f"Bad slice text: {s!r}")

# def _normalize_indexer(v: Any, *, iloc: bool):
#     if v is None:
#         return slice(None)
#     if isinstance(v, dict) and len(v) == 1:  # YAML unquoted 1:10 => {1:10}
#         (k, val), = v.items()
#         return slice(_to_int_or_none(str(k)), _to_int_or_none(str(val)))
#     if isinstance(v, int):
#         return v
#     if isinstance(v, list):
#         return [int(x) for x in v] if iloc else v
#     if isinstance(v, str):
#         s = v.strip()
#         if _slice_re.match(s):
#             return _parse_slice_like_text(s)
#         if s.startswith("[") and s.endswith("]"):
#             arr = pyyaml.safe_load(s)
#             return [int(x) for x in arr] if iloc else arr
#         if "," in s:
#             parts = [p.strip() for p in s.split(",") if p.strip() != ""]
#             return [int(p) for p in parts] if iloc else parts
#         try:
#             return int(s) if iloc else (int(s) if s.isdigit() else s)
#         except Exception:
#             return s
#     return v

# # ======================== IO param normalization ========================

# READ_ARG_ALIASES = {
#     "filepath": "filepath_or_buffer",
#     "file_path": "filepath_or_buffer",
#     "path": "filepath_or_buffer",
#     "path_or_buf": "filepath_or_buffer",
#     "io": "filepath_or_buffer",
# }

# def is_read_function(func_name: str) -> bool:
#     if not func_name:
#         return False
#     fn = func_name.split(".")[-1]
#     return fn.startswith("read_") or fn in {
#         "read_csv", "read_json", "read_excel", "read_parquet", "read_feather",
#         "read_pickle", "read_html", "read_xml", "read_table"
#     }

# def normalize_read_params(func_name: str, params: Dict[str, Any]) -> Dict[str, Any]:
#     if not isinstance(params, dict) or not is_read_function(func_name):
#         return params
#     p = dict(params)
#     if "filepath_or_buffer" not in p:
#         for k in list(p.keys()):
#             if k in READ_ARG_ALIASES:
#                 p["filepath_or_buffer"] = p.pop(k)
#                 break
#     return p

# # ======================== Pipeline executor ========================

# @app.post("/pipeline/run")
# async def pipeline_run(
#     # Accept BOTH names to be backward-compatible with the frontend
#     yaml_text: Optional[str] = Form(None),
#     yaml: Optional[str] = Form(None),
#     preview_node: Optional[str] = Form(None),
#     file: Optional[UploadFile] = None,
# ):
#     raw_yaml = yaml_text if yaml_text is not None else yaml
#     if not raw_yaml:
#         raise HTTPException(status_code=400, detail="Missing 'yaml' string")

#     try:
#         spec = pyyaml.safe_load(raw_yaml) or {}
#     except Exception as e:
#         raise HTTPException(status_code=400, detail=f"Invalid YAML: {e}")

#     if not isinstance(spec, dict) or "nodes" not in spec or not isinstance(spec["nodes"], dict):
#         raise HTTPException(status_code=400, detail="YAML must contain 'nodes' dict")

#     nodes: Dict[str, Any] = spec["nodes"]
#     executed: Dict[str, Any] = {}
#     remaining = set(nodes.keys())

#     uploaded_bytes = await file.read() if file else None

#     while remaining:
#         made_progress = False

#         for node_id in list(remaining):
#             node_def = nodes[node_id]
#             func_name = node_def.get("function")
#             raw_params = dict(node_def.get("params", {}))
#             deps = list(node_def.get("dependencies", []))

#             # unify IO params early so pandas won't complain
#             raw_params = normalize_read_params(func_name, raw_params)

#             # recognize indexers
#             is_indexer = func_name in ("DataFrame.iloc", "DataFrame.loc")

#             # Implicit deps: any param that looks like a node id
#             implicit_refs = extract_param_node_refs(raw_params)
#             all_deps = set(deps) | (implicit_refs & set(nodes.keys()))
#             if any(d not in executed for d in all_deps):
#                 continue

#             # Receiver for methods (self/df/left)
#             recv = None
#             if "self" in raw_params:
#                 k = raw_params["self"]
#                 recv = executed.get(k) if isinstance(k, str) else k
#                 raw_params.pop("self", None)
#             elif "df" in raw_params:
#                 k = raw_params["df"]
#                 recv = executed.get(k) if isinstance(k, str) else k
#                 raw_params.pop("df", None)
#             elif "left" in raw_params and func_name and func_name.endswith(".merge"):
#                 k = raw_params["left"]
#                 recv = executed.get(k) if isinstance(k, str) else k
#                 raw_params.pop("left", None)

#             # read_* auto: feed uploaded file bytes (using canonical key)
#             if uploaded_bytes is not None and is_read_function(func_name or ""):
#                 # ensure canonical key exists then override with BytesIO
#                 raw_params = normalize_read_params(func_name, raw_params)
#                 raw_params["filepath_or_buffer"] = BytesIO(uploaded_bytes)

#             try:
#                 if is_indexer:
#                     if recv is None:
#                         raise HTTPException(status_code=400, detail=f"Node '{node_id}' ({func_name}) requires 'self' (a DataFrame/Series)")
#                     iloc = (func_name == "DataFrame.iloc")
#                     rows = _normalize_indexer(raw_params.pop("rows", None), iloc=iloc)
#                     cols = _normalize_indexer(raw_params.pop("cols", None), iloc=iloc)
#                     idxer = getattr(recv, "iloc" if iloc else "loc")
#                     result = idxer[rows] if (cols is None or (isinstance(cols, slice) and cols == slice(None))) else idxer[rows, cols]
#                 else:
#                     func = get_callable_from_name(func_name)
#                     params = coerce_params(raw_params)
#                     params = resolve_param_references(params, executed)

#                     if func is pd.merge:
#                         left_obj = params.pop("left", None)
#                         right_obj = params.pop("right", None)
#                         if isinstance(left_obj, str): left_obj = executed.get(left_obj)
#                         if isinstance(right_obj, str): right_obj = executed.get(right_obj)
#                         if left_obj is None or right_obj is None:
#                             raise HTTPException(status_code=400, detail=f"Node '{node_id}': pd.merge requires left and right")
#                         result = func(left_obj, right_obj, **params)
#                     else:
#                         if recv is not None:
#                             result = func(recv, **params)
#                         else:
#                             result = func(**params)

#             except HTTPException:
#                 raise
#             except Exception as e:
#                 raise HTTPException(status_code=500, detail=f"Error executing node '{node_id}' ({func_name}): {e}")

#             executed[node_id] = result
#             remaining.remove(node_id)
#             made_progress = True

#             if preview_node and node_id == preview_node:
#                 return serialize_result(result)

#         if not made_progress:
#             raise HTTPException(status_code=400, detail="Pipeline has cyclic or unsatisfied dependencies.")

#     last_key = list(executed.keys())[-1]
#     return serialize_result(executed[last_key])

# # ======================== Result serialization ========================

# def serialize_result(result: Any):
#     if isinstance(result, pd.DataFrame):
#         return {"columns": list(result.columns), "rows": result.astype(str).values.tolist()}
#     if isinstance(result, pd.Series):
#         return {"columns": [result.name or "value"], "rows": [[str(v)] for v in result.values]}
#     if isinstance(result, np.ndarray):
#         return {"columns": ["value"], "rows": [[str(v)] for v in result.flatten()]}
#     return {"columns": ["value"], "rows": [[str(result)]]}

# # ======================== Search & details ========================

# @app.get("/")
# async def root():
#     return {"ok": True}

# @app.get("/healthz")
# async def health():
#     return {"status": "ready"}

# @app.get("/pandas/functions")
# async def functions_all():
#     funcs, _ = get_index()
#     return {"functions": funcs, "total_count": len(funcs)}

# @app.get("/pandas/suggest")
# async def suggest(q: Optional[str] = ""):
#     _, names = get_index()
#     if not q:
#         return {"suggestions": names[:50]}
#     q = q.lower()
#     starts = [n for n in names if n.lower().startswith(q)]
#     contains = [n for n in names if q in n.lower() and n not in starts]
#     starts.sort(key=lambda n: (len(n), n.lower()))
#     contains.sort(key=lambda n: (len(n), n.lower()))
#     return {"suggestions": (starts + contains)[:100]}

# @app.get("/pandas/search")
# async def search(query: str):
#     funcs, _ = get_index()
#     q = (query or "").strip().lower()
#     if not q:
#         return {"functions": funcs[:50], "total_count": len(funcs)}
#     results = []
#     for f in funcs:
#         name = f["name"]
#         plain = name.split(".")[-1].lower()
#         doc = (f.get("doc") or "").lower()
#         cat = (f.get("category") or "").lower()
#         score = 0
#         if name.lower() == q or plain == q: score += 120
#         elif name.lower().startswith(q) or plain.startswith(q): score += 90
#         elif q in name.lower() or q in plain: score += 70
#         elif q in doc: score += 25
#         elif q in cat: score += 15
#         if score:
#             g = dict(f); g["relevance_score"] = score; results.append(g)
#     results.sort(key=lambda x: x["relevance_score"], reverse=True)
#     return {"functions": results[:50], "total_count": len(results)}

# @app.get("/pandas/function/{function_name}")
# async def function_details(function_name: str):
#     if function_name in ("DataFrame.iloc", "DataFrame.loc", "iloc", "loc"):
#         canonical = "DataFrame.iloc" if "iloc" in function_name else "DataFrame.loc"
#         doc = "Integer-location based indexer." if canonical.endswith("iloc") else "Label-based indexer."
#         return {
#             "name": canonical,
#             "doc": doc + " Use parameters: self, rows, cols.",
#             "params": [
#                 {"name": "self", "kind": "POSITIONAL_OR_KEYWORD", "required": True},
#                 {"name": "rows", "kind": "POSITIONAL_OR_KEYWORD", "required": False, "default": None},
#                 {"name": "cols", "kind": "POSITIONAL_OR_KEYWORD", "required": False, "default": None},
#             ],
#             "module": "pandas.core.frame",
#             "library": "pandas",
#         }

#     try:
#         func = get_callable_from_name(function_name)
#     except Exception as e:
#         raise HTTPException(status_code=404, detail=str(e))
#     if func is None:
#         raise HTTPException(status_code=404, detail=f"Function '{function_name}' not found")
#     info = get_function_signature(func)
#     info["library"] = "pandas" if (info.get("module","").startswith("pandas")) else "numpy"
#     return info

# # ======================== NL → YAML ========================

# _YAML_FENCE_RE = re.compile(r"```(?:yaml|yml)?\s*([\s\S]*?)```", re.IGNORECASE)
# _YAML_DASH_RE  = re.compile(r"---\s*\n([\s\S]*?)\n(?:---|\Z)")

# def _extract_yaml_block(text: str):
#     for block in _YAML_FENCE_RE.findall(text or ""):
#         try:
#             spec = pyyaml.safe_load(block)
#             if isinstance(spec, dict) and "nodes" in spec:
#                 return pyyaml.safe_dump(spec, sort_keys=False), spec
#         except Exception:
#             pass
#     for block in _YAML_DASH_RE.findall(text or ""):
#         try:
#             spec = pyyaml.safe_load(block)
#             if isinstance(spec, dict) and "nodes" in spec:
#                 return pyyaml.safe_dump(spec, sort_keys=False), spec
#         except Exception:
#             pass
#     try:
#         spec = pyyaml.safe_load(text)
#         if isinstance(spec, dict) and "nodes" in spec:
#             return pyyaml.safe_dump(spec, sort_keys=False), spec
#     except Exception:
#         pass
#     return None, None

# def _heuristic_nl_to_yaml(prompt: str) -> Optional[Dict[str, Any]]:
#     p = (prompt or "").lower()
#     if "read" in p and ".csv" in p:
#         m = re.search(r"([A-Za-z0-9_\-\.]+\.csv)", prompt)
#         fname = m.group(1) if m else "data.csv"
#         return {
#             "nodes": {
#                 "read_csv_0": {
#                     "function": "read_csv",
#                     "params": {"filepath_or_buffer": fname},
#                     "dependencies": [],
#                 }
#             }
#         }
#     return None

# @app.post("/nl2yaml")
# async def nl2yaml(
#     prompt: str = Form(...),
#     # accept all aliases from various frontends
#     yaml_text: Optional[str] = Form(None),
#     yaml: Optional[str] = Form(None),
#     current_yaml: Optional[str] = Form(None),
#     mode: str = Form("append"),
#     receiver: Optional[str] = Form(None),
# ):
#     # pick whichever YAML field we got
#     cur_yaml = (
#         yaml_text if yaml_text is not None
#         else (yaml if yaml is not None
#               else (current_yaml if current_yaml is not None else "nodes: {}"))
#     )

#     try:
#         cur_spec = pyyaml.safe_load(cur_yaml) or {}
#         if not isinstance(cur_spec, dict): cur_spec = {}
#     except Exception as e:
#         raise HTTPException(status_code=400, detail=f"Invalid current YAML: {e}")

#     cur_nodes: Dict[str, Any] = dict(cur_spec.get("nodes") or {})
#     ordered = list(cur_nodes.keys())
#     last_id = ordered[-1] if ordered else None
#     recv = receiver or last_id  # we’ll prefer the user-sent receiver, else last node

#     # env
#     or_key = os.getenv("OPENROUTER_API_KEY", "").strip()
#     ds_key = os.getenv("DEEPSEEK_API_KEY", "").strip()

#     # -------- helpers used below ---------------------------------------------

#     def _canonicalize(spec: Dict[str, Any]) -> Dict[str, Any]:
#         READ_PARAM_ALIASES = {
#             "filepath": "filepath_or_buffer",
#             "file_path": "filepath_or_buffer",
#             "path": "filepath_or_buffer",
#             "path_or_buf": "filepath_or_buffer",
#             "io": "filepath_or_buffer",
#         }
#         def is_read(fn: Optional[str]) -> bool:
#             if not fn: return False
#             base = fn.split(".")[-1]
#             return base.startswith("read_") or base in {
#                 "read_csv","read_json","read_excel","read_parquet","read_feather",
#                 "read_pickle","read_html","read_xml","read_table"
#             }
#         out = {"nodes": {}}
#         for nid, node in (spec.get("nodes") or {}).items():
#             node = dict(node or {})
#             fn = node.get("function")
#             if isinstance(fn, str):
#                 if fn.startswith("pandas."): fn = fn[7:]
#                 if fn.startswith("numpy."):  fn = fn[6:]
#                 if fn.endswith(".rename") and not fn.startswith("DataFrame."): fn = "DataFrame.rename"
#                 if fn.endswith(".iloc")   and not fn.startswith("DataFrame."): fn = "DataFrame.iloc"
#                 if fn.endswith(".loc")    and not fn.startswith("DataFrame."): fn = "DataFrame.loc"
#             params = dict(node.get("params") or {})
#             if is_read(fn) and "filepath_or_buffer" not in params:
#                 for k in list(params.keys()):
#                     if k in READ_PARAM_ALIASES:
#                         params["filepath_or_buffer"] = params.pop(k); break
#             node["function"] = fn
#             node["params"] = params
#             out["nodes"][nid] = node
#         return out

#     def _rewrite(o, old_id, new_id):
#         if isinstance(o, str): return new_id if o == old_id else o
#         if isinstance(o, list): return [_rewrite(x, old_id, new_id) for x in o]
#         if isinstance(o, dict): return {k: _rewrite(v, old_id, new_id) for k, v in o.items()}
#         return o

#     def _inject_receiver(spec: Dict[str, Any], recv_id: Optional[str]) -> Dict[str, Any]:
#         if not recv_id: return spec
#         out = {"nodes": {}}
#         for nid, node in (spec.get("nodes") or {}).items():
#             node = dict(node or {})
#             fn = node.get("function")
#             params = dict(node.get("params") or {})
#             deps = list(node.get("dependencies") or [])
#             needs_self = isinstance(fn, str) and (fn.startswith("DataFrame.") or fn in ("DataFrame.iloc","DataFrame.loc"))
#             has_self  = any(k in params for k in ("self","df","left"))
#             if needs_self:
#                 # If no valid self or self points to a node NOT in the current graph,
#                 # force it to continue from recv_id.
#                 sref = params.get("self") or params.get("df") or params.get("left")
#                 if (not has_self) or (isinstance(sref, str) and sref not in cur_nodes):
#                     params["self"] = recv_id
#                     if recv_id not in deps: deps.append(recv_id)
#             node["params"] = params
#             node["dependencies"] = deps
#             out["nodes"][nid] = node
#         return out

#     def _dedupe_receiver_clone(spec: Dict[str, Any], recv_id: Optional[str]) -> Dict[str, Any]:
#         """If the model recreated the receiver step (same function+params minus self),
#            drop the clone and rewrite all refs to the original receiver."""
#         if not recv_id: return spec
#         recv_node = cur_nodes.get(recv_id)
#         if not isinstance(recv_node, dict): return spec

#         base_fn = recv_node.get("function")
#         base_params = dict(recv_node.get("params") or {})
#         base_params_no_self = {k: v for k, v in base_params.items() if k != "self"}

#         drop_ids = []
#         for nid, node in (spec.get("nodes") or {}).items():
#             fn = node.get("function")
#             params = dict(node.get("params") or {})
#             params_no_self = {k: v for k, v in params.items() if k != "self"}
#             if fn == base_fn and params_no_self == base_params_no_self:
#                 drop_ids.append(nid)

#         if not drop_ids:
#             return spec

#         # rewrite all references to the dropped nodes → recv_id, then delete them
#         patched = {"nodes": {}}
#         for nid, node in (spec.get("nodes") or {}).items():
#             if nid in drop_ids:
#                 continue
#             node = dict(node or {})
#             node["params"] = node.get("params") or {}
#             for did in drop_ids:
#                 node["params"] = _rewrite(node["params"], did, recv_id)
#                 node["dependencies"] = list(_rewrite(node.get("dependencies") or [], did, recv_id))
#             patched["nodes"][nid] = node
#         return patched

#     # -------- heuristic path (no keys) ----------------------------------------
#     def _heuristic(prompt_text: str) -> Optional[Dict[str, Any]]:
#         p = (prompt_text or "").lower()
#         if "read" in p and ".csv" in p:
#             m = re.search(r"([A-Za-z0-9_\-\.]+\.csv)", prompt_text)
#             fname = m.group(1) if m else "data.csv"
#             return {"nodes": {"read_csv_0": {"function":"read_csv","params":{"filepath_or_buffer": fname},"dependencies":[]}}}
#         if "row" in p or "column" in p or "iloc" in p or "slice" in p:
#             # very light iloc guess
#             return {"nodes": {"iloc_0": {"function":"DataFrame.iloc","params":{"rows":"0:5","cols":"0:3"},"dependencies":[recv] if recv else []}}}
#         return None

#     # -------- build instruction & call model ----------------------------------
#     guideline = [
#         "Return ONLY YAML for a pipeline with this schema:",
#         "nodes:",
#         "  <id>:",
#         "    function: <function id>",
#         "    params: <dict>",
#         "    dependencies: <list>",
#         "",
#         "- Use ids like read_csv_0, rename_1, iloc_2.",
#         "- Use canonical ids: read_csv, DataFrame.rename, DataFrame.iloc, DataFrame.loc, merge, etc. Do NOT prefix with 'pandas.'.",
#         "- Do not assume any default input.",
#         "- Do NOT recreate or duplicate steps that already exist; only add the new steps requested.",
#     ]
#     if recv:
#         guideline.append(f"- Continue from the existing node {recv}. For any DataFrame.* operation, set `self: {recv}` and depend on {recv}, unless the user explicitly names a different input.")
#     guideline.append('- For iloc/loc use rows/cols with Python-like slices (e.g., rows: 1:10, cols: ":" or 0:2).')
#     guideline.append("- No prose, no fences — YAML only.")
#     guideline_text = "\n".join(guideline)

#     user_msg = f"CURRENT YAML:\n{cur_yaml}\n\nREQUEST:\n{prompt}\n\n{guideline_text}"

#     text = None
#     if not or_key and not ds_key:
#         # heuristic only
#         spec = _heuristic(prompt)
#         if not spec:
#             raise HTTPException(status_code=400, detail="Heuristic NL→YAML couldn't understand the request. Configure OPENROUTER_API_KEY or DEEPSEEK_API_KEY for LLM mode.")
#     else:
#         try:
#             if or_key:
#                 url = os.getenv("OPENROUTER_BASE_URL","https://openrouter.ai/api/v1").rstrip("/") + "/chat/completions"
#                 model = os.getenv("OPENROUTER_MODEL", "deepseek/deepseek-r1-0528:free")
#                 headers = {"Authorization": f"Bearer {or_key}", "Content-Type": "application/json"}
#                 site_url = os.getenv("OPENROUTER_SITE_URL", ""); site_name = os.getenv("OPENROUTER_SITE_NAME","")
#                 if site_url: headers["HTTP-Referer"] = site_url
#                 if site_name: headers["X-Title"] = site_name
#                 payload = {"model": model, "messages":[
#                     {"role":"system","content":"You convert user requests into YAML pipeline specs. Output YAML only."},
#                     {"role":"user","content": user_msg},
#                 ], "temperature": 0.2}
#                 r = requests.post(url, headers=headers, data=json.dumps(payload), timeout=60)
#                 if r.status_code == 401: raise HTTPException(status_code=401, detail=f"OpenRouter auth error: {r.text}")
#                 if r.status_code >= 400: raise HTTPException(status_code=r.status_code, detail=f"OpenRouter error: {r.text}")
#                 text = r.json().get("choices",[{}])[0].get("message",{}).get("content","")
#             else:
#                 url = os.getenv("DEEPSEEK_BASE_URL","https://api.deepseek.com").rstrip("/") + "/chat/completions"
#                 model = os.getenv("DEEPSEEK_MODEL", "deepseek-chat")
#                 headers = {"Authorization": f"Bearer {ds_key}", "Content-Type": "application/json"}
#                 payload = {"model": model, "messages":[
#                     {"role":"system","content":"You convert user requests into YAML pipeline specs. Output YAML only."},
#                     {"role":"user","content": user_msg},
#                 ], "temperature": 0.2}
#                 r = requests.post(url, headers=headers, data=json.dumps(payload), timeout=60)
#                 if r.status_code == 401: raise HTTPException(status_code=401, detail=f"DeepSeek error: {r.text}")
#                 if r.status_code >= 400: raise HTTPException(status_code=r.status_code, detail=f"DeepSeek error: {r.text}")
#                 text = r.json().get("choices",[{}])[0].get("message",{}).get("content","")
#         except HTTPException:
#             raise
#         except Exception as e:
#             raise HTTPException(status_code=502, detail=f"LLM request failed: {e}")

#         yaml_out, spec = _extract_yaml_block(text or "")
#         if not spec:
#             raise HTTPException(status_code=502, detail=f"Model did not return valid YAML.\n---\n{text}\n---")

#     # post-process: canonicalize → inject receiver → drop duplicate of receiver
#     spec = _canonicalize(spec)
#     spec = _inject_receiver(spec, recv)
#     spec = _dedupe_receiver_clone(spec, recv)

#     # also normalize read_* param names
#     for nid, node in list((spec.get("nodes") or {}).items()):
#         fn = node.get("function")
#         node["params"] = normalize_read_params(fn, node.get("params") or {})
#         spec["nodes"][nid] = node

#     return {"yaml": pyyaml.safe_dump(spec, sort_keys=False), "spec": spec, "mode": mode}


# # ======================== Auth & Ping ========================

# from typing import Optional as _Optional
# import psycopg
# from pydantic import BaseModel

# DATABASE_URL = os.getenv(
#     "DATABASE_URL",
#     "postgresql://dappa:password@localhost:5432/dappa"
# )

# def _db():
#     # One short-lived connection per request (simple & safe)
#     return psycopg.connect(DATABASE_URL)

# class LoginIn(BaseModel):
#     email: str
#     password: str

# class UserOut(BaseModel):
#     id: str
#     email: str
#     role: str

# class LoginOut(BaseModel):
#     token: str
#     user: UserOut

# @app.get("/ping")
# def ping():
#     """Health check that also confirms DB connectivity."""
#     try:
#         with _db() as conn, conn.cursor() as cur:
#             cur.execute("SELECT 1")
#             _ = cur.fetchone()
#         return {"ok": True, "db": "ok"}
#     except Exception as e:
#         # Keep 200 so the UI renders, but show the error string
#         return {"ok": True, "db": f"error: {e.__class__.__name__}: {e}"}

# def _parse_bearer(auth_header: _Optional[str]) -> str:
#     if not auth_header:
#         raise HTTPException(status_code=401, detail="Missing Authorization header")
#     parts = auth_header.split()
#     if len(parts) != 2 or parts[0].lower() != "bearer":
#         raise HTTPException(status_code=401, detail="Use 'Authorization: Bearer <token>'")
#     return parts[1]

# def _user_from_token(token: str) -> UserOut:
#     with _db() as conn, conn.cursor() as cur:
#         cur.execute("SELECT app.get_user_id_by_token(%s)", (token,))
#         row = cur.fetchone()
#         if not row or not row[0]:
#             raise HTTPException(status_code=401, detail="Invalid or expired token")
#         uid = row[0]
#         cur.execute("SELECT id::text, email::text, role FROM app.users WHERE id = %s", (uid,))
#         u = cur.fetchone()
#         if not u:
#             raise HTTPException(status_code=401, detail="User not found")
#         return UserOut(id=u[0], email=u[1], role=u[2])

# @app.post("/auth/login", response_model=LoginOut)
# def auth_login(payload: LoginIn):
#     """Verify credentials using app.verify_user, then issue a session via app.issue_session."""
#     with _db() as conn, conn.cursor() as cur:
#         cur.execute("SELECT app.verify_user(%s, %s)", (payload.email, payload.password))
#         row = cur.fetchone()
#         if not row or not row[0]:
#             raise HTTPException(status_code=401, detail="Invalid email or password")
#         uid = row[0]

#         cur.execute("SELECT (app.issue_session(%s)).token", (uid,))
#         token = cur.fetchone()[0]

#         cur.execute("SELECT id::text, email::text, role FROM app.users WHERE id = %s", (uid,))
#         u = cur.fetchone()

#         return {"token": token, "user": {"id": u[0], "email": u[1], "role": u[2]}}

# @app.get("/me", response_model=UserOut)
# def me(Authorization: _Optional[str] = Header(default=None)):
#     """Return current user using Bearer token."""
#     token = _parse_bearer(Authorization)
#     return _user_from_token(token)

# # ======================== Stats & Pipelines (per-user only) ========================

# from pydantic import BaseModel as _BaseModel

# class PipelineOut(_BaseModel):
#     id: str
#     owner_id: str
#     name: str
#     yaml: str
#     created_at: str
#     updated_at: str

# def _require_user_id(Authorization: _Optional[str]) -> str:
#     """Require a valid Bearer token and return the user id."""
#     token = _parse_bearer(Authorization)
#     u = _user_from_token(token)
#     return u.id

# @app.get("/stats")
# def stats(Authorization: _Optional[str] = Header(default=None)):
#     """
#     Per-user stats:
#       - pipelines / functions / data_sources owned by the user
#       - running = runs for the user's pipelines
#     """
#     uid = _require_user_id(Authorization)

#     with _db() as conn, conn.cursor() as cur:
#         cur.execute(
#             """
#             SELECT
#               (SELECT COUNT(*) FROM app.pipelines    WHERE owner_id = %s) AS pipelines,
#               (SELECT COUNT(*) FROM app.functions    WHERE owner_id = %s) AS functions,
#               (SELECT COUNT(*) FROM app.data_sources WHERE owner_id = %s) AS sources,
#               (SELECT COUNT(*) FROM app.runs r
#                    JOIN app.pipelines p ON p.id = r.pipeline_id
#                WHERE r.status = 'running' AND p.owner_id = %s)         AS running
#             """,
#             (uid, uid, uid, uid),
#         )
#         r = cur.fetchone()

#     return {
#         "pipelines": r[0],
#         "functions": r[1],
#         "sources":   r[2],
#         "users":     1,     # single logged-in user context
#         "running":   r[3],
#     }

# @app.get("/pipelines")
# def list_pipelines(Authorization: _Optional[str] = Header(default=None)):
#     """
#     List pipelines owned by the current user.
#     """
#     uid = _require_user_id(Authorization)

#     with _db() as conn, conn.cursor() as cur:
#         cur.execute(
#             """
#             SELECT id::text, owner_id::text, name, yaml, created_at, updated_at
#             FROM app.pipelines
#             WHERE owner_id = %s
#             ORDER BY updated_at DESC
#             LIMIT 500
#             """,
#             (uid,),
#         )
#         rows = cur.fetchall()

#     return {
#         "pipelines": [
#             {
#                 "id": r[0],
#                 "owner_id": r[1],
#                 "name": r[2],
#                 "yaml": r[3],
#                 "created_at": r[4].isoformat(),
#                 "updated_at": r[5].isoformat(),
#             }
#             for r in rows
#         ]
#     }

# @app.get("/pipelines/{pipeline_id}")
# def get_pipeline(pipeline_id: str, Authorization: _Optional[str] = Header(default=None)):
#     """
#     Get a single pipeline by id if owned by the current user.
#     """
#     uid = _require_user_id(Authorization)

#     with _db() as conn, conn.cursor() as cur:
#         cur.execute(
#             """
#             SELECT id::text, owner_id::text, name, yaml, created_at, updated_at
#             FROM app.pipelines
#             WHERE id = %s AND owner_id = %s
#             """,
#             (pipeline_id, uid),
#         )
#         r = cur.fetchone()

#     if not r:
#         raise HTTPException(status_code=404, detail="Pipeline not found")
#     return {
#         "id": r[0],
#         "owner_id": r[1],
#         "name": r[2],
#         "yaml": r[3],
#         "created_at": r[4].isoformat(),
#         "updated_at": r[5].isoformat(),
#     }

# @app.post("/pipelines/save")
# async def save_pipeline(
#     request: Request,
#     Authorization: _Optional[str] = Header(default=None),
#     # Form fallbacks (the editor might send multipart/form-data)
#     pipeline_id: _Optional[str] = Form(default=None),
#     name: _Optional[str] = Form(default=None),
#     yaml_text: _Optional[str] = Form(default=None),
#     yaml: _Optional[str] = Form(default=None),
# ):
#     """
#     Upsert a pipeline *owned by the current user*.
#     Accepts JSON: { id?, name, yaml } or form fields (pipeline_id?, name, yaml|yaml_text).
#     Enforces (owner_id, name) uniqueness.
#     """
#     uid = _require_user_id(Authorization)

#     body = {}
#     # If JSON payload, prefer it
#     try:
#         if "application/json" in (request.headers.get("content-type") or ""):
#             body = await request.json()
#     except Exception:
#         body = {}

#     # Merge JSON first, then form fields as fallback
#     pid = (body.get("id") if isinstance(body, dict) else None) or pipeline_id
#     nm  = (body.get("name") if isinstance(body, dict) else None) or name
#     ym  = (body.get("yaml") if isinstance(body, dict) else None) or yaml_text or yaml

#     if not nm or not ym:
#         raise HTTPException(status_code=400, detail="Missing 'name' or 'yaml'")

#     # Validate YAML minimally
#     try:
#         spec = pyyaml.safe_load(ym) or {}
#         if not isinstance(spec, dict) or "nodes" not in spec:
#             raise ValueError("YAML must contain top-level 'nodes'")
#     except Exception as e:
#         raise HTTPException(status_code=400, detail=f"Invalid YAML: {e}")

#     with _db() as conn, conn.cursor() as cur:
#         if pid:
#             # Update by id but ensure ownership
#             cur.execute(
#                 """
#                 UPDATE app.pipelines
#                    SET name = %s, yaml = %s, updated_at = now()
#                  WHERE id = %s AND owner_id = %s
#              RETURNING id::text, owner_id::text, name, yaml, created_at, updated_at
#                 """,
#                 (nm, ym, pid, uid),
#             )
#             row = cur.fetchone()
#             if not row:
#                 raise HTTPException(status_code=404, detail="Pipeline not found or not owned by user")
#         else:
#             # Upsert on (owner_id, name)
#             cur.execute(
#                 """
#                 INSERT INTO app.pipelines (owner_id, name, yaml)
#                 VALUES (%s, %s, %s)
#                 ON CONFLICT (owner_id, name)
#                 DO UPDATE SET yaml = EXCLUDED.yaml, updated_at = now()
#                 RETURNING id::text, owner_id::text, name, yaml, created_at, updated_at
#                 """,
#                 (uid, nm, ym),
#             )
#             row = cur.fetchone()

#     return {
#         "id": row[0],
#         "owner_id": row[1],
#         "name": row[2],
#         "yaml": row[3],
#         "created_at": row[4].isoformat(),
#         "updated_at": row[5].isoformat(),
#         "status": "saved",
#     }

# # ======================== Main ========================

# if __name__ == "__main__":
#     # Run with: uvicorn main:app --reload --host 0.0.0.0 --port 8000
#     uvicorn.run(app, host="0.0.0.0", port=8000)


"""
Tharavu Dappa Backend — Light index + Robust pipeline executor + NL→YAML
- /pandas/search + /pandas/suggest include synthetic DataFrame.iloc / DataFrame.loc
- /pipeline/run executes pipelines with param coercion & reference resolution
- Special handling for .iloc / .loc accepts Python-like slice text (1:10, :, 0:2, lists…)
- /nl2yaml converts natural language to YAML (OpenRouter DeepSeek or heuristic fallback)
- /pipelines/save, /pipelines (per-user), /stats (per-user), /pipelines/{id}
"""

import os
import re
import json
import inspect
import importlib
from functools import lru_cache
from typing import Any, Dict, List, Optional, Tuple, Set
from pathlib import Path
from io import BytesIO

import requests
import numpy as np
import pandas as pd
import uvicorn
import yaml as pyyaml

from fastapi import FastAPI, HTTPException, UploadFile, Form, Header, Request
from fastapi.middleware.cors import CORSMiddleware


from vanna_router import router as vanna_router  # <-- make sure the import path matches




# Allow your UI origins
allowed = [o.strip() for o in os.getenv("ALLOWED_ORIGINS", "http://localhost:8080").split(",") if o.strip()]



# --- Vanna router integration (safe if auto_connect_from_env is absent) -----
from vanna_router import router as vanna_router  # your FastAPI router
try:
    from vanna_router import auto_connect_from_env  # optional
except Exception:
    auto_connect_from_env = None

app = FastAPI(title="Tharavu Dappa Backend", version="3.6.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# === Shared file upload for GenBI ===
import unicodedata
import string

# Host folder that is mounted into ibis-server at /usr/src/app/data
# Keep this the SAME as ${LOCAL_STORAGE} used in docker-compose for ibis-server.
LOCAL_STORAGE = os.getenv("LOCAL_STORAGE", ".")
DATA_ROOT = Path(LOCAL_STORAGE).resolve()
UPLOADS_DIR = (DATA_ROOT / "uploads")
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)

# Path INSIDE the ibis-server container
IBIS_DATA_PATH = "/usr/src/app/data"

# Include Vanna API routes
app.include_router(vanna_router)


def _safe_filename(name: str) -> str:
    keep = f"-_.() {string.ascii_letters}{string.digits}"
    cleaned = "".join(c for c in unicodedata.normalize("NFKD", name) if c in keep).strip().replace(" ", "_")
    return cleaned or "file"


@app.on_event("startup")
async def _startup():
    # If your vanna_router provides auto_connect_from_env, call it.
    if callable(auto_connect_from_env):
        try:
            auto_connect_from_env()
        except Exception as e:
            # Don't crash startup if Vanna auto-connect fails; surface via logs.
            print(f"[startup] auto_connect_from_env error: {e}")


@app.post("/files/upload")
async def files_upload(file: UploadFile):
    """
    Save an uploaded file to a host folder that ibis-server can read.
    Returns an MDL snippet you can drop into GenBI Lab directly.
    """
    if not file or not file.filename:
        raise HTTPException(status_code=400, detail="No file provided")

    fname = _safe_filename(file.filename)
    dest = UPLOADS_DIR / fname
    data = await file.read()
    dest.write_bytes(data)

    # Where the ibis container will see it
    ibis_abs = f"{IBIS_DATA_PATH}/uploads/{fname}"
    # DuckDB/ibis can read a csv directly:
    ref_sql = f"select * from read_csv_auto('{ibis_abs}')"

    mdl = {
        "catalog": "local",
        "schema": "public",
        "models": [
            {"name": Path(fname).stem, "refSql": ref_sql}
        ],
    }

    return {
        "ok": True,
        "filename": fname,
        "saved_to": str(dest),         # host path
        "ibis_path": ibis_abs,         # path inside ibis container
        "refSql": ref_sql,
        "mdl": mdl,
    }


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
        if name.startswith("_"):
            continue
        try:
            obj = getattr(pd, name)
        except Exception:
            continue
        if _callable(obj):
            _add(functions, suggestions, obj, name, "pandas", "pandas", name)

    # key pandas classes/methods
    for cls in filter(None, [getattr(pd, "DataFrame", None),
                             getattr(pd, "Series", None),
                             getattr(pd, "Index", None),
                             getattr(pd, "Categorical", None)]):
        cls_name = getattr(cls, "__name__", "PandasClass")
        for m in dir(cls):
            if m.startswith("_"):
                continue
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
                if a.startswith("_"):
                    continue
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
        if a.startswith("_"):
            continue
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
                if a.startswith("_"):
                    continue
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
        if key in seen:
            continue
        seen.add(key)
        out.append(f)
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
                        ok = False
                        break
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
                if _callable(cand):
                    return cand
        if hasattr(pd, head):
            sub = getattr(pd, head)
            if hasattr(sub, tail):
                cand = getattr(sub, tail)
                if _callable(cand):
                    return cand

    # pandas top-level
    if hasattr(pd, func_name):
        cand = getattr(pd, func_name)
        if _callable(cand):
            return cand

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
            if _callable(cand):
                return cand

    # numpy top-level
    if hasattr(np, func_name):
        cand = getattr(np, func_name)
        if _callable(cand):
            return cand

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
    def resolve(val: Any) -> Any:
        # Replace node-id strings with their executed values
        if isinstance(val, str) and val in executed:
            return executed[val]

        # Recurse through containers
        if isinstance(val, list):
            return [resolve(x) for x in val]
        if isinstance(val, tuple):
            return tuple(resolve(x) for x in val)
        if isinstance(val, dict):
            # FIX: use (k, v) and resolve(v) — not 'x'
            return {k: resolve(v) for k, v in val.items()}

        return val

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
                        if isinstance(left_obj, str):
                            left_obj = executed.get(left_obj)
                        if isinstance(right_obj, str):
                            right_obj = executed.get(right_obj)
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
        if name.lower() == q or plain == q:
            score += 120
        elif name.lower().startswith(q) or plain.startswith(q):
            score += 90
        elif q in name.lower() or q in plain:
            score += 70
        elif q in doc:
            score += 25
        elif q in cat:
            score += 15
        if score:
            g = dict(f)
            g["relevance_score"] = score
            results.append(g)
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
    info["library"] = "pandas" if (info.get("module", "").startswith("pandas")) else "numpy"
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
    yaml_text: Optional[str] = Form(None),
    yaml: Optional[str] = Form(None),
    current_yaml: Optional[str] = Form(None),
    mode: str = Form("append"),
    receiver: Optional[str] = Form(None),
):
    # pick whichever YAML field we got
    cur_yaml = (
        yaml_text if yaml_text is not None
        else (yaml if yaml is not None
              else (current_yaml if current_yaml is not None else "nodes: {}"))
    )

    try:
        cur_spec = pyyaml.safe_load(cur_yaml) or {}
        if not isinstance(cur_spec, dict):
            cur_spec = {}
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid current YAML: {e}")

    cur_nodes: Dict[str, Any] = dict(cur_spec.get("nodes") or {})
    ordered = list(cur_nodes.keys())
    last_id = ordered[-1] if ordered else None
    recv = receiver or last_id  # we’ll prefer the user-sent receiver, else last node

    # env
    or_key = os.getenv("OPENROUTER_API_KEY", "").strip()
    ds_key = os.getenv("DEEPSEEK_API_KEY", "").strip()

    # -------- helpers used below ---------------------------------------------

    def _canonicalize(spec: Dict[str, Any]) -> Dict[str, Any]:
        READ_PARAM_ALIASES = {
            "filepath": "filepath_or_buffer",
            "file_path": "filepath_or_buffer",
            "path": "filepath_or_buffer",
            "path_or_buf": "filepath_or_buffer",
            "io": "filepath_or_buffer",
        }
        def is_read(fn: Optional[str]) -> bool:
            if not fn:
                return False
            base = fn.split(".")[-1]
            return base.startswith("read_") or base in {
                "read_csv","read_json","read_excel","read_parquet","read_feather",
                "read_pickle","read_html","read_xml","read_table"
            }
        out = {"nodes": {}}
        for nid, node in (spec.get("nodes") or {}).items():
            node = dict(node or {})
            fn = node.get("function")
            if isinstance(fn, str):
                if fn.startswith("pandas."):
                    fn = fn[7:]
                if fn.startswith("numpy."):
                    fn = fn[6:]
                if fn.endswith(".rename") and not fn.startswith("DataFrame."):
                    fn = "DataFrame.rename"
                if fn.endswith(".iloc") and not fn.startswith("DataFrame."):
                    fn = "DataFrame.iloc"
                if fn.endswith(".loc") and not fn.startswith("DataFrame."):
                    fn = "DataFrame.loc"
            params = dict(node.get("params") or {})
            if is_read(fn) and "filepath_or_buffer" not in params:
                for k in list(params.keys()):
                    if k in READ_PARAM_ALIASES:
                        params["filepath_or_buffer"] = params.pop(k)
                        break
            node["function"] = fn
            node["params"] = params
            out["nodes"][nid] = node
        return out

    def _rewrite(o, old_id, new_id):
        if isinstance(o, str):
            return new_id if o == old_id else o
        if isinstance(o, list):
            return [_rewrite(x, old_id, new_id) for x in o]
        if isinstance(o, dict):
            return {k: _rewrite(v, old_id, new_id) for k, v in o.items()}
        return o

    def _inject_receiver(spec: Dict[str, Any], recv_id: Optional[str]) -> Dict[str, Any]:
        if not recv_id:
            return spec
        out = {"nodes": {}}
        for nid, node in (spec.get("nodes") or {}).items():
            node = dict(node or {})
            fn = node.get("function")
            params = dict(node.get("params") or {})
            deps = list(node.get("dependencies") or [])
            needs_self = isinstance(fn, str) and (fn.startswith("DataFrame.") or fn in ("DataFrame.iloc", "DataFrame.loc"))
            has_self = any(k in params for k in ("self", "df", "left"))
            if needs_self:
                sref = params.get("self") or params.get("df") or params.get("left")
                if (not has_self) or (isinstance(sref, str) and sref not in cur_nodes):
                    params["self"] = recv_id
                    if recv_id not in deps:
                        deps.append(recv_id)
            node["params"] = params
            node["dependencies"] = deps
            out["nodes"][nid] = node
        return out

    def _dedupe_receiver_clone(spec: Dict[str, Any], recv_id: Optional[str]) -> Dict[str, Any]:
        """If the model recreated the receiver step (same function+params minus self),
           drop the clone and rewrite all refs to the original receiver."""
        if not recv_id:
            return spec
        recv_node = cur_nodes.get(recv_id)
        if not isinstance(recv_node, dict):
            return spec

        base_fn = recv_node.get("function")
        base_params = dict(recv_node.get("params") or {})
        base_params_no_self = {k: v for k, v in base_params.items() if k != "self"}

        drop_ids = []
        for nid, node in (spec.get("nodes") or {}).items():
            fn = node.get("function")
            params = dict(node.get("params") or {})
            params_no_self = {k: v for k, v in params.items() if k != "self"}
            if fn == base_fn and params_no_self == base_params_no_self:
                drop_ids.append(nid)

        if not drop_ids:
            return spec

        patched = {"nodes": {}}
        for nid, node in (spec.get("nodes") or {}).items():
            if nid in drop_ids:
                continue
            node = dict(node or {})
            node["params"] = node.get("params") or {}
            for did in drop_ids:
                node["params"] = _rewrite(node["params"], did, recv_id)
                node["dependencies"] = list(_rewrite(node.get("dependencies") or [], did, recv_id))
            patched["nodes"][nid] = node
        return patched

    # -------- heuristic path (no keys) ----------------------------------------
    def _heuristic(prompt_text: str) -> Optional[Dict[str, Any]]:
        p = (prompt_text or "").lower()
        if "read" in p and ".csv" in p:
            m = re.search(r"([A-Za-z0-9_\-\.]+\.csv)", prompt_text)
            fname = m.group(1) if m else "data.csv"
            return {"nodes": {"read_csv_0": {"function": "read_csv", "params": {"filepath_or_buffer": fname}, "dependencies": []}}}
        if "row" in p or "column" in p or "iloc" in p or "slice" in p:
            return {"nodes": {"iloc_0": {"function": "DataFrame.iloc", "params": {"rows": "0:5", "cols": "0:3"}, "dependencies": [recv] if recv else []}}}
        return None

    # -------- build instruction & call model ----------------------------------
    guideline = [
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
        "- Do NOT recreate or duplicate steps that already exist; only add the new steps requested.",
    ]
    if recv:
        guideline.append(f"- Continue from the existing node {recv}. For any DataFrame.* operation, set `self: {recv}` and depend on {recv}, unless the user explicitly names a different input.")
    guideline.append('- For iloc/loc use rows/cols with Python-like slices (e.g., rows: 1:10, cols: ":" or 0:2).')
    guideline.append("- No prose, no fences — YAML only.")
    guideline_text = "\n".join(guideline)

    user_msg = f"CURRENT YAML:\n{cur_yaml}\n\nREQUEST:\n{prompt}\n\n{guideline_text}"

    text = None
    if not or_key and not ds_key:
        spec = _heuristic(prompt)
        if not spec:
            raise HTTPException(status_code=400, detail="Heuristic NL→YAML couldn't understand the request. Configure OPENROUTER_API_KEY or DEEPSEEK_API_KEY for LLM mode.")
    else:
        try:
            if or_key:
                url = os.getenv("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1").rstrip("/") + "/chat/completions"
                model = os.getenv("OPENROUTER_MODEL", "deepseek/deepseek-r1-0528:free")
                headers = {"Authorization": f"Bearer {or_key}", "Content-Type": "application/json"}
                site_url = os.getenv("OPENROUTER_SITE_URL", "")
                site_name = os.getenv("OPENROUTER_SITE_NAME", "")
                if site_url:
                    headers["HTTP-Referer"] = site_url
                if site_name:
                    headers["X-Title"] = site_name
                payload = {
                    "model": model,
                    "messages": [
                        {"role": "system", "content": "You convert user requests into YAML pipeline specs. Output YAML only."},
                        {"role": "user", "content": user_msg},
                    ],
                    "temperature": 0.2,
                }
                r = requests.post(url, headers=headers, data=json.dumps(payload), timeout=60)
                if r.status_code == 401:
                    raise HTTPException(status_code=401, detail=f"OpenRouter auth error: {r.text}")
                if r.status_code >= 400:
                    raise HTTPException(status_code=r.status_code, detail=f"OpenRouter error: {r.text}")
                text = r.json().get("choices", [{}])[0].get("message", {}).get("content", "")
            else:
                url = os.getenv("DEEPSEEK_BASE_URL", "https://api.deepseek.com").rstrip("/") + "/chat/completions"
                model = os.getenv("DEEPSEEK_MODEL", "deepseek-chat")
                headers = {"Authorization": f"Bearer {ds_key}", "Content-Type": "application/json"}
                payload = {
                    "model": model,
                    "messages": [
                        {"role": "system", "content": "You convert user requests into YAML pipeline specs. Output YAML only."},
                        {"role": "user", "content": user_msg},
                    ],
                    "temperature": 0.2,
                }
                r = requests.post(url, headers=headers, data=json.dumps(payload), timeout=60)
                if r.status_code == 401:
                    raise HTTPException(status_code=401, detail=f"DeepSeek error: {r.text}")
                if r.status_code >= 400:
                    raise HTTPException(status_code=r.status_code, detail=f"DeepSeek error: {r.text}")
                text = r.json().get("choices", [{}])[0].get("message", {}).get("content", "")
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(status_code=502, detail=f"LLM request failed: {e}")

        yaml_out, spec = _extract_yaml_block(text or "")
        if not spec:
            raise HTTPException(status_code=502, detail=f"Model did not return valid YAML.\n---\n{text}\n---")

    # post-process: canonicalize → inject receiver → drop duplicate of receiver
    spec = _canonicalize(spec)
    spec = _inject_receiver(spec, recv)
    spec = _dedupe_receiver_clone(spec, recv)

    # also normalize read_* param names
    for nid, node in list((spec.get("nodes") or {}).items()):
        fn = node.get("function")
        node["params"] = normalize_read_params(fn, node.get("params") or {})
        spec["nodes"][nid] = node

    return {"yaml": pyyaml.safe_dump(spec, sort_keys=False), "spec": spec, "mode": mode}


# ======================== Auth & Ping ========================

from typing import Optional as _Optional
import psycopg
from pydantic import BaseModel

DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql://dappa:password@localhost:5432/dappa"
)

def _db():
    # One short-lived connection per request (simple & safe)
    return psycopg.connect(DATABASE_URL)

class LoginIn(BaseModel):
    email: str
    password: str

class UserOut(BaseModel):
    id: str
    email: str
    role: str

class LoginOut(BaseModel):
    token: str
    user: UserOut

@app.get("/ping")
def ping():
    """Health check that also confirms DB connectivity."""
    try:
        with _db() as conn, conn.cursor() as cur:
            cur.execute("SELECT 1")
            _ = cur.fetchone()
        return {"ok": True, "db": "ok"}
    except Exception as e:
        # Keep 200 so the UI renders, but show the error string
        return {"ok": True, "db": f"error: {e.__class__.__name__}: {e}"}

def _parse_bearer(auth_header: _Optional[str]) -> str:
    if not auth_header:
        raise HTTPException(status_code=401, detail="Missing Authorization header")
    parts = auth_header.split()
    if len(parts) != 2 or parts[0].lower() != "bearer":
        raise HTTPException(status_code=401, detail="Use 'Authorization: Bearer <token>'")
    return parts[1]

def _user_from_token(token: str) -> UserOut:
    with _db() as conn, conn.cursor() as cur:
        cur.execute("SELECT app.get_user_id_by_token(%s)", (token,))
        row = cur.fetchone()
        if not row or not row[0]:
            raise HTTPException(status_code=401, detail="Invalid or expired token")
        uid = row[0]
        cur.execute("SELECT id::text, email::text, role FROM app.users WHERE id = %s", (uid,))
        u = cur.fetchone()
        if not u:
            raise HTTPException(status_code=401, detail="User not found")
        return UserOut(id=u[0], email=u[1], role=u[2])

@app.post("/auth/login", response_model=LoginOut)
def auth_login(payload: LoginIn):
    """Verify credentials using app.verify_user, then issue a session via app.issue_session."""
    with _db() as conn, conn.cursor() as cur:
        cur.execute("SELECT app.verify_user(%s, %s)", (payload.email, payload.password))
        row = cur.fetchone()
        if not row or not row[0]:
            raise HTTPException(status_code=401, detail="Invalid email or password")
        uid = row[0]

        cur.execute("SELECT (app.issue_session(%s)).token", (uid,))
        token = cur.fetchone()[0]

        cur.execute("SELECT id::text, email::text, role FROM app.users WHERE id = %s", (uid,))
        u = cur.fetchone()

        return {"token": token, "user": {"id": u[0], "email": u[1], "role": u[2]}}

@app.get("/me", response_model=UserOut)
def me(Authorization: _Optional[str] = Header(default=None)):
    """Return current user using Bearer token."""
    token = _parse_bearer(Authorization)
    return _user_from_token(token)


# ======================== Stats & Pipelines (per-user only) ========================

from pydantic import BaseModel as _BaseModel

class PipelineOut(_BaseModel):
    id: str
    owner_id: str
    name: str
    yaml: str
    created_at: str
    updated_at: str

def _require_user_id(Authorization: _Optional[str]) -> str:
    """Require a valid Bearer token and return the user id."""
    token = _parse_bearer(Authorization)
    u = _user_from_token(token)
    return u.id

@app.get("/stats")
def stats(Authorization: _Optional[str] = Header(default=None)):
    """
    Per-user stats:
      - pipelines / functions / data_sources owned by the user
      - running = runs for the user's pipelines
    """
    uid = _require_user_id(Authorization)

    with _db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT
              (SELECT COUNT(*) FROM app.pipelines    WHERE owner_id = %s) AS pipelines,
              (SELECT COUNT(*) FROM app.functions    WHERE owner_id = %s) AS functions,
              (SELECT COUNT(*) FROM app.data_sources WHERE owner_id = %s) AS sources,
              (SELECT COUNT(*) FROM app.runs r
                   JOIN app.pipelines p ON p.id = r.pipeline_id
               WHERE r.status = 'running' AND p.owner_id = %s)         AS running
            """,
            (uid, uid, uid, uid),
        )
        r = cur.fetchone()

    return {
        "pipelines": r[0],
        "functions": r[1],
        "sources":   r[2],
        "users":     1,     # single logged-in user context
        "running":   r[3],
    }

@app.get("/pipelines")
def list_pipelines(Authorization: _Optional[str] = Header(default=None)):
    """
    List pipelines owned by the current user.
    """
    uid = _require_user_id(Authorization)

    with _db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT id::text, owner_id::text, name, yaml, created_at, updated_at
            FROM app.pipelines
            WHERE owner_id = %s
            ORDER BY updated_at DESC
            LIMIT 500
            """,
            (uid,),
        )
        rows = cur.fetchall()

    return {
        "pipelines": [
            {
                "id": r[0],
                "owner_id": r[1],
                "name": r[2],
                "yaml": r[3],
                "created_at": r[4].isoformat(),
                "updated_at": r[5].isoformat(),
            }
            for r in rows
        ]
    }

@app.get("/pipelines/{pipeline_id}")
def get_pipeline(pipeline_id: str, Authorization: _Optional[str] = Header(default=None)):
    """
    Get a single pipeline by id if owned by the current user.
    """
    uid = _require_user_id(Authorization)

    with _db() as conn, conn.cursor() as cur:
        cur.execute(
            """
            SELECT id::text, owner_id::text, name, yaml, created_at, updated_at
            FROM app.pipelines
            WHERE id = %s AND owner_id = %s
            """,
            (pipeline_id, uid),
        )
        r = cur.fetchone()

    if not r:
        raise HTTPException(status_code=404, detail="Pipeline not found")
    return {
        "id": r[0],
        "owner_id": r[1],
        "name": r[2],
        "yaml": r[3],
        "created_at": r[4].isoformat(),
        "updated_at": r[5].isoformat(),
    }

@app.post("/pipelines/save")
async def save_pipeline(
    request: Request,
    Authorization: _Optional[str] = Header(default=None),
    # Form fallbacks (the editor might send multipart/form-data)
    pipeline_id: _Optional[str] = Form(default=None),
    name: _Optional[str] = Form(default=None),
    yaml_text: _Optional[str] = Form(default=None),
    yaml: _Optional[str] = Form(default=None),
):
    """
    Upsert a pipeline *owned by the current user*.
    Accepts JSON: { id?, name, yaml } or form fields (pipeline_id?, name, yaml|yaml_text).
    Enforces (owner_id, name) uniqueness.
    """
    uid = _require_user_id(Authorization)

    body = {}
    # If JSON payload, prefer it
    try:
        if "application/json" in (request.headers.get("content-type") or ""):
            body = await request.json()
    except Exception:
        body = {}

    # Merge JSON first, then form fields as fallback
    pid = (body.get("id") if isinstance(body, dict) else None) or pipeline_id
    nm  = (body.get("name") if isinstance(body, dict) else None) or name
    ym  = (body.get("yaml") if isinstance(body, dict) else None) or yaml_text or yaml

    if not nm or not ym:
        raise HTTPException(status_code=400, detail="Missing 'name' or 'yaml'")

    # Validate YAML minimally
    try:
        spec = pyyaml.safe_load(ym) or {}
        if not isinstance(spec, dict) or "nodes" not in spec:
            raise ValueError("YAML must contain top-level 'nodes'")
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid YAML: {e}")

    with _db() as conn, conn.cursor() as cur:
        if pid:
            # Update by id but ensure ownership
            cur.execute(
                """
                UPDATE app.pipelines
                   SET name = %s, yaml = %s, updated_at = now()
                 WHERE id = %s AND owner_id = %s
             RETURNING id::text, owner_id::text, name, yaml, created_at, updated_at
                """,
                (nm, ym, pid, uid),
            )
            row = cur.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Pipeline not found or not owned by user")
        else:
            # Upsert on (owner_id, name)
            cur.execute(
                """
                INSERT INTO app.pipelines (owner_id, name, yaml)
                VALUES (%s, %s, %s)
                ON CONFLICT (owner_id, name)
                DO UPDATE SET yaml = EXCLUDED.yaml, updated_at = now()
                RETURNING id::text, owner_id::text, name, yaml, created_at, updated_at
                """,
                (uid, nm, ym),
            )
            row = cur.fetchone()

    return {
        "id": row[0],
        "owner_id": row[1],
        "name": row[2],
        "yaml": row[3],
        "created_at": row[4].isoformat(),
        "updated_at": row[5].isoformat(),
        "status": "saved",
    }


# ======================== Main ========================

if __name__ == "__main__":
    # Run with: uvicorn main:app --reload --host 0.0.0.0 --port 8000
    uvicorn.run(app, host="0.0.0.0", port=8000)
