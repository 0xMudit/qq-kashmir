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

database_url = os.getenv("DATABASE_URL", "sqlite:///data.db")
engine_options = {"pool_pre_ping": True}
if database_url.endswith(":memory:"):
    engine_options.update(
        connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
elif database_url.startswith("postgresql"):
    from sqlalchemy.pool import NullPool

    engine_options.update(poolclass=NullPool, connect_args={"prepare_threshold": None})
engine = create_engine(database_url, **engine_options)
if database_url.startswith("postgresql"):
    from sqlalchemy import event

    @event.listens_for(engine, "connect")
    def set_schema(connection, record):
        with connection.cursor() as cursor:
            cursor.execute("SET search_path TO qq_kashmir")
        connection.commit()


def auth(x_api_key: str = Header(default="")):
    if not secrets.compare_digest(x_api_key.encode(), os.environ["API_KEY"].encode()):
        raise HTTPException(401, "Invalid API key")


@asynccontextmanager
async def lifespan(app):
    if len(os.getenv("API_KEY", "")) < 16:
        raise RuntimeError("Set API_KEY to at least 16 characters")
    with engine.begin() as c:
        if engine.dialect.name == "postgresql":
            c.execute(text("CREATE SCHEMA IF NOT EXISTS qq_kashmir"))
        for statement in SCHEMA.split(";"):
            if statement.strip():
                c.execute(text(statement))
    yield


app = FastAPI(title=TITLE, version="0.1.0-beta.1", lifespan=lifespan)


@app.get("/health")
def health():
    with engine.connect() as c:
        c.execute(text("SELECT 1"))
    return {"status": "ok"}


class Position(BaseModel):
    vehicle: str = Field(pattern="^[a-zA-Z0-9_-]{1,64}$")
    seq: int = Field(ge=0)
    lat: float = Field(ge=-90, le=90, allow_inf_nan=False)
    lon: float = Field(ge=-180, le=180, allow_inf_nan=False)


@app.post("/positions", dependencies=[Depends(auth)])
def ingest(body: Position):
    """Keep only positions newer than the stored sequence."""
    with engine.begin() as c:
        row = (
            c.execute(
                text(
                    "INSERT INTO positions VALUES(:vehicle,:seq,:lat,:lon) ON CONFLICT(vehicle) DO UPDATE SET seq=excluded.seq,lat=excluded.lat,lon=excluded.lon WHERE excluded.seq>positions.seq RETURNING *"
                ),
                body.model_dump(),
            )
            .mappings()
            .first()
        )
        return {"accepted": row is not None}


@app.get("/positions", dependencies=[Depends(auth)])
def positions():
    with engine.connect() as c:
        return [
            dict(r)
            for r in c.execute(
                text("SELECT * FROM positions ORDER BY vehicle LIMIT 1000")
            ).mappings()
        ]


@app.get("/")
def dashboard():
    return FileResponse(Path(__file__).with_name("demo.html"))


# Shared database rate limiting bounds the public, fixed-input demonstration.
SCHEMA += "; CREATE TABLE IF NOT EXISTS demo_limits (bucket BIGINT PRIMARY KEY, count INTEGER NOT NULL)"


def demo_budget():
    """Atomically limit public demo mutations across all API instances."""
    import time

    bucket = int(time.time() // 60)
    with engine.begin() as c:
        c.execute(
            text("DELETE FROM demo_limits WHERE bucket < :old"), {"old": bucket - 2}
        )
        row = c.execute(
            text(
                "INSERT INTO demo_limits VALUES(:bucket,1) ON CONFLICT(bucket) DO UPDATE SET count=demo_limits.count+1 WHERE demo_limits.count<30 RETURNING count"
            ),
            {"bucket": bucket},
        ).first()
        if not row:
            raise HTTPException(429, "Demo is busy. Try again in a minute.")


@app.post("/demo/run")
def demo_run():
    """Execute a fixed synthetic scenario and return persisted evidence."""
    demo_budget()
    import time, math

    seq = time.time_ns() // 1000000
    for i in range(5):
        ingest(
            Position(
                vehicle=f"demo-bike-{i+1}",
                seq=seq,
                lat=34.0837 + 0.013 * math.sin(seq / 15000 + i),
                lon=74.7973 + 0.018 * math.cos(seq / 15000 + i),
            )
        )
    stale = ingest(Position(vehicle="demo-bike-1", seq=1, lat=0, lon=0))
    return {
        "title": "Fleet positions updated",
        "checks": [
            "Five synthetic vehicles persisted",
            "Older location update rejected" if not stale["accepted"] else "FAILED",
            "Coordinates validated before ingestion",
        ],
        "record": {"vehicles": positions(), "stale_update_accepted": stale["accepted"]},
    }


@app.get("/demo/fleet")
def demo_fleet():
    return [p for p in positions() if p["vehicle"].startswith("demo-bike-")]


from fastapi.staticfiles import StaticFiles

app.mount(
    "/assets", StaticFiles(directory=Path(__file__).with_name("assets")), name="assets"
)
