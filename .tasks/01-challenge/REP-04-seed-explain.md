# REP-04: Seed Script + EXPLAIN Evidence

## 1. Goal
Implement the deterministic volume seed strictly from the approved `docs/seed-dataset-spec.md` (REP-01), and capture the real `EXPLAIN` of the canonical rallies query into a README section — the §3.2 deliverable "500k rows + EXPLAIN you can explain".

Prereqs: **REP-01 doc approved** (parameters) and **REP-03 merged** (tables + API exist). Branch `challenge/from-mvp-to-service`, conventional commits.

## 2. Scope & Target Files
- `server/scripts/seed.js` (new) + `package.json` script `"seed": "node scripts/seed.js"`:
  - Parameters as a constants block at the top, each line commented with its spec-doc section — **no config system** (YAGNI); if the doc and code ever disagree, the doc wins.
  - Deterministic PRNG (fixed seed constant) → identical dataset on every run.
  - `--fresh` flag: TRUNCATE all six tables first (documented danger: wipes real uploads too — that's the point of a clean volume dataset; default without the flag = refuse to run if `videos` is non-empty, print instructions).
  - Generates per spec: ≥200 videos (~75/15/10 match/clip/summary mix), one done job each with consistent timestamps (`finished−started ≈ duration × U(1.0, 2.5)`), rallies + intensity_samples honoring every coherence invariant in the doc (no overlap, gap ≥2 s, **in-window max == rally peak exactly**, baseline ≤120 px/s outside windows, decay after end_s), ~60 % saved calibrations within observed ranges, 3 flat zero-rally sessions.
  - Multi-row bulk INSERTs in chunks (~5–10k rows); prints per-table counts at the end; **exits non-zero if `intensity_samples` < 500,000**.
- `README.md` — new section "Volume dataset & EXPLAIN": how to run migrate + seed (`npm run seed --fresh`), expected row-count table from the spec doc, one canonical query example with filters, its **actual** `EXPLAIN` output captured against the seeded DB, and a short index-rationale paragraph (why `(video_id, start_s)` + `videos(created_at)`, why no index per sort dimension — honest filesort note).

## 3. Constraints & Guardrails
- Implement the doc; do not invent new parameters or distributions here. If an invariant is impossible to satisfy as written, STOP and flag it (spec bug), don't silently relax it.
- No changes to migrations, endpoints, engine, or frontend in this ticket (README section only).
- Seed must run comfortably inside `docker compose exec` on a laptop (< ~3 min); if bulk-insert tuning is needed that's implementation detail, not scope creep.

## 4. Acceptance Criteria
- [ ] `npm run seed --fresh` completes, prints counts: videos ≥200, intensity_samples **≥500k**, rallies ≈ the spec's expected range (~19k), and matches average ~122 rallies (± sanity).
- [ ] Determinism: a second `--fresh` run produces identical per-table counts and identical first/last rally rows for any fixed generated video id.
- [ ] `GET /api/rallies?min_duration_s=8&order_by=intensity&order=desc&page=1` returns a plausible page (durations 3–30 s, peaks 200–950) + correct `total`; pagination walks to the end.
- [ ] README section present with EXPLAIN showing index usage on the filtered query (no full-table-scan surprise unexplained).

## 5. HUMAN GATE (owner)
1. Run the seed; watch counts hit ≥500k and finish in reasonable time.
2. Eyeball coherence via two curls: one seeded `match` video's rallies (~120, spread over ~90–120 min) and one flat session (zero rows).
3. Read the README EXPLAIN section as if you were explaining it out loud — if any line needs a shrug, the paragraph isn't done.
