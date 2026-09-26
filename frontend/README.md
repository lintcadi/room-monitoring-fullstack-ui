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
with a Material ripple. Telemetry gauges and quality indicators remain custom visualizations.
History charts use ApexCharts through `ng-apexcharts`.

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
  remain labeled as estimates. Value ranges and diagnostic states are defined centrally
  in `src/app/telemetry/reading-ranges.ts`; these are display interpretations, not alarms.
- Every tag shows its observation age. Select any reading or diagnostic to see
  its full observed/ingested timestamps in Asia/Taipei, quality, and tag key.
  Stream status and heartbeat age remain separate. No stale timeout is assumed
  until the device reporting cadence is confirmed.

The dashboard fits the viewport with all 14 current tags visible, using larger
IAQ, temperature, and humidity tiles plus compact measurements and diagnostics.
SVG gauges show IAQ on a 0–500 scale and humidity on a 0–100 scale. Gas percentage
has a small 0–100 meter. Gauge arcs are clamped to their visual range; the numeric
reading is preserved. Missing data never fills a gauge. These are current-value
indicators rather than historical charts. IAQ uses the Bosch classification below;
humidity and gas percentage gauges do not classify health effects.

Small screens use a denser grid; short phones simplify the humidity tile to its
numeric reading. Details open in a Material dialog that supports Escape and restores
keyboard focus. The live page makes no historical requests.

### Value ranges and data quality

Card quality indicators are labeled **Data** (for example, **Data: Good** on larger
cards); compact cards retain the Data label with the full status in the tooltip
and reading details. This comes from the reading's `quality` field, independently
of the measured value.

The IAQ card also shows a separate air-quality label, gauge color, and background
based on [Bosch's BME680 datasheet, Table 4](https://www.bosch-sensortec.com/media/boschsensortec/downloads/datasheets/bst-bme680-ds001.pdf#page=9).
For example, **167.3 → Moderately polluted (orange)**, even with good data quality.
The details dialog lists all seven bands. The implementation uses consecutive
upper bounds (50, 100, 150, 200, 250, 350, 500), without rounding the input, to
avoid gaps for fractional values. Colors follow the Bosch hues with darker text
for legibility.

Missing, non-good-quality, or out-of-range readings have a neutral classification
state. The reported number is preserved. IAQ accuracy remains a separate diagnostic;
the band is not a guarantee of measurement accuracy or a health assessment.
These bands apply only to `iaq`, not the unscaled `static_iaq` or CO₂/VOC equivalents.

All 14 tags have definitions visible in their reading details, including source links
where applicable. The current range is highlighted only for good-quality readings.
Cards show the value interpretation separately from **Data** quality; diagnostic
values use their state color. Unknown tags stay visible without an invented range.

| Reading                                | Definition                                                                                                                                                                                                              |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Temperature                            | App comfort target: **20–26°C** inclusive. Below: Cool; above: Warm. Outside the sensor’s −40–85°C operating range: out of range. Change `TEMPERATURE_TARGET` to adjust the app target; it is not a health standard.    |
| Humidity                               | **<30% Dry**, **30–50% In target**, **>50–<60% Elevated**, **60–100% High humidity**. Outside 0–100%: out of range. Based on [EPA moisture guidance](https://www.epa.gov/mold/brief-guide-mold-moisture-and-your-home). |
| Pressure                               | **300–1100 hPa** sensor range; neutral because altitude and weather affect pressure.                                                                                                                                    |
| Gas resistance                         | **>0 Ω** plausibility check; relative signal without an absolute clean-air threshold. Display conversion to kΩ does not affect classification.                                                                          |
| Static IAQ                             | **≥0**, no fixed upper limit; neutral unscaled index, not the scaled IAQ bands.                                                                                                                                         |
| CO₂ equivalent / breath VOC equivalent | **≥0 ppm** plausibility check only; neutral estimates. Bosch describes typical minima near 400 ppm / 0.3 ppm, not hard validation limits. No direct-CO₂ or specific-VOC health thresholds are borrowed.                 |
| Gas percentage                         | **0–100%** relative scale; not a measured concentration or percentage of safe air.                                                                                                                                      |
| IAQ accuracy                           | Integer codes **0 Unreliable, 1 Low, 2 Medium, 3 High**.                                                                                                                                                                |
| Stabilization / run-in                 | **0 In progress, 1 Complete**; other values are out of range.                                                                                                                                                           |
| Sensor status                          | **0 Healthy** (project convention); other integer codes: Check status, with the original code retained.                                                                                                                 |
| Heartbeat                              | Any finite device-reported value; protocol range and cadence are unspecified. No online/offline state is inferred from its value.                                                                                       |

The hardware ranges come from the [Bosch datasheet](https://www.bosch-sensortec.com/media/boschsensortec/downloads/datasheets/bst-bme680-ds001.pdf).
Equivalent output behavior is described in [Bosch’s output-range explanation](https://community.bosch-sensortec.com/mems-sensors-forum-jrmujtaw/post/units-and-ranges-for-iaq-iaq-accuracy-static-iaq-co2-equivalent-DlJQ734tSGoHlMD).
A neutral “In sensor range” or “Estimate” label does not certify healthy air.
Raw values are classified before rounding. Numeric values remain visible even
when interpretation is unavailable. History still presents recorded values and
data quality; the range definitions are shown in Live reading details.

## History

Select the **History** tab or go directly to `/history`. Select one or more
measurements and choose the last 1, 6, or 24 hours, or enter a custom range. Custom date inputs and
all displayed timestamps use Asia/Taipei, regardless of the browser's timezone.
The start is inclusive and the end is exclusive. Changes to the measurements or
range stay pending until you click **Apply**. In the custom-range dialog, **Use range** saves
the pending dates; it does not fetch data. The page initially loads the default
one-hour range automatically.

- Fetch the selected tags together from `GET /api/telemetry/history` using repeated
  `tag_ids` parameters, initially up to 1,000 readings total. **Load more** passes
  the returned cursor with the same tag IDs and range. At least one measurement
  must be selected to apply filters. The 5,000-reading limit is shared across all selections.
- **Fit all** spans the requested interval. **Partial range** means more
  pages remain; summary values describe only the loaded readings. At 5,000
  readings, choose a narrower range to keep browser rendering bounded.
- Numeric measurements use time-positioned lines; status flags and IAQ accuracy
  use steps. Uncertain and bad readings have distinct markers and interrupt the
  good-quality line. Minimum and maximum exclude readings of non-good quality.
- Hover, tap, or use arrow keys on the chart to inspect observations. The
  **Readings** view pages through the already loaded data; its arrows do not
  fetch additional history. Values use the same units and precision as Live;
  the Readings table’s value tooltip includes the raw number and original unit.
- **Refresh** reruns the applied query to include late arrivals, leaving any
  pending filter edits untouched. **Load more** also uses the applied filters. Preset ranges advance
  to the current time; custom ranges remain fixed. History does not poll or open
  an SSE connection. Switching away from Live closes its stream, and returning
  opens a fresh one.
- Failed requests show a retry action. A failed additional page preserves the
  data already loaded. Applying filters or leaving the page cancels any
  outstanding history request.

History charts use **ApexCharts** through the standalone `ng-apexcharts` component.
The library handles SVG rendering, axes, tooltips, native zoom/pan, keyboard
navigation and touch gestures. A small app overlay selects tooltip readings by
timestamp so sparse quality series do not change the selected time with pointer height. It loads only when the History chart is opened.

The initial view contains the first **100 readings (100%)**. With 100 or fewer
readings, the full requested time range is shown and navigation controls are hidden.
Use the Apex toolbar’s +/− buttons, scroll wheel or pinch gesture to zoom. Pan mode
is selected initially; drag horizontally to move through time. The magnifier tool
switches to rectangle zoom. The percentage button resets to the first 100 readings;
**Fit all** shows all loaded data across the requested interval. Percentage is
based on the number of visible readings, so it varies with irregular sampling.
Readings with identical timestamps stay together, including at the 100-reading boundary.

The horizontal axis uses actual timestamps formatted in Asia/Taipei. For a single
measurement or measurements with matching units, the vertical axis uses actual values. Comparisons with different units or different status definitions
use a clearly labeled relative scale: 0% is each measurement’s loaded minimum and
100% its loaded maximum; constant series sit at 50%. These percentages describe
variation, not quality, health, or a percentage change. Scales include all qualities
and stay stable during pan/zoom; loading another page can extend them. Each quality
has its own series: good data is connected with gaps at non-good readings; other qualities use markers without connecting
lines. Status tags use steps. Move horizontally anywhere inside the plot to inspect
the nearest timestamp; pointer height does not affect selection. A vertical dashed
guide marks the selected time, a horizontal guide marks its value, and one tooltip
shows actual values, units and data quality. In comparisons, it finds the nearest
loaded observation for each measurement inside the visible time window and shows
each timestamp separately; it does not interpolate or assume synchronized updates.
Colors identify measurements and marker shapes identify quality. The measurement
legend scrolls horizontally if needed, and longer comparison tooltips scroll
within the plot. The Readings table includes a measurement column; comparison
summaries show counts instead of combining minima and maxima across units.
On short screens, these comparison summary cards are hidden to give the plot more
room. You can also focus the chart and use native arrow-key navigation (+/− zoom, Shift+←/→ pan).

Zoom and pan make no backend requests. **Load more** extends the available data
without moving the current time window. Applying filters or refreshing resets the
chart. Switching from Readings back to Chart also starts a new view. Summary cards
always describe all loaded readings, while the chart caption counts visible readings.

Live and History use viewport-fitting layouts, with a denser layout on small screens.
Live gauges remain custom SVG. There are no simulated telemetry readings.

ApexCharts is distributed under [Community/commercial licensing](https://apexcharts.com/license/).
The installed versions are recorded in `package-lock.json`; recheck the applicable
terms if this personal demo becomes a commercial or redistributed product.

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
