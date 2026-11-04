---
# Task 00: Git Bootstrap & Baseline (run before Task 02)

## 1. Goal
Initialize git on this repo with the validated Task 01 state as a clean baseline commit on `main`, harden `.gitignore` so no personal media, model binaries, venvs, or generated data can ever be tracked — the precondition for publishing this repo publicly — and fix the branch-per-task workflow that all later tickets follow.

## 2. Scope & Target Files
- **Target Files**:
  - Repo-level git setup only: `git init` (default branch `main`) + baseline commit + tag. No new source files.
  - `.gitignore` (audit the Task 01 version, append any missing entries). Required entries at minimum: `.venv/`, `data/`, `samples/`, `*.mp4`, `*.pt`, `__pycache__/`, `*.swp`, `server/node_modules/`, `web/node_modules/`, `web/dist/`.
- **Untouchable Files**: all code/docs — `python/**`, `README.md`, `Glossary.md`, `requirements.txt`, `.tasks/**` are committed exactly as-is, zero rewrites. No git hooks, no CI config, no remote setup in this task (remote is added by the owner later).

## 3. Constraints & Guardrails
- **Privacy is a hard rule:** `samples/` contains real match footage with identifiable people; `data/` holds derived analysis of it; `yolov8s.pt` is a large binary that will be re-downloaded at runtime. None of these may ever appear in git history — the public GitHub remote must never see them.
- ZERO code changes in this task: git + `.gitignore` only. If `.gitignore` already covers an entry, leave it; do not reformat or reorder existing lines.
- Baseline commit message: `chore: baseline — task 01 detection preview (validated)`. Tag the commit `task-01-done`.
- **Branch workflow (normative for all tickets):** one branch per ticket named `task/NN-slug` (e.g., `task/02-analysis-engine`); small commits with conventional style (`feat:` / `fix:` / `chore:`); no direct commits to main; merge back with `git merge --no-ff task/NN-slug` and tag `task/NN-done` only after every acceptance checkbox of that ticket is checked; delete the branch post-merge.

## 4. Acceptance Criteria
- [ ] Repo initialized on branch `main`; exactly one baseline commit containing `python/`, `requirements.txt`, `.tasks/`, `README.md`, `Glossary.md`, `.gitignore` — and nothing else tracked.
- [ ] Tag `task-01-done` points at the baseline commit.
- [ ] Ignore audit passes: `git check-ignore -q .venv data samples yolov8s.pt server/node_modules web/dist __pycache__` (exit 0 for each path).
- [ ] `git ls-files | grep -Ei '\.(mp4|pt)$|^data/|^samples/'` returns nothing; `git status --porcelain` is empty.
- [ ] Working tree still runs: with the venv active, `python python/analyze.py --input samples/<clip>.mp4 --show` behaves exactly as before (no functional change from this task).
