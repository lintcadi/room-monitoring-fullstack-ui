# Backend deployment and development

The Compose file in this repository runs the backend and Redis on the
development PC. PostgreSQL is an existing service configured through
`backend/.env`. No local deployment repository is required.

## Develop on this PC

Requires Docker with Compose and access to the existing PostgreSQL server.

From the project root, create the environment file if it does not exist:

```bash
cp -n backend/.env.example backend/.env
```

Set the existing PostgreSQL server's hostname or IP and credentials in that
file. The address must be reachable from the backend container. Keep
`REDIS_URL=redis://redis:6379/0`: `redis` is the Redis service name on the Compose
network. `TELEMETRY_POLL_INTERVAL_SECONDS=5` configures the planned poller.

Compose loads `.env` at runtime. It is excluded from the Docker build context
and remains ignored by Git. The image installs dependencies from `uv.lock`
and runs Uvicorn as a non-root user without development reload.

Start both services and wait for their health checks:

```bash
docker compose up -d --build --wait
docker compose ps
docker compose exec redis redis-cli -h redis ping
```

The ping should return `PONG`. Access the API using
`http://<development-pc-hostname-or-ip>:8000`, with interactive docs at `/docs`.
Inside the Compose network, the API is available at `http://backend:8000`.
The backend waits for Redis to be healthy before starting. Redis has no
published host port; only the API is exposed on port 8000.

View logs and stop the services with:

```bash
docker compose logs -f backend redis
docker compose down
```

Redis data is disposable: persistence is disabled because PostgreSQL is the
source of truth. Stopping this Compose project does not stop PostgreSQL.

## Transfer to the Jetson later

Place this repository beside the existing repositories in the Jetson's Docker
directory:

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

On the Jetson, merge this repository's `backend` and `redis` service definitions
into `room-monitoring-deployment/compose.yaml`. Keep the existing PostgreSQL,
ingestor, and external database volume definitions. Retain the backend's ports,
health check, init, and restart settings, with these changes:

- Set the backend build context to `../room-monitoring-fullstack-ui/backend`.
- Remove its `env_file` entry and provide the environment below, using the
  deployment directory's existing `.env` for database credentials.
- Make the backend depend on both PostgreSQL and Redis being healthy.

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
      REDIS_URL: redis://redis:6379/0
      TELEMETRY_POLL_INTERVAL_SECONDS: 5
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    # Retain ports, healthcheck, init, and restart from this repository's service.
```

The backend uses the service names `postgres` and `redis` on the deployment's
shared Compose network. The development PC's `.env` and `.venv` are not needed
on the Jetson.

Build directly on the 64-bit ARM Jetson so Docker selects native ARM64 images;
the Dockerfile does not force the development PC's architecture. The API does
not use the GPU, so it does not need an NVIDIA container runtime.

From `room-monitoring-deployment/`, start the added services:

```bash
docker compose up -d --build --wait backend redis
```

Access the deployed API at `http://<jetson-hostname-or-ip>:8000/docs`.
The combined deployment Compose file manages the Jetson services; the Compose
file in this repository remains the development entry point.

## Health and tests

`GET /api/health` checks both PostgreSQL and Redis. When both are reachable:

```json
{"status": "ok", "database": "connected", "redis": "connected"}
```

An unavailable Redis server produces a startup warning and a `503` health
response, while the PostgreSQL telemetry endpoints remain usable. Connections
are closed during shutdown, including when startup fails partway through.

This step adds Redis connectivity. The dedicated poller, telemetry caching,
and live SSE endpoint will use this connection in subsequent steps.

Run tests from `backend/` using Python 3.14 and uv. The tests mock PostgreSQL
and Redis, so neither service needs to be running:

```bash
uv sync --locked
uv run python -m unittest discover -s tests -v
```

If running the API outside Compose, configure `REDIS_URL` with a Redis server
address reachable from that process. Compose service names resolve only inside
the Compose network.
