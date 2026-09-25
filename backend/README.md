# Backend deployment and development

The API reads telemetry directly from PostgreSQL. This repository's Compose
file runs only the backend on the development PC, using the existing database
configured in `backend/.env`. No local deployment repository is required.

## Develop on this PC

Requires Docker with Compose and access to the existing PostgreSQL server.
From the project root, create the environment file if it does not exist:

```bash
cp -n backend/.env.example backend/.env
```

Set the PostgreSQL server's hostname or IP and credentials in that file. Its
address must be reachable from the backend container. Compose loads the values
at runtime; `.env` stays ignored by Git and excluded from the image.

Start the backend:

```bash
docker compose up -d --build --wait
docker compose ps
```

Access `http://<development-pc-hostname-or-ip>:8000/docs`. Within the Compose
network, the API is available at `http://backend:8000`.

```bash
docker compose logs -f backend
docker compose down
```

Stopping this project does not stop the existing PostgreSQL server.

For development outside Docker, run from `backend/` with Python 3.14 and uv:

```bash
uv sync --locked
uv run fastapi dev src/backend/main.py
```

The PostgreSQL address in `.env` must be reachable from whichever process runs
Python. `/latest` and `/history` query the database directly. The shared models
and latest-reading query live in `src/backend/telemetry.py`; HTTP routes live in
`src/backend/routers/telemetry.py`. The live `/stream` endpoint is the next step.

## Transfer to the Jetson later

Place this repository beside the existing repositories:

```text
<jetson-docker-directory>/
├── room-monitoring-ingestor/
├── room-monitoring-deployment/
│   └── compose.yaml
└── room-monitoring-fullstack-ui/
    ├── compose.yaml
    └── backend/
        ├── Dockerfile
        ├── pyproject.toml
        ├── uv.lock
        └── src/
```

Add this repository's `backend` service to
`room-monitoring-deployment/compose.yaml`. Keep the existing PostgreSQL,
ingestor, and external database volume definitions. Retain the backend's ports,
health check, init, and restart settings, with these changes:

- Set its build context to `../room-monitoring-fullstack-ui/backend`.
- Replace its `env_file` entry with the environment below, using the deployment
  directory's existing `.env` for credentials.
- Make it depend on PostgreSQL being healthy.

```yaml
  backend:
    build:
      context: ../room-monitoring-fullstack-ui/backend
    environment:
      TIMEZONE: Asia/Taipei
      POSTGRES_HOST: postgres
      POSTGRES_PORT: 5432
      POSTGRES_DB: ${POSTGRES_DB}
      POSTGRES_USER: ${POSTGRES_USER}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    depends_on:
      postgres:
        condition: service_healthy
    # Retain ports, healthcheck, init, and restart from this repository's service.
```

`postgres` resolves on the shared deployment network. The development PC's
`.env` and `.venv` are not needed on the Jetson. Build on the 64-bit ARM Jetson
so Docker selects native images. The Dockerfile does not force the PC's
architecture and does not require the GPU or NVIDIA container runtime.

From `room-monitoring-deployment/`:

```bash
docker compose up -d --build --wait backend
```

Access `http://<jetson-hostname-or-ip>:8000/docs`. The combined deployment Compose
file manages the Jetson services; this repository's Compose file remains the
PC development entry point.

## Health and tests

`GET /api/health` checks PostgreSQL. A successful response is:

```json
{"status": "ok", "database": "connected"}
```

The database pool closes during shutdown, including when startup fails partway
through. Run tests from `backend/`; they mock PostgreSQL, so no database server
is needed:

```bash
uv run python -m unittest discover -s tests -v
```
