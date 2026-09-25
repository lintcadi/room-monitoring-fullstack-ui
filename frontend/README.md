# Room monitoring frontend

Angular 22 with Angular Material 22, standalone components, strict TypeScript,
signals, and native EventSource. Includes a responsive live dashboard, a history page, and a CCTV demo.

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

## Material components

All three routes share Material navigation tabs. The UI uses Material buttons,
card surfaces, dialogs, form fields, selects, button toggles, table/paginator,
slide toggle, and progress bars. Reading cards keep an accessible full-card button
with a Material ripple. Telemetry gauges, history charts, and quality indicators
remain custom visualizations.

The compact Material 3 theme lives in `src/material-theme.scss`, using the
supported Sass theme/override APIs, a green palette, and local system fonts.
`src/styles.css` holds shared dashboard styles; component CSS handles responsive
layout. All routes are lazy loaded. No external font or icon downloads are needed.
After installing the new dependencies with `npm ci`, restart any running Angular
development server so it picks up the additional global theme stylesheet.

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
numeric reading. Details open in a Material dialog that supports Escape and restores
keyboard focus. The live page makes no historical requests.

## History

Select the **History** tab or go directly to `/history`. Select any tag and
choose the last 1, 6, or 24 hours, or enter a custom range. Custom date inputs and
all displayed timestamps use Asia/Taipei, regardless of the browser's timezone.
The start is inclusive and the end is exclusive.

- Fetch one tag at a time from `GET /api/telemetry/history`, initially up to 1,000
  readings. **Load more** passes the returned cursor with the same tag and range.
- The chart always spans the requested interval. **Partial range** means more
  pages remain; summary values describe only the loaded readings. At 5,000
  readings, choose a narrower range to keep browser rendering bounded.
- Numeric measurements use time-positioned lines; status flags and IAQ accuracy
  use steps. Uncertain and bad readings have distinct markers and interrupt the
  good-quality line. Minimum and maximum exclude readings of non-good quality.
- Hover, tap, or use arrow keys on the chart to inspect observations. The
  **Readings** view pages through the already loaded data; its arrows do not
  fetch additional history. Values use the same units and precision as Live;
  the value tooltip includes the raw number and original unit.
- **Refresh** reruns the query to include late arrivals. Preset ranges advance
  to the current time; custom ranges remain fixed. History does not poll or open
  an SSE connection. Switching away from Live closes its stream, and returning
  opens a fresh one.
- Failed requests show a retry action. A failed additional page preserves the
  data already loaded. Changing the tag/range or leaving the page cancels any
  outstanding history request.

Live and History use viewport-fitting layouts, with a denser layout on small screens.
Charts use native SVG; no chart library or simulated readings are included.

## CCTV demo

The **CCTV** tab (`/cctv`) is a UI demo. Its feed stays **Disconnected**; Connect
shows a demo notice, and Snapshot/Record are disabled. The recognition switch only
changes local preview state. Me, Girlfriend, Unknown, observation counts, times,
and match scores are fixed fictional examples. This page makes no API requests,
opens no camera stream, and performs no recognition.

## Checks

```bash
npm run build
npm run test:ci
npm run format:check
```

Tests cover independent tag updates, snapshot replacement, disconnect and recovery,
empty/malformed data, metadata retry, connection cleanup, quality/status mappings,
unit conversion, Taipei timestamps, missing-versus-zero rendering, and gauge
scaling. History tests cover cursor paging, cancellation, retry, display limits,
Taipei ranges, response validation, irregular sampling, quality gaps, and stepped
status charts. Material dialog tests verify Taipei inputs, invalid ranges, and
cancellation without applying a range. Browser checks also cover viewport fit, reading details, keyboard
focus, history navigation and pagination, and network recovery.

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
