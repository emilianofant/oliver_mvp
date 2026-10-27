---
# Task 08: Intensity Signal Fix (Max Headline + Gap-Tolerant Association)

## 1. Goal
Recover the activity contrast on wide shots. The diagnostic baseline (pre-fix, same clip) confirmed a real signal — rally window mean 287.6 px/s vs dead-time 60.1 (~4.8×), percentiles p50=51 / p90=139 / p99≈1112 at fps=30 — that the current pipeline visually buries for two reasons: (a) **mean aggregation** dilutes a sprinter among static partners, and (b) **consecutive-frame-only association** drops blurred sprint transitions exactly when players are fastest. Two bounded engine changes: redefine headline `intensity` as the MAX per-player speed of the frame (old mean kept in a new additive field), and make association gap-tolerant within a segment so multi-frame detection dropouts still contribute with dt from the actual gap.

Frame entry shape after this task (additive only):
```json
{ "t": 12.34, "frameIndex": 370, "playerCount": 4, "players": [ { "track_id": 3, "x": 412.5, "y": 388.0 } ],
  "intensity": 745.0, "meanSpeedPxPerSec": 268.4 }
```

## 2. Scope & Target Files
- **Target Files**: `python/analyze.py` only (association block + intensity aggregation + two named constants at the top of the script).
- **Untouchable Files**: `server/**`, `web/**` (the dashboard reads `intensity` and benefits automatically — zero UI changes this task), `.tasks/**`, `requirements.txt`. No new files, no schema keys removed or renamed.

## 3. Constraints & Guardrails
- **Gap-tolerant association spec:** within the current segment only, keep each track_id's last-seen `{center, frameIndex}` for up to K frames; when the id reappears with gap `g = 1..K` processed frames in the same segment, compute speed = Euclidean center displacement / `(g * step/fps)`. Reset all last-seen state at every segment boundary (Task 07's rule stands: first processed frame of a segment → `intensity: null`; nothing crosses boundaries). Default `MAX_GAP_FRAMES = 15` (≈0.5 s at 30 fps / step 1).
- **Artifact cap:** exclude any single transition implying speed > `MAX_SPEED_PX_PER_SEC = 5000` from aggregation (guards against ByteTrack id-recycling teleports; deliberately set far above plausible close-up sprint speeds ~3–4k so real data is never clipped). Both constants live at the top of the script — tuning means editing one number, no config system.
- `intensity` = MAX over all valid per-player speeds in the frame (null when none); new field `meanSpeedPxPerSec` = MEAN over the same set (null likewise) preserving the old semantics for comparison. `playerSummary.totalDistancePx` / `maxSpeedPxPerSec` accumulate from the same gap-tolerant, capped, same-segment transitions; `framesVisible` unchanged.
- Do NOT change: CLI flags, step default, tracker configuration, segment detection/classification, `--show` behavior, or any JSON key other than adding `meanSpeedPxPerSec`. No new dependencies.

## 4. Acceptance Criteria
- [ ] Re-run on the same clip used for the baseline; output parses with `python -m json.tool`; every frame has both `intensity` and `meanSpeedPxPerSec` (number-or-null); all other keys unchanged in name/shape.
- [ ] Re-run the planning diagnostic snippet and compare against the recorded baseline (p50=51, p90=139, p99≈1112; rally 287.6 vs dead 60.1): rally/dead separation ≥ 4× still holds on `intensity`, AND a known rally window now shows an elevated plateau (owner eyeball: sustained band during play, near-baseline between points — no longer sparse needles over flat).
- [ ] Cap property: `max(intensity across all frames) ≤ MAX_SPEED_PX_PER_SEC`; segment-boundary regression holds — first processed frame of every segment is still null.
- [ ] Fresh UI flow with `data/` cleared: upload → chart (unchanged code) visibly more contrasty than the pre-fix curve, auto-select strongest spike still lands inside a wide segment on real action.
- [ ] Regression: `--show` intact; headless wall time ≤ ~2× clip duration at step=1.
- [ ] `git status` shows zero modifications outside `python/analyze.py`.
- [ ] Merged into main via `git merge --no-ff task/08-intensity-signal-fix` and tagged `task-08-done` — only after every other checkbox above is checked; branch deleted post-merge.
