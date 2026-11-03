# oliver_video - Code Challenge

Padel/tennis video player-detection project.

## Screenshots

<!-- new screenshots go here -->

## Run with Docker

The whole stack runs from a single command on any machine that has only Docker installed — no host Python, venv, Node, or FFmpeg needed:

```bash
docker compose up --build
# then open http://localhost:8080
```

Upload an .mp4 in the dashboard and the full flow (analysis → intensity chart → highlight clip) runs inside the containers. CPU works out of the box; expect the `server` image to be ~2–3 GB because it bundles a CUDA-capable PyTorch wheel. On CPU, analysis takes roughly real-time or longer; the upload returns immediately with a job ID (`POST /api/videos` → 202) and a background worker runs the analysis — poll `GET /api/jobs/<id>` or `GET /api/videos` for status. A large clip may take several minutes.

**Architecture sketch.** Four compose services. 
- `db` is MySQL 8 on a named volume — source of truth for all API reads (`videos`, `jobs`, `rallies`, `intensity_samples`, `calibrations`, `reports`). 
- `redis` is Redis 7 with AOF persistence, backing the BullMQ analysis queue (rationale in the 'Queue choice and why' subsection of the wrap-up section below). 
- `server` runs the Node/Express API (`node:20-slim` + apt python3 + ffmpeg); it spawns `python3 python/analyze.py` (YOLOv8s + ByteTrack) for uploads and `ffmpeg` for highlight trimming, with all runtime artifacts in a named Docker volume mounted at `/app/data` (inspect via `docker cp oliver_video-data:/app/data .`). 
- `web` is an nginx container that serves the built Vite/React dashboard on port 80 (published as :8080) and reverse-proxies `/api/*` and `/data/*` to the `server` service, so all UI→API traffic stays inside the compose network. 
The engine auto-detects CUDA vs CPU at runtime.

**Fresh start.** To wipe everything (DB, queue, uploads/analysis) and rebuild from scratch: `docker compose down -v && docker compose up --build`. Migrations re-apply automatically at boot.

**Optional GPU.** To run inference on a GPU: install [nvidia-container-toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html) on the host, then start with the GPU override file merged in:

```bash
docker compose -f docker-compose.yml -f docker-compose.gpu.yml up --build
```

Without it (the default) no device is exposed and the engine runs on CPU. With a visible CUDA device the engine uses it (FP16); without one it falls back to CPU automatically — no other change needed.

## From MVP to service: challenge wrap-up

What this branch adds on top of the MVP: an async job pipeline (BullMQ + Redis with a MySQL mirror), a queryable rally API backed by that database, a deterministic volume dataset for EXPLAIN work, and an AI report endpoint. Skimmable summary below; depth is linked out to the normative design docs: [Seed dataset & video-type spec](docs/seed-dataset-spec.md) (REP-01) · [AI report content spec](docs/report-spec.md) (REP-02).

### How to run it

```bash
docker compose up --build        # db + redis + server + web → dashboard at http://localhost:8080
```

- Migrations (`server/migrations/*.sql`) **apply automatically at boot** — no manual DB steps. The same idempotent step can be invoked manually for dev: `npm run migrate` (from `server/`, after `cd server && npm ci`) or, inside the running stack, `docker compose exec -w /app/server server npm run migrate`.
- Copy `.env.example` → `.env` and fill in what you need; with an empty key, AI reports stay disabled and return a clear 503 — everything else works without it.
- To load volume data for rally queries / EXPLAIN work: `docker compose exec -w /app/server server npm run seed -- --fresh` — see the 'Volume dataset & EXPLAIN' section further down (`--fresh` TRUNCATEs all tables; that is the point).

### Queue choice and why (BullMQ + Redis vs a plain MySQL jobs table)

Analysis takes roughly real-time or longer on CPU, so uploads are queued instead of blocking the request — and if several uploads arrive at once, a queue is the natural tool for that. It has to handle three concrete things: how many analyses run in parallel (`ANALYZE_CONCURRENCY`), how often a failed job retries before giving up (bounded by `ANALYZE_MAX_ATTEMPTS`, waiting longer between each try), and surviving restarts — Redis writes its queue to disk as an append-only file (that's what "AOF" means), so queued or running jobs come back after the server container restarts, with no extra work.

The alternative was a plain MySQL table: one row per job, and workers polling it for work. That would mean hand-rolling everything above — claim loops, retry counters, crash-recovery semantics — on top of the polling latency. And it wouldn't simplify reads either: every API read already goes through MySQL (the `jobs` table is mirrored there as the source of truth), so Redis never answers a request anyway.

Accepted cost: one more compose service, and a small window where a freshly enqueued job exists only in Redis until its first state event is mirrored to MySQL.

### AI reports (model and why)

- **Model:** `gemini-3.5-flash-lite` on Google's free tier, called via plain REST with structured output (JSON `responseSchema`, temperature pinned) — no SDK. Free-tier rate limits are plenty for dev volume; if the lineup changes, swap one constant: the default in `server/server.js` or the `GEMINI_MODEL` env var. No fallback chain is implemented — a deliberate decision, not an oversight.
- **What leaves the machine:** derived numeric metrics only — session stats plus at most 5 candidate rallies and 6 intensity windows (values rounded once to 1 decimal at the context boundary), language/audience, and one UTC date. **No footage, no frames, not even filenames or video ids** — user-controlled strings never enter the prompt (hard exclusion in `docs/report-spec.md` §2).
- **Free-tier data handling:** per Google's current terms for the Gemini API free tier, submitted content may be used to improve Google's products — which is exactly why only derived numbers cross that boundary.

### Design decisions & trade-offs

- **Index-based model references + server-side hydration** — "no number passes through the LLM": the model cites `rallyIndex`/`windowIndex` only; every number in a rendered report is a DB row or a spec formula, re-read at full precision after validation (`docs/report-spec.md`, §4).
- **The summary as trust boundary** — free prose (summary/reasons) is trusted verbatim because it cannot be fully number-audited without brittle heuristics; everything structural is validated, capped and hydrated server-side (`docs/report-spec.md`).
- **Per-player data excluded from model input** — known precision limitation of the player filter; a documented decision, not an oversight (report spec §2 hard exclusion).
- **Doc-only video taxonomy** — the match/clip/summary archetypes live in `docs/seed-dataset-spec.md` §1 only; uploads are *not* classified (there is no `videos.kind` column), because classification would be a guess presented as fact.
- **Strategy-B volume placement** — the ≥500k-row target is carried by 1 Hz intensity samples (~970k rows), not padded rallies (~19k, domain-capped at ~122 points/match) ([seed dataset spec](docs/seed-dataset-spec.md) §4; see the 'Volume dataset & EXPLAIN' section further down).
- **The px/s caveat** — intensity is frame-resolution-dependent px/s, not physical speed; it applies to seeded data exactly as to real data (caveat in `docs/seed-dataset-spec.md` §6).

### Improvements with more time

- Engine / player-filter precision (per-player metrics are approximate today — which is why they stay out of the reports).
- SSE progress instead of polling `GET /api/jobs/:id`.
- A richer cross-video rally-browsing UI on the seeded data (`/api/rallies` already supports the filters, sorting and pagination it needs; the dashboard shows per-video rallies from derived.json only).
- Test suite — there is none yet, for either the server or the Python side.

### AI tooling disclosure

Code Agent: Pi
 - Profile Planner: for planning and creation of tasks / specs
 - Profile Coder: for atomically tackling each task
 - Model used: Qwen 3.8 27b Q4_K_M

### Brief roadmap:
- Planning started with pi-planner: given the challenge text, it produced a design draft and then created the tickets/tasks.
  * Queue plan: API changes to support multiple uploads and queues. Between MySQL-only vs BullMQ, the latter was chosen — an unfamiliar stack worth exploring.
  * Schema plan: to outline the data modelling for analytics. At this point two big challenges were identified: upload/queues/process and process/analytics/reporting. They were split because although upload works and the analysis engine runs, it isn't accurate — test data is needed either way; splitting allows proving upload/queues/process first and then process/analytics/report.
- 3 tasks were generated for the first part Upload/Queue (git tag `v0.1.0`)
  * Task UPL-01: add Docker images for MySQL, Redis, modify server code to implement libraries connecting to both services. Asked for curl files to run examples, everything worked ok.
  * Task UPL-02: bonus to cap upload retries – OK
  * Task UPL-03: update web UI for e2e uploader, video list and statuses; Polling for the UI where a video is being processed – OK.
- Move to phase 2 for metrics / AI report. Two things had to be resolved first:
  * define what data to store, and generate a sensible random seed data set (match duration, rally duration, etc.)
  * define which metrics and how they will be shown in the report
- 7 tickets were generated (git tag `v0.2.0`)
  * Task REP-01 seed-dataset-spec: spec for the data seed, with analysis to generate filler data with meaning. Define upload types `match / clip / summary`, track intensity rows at 1 Hz.
  * Task REP-02 report-content-spec: define the spec of calculations to derive metrics that will later be passed to the LLM for the report. Key rule: the LLM does not compute, it only receives results and presents them with a coach or player profile.
  * Task REP-03 data-persistence: migrations for calibrations / rallies / intensity_samples / reports, upsert calibration on save, mirror derived.json into MySQL after analytics run and invalidate cached reports. Implement `GET /api/rallies` with filters/sort/pagination.
  * Task REP-04 seed-explain: deterministic seed script implementation + EXPLAIN analysis and index rationale documented in README.
  * Task REP-05 report-endpoint: `POST /api/videos/:id/report` with context builder, versioned prompt, structured JSON validation/hydration, rendering, caching, timeout/rate-limit/error handling. Model: Gemini free tier via REST, structured output.
  * Task REP-06 report-ui: “Generar reporte” button, language/audience selectors, loading / error / empty states in the modal.
  * Task REP-07 docs-delivery: README challenge section, .env.example, cold-start verification. _all tasks were commited and lived under `.tasks/01-challenge`._
- Created PR

## Python "analysis engine" setup (one-time)

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt        # ultralytics pulls torch/opencv/numpy in
```

With a CUDA GPU present, inference automatically runs on `device=0` with FP16; otherwise it falls back to CPU. First run auto-downloads the model weights (~22 MB) into the repo root — expected, not an error (the file is gitignored). Tracking uses Ultralytics' stock ByteTrack config (`bytetrack.yaml`, bundled with ultralytics); no custom tracker files are involved.

### Running

```bash
python python/analyze.py --input samples/<clip>.mp4 [options]
```

### Arguments

| Flag | Default | Description |
|---|---|---|
| `--input <path.mp4>` | *(required)* | Input video file. Must exist and be decodable, otherwise the script exits 1. |
| `--model <name.pt>` | `yolov8s.pt` | Ultralytics model to use. First knob if boxes disappoint: `--model yolov8m.pt`. |
| `--show` | off | Open a live annotated OpenCV window (person boxes + persistent track IDs) while playing the video. Quit with `q`. |
| `--out <file>` | none | Also write the per-frame lines + summary line to this file (stdout still prints them). |
| `--conf <float>` | ultralytics track-mode default `0.1` | Minimum detection confidence. Raise it (e.g. `0.5`) to ignore distant/crowd people; too high and occluded players drop out too. |
| `--save-frames <dir>` | none | Save every frame annotated with the model's detections as JPGs (`frame-00000.jpg`, …) into `<dir>`. Labels show `id:<trackId> <class>` for all detected classes. |

### Examples

```bash
# Headless run: per-frame lines + summary on stdout, persisted to a text file
python python/analyze.py --input samples/00_padel.mp4 --out data/00_padel.txt

# Live visual check (window with boxes + persistent IDs)
python python/analyze.py --input samples/00_padel.mp4 --show

# Annotated frame dump for later inspection, stricter confidence to drop the crowd
python python/analyze.py --input samples/00_padel.mp4 --save-frames data/00_padel-frames --conf 0.5
```

### Output format (stdout / `--out`)

One line per decoded frame, then one summary line:

```
0 players=6 ids=[1, 2, 3, 5, 6, 8]
1 players=6 ids=[1, 2, 3, 5, 6, 8]
...
summary: frames=720 max_players=13 unique_track_ids=58
```

- `frameIndex` is 0-based over decoded frames.
- `players` = number of COCO "person" boxes in that frame (any person — players **and** crowd; no court/player logic at this stage).
- `ids` = persistent ByteTrack track IDs of those persons.

### Exit codes

| Code | Meaning |
|---|---|
| `0` | Success (a clip with zero people is still a success: all frames `players=0`). |
| `1` | Input file missing/unreadable, or the video yielded zero decoded frames (message on stderr). |

### Layout

```
requirements.txt      # single dependency: ultralytics
python/analyze.py     # the standalone preview script (Task 01)
samples/              # your test MP4s go here (gitignored)
data/                 # runtime artifacts: --out files, saved frames (gitignored)
.tasks/               # project task tickets
```
## Volume dataset & EXPLAIN

The rally query path in `GET /api/rallies` was designed for real data that never exists at scale: the domain ceiling is measured, ~122 rallies per full match (see `docs/seed-dataset-spec.md`, §4), so even a large library of matches only yields tens of thousands of rally rows. To exercise the API and its indexes at volume without fabricating unrealistic data, `server/scripts/seed.js` fills the database with a **deterministic synthetic dataset** (fixed PRNG seed — identical structure, ids and rally rows on every run; only absolute timestamps anchor to run time) whose row volume comes from one intensity sample per second per video (~970k rows), not from padded rallies. Seeded videos have no media files: their `videoUrl` 404s by design, and px/s values are frame-resolution-dependent, same caveat as real analysis output.

### Running it

```bash
cd server && npm ci
npm run migrate                                  # idempotent; also auto-applied at server boot
npm run seed -- --fresh                          # TRUNCATEs all six tables FIRST — see below
```

Inside the compose stack (where `DATABASE_URL` is already set on the server service):

```bash
docker compose exec server npm run seed -- --fresh
```

**Danger, by design:** `--fresh` TRUNCATEs all six tables — real uploads and their analysis data included. That is the point of a clean volume dataset. Without the flag the script refuses to run if `videos` is non-empty and prints these instructions instead. Seeding ~1M rows takes seconds.

### Expected row counts (spec §4, worked at exactly 200 videos = 150 match / 30 clip / 20 summary)

| Table | Formula | Worked example |
|---|---|---|
| `intensity_samples` | Σ videos × E[duration] ≈ n_match·6300 + n_clip·105 + n_summary·1050 | 150×6300 + 30×105 + 20×1050 ≈ **~970k** |
| `rallies` | (n_match − 3)·≈122 + n_clip·E[U{1..6}] + n_summary·(1050/21.5) | 147×122 + 30×3.5 + ~977 ≈ **~19k** |

Plus exactly one `done` row per video in `jobs`, ~60 % of videos in `calibrations`, and zero rows in `reports` until report generation fills them. The seed prints actual counts for all six tables and exits non-zero if `intensity_samples` < 500,000.

### Canonical query & EXPLAIN

A cross-video, filtered rally query — the endpoint was built for a rally-browser UI (the current dashboard shows per-video rallies from derived.json only) — e.g. "longest-intensity rallies", is served as:

```
GET /api/rallies?min_duration_s=8&order_by=intensity&order=desc&page=1
```

which the endpoint turns into this exact statement (`LIMIT`/`OFFSET` per page, `per_page ≤ 100`):

```sql
SELECT r.id, r.video_id AS videoId, r.start_s AS startS, r.end_s AS endS,
       r.duration_s AS durationS, r.peak_intensity AS peakIntensityPxPerSec,
       v.filename, v.created_at AS createdAt
FROM rallies r JOIN videos v ON v.id = r.video_id
WHERE r.duration_s >= 8
ORDER BY r.peak_intensity DESC, r.id ASC
LIMIT 20 OFFSET 0;
```

Actual `EXPLAIN` against the seeded database (19,067 rally rows; dev credentials from docker-compose.yml), captured via:

```bash
docker compose exec db mysql -uoliver -poliver_dev_password oliver
```


| id | select_type | table | type | possible_keys | key | key_len | ref | rows | filtered | Extra |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | SIMPLE | r | ALL | idx_rallies_video_start | NULL | NULL | NULL | 19032 | 33.33 | Using where; Using filesort |
| 1 | SIMPLE | v | eq_ref | PRIMARY | PRIMARY | 144 | oliver.r.video_id | 1 | 100.00 | NULL |

### Why the indexes are what they are

`rallies(video_id, start_s)` serves the dashboard's per-video rally list — equality on `video_id` plus chronological order — as a pure index scan with no sort, and keeps per-video lookups/counts cheap for any video. `videos(created_at)` serves the landing table's `ORDER BY created_at DESC` and the date-window filters (`date_from`/`date_to`) on this endpoint. There is deliberately **no** index per sort dimension (`peak_intensity`, `duration_s`, …): the rallies table is domain-capped at ~19k rows — that number follows from ~122 points per match, not from a row-count target (spec §4) — so the full scan plus filesort above touches only ~19k narrow rows and costs single-digit milliseconds. That `type=ALL` + `Using filesort` line in the EXPLAIN is expected at this scale, not a defect; an index per sort column would buy micro-seconds while paying write amplification on every derived-data mirror insert. The honest limit: if rallies ever grew into the millions (they can't, given the domain ceiling), the plan for unindexed sort/filter columns is to add one composite index per actual query pattern — not a generic index zoo.
