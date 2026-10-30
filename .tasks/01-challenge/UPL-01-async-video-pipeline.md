# UPL-01: Async Video Analysis Pipeline (BullMQ + Redis + MySQL Mirror)

## 1. Goal
Replace the blocking `POST /api/upload` with a non-blocking pipeline: upload responds **202 `{jobId}`** as soon as the file is safely on disk; a BullMQ worker (Redis-backed) runs the existing `analyze.py` CLI unchanged with env-configurable concurrency; job state is mirrored into MySQL so all API reads go through the relational store and survive server restarts.

Works on branch `challenge/from-mvp-to-service` (small conventional commits). **UPL-02 and UPL-03 depend on this ticket.**

## 2. Scope & Target Files
- `docker-compose.yml` — add:
  - `mysql`: image `mysql:8`, env `MYSQL_DATABASE=oliver`, `MYSQL_USER`/`MYSQL_PASSWORD` (dev-grade credentials; production secret management is out of scope and noted as such), named volume for data, healthcheck (`mysqladmin ping`).
  - `redis`: image `redis:7-alpine`, **`command: redis-server --appendonly yes`** (AOF — this is what makes jobs survive restarts), named volume, healthcheck (`redis-cli ping`).
  - server gains env: `DATABASE_URL=mysql://oliver:***@db…word)`, `REDIS_URL=redis://redis:6379`, `ANALYZE_CONCURRENCY` (default unset → treated as 1). Startup ordering via `depends_on` + healthcheck conditions.
- `server/package.json` — add deps: `bullmq`, `mysql2`.
- `server/lib/db.js` (new) — mysql2/promise pool from `DATABASE_URL`; `runMigrations()` applying unapplied files in order, tracked in `schema_migrations(version, applied_at)`; **called automatically at server boot before listen** (idempotent), plus npm script `migrate` wrapping it for manual use.
- `server/migrations/001_init.sql` (new) — creates:
  - `videos`: `id` CHAR(36) PK, `filename` VARCHAR(255), `size_bytes` BIGINT NULL, `duration_s` DOUBLE NULL, `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP; index on `created_at`.
  - `jobs`: `id` CHAR(36) PK **= videos.id** (1:1 — the app sets both to the same UUID), `video_id` CHAR(36) UNIQUE FK → videos, `status` ENUM('queued','processing','done','failed'), `error` TEXT NULL, `attempts` INT NOT NULL DEFAULT 0, `created_at`, `started_at` NULL, `finished_at` NULL.
- `server/lib/analyzeQueue.js` (new) — producer helper + worker:
  - Worker: `concurrency: Number(process.env.ANALYZE_CONCURRENCY ?? 1)`; processor spawns the **exact same analyze.py CLI invocation used today** → exit 0 = success, else throw with stderr tail.
  - Event handlers mirror to DB (source of truth for all API reads): waiting/delayed → `queued`; active → `processing` (+`started_at`, +`attempts+1`); completed → `done` (+`finished_at`) **and** read `data/analysis/<uuid>.json` meta to fill `videos.duration_s`; failed → terminal per UPL-02's design (single-attempt for now), error = stderr tail truncated to ~2 KB.
- `server/server.js` — **add**:
  - `POST /api/videos`: multer saves to `data/uploads/<uuid>.mp4` → INSERT videos + jobs(`queued`) rows → `queue.add('analyze', {videoId}, {jobId: uuid})` → **202 `{jobId}`**. Strict order: file on disk before DB rows, DB rows before enqueue — a queued job must never exist without its file; transfer/save failure returns plain 4xx/5xx and creates no job.
  - `GET /api/jobs/:id` → `{jobId, status, error, attempts, createdAt, startedAt, finishedAt}` (404 if unknown). Reads MySQL only — never Redis.
  - `GET /api/videos` → one call: every video with its job attached: `{id, filename, sizeBytes, durationSec|null, createdAt, videoUrl:"/data/uploads/<id>.mp4", job:{status,error,attempts,...}}`.
  - **remove** the old sync `POST /api/upload` route and its spawn path.

## 3. Constraints & Guardrails
- `python/analyze.py`, `python/metrics.py`: **untouchable**; same CLI, same output files (`data/uploads/<uuid>.mp4`, `data/analysis/<uuid>.json`).
- One identifier everywhere: app-generated UUID = `videos.id` = `jobs.id` = BullMQ `jobId`. No id mapping tables.
- The upload (byte transfer) stays synchronous inside the request by design — only analysis is queued; do not add an "upload job" state.
- Single-attempt semantics in this ticket (terminal `failed` + error tail). Retry cap/backoff belongs to **UPL-02** — keep event handlers structured so that's a ~3-line diff there.
- No SSE, no progress fields, no auth, no duplicate-filename dedup (each upload = new row).
- Trim/court/analytics routes: behavior untouched; they already key on the `<uuid>` file convention and must keep working.
- `web/src/App.jsx` untouched here (**UPL-03** owns the frontend); until then the old dashboard's upload button 404s — expected, note it in the commit message.

## 4. Acceptance Criteria
- [ ] `docker compose up --build` from clean state: mysql + redis healthy, server boots (migrations auto-applied), all routes answer.
- [ ] **Non-blocking proof:** upload a small mp4 → 202 with `{jobId}` arrives while analysis is still running — immediately after the 202, `GET /api/jobs/<id>` shows `queued` or `processing`, never already `done`.
- [ ] Lifecycle: job walks queued → processing → done; on done, `videos.duration_s` filled from engine meta (visible via `GET /api/videos`).
- [ ] Failure path: non-video file renamed `.mp4` → job ends `failed`; `error` contains a readable stderr tail ≤ 2 KB.
- [ ] Concurrency: with `ANALYZE_CONCURRENCY=2`, two uploads show overlapping `[started_at, finished_at]`; default serializes (second starts ≥ first finishes) — verify via API timestamps.
- [ ] Old `/api/upload` gone; no dead references in server code.

## 5. HUMAN GATE (owner runs personally before this ticket is closed)
1. `docker compose up --build` → both new services healthy, dashboard backend answers on :8080.
2. `time curl -s -X POST localhost:8080/api/videos -F file=@<small.mp4>` → 202 `{jobId}` quickly; then poll `curl -s localhost:8080/api/jobs/<id>` a few times and watch it walk to `done`.
3. Upload a broken `.mp4` (renamed text file) → job `failed`, error tail readable in the response.
4. **Restart safety:** start a longer clip; while processing run `docker compose kill server`; wait ~10 s; `docker compose up -d`; poll until `done`. Then confirm AOF persisted: `docker compose exec redis ls /data/appendonlydir` shows files on the named volume.
5. `curl -s localhost:8080/api/videos` → all uploads listed with statuses and playable `videoUrl`s (open one in a browser tab — it streams).
