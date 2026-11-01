# AGENTS.md — oliver_video

Cold-start guide for agents and contributors: what this is, how it runs, its contracts,
and the standing rules. Factual as of the last update; when in doubt, read the source.

## 1. Project summary

Fully-local padel/tennis video analytics MVP (nothing leaves the machine). Upload an MP4 → a
Python engine (YOLOv8s + ByteTrack player tracking) emits a structured time series → stdlib-only
post-hoc analytics derive broadcast-style metrics per calibrated court layout → a single-file React
dashboard shows the intensity chart, detected rallies, court calibration UI, and highlight trimming.

## 2. Layout & data flow

```
python/analyze.py          # inference engine: YOLOv8s + ByteTrack -> analysis.json (meta/segments/frames/playerSummary)
python/metrics.py          # stdlib-only post-hoc analytics: analysis.json + court config -> derived JSON
python/court-defaults.json # default frame size, static wide-shot court rect (fractions), all tunable thresholds
server/server.js           # Express API :3001 — /api/videos upload+list, /api/jobs/:id, GET /api/rallies (filters/sort/pagination); spawns metrics/ffmpeg; serves /data statically
server/lib/analyzeQueue.js # BullMQ producer + worker: spawns analyze.py (concurrency via ANALYZE_CONCURRENCY; bounded retries via ANALYZE_MAX_ATTEMPTS, exponential backoff 5 s base), mirrors job state to MySQL
server/lib/db.js           # mysql2 pool from DATABASE_URL + runMigrations() (auto-applied at boot); npm run migrate
server/migrations/         # ordered .sql migrations, tracked in schema_migrations
web/src/App.jsx            # single-file React dashboard (Vite + Recharts)
data/{uploads,clips,analysis,court}/   # gitignored runtime state only
```

Flow: `POST /api/videos` saves the upload and returns 202 `{jobId}` immediately; a BullMQ worker
(Redis, AOF-persisted) runs `analyze.py` → `data/analysis/<id>.json`, mirroring job state into MySQL
(`videos` + `jobs` tables — source of truth for all API reads). User calibrates the court
(`/api/court`, per-clip override in `data/court/<id>.json`) → `POST /api/analytics` → `metrics.py`
writes `data/analysis/<id>-derived.json`, which the server then mirrors into MySQL (`rallies`,
`intensity_samples`; court saves upsert `calibrations`) and uses to invalidate that video's cached
`reports` rows. One UUID everywhere: `videos.id` = `jobs.id` = BullMQ jobId.

## 3. How to run

Python (inference):

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt   # ultralytics; torch/opencv/numpy arrive transitively
```

Model weights `yolov8s.pt` auto-download on first run (~22 MB, gitignored). CUDA is used
automatically when available, else CPU.

Backend: `cd server && npm ci`, then from repo root `node server/server.js` → listens :3001.
It spawns `$PYTHON_BIN || .venv/bin/python`. `ffmpeg` on PATH is required for `/api/trim-highlight`.

Web dev: `cd web && npm ci && npm run dev` → Vite on :5173, proxying `/api/*` and `/data/*` to :3001.

Docker (Task 06 merged): from a machine with only Docker installed,
`docker compose up --build` → dashboard at http://localhost:8080; optional GPU override via
`docker compose -f docker-compose.yml -f docker-compose.gpu.yml up --build`. See README.md.

## 4. CLI & config contracts

`analyze.py`:

```
python/analyze.py --input <mp4> [--output JSON] [--step N=1] [--model M=yolov8s.pt]
                 [--show] [--out FILE] [--conf F] [--save-frames DIR]
```

Exits 0 on success; exits 1 (stderr) if input missing/unreadable or zero frames decode. Emits per
processed frame: `t`, `frameIndex`, `playerCount`, raw-pixel bbox centers + track IDs,
`intensity`/`meanSpeedPxPerSec` (max player speed px/s), plus shot-boundary segments
(`wide`/`close`) and a per-track `playerSummary`.

`metrics.py`:

```
python/metrics.py --input <analysis.json> --court <config.json> --output <derived.json>
```

All three flags required; stdlib only — no video decoding, no model
inference; deterministic (same inputs → byte-identical output). Exits 1 if input/config lacks
required fields.

Court config keys — current `python/court-defaults.json`:

| Key | Purpose |
|---|---|
| `frameWidthPx` / `frameHeightPx` | reference frame size in px; court fractions are converted against it |
| `court.netX/left/right/top/bottom` | frame-fraction net line + sideline/extents for the default static wide shot |
| `playerMinFramesVisible` (60) | player filter: minimum visible frames a track must have |
| `playerMinMovePerFramePx` (0.5) | player filter: minimum displacement per frame |
| `rallyAbsoluteFloorPxPerSec` (100) | frame is rally-active when max filtered-player speed exceeds this |
| `minRallyDurationSec` (2.0) | drop rallies shorter than this |
| `minGapBetweenRalliesSec` (3.0) | merge active runs separated by gaps ≤ this |
| `netZoneWidthPx` (200) | half-width of the net zone around `netX` |
| `maxPlausibleSpeedPxPerSec` (5000) | transitions faster than this are dropped (ByteTrack id recycling) |

Saved per-clip configs (`data/court/<id>.json`, written by `/api/court`) may additionally carry
optional `court.netY`, `court.leftTilt`, `court.rightTilt`; absent/non-finite tilts degenerate to the
axis-aligned extents rectangle.

Top-level keys — analysis.json: `meta` (sourceFile, model, fps, step, durationSec, processedFrames),
`segments` (`startT/endT/type`), `frames`, `playerSummary`. derived.json: `clip`, `rallies`,
`totals`, `teams` (left/right distance/speed/active/net-zone stats), `quadrantOccupancy`,
`players` (segment-scoped per track, L1/L2/R1/R2 labels), `timeSeries1s`.

## 5. Workflow rules (normative)

- Tickets in `.tasks/` are the normative specs: acceptance criteria plus human-gate items; current
  status lives in `.tasks/reports/`, not here.
- One branch per ticket: `task/NN-slug`. Small conventional commits (`feat:` / `fix:` / `chore:`).
  No direct commits to main.
- Merge back with `git merge --no-ff task/NN-slug` and tag `task-NN-done` only after every
  acceptance checkbox — including human-gate items — passes; delete the branch post-merge.
- Diagnose on real data before writing fix tickets.
- Anti-rot: any ticket that changes a CLI flag, config key, JSON shape, or these workflow rules must
  update this file in the same task.

## 6. Never commit / privacy

`samples/` (real match footage with identifiable people), `data/` (all runtime state), and model
weights (`*.pt`) never enter git — enforced by `.gitignore`. The repo is intended to be public for
recruiters: assume everything tracked is visible to strangers.

## 7. Scope boundaries (Phase 2 — do not implement)

Explicitly out of MVP scope: ball tracking, hit counts per side, In/Out line calls, metric-scale
court coordinates via homography, trained court-keypoint models, pose/swing metrics. Rallies are a
movement-based approximation; no cross-segment ReID is attempted.

## 8. Pointers (no duplication)

- Current status / audit findings → latest report in `.tasks/reports/`.
- Ticket details & acceptance criteria → the tickets themselves (`.tasks/task-NN-*.md`).
- CLI flag tables, Docker quickstart, privacy notes → `README.md`; terminology → `Glossary.md`
  (local-only file).
