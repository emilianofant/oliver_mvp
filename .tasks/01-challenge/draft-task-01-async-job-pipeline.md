# Task C-01 (DRAFT): Async Video Analysis Pipeline — BullMQ + Redis + MySQL Mirror

**STATUS: DRAFT v0** — design locked in Area 1 discussion; finalize before implementation once Areas 2–5 are reviewed. Numbering is per-challenge (`C-NN`), folder `01-challenge/`.

## 1. Goal
Replace the blocking `POST /api/upload` with a non-blocking pipeline: upload responds **202 `{jobId}`** immediately; a BullMQ worker (Redis-backed) runs the existing `analyze.py` CLI unchanged, with env-configurable concurrency; job state is mirrored into MySQL so all API reads go through the relational store and survive server restarts.

## 2. Scope & Target Files
- `docker-compose.yml` — new `redis` service: image `redis:7-alpine`, `command: redis-server --appendonly yes`, named volume for AOF; server gains `REDIS_URL` and `ANALYZE_CONCURRENCY` env + healthcheck-aware startup ordering.
- `server/package.json` — add `bullmq` (single new runtime dep).
- `server/lib/analyzeQueue.js` (new) — producer helper + worker: `concurrency: Number(process.env.ANALYZE_CONCURRENCY ?? 1)`; processor spawns the existing analyze.py invocation exactly as today; event handlers mirror state to DB.
- `server/db.js` (new) — mysql2/promise pool from env (`DATABASE_URL`).
- `server/migrations/001_init.sql` + runner script (`server/scripts/migrate.js`, npm scripts `migrate`) — creates `schema_migrations`, then:
  - `videos`: `id` CHAR(36) PK, `filename`, `size_bytes`, `duration_s` NULL, `created_at`; index on `created_at`.
  - `jobs`: `id` CHAR(36) PK **= videos.id** (1:1, app sets both), `video_id` UNIQUE FK, `status` ENUM('queued','processing','done','failed'), `error` TEXT NULL, `attempts` INT DEFAULT 1, `created_at`, `started_at`, `finished_at`.
  - *(Later challenge tickets add their tables as new migration files — Area 2 will finalize the full set.)*
- `server/server.js` — **add** `POST /api/videos` (multer save → insert rows → `queue.add('analyze', {videoId}, {jobId: uuid})` → 202), `GET /api/jobs/:id`, `GET /api/videos` (videos + latest job status in one call); **remove** the old sync `POST /api/upload` route and its spawn path. Trim/analytics/court routes untouched.

## 3. Constraints & Guardrails
- `python/analyze.py` and `python/metrics.py`: **untouched**; same CLI, same output files (`data/uploads/<uuid>.mp4`, `data/analysis/<uuid>.json`).
- One identifier everywhere: app-generated UUID = `videos.id` = `jobs.id` = BullMQ `jobId`. No second id mapping.
- Single-attempt semantics in this ticket (terminal `failed` + stderr tail truncated to ~2 KB). Retry cap + exponential backoff is a **separate bonus ticket** that only changes job options/events — design the event handlers so that's a 3-line diff.
- API reads never touch Redis directly; MySQL mirror is the read path for both jobs endpoints.
- No SSE, no progress fields, no auth, no dedup of duplicate filenames (each upload = new row).
- UI impact accepted: until the frontend ticket lands, the old dashboard's upload button 404s — uploads happen via curl/new endpoint; document this in the commit message, not in code comments.

## 4. Acceptance Criteria
- [ ] `POST /api/videos` with a small mp4 returns **202 within ~1 s** (before analysis finishes); file lands in `data/uploads/<uuid>.mp4`.
- [ ] `GET /api/jobs/:id` walks queued → processing → done; on done, `videos.duration_s` is filled from the engine's meta.
- [ ] Failure path: upload a non-video renamed `.mp4` → job ends `failed`, `error` carries the stderr tail (≤2 KB), visible via the API.
- [ ] Concurrency: with `ANALYZE_CONCURRENCY=2` two jobs overlap in time (timestamp/log evidence); default 1 serializes them.
- [ ] **Restart safety:** kill -9 the server mid-processing → `docker compose up` again → job completes via stalled-job re-claim; AOF file exists on the named volume and survives a full container restart.
- [ ] `GET /api/videos` returns every video with its latest status/error in one call.
- [ ] Old `/api/upload` gone (route removed, no dead references); removal noted for README (docs ticket).
- [ ] Small conventional commits on the challenge branch; delivery per challenge §7 (branch → single PR to main).

## 5. Open Items (resolve before finalizing)
- Exact `.env.example` lines (`DATABASE_URL`, `REDIS_URL`, `ANALYZE_CONCURRENCY`) — owned by the docs ticket, names pinned here already.
- Full table set pending Area 2 lock (this ticket ships only what it needs: `videos`, `jobs`).
