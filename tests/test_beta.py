import os

os.environ["API_KEY"] = "test-secret-123456"
os.environ["DATABASE_URL"] = "sqlite:///:memory:"
import time
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text
import app

ORIGIN = {"origin": "http://testserver"}


@pytest.fixture
def client():
    with TestClient(app.app, headers=ORIGIN) as c:
        # Isolate beta data without relying on test order.
        with app.engine.begin() as db:
            for table in TABLES:
                db.execute(text("DELETE FROM " + table))
        yield c


def signup(client, name="alice"):
    body = {"username": name, "password": "ValidPassword!2026"}
    assert client.post("/api/auth/register", json=body).status_code == 201
    assert client.post("/api/auth/login", json=body).status_code == 200
    return client.get("/api/auth/me").json()


def other_user(client):
    client.post("/api/auth/logout")
    signup(client, "bob")


def test_account_sessions_and_origin(client):
    assert client.get("/api/auth/me").status_code == 401
    signup(client)
    assert client.get("/api/auth/me").json()["username"] == "alice"
    assert (
        client.post(
            "/api/auth/keys",
            json={"label": "test"},
            headers={"origin": "https://evil.example"},
        ).status_code
        == 403
    )
    key = client.post("/api/auth/keys", json={"label": "integration"}).json()["token"]
    assert client.post("/api/auth/logout").status_code == 200
    assert client.get("/api/auth/me").status_code == 401
    assert (
        client.get(
            "/api/auth/me", headers={"authorization": "Bearer " + key}
        ).status_code
        == 200
    )
    keys = client.get(
        "/api/auth/keys", headers={"authorization": "Bearer " + key}
    ).json()
    assert (
        client.delete(
            "/api/auth/keys/" + keys[0]["digest"],
            headers={"authorization": "Bearer " + key},
        ).status_code
        == 200
    )
    assert (
        client.get(
            "/api/auth/me", headers={"authorization": "Bearer " + key}
        ).status_code
        == 401
    )


def test_password_and_duplicate_account(client):
    signup(client)
    assert (
        client.post(
            "/api/auth/register",
            json={"username": "alice", "password": "ValidPassword!2026"},
        ).status_code
        == 409
    )
    assert (
        client.post(
            "/api/auth/login",
            json={"username": "alice", "password": "WrongPassword!2026"},
        ).status_code
        == 401
    )


TABLES = ["beta_history", "beta_vehicles", "beta_sessions", "beta_users", "beta_limits"]


def test_device_ingestion_and_isolation(client):
    signup(client)
    created = client.post("/api/vehicles", json={"label": "Bike 1", "plate": "TEST"})
    assert created.status_code == 201
    vehicle = created.json()
    headers = {"x-device-token": vehicle["device_token"]}
    location = {"seq": 2, "lat": 34.08, "lon": 74.79, "speed": 20}
    assert client.post("/api/telemetry", json=location, headers=headers).json()[
        "accepted"
    ]
    assert not client.post(
        "/api/telemetry", json={**location, "seq": 1, "lat": 0}, headers=headers
    ).json()["accepted"]
    assert len(client.get("/api/vehicles/" + vehicle["id"] + "/history").json()) == 1
    assert (
        client.post(
            "/api/telemetry", json={**location, "lat": 91}, headers=headers
        ).status_code
        == 422
    )
    rotated = client.post("/api/vehicles/" + vehicle["id"] + "/token").json()
    assert (
        client.post("/api/telemetry", json=location, headers=headers).status_code == 401
    )
    assert (
        client.post(
            "/api/telemetry",
            json={**location, "seq": 3},
            headers={"x-device-token": rotated["device_token"]},
        ).status_code
        == 200
    )
    other_user(client)
    assert client.get("/api/vehicles").json() == []
    assert client.get("/api/vehicles/" + vehicle["id"] + "/history").status_code == 404
    assert (
        client.post(
            "/api/vehicles/" + vehicle["id"] + "/location", json=location
        ).status_code
        == 404
    )


def test_archived_device_rejected(client):
    signup(client)
    v = client.post("/api/vehicles", json={"label": "Archive test"}).json()
    assert client.post("/api/vehicles/" + v["id"] + "/archive").status_code == 200
    assert (
        client.post(
            "/api/telemetry",
            headers={"x-device-token": v["device_token"]},
            json={"seq": 1, "lat": 0, "lon": 0},
        ).status_code
        == 401
    )
    assert client.get("/api/vehicles").json() == []
