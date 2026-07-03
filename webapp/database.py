import os
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./moneytracer.db")

connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}
engine = create_engine(
    DATABASE_URL,
    connect_args=connect_args,
    pool_pre_ping=True,   # check the connection is alive before using it, so a
                           # stale connection after Railway/DB wakes from sleep
                           # gets silently replaced instead of hanging/erroring
    pool_recycle=280,     # recycle connections before typical managed-Postgres
                           # idle-connection timeouts (usually 5 min) kick in
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
