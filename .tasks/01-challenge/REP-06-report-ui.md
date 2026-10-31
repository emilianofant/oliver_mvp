# REP-06: Report UI (Button + Modal)

## 1. Goal
Surface the report in the dashboard: a **"Generar reporte"** action with proper loading / error / empty states and language & audience selection — challenge §3.4's frontend requirement for Phase 2, on top of the UPL-03 videos table.

Prereq: **REP-05 merged** (endpoint live). Branch `challenge/from-mvp-to-service`, conventional commits.

## 2. Scope & Target Files
- `web/src/App.jsx` only — add in two places, one shared modal component-in-file:
  - Per-video dashboard header (next to Run analytics) and on table rows for `done` videos ("Generar reporte").
  - Modal: selects `language` (es/en, default **es**) and `audience` (coach/player, default **coach**); Generate button → POST `/api/videos/:id/report?language=&audience=`.
  - States: **loading** (spinner, controls disabled, no fake progress); **error** (readable message from the API — including rate-limit wording — with retry = same button; never a raw stack/JSON dump); **success** (rendered report text in `whitespace-pre-wrap`, section titles preserved by line structure; small "cached · hh:mm" note when `cached: true`; `warnings` shown as a dismissible one-liner when present).
  - Videos whose job isn't `done`: button disabled with tooltip ("analizando…").

## 3. Constraints & Guardrails
- Single-file App.jsx stays; Tailwind classes already in use; **no new UI dependencies** (no markdown library — plain pre-formatted text is the spec's rendered format).
- No polling of this endpoint, no auto-generation on page open — report generation is always an explicit user click.
- Do not touch UPL-03 table behavior or the per-video dashboard flow beyond adding the button.

## 4. Acceptance Criteria
- [ ] From both entry points (row + dashboard) the modal opens pre-filled with es/coach defaults and generates a report that renders readably on desktop width without horizontal scroll.
- [ ] Loading blocks double-clicks; error shows the server's message verbatim-ish and retrying works; disabled state correct for non-done videos.

## 5. HUMAN GATE (owner)
1. Generate es/coach for a real clip → read it in the modal exactly as a coach would receive it.
2. Force the error path: restart the server with an invalid `GEMINI_API_KEY`, open the modal, generate → expect the clean 503 message (not a crash/stack); restore key, retry → success. This proves the rate-limit/timeout states render safely too.
