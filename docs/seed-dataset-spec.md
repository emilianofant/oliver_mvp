# Seed Dataset & Video-Type Spec (REP-01)

Status: **frozen after owner approval** — REP-04 implements the seed script strictly from this
doc. No code in this ticket; this is the parameter contract only (placement mechanics belong to
REP-04). Every number below is traceable to a source, an anchor, or an explicit assumption (§6).

## 1. Video-type taxonomy

Three archetypes. Doc-only decision: **the MVP does not classify uploads** — there is no
`videos.kind` column because no reliable detection exists; reports use neutral "sesión" wording.
This is deliberate (classification would be a guess presented as fact); user-selected type-at-upload
is recorded as a possible future add-on, not part of the MVP.

| Archetype | Duration | Rally count / density | Notes |
|---|---|---|---|
| `clip` | uniform 30–180 s | 1–6 rallies (≈4/min — anchored by the real validated sample: 3 rallies in 46 s) | short highlights/extracts |
| `summary` | uniform 300–1800 s (5–30 min) | point cycle uniform 18–25 s ⇒ ≈2.4–3.3 rallies/min (tighter cuts than a full match; **not** more — density is physically capped by rally duration) | condensed session summary |
| `match` | uniform 5400–7200 s (90–120 min) | count = clamp(round(N(μ=122, σ=15)), 80, 165) | full padel match; **owner-verified reference: avg ~122 points/match** from the consulted stats page |

## 2. Per-rally parameters (all archetypes)

| Parameter | Distribution | Rationale / source |
|---|---|---|
| Rally duration | triangular(min 3 s, mode 10 s, max 30 s) ⇒ mean ≈14.3 s | consistent with the source's "avg point 13–15 s"; per-match longest emerges naturally (~25–30 s) — no separate parameter |
| `peak_intensity` (px/s) | uniform [200, 950] | engine-validated observed range; do not force correlation with duration |

Rally count per video follows §1. The clamped normal for matches keeps counts in a plausible band:
with μ=122, σ=15 the clamp bounds [80, 165] sit at ∓3σ and bind only rarely (assumption).

## 3. Intensity sampling — the ≥500k-row table

One row per second per video in `intensity_samples(video_id, t_s INT, intensity DOUBLE)`
(shape matches REP-03 migration; PK `(video_id, t_s)`).

**Why 1 Hz:** per-frame engine data at ~25–30 fps is storage-hostile (≈25× the rows for no queryable
value) and useless at coach granularity — a second is already finer than any decision cadence this
product serves; it also matches `metrics.py`'s existing `timeSeries1s`, so seeded data and real
analytics output share one shape.

| Region | Model |
|---|---|
| Between rallies (baseline) | uniform [15, 120] px/s with slow drift (assumption) |
| Inside a rally window `[start_s, end_s]` | ramp over ~1–2 s to the profile; **max value in-window must equal the rally's `peak_intensity` exactly**; decay over ~1–3 s after `end_s` (shape = assumption; peak-exactness = invariant) |

## 4. Volume & composition (owner-approved strategy B)

**Why rallies cannot carry the volume:** the domain ceiling is measured — ≈122 rallies/match
(§6, primary source). Even at the required scale of 200 videos that is only ≈24k rally rows;
the ≥500k target comes from per-second intensity samples instead. Rallies stay realistic, not padded:

- **Videos:** ≥200; mix ≈75 % `match` / 15 % `clip` / 10 % `summary`.
- **Expected row counts** (formulas + worked example at exactly 200 videos = 150 match / 30 clip / 20 summary; duration means: match (5400+7200)/2 = 6300 s, clip (30+180)/2 = 105 s, summary (300+1800)/2 = 1050 s):

| Table | Formula | Worked example |
|---|---|---|
| `intensity_samples` | Σ videos × E[duration] ≈ n_match·6300 + n_clip·105 + n_summary·1050 | 150×6300 + 30×105 + 20×1050 = 945,000 + 3,150 + 21,000 ≈ **~970k** |
| `rallies` | (n_match − 3)·E[count≈122] + n_clip·E[Uniform{1..6}] + n_summary·(1050/21.5) | 147×122 ≈ 17,934 + 30×3.5 = 105 + 20×(1050/21.5) ≈ 977 → **total ≈ ~19k** |

~19k rallies is stated explicitly as a **domain-coherence decision**: the count follows from the
cited ~122 points/match source, not from a row-count target. The seed script must still print actual
per-table counts and **fail loudly (non-zero exit) if `intensity_samples` < 500k**.

- Of the matches, **3 are "flat" sessions**: zero rallies, flat baseline intensity only (warm-up /
  dead footage) — they exist to exercise downstream empty-data paths for free.

## 5. Coherence invariants

The seed script must enforce every item below:

1. Rallies never overlap.
2. Gap ≥2 s between consecutive rallies of a video.
3. Last rally ends before `duration_s`.
4. Per-rally peak = max of its intensity window exactly.
5. Outside all windows, intensity ≤120 px/s.
6. One `done` job per seeded video with timestamps consistent: queue delay ~seconds, and
   `finished−started ≈ duration_s × U(1.0, 2.5)` (CPU-default analysis runs roughly real-time or slower).
7. ~60 % of videos carry a saved calibration drawn around the observed real-config ranges:
   `net_x` 0.45–0.55, `left` 0.08–0.15, `right` ≈ mirror, `top` 0.20–0.30, `bottom` 0.70–0.85,
   `net_y` 0.30–0.45, tilts ±0.1–0.35 (column names match REP-03's `calibrations`).
8. `created_at` spread uniformly over the last 90 days.
9. Deterministic PRNG (fixed seed) so re-runs are reproducible.
10. Seeded videos have **no media files** — documented: synthetic volume data for API/EXPLAIN validation,
    not playable content (`videoUrl` will 404 by design).

## 6. Sources & assumptions

| # | Number(s) | Source / anchor |
|---|---|---|
| S1 | ~122 points/match; match duration 90–120 min; avg point 13–15 s | consulted padel stats page (primary reference, owner-verified in planning conversation) |
| S2 | `clip` density anchor (≈4/min); observed speed range [200, 950] px/s | real validated sample clip: 3 rallies in 46 s + engine output on it (`samples/`, never committed) |

Explicit assumptions (no external source — owner-approved defaults): baseline uniform [15, 120] px/s
and its slow drift; ramp ~1–2 s / decay ~1–3 s shapes; job-time multiplier U(1.0, 2.5); ~60 % calibrated
share and the calibration ranges in §5.7 (observed around real saved configs); `created_at` spread over
90 days; clamp bounds [80, 165] for the match count normal.

Honest caveat: **px/s is frame-resolution-dependent in this MVP — not physical speed** (consistent with
README caveats). The seeded ranges are chosen to sit inside what the engine actually produces on real
footage at its reference resolution, so seeded and real rows look alike downstream.
