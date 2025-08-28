# backend/vanna_router.py
import os
import time
import uuid
from typing import Any, Dict, Optional

from fastapi import APIRouter, HTTPException, Query, Response, Body

router = APIRouter(prefix="/vanna/v0", tags=["vanna"])

# ----------------- Small index so /vanna/v0 doesn't 404 -----------------
@router.get("", include_in_schema=False)
def index():
    return {
        "ok": True,
        "endpoints": [
            "/vanna/v0/health",
            "/vanna/v0/connection_status",
            "/vanna/v0/connect/postgres",
            "/vanna/v0/get_training_data",
            "/vanna/v0/generate_sql",
            "/vanna/v0/run_sql",
            "/vanna/v0/generate_plotly_figure",
            "/vanna/v0/followups",
            "/vanna/v0/download_csv",
            "/vanna/v0/ask",
            "/vanna/v0/get_question_history",
            "/vanna/v0/load_question",
        ],
    }

# ----------------- Simple in-mem cache -----------------
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
            {
                "id": id,
                **{field: self.get(id=id, field=field) for field in field_list},
            }
            for id in self.cache
        ]

    def delete(self, id: str):
        self.cache.pop(id, None)


cache = MemoryCache()
_vn = None  # lazy global


def _new_id() -> str:
    return uuid.uuid4().hex


# ----------------- Build Vanna -----------------
def _build_vn():
    """
    Prefer Vanna Cloud if VANNA_MODEL & VANNA_API_KEY are set.
    Else use Ollama via its OpenAI-compatible /v1 API + ChromaDB.
    """
    print("[Vanna] Building Vanna instance...")

    # --- Vanna Cloud (if provided) ---
    if os.getenv("VANNA_MODEL") and os.getenv("VANNA_API_KEY"):
        print("[Vanna] Using Vanna Cloud")
        from vanna.remote import VannaDefault

        return VannaDefault(
            model=os.environ["VANNA_MODEL"], api_key=os.environ["VANNA_API_KEY"]
        )

    # --- Local: Ollama (OpenAI-compatible) + ChromaDB ---
    print("[Vanna] Using Ollama (OpenAI-compatible) + ChromaDB")

    from openai import OpenAI
    from vanna.openai import OpenAI_Chat
    from vanna.chromadb import ChromaDB_VectorStore

    host = os.getenv("OLLAMA_HOST", "http://ollama:11434").rstrip("/")
    base_url = f"{host}/v1"  # IMPORTANT: talk to Ollama's OpenAI-compatible API
    model = os.getenv("OLLAMA_MODEL", "mistral:latest")
    chroma_dir = os.getenv("VANNA_CHROMA_DIR", "/app/.chroma")
    api_key = os.getenv("OLLAMA_API_KEY", "ollama")  # required by OpenAI client, unused

    print(f"[Vanna] Configuration - Host: {host}, Model: {model}, ChromaDB: {chroma_dir}")
    print(f"[Vanna] Connecting to Ollama OpenAI API at: {base_url}")

    # Create OpenAI client pointed at Ollama
    client = OpenAI(base_url=base_url, api_key=api_key)

    class MyVanna(OpenAI_Chat, ChromaDB_VectorStore):
        def __init__(self):
            print("[Vanna] Initializing ChromaDB...")
            ChromaDB_VectorStore.__init__(self, config={"persist_directory": chroma_dir})
            print("[Vanna] ChromaDB initialized successfully")

            print("[Vanna] Initializing OpenAI_Chat (Ollama)…")
            OpenAI_Chat.__init__(self, client=client, config={"model": model})
            print("[Vanna] OpenAI_Chat initialized successfully")

    return MyVanna()


def get_vn():
    """Get or create the Vanna instance with retry logic."""
    global _vn
    if _vn is not None:
        return _vn

    print("[Vanna] Initializing Vanna instance...")
    last_err: Optional[Exception] = None
    for attempt in range(5):
        try:
            print(f"[Vanna] Attempt {attempt + 1}/5")
            _vn = _build_vn()
            print("[Vanna] Vanna instance created successfully")
            return _vn
        except Exception as e:  # noqa: BLE001
            last_err = e
            print(f"[Vanna] Attempt {attempt + 1} failed: {e}")
            if attempt < 4:
                time.sleep(2)

    error_msg = f"Vanna init failed after 5 attempts: {last_err}"
    print(f"[Vanna] {error_msg}")
    raise HTTPException(status_code=500, detail=error_msg)


def _auto_connect_from_env(vn) -> None:
    """Try to auto-connect to PostgreSQL using environment variables."""
    host = os.getenv("VANNA_PG_HOST")
    db = os.getenv("VANNA_PG_DB")
    user = os.getenv("VANNA_PG_USER")
    pwd = os.getenv("VANNA_PG_PASSWORD")
    port = os.getenv("VANNA_PG_PORT") or "5432"

    if host and db and user and pwd:
        try:
            print(f"[Vanna] Auto-connecting to PostgreSQL at {host}:{port}/{db}")
            vn.connect_to_postgres(
                host=host, dbname=db, user=user, password=pwd, port=int(port)
            )
            print("[Vanna] PostgreSQL auto-connection successful")
        except Exception as e:  # noqa: BLE001
            print(f"[Vanna] PostgreSQL auto-connection failed: {e}")
    else:
        print("[Vanna] PostgreSQL auto-connection skipped - missing environment variables")


# ==================== HEALTH & STATUS ====================

@router.get("/health")
def health():
    try:
        _ = get_vn()
        return {"status": "healthy", "vanna_initialized": True, "model": os.getenv("OLLAMA_MODEL", "mistral:latest")}
    except Exception as e:  # noqa: BLE001
        return {"status": "unhealthy", "vanna_initialized": False, "error": str(e)}


@router.get("/connection_status", name="connection_status")
@router.get("/connection-status", include_in_schema=False)
def connection_status():
    """Check database connection status (with alias path)."""
    try:
        vn = get_vn()
        try:
            vn.run_sql("SELECT 1 as ok")
            return {"connected": True, "engine": "postgres", "details": {"dbname": os.getenv("VANNA_PG_DB", "")}}
        except Exception:
            print("[Vanna] Database not connected, trying auto-connect...")
            _auto_connect_from_env(vn)
            try:
                vn.run_sql("SELECT 1 as ok")
                return {"connected": True, "engine": "postgres", "details": {"dbname": os.getenv("VANNA_PG_DB", "")}}
            except Exception:
                return {"connected": False}
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=str(e))


# ==================== DATABASE CONNECTIONS ====================

@router.post("/connect/postgres")
def connect_postgres(payload: Dict[str, Any] = Body(...)):
    vn = get_vn()
    try:
        vn.connect_to_postgres(
            host=payload.get("host"),
            dbname=payload.get("dbname"),
            user=payload.get("user"),
            password=payload.get("password"),
            port=int(payload.get("port", 5432)),
        )
        return {"success": True}
    except Exception as e:  # noqa: BLE001
        return {"success": False, "error": str(e)}


@router.post("/connect/sqlite")
def connect_sqlite(payload: Dict[str, Any] = Body(...)):
    vn = get_vn()
    url = payload.get("url")
    if not url:
        raise HTTPException(status_code=400, detail="Missing 'url'")
    try:
        vn.connect_to_sqlite(url=url)
        return {"success": True}
    except Exception as e:  # noqa: BLE001
        return {"success": False, "error": str(e)}


@router.post("/connect/duckdb")
def connect_duckdb(payload: Dict[str, Any] = Body(...)):
    vn = get_vn()
    url = payload.get("url")
    if not url:
        raise HTTPException(status_code=400, detail="Missing 'url'")
    try:
        vn.connect_to_duckdb(url=url, init_sql=payload.get("init_sql"))
        return {"success": True}
    except Exception as e:  # noqa: BLE001
        return {"success": False, "error": str(e)}


# ==================== TRAINING DATA ====================

@router.get("/get_training_data")
def get_training_data():
    vn = get_vn()
    try:
        df = vn.get_training_data()
        return {"records": df.to_dict(orient="records")}
    except Exception as e:  # noqa: BLE001
        return {"error": str(e)}


@router.post("/add_ddl")
def add_ddl(payload: Dict[str, Any] = Body(...)):
    vn = get_vn()
    ddl = payload.get("ddl")
    if not ddl:
        raise HTTPException(status_code=400, detail="Missing 'ddl'")
    return {"id": vn.add_ddl(ddl)}


@router.post("/add_documentation")
def add_documentation(payload: Dict[str, Any] = Body(...)):
    vn = get_vn()
    doc = payload.get("documentation")
    if not doc:
        raise HTTPException(status_code=400, detail="Missing 'documentation'")
    return {"id": vn.add_documentation(doc)}


@router.post("/add_question_sql")
def add_question_sql(payload: Dict[str, Any] = Body(...)):
    vn = get_vn()
    q = payload.get("question")
    s = payload.get("sql")
    if not q or not s:
        raise HTTPException(status_code=400, detail="Missing 'question' or 'sql'")
    return {"id": vn.add_question_sql(question=q, sql=s)}


@router.delete("/remove_training_data")
def remove_training_data(id: str = Query(...)):
    vn = get_vn()
    return {"ok": bool(vn.remove_training_data(id=id))}


@router.post("/train")
def train(payload: Dict[str, Any] = Body(...)):
    vn = get_vn()
    try:
        q = payload.get("question")
        s = payload.get("sql")
        d = payload.get("ddl")
        doc = payload.get("documentation")
        plan = payload.get("plan")

        if any([q, s, d, doc, plan]):
            vn.train(question=q, sql=s, ddl=d, documentation=doc, plan=plan)
            return {"status": "trained"}

        print("[Vanna] Auto-training on database schema...")
        df_info = vn.run_sql("SELECT * FROM INFORMATION_SCHEMA.COLUMNS")
        tr_plan = vn.get_training_plan_generic(df_info)
        vn.train(plan=tr_plan)
        return {"status": "trained", "auto": True}

    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=str(e))


# ==================== SQL GENERATION & EXECUTION ====================

@router.get("/generate_sql")
def generate_sql(question: Optional[str] = Query(None)):
    vn = get_vn()
    if not question:
        raise HTTPException(status_code=400, detail="No question provided")

    sql = vn.generate_sql(question=question)
    qid = cache.generate_id(question=question)
    cache.set(id=qid, field="question", value=question)
    cache.set(id=qid, field="sql", value=sql)
    return {"type": "sql", "id": qid, "text": sql}


@router.get("/run_sql")
def run_sql(id: Optional[str] = Query(None), sql: Optional[str] = Query(None), limit: int = Query(100)):
    vn = get_vn()
    if not id and not sql:
        raise HTTPException(status_code=400, detail="Provide 'id' or 'sql'")

    if id:
        item = cache.get(id, "sql")
        if not item:
            raise HTTPException(status_code=400, detail="No SQL found for this id")
        sql = item

    try:
        df = vn.run_sql(sql=sql)
        if id:
            cache.set(id=id, field="df", value=df)

        return {"type": "df", "id": id or "", "df": df.head(limit).to_json(orient="records")}
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"SQL execution failed: {str(e)}")


@router.get("/generate_questions")
def generate_questions():
    vn = get_vn()
    try:
        questions = vn.generate_questions()
        return {"type": "question_list", "questions": questions, "header": "Here are some questions you can ask:"}
    except Exception as e:  # noqa: BLE001
        return {"type": "question_list", "questions": [], "header": f"Error generating questions: {str(e)}"}


# ==================== ANALYSIS & VISUALIZATION ====================

@router.get("/followups")
def followups(id: str = Query(...), n: int = Query(5)):
    vn = get_vn()
    question = cache.get(id, "question")
    sql = cache.get(id, "sql")
    df = cache.get(id, "df")

    if not question or not sql or df is None:
        raise HTTPException(status_code=400, detail="Run the SQL first")

    try:
        followup_questions = vn.generate_followup_questions(
            question=question, sql=sql, df=df, n_questions=n
        )
        cache.set(id=id, field="followup_questions", value=followup_questions)
        return {"type": "question_list", "id": id, "questions": followup_questions, "header": "Here are some followup questions you can ask:"}
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/generate_plotly_figure")
def generate_plotly_figure(id: str = Query(...), dark: bool = Query(False)):
    vn = get_vn()

    question = cache.get(id, "question")
    sql = cache.get(id, "sql")
    df = cache.get(id, "df")

    if not question or not sql or df is None:
        raise HTTPException(status_code=400, detail="Run the SQL first")

    try:
        code = vn.generate_plotly_code(
            question=question,
            sql=sql,
            df_metadata=f"Running df.dtypes gives:\n{df.dtypes}",
        )
        fig = vn.get_plotly_figure(plotly_code=code, df=df, dark_mode=bool(dark))
        fig_json = fig.to_json()
        cache.set(id=id, field="fig_json", value=fig_json)
        return {"type": "plotly_figure", "id": id, "fig": fig_json}
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f"Visualization generation failed: {str(e)}")


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


# ==================== COMPLETE WORKFLOW ====================

@router.get("/ask")
def ask(question: str = Query(...), visualize: bool = Query(True)):
    vn = get_vn()
    try:
        sql = vn.generate_sql(question=question)
        df = vn.run_sql(sql=sql)

        result = {"question": question, "sql": sql, "df": df.head(100).to_json(orient="records")}

        if visualize and not df.empty:
            try:
                code = vn.generate_plotly_code(
                    question=question, sql=sql, df_metadata=f"Running df.dtypes gives:\n{df.dtypes}"
                )
                fig = vn.get_plotly_figure(plotly_code=code, df=df, dark_mode=False)
                result["fig"] = fig.to_json()
            except Exception as viz_error:  # noqa: BLE001
                print(f"[Vanna] Visualization error: {viz_error}")

        return result
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=str(e))


# ==================== CACHING & HISTORY ====================

@router.get("/load_question")
def load_question(id: str = Query(...)):
    question = cache.get(id, "question")
    sql = cache.get(id, "sql")
    df = cache.get(id, "df")
    fig_json = cache.get(id, "fig_json")
    followup_questions = cache.get(id, "followup_questions")

    if not question or not sql:
        raise HTTPException(status_code=404, detail="Question not found")

    result: Dict[str, Any] = {"type": "question_cache", "id": id, "question": question, "sql": sql}
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
        return {"type": "question_history", "questions": [item for item in history if item.get("question")]}
    except Exception as e:  # noqa: BLE001
        return {"type": "question_history", "questions": [], "error": str(e)}


# ==================== STARTUP HOOK ====================

def auto_connect_from_env():
    try:
        print("[Vanna] Running auto-connect from environment...")
        vn = get_vn()
        _auto_connect_from_env(vn)
        print("[Vanna] Auto-connect completed successfully")
    except Exception as e:  # noqa: BLE001
        print(f"[Vanna] Auto-connect failed: {e}")
