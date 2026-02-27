import time
from sqlalchemy import create_engine, Column, String, Integer, Float, Text, Boolean
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker

DB_PATH = "sqlite:////data/db/library.db"
engine = create_engine(
    DB_PATH,
    connect_args={"check_same_thread": False},
    pool_size=20,
    max_overflow=40,
    pool_timeout=60,
    pool_recycle=300
)
SessionLocal = sessionmaker(bind=engine)
Base = declarative_base()

class Book(Base):
    __tablename__ = "books"
    id             = Column(String, primary_key=True)
    title          = Column(String)
    author         = Column(String)
    cover_url      = Column(String, nullable=True)
    status         = Column(String, default="analyzing")  # analyzing|preview|queued|converting|ready|error
    progress_pct   = Column(Integer, default=0)
    selected_voice = Column(String, nullable=True)
    voice_reason   = Column(String, nullable=True)
    metadata_json  = Column(Text)
    error_msg      = Column(String, nullable=True)
    eta_seconds    = Column(Integer, nullable=True)
    created_at     = Column(Integer, default=lambda: int(time.time()))

    def to_dict(self):
        return {
            "id": self.id, "title": self.title, "author": self.author,
            "cover_url": self.cover_url, "status": self.status,
            "progress_pct": self.progress_pct, "selected_voice": self.selected_voice,
            "voice_reason": self.voice_reason, "error_msg": self.error_msg,
            "eta_seconds": self.eta_seconds, "created_at": self.created_at
        }

class Progress(Base):
    __tablename__ = "progress"
    book_id          = Column(String, primary_key=True)
    chapter_index    = Column(Integer, default=0)
    position_seconds = Column(Float, default=0.0)
    completed        = Column(Boolean, default=False)

def init_db():
    Base.metadata.create_all(engine)

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()