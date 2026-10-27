#!/usr/bin/env python3
"""Task 02 analysis engine: YOLOv8s + ByteTrack player tracking -> metrics JSON.

Decodes the input MP4 with OpenCV and runs persistent ByteTrack detection on every
Nth frame (--step, default 1). Emits the agreed structured time series -- per-frame
player count and raw-pixel bbox centers with track IDs, max per-player speed in px/s
(intensity) plus meanSpeedPxPerSec, a per-player summary -- plus shot-boundary
segments detected by histogram difference between consecutive raw frames.

CLI contract (frozen): analyze.py --input <mp4> --output <json> [--step N] [--model M]
Exits 0 on success; exits 1 with a stderr message if the input is missing or zero
frames decode. Task 01 flags (--show, --out, --conf, --save-frames) keep working.
"""

import argparse
import json
import math
import os
import sys

import cv2
import numpy as np
import torch
from ultralytics import YOLO

PERSON_CLASS_ID = 0  # COCO 'person'
CUT_THRESHOLD = 0.005  # normalized mean-abs histogram diff; tuned on real cuts (in-shot noise <= ~0.001, cut spike >= ~0.015)
HIST_BINS = 64  # grayscale histogram bins for shot-boundary detection
THUMB_SIZE = (32, 32)  # downsample size before histogramting
MAX_GAP_FRAMES = 15  # max processed-frame gap for same-segment track association (~0.5 s at fps=30 / step=1)
MAX_SPEED_PX_PER_SEC = 5000  # transitions implying faster are dropped (ByteTrack id-recycling teleports); far above plausible close-up sprint speeds


def parse_args():
    parser = argparse.ArgumentParser(description="YOLOv8s + ByteTrack player analysis -> metrics JSON")
    parser.add_argument("--input", required=True, help="Path to the input MP4 file")
    parser.add_argument("--model", default="yolov8s.pt", help="Model weights (default: yolov8s.pt)")
    parser.add_argument("--output", default=None, metavar="JSON",
                        help="Write the structured metrics time series to this JSON file")
    parser.add_argument("--step", type=int, default=1, help="Process every Nth frame (default 1)")
    parser.add_argument("--show", action="store_true", help="Open a live annotated OpenCV window")
    parser.add_argument("--out", default=None, help="Also write per-frame lines + summary to this file")
    parser.add_argument("--conf", type=float, default=None,
                        help="Minimum detection confidence (track mode defaults to 0.1; raise it to ignore distant/crowd people)")
    parser.add_argument("--save-frames", dest="save_frames", default=None, metavar="DIR",
                        help="Save every processed frame annotated with the model's detections as JPGs into DIR")
    return parser.parse_args()


def check_input(path):
    """Fail fast on missing or unreadable input files."""
    if not os.path.isfile(path):
        sys.stderr.write(f"error: input file not found: {path}\n")
        sys.exit(1)
    cap = cv2.VideoCapture(path)
    readable = cap.isOpened() and int(cap.get(cv2.CAP_PROP_FRAME_COUNT)) > 0
    cap.release()
    if not readable:
        sys.stderr.write(f"error: could not read video frames from {path}\n")
        sys.exit(1)


def frame_histogram(frame):
    """Normalized grayscale histogram of a downsampled frame (cheap cut signal to detect if scene has changed)."""
    gray = cv2.cvtColor(cv2.resize(frame, THUMB_SIZE, interpolation=cv2.INTER_AREA), cv2.COLOR_BGR2GRAY)
    hist = cv2.calcHist([gray], [0], None, [HIST_BINS], [0, 256]).ravel()
    total = float(hist.sum())
    return hist / total if total > 0 else np.zeros_like(hist)


def player_detections(result):
    """Return [(track_id, cx, cy)] sorted by track ID for person boxes in one frame's Results."""
    boxes = result.boxes
    if boxes is None or boxes.cls is None or getattr(boxes, "id", None) is None:
        return []
    cls = boxes.cls.cpu().numpy()
    ids = boxes.id.cpu().numpy()
    xyxy = boxes.xyxy.cpu().numpy()
    dets = [(int(i), float((b[0] + b[2]) / 2.0), float((b[1] + b[3]) / 2.0))
            for i, c, b in zip(ids, cls, xyxy) if int(c) == PERSON_CLASS_ID]
    dets.sort(key=lambda d: d[0])
    return dets


def median(values):
    """Median of a non-empty list of numbers."""
    s = sorted(values)
    n = len(s)
    return float(s[n // 2]) if n % 2 else (s[n // 2 - 1] + s[n // 2]) / 2.0


def main():
    ## Setup
    args = parse_args()
    check_input(args.input)
    if args.step < 1:
        sys.stderr.write("error: --step must be >= 1\n")
        sys.exit(1)

    model = YOLO(args.model)
    cuda = torch.cuda.is_available()

    out_file = None
    if args.out is not None:
        try:
            out_file = open(args.out, "w")
        except OSError as exc:
            sys.stderr.write(f"error: could not write to {args.out} ({exc.strerror})\n")
            sys.exit(1)

    save_dir = None
    if args.save_frames is not None:
        try:
            os.makedirs(args.save_frames, exist_ok=True)
            save_dir = args.save_frames
        except OSError as exc:
            sys.stderr.write(f"error: could not create {args.save_frames} ({exc.strerror})\n")
            sys.exit(1)

    ## Processing
    cap = cv2.VideoCapture(args.input)
    fps = float(cap.get(cv2.CAP_PROP_FPS))
    if fps <= 0 or math.isnan(fps):
        fps = 30.0  # metadata fallback per spec
    meta_frame_count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))

    dt = args.step / fps  # seconds between consecutive processed frames
    cut_frames = [0]      # decoded-frame indices where a new segment starts (frame 0 always)
    prev_hist = None
    last_seen = {}            # {track_id: [x, y, frameIndex]} within the current segment only (gap-tolerant association)
    pending_new_segment = False  # a segment boundary was crossed since the last processed frame
    summary = {}          # track_id -> [framesVisible, totalDistancePx, maxSpeedPxPerSec]
    frames_out = []       # per-processed-frame JSON entries
    show_window = args.show
    decoded = 0
    max_players = 0
    seen_ids = set()

    while True:
        ok, frame = cap.read()
        if not ok:
            break
        frame_index = decoded

        hist = frame_histogram(frame)
        if prev_hist is not None and float(np.abs(hist - prev_hist).mean()) > CUT_THRESHOLD:
            cut_frames.append(frame_index)  # this frame starts a new segment
            pending_new_segment = True      # first processed frame of the new segment gets null intensity, no cross-cut association
        prev_hist = hist

        if frame_index % args.step == 0:
            results = model.track(
                frame,
                persist=True,
                tracker="bytetrack.yaml",  # Ultralytics' stock ByteTrack config
                conf=args.conf,
                device=0 if cuda else None,
                verbose=args.output is None,  # keep stdout clean in JSON mode
            )
            dets = player_detections(results[0])
            seen_ids.update(i for i, _, _ in dets)
            max_players = max(max_players, len(dets))

            if pending_new_segment:
                # segment boundary crossed since the last processed frame: reset all association state
                # (centers teleport between views; first processed frame of a segment -> null intensity)
                last_seen.clear()
                pending_new_segment = False

            speeds = []
            for tid, x, y in dets:
                st = summary.setdefault(tid, [0, 0.0, 0.0])
                st[0] += 1
                # gap-tolerant association within the current segment: match track_id to its last-seen center
                # up to MAX_GAP_FRAMES processed frames back (dt from the actual gap)
                if tid in last_seen:
                    lx, ly, lf = last_seen[tid]
                    gap = (frame_index - lf) // args.step  # processed frames since last seen
                    if 0 < gap <= MAX_GAP_FRAMES:
                        dist = math.hypot(x - lx, y - ly)
                        speed = dist / (gap * dt)
                        if speed <= MAX_SPEED_PX_PER_SEC:  # drop id-recycling teleports from intensity + summary
                            speeds.append(speed)
                            st[1] += dist
                            st[2] = max(st[2], speed)
                last_seen[tid] = [x, y, frame_index]

            intensity = max(speeds) if speeds else None
            mean_speed = sum(speeds) / len(speeds) if speeds else None
            frames_out.append({
                "t": frame_index / fps,
                "frameIndex": frame_index,
                "playerCount": len(dets),
                "players": [{"track_id": tid, "x": round(x, 2), "y": round(y, 2)} for tid, x, y in dets],
                "intensity": round(intensity, 2) if intensity is not None else None,
                "meanSpeedPxPerSec": round(mean_speed, 2) if mean_speed is not None else None,
            })

            line = f"{frame_index} players={len(dets)} ids={[d[0] for d in dets]}"
            print(line, flush=True)
            if out_file is not None:
                out_file.write(f"{line}\n")
            if save_dir is not None:
                cv2.imwrite(f"{save_dir}/frame-{frame_index:05d}.jpg", results[0].plot(), [cv2.IMWRITE_JPEG_QUALITY, 85])
            if show_window:
                cv2.imshow("players", results[0].plot())
                if cv2.waitKey(1) & 0xFF == ord("q"):
                    cv2.destroyAllWindows()
                    show_window = False

        decoded += 1

    cap.release()

    if decoded == 0:
        if out_file is not None:
            out_file.close()
        sys.stderr.write("error: no frames decoded from input\n")
        sys.exit(1)

    summary_line = f"summary: frames={decoded} max_players={max_players} unique_track_ids={len(seen_ids)}"
    print(summary_line, flush=True)
    if out_file is not None:
        out_file.write(f"{summary_line}\n")
        out_file.close()

    if args.show:
        cv2.destroyAllWindows()

    duration_sec = meta_frame_count / fps if meta_frame_count > 0 else (decoded - 1) / fps
    segments = []
    for k, start in enumerate(cut_frames):
        end = cut_frames[k + 1] if k + 1 < len(cut_frames) else None
        counts = [f["playerCount"] for f in frames_out
                  if start <= f["frameIndex"] and (end is None or f["frameIndex"] < end)]
        segments.append({
            "startT": start / fps,
            "endT": duration_sec if end is None else end / fps,
            "type": "wide" if counts and median(counts) >= 3 else "close",
        })

    meta = {
        "sourceFile": os.path.basename(args.input),
        "model": args.model,
        "fps": round(fps, 3),
        "step": args.step,
        "durationSec": duration_sec,
        "processedFrames": len(frames_out),
    }
    player_summary = [
        {"track_id": tid, "framesVisible": st[0],
         "totalDistancePx": round(st[1], 2), "maxSpeedPxPerSec": round(st[2], 2)}
        for tid, st in sorted(summary.items())
    ]

    if args.output is not None:
        doc = {"meta": meta, "segments": segments, "frames": frames_out, "playerSummary": player_summary}
        try:
            with open(args.output, "w") as f:
                json.dump(doc, f)
        except OSError as exc:
            sys.stderr.write(f"error: could not write to {args.output} ({exc.strerror})\n")
            sys.exit(1)
        print(f"wrote {args.output}: {len(frames_out)} frames, {len(segments)} segments, "
              f"{len(player_summary)} tracks", flush=True)


if __name__ == "__main__":
    main()
