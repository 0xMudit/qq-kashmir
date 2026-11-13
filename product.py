"""Private fleet registry, revocable device tokens and ordered telemetry."""

import secrets
import time
import uuid
from typing import Literal
from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import text
from accounts import digest

SCHEMA = """
CREATE TABLE IF NOT EXISTS beta_vehicles (id TEXT PRIMARY KEY, owner TEXT NOT NULL REFERENCES beta_users(id), label TEXT NOT NULL, plate TEXT NOT NULL, vehicle_type TEXT NOT NULL DEFAULT 'car' CHECK(vehicle_type IN ('car','truck','bus')), device_digest TEXT UNIQUE, state TEXT NOT NULL, seq BIGINT NOT NULL DEFAULT -1, lat DOUBLE PRECISION, lon DOUBLE PRECISION, speed DOUBLE PRECISION, seen DOUBLE PRECISION, created DOUBLE PRECISION NOT NULL);
CREATE INDEX IF NOT EXISTS beta_vehicles_owner ON beta_vehicles(owner,state);
CREATE TABLE IF NOT EXISTS beta_history (id TEXT PRIMARY KEY, vehicle TEXT NOT NULL REFERENCES beta_vehicles(id), seq BIGINT NOT NULL, lat DOUBLE PRECISION NOT NULL, lon DOUBLE PRECISION NOT NULL, speed DOUBLE PRECISION NOT NULL, received DOUBLE PRECISION NOT NULL, UNIQUE(vehicle,seq));
CREATE INDEX IF NOT EXISTS beta_history_vehicle ON beta_history(vehicle,received)
"""


class VehicleType(BaseModel):
    vehicle_type: Literal["car", "truck", "bus"] = "car"


class Vehicle(VehicleType):
    label: str = Field(min_length=1, max_length=80)
    plate: str = Field(default="", max_length=24)


class Location(BaseModel):
    seq: int = Field(ge=0, le=9223372036854775807)
    lat: float = Field(ge=-90, le=90, allow_inf_nan=False)
    lon: float = Field(ge=-180, le=180, allow_inf_nan=False)
    speed: float = Field(default=0, ge=0, le=400, allow_inf_nan=False)


class Product:
    def __init__(self, engine, accounts):
        self.engine = engine
        self.accounts = accounts
        self.router = APIRouter(prefix="/api", tags=["Fleet"])
        self._routes()

    def initialize(self):
        with self.engine.begin() as db:
            for statement in SCHEMA.split(";"):
                if statement.strip():
                    db.execute(text(statement))
            if self.engine.dialect.name == "sqlite":
                columns = db.execute(
                    text("PRAGMA table_info(beta_vehicles)")
                ).mappings()
                if not any(column["name"] == "vehicle_type" for column in columns):
                    db.execute(
                        text(
                            "ALTER TABLE beta_vehicles ADD COLUMN vehicle_type TEXT NOT NULL DEFAULT 'car' CHECK(vehicle_type IN ('car','truck','bus'))"
                        )
                    )

    def ingest(self, identifier, body):
        now = time.time()
        with self.engine.begin() as db:
            row = db.execute(
                text(
                    "UPDATE beta_vehicles SET seq=:seq,lat=:lat,lon=:lon,speed=:speed,seen=:now WHERE id=:id AND state='active' AND seq<:seq RETURNING id"
                ),
                {"id": identifier, "now": now, **body.model_dump()},
            ).first()
            if row:
                db.execute(
                    text(
                        "INSERT INTO beta_history VALUES(:id,:vehicle,:seq,:lat,:lon,:speed,:now)"
                    ),
                    {
                        "id": str(uuid.uuid4()),
                        "vehicle": identifier,
                        "now": now,
                        **body.model_dump(),
                    },
                )
                db.execute(
                    text(
                        "DELETE FROM beta_history WHERE vehicle=:vehicle AND id NOT IN (SELECT id FROM beta_history WHERE vehicle=:vehicle ORDER BY received DESC LIMIT 1000)"
                    ),
                    {"vehicle": identifier},
                )
            return {"accepted": row is not None, "received": now}

    def own(self, identifier, owner):
        with self.engine.connect() as db:
            row = db.execute(
                text(
                    "SELECT id FROM beta_vehicles WHERE id=:id AND owner=:owner AND state='active'"
                ),
                {"id": identifier, "owner": owner},
            ).first()
        if not row:
            raise HTTPException(404, "Vehicle not found")

    def _routes(self):
        router = self.router
        current = self.accounts.user

        @router.get("/vehicles")
        def vehicles(user=Depends(current)):
            with self.engine.connect() as db:
                rows = [
                    dict(r)
                    for r in db.execute(
                        text(
                            "SELECT id,label,plate,vehicle_type,seq,lat,lon,speed,seen,created FROM beta_vehicles WHERE owner=:owner AND state='active' ORDER BY created DESC LIMIT 50"
                        ),
                        {"owner": user["id"]},
                    ).mappings()
                ]
            return [
                {**r, "online": r["seen"] is not None and time.time() - r["seen"] < 90}
                for r in rows
            ]

        @router.post("/vehicles", status_code=201)
        def create(body: Vehicle, user=Depends(current)):
            identifier = str(uuid.uuid4())
            token = secrets.token_urlsafe(32)
            with self.engine.begin() as db:
                suffix = (
                    " FOR UPDATE" if self.engine.dialect.name == "postgresql" else ""
                )
                db.execute(
                    text("SELECT id FROM beta_users WHERE id=:owner" + suffix),
                    {"owner": user["id"]},
                )
                if (
                    db.execute(
                        text(
                            "SELECT count(*) FROM beta_vehicles WHERE owner=:owner AND state='active'"
                        ),
                        {"owner": user["id"]},
                    ).scalar_one()
                    >= 50
                ):
                    raise HTTPException(409, "Beta workspace limit: 50 active vehicles")
                db.execute(
                    text(
                        "INSERT INTO beta_vehicles(id,owner,label,plate,vehicle_type,device_digest,state,created) VALUES(:id,:owner,:label,:plate,:vehicle_type,:digest,'active',:created)"
                    ),
                    {
                        "id": identifier,
                        "owner": user["id"],
                        "label": body.label,
                        "plate": body.plate,
                        "vehicle_type": body.vehicle_type,
                        "digest": digest(token),
                        "created": time.time(),
                    },
                )
            return {
                "id": identifier,
                "device_token": token,
                "notice": "Copy this device token now. It can only submit telemetry for this vehicle.",
            }

        @router.patch("/vehicles/{identifier}/type")
        def update_vehicle_type(
            identifier: str, body: VehicleType, user=Depends(current)
        ):
            with self.engine.begin() as db:
                updated = db.execute(
                    text(
                        "UPDATE beta_vehicles SET vehicle_type=:type WHERE id=:id AND owner=:owner AND state='active' RETURNING vehicle_type"
                    ),
                    {"type": body.vehicle_type, "id": identifier, "owner": user["id"]},
                ).scalar_one_or_none()
            if updated is None:
                raise HTTPException(404, "Vehicle not found")
            return {"vehicle_type": updated}

        @router.post("/vehicles/{identifier}/token")
        def rotate(identifier: str, user=Depends(current)):
            self.own(identifier, user["id"])
            token = secrets.token_urlsafe(32)
            with self.engine.begin() as db:
                db.execute(
                    text(
                        "UPDATE beta_vehicles SET device_digest=:digest WHERE id=:id AND owner=:owner"
                    ),
                    {"digest": digest(token), "id": identifier, "owner": user["id"]},
                )
            return {"device_token": token}

        @router.post("/vehicles/{identifier}/archive")
        def archive(identifier: str, user=Depends(current)):
            self.own(identifier, user["id"])
            with self.engine.begin() as db:
                db.execute(
                    text(
                        "UPDATE beta_vehicles SET state='archived',device_digest=NULL WHERE id=:id AND owner=:owner"
                    ),
                    {"id": identifier, "owner": user["id"]},
                )
            return {"ok": True}

        @router.get("/vehicles/{identifier}/history")
        def history(identifier: str, user=Depends(current)):
            self.own(identifier, user["id"])
            with self.engine.connect() as db:
                return [
                    dict(r)
                    for r in db.execute(
                        text(
                            "SELECT seq,lat,lon,speed,received FROM beta_history WHERE vehicle=:id ORDER BY received DESC LIMIT 200"
                        ),
                        {"id": identifier},
                    ).mappings()
                ][::-1]

        @router.post("/vehicles/{identifier}/location")
        def location(identifier: str, body: Location, user=Depends(current)):
            self.own(identifier, user["id"])
            return self.ingest(identifier, body)

        @router.post("/telemetry")
        def telemetry(body: Location, x_device_token: str = Header(default="")):
            self.accounts.limit("device:" + digest(x_device_token), 120)
            with self.engine.connect() as db:
                vehicle = db.execute(
                    text(
                        "SELECT id FROM beta_vehicles WHERE device_digest=:digest AND state='active'"
                    ),
                    {"digest": digest(x_device_token)},
                ).scalar_one_or_none()
            if not vehicle:
                raise HTTPException(401, "Invalid device token")
            return self.ingest(vehicle, body)
