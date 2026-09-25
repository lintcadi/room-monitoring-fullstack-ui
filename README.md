# room-monitoring-fullstack-ui

Develop on this PC with the repository's `compose.yaml`. Later, place this
repository beside `room-monitoring-ingestor` and `room-monitoring-deployment`
on the Jetson and add its backend and frontend services to the existing deployment
Compose file.

With PostgreSQL configured in `backend/.env`, start both services:

```bash
docker compose up -d --build --wait
```

Open `http://<development-pc-hostname-or-ip>:8080` for the dashboard. Nginx serves
the Angular build and proxies `/api` to `backend:8000`, including live SSE events.
The backend also remains accessible on port 8000.

See [backend setup and Jetson transfer instructions](backend/README.md).

The Angular live dashboard is in `frontend/`. See [frontend setup](frontend/README.md)
for the development proxy, responsive dashboard, and verification commands.
