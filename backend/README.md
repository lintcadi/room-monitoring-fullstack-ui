# Backend deployment and development

The API reads telemetry directly from PostgreSQL. This repository's Compose
file runs the backend and Angular frontend on the development PC, using the
existing database configured in `backend/.env`. No local deployment repository
is required. The dashboard is available on port 8080; see
[frontend setup](../frontend/README.md).

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

Open `http://<development-pc-hostname-or-ip>:8080` for the dashboard or
`http://<development-pc-hostname-or-ip>:8000/docs` for API documentation. Within the Compose
network, the API is available at `http://backend:8000`.

```bash
docker compose logs -f backend
docker compose down
```

Stopping this project does not stop the existing PostgreSQL server.

For development outside Docker, run from `backend/` with Python 3.14 and uv:

```bash
uv sync --locked
uv run uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000 --timeout-graceful-shutdown 5
```

The PostgreSQL address in `.env` must be reachable from whichever process runs
Python. `/latest` and `/history` query the database directly. The shared models
and latest-reading query live in `src/backend/telemetry.py`; HTTP routes live in
`src/backend/routers/telemetry.py`.

## Live telemetry

`GET /api/telemetry/stream` opens an SSE connection. It accepts the same repeated
`tag_name` (tag keys) and integer `tag_ids` filters as `/latest`. Both filters
must match when supplied; omitting them selects all tags.

```bash
curl -N 'http://<backend-host>:8000/api/telemetry/stream?tag_ids=1&tag_ids=2'
```

One background task per API process fetches the latest readings for all tags
and waits five seconds between polls. Connected clients share its snapshot;
opening another connection does not run another database query. The task starts
with the app and stops before the database pool closes.

| SSE event | Client behavior |
| --- | --- |
| `snapshot` | Replace current readings with `data.readings`; the list may be empty. |
| `update` | Merge `data.readings` by `tag_id`, keeping omitted tags unchanged. |
| `status` with `{"status":"unavailable"}` | Mark live data unavailable while retaining the displayed readings. |

Snapshots and updates use the same reading fields as `/latest`. A new reading
ID causes an update even when its value is unchanged. Changes to other fields,
including quality, also cause updates. Unchanged readings produce no data event;
FastAPI sends idle heartbeat comments automatically.

New connections receive the most recent successful poll as a snapshot, which
can be up to one polling interval old during normal operation. Before the first
successful read they wait, or receive an unavailable status if the read fails.
On database recovery, a fresh snapshot restores the client's state. A snapshot
also replaces state when a selected tag disappears. Reconnecting starts a new
snapshot; this endpoint does not replay missed readings or accept history cursors.

The service keeps only its latest snapshot. Slow clients compare that state
with their own last event, so updates to different tags remain represented
without accumulating an unbounded queue. Intermediate measurements may be skipped;
use `/history` when every reading matters.

For a browser on the same origin:

```javascript
const live = new EventSource('/api/telemetry/stream?tag_ids=1&tag_ids=2');
let readings = new Map();
let available = false;

live.addEventListener('snapshot', (event) => {
  const data = JSON.parse(event.data);
  readings = new Map(data.readings.map((reading) => [reading.tag_id, reading]));
  available = true;
  // Render the snapshot, including an empty list.
});

live.addEventListener('update', (event) => {
  for (const reading of JSON.parse(event.data).readings) {
    readings.set(reading.tag_id, reading);
  }
  // Render the updated values.
});

live.addEventListener('status', () => { available = false; });
live.onerror = () => { available = false; }; // EventSource reconnects automatically.

// Call live.close() when leaving the page or changing the selected tags.
```

Use one API worker for the demo; it can serve multiple clients. The container
explicitly starts one worker. Additional workers would each run their own poll.
On shutdown, Uvicorn allows five seconds for active requests before cancelling
remaining streams, leaving time to stop polling and close the pool.

## Transfer to the Jetson later

Place this repository beside the existing repositories:

```text
<jetson-docker-directory>/
├── room-monitoring-ingestor/
├── room-monitoring-deployment/
│   └── compose.yaml
└── room-monitoring-fullstack-ui/
    ├── compose.yaml
    ├── backend/
    │   ├── Dockerfile
    │   ├── pyproject.toml
    │   ├── uv.lock
    │   └── src/
    └── frontend/
        ├── Dockerfile
        ├── nginx.conf
        ├── package-lock.json
        └── src/
```

Add this repository's `backend` service to
`room-monitoring-deployment/compose.yaml`. Keep the existing PostgreSQL,
ingestor, and external database volume definitions. Retain the backend's ports,
health check, init, restart, and stop grace period settings, with these changes:

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
    # Retain ports, healthcheck, init, restart, and stop_grace_period from this repository's service.
```

`postgres` resolves on the shared deployment network. The development PC's
`.env` and `.venv` are not needed on the Jetson. Build on the 64-bit ARM Jetson
so Docker selects native images. The Dockerfile does not force the PC's
architecture and does not require the GPU or NVIDIA container runtime.

From `room-monitoring-deployment/`:

```bash
docker compose up -d --build --wait backend
```

Also add the frontend service with build context
`../room-monitoring-fullstack-ui/frontend`, following
[the frontend transfer instructions](../frontend/README.md#transfer-to-the-jetson).
Then start both with `docker compose up -d --build --wait backend frontend`.

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
