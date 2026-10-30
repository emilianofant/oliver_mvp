[TASK 10 - DONE (09 + 15 + 13)]
---
# Task 10: Court Model v2 — Perspective Trapezoid + Calibration Upgrade

## 1. Goal
Replace the axis-aligned court rectangle with a perspective trapezoid (four corner points) and upgrade the calibration UI to draw it directly on a grabbed still, because the flat top edge provably excludes far-side players: on the ground-truth clip, exactly one player per side passes the filter in every wide segment, while real player tracks sit at y≈248–281 — above `top=0.28` (302px on 1080p). Also fix the filter's movement criterion: absolute lifetime total (`playerMinTotalDisplacementPx=1000`) fails quiet points where real players moved only 252–464px, so it becomes a per-frame floor.

**Config format v2 (normative; old-format files are rejected with a clear "recalibrate" error, no migration code):**
```json
{
  "frameWidthPx": 1920, "frameHeightPx": 1080,
  "court": {
    "netX": 0.5,
    "corners": [
      { "x": 0.33, "y": 0.19 },   // far-left
      { "x": 0.67, "y": 0.19 },   // far-right
      { "x": 0.92, "y": 0.68 },   // near-right
      { "x": 0.08, "y": 0.68 }    // near-left
    ]
  },
  "playerMinMovePerFramePx": 0.5,
  "netZoneWidthPx": 200
}
```

## 2. Scope & Target Files
- **Target Files**:
  - `python/metrics.py` — geometry + player filter only (point-in-trapezoid test, new movement criterion; rally segmentation code is untouched — that is Task 11)
  - `python/court-defaults.json` — migrate to v2 format: default trapezoid approximating the old rect's coverage (far edge slightly above old top, near edge at/above old bottom), `playerMinMovePerFramePx: 0.5`, `netZoneWidthPx: 200`. Owner will recalibrate via UI; defaults only keep the un-calibrated workflow running.
  - `web/src/App.jsx` — Task 09's calibration panel upgraded from five line-handles to **four draggable corner points + one netX vertical line**, with the trapezoid outline rendered (SVG/canvas stroke through the corners) so it can be visually checked against the visible court lines on the grabbed still.
  - `server/server.js` — update `POST /api/court` validation for the new body shape (corners array: finite, in [0,1]) and file write; keep GET as-is except it now serves v2 files.
- **Untouchable Files**: `python/analyze.py`, `.tasks/**`, all other files in `web/`, and metrics.py's rally segmentation/thresholds (Task 11 owns those).

## 3. Constraints & Guardrails
- Geometry: inside-test = scanline interpolation across the convex quad (at y between far/near edges, court x-range interpolates between the two side corners; outside that y-band → not in court). No homography, no perspective math beyond this — we need an inside/outside test and a mid-court split, not metric coordinates (Phase 2). Store four free corner points; do NOT enforce isosceles symmetry in the data model (a centerline guide in the UI is enough; off-center angles remain representable later).
- Filter criterion v2: track is a player ⟺ median position inside trapezoid AND `totalMove / framesVisible ≥ playerMinMovePerFramePx` (default 0.5 — separates standing figures at ~0.1–0.3 px/frame from real players at ≥1.5, per the ground-truth clip's track table). Remove the old absolute-total key entirely; no dual-threshold fallback.
- Derived metrics adapt minimally: quadrant occupancy splits at netX and trapezoid midY (mean of far/near corner y); team side test unchanged (`x < netX*W`); `netZoneWidthPx` semantics unchanged but default 200 (60 was ~one bbox width at 1080p).
- UI: keep Task 09's grab/save/load flow and the "scrub to a static wide shot" hint; panel text must state the workflow order explicitly — calibrate on the still → save → run metrics with the shown `--court data/court/<name>.json` command. No automatic pipeline wiring (still a separate future task).
- Old-format court files (flat left/right/top/bottom keys) → fail fast with stderr/400 message "config is pre-v2, recalibrate in dashboard" — no silent fallback, no converter.

## 4. Acceptance Criteria
- [ ] `python/court-defaults.json` parses as v2; metrics.py runs on an existing analysis.json unchanged by this ticket (analyze.py untouched).
- [ ] Owner calibrates the ground-truth clip in the UI: grabs a wide still, drags the four corners onto the actual far/near court lines + net line, outline renders live against the frame edges, saves; `data/court/<name>.json` matches v2 shape.
- [ ] Re-run metrics with the calibrated file: `players[]` per wide segment now includes the previously-excluded far-side tracks — owner eyeballs vs video and records the count (expect ≈4 per 2v2 point segment; if a bystander sneaks in, tighten the drawn trapezoid, not the code).
- [ ] Isolation check: `rallies[]`, `totals` are byte-identical to the pre-ticket run on the same inputs (this ticket changes geometry/filter only — rally behavior is Task 11's).
- [ ] Rejection paths: old-format court file → clean error naming v2; POST with corner outside [0,1] or non-finite → 400.
- [ ] Existing dashboard sections unchanged end to end (upload → chart → highlight).
- [ ] `git status` shows zero modifications under `python/analyze.py`, `.tasks/`; no new dependencies anywhere.
- [ ] Merged into main via `git merge --no-ff task/10-court-trapezoid` and tagged `task-10-done` — only after every other checkbox above is checked; branch deleted post-merge.
