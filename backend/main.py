import os, uuid, json, time, base64 as b64mod, secrets, re, asyncio, subprocess, zipfile, io, sys
from pathlib import Path
from collections import defaultdict
from fastapi import FastAPI, UploadFile, File, HTTPException, BackgroundTasks, Depends, status, Header, Request, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel
from typing import Optional
import anthropic
import httpx
from db import init_db, get_db, Book, Progress, engine
from sqlalchemy import text
from epub_parser import parse_epub
from sqlalchemy.orm import Session

# ── Config ───────────────────────────────────────────────────────────────────
BOOKS_DIR      = Path("/data/books")
AUDIO_DIR      = Path("/data/audio")
KOKORO_URL     = os.getenv("KOKORO_URL", "http://kokoro:8880")
ANTHROPIC_KEY  = os.getenv("ANTHROPIC_API_KEY")
APP_USERNAME   = os.getenv("APP_USERNAME", "admin")
APP_PASSWORD   = os.getenv("APP_PASSWORD", "changeme")
ALLOWED_ORIGIN = os.getenv("ALLOWED_ORIGIN", "http://localhost:3001")

MAX_UPLOAD_BYTES  = 50 * 1024 * 1024
EPUB_MAGIC_BYTES  = b"PK"
PARALLEL_CHAPTERS = 4

KOKORO_VOICES = ["af_bella", "af_sarah", "am_adam", "am_michael",
                 "bf_emma", "bm_george", "af_nicole", "am_liam"]

SUMMARY_CACHE: dict = {}
APP_START_TIME = time.time()
APP_VERSION    = "1.0.0"

# ── App setup ────────────────────────────────────────────────────────────────
app = FastAPI(
    title="Audiobook Library",
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[ALLOWED_ORIGIN, "http://localhost:3001"],
    allow_credentials=True,
    allow_methods=["GET", "POST", "DELETE"],
    allow_headers=["Authorization", "Content-Type", "x-session-token"],
)

init_db()

def migrate_db():
    """Add columns introduced after initial schema without a migrations framework."""
    with engine.connect() as conn:
        for stmt in [
            "ALTER TABLE books    ADD COLUMN eta_seconds INTEGER",
            "ALTER TABLE progress ADD COLUMN completed   BOOLEAN DEFAULT 0",
        ]:
            try:
                conn.execute(text(stmt))
                conn.commit()
            except Exception:
                pass  # column already exists

migrate_db()

AUDIO_FILENAME_RE = re.compile(r'^[\w\-]+\.(mp3|jpg|png|json)$')

@app.get("/audio/{book_id}/{filename}")
async def serve_audio(book_id: str, filename: str, token: Optional[str] = Query(None)):
    if not _token_valid(token):
        raise HTTPException(status_code=401, detail="Not authenticated")
    if not re.match(r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$', book_id):
        raise HTTPException(status_code=400, detail="Invalid book ID")
    if not AUDIO_FILENAME_RE.match(filename):
        raise HTTPException(status_code=400, detail="Invalid filename")
    file_path = AUDIO_DIR / book_id / filename
    if not file_path.exists() or not file_path.is_file():
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(file_path)

# ── Auth ─────────────────────────────────────────────────────────────────────
SESSION_TOKENS: dict = {}   # token -> expiry timestamp
FAILED_ATTEMPTS: dict = defaultdict(lambda: {"count": 0, "lockout_until": 0})
MAX_ATTEMPTS       = 5
LOCKOUT_SECONDS    = 300    # 5 minutes
TOKEN_EXPIRY       = 86400  # 24 hours

def get_client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    return forwarded.split(",")[0].strip() if forwarded else request.client.host

def _token_valid(token: Optional[str]) -> bool:
    if not token:
        return False
    expiry = SESSION_TOKENS.get(token)
    if not expiry or time.time() > expiry:
        SESSION_TOKENS.pop(token, None)
        return False
    return True

def require_auth(x_session_token: Optional[str] = Header(None)):
    if not _token_valid(x_session_token):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not authenticated")
    return x_session_token

@app.post("/api/login")
def login(credentials: dict, request: Request):
    ip = get_client_ip(request)
    attempt = FAILED_ATTEMPTS[ip]

    if attempt["lockout_until"] > time.time():
        remaining = int(attempt["lockout_until"] - time.time())
        raise HTTPException(status_code=429, detail=f"Too many failed attempts. Try again in {remaining} seconds.")

    username = credentials.get("username", "")
    password = credentials.get("password", "")
    correct_user = secrets.compare_digest(username.encode(), APP_USERNAME.encode())
    correct_pass = secrets.compare_digest(password.encode(), APP_PASSWORD.encode())

    if not (correct_user and correct_pass):
        attempt["count"] += 1
        if attempt["count"] >= MAX_ATTEMPTS:
            attempt["lockout_until"] = time.time() + LOCKOUT_SECONDS
            attempt["count"] = 0
            raise HTTPException(status_code=429, detail=f"Too many failed attempts. Locked out for {LOCKOUT_SECONDS // 60} minutes.")
        remaining_attempts = MAX_ATTEMPTS - attempt["count"]
        raise HTTPException(status_code=401, detail=f"Invalid credentials. {remaining_attempts} attempt{'s' if remaining_attempts != 1 else ''} remaining.")

    FAILED_ATTEMPTS.pop(ip, None)
    # purge any expired tokens to keep the set lean
    now = time.time()
    expired = [t for t, exp in SESSION_TOKENS.items() if now > exp]
    for t in expired:
        SESSION_TOKENS.pop(t, None)
    token = secrets.token_hex(32)
    SESSION_TOKENS[token] = now + TOKEN_EXPIRY
    return {"token": token, "username": APP_USERNAME}

@app.post("/api/logout")
def logout(x_session_token: Optional[str] = Header(None)):
    SESSION_TOKENS.pop(x_session_token, None)
    return {"ok": True}

# ── Models ───────────────────────────────────────────────────────────────────
class VoiceRegenRequest(BaseModel):
    book_id: str
    exclude_voice: Optional[str] = None

class SubmitRequest(BaseModel):
    book_id: str
    voice: str

class ProgressUpdate(BaseModel):
    book_id: str
    chapter_index: int
    position_seconds: float
    completed: bool = False

# ── Helpers ──────────────────────────────────────────────────────────────────
def db_session():
    return next(get_db())

def get_book_or_404(book_id: str, db: Session):
    if not re.match(r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$', book_id):
        raise HTTPException(400, "Invalid book ID")
    book = db.query(Book).filter(Book.id == book_id).first()
    if not book:
        raise HTTPException(404, "Book not found")
    return book

def validate_epub(data: bytes):
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, f"File too large. Maximum size is {MAX_UPLOAD_BYTES // 1024 // 1024}MB")
    if not data.startswith(EPUB_MAGIC_BYTES):
        raise HTTPException(400, "File does not appear to be a valid epub")
    try:
        with zipfile.ZipFile(io.BytesIO(data)) as zf:
            if 'mimetype' not in zf.namelist():
                raise HTTPException(400, "File does not appear to be a valid epub")
            if zf.read('mimetype').strip() != b'application/epub+zip':
                raise HTTPException(400, "File does not appear to be a valid epub")
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(400, "File does not appear to be a valid epub")

async def generate_voice_sample(voice: str, text: str, out_path: Path):
    async with httpx.AsyncClient(timeout=60) as client:
        resp = await client.post(f"{KOKORO_URL}/v1/audio/speech", json={
            "model": "kokoro", "input": text[:300],
            "voice": voice, "response_format": "mp3"
        })
        resp.raise_for_status()
        out_path.write_bytes(resp.content)

async def ask_claude_for_voice(title: str, summary: str, exclude: Optional[str] = None) -> dict:
    client = anthropic.Anthropic(api_key=ANTHROPIC_KEY)
    voices_list = [v for v in KOKORO_VOICES if v != exclude]
    prompt = f"""You are helping pick the perfect audiobook narrator voice.

Book title: {title}
Summary: {summary[:800]}

Available Kokoro TTS voices:
- af_bella: warm American female, romance/drama
- af_sarah: clear American female, non-fiction/thrillers
- am_adam: deep American male, adventure/sci-fi
- am_michael: authoritative American male, history/non-fiction
- bf_emma: elegant British female, literary fiction/classics
- bm_george: distinguished British male, mystery/historical
- af_nicole: bright American female, YA/contemporary
- am_liam: young American male, YA/action

From this list: {voices_list}
Pick the single best voice. Reply ONLY with JSON:
{{"voice": "<voice_name>", "reason": "<one sentence why>"}}"""

    msg = client.messages.create(
        model="claude-sonnet-4-20250514", max_tokens=200,
        messages=[{"role": "user", "content": prompt}]
    )
    raw = msg.content[0].text.strip().replace("```json", "").replace("```", "").strip()
    return json.loads(raw)

def _ensure_chapter_durations(book_id: str) -> tuple:
    """Return (total_seconds, chapters). Writes duration into manifest entries if missing."""
    manifest_path = AUDIO_DIR / book_id / "manifest.json"
    if not manifest_path.exists():
        return 0, []
    try:
        chapters = json.loads(manifest_path.read_text())
        updated = False
        for ch in chapters:
            if "duration" not in ch:
                mp3 = AUDIO_DIR / book_id / Path(ch["file"]).name
                if mp3.exists():
                    r = subprocess.run(
                        ["ffprobe", "-v", "quiet", "-show_entries", "format=duration",
                         "-of", "csv=p=0", str(mp3)],
                        capture_output=True, text=True, timeout=5
                    )
                    ch["duration"] = float(r.stdout.strip() or 0)
                else:
                    ch["duration"] = 0.0
                updated = True
        if updated:
            manifest_path.write_text(json.dumps(chapters))
        total = int(sum(ch.get("duration", 0) for ch in chapters))
        return total, chapters
    except Exception:
        return 0, []

async def convert_chapter(book_id: str, idx: int, ch: dict, voice: str, book_audio_dir: Path) -> float:
    out_file = book_audio_dir / f"chapter_{idx:03d}.mp3"
    if out_file.exists():
        return 0.0
    start = time.time()
    async with httpx.AsyncClient(timeout=300) as client:
        resp = await client.post(f"{KOKORO_URL}/v1/audio/speech", json={
            "model": "kokoro", "input": ch["text"],
            "voice": voice, "response_format": "mp3"
        })
        resp.raise_for_status()
        out_file.write_bytes(resp.content)
    return time.time() - start

async def convert_book_to_audio(book_id: str):
    db = db_session()
    book = db.query(Book).filter(Book.id == book_id).first()
    if not book:
        return

    book.status = "converting"
    book.progress_pct = 0
    book.eta_seconds = None
    db.commit()

    meta = json.loads(book.metadata_json)
    chapters = meta["chapters"]
    voice = book.selected_voice
    book_audio_dir = AUDIO_DIR / book_id
    book_audio_dir.mkdir(parents=True, exist_ok=True)

    total = len(chapters)
    completed = 0
    chapter_times = []

    for batch_start in range(0, total, PARALLEL_CHAPTERS):
        batch = list(enumerate(chapters))[batch_start:batch_start + PARALLEL_CHAPTERS]
        try:
            tasks = [convert_chapter(book_id, idx, ch, voice, book_audio_dir) for idx, ch in batch]
            times = await asyncio.gather(*tasks)
            for t in times:
                if t > 0:
                    chapter_times.append(t)
        except Exception as e:
            book.status = "error"
            book.error_msg = str(e)
            db.commit()
            return

        completed += len(batch)
        avg_time = (sum(chapter_times) / len(chapter_times)) if chapter_times else 0
        remaining_batches = (total - completed) / PARALLEL_CHAPTERS
        book.progress_pct = int((completed / total) * 100)
        book.eta_seconds  = int(avg_time * remaining_batches)
        db.commit()

    manifest = [
        {"index": i, "title": ch["title"], "file": f"/audio/{book_id}/chapter_{i:03d}.mp3"}
        for i, ch in enumerate(chapters)
    ]
    (book_audio_dir / "manifest.json").write_text(json.dumps(manifest))

    book.status = "ready"
    book.progress_pct = 100
    db.commit()

# ── Routes ───────────────────────────────────────────────────────────────────
@app.get("/api/about")
def get_about(_: str = Depends(require_auth)):
    import sqlite3, importlib.metadata
    uptime_s = int(time.time() - APP_START_TIME)
    h, rem   = divmod(uptime_s, 3600)
    m, s     = divmod(rem, 60)
    return {
        "app_name":    "Lector",
        "version":     APP_VERSION,
        "python":      sys.version.split()[0],
        "fastapi":     importlib.metadata.version("fastapi"),
        "sqlite":      sqlite3.sqlite_version,
        "docker":      os.path.exists("/.dockerenv"),
        "appdata":     "/data",
        "uptime":      f"{h:02d}:{m:02d}:{s:02d}",
        "tts_engine":  "Kokoro TTS",
        "ai_provider": "Anthropic Claude",
    }

@app.get("/api/library")
def get_library(user: str = Depends(require_auth)):
    db = db_session()
    progress_map = {p.book_id: p for p in db.query(Progress).all()}
    books = []
    needs_commit = False
    for b in db.query(Book).order_by(Book.created_at.desc()).all():
        d = b.to_dict()
        meta = json.loads(b.metadata_json)
        if meta.get("summary"):
            d["summary"] = meta["summary"]
        if b.status == "ready":
            total_dur, chapters = _ensure_chapter_durations(b.id)
            if total_dur > 0:
                d["total_duration_seconds"] = total_dur
                if not meta.get("total_duration_seconds"):
                    meta["total_duration_seconds"] = total_dur
                    b.metadata_json = json.dumps(meta)
                    needs_commit = True
            prog = progress_map.get(b.id)
            if prog:
                d["has_progress"] = True
                d["completed"]    = bool(prog.completed)
                if chapters and prog.chapter_index < len(chapters):
                    remaining = 0.0
                    for ch in chapters:
                        if ch["index"] < prog.chapter_index:
                            pass
                        elif ch["index"] == prog.chapter_index:
                            remaining += max(0, ch.get("duration", 0) - prog.position_seconds)
                        else:
                            remaining += ch.get("duration", 0)
                    d["time_remaining_seconds"] = max(0, int(remaining))
        books.append(d)
    if needs_commit:
        db.commit()
    return books

@app.post("/api/upload")
async def upload_epub(file: UploadFile = File(...), user: str = Depends(require_auth)):
    data = await file.read()
    validate_epub(data)

    book_id   = str(uuid.uuid4())
    epub_path = BOOKS_DIR / f"{book_id}.epub"
    epub_path.write_bytes(data)

    try:
        meta = parse_epub(str(epub_path))
    except Exception as e:
        epub_path.unlink(missing_ok=True)
        raise HTTPException(400, f"Failed to parse epub: {e}")

    cover_url = None
    if meta.get("cover"):
        cover_dir = AUDIO_DIR / book_id
        cover_dir.mkdir(parents=True, exist_ok=True)
        header, encoded = meta["cover"].split(",", 1)
        ext = "jpg" if "jpeg" in header else "png"
        cover_path = cover_dir / f"cover.{ext}"
        cover_path.write_bytes(b64mod.b64decode(encoded))
        cover_url = f"/audio/{book_id}/cover.{ext}"
        meta = {**meta, "cover": None}

    db = db_session()
    book = Book(
        id=book_id, title=meta["title"], author=meta.get("author", "Unknown"),
        cover_url=cover_url, status="analyzing",
        metadata_json=json.dumps(meta), created_at=int(time.time())
    )
    db.add(book)
    db.commit()

    try:
        result = await ask_claude_for_voice(meta["title"], meta.get("description", meta["title"]))
        voice, reason = result["voice"], result["reason"]
    except Exception:
        voice, reason = "af_bella", "Default warm narrator voice."

    sample_dir = AUDIO_DIR / book_id
    sample_dir.mkdir(parents=True, exist_ok=True)
    sample_text = meta["chapters"][0]["text"][:300] if meta["chapters"] else "Hello, this is a narrator voice sample."
    await generate_voice_sample(voice, sample_text, sample_dir / "sample.mp3")

    book.status = "preview"
    book.selected_voice = voice
    book.voice_reason   = reason
    db.commit()

    return {
        "book_id": book_id, "title": meta["title"], "cover_url": cover_url,
        "voice": voice, "reason": reason,
        "sample_url": f"/audio/{book_id}/sample.mp3",
        "chapter_count": len(meta["chapters"])
    }

@app.post("/api/regen-voice")
async def regen_voice(req: VoiceRegenRequest, user: str = Depends(require_auth)):
    db = db_session()
    book = get_book_or_404(req.book_id, db)
    meta = json.loads(book.metadata_json)

    result = await ask_claude_for_voice(book.title, meta.get("description", book.title), exclude=req.exclude_voice)
    voice, reason = result["voice"], result["reason"]

    await generate_voice_sample(voice, meta["chapters"][0]["text"][:300] if meta["chapters"] else book.title,
                                AUDIO_DIR / req.book_id / "sample.mp3")
    book.selected_voice = voice
    book.voice_reason   = reason
    db.commit()
    return {"voice": voice, "reason": reason, "sample_url": f"/audio/{req.book_id}/sample.mp3?t={int(time.time())}"}

@app.post("/api/submit")
async def submit_conversion(req: SubmitRequest, bg: BackgroundTasks, user: str = Depends(require_auth)):
    db = db_session()
    book = get_book_or_404(req.book_id, db)
    book.selected_voice = req.voice
    book.status = "queued"
    db.commit()
    bg.add_task(convert_book_to_audio, req.book_id)
    return {"status": "queued"}

@app.get("/api/book/{book_id}")
def get_book(book_id: str, user: str = Depends(require_auth)):
    db = db_session()
    book = get_book_or_404(book_id, db)
    data = book.to_dict()
    manifest_path = AUDIO_DIR / book_id / "manifest.json"
    if manifest_path.exists():
        data["chapters"] = json.loads(manifest_path.read_text())
    prog = db.query(Progress).filter(Progress.book_id == book_id).first()
    if prog:
        data["last_chapter"]  = prog.chapter_index
        data["last_position"] = prog.position_seconds
    return data

@app.post("/api/progress")
def save_progress(update: ProgressUpdate, user: str = Depends(require_auth)):
    db = db_session()
    prog = db.query(Progress).filter(Progress.book_id == update.book_id).first()
    if prog:
        prog.chapter_index    = update.chapter_index
        prog.position_seconds = update.position_seconds
        prog.completed        = update.completed
    else:
        prog = Progress(book_id=update.book_id, chapter_index=update.chapter_index,
                        position_seconds=update.position_seconds, completed=update.completed)
        db.add(prog)
    db.commit()
    return {"saved": True}

@app.delete("/api/book/{book_id}")
def delete_book(book_id: str, user: str = Depends(require_auth)):
    import shutil
    db = db_session()
    book = get_book_or_404(book_id, db)
    db.delete(book)
    shutil.rmtree(AUDIO_DIR / book_id, ignore_errors=True)
    (BOOKS_DIR / f"{book_id}.epub").unlink(missing_ok=True)
    db.commit()
    SUMMARY_CACHE.pop(book_id, None)
    return {"deleted": True}

@app.get("/api/book/{book_id}/summary")
async def get_summary(book_id: str, user: str = Depends(require_auth)):
    if book_id in SUMMARY_CACHE:
        return {"summary": SUMMARY_CACHE[book_id]}
    db = db_session()
    book = get_book_or_404(book_id, db)
    meta = json.loads(book.metadata_json)
    if meta.get("summary"):
        SUMMARY_CACHE[book_id] = meta["summary"]
        return {"summary": meta["summary"]}
    description = meta.get("description", "")
    chapter_titles = [ch["title"] for ch in meta.get("chapters", [])[:12]]
    client = anthropic.Anthropic(api_key=ANTHROPIC_KEY)
    msg = client.messages.create(
        model="claude-haiku-4-5-20251001", max_tokens=220,
        messages=[{"role": "user", "content": f"""Write a 2-3 sentence summary of this book for someone deciding whether to listen to it. Be engaging and specific. Reply with just the summary, no preamble.

Title: {book.title}
Author: {book.author}
Description: {description[:1200] if description else "Not provided"}
Chapter titles: {", ".join(chapter_titles)}"""}]
    )
    summary = msg.content[0].text.strip()
    meta["summary"] = summary
    book.metadata_json = json.dumps(meta)
    db.commit()
    SUMMARY_CACHE[book_id] = summary
    return {"summary": summary}