# REP-07: Docs & Delivery Wrap-up (README, .env.example, Cold Start)

## 1. Goal
Make the branch publish-ready for its PR against main: the README challenge section their §7 checklist demands, `.env.example`, a verified cold start with MySQL+Redis included, and links to the two design docs — closing the challenge's "criterio y comunicación" surface in one ticket.

Prereq: REP-01…REP-06 all merged and human-gated. Branch `challenge/from-mvp-to-service`, conventional commits. After this ticket passes its gate → tag **`v0.2.0`** and mark the PR ready.

## 2. Scope & Target Files
- `README.md` — new challenge section (keep it skimmable; link out to docs for depth):
  - How to run: `docker compose up --build`, migrations auto-run at boot, `npm run migrate` / `npm run seed --fresh` for dev use.
  - **Queue choice & why** (BullMQ + Redis with AOF vs a plain MySQL jobs table — the trade-off paragraph they explicitly asked for).
  - **AI model & why**: `gemini-2.5-flash`, free tier, structured output; what exactly leaves the machine (derived numeric metrics only — no footage, not even filenames) + one line on Google's free-tier data handling; "if the free tier changes, swap one constant" note (no fallback implemented by decision).
  - Design decisions & trade-offs list: index-based model references + server hydration ("no number passes through the LLM"), summary-as-trust-boundary, per-player data excluded from model input (precision limitation), doc-only video taxonomy, strategy-B volume placement (link `docs/seed-dataset-spec.md`), px/s caveats.
  - What I'd improve with more time: engine/player-filter precision, SSE progress instead of polling, richer rally-browsing UI on the seeded data, test suite.
  - **AI-tooling disclosure** — placeholder block marked `OWNER: fill from tracking notes (tools + how used)`; this ticket does not invent that text.
- `.env.example` (root) — every env var with a one-line comment: `DATABASE_URL`, `REDIS_URL`, `ANALYZE_CONCURRENCY`, `ANALYZE_MAX_ATTEMPTS`, `GEMINI_API_KEY`. No real values, ever.
- Links from README to `docs/seed-dataset-spec.md` and `docs/report-spec.md` (both must exist by now).

## 3. Constraints & Guardrails
- Docs + `.env.example` only; **zero code changes** in this ticket — if anything it reveals is broken, that's a finding for a fix commit on the same branch, called out explicitly, not silent patching here.
- README claims must match the merged code at write time (ports, env names, endpoints); no capability claims beyond what shipped.

## 4. Acceptance Criteria
- [ ] **Cold start proof:** `docker compose down -v` → `up --build` from scratch → mysql+redis healthy, migrations applied automatically, dashboard usable; then `npm run seed --fresh` + one filtered `/api/rallies` curl works without manual DB steps.
- [ ] `.env.example` covers every env var the stack reads (grep server code to confirm completeness); no file anywhere in the repo contains a real key or credential.
- [ ] README section complete per §2, with both design-doc links resolving inside the repo.

## 5. HUMAN GATE (owner)
1. Do the cold start yourself (`down -v` → `up --build`) — this is also your final proof that `docker compose up` "debe seguir levantando todo, ahora también con MySQL".
2. Read the README top-to-bottom as a recruiter skimming for 5 minutes: every "why" answered? no dead links? disclosure block present (you fill it before the PR goes ready).
3. Approve → tag `v0.2.0`, un-draft the PR to main, share the link (§7 deadline-safe).
