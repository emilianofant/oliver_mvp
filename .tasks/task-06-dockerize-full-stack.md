---
# Task 06: Dockerize Full Stack (reproducible public-repo run)

## 1. Goal
Make the entire app reproducible with a single `docker compose up --build` on any machine that has only Docker installed — no host Python, venv, Node, or FFmpeg required — so the public GitHub repo is instantly runnable by a reviewer. CPU works out of the box; GPU passthrough is optional and documented. Lands after Task 05 (full stack must exist first).

## 2. Scope & Target Files
- **Target Files**:
  - `Dockerfile` (repo root — the `server` image: `node:20-slim` base, apt-install `python3 python3-pip ffmpeg`, `pip install -r requirements.txt` (PyPI torch wheels are CUDA-capable on Linux and fall back to CPU automatically), copy `server/` + `python/`, `ENV PYTHON_BIN=python`, `CMD ["node","server/server.js"]`).
  - `docker-compose.yml` — service `server` (build `.`, bind-mount `./data:/app/data`) and service `web` (build `./web`, ports `8080:80`, `depends_on: [server]`); include a commented-out nvidia GPU device block for the server service.
  - `web/Dockerfile` — multi-stage: stage 1 `node:20-alpine` builds the Vite bundle; stage 2 `nginx:alpine` serves `dist/`.
  - `web/nginx.conf` — serve SPA with fallback to index.html; proxy `/api/` and `/data/` → `http://server:3001`.
  - `.dockerignore` — at minimum: `.git`, `.venv`, `samples`, `data`, `*.pt`, `**/node_modules`, `web/dist`, `.tasks`.
  - `README.md` (append-only update — keep the owner's existing prose): "Run with Docker" quickstart (`docker compose up --build` → http://localhost:8080), one-paragraph architecture sketch, optional-GPU note (nvidia-container-toolkit + uncomment device block; engine auto-detects CUDA vs CPU), data/privacy note (`samples/` and `data/` are intentionally untracked — supply your own clips).
- **Untouchable Files**: all application code except exactly ONE permitted tweak in `server/server.js`: the Python interpreter path must come from `process.env.PYTHON_BIN || '<repo>/.venv/bin/python'` (Task 03 already specs this env override — verify, don't restructure). No changes to `python/**`, `web/src/**`, or any API behavior.

## 3. Constraints & Guardrails
- Do NOT restructure the application for Docker's sake: no new frameworks, no queue workers, no healthcheck orchestration beyond compose `depends_on`. Single compose file; no CI/CD, registry push, multi-arch builds, or image optimization passes (torch makes the server image ~2–3 GB — expected and acceptable; note it in README).
- The browser must never talk to the host's local dev servers: all UI→API traffic inside Docker goes web-container → nginx proxy → server container. Local dev mode (venv + `npm run dev` on :5173) from Tasks 01–04 must keep working unchanged alongside Docker.
- No secrets, no env-var config system beyond `PYTHON_BIN`. Keep total new file count to the six listed; nginx.conf and compose stay under ~60 lines each.

## 4. Acceptance Criteria
- [ ] On a machine with only Docker installed (no host python/node/ffmpeg): `docker compose up --build` succeeds and http://localhost:8080 loads the dashboard.
- [ ] Full flow works inside containers, end to end, via the UI on :8080: upload a sample .mp4 → analysis completes in-container → intensity chart renders → generate a highlight clip → trimmed clip plays and downloads (FFmpeg ran in the server container).
- [ ] CPU path verified without any GPU flags: engine runs on torch CPU and the README's no-GPU quickstart is accurate.
- [ ] `git status` shows zero modifications to application code other than the single permitted `PYTHON_BIN` line check; `.dockerignore` prevents any of `.venv/`, `samples/`, `data/`, `*.pt` from entering image builds (`docker build` context clean).
- [ ] README quickstart followed verbatim in a fresh shell reproduces the full flow.
- [ ] Merged into main via `git merge --no-ff task/06-dockerize-full-stack` and tagged `task-06-done` — only after every other checkbox above is checked; branch deleted post-merge.
