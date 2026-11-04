# REP-02: Report Content Spec (Definition Doc)

## 1. Goal
Produce a committed design doc — `docs/report-spec.md` — that defines exactly **what** the AI report contains, which numbers are computed in code vs allowed to the model, the context/output JSON shapes, per-audience/per-language behavior, empty-data rules, and validation rules — so the later endpoint ticket (REP-05) is mechanical. No code in this ticket; no LLM call needed to complete it.

Branch `challenge/from-mvp-to-service`, conventional commits (`docs: ...`). Can run in parallel with REP-01.

## 2. Scope & Target Files
- **Target Files**: `docs/report-spec.md` (new). Nothing else.
- **Untouchable Files**: all code, migrations, README, `.tasks/**`. The prompt file itself (`server/prompts/report-v1.js`) is created by REP-05 from this spec — not here.

## 3. Content Spec (normative — the doc must define)
1. **Pre-computed metrics — computed in code, never by the LLM** (formulas unambiguous; DB-sourced):
   - Session level: `rallyCount`; `totalActiveTimeSec = Σ durationS`; `activeTimePct = totalActiveTimeSec / duration_s × 100`; `avgRallyDurSec`; **`medianRallyDurSec`**; `longestRally {durationS, startS}`.
   - Per rally: `rallyIndex` (1-based by start time), `startS`, `endS`, `durationS`, `peakIntensityPxPerSec`.
   - **Highlight candidates**: top 5 rallies ordered by `peakIntensityPxPerSec` DESC, tie-break `durationS` DESC. The model picks 2–3 of these; it may reference them **only by `rallyIndex`** — all numeric fields are hydrated server-side from the candidate list (the model never transcribes a value).
   - **Notable intensity windows**: bucket `intensity_samples` into 60 s buckets → per-bucket mean and max; take top-3 peak + bottom-3 trough by mean. Context carries them as one array: `{index, fromS, toS, kind: 'peak'|'trough', meanPxPerSec}` (indices 1–6). The model may cite only these windows **by `windowIndex`** — bounds and values hydrated server-side.
   - Context flags: `hasCalibration` (+ `'saved' | 'default'`), `durationSec`, `createdAt` (date, for "sesión del …"), `rallyCount === 0` flag.
2. **Context JSON shape** sent to the model — pin exact field names; numeric seconds with 1 decimal in context (rendered text uses `m:ss`). Two hard exclusions: per-player/per-team data is **deliberately excluded** from model input (known precision limitation of player filtering — documented decision), and **no user-controlled string enters the context** (notably: video filename is NOT included — it would be a prompt-injection vector; the UI displays the report beside the video name anyway).
3. **Output schema** (structured JSON the model must return — indices + prose only, no numbers):
   ```json
   {
     "summary": "<overall session picture, 1 paragraph>",
     "highlights": [
       {"rallyIndex": 4, "reason": "<why this moment stands out>"}
     ],
     "intensityObservations": [
       {"windowIndex": 2, "note": "<observation>"},
       {"windowIndex": 5, "note": "<observation>"}
     ]
   }
   ```
   `highlights` length 2–3 (fewer only if fewer candidates exist); every entry references a provided candidate/window index — inventing an index is the one hard failure mode validation exists to catch.
4. **Validation rules** (server-side, post-model): each `rallyIndex` ∈ highlight candidates; each `windowIndex` ∈ 1–6; `reason`/`note` non-empty prose. Valid entries are **hydrated server-side with the exact DB values** (start/end/duration/peak or window bounds) before rendering — so no numeric value in a report ever passes through the model. Invalid references are **dropped and counted** (`validation.dropped`) — never silently kept, never re-invented; if any were dropped, response includes a `warnings[]` entry.
   - **Summary is a documented trust boundary:** prose cannot be fully number-audited without brittle NLP (out of scope). Mitigations pinned here: the prompt steers summary to qualitative references ("el punto más largo", "hacia el minuto 12") and allows concrete times only from the notable windows; all hard numbers live in the validated structured sections. State this trade-off explicitly in the doc — it's a README talking point, not an apology.
5. **Audience & language** (defaults `language=es`, `audience=coach`; invalid → 400): `language` controls output language; `audience=coach` = tactical/technical framing with actionable observations, `player` = simpler, motivational wording — **same underlying numbers for both** (no per-audience metric differences).
6. **Empty/incomplete data rules**: `rallyCount === 0` → report still generated: `highlights: []`, summary states no rallies were detected, intensity observations from samples when present; default calibration → context flag set and the rendered report notes analysis ran on default court boundaries; video whose analyze job isn't `done` yet → endpoint returns 409 with a clear message (no model call).
7. **Rendered text**: server renders validated JSON into three readable sections — "Resumen general" / "Momentos destacados" (with `m:ss`) / "Intensidad a lo largo del video"; both structured JSON and rendered text stored in the `reports` row; UI (REP-06) displays the rendered text.
8. **Prompt & model notes**: prompt lives at `server/prompts/report-v1.js`, exports `buildPrompt({language, audience, context})`; version = filename suffix, stored as `prompt_version` on every report row; must embed the context JSON verbatim + explicit anti-fabrication instruction (including: *only reference provided indices; never invent or restate numeric values*) + the output schema. Generation pinned to **temperature 0.3** for consistency across regenerations. Model/provider specifics (Gemini free tier, model id `gemini-2.5-flash`) are REP-05's implementation detail and README material — this doc stays model-agnostic except where it constrains behavior (structured JSON output required).

## 4. Constraints & Guardrails
- Doc-only: no endpoint, prompt file, or LLM call in this ticket; formulas must be implementable without interpretation (pseudocode allowed).
- Invariant to state verbatim in the doc: **every number in a rendered report is either a DB row value or a formula from §1 — never model output.** The model contributes selection (indices) and words only.
- No user-controlled string may appear anywhere in the prompt input (context exclusions from §2 are normative, not stylistic).
- Keep under ~250 lines; schemas and tables over prose.

## 5. Acceptance Criteria
- [ ] `docs/report-spec.md` committed on the branch with all eight sections; context/output shapes complete enough that REP-05 needs no design decisions of its own.
- [ ] The "no number passes through the model" invariant holds when you trace every field of the output schema back to §1/§3/§4.

## 6. HUMAN GATE (owner reviews before closing)
1. Review the metric list and output schema — confirm it matches what *you* want a coach to read (count, avg/median duration, longest + its time, per-point intensity, high-intensity intervals) and nothing you'd consider noise.
2. **Dry run without any API key:** hand-build the context JSON from your real sample clip's actual data strictly following §1–§2 of the doc, and show it to the owner — approving that concrete artifact (not just the schema) is what closes this ticket.
3. Approve → spec frozen; REP-05 implements strictly from it.
