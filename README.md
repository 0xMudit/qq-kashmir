# QQ Kashmir

A private fleet workspace with vehicle registration, revocable GPS device tokens, latest-position tracking, and recent route history.

[Open the beta](https://qq-kashmir.vercel.app) · [API reference](https://qq-kashmir.vercel.app/docs) · [Engineering lab](https://qq-kashmir.vercel.app/lab) · [Issues](https://github.com/0xMudit/qq-kashmir/issues)

**v0.2.0-beta.1** · FastAPI · PostgreSQL / Supabase · Vercel · MIT

## Use the application

1. Create an account or open the shared synthetic demo fleet.
2. Register a vehicle and copy its one-time device token.
3. Send GPS telemetry from a device, use the manual location form, or explicitly run a sample route.
4. Select vehicles on the map, inspect their recent route, rotate device credentials, or archive a vehicle.

### Demo credentials

Username: `demo-kashmir`
Password: `KashmirBeta!2026`

The demo is a shared public account. Its data and API keys are visible to others who sign in with those credentials. Create your own account for isolated data. The application is a functional beta, not a production-certified service.

## Run locally

```sh
python -m venv .venv
# Activate .venv using your shell's command.
npm ci --prefix frontend
npm run build --prefix frontend
pip install -r requirements.txt
# Set API_KEY to a random secret of at least 16 characters.
uvicorn app:app --reload
```

Open http://localhost:8000. SQLite is supported for local exploration and unit tests. Set DATABASE_URL to a PostgreSQL psycopg connection URL with TLS for deployment. On a fresh local database, startup initializes the schema and shared demo account. Hosted schema changes are provided in `supabase/migrations/`.

For Docker, copy `.env.example` to `.env`, replace its secret and run `docker compose up --build`. Change host port mappings when running multiple apps. Scheduled recovery for Pocket requires its hosted scheduler or a running beta worker; plain local API startup alone does not supply a persistent scheduler.

## API integration

Create a key in the account UI and send it as `Authorization: Bearer TOKEN`. Keys expire after 30 days and can be revoked. Browser sessions use HttpOnly cookies and expire after seven days. API payloads and validation rules are documented at `/docs`.

```text
POST /api/vehicles                   Register a vehicle
GET  /api/vehicles                   Private fleet list
POST /api/vehicles/{id}/location     Manual account-owned GPS update
POST /api/vehicles/{id}/token        Rotate a device credential
POST /api/vehicles/{id}/archive      Revoke and archive
GET  /api/vehicles/{id}/history      Recent route history
POST /api/telemetry                  Ingest with X-Device-Token
```

## Correctness and system design

### Tracking guarantees

Each vehicle belongs to an account. Device tokens are randomly generated, stored only as SHA-256 digests, and can write telemetry for exactly one active vehicle. They cannot read fleet data. Rotating the token revokes the old credential; archiving disables device ingestion and hides the vehicle. Archive preserves database records; UI restoration is not implemented yet.

A conditional update accepts only a higher sequence number. Latest-position state and accepted route history commit in the same transaction. A stale update creates no history row. Device sequence numbers must increase across restarts; epoch milliseconds are a practical default. The server timestamps receipt; the online indicator means a point was received in the last 90 seconds, not that the vehicle has been independently verified online.

The map polls every five seconds. Each workspace supports 50 active vehicles, each retains its latest 1,000 accepted points, and the route view returns the latest 200. This is recent operational history, not archival route storage. Real geolocation requires an explicit browser action; shared demo accounts must contain only synthetic data. The map uses OpenFreeMap vector tiles rendered through MapLibre and Leaflet. If the basemap is unavailable, the grid still shows vehicle positions and routes.

## Verification

```sh
python -m pytest -q
```

Tests cover ownership boundaries, session and API-key revocation, validation, and domain failure modes. `check_postgres.py` is an opt-in concurrency check for the original engineering-lab primitives; it writes synthetic data and is not a load benchmark. See [architecture](docs/architecture.md), [deployment](docs/deployment.md), and [security](SECURITY.md).

## Beta boundaries

No uptime SLA or measured throughput claim. Account usernames are not email addresses. Email verification, password recovery, MFA and self-service account deletion are not implemented. Store recoverable credentials and avoid sensitive data while evaluating the beta. Quotas and rate limits bound usage; they are not a comprehensive anti-abuse system.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Include failure-mode tests and explain concurrency assumptions in pull requests. Do not commit secrets or real location data. Licensed under MIT.

The workspace uses React, Vite, Tailwind CSS, and official [shadcn/ui](https://ui.shadcn.com/) registry components in `frontend/src/components/ui`. Build the frontend before starting FastAPI or uploading a Vercel deployment.
