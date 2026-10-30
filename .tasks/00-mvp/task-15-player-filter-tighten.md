[TASK 15 - DONE (PLAYER IDENTIFICATION ISSUE)]
---
# Task 15: Player Filter Tighten v2 (Min-Frame Floor + Trapezoid Inside-Test)

## 1. Goal
After Task 13's per-frame movement floor, the filter over-accepted: the sample clip now yields **47 "players"** — dominated by short-lived ByteTrack flicker fragments over crowd/stands (tracks of 2–41 frames, some with absurd single-frame maxSpeeds) and by people near the glass whose median position falls inside the saved axis-aligned *extents* but outside the actually-drawn tilted trapezoid. Tighten the filter so per-segment survivors are the persistent on-court tracks only, without regressing Task 13's now-correct rally detection.

## 2. Scope & Target Files
- **Target Files** (exactly two):
  - `python/court-defaults.json` — add one key: `"playerMinFramesVisible": 60`. Rationale from the clip data: every real player track has ≥ ~100 wide-segment frames in its segment; every junk fragment has ≤ 47. 60 sits between them and also kills entire degenerate segments (the 6-frame crowd tail produced only 5–6-frame tracks).
  - `python/metrics.py`:
    - **Layer 1 — persistence:** a track is a player iff it passes ALL of: (a) median wide-segment position inside the court, (b) `framesVisible ≥ playerMinFramesVisible`, (c) `totalDisplacement / framesVisible ≥ playerMinMovePerFramePx`. (`framesVisible` = number of accumulated wide-segment positions — already available per track.)
    - **Layer 2 — trapezoid inside-test:** replace the flat extents-rectangle y/x test with a scanline test that consumes the tilt values already saved in `court.leftTilt` / `court.rightTilt`: for median position `(x, y)` as frame fractions, `u = (y − top) / (bottom − top)`; point is inside iff `top ≤ y ≤ bottom` **and** `lx(u) ≤ x ≤ rx(u)` where
      ```
      lx(u) = left  + |leftTilt|/2  + leftTilt * (u − 0.5)
      rx(u) = right − |rightTilt|/2 + rightTilt * (u − 0.5)
      ```
      (identical depth-interpolation the dashboard overlay already uses to draw the lines — cite it in a comment). If `leftTilt`/`rightTilt` are absent or non-finite → fall back to today's extents rectangle (backward compatibility; no error).
    - `check_config`: validate the new key (number ≥ 0); docstring criterion 3 updated to describe all three conditions.
- **Untouchable Files**: `python/analyze.py`, `server/**`, `web/**`, `.tasks/**`. Inside metrics.py: do NOT touch rally detection, team/quadrant/timeSeries code paths — they consume the filtered set and must change only as a consequence of it.

## 3. Constraints & Guardrails
- Do not change any other threshold (`playerMinMovePerFramePx` stays 0.5; rally params stay at Task 13 values). The frame floor, not speed, is what kills fragments — do not re-tune the movement floor as a workaround for geometry leaks or vice versa; both layers are required and independent.
- No new config keys beyond `playerMinFramesVisible`; no output-shape changes (same JSON fields); no ReID / cross-segment logic.
- Rally windows WILL shift slightly because per-frame rally intensity is the max over *filtered* players — junk-track spikes (e.g., the 2851 px/s crowd-tail spike that stretched P3 to 45.77 s) must stop contributing. That is intended, not a regression; acceptance below pins where windows may and may not move.

## 4. Acceptance Criteria
- [ ] On the sample clip (re-run via dashboard after any court re-save): `onCourtPlayerCount` drops from 47 to **≤ 20**, and `players[]` contains **no** track with `framesVisible < playerMinFramesVisible`.
- [ ] Segment sanity: the degenerate crowd-tail segment contributes **zero** players; per wide segment survivors are plausible on-court personnel (owner eyeballs each surviving label vs video and records real-vs-sideline count; if a persistent non-player remains, remedy is tightening the drawn court/tilts in the UI — not code).
- [ ] **Rally gate (no regression):** still exactly 3 rallies within ±2 s of ground truth ≈[1–12.3], ≈[13.4–18.8], ≈[~22–42.x]; P2 present ≥ 3 s; P3 unsplit — and its `endT` moves back toward ~42–43 (the crowd-tail extension to 45.77 must be gone).
- [ ] Team stats de-contaminated: `teams.*.maxSpeedPxPerSec` no longer contains crowd spikes (≤ the per-player max of surviving tracks); `netZoneTimePct` values drop from ~78–88 % into a plausible band; owner eyeballs vs video.
- [ ] Back-compat check: running with a config lacking tilt keys produces the same filtered set as today's extents-rect logic (no crash, no behavior surprise).
- [ ] `git status`: modifications limited to `python/metrics.py` and `python/court-defaults.json`.
- [ ] Merged into main via `git merge --no-ff task/15-player-filter-tighten`, tagged `task-15-done` only after every checkbox above passes; branch deleted post-merge.
