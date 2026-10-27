---
# Task 02: Full Analysis Engine (Metrics JSON)

## 1. Goal
Extend the existing `python/analyze.py` to emit the agreed structured JSON time series — per-frame player count, bbox centers with persistent track IDs, intensity in px/s, a per-player summary, and shot-boundary segments for broadcast footage — which downstream tasks consume verbatim. The schema below is normative:

```json
{
  "meta": { "sourceFile": "clip.mp4", "model": "yolov8s.pt", "fps": 30, "step": 1, "durationSec": 29.97, "processedFrames": 900 },
  "segments": [
    { "startT": 0.0, "endT": 74.2, "type": "wide" }
  ],
  "frames": [
    { "t": 0.1, "frameIndex": 3, "playerCount": 2,
      "players": [{ "track_id": 3, "x": 412.5, "y": 388.0 }],
      "intensity": null },
    { "t": 0.2, "frameIndex": 6, "playerCount": 2,
      "players": [{ "track_id": 3, "x": 415.0, "y": 389.5 }],
      "intensity": 745.0, "meanSpeedPxPerSec": 268.4 }
  ],
  "playerSummary": [
    { "track_id": 3, "framesVisible": 142, "totalDistancePx": 18432.6, "maxSpeedPxPerSec": 910.2 }
  ]
}
```

## 2. Scope & Target Files
- **Target Files**: `python/analyze.py` (extend in place — keep Task 01's flags working; add `--output <json>` and `--step <int, default 1>`)
- **Untouchable Files**: `.tasks/**`, `requirements.txt`; no new Python files or modules may be created; do NOT touch server/web code (not created yet).

## 3. Constraints & Guardrails
- Keep the single-file structure: plain functions + main(). No classes, no extra modules, no config system.
- The CLI contract with the backend is FROZEN: `python/analyze.py --input <mp4> --output <json> [--step N] [--model M]`. Exit 0 on success; exit 1 with a stderr message if input is missing or zero frames decode.
- Process every Nth frame (`--step`, default **1** for broadcast footage — denser inference improves track continuity at glass walls and costs ~nothing on GPU; higher values allowed only as quick tests). Timestamps: `t = frameIndex / fps`. Get fps from OpenCV `CAP_PROP_FPS` (fallback 30 if ≤ 0); `durationSec` from cap metadata, falling back to the last decoded t.
- Keep ByteTrack with `persist=True`; use track IDs for cross-frame association. Do NOT implement nearest-neighbor matching or any ID stitching/persistence beyond what the tracker provides.
- **Shot-boundary segments** (needs raw frames — computed in this script only): during the decode pass, compare consecutive raw frames via a cheap histogram difference (e.g., cv2.calcHist on downsampled grayscale, normalized mean-abs-diff; start threshold ~0.15 and tune against real cuts). A frame where the diff exceeds the threshold starts a new segment (frame 0 always starts one). After inference, classify each segment `type`: `"wide"` if its median playerCount ≥ 3, else `"close"`. Emit top-level `segments` covering the full timeline contiguously: first startT = 0, last endT ≈ durationSec, no gaps or overlaps.
- `intensity` (px/s): `dt = step / fps` seconds; for each player visible in both the current and previous processed frame, speed = Euclidean center displacement / dt; intensity = mean of those speeds; `null` on the first processed frame or when no players overlap with the previous one.
- ⚠ **Superseded by Tasks 07 & 08** — the effective rules are: (Task 07) `intensity` is additionally null on the first processed frame of every segment, and association/accumulation never crosses a segment boundary; (Task 08) `intensity` is the MAX per-player speed with gap-tolerant same-segment association (`MAX_GAP_FRAMES`, artifact-capped), the old mean preserved as additive field `meanSpeedPxPerSec`. The rule above describes original pre-fix behavior. See `.tasks/task-07-segment-aware-intensity.md` and `.tasks/task-08-intensity-signal-fix.md`.
- `players[].x/y` are raw-pixel bbox centers (no normalization).
- `playerSummary`: one entry per observed track_id — `framesVisible`, `totalDistancePx` (summed displacement across consecutive processed-frame transitions), `maxSpeedPxPerSec`.
- Do NOT: pose/keypoints, ball/court logic; video writing or frame saving; threading/multiprocessing; retry logic. Do NOT remove or break `--show` — the preview must keep working after this task.
- **Git workflow:** all work on branch `task/02-analysis-engine`; small commits with conventional style (`feat:` / `fix:` / `chore:`); no direct commits to main.

## 4. Acceptance Criteria
- [ ] With Task 01's venv active: `python python/analyze.py --input samples/<clip>.mp4 --output /tmp/a.json`; exits 0 and `/tmp/a.json` parses with `python -m json.tool`.
- [ ] Schema check on the output: all `meta` fields present (`fps > 0`, `step` matches flag); `len(frames) ≈ totalDecodedFrames / step`; `t` strictly increasing; every frame has integer `playerCount ≥ 0`, `players[]` entries with numeric x/y + track_id, and `intensity` number-or-null.
- [ ] Segments: array present, contiguous from t=0 to ≈ durationSec (no gaps/overlaps); each entry has startT < endT and type ∈ {wide, close}; on a clip with known director cuts the segment count roughly matches the visible cut count, and a player-focus shot is flagged `close`.
- [ ] Intensity value check: null only for first-frame/no-overlap frames; on a moving clip most other values > 0. **Owner eyeballs the series against the video: does intensity rise during rallies and drop between points?** (This is the headline metric's keep/drop judgment — record it before Task 05.)
- [ ] `playerSummary` contains one entry per observed track_id with `framesVisible > 0`, `totalDistancePx ≥ 0`; on a clip with visible movement the values are not all zero.
- [ ] Regression: `--show` still opens the annotated window (Task 01 behavior intact); headless run wall time ≤ ~2× clip duration on GPU at step=1.
- [ ] Zero-person input completes cleanly: all frames `playerCount: 0`, `intensity: null`, empty `playerSummary`, segments still emitted, exit 0.
- [ ] Merged into main via `git merge --no-ff task/02-analysis-engine` and tagged `task-02-done` — only after every other checkbox above is checked; branch deleted post-merge.
