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
Python. `/latest` and `/history` query the database directly.

## Code structure

The backend groups telemetry code by feature. Application setup and shared
infrastructure stay at the package root:

```text
src/backend/
├── main.py                 # FastAPI assembly and startup/shutdown
├── config.py               # Environment-backed settings
├── database.py             # Shared PostgreSQL connection pool
├── health.py               # /api/health
└── telemetry/
    ├── router.py           # HTTP parameters, endpoints, and error responses
    ├── schemas.py          # Pydantic response models and aggregation types
    ├── tags.py             # Tag metadata queries
    ├── latest.py           # Latest observation per tag
    ├── history.py          # Raw and aggregated history queries, calendar boundaries
    ├── pagination.py       # Query-scoped cursor encoding and validation
    ├── errors.py           # Errors shared by telemetry queries and routes
    └── stream.py           # Shared polling task and SSE snapshots/updates
tests/
```

HTTP handlers delegate to the query modules. Tag queries return `None` when a
single tag is missing; the router converts that to HTTP 404. History validation
raises `InvalidHistoryQuery`, which the router converts to HTTP 400. Database
failures propagate instead of being represented as empty data. Query modules
can be reused without invoking an HTTP handler, and schemas can be imported
without loading database settings.

`main.py` connects the pool, starts the shared stream, registers routes, and
stops the stream before closing the pool. The startup target remains
`backend.main:app`. Tests cover endpoints, lifecycle, streaming, pagination,
and optional PostgreSQL aggregation integration.

## History aggregation

`GET /api/telemetry/history` accepts `aggregation=raw` (the default), `5min`,
`hourly`, `daily`, `weekly`, or `monthly`. The existing `start`, `end`, repeated
`tag_ids` / `tag_name`, `limit`, and `cursor` parameters apply to both modes.

```bash
curl --get 'http://<backend-host>:8000/api/telemetry/history' \
  --data-urlencode 'tag_ids=1' \
  --data-urlencode 'start=2026-09-01T00:00:00+08:00' \
  --data-urlencode 'end=2026-09-08T00:00:00+08:00' \
  --data-urlencode 'aggregation=hourly'
```

Raw responses contain `aggregation: "raw"`, `readings`, and `next_cursor`.
Aggregated responses contain the selected `aggregation`, `buckets`, and
`next_cursor`. Each bucket has:

- `tag_id`, `tag_key`, and its calendar `bucket_start` / `bucket_end`.
- `coverage_start` / `coverage_end`, clipped to the requested half-open range,
  plus `partial` when that range cuts through the bucket.
- `method` and `value`: `average` for known numeric measurements, `last` for
  status codes, readiness flags, IAQ accuracy, heartbeat, and unknown tags.
- `minimum` / `maximum` for numeric measurements, otherwise null.
- `sample_count`, `good_count`, `uncertain_count`, `bad_count`, `unknown_count`,
  and `usable_count` (finite good-quality samples).
- `last_observed_at` and `last_quality`, describing the actual final observation.

Numeric statistics use finite good-quality observations only, with equal weight
per sample. A bucket with no usable samples has null statistics. Last-value
buckets retain the latest observation and its quality, even when that quality
is bad; ties use ingestion time and then reading ID. Empty intervals are omitted,
so clients should display gaps rather than substitute zeros or interpolate.

All calendar boundaries use Asia/Taipei. Weeks begin Monday at midnight, months
begin on the first, and five-minute buckets align to the clock. The connection's
transaction-local timezone supports both timestamp and timestamptz columns.
No timestamp migration or additional service is required.

SQL aggregation runs over all observations matching the requested range and
filters. Pagination is applied afterward to complete `(bucket_start, tag_id)`
results; `limit` counts buckets, not source observations. Raw pagination follows
`(observed_at, id)`. Cursors are bound to the range, tag filters, and aggregation;
changing any of those requires a new query without a cursor. Cursors created
before this change must also be discarded. Refresh to include late arrivals or
changes to previously returned buckets; pagination is not a frozen database snapshot.

History contracts live in `src/backend/telemetry/schemas.py`; queries live in
`src/backend/telemetry/history.py`, with cursors in `pagination.py`.
The route remains `/api/telemetry/history`.

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

The aggregation SQL also has opt-in PostgreSQL integration tests:

```bash
HISTORY_TEST_DATABASE=1 uv run python -m unittest discover -s tests -p test_telemetry_aggregation_postgres.py -v
```

These read connection settings from `backend/.env` and use connection-local
temporary tables. They require permission to create temporary tables, leave
existing telemetry tables untouched, and discard their fixtures on disconnect.
