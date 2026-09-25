# Room monitoring frontend

Angular 22 with standalone components, strict TypeScript, signals, and native
EventSource. This checkpoint implements the responsive live dashboard; history
will follow separately.

## Run with Compose

From the repository root, after configuring PostgreSQL in `backend/.env`:

```bash
docker compose up -d --build --wait
docker compose ps
```

Open `http://<development-pc-hostname-or-ip>:8080`. The frontend image builds
Angular with Node.js and serves only the production files with Nginx. Node.js
does not need to be installed on the host. Compose waits for the backend health
check before starting the frontend. Its `/healthz` checks Nginx; `/api/health`
checks the backend and database through the proxy.

All `/api/` requests go to `backend:8000` over the Compose network. SSE buffering
and compression are disabled in that location, and Nginx refreshes the backend's
DNS address if its container is recreated. The frontend needs no `.env` file or
`BACKEND_URL` for this setup. That variable is only for the Angular development
server described below.

After changing frontend source, rebuild with `docker compose up -d --build frontend`.
To change the public port, edit the `8080:80` mapping in Compose.

## Run on the development PC

Use Node.js 24.15 or newer in the 24.x line (`.nvmrc` selects Node 24).
See [Angular compatibility](https://angular.dev/reference/versions).
Start the backend using [its development instructions](../backend/README.md).
Then, from this directory:

```bash
npm ci
BACKEND_URL=http://<backend-hostname-or-ip>:8000 npm start
```

Replace the placeholder with the actual reachable hostname or LAN IP. Open
`http://<development-pc-hostname-or-ip>:4200` on the PC or a device on the same
network. The development server binds to `0.0.0.0`; allow port 4200 through the
PC firewall if needed. This is a development server, not the production server.

`BACKEND_URL` is required and is the backend origin only (no `/api` suffix).
It configures the development proxy, not the browser bundle. All browser API
requests use relative `/api` paths, so no hostnames or credentials are embedded
in the frontend. The proxy forwards REST and long-lived SSE traffic; CORS
configuration is not needed for this arrangement. Restart the development
server after changing the target.

## Live data behavior

- Load names, tag keys, IDs, and units from `GET /api/telemetry/tags`.
- Open one `GET /api/telemetry/stream` connection for the page.
- Replace readings on `snapshot`; merge `update` readings by `tag_id`.
- Keep last-known readings visible during disconnects or backend unavailability,
  with a notice. EventSource retries disconnected streams automatically; the
  Reconnect button also permits a manual retry.
- A malformed event closes the connection and shows a retryable error.
- Missing readings display an em dash, never zero. An empty snapshot is valid.
- Known tags have appropriate numeric precision or diagnostic labels. Unrecognized
  tags remain visible with the additional measurements.
- Telemetry quality is separate from IAQ accuracy: 0 Good, 1 Uncertain, 2 Bad.
  Sensor status 0 is Healthy; other codes remain visible without an invented label.
- Gas resistance in ohms is displayed in kiloohms. CO2 and breath VOC equivalents
  remain labeled as estimates. No air-quality thresholds or alarms are inferred.
- Every tag shows its observation age. Select any reading or diagnostic to see
  its full observed/ingested timestamps in Asia/Taipei, quality, and tag key.
  Stream status and heartbeat age remain separate. No stale timeout is assumed
  until the device reporting cadence is confirmed.

The dashboard fits the viewport with all 14 current tags visible, using larger
IAQ, temperature, and humidity tiles plus compact measurements and diagnostics.
SVG gauges show IAQ on a 0–500 scale and humidity on a 0–100 scale. Gas percentage
has a small 0–100 meter. Gauge arcs are clamped to their visual range; the numeric
reading is preserved. Missing data never fills a gauge. These are current-value
indicators, not historical charts or health classifications.

Small screens use a denser grid; short phones simplify the humidity tile to its
numeric reading. Details open in a native dialog that supports Escape and restores
keyboard focus. No chart library, historical requests, or simulated data is added.

## Checks

```bash
npm run build
npm run test:ci
npm run format:check
```

Tests cover independent tag updates, snapshot replacement, disconnect and recovery,
empty/malformed data, metadata retry, connection cleanup, quality/status mappings,
unit conversion, Taipei timestamps, missing-versus-zero rendering, and gauge
scaling. Browser checks also cover viewport fit, reading details, keyboard focus,
and network recovery.

Production files are written to `dist/room-monitoring/browser` and copied into
the Nginx image by the Dockerfile. The Angular development proxy is not included
in production output.

## Transfer to the Jetson

Place this repository alongside `room-monitoring-deployment` and
`room-monitoring-ingestor`. Copy the `frontend` service from the root Compose
file into `room-monitoring-deployment/compose.yaml`, changing its build context
to `../room-monitoring-fullstack-ui/frontend`. Keep its dependency on `backend`,
health check, and port mapping. Add the backend as described in
[the backend instructions](../backend/README.md#transfer-to-the-jetson-later).
Both services must share a Compose network so `backend` resolves by service name.

Build on the 64-bit ARM Jetson; no PC architecture is forced in the Dockerfile.
Transfer source and lockfiles, not `node_modules` or the PC build output.
From `room-monitoring-deployment/`, start both services:

```bash
docker compose up -d --build --wait backend frontend
```

Open `http://<jetson-hostname-or-ip>:8080`. The existing PostgreSQL and ingestor
services remain in the deployment Compose file.
