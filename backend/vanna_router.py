# # backend/vanna_router.py
# import os
# import time
# import uuid
# from typing import Any, Dict, Optional

# from fastapi import APIRouter, HTTPException, Query, Response, Body

# router = APIRouter(prefix="/vanna/v0", tags=["vanna"])

# # ----------------- Small index so /vanna/v0 doesn't 404 -----------------
# @router.get("", include_in_schema=False)
# def index():
#     return {
#         "ok": True,
#         "endpoints": [
#             "/vanna/v0/health",
#             "/vanna/v0/connection_status",
#             "/vanna/v0/connect/postgres",
#             "/vanna/v0/get_training_data",
#             "/vanna/v0/generate_sql",
#             "/vanna/v0/run_sql",
#             "/vanna/v0/generate_plotly_figure",
#             "/vanna/v0/followups",
#             "/vanna/v0/download_csv",
#             "/vanna/v0/ask",
#             "/vanna/v0/get_question_history",
#             "/vanna/v0/load_question",
#         ],
#     }

# # ----------------- Simple in-mem cache -----------------
# class MemoryCache:
#     def __init__(self):
#         self.cache: Dict[str, Dict[str, Any]] = {}

#     def generate_id(self, question: str) -> str:
#         import hashlib
#         return hashlib.md5(question.encode()).hexdigest()[:8]

#     def get(self, id: str, field: str):
#         return self.cache.get(id, {}).get(field)

#     def set(self, id: str, field: str, value: Any):
#         self.cache.setdefault(id, {})[field] = value

#     def get_all(self, field_list: list) -> list:
#         return [
#             {
#                 "id": id,
#                 **{field: self.get(id=id, field=field) for field in field_list},
#             }
#             for id in self.cache
#         ]

#     def delete(self, id: str):
#         self.cache.pop(id, None)


# cache = MemoryCache()
# _vn = None  # lazy global


# def _new_id() -> str:
#     return uuid.uuid4().hex


# # ----------------- Build Vanna -----------------
# def _build_vn():
#     """
#     Prefer Vanna Cloud if VANNA_MODEL & VANNA_API_KEY are set.
#     Else use Ollama via its OpenAI-compatible /v1 API + ChromaDB.
#     """
#     print("[Vanna] Building Vanna instance...")

#     # --- Vanna Cloud (if provided) ---
#     if os.getenv("VANNA_MODEL") and os.getenv("VANNA_API_KEY"):
#         print("[Vanna] Using Vanna Cloud")
#         from vanna.remote import VannaDefault

#         return VannaDefault(
#             model=os.environ["VANNA_MODEL"], api_key=os.environ["VANNA_API_KEY"]
#         )

#     # --- Local: Ollama (OpenAI-compatible) + ChromaDB ---
#     print("[Vanna] Using Ollama (OpenAI-compatible) + ChromaDB")

#     from openai import OpenAI
#     from vanna.openai import OpenAI_Chat
#     from vanna.chromadb import ChromaDB_VectorStore

#     host = os.getenv("OLLAMA_HOST", "http://ollama:11434").rstrip("/")
#     base_url = f"{host}/v1"  # IMPORTANT: talk to Ollama's OpenAI-compatible API
#     model = os.getenv("OLLAMA_MODEL", "mistral:latest")
#     chroma_dir = os.getenv("VANNA_CHROMA_DIR", "/app/.chroma")
#     api_key = os.getenv("OLLAMA_API_KEY", "ollama")  # required by OpenAI client, unused

#     print(f"[Vanna] Configuration - Host: {host}, Model: {model}, ChromaDB: {chroma_dir}")
#     print(f"[Vanna] Connecting to Ollama OpenAI API at: {base_url}")

#     # Create OpenAI client pointed at Ollama
#     client = OpenAI(base_url=base_url, api_key=api_key)

#     class MyVanna(OpenAI_Chat, ChromaDB_VectorStore):
#         def __init__(self):
#             print("[Vanna] Initializing ChromaDB...")
#             ChromaDB_VectorStore.__init__(self, config={"persist_directory": chroma_dir})
#             print("[Vanna] ChromaDB initialized successfully")

#             print("[Vanna] Initializing OpenAI_Chat (Ollama)…")
#             OpenAI_Chat.__init__(self, client=client, config={"model": model})
#             print("[Vanna] OpenAI_Chat initialized successfully")

#     return MyVanna()


# def get_vn():
#     """Get or create the Vanna instance with retry logic."""
#     global _vn
#     if _vn is not None:
#         return _vn

#     print("[Vanna] Initializing Vanna instance...")
#     last_err: Optional[Exception] = None
#     for attempt in range(5):
#         try:
#             print(f"[Vanna] Attempt {attempt + 1}/5")
#             _vn = _build_vn()
#             print("[Vanna] Vanna instance created successfully")
#             return _vn
#         except Exception as e:  # noqa: BLE001
#             last_err = e
#             print(f"[Vanna] Attempt {attempt + 1} failed: {e}")
#             if attempt < 4:
#                 time.sleep(2)

#     error_msg = f"Vanna init failed after 5 attempts: {last_err}"
#     print(f"[Vanna] {error_msg}")
#     raise HTTPException(status_code=500, detail=error_msg)


# def _auto_connect_from_env(vn) -> None:
#     """Try to auto-connect to PostgreSQL using environment variables."""
#     host = os.getenv("VANNA_PG_HOST")
#     db = os.getenv("VANNA_PG_DB")
#     user = os.getenv("VANNA_PG_USER")
#     pwd = os.getenv("VANNA_PG_PASSWORD")
#     port = os.getenv("VANNA_PG_PORT") or "5432"

#     if host and db and user and pwd:
#         try:
#             print(f"[Vanna] Auto-connecting to PostgreSQL at {host}:{port}/{db}")
#             vn.connect_to_postgres(
#                 host=host, dbname=db, user=user, password=pwd, port=int(port)
#             )
#             print("[Vanna] PostgreSQL auto-connection successful")
#         except Exception as e:  # noqa: BLE001
#             print(f"[Vanna] PostgreSQL auto-connection failed: {e}")
#     else:
#         print("[Vanna] PostgreSQL auto-connection skipped - missing environment variables")


# # ==================== HEALTH & STATUS ====================

# @router.get("/health")
# def health():
#     try:
#         _ = get_vn()
#         return {"status": "healthy", "vanna_initialized": True, "model": os.getenv("OLLAMA_MODEL", "mistral:latest")}
#     except Exception as e:  # noqa: BLE001
#         return {"status": "unhealthy", "vanna_initialized": False, "error": str(e)}


# @router.get("/connection_status", name="connection_status")
# @router.get("/connection-status", include_in_schema=False)
# def connection_status():
#     """Check database connection status (with alias path)."""
#     try:
#         vn = get_vn()
#         try:
#             vn.run_sql("SELECT 1 as ok")
#             return {"connected": True, "engine": "postgres", "details": {"dbname": os.getenv("VANNA_PG_DB", "")}}
#         except Exception:
#             print("[Vanna] Database not connected, trying auto-connect...")
#             _auto_connect_from_env(vn)
#             try:
#                 vn.run_sql("SELECT 1 as ok")
#                 return {"connected": True, "engine": "postgres", "details": {"dbname": os.getenv("VANNA_PG_DB", "")}}
#             except Exception:
#                 return {"connected": False}
#     except Exception as e:  # noqa: BLE001
#         raise HTTPException(status_code=500, detail=str(e))


# # ==================== DATABASE CONNECTIONS ====================

# @router.post("/connect/postgres")
# def connect_postgres(payload: Dict[str, Any] = Body(...)):
#     vn = get_vn()
#     try:
#         vn.connect_to_postgres(
#             host=payload.get("host"),
#             dbname=payload.get("dbname"),
#             user=payload.get("user"),
#             password=payload.get("password"),
#             port=int(payload.get("port", 5432)),
#         )
#         return {"success": True}
#     except Exception as e:  # noqa: BLE001
#         return {"success": False, "error": str(e)}


# @router.post("/connect/sqlite")
# def connect_sqlite(payload: Dict[str, Any] = Body(...)):
#     vn = get_vn()
#     url = payload.get("url")
#     if not url:
#         raise HTTPException(status_code=400, detail="Missing 'url'")
#     try:
#         vn.connect_to_sqlite(url=url)
#         return {"success": True}
#     except Exception as e:  # noqa: BLE001
#         return {"success": False, "error": str(e)}


# @router.post("/connect/duckdb")
# def connect_duckdb(payload: Dict[str, Any] = Body(...)):
#     vn = get_vn()
#     url = payload.get("url")
#     if not url:
#         raise HTTPException(status_code=400, detail="Missing 'url'")
#     try:
#         vn.connect_to_duckdb(url=url, init_sql=payload.get("init_sql"))
#         return {"success": True}
#     except Exception as e:  # noqa: BLE001
#         return {"success": False, "error": str(e)}


# # ==================== TRAINING DATA ====================

# @router.get("/get_training_data")
# def get_training_data():
#     vn = get_vn()
#     try:
#         df = vn.get_training_data()
#         return {"records": df.to_dict(orient="records")}
#     except Exception as e:  # noqa: BLE001
#         return {"error": str(e)}


# @router.post("/add_ddl")
# def add_ddl(payload: Dict[str, Any] = Body(...)):
#     vn = get_vn()
#     ddl = payload.get("ddl")
#     if not ddl:
#         raise HTTPException(status_code=400, detail="Missing 'ddl'")
#     return {"id": vn.add_ddl(ddl)}


# @router.post("/add_documentation")
# def add_documentation(payload: Dict[str, Any] = Body(...)):
#     vn = get_vn()
#     doc = payload.get("documentation")
#     if not doc:
#         raise HTTPException(status_code=400, detail="Missing 'documentation'")
#     return {"id": vn.add_documentation(doc)}


# @router.post("/add_question_sql")
# def add_question_sql(payload: Dict[str, Any] = Body(...)):
#     vn = get_vn()
#     q = payload.get("question")
#     s = payload.get("sql")
#     if not q or not s:
#         raise HTTPException(status_code=400, detail="Missing 'question' or 'sql'")
#     return {"id": vn.add_question_sql(question=q, sql=s)}


# @router.delete("/remove_training_data")
# def remove_training_data(id: str = Query(...)):
#     vn = get_vn()
#     return {"ok": bool(vn.remove_training_data(id=id))}


# @router.post("/train")
# def train(payload: Dict[str, Any] = Body(...)):
#     vn = get_vn()
#     try:
#         q = payload.get("question")
#         s = payload.get("sql")
#         d = payload.get("ddl")
#         doc = payload.get("documentation")
#         plan = payload.get("plan")

#         if any([q, s, d, doc, plan]):
#             vn.train(question=q, sql=s, ddl=d, documentation=doc, plan=plan)
#             return {"status": "trained"}

#         print("[Vanna] Auto-training on database schema...")
#         df_info = vn.run_sql("SELECT * FROM INFORMATION_SCHEMA.COLUMNS")
#         tr_plan = vn.get_training_plan_generic(df_info)
#         vn.train(plan=tr_plan)
#         return {"status": "trained", "auto": True}

#     except Exception as e:  # noqa: BLE001
#         raise HTTPException(status_code=500, detail=str(e))


# # ==================== SQL GENERATION & EXECUTION ====================

# @router.get("/generate_sql")
# def generate_sql(question: Optional[str] = Query(None)):
#     vn = get_vn()
#     if not question:
#         raise HTTPException(status_code=400, detail="No question provided")

#     sql = vn.generate_sql(question=question)
#     qid = cache.generate_id(question=question)
#     cache.set(id=qid, field="question", value=question)
#     cache.set(id=qid, field="sql", value=sql)
#     return {"type": "sql", "id": qid, "text": sql}


# @router.get("/run_sql")
# def run_sql(id: Optional[str] = Query(None), sql: Optional[str] = Query(None), limit: int = Query(100)):
#     vn = get_vn()
#     if not id and not sql:
#         raise HTTPException(status_code=400, detail="Provide 'id' or 'sql'")

#     if id:
#         item = cache.get(id, "sql")
#         if not item:
#             raise HTTPException(status_code=400, detail="No SQL found for this id")
#         sql = item

#     try:
#         df = vn.run_sql(sql=sql)
#         if id:
#             cache.set(id=id, field="df", value=df)

#         return {"type": "df", "id": id or "", "df": df.head(limit).to_json(orient="records")}
#     except Exception as e:  # noqa: BLE001
#         raise HTTPException(status_code=500, detail=f"SQL execution failed: {str(e)}")


# @router.get("/generate_questions")
# def generate_questions():
#     vn = get_vn()
#     try:
#         questions = vn.generate_questions()
#         return {"type": "question_list", "questions": questions, "header": "Here are some questions you can ask:"}
#     except Exception as e:  # noqa: BLE001
#         return {"type": "question_list", "questions": [], "header": f"Error generating questions: {str(e)}"}


# # ==================== ANALYSIS & VISUALIZATION ====================

# @router.get("/followups")
# def followups(id: str = Query(...), n: int = Query(5)):
#     vn = get_vn()
#     question = cache.get(id, "question")
#     sql = cache.get(id, "sql")
#     df = cache.get(id, "df")

#     if not question or not sql or df is None:
#         raise HTTPException(status_code=400, detail="Run the SQL first")

#     try:
#         followup_questions = vn.generate_followup_questions(
#             question=question, sql=sql, df=df, n_questions=n
#         )
#         cache.set(id=id, field="followup_questions", value=followup_questions)
#         return {"type": "question_list", "id": id, "questions": followup_questions, "header": "Here are some followup questions you can ask:"}
#     except Exception as e:  # noqa: BLE001
#         raise HTTPException(status_code=500, detail=str(e))


# @router.get("/generate_plotly_figure")
# def generate_plotly_figure(id: str = Query(...), dark: bool = Query(False)):
#     vn = get_vn()

#     question = cache.get(id, "question")
#     sql = cache.get(id, "sql")
#     df = cache.get(id, "df")

#     if not question or not sql or df is None:
#         raise HTTPException(status_code=400, detail="Run the SQL first")

#     try:
#         code = vn.generate_plotly_code(
#             question=question,
#             sql=sql,
#             df_metadata=f"Running df.dtypes gives:\n{df.dtypes}",
#         )
#         fig = vn.get_plotly_figure(plotly_code=code, df=df, dark_mode=bool(dark))
#         fig_json = fig.to_json()
#         cache.set(id=id, field="fig_json", value=fig_json)
#         return {"type": "plotly_figure", "id": id, "fig": fig_json}
#     except Exception as e:  # noqa: BLE001
#         raise HTTPException(status_code=500, detail=f"Visualization generation failed: {str(e)}")


# @router.get("/download_csv")
# def download_csv(id: str = Query(...)):
#     df = cache.get(id, "df")
#     if df is None:
#         raise HTTPException(status_code=400, detail="No DataFrame found for this id")

#     csv = df.to_csv(index=False)
#     return Response(
#         content=csv,
#         media_type="text/csv",
#         headers={"Content-Disposition": f'attachment; filename="{id}.csv"'},
#     )


# # ==================== COMPLETE WORKFLOW ====================

# @router.get("/ask")
# def ask(question: str = Query(...), visualize: bool = Query(True)):
#     vn = get_vn()
#     try:
#         sql = vn.generate_sql(question=question)
#         df = vn.run_sql(sql=sql)

#         result = {"question": question, "sql": sql, "df": df.head(100).to_json(orient="records")}

#         if visualize and not df.empty:
#             try:
#                 code = vn.generate_plotly_code(
#                     question=question, sql=sql, df_metadata=f"Running df.dtypes gives:\n{df.dtypes}"
#                 )
#                 fig = vn.get_plotly_figure(plotly_code=code, df=df, dark_mode=False)
#                 result["fig"] = fig.to_json()
#             except Exception as viz_error:  # noqa: BLE001
#                 print(f"[Vanna] Visualization error: {viz_error}")

#         return result
#     except Exception as e:  # noqa: BLE001
#         raise HTTPException(status_code=500, detail=str(e))


# # ==================== CACHING & HISTORY ====================

# @router.get("/load_question")
# def load_question(id: str = Query(...)):
#     question = cache.get(id, "question")
#     sql = cache.get(id, "sql")
#     df = cache.get(id, "df")
#     fig_json = cache.get(id, "fig_json")
#     followup_questions = cache.get(id, "followup_questions")

#     if not question or not sql:
#         raise HTTPException(status_code=404, detail="Question not found")

#     result: Dict[str, Any] = {"type": "question_cache", "id": id, "question": question, "sql": sql}
#     if df is not None:
#         result["df"] = df.head(10).to_json(orient="records")
#     if fig_json:
#         result["fig"] = fig_json
#     if followup_questions:
#         result["followup_questions"] = followup_questions
#     return result


# @router.get("/get_question_history")
# def get_question_history():
#     try:
#         history = cache.get_all(field_list=["question"])
#         return {"type": "question_history", "questions": [item for item in history if item.get("question")]}
#     except Exception as e:  # noqa: BLE001
#         return {"type": "question_history", "questions": [], "error": str(e)}


# # ==================== STARTUP HOOK ====================

# def auto_connect_from_env():
#     try:
#         print("[Vanna] Running auto-connect from environment...")
#         vn = get_vn()
#         _auto_connect_from_env(vn)
#         print("[Vanna] Auto-connect completed successfully")
#     except Exception as e:  # noqa: BLE001
#         print(f"[Vanna] Auto-connect failed: {e}")

# backend/vanna_router.py
# vanna_router.py
# Final, complete router wired for Vanna Cloud OR Ollama (OpenAI-compatible) + ChromaDB
# DATA DB is totally separate from app/login DB; autoconnect and auto-train only on DATA DB.

# backend/vanna_router.py
# Final router: Vanna Cloud OR Ollama(OpenAI-compatible) + ChromaDB
# DATA DB is separate from your app/login DB. No auto-saving Q→SQL.
# Q→SQL is saved ONLY via POST /vanna/v0/mark_correct

import os
import time
import uuid
import re
from typing import Any, Dict, Optional, List

from fastapi import APIRouter, HTTPException, Query, Response, Body, UploadFile, File
import pandas as pd

router = APIRouter(prefix="/vanna/v0", tags=["vanna"])

__all__ = ["router", "auto_connect_from_env"]

# ===================== DATA DB env (NOT the login DB) =====================
DATA_ENV = {
    "host": os.getenv("VANNA_DATA_PG_HOST"),
    "dbname": os.getenv("VANNA_DATA_PG_DB"),
    "user": os.getenv("VANNA_DATA_PG_USER"),
    "password": os.getenv("VANNA_DATA_PG_PASSWORD"),
    "port": int(os.getenv("VANNA_DATA_PG_PORT") or "5432"),
    "sslmode": os.getenv("VANNA_DATA_PG_SSLMODE", "require"),
}

# Backward compat fallback VANNA_PG_* if VANNA_DATA_* not set
if not DATA_ENV["host"] and os.getenv("VANNA_PG_HOST"):
    DATA_ENV = {
        "host": os.getenv("VANNA_PG_HOST"),
        "dbname": os.getenv("VANNA_PG_DB"),
        "user": os.getenv("VANNA_PG_USER"),
        "password": os.getenv("VANNA_PG_PASSWORD"),
        "port": int(os.getenv("VANNA_PG_PORT") or "5432"),
        "sslmode": os.getenv("VANNA_PG_SSLMODE", "require"),
    }

AUTO_CONNECT = os.getenv("VANNA_AUTOCONNECT", "1").lower() not in ("0", "false", "no", "off")

# Runtime flags
_user_connected = False
_manual_disconnect = False

# Connection & vector store info
CURRENT_CONN: Dict[str, Any] = {"engine": None, "details": {}}
VECTOR_STORE: Dict[str, Any] = {"name": None, "persist_directory": None}

# ===================== In-memory cache =====================
class MemoryCache:
    def __init__(self):
        self.cache: Dict[str, Dict[str, Any]] = {}

    def generate_id(self, question: str) -> str:
        import hashlib
        return hashlib.md5(question.encode()).hexdigest()[:8]

    def get(self, id: str, field: str):
        return self.cache.get(id, {}).get(field)

    def set(self, id: str, field: str, value: Any):
        self.cache.setdefault(id, {})[field] = value

    def get_all(self, field_list: list) -> list:
        return [
            {"id": _id, **{f: self.get(_id, f) for f in field_list}}
            for _id in self.cache
        ]

    def delete(self, id: str):
        self.cache.pop(id, None)

cache = MemoryCache()
_vn = None  # Vanna instance

def _new_id() -> str:
    return uuid.uuid4().hex

# ===================== Robust SQL extraction =====================
_SQL_LINE_START = re.compile(
    r"(?mi)^[ \t]*(WITH|SELECT|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|EXPLAIN|BEGIN|VALUES)\b"
)

def _clean_block(s: str) -> str:
    if "\n" in s:
        first, rest = s.split("\n", 1)
        if first.strip().lower() in {"sql", "postgres", "postgresql"}:
            s = rest
    return s.strip()

def extract_sql(text: str) -> str:
    """
    Pull the SQL out of messy LLM responses. Last good-looking block wins.
    - honors fenced ```sql blocks
    - falls back to first line that starts with SQL keyword
    - tolerates prose around the code
    """
    if not text:
        return ""
    t = text.replace("\r", "")

    # 1) custom "sql: ... '''" pattern, last occurrence
    m_custom_all = list(re.finditer(r"(?is)(?:^|\n)\s*sql\b[:\-]?\s*(.*?)[ \t]*'''", t))
    if m_custom_all:
        return m_custom_all[-1].group(1).strip()

    # 2) fenced code blocks
    parts = t.split("```")
    candidates = []
    for i in range(1, len(parts), 2):
        block = _clean_block(parts[i])
        if _SQL_LINE_START.search(block):
            candidates.append(block.strip())
    if candidates:
        return candidates[-1]

    # 3) plain text: from first SQL-ish line to next fence or end
    m = _SQL_LINE_START.search(t)
    if m:
        sql = t[m.start():]
        return sql.split("```", 1)[0].strip()

    return t.strip()

# ===================== Import helpers for Vanna classes =====================
def _import_openai_chroma():
    """
    Support both package layouts:
      - vanna.openai_chat / vanna.chromadb_vector (newer)
      - vanna.openai / vanna.chromadb (older)
    """
    try:
        from vanna.openai_chat import OpenAI_Chat
        from vanna.chromadb_vector import ChromaDB_VectorStore
        return OpenAI_Chat, ChromaDB_VectorStore
    except Exception:
        from vanna.openai import OpenAI_Chat
        from vanna.chromadb import ChromaDB_VectorStore
        return OpenAI_Chat, ChromaDB_VectorStore

# ===================== Build Vanna (Cloud OR Local) =====================
def _build_vn():
    print("[Vanna] Building Vanna instance...")
    # Cloud
    if os.getenv("VANNA_MODEL") and os.getenv("VANNA_API_KEY"):
        print("[Vanna] Using Vanna Cloud")
        from vanna.remote import VannaDefault
        VECTOR_STORE.update({"name": "vanna-cloud", "persist_directory": None})

        class MyVanna(VannaDefault):
            def extract_sql(self, llm_response: str) -> str:
                return extract_sql(llm_response)

        inst = MyVanna(model=os.environ["VANNA_MODEL"], api_key=os.environ["VANNA_API_KEY"])
        # Harden prompt
        inst.config.update({
            "dialect": "PostgreSQL",
            "initial_prompt": (
                "You are a PostgreSQL expert. You must return ONLY a single SQL query that answers the user's question.\n"
                "FORMAT:\n"
                "```sql\n<query>\n```\n"
                "RULES:\n"
                "- No prose, no explanation outside the code fence.\n"
                "- Use the provided schema/context only; never invent tables/columns.\n"
                "- Prefer fully-qualified names like public.table.\n"
                "- If context is insufficient, output exactly:\n"
                "```sql\n-- INSUFFICIENT_CONTEXT\n```\n"
            ),
            "max_tokens": 14000
        })
        return inst

    # Local: Ollama (OpenAI-compatible) + ChromaDB
    print("[Vanna] Using Ollama + ChromaDB")
    from openai import OpenAI
    OpenAI_Chat, ChromaDB_VectorStore = _import_openai_chroma()

    host = os.getenv("OLLAMA_HOST", "http://ollama:11434").rstrip("/")
    base_url = f"{host}/v1"
    model = os.getenv("OLLAMA_MODEL", "mistral:latest")
    chroma_dir = os.getenv("VANNA_CHROMA_DIR", "/app/.chroma")
    api_key = os.getenv("OLLAMA_API_KEY", "ollama")  # required by OpenAI client

    print(f"[Vanna] Ollama at: {base_url}  | model: {model}")
    print(f"[Vanna] ChromaDB: {chroma_dir}")
    VECTOR_STORE.update({"name": "chroma", "persist_directory": chroma_dir})

    client = OpenAI(base_url=base_url, api_key=api_key)

    class MyVanna(OpenAI_Chat, ChromaDB_VectorStore):
        def __init__(self):
            ChromaDB_VectorStore.__init__(self, config={"persist_directory": chroma_dir})
            OpenAI_Chat.__init__(self, client=client, config={
                "model": model,
                "temperature": 0,
                "max_tokens": 1024,
            })

        def extract_sql(self, llm_response: str) -> str:
            return extract_sql(llm_response)

    inst = MyVanna()
    # Harden prompt
    inst.config.update({
        "dialect": "PostgreSQL",
        "initial_prompt": (
            "You are a PostgreSQL expert. You must return ONLY a single SQL query that answers the user's question.\n"
            "FORMAT:\n"
            "```sql\n<query>\n```\n"
            "RULES:\n"
            "- No prose, no explanation outside the code fence.\n"
            "- Use the provided schema/context only; never invent tables/columns.\n"
            "- Prefer fully-qualified names like public.table.\n"
            "- If context is insufficient, output exactly:\n"
            "```sql\n-- INSUFFICIENT_CONTEXT\n```\n"
        ),
        "max_tokens": 14000
    })
    return inst

# === Module-level hard fallback to force SQL-only generations ================
def _force_sql_only(vn, question: str) -> str:
    # Gather a small slice of relevant context to keep tokens reasonable
    try:
        ddl_list = vn.get_related_ddl(question) or []
    except Exception:
        ddl_list = []
    try:
        doc_list = vn.get_related_documentation(question) or []
    except Exception:
        doc_list = []

    ddl_txt = "\n\n".join(ddl_list)[:6000]
    doc_txt = "\n\n".join(doc_list)[:4000]

    sys = (
        "You are a PostgreSQL expert. Return ONLY a single SQL query that answers the user's question.\n"
        "FORMAT:\n```sql\n<query>\n```\n"
        "RULES:\n- No prose, no explanation outside the code fence.\n"
        "- Use the provided schema/context only; never invent tables/columns.\n"
        "- Prefer fully-qualified names like public.table.\n"
        "- If context is insufficient, output exactly:\n```sql\n-- INSUFFICIENT_CONTEXT\n```\n"
    )
    ctx_parts = []
    if ddl_txt:
        ctx_parts.append("===Tables\n" + ddl_txt)
    if doc_txt:
        ctx_parts.append("===Additional Context\n" + doc_txt)
    ctx = "\n\n".join(ctx_parts)

    prompt = [vn.system_message(sys)]
    if ctx:
        prompt.append(vn.user_message(ctx))
    prompt.append(vn.user_message(f"===Question\n{question}\n\nRemember: output ONLY the SQL code block."))

    raw = vn.submit_prompt(prompt)
    return raw or ""

def get_vn():
    """Lazy-create Vanna with retries."""
    global _vn
    if _vn is not None:
        return _vn

    last_err: Optional[Exception] = None
    for attempt in range(5):
        try:
            _vn = _build_vn()
            return _vn
        except Exception as e:
            last_err = e
            print(f"[Vanna] init attempt {attempt+1}/5 failed: {e}")
            if attempt < 4:
                time.sleep(2)
    raise HTTPException(status_code=500, detail=f"Vanna init failed: {last_err}")

# ===================== Connection helpers (DATA DB only) =====================
def _connect_to_data(vn) -> None:
    if not (DATA_ENV.get("host") and DATA_ENV.get("dbname") and DATA_ENV.get("user") and DATA_ENV.get("password")):
        raise RuntimeError(
            "DATA Postgres env is incomplete. Set VANNA_DATA_PG_HOST, VANNA_DATA_PG_DB, VANNA_DATA_PG_USER, VANNA_DATA_PG_PASSWORD (and optionally VANNA_DATA_PG_PORT, VANNA_DATA_PG_SSLMODE)."
        )
    vn.connect_to_postgres(
        host=DATA_ENV["host"],
        dbname=DATA_ENV["dbname"],
        user=DATA_ENV["user"],
        password=DATA_ENV["password"],
        port=int(DATA_ENV["port"] or 5432),
        sslmode=DATA_ENV["sslmode"] or "require",
    )
    try:
        vn.run_sql("SET search_path TO public, pg_catalog")
    except Exception:
        pass
    CURRENT_CONN.update({
        "engine": "postgres",
        "details": {
            "host": DATA_ENV["host"],
            "port": int(DATA_ENV["port"] or 5432),
            "dbname": DATA_ENV["dbname"],
            "user": DATA_ENV["user"],
            "sslmode": DATA_ENV["sslmode"] or "require",
        },
    })

def _ensure_connected_or_reconnect(vn):
    """
    Probe connection and reconnect to DATA Postgres once if needed.
    """
    try:
        vn.run_sql("SELECT 1")
        return
    except Exception as probe_err:
        det = CURRENT_CONN.get("details") or {}
        if not det.get("host"):
            raise probe_err
        try:
            print("[Vanna] Reconnecting to DATA Postgres…")
            vn.connect_to_postgres(
                host=DATA_ENV["host"],
                dbname=DATA_ENV["dbname"],
                user=DATA_ENV["user"],
                password=DATA_ENV["password"],
                port=int(DATA_ENV["port"] or 5432),
                sslmode=DATA_ENV["sslmode"] or "require",
            )
            try:
                vn.run_sql("SET search_path TO public, pg_catalog")
            except Exception:
                pass
            vn.run_sql("SELECT 1")
            print("[Vanna] Reconnected")
        except Exception:
            raise probe_err

def _auto_connect_from_env(vn) -> None:
    if not all([DATA_ENV.get("host"), DATA_ENV.get("dbname"), DATA_ENV.get("user"), DATA_ENV.get("password")]):
        print("[Vanna] DATA env not fully set; skipping autoconnect")
        return
    try:
        print("[Vanna] Auto-connecting to DATA Postgres…")
        _connect_to_data(vn)
        _ensure_trained(vn)
    except Exception as e:
        print(f"[Vanna] Auto-connect failed: {e}")

def auto_connect_from_env():
    try:
        vn = get_vn()
        _auto_connect_from_env(vn)
    except Exception as e:
        print(f"[Vanna] auto_connect_from_env wrapper error: {e}")

# ===================== Auto-train on INFORMATION_SCHEMA (DATA DB) =====================
def _ensure_trained(vn):
    """
    Ensures the schema (INFORMATION_SCHEMA.COLUMNS) is in the vector store
    so the model can see DB metadata. This does NOT save Q→SQL pairs.
    """
    try:
        df_td = vn.get_training_data()
        empty = (df_td is None) or (getattr(df_td, "empty", False))
    except Exception:
        empty = True

    if empty:
        print("[Vanna] Training on INFORMATION_SCHEMA.COLUMNS…")
        _ensure_connected_or_reconnect(vn)
        df_info = vn.run_sql("SELECT * FROM INFORMATION_SCHEMA.COLUMNS")
        plan = vn.get_training_plan_generic(df_info)
        vn.train(plan=plan)
        print("[Vanna] Schema training completed")

# ===================== Index & health =====================
@router.get("", include_in_schema=False)
def index():
    return {
        "ok": True,
        "message": "Vanna API",
        "endpoints": [
            "/vanna/v0/health",
            "/vanna/v0/vectorstore_status",
            "/vanna/v0/connection_status",
            "/vanna/v0/connect/postgres",
            "/vanna/v0/disconnect",
            "/vanna/v0/get_training_data",
            "/vanna/v0/train",
            "/vanna/v0/train_file",
            "/vanna/v0/add_question_sql",
            "/vanna/v0/add_ddl",
            "/vanna/v0/add_documentation",
            "/vanna/v0/remove_training_data",
            "/vanna/v0/generate_sql",
            "/vanna/v0/is_sql_valid",
            "/vanna/v0/run_sql",
            "/vanna/v0/generate_plotly_figure",
            "/vanna/v0/generate_questions",
            "/vanna/v0/generate_question",
            "/vanna/v0/generate_summary",
            "/vanna/v0/should_generate_chart",
            "/vanna/v0/ask",
            "/vanna/v0/followups",
            "/vanna/v0/download_csv",
            "/vanna/v0/get_question_history",
            "/vanna/v0/load_question",
            "/vanna/v0/mark_correct",
        ],
    }

@router.get("/health")
def health():
    try:
        _ = get_vn()
        return {
            "status": "healthy",
            "engine": CURRENT_CONN.get("engine"),
            "details": CURRENT_CONN.get("details"),
            "vector_store": VECTOR_STORE["name"],
            "persist_directory": VECTOR_STORE["persist_directory"],
        }
    except Exception as e:
        return {"status": "unhealthy", "error": str(e)}

@router.get("/vectorstore_status")
def vectorstore_status():
    return {
        "vector_store": VECTOR_STORE["name"],
        "persist_directory": VECTOR_STORE["persist_directory"],
    }

@router.get("/connection_status")
def connection_status():
    global _user_connected, _manual_disconnect
    try:
        vn = get_vn()

        try:
            vn.run_sql("SELECT 1")
            return {
                "connected": True,
                "engine": CURRENT_CONN.get("engine"),
                "details": CURRENT_CONN.get("details"),
            }
        except Exception:
            if (not _user_connected) and (not _manual_disconnect) and AUTO_CONNECT:
                _auto_connect_from_env(vn)
                try:
                    vn.run_sql("SELECT 1")
                    return {
                        "connected": True,
                        "engine": CURRENT_CONN.get("engine"),
                        "details": CURRENT_CONN.get("details"),
                    }
                except Exception:
                    pass
            return {"connected": False}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ===================== Connect / Disconnect (DATA Postgres) =====================
@router.post("/connect/postgres")
def connect_postgres(payload: Dict[str, Any] = Body(...)):
    """
    Connect Vanna to the DATA database (not your auth/login DB).
    """
    global _manual_disconnect, _user_connected, DATA_ENV
    vn = get_vn()
    try:
        DATA_ENV.update({
            "host": payload.get("host") or DATA_ENV["host"],
            "dbname": payload.get("dbname") or DATA_ENV["dbname"],
            "user": payload.get("user") or DATA_ENV["user"],
            "password": payload.get("password") or DATA_ENV["password"],
            "port": int(payload.get("port") or DATA_ENV["port"] or 5432),
            "sslmode": payload.get("sslmode", DATA_ENV["sslmode"] or "require"),
        })
        _connect_to_data(vn)
        _manual_disconnect = False
        _user_connected = True
        _ensure_trained(vn)
        return {"success": True, "details": CURRENT_CONN["details"]}
    except Exception as e:
        _user_connected = False
        return {"success": False, "error": str(e)}

@router.post("/disconnect")
def disconnect():
    global _vn, _manual_disconnect, _user_connected, CURRENT_CONN
    _manual_disconnect = True
    _user_connected = False
    CURRENT_CONN = {"engine": None, "details": {}}
    try:
        vn = get_vn()
    except Exception:
        _vn = None
        return {"success": True, "disconnected": True}

    # best-effort cleanup
    for attr in ("engine", "_engine", "connection", "conn", "db", "pg_engine"):
        if hasattr(vn, attr):
            obj = getattr(vn, attr)
            for m in ("close", "dispose"):
                try:
                    getattr(obj, m)()
                except Exception:
                    pass
            try:
                setattr(vn, attr, None)
            except Exception:
                pass

    _vn = None
    return {"success": True, "disconnected": True}

# ===================== Training data (RAG) =====================
@router.get("/get_training_data")
def get_training_data():
    vn = get_vn()
    try:
        df = vn.get_training_data()
        return {"records": df.to_dict(orient="records")}
    except Exception as e:
        return {"error": str(e), "records": []}

@router.delete("/remove_training_data")
def remove_training_data(id: str = Query(...)):
    vn = get_vn()
    try:
        ok = bool(vn.remove_training_data(id=id))
        return {"ok": ok, "success": ok}
    except Exception as e:
        return {"ok": False, "success": False, "error": str(e)}

@router.post("/add_question_sql")
def add_question_sql(payload: Dict[str, Any] = Body(...)):
    """
    Add a Q&A pair to training: { question, sql }
    """
    vn = get_vn()
    q = payload.get("question")
    s = payload.get("sql")
    if not (q and s):
        raise HTTPException(status_code=400, detail="Provide 'question' and 'sql'")
    try:
        id_ = vn.add_question_sql(question=q, sql=s)
        return {"id": id_}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/add_ddl")
def add_ddl(payload: Dict[str, Any] = Body(...)):
    """
    Add a DDL blob to training: { ddl }
    """
    vn = get_vn()
    d = payload.get("ddl")
    if not d:
        raise HTTPException(status_code=400, detail="Provide 'ddl'")
    try:
        id_ = vn.add_ddl(ddl=d)
        return {"id": id_}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/add_documentation")
def add_documentation(payload: Dict[str, Any] = Body(...)):
    """
    Add free-form docs to training: { documentation }
    """
    vn = get_vn()
    doc = payload.get("documentation")
    if not doc:
        raise HTTPException(status_code=400, detail="Provide 'documentation'")
    try:
        id_ = vn.add_documentation(documentation=doc)
        return {"id": id_}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/train")
def train(payload: Dict[str, Any] = Body(...)):
    """
    Flexible trainer. Accepts any of: question+sql, ddl, documentation, plan.
    If none provided, trains automatically on INFORMATION_SCHEMA.COLUMNS.
    """
    vn = get_vn()
    try:
        q   = payload.get("question")
        s   = payload.get("sql")
        d   = payload.get("ddl")
        doc = payload.get("documentation")
        plan= payload.get("plan")

        if any([q, s, d, doc, plan]):
            vn.train(question=q, sql=s, ddl=d, documentation=doc, plan=plan)
            return {"status": "trained"}

        # Auto-train on schema
        _ensure_connected_or_reconnect(vn)
        df_info = vn.run_sql("SELECT * FROM INFORMATION_SCHEMA.COLUMNS")
        tr_plan = vn.get_training_plan_generic(df_info)
        vn.train(plan=tr_plan)
        return {"status": "trained", "auto": True}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/mark_correct")
def mark_correct(payload: Dict[str, Any] = Body(...)):
    """
    Save a verified Q→SQL pair to the vector store.
    Accepts either:
      - { "id": "<qid>" }  -> uses cached question+sql from /generate_sql
      - { "question": "...", "sql": "..." }
      - You can also pass { "id": "<qid>", "sql": "<corrected>" } to override SQL.
    """
    vn = get_vn()
    qid = payload.get("id")
    q = payload.get("question")
    s = payload.get("sql")

    if qid:
        q = q or cache.get(qid, "question")
        s = s or cache.get(qid, "sql")

    if not (q and s):
        raise HTTPException(status_code=400, detail="Missing question/sql (or invalid id)")

    try:
        tid = vn.add_question_sql(question=q, sql=extract_sql(s))
        return {"saved": True, "training_id": tid}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/train_file")
async def train_file(kind: Optional[str] = Query(None), file: UploadFile = File(...)):
    """
    Upload training data:
      - .json: [{"ddl":...} | {"documentation":...} | {"question":..., "sql":...}, ...]
      - .sql : DDL statements (CREATE/ALTER/VIEW/FUNCTION/etc.) -> added via add_ddl
    """
    vn = get_vn()
    try:
        filename = file.filename or ""
        suffix = filename.lower().rsplit(".", 1)[-1] if "." in filename else ""
        if kind not in (None, "sql", "json"):
            raise HTTPException(status_code=400, detail="kind must be 'sql' or 'json'")
        if not kind:
            kind = "json" if suffix == "json" else "sql"

        data = await file.read()

        if kind == "json":
            import json
            try:
                payload = json.loads(data.decode("utf-8"))
                if not isinstance(payload, list):
                    raise ValueError("JSON root must be a list")
            except Exception as e:
                raise HTTPException(status_code=400, detail=f"Invalid JSON: {e}")

            added: List[str] = []
            for item in payload:
                if not isinstance(item, dict):
                    continue
                if "ddl" in item and item["ddl"]:
                    try:
                        added.append(vn.add_ddl(item["ddl"]))
                    except Exception:
                        pass
                if "documentation" in item and item["documentation"]:
                    try:
                        added.append(vn.add_documentation(item["documentation"]))
                    except Exception:
                        pass
                if "question" in item and "sql" in item and item["sql"]:
                    try:
                        added.append(vn.add_question_sql(question=item["question"], sql=item["sql"]))
                    except Exception:
                        pass

            return {"status": "trained", "kind": "json", "count": len(added)}
        else:
            # crude DDL splitter: each ;-terminated statement; add DDL-like statements
            text = data.decode("utf-8", errors="ignore")
            statements = [s.strip() for s in re.split(r";\s*(?=\S)", text) if s.strip()]
            ddl_like = re.compile(r"(?is)^\s*(CREATE|ALTER|DROP|COMMENT|REPLACE|GRANT|REVOKE|TRUNCATE|CREATE\s+OR\s+REPLACE|WITH\s+NO\s+DATA|VIEW|FUNCTION|PROCEDURE)\b")
            added = 0
            for stmt in statements:
                if ddl_like.search(stmt):
                    try:
                        vn.add_ddl(stmt if stmt.endswith(";") else stmt + ";")
                        added += 1
                    except Exception:
                        pass
            return {"status": "trained", "kind": "sql", "count": added}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ===================== SQL generation / validity / execution =====================
@router.get("/generate_sql")
def generate_sql(question: Optional[str] = Query(None), allow_llm_to_see_data: bool = Query(True)):
    vn = get_vn()
    if not question:
        raise HTTPException(status_code=400, detail="No question provided")

    # Optional introspection + ensure we have schema in the store
    if allow_llm_to_see_data:
        try:
            _ensure_connected_or_reconnect(vn)
            _ensure_trained(vn)
        except Exception:
            pass

    try:
        try:
            raw = vn.generate_sql(question=question, allow_llm_to_see_data=allow_llm_to_see_data)
        except TypeError:
            try:
                setattr(vn, "allow_llm_to_see_data", allow_llm_to_see_data)
            except Exception:
                pass
            raw = vn.generate_sql(question=question)

        sql = extract_sql(raw)
        # If model ignored instructions, do a hard, SQL-only retry
        if not _SQL_LINE_START.search(sql or ""):
            raw_retry = _force_sql_only(vn, question)
            sql_retry = extract_sql(raw_retry)
            if _SQL_LINE_START.search(sql_retry or ""):
                raw = raw_retry
                sql = sql_retry

        print(f"LLM Response: {raw}")
        print(f"Extracted SQL: {sql}")

        qid = cache.generate_id(question=question)
        cache.set(id=qid, field="question", value=question)
        cache.set(id=qid, field="sql", value=sql)
        cache.set(id=qid, field="raw", value=raw)
        return {"type": "sql", "id": qid, "text": sql, "raw": raw}

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"SQL generation failed: {str(e)}")

@router.get("/is_sql_valid")
def is_sql_valid(sql: str = Query(...)):
    vn = get_vn()
    try:
        valid = vn.is_sql_valid(sql)
        return {"valid": bool(valid)}
    except Exception as e:
        return {"valid": False, "error": str(e)}

@router.get("/run_sql")
def run_sql(id: Optional[str] = Query(None), sql: Optional[str] = Query(None), limit: int = Query(100)):
    vn = get_vn()
    if sql and sql.strip():
        query = sql
    elif id:
        cached = cache.get(id, "sql")
        if not cached:
            raise HTTPException(status_code=400, detail="No SQL found for this id")
        query = cached
    else:
        raise HTTPException(status_code=400, detail="Provide 'id' or 'sql'")

    query = extract_sql(query)

    try:
        _ensure_connected_or_reconnect(vn)
        df = vn.run_sql(sql=query)
        if id:
            cache.set(id=id, field="df", value=df)
        return {"type": "df", "id": id or "", "df": df.head(limit).to_json(orient="records")}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"SQL execution failed: {str(e)}")

# ===================== Viz / followups / summaries =====================
@router.get("/generate_plotly_figure")
def generate_plotly_figure(id: str = Query(...), dark: bool = Query(False)):
    vn = get_vn()
    question = cache.get(id, "question")
    sql = cache.get(id, "sql")
    df  = cache.get(id, "df")

    if not question or not sql or df is None:
        raise HTTPException(status_code=400, detail="Run the SQL first")

    try:
        code = vn.generate_plotly_code(
            question=question,
            sql=sql,
            df_metadata=f"Running df.dtypes gives:\n{df.dtypes}",
        )
        fig = vn.get_plotly_figure(plotly_code=code, df=df, dark_mode=bool(dark))
        fig_json = fig.to_json() if fig is not None else None
        cache.set(id=id, field="fig_json", value=fig_json)
        return {"type": "plotly_figure", "id": id, "fig": fig_json, "code": code}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Visualization generation failed: {str(e)}")

@router.get("/generate_questions")
def generate_questions(n: int = Query(10)):
    vn = get_vn()
    try:
        _ensure_connected_or_reconnect(vn)
        _ensure_trained(vn)
    except Exception:
        pass

    try:
        questions = vn.generate_questions()
        if isinstance(questions, list):
            return {"questions": questions[:n]}
        return {"questions": []}
    except Exception as e:
        return {"questions": [], "error": str(e)}

@router.post("/generate_question")
def generate_question(payload: Dict[str, Any] = Body(...)):
    vn = get_vn()
    sql = payload.get("sql")
    if not sql:
        raise HTTPException(status_code=400, detail="No SQL provided")
    try:
        question = vn.generate_question(sql)
        return {"question": question}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Question generation failed: {str(e)}")

@router.post("/generate_summary")
def generate_summary(payload: Dict[str, Any] = Body(...)):
    vn = get_vn()
    question = payload.get("question")
    df_json = payload.get("df")
    if not question or df_json is None:
        raise HTTPException(status_code=400, detail="Question and df required")
    try:
        df = pd.DataFrame(df_json)
        summary = vn.generate_summary(question=question, df=df)
        return {"summary": summary}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Summary generation failed: {str(e)}")

@router.post("/should_generate_chart")
def should_generate_chart(payload: Dict[str, Any] = Body(...)):
    vn = get_vn()
    df_json = payload.get("df")
    if df_json is None:
        raise HTTPException(status_code=400, detail="DataFrame required")
    try:
        df = pd.DataFrame(df_json)
        should_chart = vn.should_generate_chart(df)
        return {"should_generate_chart": bool(should_chart)}
    except Exception as e:
        return {"should_generate_chart": False, "error": str(e)}

@router.get("/followups")
def followups(id: str = Query(...), n: int = Query(5)):
    vn = get_vn()
    question = cache.get(id, "question")
    sql = cache.get(id, "sql")
    df  = cache.get(id, "df")

    if not question or not sql or df is None:
        raise HTTPException(status_code=400, detail="Run the SQL first")

    try:
        qlist = vn.generate_followup_questions(
            question=question, sql=sql, df=df, n_questions=int(n)
        )
        cache.set(id=id, field="followup_questions", value=qlist)
        return {"type": "question_list", "id": id, "questions": qlist}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

# ===================== One-shot ask (SQL -> run -> viz) =====================
@router.post("/ask")
def ask_endpoint(payload: Dict[str, Any] = Body(...)):
    """
    Orchestrates: generate SQL, (optional introspection), run, plot, followups.
    Does NOT auto-save Q→SQL. Use /mark_correct to save.
    """
    vn = get_vn()
    question = payload.get("question")
    auto_train = payload.get("auto_train", False)  # default FALSE (no auto-saving)
    visualize = payload.get("visualize", True)
    allow_llm_to_see_data = payload.get("allow_llm_to_see_data", False)

    if not question:
        raise HTTPException(status_code=400, detail="Question required")

    # try to seed the context
    if allow_llm_to_see_data:
        try:
            _ensure_connected_or_reconnect(vn)
            _ensure_trained(vn)
        except Exception:
            pass

    try:
        result = vn.ask(
            question=question,
            print_results=False,
            auto_train=auto_train,
            visualize=visualize,
            allow_llm_to_see_data=allow_llm_to_see_data
        )

        if result is None:
            return {"error": "Failed to process question"}

        sql, df, fig = result

        qid = cache.generate_id(question=question)
        cache.set(id=qid, field="question", value=question)
        cache.set(id=qid, field="sql", value=sql)
        if df is not None:
            cache.set(id=qid, field="df", value=df)
        if fig is not None:
            cache.set(id=qid, field="fig_json", value=fig.to_json())

        response: Dict[str, Any] = {"id": qid, "question": question, "sql": sql}
        if df is not None:
            response["df"] = df.head(50).to_json(orient="records")
            response["row_count"] = len(df)
        if fig is not None:
            response["fig"] = fig.to_json()

        return response
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Ask failed: {str(e)}")

# ===================== CSV download & history =====================
@router.get("/download_csv")
def download_csv(id: str = Query(...)):
    df = cache.get(id, "df")
    if df is None:
        raise HTTPException(status_code=400, detail="No DataFrame found for this id")
    csv = df.to_csv(index=False)
    return Response(
        content=csv,
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{id}.csv"'},
    )

@router.get("/load_question")
def load_question(id: str = Query(...)):
    question = cache.get(id, "question")
    sql = cache.get(id, "sql")
    df = cache.get(id, "df")
    fig_json = cache.get(id, "fig_json")
    followup_questions = cache.get(id, "followup_questions")

    if not question or not sql:
        raise HTTPException(status_code=404, detail="Question not found")

    result: Dict[str, Any] = {
        "type": "question_cache",
        "id": id,
        "question": question,
        "sql": sql,
    }
    if df is not None:
        result["df"] = df.head(10).to_json(orient="records")
    if fig_json:
        result["fig"] = fig_json
    if followup_questions:
        result["followup_questions"] = followup_questions
    return result

@router.get("/get_question_history")
def get_question_history():
    try:
        history = cache.get_all(field_list=["question"])
        return {
            "type": "question_history",
            "questions": [x for x in history if x.get("question")],
        }
    except Exception as e:
        return {"type": "question_history", "questions": [], "error": str(e)}

