# REP-03: Derived-Data Persistence + Rallies API

## 1. Goal
Persist derived analytics into MySQL — calibration saves, rally rows, per-second intensity samples — and expose `GET /api/rallies` with filters/sort/pagination. The engine stays untouched: `metrics.py` still writes `derived.json`; this ticket only *reads that file* after a successful run and mirrors the results into the DB (DB = source of truth for queries/reports, file = engine artifact).

Prereq: **REP-01 doc approved** (schema/volume decisions frozen) — table shapes below match it. Branch `challenge/from-mvp-to-service`, conventional commits.

## 2. Scope & Target Files
- `server/migrations/002_derived_data.sql` (new):
  - `calibrations`: `video_id` CHAR(36) PK FK → videos (1:1), `net_x`,`left`,`right`,`top`,`bottom`,`net_y`,`left_tilt`,`right_tilt` DOUBLE NULL, `updated_at`. Absent row = default calibration.
  - `rallies`: `id` BIGINT AUTO_INCREMENT PK, `video_id` CHAR(36) FK, `start_s`,`end_s`,`duration_s`,`peak_intensity` DOUBLE; index `(video_id, start_s)`.
  - `intensity_samples`: `video_id` CHAR(36), `t_s` INT (1 Hz ⇒ integer seconds), `intensity` DOUBLE, PK `(video_id, t_s)`.
  - `reports`: `id` BIGINT AUTO_INCREMENT PK, `video_id` FK, `language` CHAR(2), `audience` ENUM('coach','player'), `content` JSON, `rendered` MEDIUMTEXT, `model` VARCHAR(64), `prompt_version` VARCHAR(32), `created_at`; UNIQUE `(video_id, language, audience)`.
- Court-save route (existing): after writing the current JSON file path, **upsert** the calibration row. Request/response shapes unchanged; DB is truth, file still materialized for the untouched CLI.
- Analytics-run route (existing): after `metrics.py` succeeds and `derived.json` exists → per video: delete old `rallies` + `intensity_samples` rows, bulk-insert from `derived.json` (`rallies[]` → rallies; `timeSeries1s` → intensity_samples at 1 Hz), then **delete that video's `reports` rows** (cache invalidation). Idempotent: re-running yields identical row sets.
- `GET /api/rallies` (new route): params exactly as pinned — `video_id?`, `date_from?/date_to?` (ISO, against `videos.created_at`), `min_duration_s?`, `order_by ∈ {intensity|duration|start}` (`intensity`→`peak_intensity`; default `start`), `order asc|desc` (default `asc` for start / otherwise `desc`), `page` ≥1, `per_page` default 20 max 100 → `{items:[{id, videoId, startS, endS, durationS, peakIntensityPxPerSec, filename, createdAt}], total, page, perPage}`.
- `server/package.json` — no new deps (mysql2 already present from UPL-01).

## 3. Constraints & Guardrails
- `python/*` untouched; values inserted are copied verbatim from `derived.json` — do not recompute or "improve" metrics here.
- No frontend changes (REP-06 owns UI); no seed logic (REP-04); no report code (REP-05).
- Bulk inserts in chunks (~5k rows) even though real clips are tiny — keeps the code correct when data grows; don't over-engineer beyond that.
- Invalid/missing `derived.json` fields → keep existing fail-fast behavior of the route, and roll back partial inserts (transaction per video).

## 4. Acceptance Criteria
- [ ] Calibration save appears in `calibrations` with values matching the saved file; re-save updates, not duplicates.
- [ ] Analytics run on a real small clip: `rallies` row count = rallies in `derived.json`; `intensity_samples` ≈ one row per second of the clip; running analytics twice leaves counts unchanged (idempotent) and clears any cached reports for that video.
- [ ] `GET /api/rallies` correct on: no filters, `video_id`, `min_duration_s=8`, date range around the upload time, `order_by=intensity&order=desc`, pagination past the last page → empty items + stable `total`.

## 5. HUMAN GATE (owner)
1. Via the dashboard flow (UPL-03): open a processed clip → calibrate court → Run analytics.
2. `curl "localhost:8080/api/rallies?video_id=<uuid>"` → see exactly the rallies you saw on the chart; repeat with `min_duration_s=8&order_by=intensity&order=desc`.
3. Re-run analytics once more → counts unchanged (spot-check via a quick `SELECT COUNT(*)`).
