# Task 20: Docker Build-Time Device Choice (CPU Default / CUDA Opt-in)

## 1. Goal
The server image today always installs PyPI torch with CUDA wheels (~3.54 GB, ~954 s cold build per the readiness audit) even for pure-CPU users; GPU is only a compose device-mapping over that same fat image. Make the device family an explicit **build-time** choice, defaulting to **CPU**: CPU builds install CPU-only torch (much smaller image, much faster build); CUDA builds keep current behavior and run fp16 on GPU.

## 2. Scope & Target Files
- `Dockerfile` — single file with a build arg (no second Dockerfile):
  - `ARG VARIANT=cpu`. Before installing requirements: cpu variant → `pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu`; cuda variant → plain PyPI default (today's behavior). Then the normal `pip install -r requirements.txt` (ultralytics reuses the already-installed torch).
  - Everything else unchanged: node, ffmpeg, libgl, venv location, workdir.
- `python/analyze.py` — **one line only**: pass `half=True` to the track call when `torch.cuda.is_available()` is true at runtime (restores Task 01's fp16 intent for CUDA builds; CPU path untouched). If the owner vetoes this sub-item on review, no doc may claim fp16 anywhere.
- `docker-compose.gpu.yml` — add `build: args: VARIANT: cuda` so the GPU compose file builds the cuda variant (device mapping unchanged). Default `docker-compose.yml` stays exactly as-is (cpu default, no devices).
- `README.md` — **Docker section lines only** (this ticket owns all docker-specific README content; Task 21 will not touch it): quickstart for both variants (default-CPU one-liner; CUDA = build arg + gpu compose override), honest per-variant expectations with the *measured* image sizes and cold-build times, model auto-download note kept, "GPU is optional" framing kept.

## 3. Constraints & Guardrails
- One Dockerfile + ARG only — no multi-stage rework beyond what's needed; no new services/ports/volumes; `.dockerignore` unchanged (re-verify image contents are still free of `samples/`, host `data/`, `.venv` after the change).
- No analyze.py CLI or output-schema changes; the `half=` line is the only Python edit.
- Do not touch README sections outside Docker/quickstart (Task 21's scope — it runs after this ticket merges and builds on its lines).

## 4. Acceptance Criteria
- [ ] Default `docker compose up --build` from a clean clone: builds, full flow works through :8080 (upload → analytics → trim), image size **and** cold-build time recorded — both materially better than the audited baseline (3.54 GB / 954 s) and written into README as measured numbers.
- [ ] CUDA variant builds: `docker compose -f docker-compose.yml -f docker-compose.gpu.yml up --build` completes with VARIANT=cuda.
- [ ] **HUMAN GATE (owner, GPU machine):** run the sample clip through the GPU stack — confirm torch reports CUDA available inside the container (one-line check or log), detection output sane vs the CPU run (eyeball chart/segments; no NaNs/garbage boxes), and record any fp16 wall-time delta.
- [ ] README Docker section matches what was actually measured for both variants; the stale "~2–3 GB" claim is gone.
- [ ] `git status`: modifications limited to `Dockerfile`, `docker-compose.gpu.yml`, `python/analyze.py` (one line), `README.md`.
- [ ] Merged via `git merge --no-ff task/20-docker-cpu-cuda-build`, tagged `task-20-done` after the human gate passes; branch deleted post-merge.
