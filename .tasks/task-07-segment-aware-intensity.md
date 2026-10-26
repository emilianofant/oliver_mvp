---
# Task 07: Segment-Aware Intensity & Highlight Picking (Cut-Spike Fix)

## 1. Goal
Eliminate the spurious intensity spikes produced at camera cuts and stop the highlight picker from selecting close-up/cut artifacts, by making both the engine's frame association and the dashboard's peak-picking segment-aware. **This ticket supersedes Task 02's intensity rule:** `intensity` is additionally null on the first processed frame of *every* segment, and per-player displacement (and `playerSummary` accumulation) never crosses a segment boundary — because track IDs persist across cuts while bbox centers teleport between views, producing fake several-thousand-px/s "speeds" with zero real motion.

## 2. Scope & Target Files
- **Target Files**:
  - `python/analyze.py` — extend the existing association logic with a segment gate (few lines; NO schema change: keys/shapes of `meta`, `segments`, `frames[]`, `playerSummary` unchanged)
  - `web/src/App.jsx` — restrict "Auto-select strongest spike" to wide segments + shade close segments on the chart (changes confined to this file)
- **Untouchable Files**: `server/**` (no API contract change), `.tasks/**`, `requirements.txt`, all other files in `web/`. Task 05 is not started yet — nothing of it exists to break.

## 3. Constraints & Guardrails
- Engine change is minimal and surgical, reusing the boundary frame indices already computed for the `segments` output: (a) first processed frame of each segment → `intensity: null`; (b) when computing per-player speed, match a track_id to the previous processed frame ONLY if both frames belong to the same segment; (c) `playerSummary.totalDistancePx` / `maxSpeedPxPerSec` accumulate only same-segment transitions. No new CLI flags, no new JSON keys, no restructuring.
- Do NOT rescale or drop intensity values inside close segments — raw data stays as-is; consumers decide what to use. Do NOT change the `--step 1` default or tracker configuration in this ticket.
- Dashboard changes confined to App.jsx: auto-select computes candidate windows from wide segments only (from `analysis.segments`), each window fully contained within a single wide segment, still maximizing mean non-null intensity over the existing 5 s constant; add one `<ReferenceArea>` per **close** segment with subtle neutral shading visually distinct from the highlight-window shade. No new dependencies, no component extraction, keep the single AreaChart + tooltip behavior.
- Stale data: analysis JSONs generated before this fix are invalid — clear `data/` (gitignored local state) and regenerate via fresh UI uploads; do NOT patch or migrate old JSON files.
- Do NOT touch trim-endpoint usage, upload flow, or video player behavior in this ticket.
- **Git workflow:** all work on branch `task/07-segment-aware-intensity`; small commits with conventional style (`fix:` / `feat:`); no direct commits to main.

## 4. Acceptance Criteria
- [ ] Engine: re-run analysis on the clip with known cuts (same sample used before the fix); new JSON parses with `python -m json.tool` and has byte-compatible schema keys with Task 02's normative schema (no added/removed fields).
- [ ] Boundary check: for every segment in `segments[]`, the first processed frame at/after its startT has `intensity: null`; intensity values near cuts are no longer several-thousand-px/s spikes (eyeball vs. typical rally magnitudes — the previously flagged camera change must no longer produce a spike).
- [ ] Dashboard: close segments visibly shaded on the chart; "Auto-select strongest spike" now returns a window fully contained in one wide segment (verify against `analysis.segments`: picked start/end inside a single wide range) and does not land on the previously mis-flagged cut.
- [ ] Trim accuracy spot-check (regression for "highlights off"): manually set start/end via playhead buttons at two known moments, generate clips, verify each clip begins/ends at the expected moment (±1 frame). If a clip is still offset after this fix, STOP and report — that is a separate bug outside this ticket.
- [ ] Full flow re-test with `data/` cleared: fresh UI upload → chart renders with shaded close segments → auto-select sane → trim plays correctly end to end.
- [ ] `git status` shows zero modifications under `server/`, `.tasks/`, and no JSON schema change in the diff of any emitted field shape.
- [ ] Merged into main via `git merge --no-ff task/07-segment-aware-intensity` and tagged `task-07-done` — only after every other checkbox above is checked; branch deleted post-merge.
