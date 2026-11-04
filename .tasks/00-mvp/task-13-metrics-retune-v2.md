[TASK 13 - DONE]
---
# Task 13: Metrics Retune v2 (Per-Frame Player Floor + Rally Thresholds)

## 1. Goal
Apply the long-deferred Python-side fixes from Tasks 10/11 so rally detection matches owner ground truth on the sample clip: P2 (~13.4–18.8 s, a quiet point whose players moved only ~250–460 px total) must be detected, and P3's in-rally dip at t≈26–28 (a 2.8 s gap) must not split the window. The current on-disk output shows rallies `[1.2–12.3] [22.4–25.6] [28.4–42.2]` — P2 missing, P3 fragmented; that is the baseline this ticket fixes.

## 2. Scope & Target Files
- **Target Files** (exactly two):
  - `python/court-defaults.json`:
    - replace `"playerMinTotalDisplacementPx": 1000` with `"playerMinMovePerFramePx": 0.5` — a quiet-point player still moves ≥ ~1.5 px/frame; standing figures stay ≤ ~0.3 (per the clip's track table), so 0.5 separates cleanly and is independent of segment length
    - `rallyAbsoluteFloorPxPerSec`: 200 → **100** (quiet-point activity band runs ~120–230)
    - `minRallyDurationSec`: 0.8 → **2.0** (kills flash artifacts; P2's window is ~5 s so it survives)
    - `minGapBetweenRalliesSec`: 1.0 → **3.0** (bridges the observed 2.8 s in-rally dip; safe because segmentation is per-wide-segment, each wide segment ≈ one point)
    - `netZoneWidthPx`: 60 → **200** (60 px ≈ one person's bbox at 1920×1080 — the old value made net-zone stats meaningless)
  - `python/metrics.py`:
    - Player filter: a track is a player iff its median wide-segment position lies inside the court extents **AND** `totalDisplacement / framesVisible ≥ playerMinMovePerFramePx` (framesVisible = number of wide-segment positions already accumulated per track — no new data structures). Remove the absolute-total test.
    - `check_config`: rename the required key accordingly; docstring lines describing criterion 3 must match the new behavior.
- **Untouchable Files**: `python/analyze.py`, `server/server.js`, `web/**`, `.tasks/**` — and inside metrics.py, only the filter + config validation change: rally detection logic (`detect_rallies`), teams/quadrants/players/timeSeries code paths stay untouched (they already consume the filtered-player series).

## 3. Constraints & Guardrails
- Config format compatibility: `POST /api/court` builds saved files from `court-defaults.json`, so any court re-saved from the UI after this ticket carries the new keys automatically. The four pre-existing `data/court/*.json` files contain the old key and must **fail fast** with metrics.py's existing clear error message — no migration code, no dual-key fallback; the user remedy is one click of "Save court config" in the dashboard.
- Keep the inside-test as-is (axis-aligned extents rect). Do NOT add trapezoid/scanline geometry in this ticket — it is a possible later refinement if bystanders leak on other footage, not needed to hit ground truth here.
- No changes to `detect_rallies` algorithm, no new output fields, no changes to any JSON shape — only the filter criterion and config values move.

## 4. Acceptance Criteria
- [ ] Old-format court file rejection verified: running analytics against a clip whose saved court predates this ticket fails with the clear missing-field error; re-saving that court from the UI makes it work (this is the intended flow, not a bug).
- [ ] **Ground-truth gate (the spec):** on the sample clip, via the dashboard Run-analytics button, exactly **3** rallies, each within ±2 s of owner ground truth ≈[1–12.3], ≈[13.4–18.8], ≈[~22–42.x]; P2 present with `durationSec ≥ 3`; P3 is a single continuous window (no split at t≈26–28); no window outside those spans.
- [ ] Player filter improvement verifiable: `players[]` now includes far-side tracks previously dropped by the 1000 px absolute threshold (e.g., the ~900 px total-move track in segment 6); owner eyeballs vs video and records per-segment counts; if a bystander leaks in, remedy is tightening the drawn court, not code.
- [ ] `totals` consistent with the new windows (`rallyCount: 3`, `activeTimePct` recomputed from them).
- [ ] `git status`: modifications limited to `python/metrics.py` and `python/court-defaults.json`.
- [ ] Merged into main via `git merge --no-ff task/13-metrics-retune-v2`, tagged `task-13-done` only after the ground-truth gate passes; branch deleted post-merge.
