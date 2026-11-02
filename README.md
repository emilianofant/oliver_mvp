# oliver_video

Padel/tennis video player-detection project.

## Setup (one-time)

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt        # ultralytics pulls torch/opencv/numpy in
```

With a CUDA GPU present, inference automatically runs on `device=0` with FP16; otherwise it
falls back to CPU. First run auto-downloads the model weights (~22 MB) into the repo root —
expected, not an error (the file is gitignored). Tracking uses Ultralytics' stock ByteTrack
config (`bytetrack.yaml`, bundled with ultralytics); no custom tracker files are involved.

## Running

```bash
python python/analyze.py --input samples/<clip>.mp4 [options]
```

Drop your own short padel/tennis MP4(s) into `samples/` (binaries there are gitignored).

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
- `players` = number of COCO "person" boxes in that frame (any person — players **and** crowd;
  no court/player logic at this stage).
- `ids` = persistent ByteTrack track IDs of those persons.

### Exit codes

| Code | Meaning |
|---|---|
| `0` | Success (a clip with zero people is still a success: all frames `players=0`). |
| `1` | Input file missing/unreadable, or the video yielded zero decoded frames (message on stderr). |

## Layout

```
requirements.txt      # single dependency: ultralytics
python/analyze.py     # the standalone preview script (Task 01)
samples/              # your test MP4s go here (gitignored)
data/                 # runtime artifacts: --out files, saved frames (gitignored)
.tasks/               # project task tickets
```

## Run with Docker

The whole stack runs from a single command on any machine that has only Docker installed —
no host Python, venv, Node, or FFmpeg needed:

```bash
docker compose up --build
# then open http://localhost:8080
```

Upload an .mp4 in the dashboard and the full flow (analysis → intensity chart → highlight
clip) runs inside the containers. CPU works out of the box; expect the `server` image to be
~2–3 GB because it bundles a CUDA-capable PyTorch wheel.
On CPU, analysis takes roughly real-time or longer; the upload returns immediately with a job ID
(`POST /api/videos` → 202) and a background worker runs the analysis — poll `GET /api/jobs/<id>`
or `GET /api/videos` for status. A large clip may take several minutes.

**Architecture sketch.** Two services: `web` is an nginx container that serves the built Vite/React
dashboard on port 80 (published as :8080) and reverse-proxies `/api/*` and `/data/*` to the `server`
service, so all UI→API traffic stays inside the compose network. `server` runs the Node/Express API
(`node:20-slim` + apt python3 + ffmpeg); it spawns `python3 python/analyze.py` (YOLOv8s + ByteTrack)
for uploads and `ffmpeg` for highlight trimming, with all runtime artifacts in a named Docker volume
mounted at `/app/data` (inspect via `docker cp oliver_video-data:/app/data .`).
The engine auto-detects CUDA vs CPU at runtime.

**Fresh start.** To wipe everything (DB, queue, uploads/analysis) and rebuild from scratch:
`docker compose down -v && docker compose up --build`. Migrations re-apply automatically at boot.

**Optional GPU.** To run inference on a GPU: install [nvidia-container-toolkit](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/install-guide.html)
on the host, then start with the GPU override file merged in:

```bash
docker compose -f docker-compose.yml -f docker-compose.gpu.yml up --build
```

Without it (the default) no device is exposed and the engine runs on CPU. With a visible CUDA
device the engine uses it (FP16); without one it falls back to CPU automatically — no other change needed.

**Data & privacy.** `samples/` and `data/` are intentionally untracked: upload your own clips,
everything stays local, and nothing is ever sent outside your machine. The model weights (~22 MB)
auto-download into the server container on first analysis if not present.

## Volume dataset & EXPLAIN

The rally query path in `GET /api/rallies` was designed for real data that never exists at scale:
the domain ceiling is measured, ~122 rallies per full match (see `docs/seed-dataset-spec.md`, §4),
so even a large library of matches only yields tens of thousands of rally rows. To exercise the
API and its indexes at volume without fabricating unrealistic data, `server/scripts/seed.js` fills
the database with a **deterministic synthetic dataset** (fixed PRNG seed — identical structure,
ids and rally rows on every run; only absolute timestamps anchor to run time) whose row volume
comes from one intensity sample per second per video (~970k rows), not from padded rallies.
Seeded videos have no media files: their `videoUrl` 404s by design, and px/s values are
frame-resolution-dependent, same caveat as real analysis output.

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

**Danger, by design:** `--fresh` TRUNCATEs all six tables — real uploads and their analysis data
included. That is the point of a clean volume dataset. Without the flag the script refuses to run
if `videos` is non-empty and prints these instructions instead. Seeding ~1M rows takes seconds.

### Expected row counts (spec §4, worked at exactly 200 videos = 150 match / 30 clip / 20 summary)

| Table | Formula | Worked example |
|---|---|---|
| `intensity_samples` | Σ videos × E[duration] ≈ n_match·6300 + n_clip·105 + n_summary·1050 | 150×6300 + 30×105 + 20×1050 ≈ **~970k** |
| `rallies` | (n_match − 3)·≈122 + n_clip·E[U{1..6}] + n_summary·(1050/21.5) | 147×122 + 30×3.5 + ~977 ≈ **~19k** |

Plus exactly one `done` row per video in `jobs`, ~60 % of videos in `calibrations`, and zero rows
in `reports` until report generation fills them. The seed prints actual counts for all six tables
and exits non-zero if `intensity_samples` < 500,000.

### Canonical query & EXPLAIN

The dashboard's filtered rally browser (e.g. "longest-intensity rallies") hits:

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

Actual `EXPLAIN` against the seeded database (19,067 rally rows; dev credentials from
docker-compose.yml), captured via:

```bash
docker compose exec db mysql -uoliver -poliver_dev_password oliver
```


| id | select_type | table | type | possible_keys | key | key_len | ref | rows | filtered | Extra |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | SIMPLE | r | ALL | idx_rallies_video_start | NULL | NULL | NULL | 19032 | 33.33 | Using where; Using filesort |
| 1 | SIMPLE | v | eq_ref | PRIMARY | PRIMARY | 144 | oliver.r.video_id | 1 | 100.00 | NULL |

### Why the indexes are what they are

`rallies(video_id, start_s)` serves the dashboard's per-video rally list — equality on `video_id`
plus chronological order — as a pure index scan with no sort, and keeps per-video lookups/counts
cheap for any video. `videos(created_at)` serves the landing table's `ORDER BY created_at DESC` and the
date-window filters (`date_from`/`date_to`) on this endpoint. There is deliberately **no** index
per sort dimension (`peak_intensity`, `duration_s`, …): the rallies table is domain-capped at ~19k
rows — that number follows from ~122 points per match, not from a row-count target (spec §4) — so
the full scan plus filesort above touches only ~19k narrow rows and costs single-digit milliseconds.
That `type=ALL` + `Using filesort` line in the EXPLAIN is expected at this scale, not a defect; an
index per sort column would buy micro-seconds while paying write amplification on every derived-data
mirror insert. The honest limit: if rallies ever grew into the millions (they can't, given the
domain ceiling), the plan for unindexed sort/filter columns is to add one composite index per
actual query pattern — not a generic index zoo.
