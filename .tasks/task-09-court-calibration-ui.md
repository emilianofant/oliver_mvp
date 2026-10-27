---
# Task 09: Court Calibration UI (Per-Video Click-to-Fit)

## 1. Goal
Replace hand-editing court JSON with a dashboard calibration screen: grab one still from the uploaded video, drag five edge handles over the court boundaries, and save a per-video config to `data/court/<name>.json` in exactly the format `python/metrics.py --court <path>` already consumes ({netX, left, right, top, bottom} as frame-fraction coordinates). ML-free "autodetect" UX: human-verified boundaries with ~30 s of effort per camera angle instead of editing JSON.

## 2. Scope & Target Files
- **Target Files**:
  - `web/src/App.jsx` — calibration panel only (frame grab via canvas, draggable handle overlay, save/load). No changes to existing upload/chart/highlight sections' behavior.
  - `server/server.js` — two small endpoints: `POST /api/court` with JSON body `{ source, court: { netX, left, right, top, bottom } }` → basename-resolve + existence check (same guard as trim), validate all values in [0,1] and ordering `left < netX < right`, `top < bottom`, then write `data/court/<source-basename-without-ext>.json` (add `court` to the startup recursive-mkdir list); respond `{ saved: "<path>" }`. And `GET /api/court?file=<basename>` → returns the config JSON or 404.
- **Untouchable Files**: `python/**` (the metrics.py config format is the contract — UI must match it, not vice versa), `.tasks/**`, all other files in `web/`. `.gitignore`: verify `data/` already covers `data/court/` (it does) — add nothing.

## 3. Constraints & Guardrails
- Data model is fixed to the five axis-aligned values above. Do NOT build a 4-corner/perspective point model or any homography input — the consumers need an axis-aligned rect; YAGNI.
- Frame grab = single `canvas.drawImage(video)` at the current playhead → dataURL rendered in the panel. Handles are plain absolutely-positioned divs with pointer events (no react-draggable, no new dependencies of any kind); positions normalized by image dimensions so saved values are resolution-independent fractions. Client-side: clamp to [0,1], enforce ordering live (disable Save when violated).
- UI hint text on the panel: "Scrub to a static WIDE shot before grabbing." No segment-awareness in this ticket (no auto-jump-to-wide-shot) — that is out of scope.
- Do NOT wire automatic re-runs of metrics.py from the UI. After saving, the panel displays the exact command to run manually (`python python/metrics.py --input data/analysis/<id>.json --court data/court/<name>.json --output /tmp/d.json`). Pipeline wiring is a separate future task.
- Keep new server code under ~30 lines; keep App.jsx additions confined to the calibration panel + its state. No styling beyond default Tailwind utilities.
- **Git workflow:** all work on branch `task/09-court-calibration-ui`; small commits with conventional style (`feat:` / `fix:`); no direct commits to main.

## 4. Acceptance Criteria
- [ ] With backend + dashboard running: open calibration for an uploaded video, scrub to a wide shot, grab → still image renders in the panel; dragging moves all five handles (3 vertical lines: left/net/right; 2 horizontal: top/bottom).
- [ ] Save writes `data/court/<name>.json` with valid JSON, exactly the keys `{netX,left,right,top,bottom}`, values in [0,1] and correctly ordered; `GET /api/court?file=...` returns it; reopening the panel pre-fills saved values.
- [ ] Rejection paths: `POST /api/court` with `left >= netX` (or any out-of-order/out-of-range value) → 400; unknown/missing source file → 400 (traversal blocked as with trim).
- [ ] Round-trip with analytics: run the Task 05 command using the newly saved court file instead of `court-defaults.json` — exits 0 and, on a clip where the defaults were a rough guess, `onCourtPlayerCount` / team stats visibly improve (owner eyeballs vs. video).
- [ ] Existing dashboard sections unchanged: upload → chart → highlight flow still works end to end after this task.
- [ ] `git status` shows zero modifications under `python/`, `.tasks/`; no new dependencies in any package.json.
- [ ] Merged into main via `git merge --no-ff task/09-court-calibration-ui` and tagged `task-09-done` — only after every other checkbox above is checked; branch deleted post-merge.

## 5. Addendum — post-completion changes (owner-directed, supersede this spec where they conflict)

This ticket shipped at tag `task-09-done`; the calibration UI was then reshaped by direct owner request during iteration. The original text above is kept for history. The saved-file contract never changed: the court object still carries exactly `{netX,left,right,top,bottom}` as axis-aligned frame fractions — `python/metrics.py` remains untouched, and extra visual-fit keys in the file are ignored by it (round-trip re-verified exit 0 after each change).

1. **Live video overlay** (merge `4d5cfc4`) — replaced grab-still/canvas flow: handles render as an SVG layer directly on the uploaded `<video>` element; scrub live and drag over the real footage.
2. **Trapezoid fit for broadcast views** (merges `6366b8c` parallelogram → `3de9c52` trapezoid, final) — each sideline has its own slant (`leftTilt` / `rightTilt`, ±0.5 sliders), so converging end-on camera views fit exactly. Supersedes the "no 4-corner/perspective model" guardrail **for visual geometry only**: no perspective data is saved or consumed.
3. **Middle-line depth** (merge `8b15bff`) — the net line drags freely in x and y instead of being locked to mid-depth; custom position persists as `netY` (readout shows `mid` until set).

Visual-fit params persist as extra keys in the saved court object (`leftTilt`, `rightTilt`, `netY`) and pre-fill on reopen. `POST /api/court` accepts them optionally with the same guard style: tilts numeric in [-1,1], `netY` in [0,1]; omitted → key not written.
