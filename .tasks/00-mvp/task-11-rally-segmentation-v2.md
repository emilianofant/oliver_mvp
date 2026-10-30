[TASK 11 - DONE (13)]
---
# Task 11: Rally Segmentation v2 (Players-Only Series + Retuned Hysteresis)

## 1. Goal
Fix the three rally defects proven on the ground-truth clip so the same video yields exactly three windows matching owner adjudication: (a) P2 (~13.4–18.8s, a quiet point with activity ~118–229 px/s) was missed because `rallyAbsoluteFloorPxPerSec=200` sat above its entire band; (b) P3 was split into two windows by a 2.8 s in-rally dip at t≈26–28 because `minGapBetweenRalliesSec=1.0` is too small to bridge it; (c) segmentation ran on the unfiltered intensity series, so bystander motion counts as rally evidence.

## 2. Scope & Target Files
- **Target Files**: `python/metrics.py` (segmentation function + its config keys only) and `python/court-defaults.json` (the three rally threshold values).
- **Untouchable Files**: `python/analyze.py`, `server/**`, `web/**`, `.tasks/**`, and — after Task 10 lands — metrics.py's trapezoid geometry/player filter (Task 10's output is the input this ticket consumes; do not re-tune them here).

## 3. Constraints & Guardrails
- **Ordering fix (the core change):** compute the player filter first, build a per-frame players-only max-speed series from filtered tracks' center displacements within each wide segment (consecutive processed frames, dt = step/fps), and threshold THAT series. Crowd/cameraman motion can no longer create or extend a rally window.
- Config values v2 (rationale in key names; JSON has no comments): `rallyFloorPxPerSec: 100` (was 200 — must sit below quiet-point bands ~120–230 and above standing-figure noise), `minGapBetweenRalliesSec: 3.0` (was 1.0 — bridges observed in-rally dips of ~2.8 s; safe because segmentation is per-wide-segment and each wide segment ≈ one point, so a larger gap cannot merge two real points that live in separate segments), `minRallyDurationSec: 2.0` (was 0.8 — kills flash artifacts without threatening the 5.4 s P2 window).
- Segmentation stays per-wide-segment exactly as Task 05 spec'd; no cross-segment merging, no new output keys in derived JSON (`rallies[]`, `totals` shapes unchanged — `activeTimePct` simply recomputes from the corrected windows).
- Do NOT touch `timeSeries1s` (the dashboard chart keeps showing the raw headline intensity), do not add players-only fields to the output, and no changes to Task 08's analyze.py semantics.

## 4. Acceptance Criteria
- [ ] Prereq: Task 10 merged; ground-truth clip calibrated in the UI and its analysis.json regenerated/fresh on disk.
- [ ] **The spec:** running metrics with the calibrated court file on this exact clip produces exactly **3** rallies, each within ±2 s of owner ground truth: ≈[1–12.3], ≈[13.4–18.8], ≈[22–42.x] — and no window outside those spans (no spurious).
- [ ] P2 present with `durationSec ≥ 3`; the t≈26–28 dip no longer splits P3 (single continuous window).
- [ ] Isolation check: `players[]`, `teams`, `quadrantOccupancy` byte-identical to the Task 10 run on the same inputs (this ticket changes rally windows only).
- [ ] Sanity on a second clip (any other sample available): rally count/durations plausible vs owner eyeball — if a new failure mode appears, record it; do not chase beyond this clip's ground truth in this ticket.
- [ ] `git status` shows zero modifications outside `python/metrics.py` and `python/court-defaults.json`.
- [ ] Merged into main via `git merge --no-ff task/11-rally-segmentation-v2` and tagged `task-11-done` — only after every other checkbox above is checked; branch deleted post-merge.
