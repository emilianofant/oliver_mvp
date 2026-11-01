# REP-01: Seed Dataset & Video-Type Spec (Definition Doc)

## 1. Goal
Produce a committed design doc — `docs/seed-dataset-spec.md` — that pins the video-type taxonomy and every parameter of the synthetic seed dataset, so the later seed ticket (REP-04) is pure mechanical implementation. All numbers below are **owner-approved defaults** from the planning conversation; the doc restates them with derivations and sources. No code, no schema changes in this ticket.

Branch `challenge/from-mvp-to-service`, conventional commits (`docs: ...`). Can run in parallel with REP-02 — but see Step 0 first.

## 2. Scope & Target Files
- **Step 0 — milestone boundary (do this before anything else):** owner confirms Phase 1 is fully closed (UPL-01…UPL-03 all human-gated). If the tag doesn't exist yet, create it on current HEAD: `git tag v0.1.0 -m 'Phase 1: upload & processing'`. Every REP commit must come **after** this tag so that `v0.1.0..HEAD` is exactly "what the challenge added."
- **Target Files**: `docs/seed-dataset-spec.md` (new). Nothing else.
- **Untouchable Files**: all code, migrations, README (REP-07 owns that), `.tasks/**`.

## 3. Content Spec (normative — the doc must contain)
1. **Video-type taxonomy** (doc-only decision; explicitly rejected alternative recorded): three archetypes, defined in words + parameter ranges:
   | Archetype | Duration | Rally count / density | Notes |
   |---|---|---|---|
   | `clip` | uniform 30–180 s | 1–6 rallies (≈4/min — anchored by the real validated sample: 3 rallies in 46 s) | short highlights/extracts |
   | `summary` | uniform 300–1800 s (5–30 min) | point cycle uniform 18–25 s ⇒ ≈2.4–3.3 rallies/min (tighter cuts than a full match; **not** more — density is physically capped by rally duration) | condensed session summary |
   | `match` | uniform 5400–7200 s (90–120 min) | count = clamp(round(N(μ=122, σ=15)), 80, 165) | full padel match; **owner-verified reference: avg ~122 points/match** from the consulted stats page |
   - MVP does **not** classify uploads (no `videos.kind` column — no reliable detection exists); reports use neutral "sesión" wording. Record this as a deliberate decision with rationale, and note user-selected type-at-upload as a possible future add-on.
2. **Per-rally parameters** (all archetypes): rally duration ~ triangular(min 3 s, mode 10 s, max 30 s) ⇒ mean ≈14.3 s — consistent with the source's "avg point 13–15 s"; per-match longest emerges naturally (~25–30 s). `peak_intensity` px/s ~ uniform [200, 950] (engine-validated observed range; do not force correlation with duration).
3. **Intensity sampling** (the ≥500k-row table): 1 row/second per video in `intensity_samples(video_id, t_s, intensity)` — explain the 1 Hz choice (per-frame engine data at ~25–30 fps is storage-hostile and useless at coach granularity; matches `metrics.py`'s existing `timeSeries1s`). Between rallies: baseline uniform [15, 120] px/s with slow drift. Inside a rally window `[start_s, end_s]`: ramp over ~1–2 s to the profile, **max value in-window must equal the rally's `peak_intensity` exactly**, decay over ~1–3 s after `end_s`.
4. **Volume & composition** (owner-approved strategy B — document *why* rallies cannot carry the volume: measured 122 rallies/match × 200 videos ≈ 24k rows, vs the required ≥500k):
   - ≥200 videos; mix ≈75 % `match` / 15 % `clip` / 10 % `summary`.
   - Expected row counts with formulas + a worked example: intensity_samples ≈ 150×6300 + 30×105 + 20×1050 ≈ **~970k** (the script must still print actual per-table counts and fail loudly if <500k).
   - Rallies total ≈ ~19k — realistic, not padded. State this explicitly as a domain-coherence decision with the source citation.
   - Of the matches, **3 are "flat" sessions**: zero rallies, flat baseline intensity only (warm-up/dead footage) — they exist to exercise downstream empty-data paths for free.
5. **Coherence invariants** (the seed script must enforce; list them verbatim): rallies never overlap; gap ≥2 s between consecutive rallies of a video; last rally ends before `duration_s`; per-rally peak = max of its intensity window exactly; outside all windows intensity ≤120 px/s; one `done` job per seeded video with timestamps consistent: queue delay ~seconds, and `finished−started ≈ duration_s × U(1.0, 2.5)` (CPU-default analysis runs roughly real-time or slower); ~60 % of videos carry a saved calibration drawn around the observed real-config ranges (`net_x` 0.45–0.55, `left` 0.08–0.15, `right` ≈ mirror, `top` 0.20–0.30, `bottom` 0.70–0.85, `net_y` 0.30–0.45, tilts ±0.1–0.35); `created_at` spread uniformly over the last 90 days; deterministic PRNG (fixed seed) so re-runs are reproducible; seeded videos have **no media files** (documented: synthetic volume data for API/EXPLAIN validation).
6. **Sources & assumptions**: cite the consulted padel stats page (avg ~122 points/match, 90–120 min duration, avg point 13–15 s) as primary reference; cite the real validated sample clip as anchor for `clip` density and px/s ranges; mark every number without a source as an explicit assumption. One honest line: px/s is frame-resolution-dependent in this MVP — not physical speed (consistent with README caveats).

## 4. Constraints & Guardrails
- Doc-only ticket: no code, migrations, or seed script in here (that's REP-04); no implementation algorithms beyond the distributions above (placement mechanics belong to REP-04).
- Keep the doc under ~200 lines; tables over prose; every number traceable to a source, an anchor, or labelled assumption.
- Do not re-open settled decisions (strategy B, 1 Hz, doc-only taxonomy) — they're recorded as decided, with their rationale.

## 5. Acceptance Criteria
- [ ] **`v0.1.0` exists on the branch and points to a commit before any REP work**; `git log v0.1.0..HEAD` contains only REP commits from this ticket onward.
- [ ] `docs/seed-dataset-spec.md` committed on the branch; all six sections present; every parameter from §3 of this ticket appears verbatim (same distributions and ranges).
- [ ] Volume math in the doc independently reaches ≥500k rows at the stated composition.

## 6. HUMAN GATE (owner reviews before closing)
1. Confirm Phase 1 closed + create/verify the `v0.1.0` tag (Step 0) — you are the one who walked UPL's gates, so this is yours to set.
2. Read the doc end-to-end; confirm every number matches this ticket and your stats source (~122 points/match especially).
3. Sanity-check the three archetype rows against what you'd actually upload as a coach — if any row "feels wrong", that's the moment to change it (cheap now, expensive after seeding).
4. Approve → doc frozen; REP-04 implements strictly from it.
