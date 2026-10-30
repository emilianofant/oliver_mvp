# Task 18: Public-Readiness & Good-Practices Audit (Job-Application Showcase, Report Only)

## 1. Goal
After Docker (Task 06) is merged and the repo is intended to be published as a public job-application showcase for a **full-stack senior** role, validate that good practices are actually in place — from the perspective of the people who will judge it: skimming recruiters and interviewing seniors who may clone and run it. This ticket is executed by a coder agent whose **only output artifact is one report file**: no fixes, no rewrites, no commits except adding the report. It runs as the final gate immediately before publishing (and can be re-run anytime; results are date-stamped).

**Prereq:** `task-06-done` tag exists (Docker must exist to validate it). Ideally Tasks 15–17 are also settled so in-flight work isn't flagged.

## 2. Scope & Target Files
- **Target File** (the only file created): `.tasks/reports/public-readiness-YYYYMMDD.md`.
- **Read-only inputs**: whole repo incl. git history, `README.md`, `AGENTS.md`, `Glossary.md`, root strays (`test.py`, `scripts/`), Docker files, `server/server.js`, `web/**`, `python/**`, `.gitignore`, lockfiles.
- **Untouchable Files**: everything except the report — no code/config/doc edits, even trivial ones (fixes become their own small tickets from the findings).

## 3. Audit Areas & Normative Checks
The report must cover these areas; every check gets `PASS / WARN / FAIL` + concrete evidence + suggested fix with effort size (S/M/L):

1. **Cold-start experience** — simulate a reviewer: clean clone → documented commands → working demo. Verify README instructions are exact and current (ports, paths, model-download-on-first-run behavior, CPU default + GPU optional). Record the real wall-clock time from `docker compose up` to first usable page; if any step needs local knowledge not in docs, FAIL it.
2. **Privacy & history hygiene** — verify by *history*, not just `.gitignore`: `git log --all` / `git ls-files` scan proving nothing under `samples/`, `data/`, or `*.pt` was ever committed (a file deleted now but present in history still ships when the repo is made public). Flag any large binaries, absolute local paths (`/home/emiliano/...`) or personal names in code/docs/comments.
3. **Docker validation** — clean build from clone: image builds without host-side deps; `.dockerignore` effective (image contents contain no `node_modules`, `.venv`, `samples/`, `data/`); CPU path works out of the box; GPU is documented as optional, not required.
4. **Security review at stated scope** — single-user local tool: audit every file-touching endpoint for path-traversal guards (basename patterns) and input validation; check upload size limits exist (multer `limits`), static `/data` exposure is deliberate + documented, no secrets/keys anywhere in repo or images, CORS/proxy consistent. Verdict per finding + one-line fix each.
5. **Code-quality signals** — what a senior sees first: file-size hot spots (`server.js`, `App.jsx`, `metrics.py`) with an honest "fine for MVP / would split when X" note; error-handling consistency across endpoints; dead or confusing artifacts at root (`test.py`? `Glossary.md` purpose? `scripts/` contents?) — recommend keep/delete/relocate per item.
6. **Docs & interview readiness** — README must contain (verify presence + quality, not just existence): 60-second pitch with demo evidence; architecture overview + data flow; quickstart matching area 1; **"Design decisions & tradeoffs"** section covering at least: SPA-vs-SSR choice and when it would flip, synchronous-spawn vs job-queue for analysis, heuristic court calibration vs learned detection, movement-based rally detection limits; **"Where I'd take it next"** structured as the four iteration areas (frontend polish / backend scalability & infra / testing strategy / deeper analytics) each with a concrete first step. `AGENTS.md` consistent with reality; domain glossary reachable from README.
7. **Analytics honesty check** — derived metrics are heuristics: verify docs/README state what is approximate (rally segmentation, player identity) so claims never overstate capability (overclaiming is the biggest credibility risk in a technical showcase).

## 4. Constraints & Guardrails
- **Read-only mandate** (same standard as Task 16): may read everything and run verification commands/builds; must not modify any tracked file; the report is the single deliverable (gitignored runtime artifacts from builds/verification runs are acceptable, nothing else).
- Judge against **MVP framing**: a missing test suite or monolithic files is `WARN` with a tradeoff note, never `FAIL` — but undocumented behavior, broken cold-start, privacy leaks in history, and overclaimed capability are `FAIL`.
- Suggested fixes stay within the project's known direction (no "rewrite in TypeScript", no new frameworks); effort sizes must be honest so the owner can sequence follow-up tickets.

## 5. Acceptance Criteria
- [ ] Report exists at `.tasks/reports/public-readiness-YYYYMMDD.md` covering all seven areas, every check marked with evidence and PASS/WARN/FAIL.
- [ ] Cold-start was actually executed from a clean clone (report records measured steps + timing), not just read-from-docs inference; Docker build verified including image-content privacy check.
- [ ] History scan result is explicit: either "clean" or the exact offending commits/paths.
- [ ] README verdict lists each required section present/missing, and the four iteration areas are each rated with a concrete first step (this feeds the owner's interview positioning).
- [ ] Findings end in an ordered **top-actions list** (each: fix + effort S/M/L) suitable for turning into small follow-up tickets.
- [ ] `git status` after the run: only the new report added — zero other modifications.
- [ ] Owner reviews; merged via `git merge --no-ff task/18-public-readiness-audit`, tagged `task-18-done`, branch deleted. **Repo stays unpublished until every FAIL is closed by its follow-up ticket.**
