# AI Report Content Spec (REP-02)

Defines exactly what the per-video AI report contains, which numbers are computed in code vs.
allowed to the model, and how context, validation, rendering, language, audience, prompt, and
empty-data behavior work. This doc is normative: REP-05 implements it without making design
decisions of its own.

**Load-bearing invariant (verbatim):** *Every number in a rendered report is either a DB row value
or a formula from §1 — never model output.* The model contributes selection (indices) and words only.
Second invariant: **no user-controlled string may appear anywhere in the prompt input.**

Rounding convention used below: `round1(x)` = decimal half-up to 1 fraction digit, applied once at
the context boundary. All formulas operate on full-precision DB values; hydration (§4) never rounds.

---

## 1. Pre-computed metrics (computed in code, never by the LLM)

Sources: `videos`, `rallies`, `intensity_samples`, `calibrations` rows for the video
(schemas per REP-03). Nothing from the model, nothing recomputed at render time.

### 1.1 Session level (context fields under `session`)

| Field | Formula | Null case |
|---|---|---|
| `rallyCount` | `COUNT(rallies)` for the video | — |
| `totalActiveTimeSec` | `round1(Σ rallies.duration_s)` | 0 if no rallies |
| `activeTimePct` | `round1(totalActiveTimeSec_exact / videos.duration_s × 100)` | null when `duration_s` is NULL or ≤ 0 |
| `avgRallyDurSec` | `round1(Σ duration_s / rallyCount)` (unrounded sum) | null if `rallyCount = 0` |
| `medianRallyDurSec` | sort durations asc → odd n: middle element; even n: mean of the two middle | null if `rallyCount = 0` |
| `longestRally` | argmax `duration_s`, tie-break earliest `start_s`; emit `{durationS, startS}` (round1) | null if no rallies |

### 1.2 Per-rally fields and indices

- Rallies are ordered by `(start_s ASC, end_s ASC)`; **`rallyIndex` = 1-based position** in that order.
- Every rally carries: `rallyIndex`, `startS` (round1 of `start_s`), `endS`, `durationS`,
  `peakIntensityPxPerSec` (round1 of `peak_intensity`). Context transmits only the candidates below;
  hydration (§4) re-reads exact DB rows by index.

### 1.3 Highlight candidates (the only rallies the model may reference)

```
candidates = top ≤5 of all rallies ordered by (peak_intensity DESC, duration_s DESC, rallyIndex ASC)
           → [{rallyIndex, startS, endS, durationS, peakIntensityPxPerSec}, ...]
```

The model picks 2–3 of these and may reference a rally **only via its `rallyIndex`**.

### 1.4 Notable intensity windows (60 s buckets)

```
samples = intensity_samples rows for the video (t_s INT at 1 Hz, intensity DOUBLE)
bucket i covers [i*60, min((i+1)*60, durationSec))          # only if it contains ≥ 1 sample
for each bucket: mean_b = mean(intensity), max_b = max(intensity)   # selection uses mean only
peaks   = top ≤3 buckets by (mean DESC, fromS ASC)
troughs = bottom ≤3 of the REMAINING buckets by (mean ASC, fromS ASC)  # a bucket never has both kinds
intensityWindows = selected buckets sorted by fromS ASC, renumbered index = 1..N (N ≤ 6), each:
    {index, fromS: round1(b.from), toS: round1(b.to), kind: 'peak'|'trough', meanPxPerSec: round1(mean_b)}
```

Degenerate cases are expected on short clips: < 60 s ⇒ exactly one bucket (kind `'peak'`); a clip
with samples in only k buckets yields ≤ k windows. `max_b` is computed for completeness; v1 context
carries `meanPxPerSec` only (shape pinned in §2). The model may cite these **only via `windowIndex`**
(= the item's `index`).

### 1.5 Context flags

| Field | Value |
|---|---|
| `session.calibration` | `'saved'` if a `calibrations` row exists for the video, else `'default'` |
| `session.noRalliesDetected` | `rallyCount === 0` (boolean) |

## 2. Context JSON (sent to the model — exact shape)

```jsonc
{
  "session": {
    "durationSec": 20,                     // videos.duration_s, round1; null if NULL in DB
    "createdAt": "2026-10-31",             // DATE(videos.created_at), UTC, 'YYYY-MM-DD' — for "sesión del …"
    "rallyCount": 1,
    "noRalliesDetected": false,
    "totalActiveTimeSec": 18.9,            // seconds, round1
    "activeTimePct": 94.4,                 // percent, round1; null when not computable (§1.1)
    "avgRallyDurSec": 18.9,                // round1 or null
    "medianRallyDurSec": 18.9,             // round1 or null
    "longestRally": { "durationS": 18.9, "startS": 1.1 },   // both round1; object is null if no rallies
    "calibration": "default"               // 'saved' | 'default' (§1.5)
  },
  "highlightCandidates": [                 // §1.3 — at most 5, may be empty
    { "rallyIndex": 1, "startS": 1.1, "endS": 20, "durationS": 18.9, "peakIntensityPxPerSec": 938.9 }
  ],
  "intensityWindows": [                    // §1.4 — at most 6, may be empty; 'index' is what the model cites
    { "index": 1, "fromS": 0, "toS": 20, "kind": "peak", "meanPxPerSec": 178.3 }
  ]
}
```

Rules:

- Seconds, px/s and percentages appear in the context with **exactly 1 decimal** (rendered text uses `m:ss`, §7).
- **Hard exclusion — per-player / per-team data:** deliberately absent from model input (known precision
  limitation of player filtering; documented decision, not an oversight).
- **Hard exclusion — user-controlled strings:** none may enter the context. Notably the video
  **filename is NOT included** (prompt-injection vector; the UI shows the report beside the name anyway).
  No upload path, no video id either. The only string values in a valid context are the enum literals
  (`'saved'|'default'`, `'peak'|'trough'`) and the UTC date derived from a DB timestamp — all server-generated.

## 3. Output schema (structured JSON the model must return)

Indices + prose only; **no numbers** in any field.

```jsonc
{
  "summary": "<overall session picture, 1 paragraph>",
  "highlights": [
    { "rallyIndex": 4, "reason": "<why this moment stands out>" }
  ],
  "intensityObservations": [
    { "windowIndex": 2, "note": "<observation>" },
    { "windowIndex": 5, "note": "<observation>" }
  ]
}
```

- `highlights`: length 2–3; fewer only if fewer candidates exist (`≤ min(3, #candidates)`). Every entry's
  `rallyIndex` must be a provided candidate index — inventing an index is the one hard failure mode.
- `intensityObservations`: each `windowIndex` must match a provided `intensityWindows[].index`; entries
  unique per window; empty array when no windows were provided.
- Every entry's `reason`/`note` and the `summary` are non-empty prose after trim.

## 4. Validation & hydration (server-side, post-model)

Pipeline order is normative: parse → per-entry validate → cap → hydrate → store.

1. **Parse.** Response must be a JSON object with the three §3 keys present and correctly typed
   (`summary` string; `highlights`, `intensityObservations` arrays). Otherwise = malformed output:
   endpoint error (REP-05's 502 mapping), nothing stored, no retry. Extra top-level keys are ignored.
2. **Per-entry validation** — a highlight entry is valid iff: `rallyIndex` is an integer present in the
   candidate set AND `reason` is non-empty after trim AND its `rallyIndex` was not already accepted
   (first occurrence wins). An observation entry is valid iff: `windowIndex` is an integer present among
   provided window indices, `note` non-empty after trim, index not already accepted.
3. **Cap.** Valid highlights beyond `min(3, #candidates)` are dropped in array order; observations have
   no cap beyond uniqueness (max = number of windows).
4. **Dropped & counted.** Every invalid or capped entry increments `validation.dropped` (always present;
   0 on a clean run) — never silently kept, never re-invented. If any were dropped, the response carries
   one warning with the pinned template for the request language: es `"Se descartaron {n} referencias
   inválidas del modelo."` / en `"{n} invalid model references were dropped."`.
5. **Hydration (exact DB values, never rounded).** Each surviving highlight becomes
   `{rallyIndex, startS, endS, durationS, peakIntensityPxPerSec, reason}` with the full-precision
   `rallies` row values; each observation becomes `{windowIndex, fromS, toS, kind, meanPxPerSec, note}`
   with full-precision bucket boundaries and mean (same computation as §1.4 before `round1`).
6. **Store.** `reports.content` = hydrated object exactly shaped as the §3 schema (prose fields replaced
   by hydrated entries); `reports.rendered` per §7; row also records `language`, `audience`, `model`,
   `prompt_version` (REP-03 schema).

**Summary is a documented trust boundary.** Free prose cannot be fully number-audited without brittle
NLP (out of scope) — this trade-off is stated here on purpose and is a README talking point, not an
apology. Mitigations pinned by this spec: the prompt steers `summary` toward qualitative references
("el punto más largo", "hacia el minuto 12") and allows concrete times only for provided notable
windows; all hard numbers live in the validated structured sections, which are hydrated from DB/code
values (§4.5).

Traceability (acceptance check — every rendered field traced): `summary`/`reason`/`note` = model prose
only · highlight times/duration/peak = `rallies` row values via §1.2 + §4.5 · window bounds/kind/mean =
§1.4 code computation hydrated per §4.5 · session stats line (§7) = §1.1 formulas · section labels,
fixed lines, footer = code constants in this doc. No other path writes a number.

## 5. Audience & language

Defaults: `language=es`, `audience=coach`. Values outside `language ∈ {es,en}` or
`audience ∈ {coach,player}` → **400** (before any model call).

| audience | Framing the prompt must request |
|---|---|
| `coach` | tactical/technical framing with actionable observations |
| `player` | simpler, motivational wording |

Both audiences are generated from the **same underlying numbers** — no per-audience metric differences;
only tone/framing changes. `language` controls the language of all model prose (labels in §7 follow it).

## 6. Empty / incomplete data rules

| Condition | Behavior |
|---|---|
| Analyze job status ≠ `done` | **409** with a clear message; no model call, nothing stored |
| `rallyCount = 0` | Report still generated: context flag `noRalliesDetected=true`; prompt instructs the summary to state that no rallies were detected; `highlights: []` (no candidates); intensity observations from samples when present |
| Calibration `'default'` | Context flag set (§1.5) + rendered footer line (§7) noting analysis ran on default court boundaries |
| No `intensity_samples` rows | `intensityWindows = []`; prompt instructs `intensityObservations: []` |
| `videos.duration_s` NULL/≤ 0 | `activeTimePct = null`; report still generated (context carries the null) |

## 7. Rendered text (stored in `reports.rendered`, displayed by UI — REP-06)

Server renders the validated/hydrated JSON into three sections. Markdown, labels per request language:
es / en shown side by side. `m:ss` = `floor(t/60)` + zero-padded `floor(t%60)` seconds, computed from
hydrated full-precision values; intensities rendered with 1 decimal.

```markdown
## Resumen general                     ## Overall summary
{stats lines — see below}              {stats lines — see below}
{summary}                              {summary}

## Momentos destacados                 ## Highlights
- Punto {rallyIndex}: {start m:ss}–{end m:ss} · pico {peak}px/s — {reason}
- Point {rallyIndex}: {start m:ss}–{end m:ss} · peak {peak}px/s — {reason}

## Intensidad a lo largo del video     ## Intensity over time
- Ventana {windowIndex} ({fromS m:ss}–{toS m:ss}): {note}
- Window {windowIndex} ({fromS m:ss}–{toS m:ss}): {note}
```

Stats lines (rendered by code from §1.1 values, inside "Resumen general", before the summary prose):

| line | es | en | omission rule |
|---|---|---|---|
| 1 | `- {rallyCount} puntos · tiempo activo {totalActiveTimeSec}s ({activeTimePct}% del video)` | `{rallyCount} points · active time {totalActiveTimeSec}s ({activeTimePct}% of the video)` | drop `({…}%)` part if `activeTimePct` null; line always present (`0 puntos` when empty) |
| 2 | `- duración media {avgRallyDurSec}s · mediana {medianRallyDurSec}s` | `average duration {avgRallyDurSec}s · median {medianRallyDurSec}s` | whole line omitted if null (no rallies) |
| 3 | `- punto más largo: {longestRally.durationS}s desde {startS m:ss}` | `longest point: {longestRally.durationS}s from {startS m:ss}` | whole line omitted if null |

Fixed lines for empty sections (code constants, not model prose): es
`No se detectaron momentos destacados.` / `Sin ventanas de intensidad disponibles.` — en
`No standout moments were detected.` / `No intensity windows available.`

Footer, appended only when `session.calibration = 'default'`: es
`*Análisis realizado con límites de pista por defecto (sin calibración guardada).*` — en
`*Analysis ran on default court boundaries (no saved calibration).*`

## 8. Prompt & model contract

- The prompt lives at **`server/prompts/report-v1.js`** and exports `buildPrompt({language, audience,
  context})` → the full instruction text as a single string. Version = filename suffix (`report-v1`)
  and is stored as `prompt_version` on every report row — bumping the file name bumps the version.
- The prompt **must embed**: (a) task + audience/language framing in the target language; (b) the §2
  context JSON **verbatim** (`JSON.stringify(context)`); (c) the anti-fabrication instruction, pinned
  wording — es: *"Referencia únicamente los índices proporcionados en el contexto. No inventes ni repitas
  valores numéricos: todos los números del informe se insertan desde la base de datos."* / en: *"Reference
  only the indices provided in the context. Never invent or restate numeric values: every number in the
  report is inserted from the database."*; (d) summary steering per §4 (qualitative references; concrete
  times only for provided windows); (e) the §3 output schema verbatim plus its length/membership rules;
  (f) "return ONLY valid JSON, no markdown fences".
- Generation is pinned to **temperature 0.3** and requires structured JSON output (the exact
  `generationConfig` keys are REP-05's provider detail). Model/provider specifics (Gemini free tier,
  model id) are REP-05 implementation details and README material — this doc stays model-agnostic except
  where it constrains behavior.
