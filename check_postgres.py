"""Opt-in PostgreSQL concurrency check. Uses DATABASE_URL and synthetic records."""

import os, uuid
from concurrent.futures import ThreadPoolExecutor

assert os.environ.get("DATABASE_URL", "").startswith(
    "postgresql"
), "Requires PostgreSQL"
import app

vehicle = "test-" + uuid.uuid4().hex
with ThreadPoolExecutor(max_workers=8) as pool:
    list(
        pool.map(
            lambda seq: app.ingest(
                app.Position(vehicle=vehicle, seq=seq, lat=34, lon=74)
            ),
            [8, 2, 7, 1, 6, 3, 5, 4],
        )
    )
with app.engine.connect() as db:
    seq = db.execute(
        app.text("SELECT seq FROM positions WHERE vehicle=:vehicle"),
        {"vehicle": vehicle},
    ).scalar_one()
assert seq == 8
print("PASS: out-of-order concurrent writes retained the highest sequence")
