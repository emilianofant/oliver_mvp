---
# Task 03: Node Backend API (Upload → Analysis → Trim)

## 1. Goal
Build a single-file Express server that accepts MP4 uploads via multer, synchronously runs the frozen `python/analyze.py` CLI to analyze them, serves uploaded videos and generated clips statically, and trims highlight clips with FFmpeg — implementing exactly the agreed REST contract:
- `POST /api/upload` (multipart field `video`) → `{ id, videoUrl, analysis }` (analysis JSON inlined)
- `POST /api/trim-highlight` (`{ source, start, duration }`) → `{ clipUrl }`

## 2. Scope & Target Files
- **Target Files**:
  - `server/package.json` (create; dependencies: express + multer only)
  - `server/server.js` (create — single file containing both routes and the static mount)
  - `.gitignore` (append-only update: add `server/node_modules/`)
- **Untouchable Files**: `python/**` (the analyze.py CLI contract is frozen — if invocation fails, fix the server side), `requirements.txt`, `.tasks/**`. No frontend files.

## 3. Constraints & Guardrails
- Dependencies exactly express + multer; everything else Node built-ins (`child_process.spawn`, `path`, `crypto.randomUUID`, `fs`). NO database/ORM, job queue, auth, or env-config system beyond the single `PYTHON_BIN` override described below. Port hardcoded to 3001. Ensure `data/uploads`, `data/clips`, `data/analysis` exist at startup (recursive mkdir).
- `POST /api/upload`: fileFilter rejects non-.mp4 with 4xx; multer diskStorage saves to `data/uploads/<uuid>.mp4`; then spawn the Python interpreter — path from env var `PYTHON_BIN` if set, else `<repo>/.venv/bin/python` (the env var exists so Task 06's container can use bare `python`) — with args `python/analyze.py --input <savedPath> --output data/analysis/<id>.json`, wait for exit, read the JSON, respond `{ id, videoUrl: "/data/uploads/<id>.mp4", analysis }`. NO polling/status endpoints — synchronous by design. Non-zero spawn exit → 500 with a stderr tail in the body.
- `POST /api/trim-highlight`: resolve `source` to its basename and require it exists under `data/uploads/` (this is also the path-traversal defense); validate `start ≥ 0` and `duration > 0`; spawn ffmpeg: `-ss <start> -t <duration> -i <src> -c:v libx264 -preset veryfast -crf 28 -c:a aac data/clips/<newUuid>.mp4`; respond `{ clipUrl }`.
- Static serving: one `express.static` mount of `data/` at `/data` (covers uploads + clips). Do NOT add an analysis endpoint or any other routes.
- NO retry logic, no input sanitization beyond the basename check, no streaming/chunked responses. Keep the whole server under ~150 lines.
- **Git workflow:** all work on branch `task/03-node-backend-api`; small commits with conventional style (`feat:` / `fix:` / `chore:`); no direct commits to main.

## 4. Acceptance Criteria
- [ ] Prereqs verified first: `ffmpeg -version` works; Task 02's engine passes on a sample clip (the backend spawns it).
- [ ] `cd server && npm install && node server.js` starts cleanly on :3001.
- [ ] `curl -s -F "video=@samples/<clip>.mp4" http://localhost:3001/api/upload` → 200 with `id`, `videoUrl`, and non-empty `analysis.frames`; `GET <videoUrl>` returns the mp4 bytes (content-type video/mp4).
- [ ] `POST /api/trim-highlight` with `{"source":"<uploaded filename>","start":5,"duration":3}` → 200 `{ clipUrl }`; the clip file exists and plays at ~3 s.
- [ ] Rejection paths: non-.mp4 upload → 4xx; trim with `"source":"../../etc/passwd"` or a nonexistent file → 400 (no traversal).
- [ ] `git status` shows zero modifications under `python/`.
- [ ] Merged into main via `git merge --no-ff task/03-node-backend-api` and tagged `task-03-done` — only after every other checkbox above is checked; branch deleted post-merge.
