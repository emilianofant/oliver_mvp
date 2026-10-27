#!/usr/bin/env python3
"""Task 05 broadcast-aware analytics: derived metrics over a finished analysis.json.

Post-hoc, pure computation (stdlib only; never opens a video, no model inference).
Reads a Task 02 `analysis.json` plus a static court config (frame-fraction court rect
for the default static wide shot + all tunable thresholds) and emits one JSON with:

1 clip level   - durationSec, fps, model, wideCoveragePct, onCourtPlayerCount, detectionCoveragePct. Solid.
2 rallies      - per wide segment: frames whose max filtered-player speed exceeds an absolute
                 px/s floor (config), merged across gaps <= minGapBetweenRalliesSec, dropping runs
                 shorter than minRallyDurationSec. Approximate: movement-based, no ball tracking.
3 player filter- a track is a "player" iff ALL of: its median position (wide segments) lies inside the drawn
                 court trapezoid (scanline test consuming the saved leftTilt/rightTilt; falls back to the axis-aligned
                 extents rectangle when the tilt keys are absent), it has >= playerMinFramesVisible visible frames,
                 and totalDisplacement / framesVisible >= playerMinMovePerFramePx (framesVisible = wide-segment
                 positions accumulated per track); bystanders (crowd/coach/judge/cameraman) fail one of the three tests.
4 teams        - side = x < netX ? left : right; per-side distance/speed/active-frame/net-zone stats. Approx but stable.
5 net aggression- subsumed in 4 via netZoneTimePct; no separate output.
6 quadrants    - per team, fraction of active time in the four frame-space quadrants split at netX and
                 mid-court y; array order is [leftTop, leftBottom, rightTop, rightBottom]. Solid within segments.
7 per player   - segment-scoped per track_id: side + label (L1/L2/R1/R2 by ascending average-x within its
                 side), framesVisible, totalDistancePx, maxSpeedPxPerSec. Approximate: ByteTrack id swaps at
                 glass walls can merge/split players; the UI must show this caveat. No cross-segment ReID is attempted.
8 time series  - 1-second buckets {t, intensity (boxcar-averaged px/s), playerCount (filtered distinct ids),
                 leftActivity, rightActivity} for chart-ready downsampled output.

Court-based metrics (3-7) run on wide segments only: coordinates are not comparable across cuts, which is
the whole point of segmentation. All tunables live in the court config file; tuning requires zero code edits.
Deterministic: same inputs -> byte-identical output (no randomness, no wall-clock values).

CLI contract: metrics.py --input <analysis.json> --court <config.json> --output <derived.json>
Exits 0 on success; exits 1 with a stderr message if the input JSON or config lacks required fields.
"""

import argparse
import json
import math
import os
import sys


def fail(msg):
    sys.stderr.write(f"error: {msg}\n")
    sys.exit(1)


def parse_args():
    parser = argparse.ArgumentParser(description="Derived broadcast metrics from a finished analysis.json (no model inference)")
    parser.add_argument("--input", required=True, help="Path to the Task 02 analysis JSON")
    parser.add_argument("--court", required=True, help="Path to the court config JSON (rect + thresholds)")
    parser.add_argument("--output", required=True, help="Where to write the derived-metrics JSON")
    return parser.parse_args()


def load_json(path, kind):
    if not os.path.isfile(path):
        fail(f"{kind} file not found: {path}")
    try:
        with open(path) as f:
            doc = json.load(f)
    except (OSError, ValueError) as exc:
        fail(f"could not read {kind} from {path}: {exc}")
    if not isinstance(doc, dict):
        fail(f"{kind} root must be a JSON object: {path}")
    return doc


def check_number(parent_name, obj, key):
    val = obj.get(key)
    if not isinstance(val, (int, float)) or isinstance(val, bool) or math.isnan(val):
        fail(f"missing/invalid required field '{parent_name}.{key}' (number expected)")
    return float(val)


def check_input(doc):
    for key in ("meta", "segments", "frames"):
        if key not in doc:
            fail(f"input JSON lacks required top-level key '{key}'")
    meta = doc["meta"]
    if not isinstance(meta, dict):
        fail("input JSON 'meta' must be an object")
    for key in ("fps", "durationSec"):
        check_number("meta", meta, key)
    if meta.get("model") is None:
        fail("missing/invalid required field 'meta.model' (string expected)")
    fps = float(meta["fps"])
    if fps <= 0:
        fail(f"meta.fps must be > 0 (got {fps})")
    segs = doc["segments"]
    if not isinstance(segs, list):
        fail("input JSON 'segments' must be a list")
    for i, s in enumerate(segs):
        check_number(f"segments[{i}]", s, "startT")
        check_number(f"segments[{i}]", s, "endT")
        if s.get("type") not in ("wide", "close"):
            fail(f"segments[{i}].type must be 'wide' or 'close' (got {s.get('type')!r})")
    frames = doc["frames"]
    if not isinstance(frames, list) or not frames:
        fail("input JSON 'frames' must be a non-empty list")
    for i, fr in enumerate(frames):
        check_number(f"frames[{i}]", fr, "t")
        players = fr.get("players")
        if not isinstance(players, list):
            fail(f"frames[{i}] lacks required field 'players' (list expected)")
        for j, p in enumerate(players):
            check_number(f"frames[{i}].players[{j}]", p, "track_id")
            check_number(f"frames[{i}].players[{j}]", p, "x")
            check_number(f"frames[{i}].players[{j}]", p, "y")


def check_config(cfg):
    for key in ("frameWidthPx", "frameHeightPx"):
        v = check_number("config", cfg, key)
        if v <= 0:
            fail(f"config.{key} must be > 0 (got {v})")
    court = cfg.get("court")
    if not isinstance(court, dict):
        fail("config lacks required object 'court' with keys netX/left/right/top/bottom (frame fractions)")
    for key in ("netX", "left", "right", "top", "bottom"):
        v = check_number("config.court", court, key)
        if not 0 <= v <= 1:
            fail(f"config.court.{key} must be a frame fraction in [0,1] (got {v})")
    if not (court["left"] < court["netX"] < court["right"] and court["top"] < court["bottom"]):
        fail("config.court must satisfy left < netX < right and top < bottom")
    for key in ("playerMinFramesVisible", "playerMinMovePerFramePx",
                "rallyAbsoluteFloorPxPerSec", "minRallyDurationSec",
                "minGapBetweenRalliesSec", "netZoneWidthPx",
                "maxPlausibleSpeedPxPerSec"):
        if check_number("config", cfg, key) < 0:
            fail(f"config.{key} must be >= 0")


def median(values):
    s = sorted(values)
    n = len(s)
    return float(s[n // 2]) if n % 2 else (s[n // 2 - 1] + s[n // 2]) / 2.0


def r2(v):
    return round(float(v), 2)


def detect_rallies(rows, floor, min_len_sec, min_gap_sec):
    """rows: [(t, v_or_None)] in order within one wide segment. Returns rally dicts.

    Active = frame max speed above the absolute px/s floor; inactive gaps <= min_gap_sec merge into
    the surrounding run; runs shorter than min_len_sec (wall-clock) are dropped. Rows never cross a
    segment boundary, so rallies always lie inside their wide segment.
    """
    if len(rows) < 2:
        return []
    dt_frame = rows[1][0] - rows[0][0]
    raw = []
    cur = None
    for i, (t, v) in enumerate(rows):
        active = v is not None and v > floor
        if active and cur is None:
            cur = [i]
        elif not active and cur is not None:
            raw.append(cur)
            cur = None
        elif active:
            cur.append(i)
    if cur:
        raw.append(cur)
    merged = []
    for run in raw:
        if merged and rows[run[0]][0] - rows[merged[-1][-1]][0] <= min_gap_sec + 1e-9:
            merged[-1] = merged[-1] + run
        else:
            merged.append(list(run))
    rallies = []
    for m in merged:
        start_t = rows[m[0]][0]
        end_t = rows[m[-1]][0] + dt_frame
        dur = end_t - start_t
        if dur < min_len_sec:
            continue
        peak = max(rows[i][1] for i in m)
        rallies.append({"startT": r2(start_t), "endT": r2(end_t),
                        "durationSec": r2(dur), "peakIntensityPxPerSec": r2(peak)})
    return rallies


def main():
    args = parse_args()
    doc = load_json(args.input, "analysis")
    cfg = load_json(args.court, "court config")
    check_input(doc)
    check_config(cfg)

    meta = doc["meta"]
    fps = float(meta["fps"])
    duration_sec = float(meta["durationSec"])
    frames = doc["frames"]
    segs = doc["segments"]
    W, H = float(cfg["frameWidthPx"]), float(cfg["frameHeightPx"])
    court = cfg["court"]
    net_x_px = court["netX"] * W
    y_mid_px = (court["top"] + court["bottom"]) / 2.0 * H
    min_move_per_frame_px = float(cfg["playerMinMovePerFramePx"])
    min_frames_visible = float(cfg["playerMinFramesVisible"])
    floor_px_s = float(cfg["rallyAbsoluteFloorPxPerSec"])
    net_zone_px = float(cfg["netZoneWidthPx"])
    speed_cap = float(cfg["maxPlausibleSpeedPxPerSec"])

    # wide segments in time (seconds); frame membership by t, boundaries as emitted by analyze.py
    wide_segs = [(i, float(s["startT"]), float(s["endT"]))
                 for i, s in enumerate(segs) if s.get("type") == "wide"]
    wide_total_sec = sum(e - st for _, st, e in wide_segs)

    # returns the global segments[] index of the wide segment containing time t, else None
    def wide_index_of(t):
        for si, st, en in wide_segs:
            if st <= t < en:
                return si
        return None

    # Pass A: per-track stats over WIDE frames only -> player filter.
    track_xy = {}     # tid -> [xs, ys] of wide-segment positions
    disp_px = {}      # tid -> total displacement (wide segments, same-segment transitions, speed-capped)
    prev_pos, prev_t, prev_k = None, None, None
    for fr in frames:
        t = float(fr["t"])
        pos = {int(p["track_id"]): (float(p["x"]), float(p["y"])) for p in fr["players"]}
        k = wide_index_of(t)
        if k is not None and prev_k == k and prev_t is not None:
            dt_ = t - prev_t
            if dt_ > 0:
                for tid, (x, y) in pos.items():
                    if tid in prev_pos:
                        d = math.hypot(x - prev_pos[tid][0], y - prev_pos[tid][1])
                        if d / dt_ <= speed_cap:
                            disp_px[tid] = disp_px.get(tid, 0.0) + d
        for tid, (x, y) in pos.items():
            if k is not None:
                xy = track_xy.setdefault(tid, [[], []])
                xy[0].append(x)
                xy[1].append(y)
        prev_pos, prev_t, prev_k = pos, t, k

    # Trapezoid inside-test for the filter: same depth interpolation as the dashboard overlay's sideline drawing
    # (web/src/App.jsx CourtOverlay lx()/rx()). Tilt keys absent/non-finite -> 0, which degenerates to the
    # axis-aligned extents rectangle (back-compat).
    def _tilt(v):
        return float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v) else 0.0

    left_tilt = _tilt(court.get("leftTilt"))
    right_tilt = _tilt(court.get("rightTilt"))
    top_f, bot_f = court["top"], court["bottom"]

    def inside_court(xf, yf):
        # xf/yf in frame fractions (x/W, y/H); u is depth fraction, 0 at the far end -> 1 near end.
        if not (top_f <= yf <= bot_f):
            return False
        u = (yf - top_f) / (bot_f - top_f)
        lx_frac = court["left"] + abs(left_tilt) / 2.0 + left_tilt * (u - 0.5)
        rx_frac = court["right"] - abs(right_tilt) / 2.0 + right_tilt * (u - 0.5)
        return lx_frac <= xf <= rx_frac

    player_ids = set()
    for tid, (xs, ys) in track_xy.items():
        mx, my = median(xs), median(ys)
        frames_visible = len(xs)
        if inside_court(mx / W, my / H) \
                and frames_visible >= min_frames_visible \
                and disp_px.get(tid, 0.0) / frames_visible >= min_move_per_frame_px:
            player_ids.add(tid)

    # Pass B: court metrics over wide segments (filtered players only).
    team = {s: {"dist": 0.0, "n_speed": 0, "speed_sum": 0.0, "max_speed": 0.0,
                "active_frames": 0, "net_zone_frames": 0} for s in ("left", "right")}
    occ = {s: [0, 0, 0, 0] for s in ("left", "right")}  # [LT, LB, RT, RB] presence counts per side
    per_player = {}   # (seg_index, tid) -> dict(frames, dist, max_speed, x_sum)
    rally_rows = {k: [] for k, _, _ in wide_segs}
    wide_frames_total = 0
    det_cov_frames = sum(1 for fr in frames
                         if fr.get("playerCount", len(fr["players"])) >= 1)

    buckets_n = max(1, int(math.floor(duration_sec + 1e-9)))
    bucket_wide = [[] for _ in range(buckets_n)]       # per-bucket wide-frame records
    bucket_ids = [set() for _ in range(buckets_n)]     # filtered ids present (any segment)

    prev_pos, prev_t, prev_k = None, None, None
    for fr in frames:
        t = float(fr["t"])
        b = min(int(math.floor(t + 1e-9)), buckets_n - 1)
        pos = {int(p["track_id"]): (float(p["x"]), float(p["y"])) for p in fr["players"]}
        k = wide_index_of(t)
        if k is not None:
            wide_frames_total += 1
            fpos = {tid: xy for tid, xy in pos.items() if tid in player_ids}
            speeds = []
            if prev_k == k and prev_t is not None:
                dt_ = t - prev_t
                if dt_ > 0:
                    for tid, (x, y) in fpos.items():
                        if tid in prev_pos:
                            d = math.hypot(x - prev_pos[tid][0], y - prev_pos[tid][1])
                            v = d / dt_
                            if v <= speed_cap:
                                speeds.append((tid, x, d, v))
            # side presence, net zone, quadrants (per filtered player per frame)
            sides_present = set()
            for tid, (x, y) in fpos.items():
                s = "left" if x < net_x_px else "right"
                sides_present.add(s)
                q = (2 if x >= net_x_px else 0) + (1 if y >= y_mid_px else 0)
                occ[s][q] += 1
                pe = per_player.setdefault((k, tid), {"frames": 0, "dist": 0.0,
                                                      "max_speed": 0.0, "x_sum": 0.0})
                pe["frames"] += 1
                pe["x_sum"] += x
            for s in sides_present:
                team[s]["active_frames"] += 1
            for s in ("left", "right"):
                # a side is in the net zone this frame iff one of its players is within +/- netZoneWidthPx of netX
                if any(abs(x - net_x_px) <= net_zone_px and ((x < net_x_px) == (s == "left"))
                       for x, _ in fpos.values()):
                    team[s]["net_zone_frames"] += 1
            # transitions -> team distance/speed + per-player accumulators
            for tid, x, d, v in speeds:
                s = "left" if x < net_x_px else "right"
                tm = team[s]
                tm["dist"] += d
                tm["n_speed"] += 1
                tm["speed_sum"] += v
                tm["max_speed"] = max(tm["max_speed"], v)
                pe = per_player.setdefault((k, tid), {"frames": 0, "dist": 0.0,
                                                      "max_speed": 0.0, "x_sum": 0.0})
                pe["dist"] += d
                pe["max_speed"] = max(pe["max_speed"], v)
            vmax = max((v for _, _, _, v in speeds), default=None)
            rally_rows[k].append((t, vmax))
            bucket_wide[b].append({"vmax": vmax, "sides": sides_present})
        else:
            prev_pos, prev_t, prev_k = None, None, None
        for tid in pos:
            if tid in player_ids:
                bucket_ids[b].add(tid)
        if k is not None:
            prev_pos, prev_t, prev_k = pos, t, k

    # Rallies per wide segment (movement-based approximation; no ball tracking).
    rallies = []
    for k, _, _ in wide_segs:
        rallies.extend(detect_rallies(rally_rows[k], floor_px_s,
                                     float(cfg["minRallyDurationSec"]),
                                     float(cfg["minGapBetweenRalliesSec"])))

    rally_total_sec = sum(r["durationSec"] for r in rallies)
    totals = {
        "activeTimePct": r2(100.0 * rally_total_sec / wide_total_sec) if wide_total_sec > 0 else 0.0,
        "rallyCount": len(rallies),
        "avgRallyDurSec": r2(sum(r["durationSec"] for r in rallies) / len(rallies)) if rallies else 0.0,
        "longestRallySec": max((r["durationSec"] for r in rallies), default=0.0),
    }

    teams_out = {}
    for s in ("left", "right"):
        tm = team[s]
        denom_frames = wide_frames_total if wide_frames_total > 0 else 1
        teams_out[s] = {
            "totalDistancePx": r2(tm["dist"]),
            "avgSpeedPxPerSec": r2(tm["speed_sum"] / tm["n_speed"]) if tm["n_speed"] else 0.0,
            "maxSpeedPxPerSec": r2(tm["max_speed"]),
            "activeFramePct": r2(100.0 * tm["active_frames"] / denom_frames),
            "netZoneTimePct": r2(100.0 * tm["net_zone_frames"] / denom_frames),
        }

    quadrant_out = {}
    for s in ("left", "right"):
        n = sum(occ[s])
        quadrant_out[s] = [round(c / n, 4) if n else 0.0 for c in occ[s]]

    players_out = []
    grouped = {}
    for (k, tid), pe in per_player.items():
        side = "left" if pe["x_sum"] / pe["frames"] < net_x_px else "right"
        grouped.setdefault((k, side), []).append((tid, pe))
    for (k, side) in sorted(grouped, key=lambda ks: (ks[0], ks[1])):
        # labels by ascending average-x within the side: L1/L2 left-to-right, R1/R2 same order
        members = sorted(grouped[(k, side)], key=lambda tp: tp[1]["x_sum"] / tp[1]["frames"])
        prefix = "L" if side == "left" else "R"
        for rank, (tid, pe) in enumerate(members):
            players_out.append({
                "track_id": tid,
                "segmentIndex": k,
                "side": side,
                "label": f"{prefix}{rank + 1}",
                "framesVisible": pe["frames"],
                "totalDistancePx": r2(pe["dist"]),
                "maxSpeedPxPerSec": r2(pe["max_speed"]),
            })

    series = []
    for b in range(buckets_n):
        wrecs = bucket_wide[b]
        if wrecs:
            vs = [r["vmax"] for r in wrecs if r["vmax"] is not None]
            intensity = r2(sum(vs) / len(vs)) if vs else None
            left_a = 100.0 * sum(1 for r in wrecs if "left" in r["sides"]) / len(wrecs)
            right_a = 100.0 * sum(1 for r in wrecs if "right" in r["sides"]) / len(wrecs)
        else:
            intensity, left_a, right_a = None, None, None
        series.append({
            "t": b,
            "intensity": intensity,
            "playerCount": len(bucket_ids[b]),
            "leftActivity": r2(left_a) if left_a is not None else None,
            "rightActivity": r2(right_a) if right_a is not None else None,
        })

    clip = {
        "durationSec": r2(duration_sec),
        "fps": float(meta["fps"]),
        "model": meta["model"],
        "wideCoveragePct": r2(100.0 * wide_total_sec / duration_sec) if duration_sec > 0 else 0.0,
        "onCourtPlayerCount": len(player_ids),
        "detectionCoveragePct": r2(100.0 * det_cov_frames / len(frames)) if frames else 0.0,
    }

    out = {
        "clip": clip,
        "rallies": rallies,
        "totals": totals,
        "teams": teams_out,
        "quadrantOccupancy": quadrant_out,
        "players": players_out,
        "timeSeries1s": series,
    }

    try:
        with open(args.output, "w") as f:
            json.dump(out, f, indent=2)
            f.write("\n")
    except OSError as exc:
        fail(f"could not write to {args.output} ({exc.strerror})")


if __name__ == "__main__":
    main()
