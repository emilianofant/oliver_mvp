---
# Task 05: Broadcast-Aware Analytics (Derived Metrics)

## 1. Goal
Add a post-hoc script that reads a finished Task 02 `analysis.json` plus a static court config and emits one derived-metrics JSON implementing the target metric list below. Zero model inference — pure computation over already-saved data, so metrics can be iterated, tuned, and validated without re-running YOLO. This ticket's spec (the metric list with formulas) is normative.

**Metric list (what to build, in order):**
1. **Clip level** — durationSec, fps, model, wideCoveragePct (wide-segment time / total), onCourtPlayerCount (distinct track_ids passing the player filter), detectionCoveragePct (frames ≥ 1 detection). *Solid.*
2. **Rally segmentation** — per wide segment: threshold `intensity` above a baseline (e.g., moving-average + k·std, or absolute px/s floor from config) with minimum gap/length hysteresis → `rallies[] {startT, endT, durationSec, peakIntensityPxPerSec}` + totals {activeTimePct, rallyCount, avgRallyDurSec, longestRallySec}. *Approximate — movement-based, no ball; label as such.*
3. **Player filtering** — a track is a "player" iff (median position inside court rect) AND (total displacement > config threshold). Bystanders (crowd/coach/judge/cameraman) fail one of the two. All metrics 4–7 use filtered players only, restricted to wide segments.
4. **Team assignment + team stats** — side = x < netX ? left : right; per side: totalDistancePx, avgSpeedPxPerSec, maxSpeedPxPerSec, activeFramePct, netZoneTimePct (frames with any player within ±netZoneWidth of netX). *Approx but stable.*
5. **Net aggression** — subsumed in #4 (`netZoneTimePct`); no separate output needed.
6. **Quadrant occupancy** — per team: fraction of active time in each of 4 frame-space quadrants (left/right × top/bottom split at netX and mid-court y). *Solid within segments.*
7. **Per-player stats (segment-scoped)** — per track_id within a wide segment: side, label (L1/L2/R1/R2 by average-x order within its side), framesVisible, totalDistancePx, maxSpeedPxPerSec. *Approximate — ID swaps at glass walls can merge/split players; the UI must show this caveat.*
8. **Chart-ready downsampled series** — 1-second buckets: {t, intensity (moving-avg px/s), playerCount (filtered), leftActivity, rightActivity}. Feeds dashboard charts without shipping raw per-frame arrays to the browser.

```json
{
  "clip": { "durationSec": 300.2, "fps": 30, "model": "yolov8s.pt", "wideCoveragePct": 78.4, "onCourtPlayerCount": 4, "detectionCoveragePct": 96.1 },
  "rallies": [ { "startT": 12.3, "endT": 19.8, "durationSec": 7.5, "peakIntensityPxPerSec": 1450.2 } ],
  "totals": { "activeTimePct": 41.2, "rallyCount": 23, "avgRallyDurSec": 6.1, "longestRallySec": 18.4 },
  "teams": { "left": { "totalDistancePx": 0, "avgSpeedPxPerSec": 0, "maxSpeedPxPerSec": 0, "activeFramePct": 0, "netZoneTimePct": 0 }, "right": { "...": "same" } },
  "quadrantOccupancy": { "left": [ 0.12, 0.30, 0.55, 0.03 ], "right": [ 0.48, 0.10, 0.22, 0.20 ] },
  "players": [ { "track_id": 7, "segmentIndex": 0, "side": "left", "label": "L1", "framesVisible": 612, "totalDistancePx": 48230.5, "maxSpeedPxPerSec": 1620.9 } ],
  "timeSeries1s": [ { "t": 0, "intensity": 120.4, "playerCount": 4, "leftActivity": 60.1, "rightActivity": 75.3 } ]
}
```

## 2. Scope & Target Files
- **Target Files**:
  - `python/metrics.py` (create; CLI: `--input <analysis.json> --court <config.json> --output <derived.json>`; plain functions + main, stdlib only — json/math/os)
  - `python/court-defaults.json` (create; normalized court rect `{netX, left, right, top, bottom}` in frame-fraction coords for the default static wide shot + all tunable thresholds: player movement threshold, rally intensity baseline params, min gap/length, netZoneWidth. Descriptive key names — JSON has no comments.)
- **Untouchable Files**: `python/analyze.py` (read-only input contract), `server/**`, `web/**`, `.tasks/**`.

## 3. Constraints & Guardrails
- NO model inference in this script — it never opens a video and never imports ultralytics/torch/cv2. Input is JSON + config only.
- Deterministic: same inputs → byte-identical output (no randomness, no wall-clock timestamps). Fail fast with a clear stderr message if the input JSON lacks required fields; exit 1.
- All tunables live in `court-defaults.json`, not in code — threshold tuning must require zero code edits. Single script file; no modules/classes beyond what fits naturally (~200–300 lines).
- Court-based metrics (#3–#7) run on **wide segments only**; close segments are counted for coverage but excluded from court geometry math (coordinates aren't comparable across cuts — that is the whole point of segments).
- Per-player labels are scoped to `(segment, side)`; do NOT attempt cross-segment identity matching or any ReID.
- Emit exactly metrics 1–8 as specced. Do NOT add hit counts, ball data, shot-type classification, or anything requiring the court homography (Phase 2). No new pip dependencies — stdlib only.
- **Git workflow:** all work on branch `task/05-broadcast-analytics`; small commits with conventional style (`feat:` / `fix:` / `chore:`); no direct commits to main.

## 4. Acceptance Criteria
- [ ] Prereq: a real clip's `analysis.json` exists (Task 02 passed, including its intensity keep/drop eyeball check) and contains ≥ one wide segment with visible play.
- [ ] `python python/metrics.py --input data/analysis/<id>.json --court python/court-defaults.json --output /tmp/d.json` exits 0; `/tmp/d.json` parses and matches the schema above (all top-level keys present).
- [ ] Internal consistency checks pass: `rallyCount == len(rallies)`; every rally lies inside a wide segment with durationSec > 0; team left+right totalDistancePx ≈ sum of player totalDistancePx (±5%, filtered players only); quadrant values per team sum to ≤ 1.
- [ ] Sanity on real footage: rallies land where points actually happened (owner spot-checks ≥ 3 against the video); `onCourtPlayerCount` is 4–5, not 8+ (bystander filter working).
- [ ] **HUMAN VALIDATION GATE — stop here.** Owner inspects `/tmp/d.json` metric group by metric group against their own viewing of the clip and marks each KEEP or DROP: [ ] #1 clip level [ ] #2 rallies/totals [ ] #4 team stats [ ] #6 quadrant occupancy [ ] #7 per-player [ ] #8 time series. Only KEEP groups get dashboard-display tickets (one small ticket per family). Task 04's existing intensity chart is unaffected by any DROP.
- [ ] `git status` shows zero modifications under `python/analyze.py`, `server/`, `web/`, `.tasks/`.
- [ ] Merged into main via `git merge --no-ff task/05-broadcast-analytics` and tagged `task-05-done` — only after every other checkbox above is checked; branch deleted post-merge.
