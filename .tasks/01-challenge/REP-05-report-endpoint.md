# REP-05: AI Report Endpoint (Gemini)

## 1. Goal
Implement `POST /api/videos/:id/report` strictly from the approved `docs/report-spec.md` (REP-02): DB-backed context, versioned prompt, Gemini structured-output call with robust error handling, index-validation + server-side hydration, and report caching. **No number may pass through the model** — that invariant of the spec is load-bearing here.

Prereqs: **REP-02 doc approved**, REP-03 merged (rows exist). Testable on a real small clip immediately; seeded-session testing lands after REP-04. Branch `challenge/from-mvp-to-service`, conventional commits.

## 2. Scope & Target Files
- `server/prompts/report-v1.js` (new) — exports `buildPrompt({language, audience, context})`; version = filename suffix (`report-v1`) stored on every report row; embeds context JSON verbatim + anti-fabrication instruction ("only reference provided indices; never invent or restate numeric values") + output schema from the spec.
- `server/lib/reportService.js` (new) — context builder (DB reads only: video, rallies ordered by start_s with 1-based indices, minute-bucketed intensity → top-3 peak / bottom-3 trough windows; flags per spec §2; **no user-controlled strings in context**), validator + hydrator (spec §4: index membership, drop-and-count `validation.dropped`, `warnings[]`), renderer (three sections per spec §7).
- `server/server.js` — the route:
  - Params `language ∈ {es,en}` (default es), `audience ∈ {coach,player}` (default coach); invalid → **400**. Unknown video → 404. Video's analyze job not `done` → **409** with clear message (no model call).
  - Cache first: existing `reports` row for `(video_id, language, audience)` → return it with `cached: true`.
  - Gemini via plain REST `fetch` (no new npm dep): `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent`, Bearer `GEMINI_API_KEY` from env (missing → **503** with readable message), `generationConfig {temperature: 0.3, responseMimeType: 'application/json', responseSchema}` per spec §8.
  - Error mapping: AbortController timeout **60 s** → clean "model timeout" error; provider **429** → pass through as 429 with "rate limited — retry later"; malformed/unparseable model JSON → **502** safe message (no stack traces to the client).
  - On success: validate + hydrate, render, upsert `reports` row (`model='gemini-2.5-flash'`, `prompt_version='report-v1'`), return `{cached:false, report:{...}, validation:{dropped}, warnings}`.

## 3. Constraints & Guardrails
- Implement the spec; if a behavior is ambiguous in the doc, that's a spec gap — STOP and flag it rather than inventing policy here.
- No frontend (REP-06), no seed (REP-04), no README model-choice paragraph (REP-07). `.env.example` line for `GEMINI_API_KEY` lands in REP-07; until then the 503 message must tell you exactly what's missing.
- No automatic retries of the model call (the UI button is the retry); no fallback provider (documented decision, README later).

## 4. Acceptance Criteria
- [ ] Real small clip: response highlights are a subset of the top-5 candidates; every displayed number equals the DB row value exactly; `validation.dropped` present (0 in happy path).
- [ ] Second identical call → `cached: true`, no second model invocation (log/timing evidence); re-running analytics clears it (REP-03 invalidation) so a third call regenerates.
- [ ] 400 on bad language/audience; 409 on a still-processing video; 503 with missing key; client-facing errors never contain stack traces or raw provider payloads.

## 5. HUMAN GATE (owner)
1. Generate the report for your real clip in **es/coach**, read it top to bottom, then check every number against the chart/DB — this is the anti-fabrication test with human eyes.
2. Same video in `en` and `audience=player` → language/tone shift, identical underlying numbers.
3. Repeat the exact call → instant cached response; inspect the stored row once (`SELECT … FROM reports`) to confirm model + prompt_version recorded.
