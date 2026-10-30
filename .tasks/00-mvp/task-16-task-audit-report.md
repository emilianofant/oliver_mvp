# Task 16: Full Ticket Audit — Verify Every Task's Completion (Report Only)

## 1. Goal
Systematically verify, for **every** ticket in `.tasks/` (task-00 through task-15), whether its acceptance criteria are actually fulfilled by the current state of the repository. This ticket is executed by a coder agent whose **only output artifact is one report file** — no code changes, no ticket edits, no "fixing" anything it finds. The report exists so the owner has a single evidence-based map of what is truly done, partially done, or not started (including workflow compliance: branches/tags).

## 2. Scope & Target Files
- **Target File** (the only file created): `.tasks/reports/task-audit-YYYYMMDD.md` (execution date).
- **Read-only inputs**: all `.tasks/*.md`, `python/analyze.py`, `python/metrics.py`, `python/court-defaults.json`, `server/server.js`, `web/src/App.jsx`, git history (`git log`, `git tag`, branch state), and runtime artifacts in `data/` (court configs, analysis + derived JSON) as evidence.
- **Untouchable Files**: everything except the report — production code, tickets, config, data files must not be modified by this task.

## 3. Report Schema (normative)
The report is one markdown file with:
1. **Summary table** — one row per ticket (00–15): `ID | Title | Status | One-line verdict`. Allowed statuses: `DONE`, `PARTIAL` (list which criteria fail), `NOT_STARTED`, `CANNOT_VERIFY` (say why).
2. **Per-ticket sections**, each with:
   - Acceptance criteria checked, one by one, marked ✅/❌ with **concrete evidence** (file path + line reference for code claims; `git tag task-NN-done` present/absent and merge commit on main via `git log --oneline`; data artifacts inspected, e.g. `data/court/<id>.json` keys or derived JSON values).
   - **Workflow compliance** line: branch-per-task + `--no-ff` merge + tag — compliant / non-compliant (a workflow miss is reported as a finding, not treated as a technical failure).
   - For criteria that are human eyeball gates (e.g., "owner validates detection quality", rally windows vs ground truth): mark `HUMAN_GATE_PENDING` and state exactly what the owner must confirm — do **not** infer it passed.
3. **Cross-cutting findings**: contradictions between tickets and reality (e.g., a ticket's in-file supersession notes vs current code), stale/obsolete tickets, privacy violations (`git status --ignored` / `git log --stat` check that nothing under `samples/`, `data/`, or `*.pt` was ever committed).
4. **Recommended next actions** — ordered list derived strictly from the findings (e.g., remaining tasks in dependency order); no new ideas beyond what tickets already define.

## 4. Constraints & Guardrails
- **Read-only mandate**: the agent may read anything and run verification commands (`git log`, `git tag`, greps, and re-running existing CLIs such as `metrics.py` on *existing* files to confirm CLI contracts), but must not modify any tracked file, must not add dependencies or tooling, and must not create branches/commits of its own code. The report is the single deliverable; if a verification run writes gitignored runtime artifacts under `data/`, that is acceptable — anything else written is a task failure.
- **Judge the ticket as written**, including in-file amendments/supersession notes (e.g., Task 02 was amended by Tasks 07/08). Where two tickets conflict, report the contradiction; do not pick a winner silently.
- **No speculation**: if evidence is missing or ambiguous, the status is `CANNOT_VERIFY` with the reason — never mark ✅ on inference from "the code probably does this".
- Do not edit any ticket to make it look compliant, and do not implement missing acceptance criteria even if trivial (that would be its own task).

## 5. Acceptance Criteria
- [ ] Report exists at `.tasks/reports/task-audit-YYYYMMDD.md` covering **all 16 tickets** (00–15) with the schema above — no ticket omitted or merged into another's section.
- [ ] Every ✅/❌ in the report carries concrete evidence (path + line, tag name, or artifact value); every `CANNOT_VERIFY`/`HUMAN_GATE_PENDING` states what would resolve it.
- [ ] Git workflow compliance checked per task (tag presence + merge commit), and a privacy check confirming no personal media/generated data was ever committed.
- [ ] `git status` after the run: only the new report file is added — zero modifications to any other tracked file, zero new files outside `.tasks/reports/`.
- [ ] Owner reviews the report (human gate); then merged via `git merge --no-ff task/16-task-audit-report`, tagged `task-16-done`, branch deleted.
