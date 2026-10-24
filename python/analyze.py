#!/usr/bin/env python3
"""Task 01 sandbox gate: YOLOv8s + ByteTrack player-detection preview.

Runs the model over every decoded frame of an MP4 and prints one line per
frame (`<frameIndex> players=<count> ids=[...]`) plus a final summary line,
optionally with a live annotated OpenCV window (--show). No metrics, no JSON:
this script exists only to answer "are these boxes good enough?".
"""

import argparse
import os
import sys

import cv2
import torch
from ultralytics import YOLO

PERSON_CLASS_ID = 0  # COCO 'person'


def parse_args():
    parser = argparse.ArgumentParser(description="YOLOv8s + ByteTrack player-detection preview")
    parser.add_argument("--input", required=True, help="Path to the input MP4 file")
    parser.add_argument("--model", default="yolov8s.pt", help="Model weights (default: yolov8s.pt)")
    parser.add_argument("--show", action="store_true", help="Open a live annotated OpenCV window")
    parser.add_argument("--out", default=None, help="Also write per-frame lines + summary to this file")
    parser.add_argument("--conf", type=float, default=None,
                        help="Minimum detection confidence (track mode defaults to 0.1; raise it to ignore distant/crowd people)")
    parser.add_argument("--save-frames", dest="save_frames", default=None, metavar="DIR",
                        help="Save every frame annotated with the model's detections as JPGs into DIR")
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


def player_stats(result):
    """Return (player_count, track_ids) for one frame's Results."""
    boxes = result.boxes
    if boxes is None or boxes.cls is None or getattr(boxes, "id", None) is None:
        return 0, []
    mask = boxes.cls.cpu().numpy() == PERSON_CLASS_ID
    ids = [int(i) for i in boxes.id[mask].cpu().tolist()]
    return int(mask.sum()), ids


def main():
    args = parse_args()
    check_input(args.input)

    model = YOLO(args.model)
    cuda = torch.cuda.is_available()
    results = model.track(
        args.input,
        persist=True,
        show=args.show,
        tracker="bytetrack.yaml",  # Ultralytics' stock ByteTrack config
        conf=args.conf,
        device=0 if cuda else None,
        half=cuda,
    )

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

    frames = 0
    max_players = 0
    seen_ids = set()
    for frame_index, result in enumerate(results):
        count, ids = player_stats(result)
        line = f"{frame_index} players={count} ids={ids}"
        print(line, flush=True)
        if out_file is not None:
            out_file.write(f"{line}\n")
        if save_dir is not None:
            cv2.imwrite(f"{save_dir}/frame-{frame_index:05d}.jpg", result.plot(), [cv2.IMWRITE_JPEG_QUALITY, 85])
        frames += 1
        max_players = max(max_players, count)
        seen_ids.update(ids)

    if frames == 0:
        if out_file is not None:
            out_file.close()
        sys.stderr.write("error: no frames decoded from input\n")
        sys.exit(1)

    summary = f"summary: frames={frames} max_players={max_players} unique_track_ids={len(seen_ids)}"
    print(summary, flush=True)
    if out_file is not None:
        out_file.write(f"{summary}\n")
        out_file.close()


if __name__ == "__main__":
    main()
