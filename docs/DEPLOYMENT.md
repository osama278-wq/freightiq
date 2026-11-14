# Deployment

## Option A — Docker (recommended)
```bash
docker build -t freightiq .
docker run -d --name freightiq -p 8080:8080 -v freightiq-data:/data --env-file .env --restart unless-stopped freightiq
docker exec freightiq node --no-warnings scripts/create-admin.js admin@yourco.om "StrongPass2026" "Admin"
```
Put a TLS reverse proxy in front (Caddy / Nginx / cloud load balancer) and set `COOKIE_SECURE=true`, `PUBLIC_BASE_URL=https://…`.

Caddy example:
```
freight.yourco.om {
  reverse_proxy 127.0.0.1:8080
}
```

## Option B — VPS with systemd
```ini
[Service]
WorkingDirectory=/opt/freightiq
EnvironmentFile=/opt/freightiq/.env
ExecStart=/usr/bin/node --no-warnings=ExperimentalWarning server.js
Restart=always
User=freightiq
```

## Render — test deployment (no login)
`render.yaml` is preset for testing: free plan, `AUTH_DISABLED=true` (no login screen). Free services sleep after 15 minutes idle and lose all data on sleep or redeploy. To go live, copy `render.production.yaml` over `render.yaml` (paid instance + persistent disk, logins on) and set `ADMIN_EMAIL` / `ADMIN_PASSWORD`.

## Option C — Render / Railway / Fly
Web service, start command `npm start`, Node 22, **attach a persistent disk** and set `DATA_DIR` to its mount path (SQLite on ephemeral disks loses data on redeploy). Set secrets in the platform's environment settings. Health check: `/api/health`.

## Operations
- **Backups**: `sqlite3 /data/freightiq.db ".backup '/backups/fiq-$(date +%F).db'"` daily (safe while running, WAL mode).
- **Scaling**: single instance (SQLite + in-process queue). For multiple instances, migrate `src/db.js` to PostgreSQL and the queue to a job broker.
- **Monitoring**: Administration → System performance (route latency/errors, integration failures, search times); container healthcheck.
- **Upgrades**: replace code, restart; schema uses `CREATE TABLE IF NOT EXISTS`; seed never overwrites admin-edited providers.
- **Before go-live**: remove demo users (if seeded), confirm FX live refresh succeeds (Settings), review provider records and set reliability ratings with evidence.
