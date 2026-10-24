---
# Task 01: YOLOv8s Detection Preview (Sandbox Gate)

## 1. Goal
Stand up the local Python environment and create a minimal `python/analyze.py` — the file that will later become the analysis service — which runs yolov8s + ByteTrack over any MP4 with an optional live annotated OpenCV window, so detection quality can be visually judged on real footage before any metrics code is built. This task deliberately computes NO metrics and writes NO JSON; its only job is to answer "are these boxes good enough?"

## 2. Scope & Target Files
- **Target Files**:
  - `requirements.txt` (create) — exactly one dependency line: `ultralytics>=8.2,<9` (+ a comment). ultralytics pulls torch/opencv/numpy transitively.
  - `.gitignore` (create) — at minimum: `.venv/`, `__pycache__/`, `data/`, `samples/*.mp4`.
  - `python/analyze.py` (create, minimal) — argparse CLI with exactly three flags: `--input <path.mp4>` (required), `--model <name.pt>` (default `yolov8s.pt`), `--show` (store_true). Behavior: load the model once; call `model.track(input, persist=True, show=args.show)` on the file source; iterate the returned Results and print ONE line per frame to stdout in the form `<frameIndex> players=<count> ids=[...]`; on exit print one summary line (frames processed, max simultaneous players, total unique track IDs).
  - `samples/` directory — user drops their own short padel/tennis MP4(s) here for manual testing; no binary files are committed.
- **Untouchable Files**: none exist yet (greenfield repo). Do NOT create `server/`, `web/`, or any Node.js/React scaffolding in this task.

## 3. Constraints & Guardrails
- Single script file, plain functions + main(). No classes, no extra modules, no config system, no logging framework.
- Use only libraries from the ultralytics dependency tree (torch/cv2/numpy arrive transitively). Do NOT add any other package to requirements.txt unless pip resolution breaks.
- NO frame stride/sampling in this task: process every decoded frame so preview playback is smooth. `--step` arrives with metrics in Task 02.
- If a CUDA GPU is available, run inference on it with fp16 (`device=0`, `half=True`) — one conditional, nothing more elaborate.
- Use Ultralytics' default ByteTrack configuration for tracking. Do NOT write custom tracker YAMLs or tune tracker hyperparameters.
- First run auto-downloads the model weights (~22MB) into the ultralytics cache — expected behavior, not a failure.
- Do NOT: pose/keypoints, ball detection, court logic; JSON output; metrics computation; video writing or annotated-frame saving; threading/multiprocessing. Error handling = fail fast only (missing/unreadable file or zero decoded frames → stderr message, exit 1).

## 4. Acceptance Criteria
- [ ] `python3 -m venv .venv && source .venv/bin/activate && pip install -r requirements.txt` succeeds; `python -c "import torch; print(torch.cuda.is_available())"` prints True.
- [ ] A short user-supplied MP4 (~10–60 s) exists in `samples/`.
- [ ] `python python/analyze.py --input samples/<clip>.mp4 --show` opens an OpenCV window playing the video with person boxes + persistent track IDs drawn; exits 0.
- [ ] **HUMAN JUDGMENT GATE — stop here.** The project owner must visually assess box quality on real footage before Task 02 starts (do they reliably find all players? any phantom detections?). If boxes disappoint, the first knob is `--model yolov8m.pt` with zero code changes. Task 02 must not begin until this checkbox has been consciously evaluated and accepted.
- [ ] Headless run without `--show`: prints per-frame lines + exit summary to stdout, exits 0, wall time ≈ real-time (≤ ~1.5× clip duration on GPU).
- [ ] A clip with no people still completes cleanly: all frames `players=0`, exit 0.
