# UPL-02: Retry Cap with Exponential Backoff (Bonus) — DONE

## 1. Goal
Turn the analyze job from single-attempt into a bounded-retry job: failures requeue automatically up to an env-configurable cap with exponential backoff, terminal `failed` only after the last attempt. This is the challenge's optional "reintentos con límite" bonus — small by construction (UPL-01 shaped the event handlers for exactly this diff).

Depends on **UPL-01**. Same branch (`challenge/from-mvp-to-service`), own small commits.

## 2. Scope & Target Files
- `server/lib/analyzeQueue.js` — job options: `attempts: Number(process.env.ANALYZE_MAX_ATTEMPTS ?? 3)`, `backoff: { type: 'exponential', delay: 5000 }`; event handlers updated so a non-final failure does NOT mark the mirror terminal.
- `docker-compose.yml` — expose `ANALYZE_MAX_ATTEMPTS` (default unset → 3). Env name pinned here for REP-05's `.env.example`.

**Mirror status semantics during retries (keep within the spec's four states):**
- attempt start → `processing`, `attempts = n`
- failure with attempts remaining → back to **`queued`**, keep the last error tail in `error` (message prefixed with which attempt failed), so the API never invents a fifth state
- final failure → `failed` (+`finished_at`)

## 3. Constraints & Guardrails
- No schema change (`attempts`, `status`, `error` columns already exist from UPL-01).
- Success path must be byte-for-byte unchanged in behavior (a good job never retries).
- Backoff base delay fixed at 5 s — do not add more env knobs than the one specified.
- No changes to worker concurrency logic, endpoints, or frontend.

## 4. Acceptance Criteria
- [x] Broken `.mp4` with defaults: attempts climb 1 → 2 → 3 (visible via `GET /api/jobs/:id` between retries), gaps between attempts visibly grow (~5 s then ~10 s), terminal `failed` after attempt 3 with the last error tail intact.
- [x] Between retries, status reads `queued` with `attempts ≥ 2` and a non-empty `error` naming the failed attempt — never `failed`, never stuck in `processing`.
- [x] `ANALYZE_MAX_ATTEMPTS=1` reproduces UPL-01 behavior exactly (immediate terminal failure).
- [x] A healthy upload still goes queued → processing → done with `attempts = 1` and zero retries.

## 5. HUMAN GATE (owner runs personally before this ticket is closed)
1. Upload a broken `.mp4`; poll the job every few seconds: watch it bounce failed→queued→processing across three attempts with growing pauses, ending `failed`.
2. Set `ANALYZE_MAX_ATTEMPTS=1`, restart server, repeat → single attempt, terminal immediately.
3. Upload a real small clip → done on attempt 1, no retry traces (`attempts = 1`).
