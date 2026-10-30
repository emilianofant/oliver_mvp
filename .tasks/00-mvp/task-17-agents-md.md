# Task 17: Create AGENTS.md (Repo Guide for Agents & Contributors)

## 1. Goal
Create a single `AGENTS.md` at the repo root that lets any agent session (or human) working in this repository cold-start without archaeology: what the project is, how to run it, its CLI/JSON contracts, the standing workflow rules, and the hard scope boundaries. It must be factual and current-at-writing — a guide, not marketing copy.

## 2. Scope & Target Files
- **Target File** (only one): `AGENTS.md` at repo root.
- **Untouchable Files**: all code, `.tasks/**`, config files — this task only adds the doc. If a fact needed for the doc is uncertain, verify it in the code first; if still uncertain, omit rather than guess.

## 3. Content Spec (normative sections)
1. **Project summary** — 2–3 sentences: fully-local padel/tennis video analytics MVP; MP4 upload → Python YOLOv8s+ByteTrack engine → derived broadcast metrics → React dashboard with intensity chart, rally detection, court calibration UI, highlight trimming.
2. **Layout & data flow** — tree of `python/` (analyze.py = inference engine; metrics.py = stdlib-only post-hoc analytics; court-defaults.json), `server/server.js` (Express :3001: upload→spawn analyze, /api/analytics→spawn metrics, /api/court, /api/trim-highlight, static `/data`), `web/src/App.jsx` (single-file dashboard, Recharts), and `data/{uploads,clips,analysis,court}` as **gitignored runtime state**. One-line flow: upload → analysis.json → (calibrate court) → derived JSON.
3. **How to run** — venv + requirements for Python; backend via Node (`node server/server.js`, uses `.venv/bin/python` or `PYTHON_BIN`); web dev server with proxy (:5173 → :3001). State the Docker status honestly (Task 06 pending — do not document docker-compose as existing if it isn't merged yet; verify before writing).
4. **CLI & config contracts** — exact flags for `analyze.py` and `metrics.py`; the court-config JSON shape with each key's one-line purpose, **read from the current `court-defaults.json` at write time** (key names change between task revisions — copy reality, not memory); top-level keys of analysis.json and derived.json.
5. **Workflow rules (the important part)** — tickets in `.tasks/` are normative specs with acceptance criteria + human gates; one branch per task (`task/NN-slug`), small conventional commits, no direct main commits, merge `--no-ff` + tag `task-NN-done` only after *every* checkbox including human-gate items passes; diagnose on real data before writing fix tickets; and: **any ticket that changes a CLI flag, config key, JSON shape, or workflow rule must update AGENTS.md in the same task** (anti-rot rule).
6. **Never commit / privacy** — `samples/` (identifiable people), `data/`, model weights (`*.pt`) never enter git; repo is intended to be public for recruiters.
7. **Scope boundaries (Phase 2, do not implement)** — ball tracking, hit counts per side, In/Out line calls, metric-scale court coordinates via homography, trained court-keypoint models, pose/swing metrics: explicitly out of MVP scope. Pointers instead of duplication: "current status" → latest report in `.tasks/reports/`; ticket details → the tickets themselves.
8. **Length guard**: keep the file under ~150 lines; if a section threatens to bloat, link to the source of truth (ticket/config) instead of inlining it.

## 4. Constraints & Guardrails
- Single new file at repo root — no README rewrite, no per-directory docs, no CONTRIBUTING split-up.
- Every statement must be verifiable against the repo as it exists when written (run/read to confirm ports, paths, key names); no aspirational descriptions of features that aren't merged.
- Do not embed fast-changing status (per-task done/not-done) — reference `.tasks/reports/` for that; AGENTS.md describes *how the project works*, not *where it is*.

## 5. Acceptance Criteria
- [ ] `AGENTS.md` exists at root with all eight sections above, under ~150 lines.
- [ ] Spot-check pass: each documented CLI flag / config key / endpoint / port matches the actual code and `court-defaults.json` (verify by reading the sources, not the doc).
- [ ] Workflow section states the branch/merge/tag rule including the human-gate condition, and includes the anti-rot update rule.
- [ ] Privacy and Phase-2 scope sections present verbatim in substance (never-commit list; do-not-implement list).
- [ ] `git status`: only `AGENTS.md` added — nothing else modified.
- [ ] Merged via `git merge --no-ff task/17-agents-md`, tagged `task-17-done` after owner review; branch deleted post-merge.
