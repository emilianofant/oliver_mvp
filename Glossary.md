# Glossary

## Ultralytics

The open-source library this project is built on (`ultralytics>=8.2,<9` in `requirements.txt`). It is the modern successor to the YOLOv5/YOLOv8 repos: one package that bundles model definitions, training/inference engines, dataset handling, and object tracking. This repo uses it for exactly two things — `YOLO("yolov8s.pt")` (load the yolov8s detection weights) and `model.track(...)` (run detection + track association frame by frame), both in `python/analyze.py`. It also pulls in torch, OpenCV, and NumPy transitively, which is why `requirements.txt` has just that one dependency line.

## BYTETracker

A multi-object *tracker* algorithm (Byte Track paper, 2021), shipped inside Ultralytics as the stock config `bytetrack.yaml`. Detection alone gives boxes per frame with no identity; ByteTrack links them across frames so the same player keeps ID `[3]` from frame 0 to 500. How it works: it uses a *low* confidence threshold (internally `conf=0.1`) and splits detections into high/low score groups — high-score boxes are matched first to existing tracks by IoU, then low-score ones fill the gaps; unmatched tracks survive briefly via Kalman-predicted positions instead of dying on a single missed detection. That stability is what makes "unique track IDs" meaningful for the later metrics (Task 02). The persistent `ids=[...]` printed per frame in Task 01 come from it.

Note: ultralytics changed its *default* tracker to TrackTrack in recent versions, so `python/analyze.py` explicitly passes `tracker="bytetrack.yaml"` to keep the pipeline on ByteTrack as specified (the bundled config file is used verbatim — no custom YAML).

## half=True flag

FP16 inference: run the model in 16-bit floating point instead of the default 32-bit (`float32`). It halves memory bandwidth usage and roughly doubles GPU throughput, at negligible accuracy cost for detection. It only makes sense on GPUs (CPU has no fast FP16 path), which is why `python/analyze.py` gates it: `half=cuda` where `cuda = torch.cuda.is_available()`.

Version quirk: in ultralytics 8.4.x the flag name was deprecated and silently remapped to their new unified `quantize=16` scheme (hence the one-time deprecation warning on first run) — functionally identical, still FP16.
