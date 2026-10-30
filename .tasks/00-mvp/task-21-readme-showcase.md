# Task 21: README Showcase Rewrite (Close Readiness Area-6 FAILs)

## 1. Goal
Rewrite `README.md` so a skimming recruiter and a cloning senior both get the full story in one screen — closing every readiness-audit area-6 item (missing pitch/demo evidence, missing "Design decisions & tradeoffs", missing "Where I'd take it next", stale CLI table/Layout block). Screenshots are **owner-supplied** (they capture them); this ticket defines the exact slots. No code changes anywhere.

**Prereq:** Task 20 merged — its Docker/quickstart lines and measured size numbers in README are the base; this ticket does not edit docker-specific lines or size figures.

## 2. Scope & Target Files
- **Target Files**: `README.md` (section rewrites, keep what's already accurate) + an `assets/` directory for the two owner screenshots.
- **Untouchable Files**: all code; `AGENTS.md` (must stay consistent — cross-check after rewrite); `.tasks/**`; `Glossary.md` stays gitignored and local-only — no README link to it, no un-ignore.

## 3. Content Spec (normative)
1. **Pitch + demo** at the top: ≤5 lines on what the product does end-to-end, one stack line, then two owner screenshots with one-line captions: `assets/dashboard.png` (full dashboard: chart with rally bands + selection window + generated clip) and `assets/calibration.png` (court overlay being dragged over a wide shot). The ticket may be tagged done only after the owner has committed both files — no broken image refs in a public clone.
2. **Architecture & data flow**: 5–10 lines on the product pipeline upload → analyze.py JSON → per-clip court calibration → metrics.py derived JSON → dashboard; keep the existing good service/proxying paragraph.
3. **Quickstart fixes (non-Docker parts only)**: add `--output` and `--step` rows to the CLI Arguments table; one-line pointer to AGENTS.md §3 for local development without Docker (closes the two area-1 WARNs that live in non-Docker lines).
4. **"Design decisions & tradeoffs"** (~1 page — the interview section): SPA vs SSR + when it would flip; synchronous spawn vs job queue (cite the measured 59 s upload / nginx read-timeout incident as the concrete motivator); **build-time CPU/CUDA choice with default CPU** and why (image size/build time), including fp16-on-CUDA if Task 20 restored it; frame-fraction trapezoid court calibration vs homography/learned keypoints (deferred per AGENTS.md §7); movement-based rally detection limits.
5. **"Where I'd take it next"** — four areas, each with a concrete first step: frontend polish (extract `CourtOverlay`/chart into modules; per-panel loading/error states); backend scalability & infra (in-process job queue for the analyze spawn with progress polling — structurally fixes the 504 class); testing (**planned**, not shipped: golden-file determinism test for `metrics.py` + endpoint guard tests + CI — see the task-23 ticket); deeper analytics (stay inside AGENTS.md §7 scope: shot-zone heatmap from existing quadrant data, team distance/speed trend panels; then Phase-2 ball tracking).
6. **Honesty/caveats** (folded into the relevant sections): rally windows are a movement-based approximation and may include post-point play until the camera cut (owner-confirmed behavior); player labels are per-segment ByteTrack IDs that can swap at glass walls — no cross-cut ReID; keep the model auto-download note.
7. **Layout block fixed**: add `server/`, `web/`, `Dockerfile` + compose files, `scripts/` to the tree listing.

## 4. Constraints & Guardrails
- Docs only: zero code changes in this ticket. Keep README under ~250 lines total — it's a showcase doc, not a manual; details live in AGENTS.md (link it).
- No new files besides the two named `assets/` images (owner-supplied); do not un-ignore or commit Glossary.md.
- Every factual claim must match current code/config at write time (verify ports, flags, config keys against sources); no capability claims beyond what's shipped (no ball tracking, hit counts, in/out calls).

## 5. Acceptance Criteria
- [ ] Pitch + both screenshot slots present; owner has committed `assets/dashboard.png` and `assets/calibration.png` before the done tag (**HUMAN GATE** — a public clone must have zero broken image refs).
- [ ] "Design decisions & tradeoffs" covers all five listed choices, including the CPU/CUDA build choice as Task 20 left it.
- [ ] "Where I'd take it next" has four areas each with a concrete first step; testing is phrased as *planned* (task-23), not shipped.
- [ ] Stale bits fixed: `--output`/`--step` rows present, layout block complete, local-dev pointer added, both caveats present in README.
- [ ] AGENTS.md §4 contracts still match reality after the rewrite (spot-check ports/flags); no README↔AGENTS.md contradiction introduced.
- [ ] `git status`: only `README.md` modified + `assets/` images added; zero code changes.
- [ ] Merged via `git merge --no-ff task/21-readme-showcase`, tagged `task-21-done` after the screenshot gate passes; branch deleted post-merge.
