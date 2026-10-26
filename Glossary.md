# Glossary

## Ultralytics

The open-source library this project is built on (`ultralytics>=8.2,<9` in `requirements.txt`). It is the modern successor to the YOLOv5/YOLOv8 repos: one package that bundles model definitions, training/inference engines, dataset handling, and object tracking. This repo uses it for exactly two things — `YOLO("yolov8s.pt")` (load the yolov8s detection weights) and `model.track(...)` (run detection + track association frame by frame), both in `python/analyze.py`. It also pulls in torch, OpenCV, and NumPy transitively, which is why `requirements.txt` has just that one dependency line.

## BYTETracker

A multi-object *tracker* algorithm (Byte Track paper, 2021), shipped inside Ultralytics as the stock config `bytetrack.yaml`. Detection alone gives boxes per frame with no identity; ByteTrack links them across frames so the same player keeps ID `[3]` from frame 0 to 500. How it works: it uses a *low* confidence threshold (internally `conf=0.1`) and splits detections into high/low score groups — high-score boxes are matched first to existing tracks by IoU, then low-score ones fill the gaps; unmatched tracks survive briefly via Kalman-predicted positions instead of dying on a single missed detection. That stability is what makes "unique track IDs" meaningful for the later metrics (Task 02). The persistent `ids=[...]` printed per frame in Task 01 come from it.

Note: ultralytics changed its *default* tracker to TrackTrack in recent versions, so `python/analyze.py` explicitly passes `tracker="bytetrack.yaml"` to keep the pipeline on ByteTrack as specified (the bundled config file is used verbatim — no custom YAML).

## half=True flag

FP16 inference: run the model in 16-bit floating point instead of the default 32-bit (`float32`). It halves memory bandwidth usage and roughly doubles GPU throughput, at negligible accuracy cost for detection. It only makes sense on GPUs (CPU has no fast FP16 path), which is why `python/analyze.py` gates it: `half=cuda` where `cuda = torch.cuda.is_available()`.

Version quirk: in ultralytics 8.4.x the flag name was deprecated and silently remapped to their new unified `quantize=16` scheme (hence the one-time deprecation warning on first run) — functionally identical, still FP16.


### Libraries & Variables

- cv2 library: This is OpenCV (Open Source Computer Vision Library). It is the industry standard for real-time computer vision tasks like reading video files, resizing images, converting color spaces (e.g., BGR to Grayscale), and calculating histograms.
- torch library: This is PyTorch, a deep learning framework used to run neural networks. In this script, it's specifically being used to check if a GPU (cuda) is available so the YOLO model can run faster on hardware acceleration.
- PERSON_CLASS_ID = 0: Yes, this refers to the COCO dataset (Common Objects in Context) label mapping. In COCO, index 0 is the class for "person". This tells the script to only care about detecting humans and ignore other objects like balls or cars.

### Histogram & Shot Detection Concepts

- Histogram bin: Imagine a bucket system used to count colors. If you have 256 possible shades of gray (0-255), an "histogram bin" is one of those buckets. A histogram with HIST_BINS = 64 means we are grouping the 256 shades into 64 larger ranges to make calculations faster and more robust.
- Mean-abs histogram: This refers to taking two histograms (one from the current frame, one from the previous) and calculating:
1. The difference between them (hist - prev_hist).
2. The absolute value of those differences (np.abs(...)).
3. The average (mean) of those differences.
It is a mathematical way to measure how much the "color distribution" changed between two frames.

### Thresholds & Noise

- CUT_THRESHOLD = 0.005: This is the sensitivity setting for detecting a camera cut. If the "mean-abs histogram" value exceeds this number, the script assumes a scene change (a cut) has occurred.
- In-shot noise: These are tiny, insignificant changes in pixel values between frames caused by sensor grain, slight lighting fluctuations, or camera shake. The code comments note that these usually result in a difference ≤ 0.001.
- Cut spike: This is a sudden, massive jump in the histogram difference caused by a literal cut in the video (e.g., jumping from a wide shot of a field to a close-up of a player). The code notes these are
typically ≥ 0.015.

### "dets" variable

In computer vision and machine learning programming, dets is a very common industry shorthand for "detections".
When you run an object detection model (like YOLO), it produces a set of "detections"—which are the specific instances of objects found in an image.

- The variable name: It's just a programmer's way of saying: "This list contains all the valid detections we care about."
- In this specific function: dets stores the final, filtered list of people (after we ignored cars/dogs/etc.) and their center coordinates.

So, when you see dets = [...], you can read it as: "The variable dets will hold our processed detections."
