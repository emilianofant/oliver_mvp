# Task 19: Docker Upload Timeout Fix (nginx proxy_read_timeout)

## 1. Goal
Close the only functional defect found by the public-readiness audit (`.tasks/reports/public-readiness-20261028.md`, Area 3): `web/nginx.conf` sets no `proxy_read_timeout` on `/api/`, so nginx's 60 s default applies while `/api/upload` blocks for the *entire* synchronous analysis. Measured: a 46 s clip took **58.96 s** end-to-end via :8080 — any longer clip or slower CPU makes nginx return **504 while analyze.py keeps running**, hanging then erroring the UI on a successful analysis.

## 2. Scope & Target Files
- **Target Files**:
  - `web/nginx.conf` — in `location /api/`: add `proxy_read_timeout 900s;` and `proxy_send_timeout 900s;` (analysis ≈ real-time or slower on CPU; 15 min headroom is deliberate, not magic). Do not touch `client_max_body_size` (512m stays) or any other location.
  - `README.md` — one sentence in the Running/Docker section setting expectations: "On CPU, analysis takes roughly real-time or longer and uploads block until it completes; a large clip may take several minutes." (Exact placement: next to where upload/analysis is first described.)
- **Untouchable Files**: everything else — no `server.js` changes in this ticket (child-process timeout belongs to Task 21's hardening scope), no compose file changes.

## 3. Constraints & Guardrails
- Two files, ~4 lines total. Do not restructure nginx.conf, do not add new locations or gzip/upstreams, do not change the synchronous-spawn design (that tradeoff is documented as-is; a job queue is roadmap, not this ticket).
- Keep the timeout values symmetric for read/send and cite the audit's measured number in a short comment in nginx.conf.

## 4. Acceptance Criteria
- [ ] `docker compose up --build` from the repo; upload a clip longer than 60 s of analysis time (the sample clip at ~59 s already crosses the old limit on CPU — re-measure and record wall-clock) → completes with 200, no 504.
- [ ] Short-clip flow still works end-to-end (upload → analytics → trim through :8080).
- [ ] README sentence present next to the first upload description; wording matches actual behavior (no new promises about speed).
- [ ] `git status`: modifications limited to `web/nginx.conf` and `README.md`.
- [ ] Merged via `git merge --no-ff task/19-docker-upload-timeout`, tagged `task-19-done` after the >60 s upload is proven; branch deleted post-merge.
