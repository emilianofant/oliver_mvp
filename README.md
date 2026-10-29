# oliver_video

Padel/tennis video player-detection project.

## Screenshots
<img width="800" alt="01-ol-main" src="https://github.com/user-attachments/assets/b116b65a-b08f-4adf-80ce-73018c764967" />

<img width="800" alt="02-ol-uploaded" src="https://github.com/user-attachments/assets/83acee5b-5072-44ae-bfde-86b8479b0958" />

<img width="800" alt="03-ol-court" src="https://github.com/user-attachments/assets/bdf75278-cf80-43c2-9f57-19454924598c" />

_18 players in court... niceee_ 😬

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
On CPU, analysis takes roughly real-time or longer and uploads block until it completes;
a large clip may take several minutes.

**Architecture sketch.** Two services: `web` is an nginx container that serves the built Vite/React
dashboard on port 80 (published as :8080) and reverse-proxies `/api/*` and `/data/*` to the `server`
service, so all UI→API traffic stays inside the compose network. `server` runs the Node/Express API
(`node:20-slim` + apt python3 + ffmpeg); it spawns `python3 python/analyze.py` (YOLOv8s + ByteTrack)
for uploads and `ffmpeg` for highlight trimming, with all runtime artifacts in `./data`, bind-mounted
to `/app/data`. The engine auto-detects CUDA vs CPU at runtime.

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
