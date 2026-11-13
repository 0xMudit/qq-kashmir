import asyncio
from fastapi.responses import FileResponse
from pathlib import Path
from pydantic import BaseModel, Field
TITLE = "QQ Kashmir"
SCHEMA = """CREATE TABLE IF NOT EXISTS positions (vehicle TEXT PRIMARY KEY, seq BIGINT NOT NULL, lat DOUBLE PRECISION NOT NULL, lon DOUBLE PRECISION NOT NULL)"""
import os, secrets
from contextlib import asynccontextmanager
from fastapi import FastAPI, Depends, Header, HTTPException
from sqlalchemy import create_engine, text
from sqlalchemy.pool import StaticPool
engine = create_engine(os.getenv("DATABASE_URL", "sqlite:///data.db"), **({"connect_args":{"check_same_thread":False}, "poolclass":StaticPool} if os.getenv("DATABASE_URL", "").endswith(":memory:") else {}))
def auth(x_api_key: str = Header(default="")):
    if not secrets.compare_digest(x_api_key, os.environ["API_KEY"]):
        raise HTTPException(401, "Invalid API key")
@asynccontextmanager
async def lifespan(app):
    if len(os.getenv("API_KEY", "")) < 16:
        raise RuntimeError("Set API_KEY to at least 16 characters")
    with engine.begin() as c:
        for statement in SCHEMA.split(";"):
            if statement.strip(): c.execute(text(statement))
    yield
app = FastAPI(title=TITLE, version="0.1.0-beta.1", lifespan=lifespan)
@app.get("/health")
def health():
    with engine.connect() as c: c.execute(text("SELECT 1"))
    return {"status":"ok"}

class Position(BaseModel):
    vehicle: str = Field(pattern="^[a-zA-Z0-9_-]{1,64}$")
    seq: int = Field(ge=0)
    lat: float = Field(ge=-90,le=90,allow_inf_nan=False)
    lon: float = Field(ge=-180,le=180,allow_inf_nan=False)
@app.post("/positions", dependencies=[Depends(auth)])
def ingest(body: Position):
    with engine.begin() as c:
        row=c.execute(text("INSERT INTO positions VALUES(:vehicle,:seq,:lat,:lon) ON CONFLICT(vehicle) DO UPDATE SET seq=excluded.seq,lat=excluded.lat,lon=excluded.lon WHERE excluded.seq>positions.seq RETURNING *"),body.model_dump()).mappings().first()
        return {"accepted":row is not None}
@app.get("/positions", dependencies=[Depends(auth)])
def positions():
    with engine.connect() as c: return [dict(r) for r in c.execute(text("SELECT * FROM positions ORDER BY vehicle LIMIT 1000")).mappings()]
@app.get("/")
def dashboard(): return FileResponse(Path(__file__).with_name("map.html"))
