[TASK 12 - DONE]
---
# Task 12: In-UI Analytics Run ("Run analytics" trigger + minimal results view)

## 1. Goal
Eliminate the manual terminal step after court calibration: add a `POST /api/analytics` endpoint that spawns the existing `metrics.py` on a clip's analysis JSON using its saved court config (or defaults), and a "Run analytics" button in the dashboard whose results render inline — completing the flow **upload → set court boundaries → trigger analysis**, entirely from the UI. This task is **wiring only**: it must not change any metric computation, threshold, or Python code.

## 2. Scope & Target Files
- **Target Files** (exactly two):
  - `server/server.js` — new endpoint:
    ```
    POST /api/analytics   body: { source }        // upload basename, same convention as trim/court routes
    ```
    - Resolve `id = basename(source)` minus extension; `analysisPath = data/analysis/<id>.json` → if missing, 404 with "no analysis for this clip" (clear error, no stack).
    - Court file: use `data/court/<id>.json` if it exists, else `python/court-defaults.json`; record which via response field `courtSource: "saved" | "defaults"`.
    - Spawn with the existing `runCmd` helper (reuse as-is): `[PYTHON_BIN || .venv python] python/metrics.py --input <analysisPath> --court <courtFile> --output data/analysis/<id>-derived.json` — metrics.py's CLI contract is unchanged, no new args.
    - On exit 0: read the derived file back and respond `{ courtSource, derivedPath: "/data/analysis/<id>-derived.json", derived }`. On failure: 500 with the stderr tail (runCmd already provides it).
    - Keep validation style consistent with sibling routes (`path.basename` guard on `source`).
  - `web/src/App.jsx`:
    - New App-level state: `derived`, `analyticsRunning`, `analyticsError`; reset `derived` to null in `handleFile` (new upload invalidates old results).
    - "Run analytics" button rendered at the bottom of the Court calibration section, below `<CourtControls/>`: disabled while uploading or running; spinner text while running; error line on failure.
    - Minimal results block after a successful run: one summary line (`rallies: N · players on court: M · court: saved|defaults`), then one row per rally `formatTime(start) – formatTime(end)`; when `courtSource === "defaults"` add the note "no saved court — using defaults".
    - `IntensityChart` gains an optional `rallies` prop → renders a green `ReferenceArea` band (fillOpacity ~0.25, distinct from the amber selection and grey close-segments) per rally window.
    - **Remove** the manual-command `<pre>` block in `CourtControls` ("Saved. Re-run analytics with this court config:") and its now-unused `savedPath`/`command` state — that terminal step is what this ticket replaces.

## 3. Constraints & Guardrails
- No changes anywhere under `python/` — no new Python code, no changed CLI flags, no threshold edits (those belong to the Tasks 10/11 metrics follow-up).
- No changes to the upload flow: `/api/upload` still runs the engine synchronously exactly as today; analytics is a separate explicit action.
- **No auto-run**: analytics must never trigger on upload or on court-save — only on an explicit button click (deliberate human step, per agreed workflow).
- Display scope is rallies + clip summary ONLY. Do NOT build team/quadrant/per-player panels in this ticket — those wait for the keep/drop gate and their own display tickets.
- Synchronous spawn like every other endpoint; metrics.py is pure post-hoc computation (milliseconds) — no queues, jobs, or polling infrastructure. No new dependencies anywhere.

## 4. Acceptance Criteria
- [ ] Full flow with zero terminal use: upload clip → drag trapezoid + save court → click "Run analytics" → summary line and rally list appear; green rally bands on the chart match the `rallies` windows in the returned JSON (spot-check one window against the video).
- [ ] **Equivalence check (the real correctness gate):** with the same inputs, the UI-run derived output is identical to a manual CLI run of `python python/metrics.py --input data/analysis/<id>.json --court <same file> --output /tmp/x.json` — proving this ticket changed plumbing only, not computation.
- [ ] Fallback path: upload a fresh clip with no saved court file → button still works; response has `courtSource: "defaults"` and the UI shows the defaults note.
- [ ] Error paths render as readable messages in the UI error line (unknown source / missing analysis), consistent with existing endpoint error shapes; server logs follow the `[analytics]` convention used by sibling endpoints.
- [ ] The copy-paste command block is gone from the dashboard (no "Re-run analytics" text anywhere).
- [ ] `git status`: modifications limited to `server/server.js` and `web/src/App.jsx`; nothing under `python/`, `.tasks/`, or other web files touched.
- [ ] Merged into main via `git merge --no-ff task/12-run-analytics-ui`, tagged `task-12-done` only after every checkbox above passes; branch deleted post-merge.
