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
