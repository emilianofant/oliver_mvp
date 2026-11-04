# UPL-03: Frontend — Videos & Jobs Table (Phase 1 UI)

## 1. Goal
The dashboard landing becomes a **videos/jobs table**: multi-upload, live job status chips with error reasons, and click-through to the existing per-video dashboard. This closes Phase 1's user story end-to-end ("upload several clips → watch them process in background → open each"). The report button deliberately does NOT exist yet (it lands with REP-04).

Depends on **UPL-01** (needs `GET /api/videos` + `POST /api/videos`). Same branch, own small commits.

## 2. Scope & Target Files
- `web/src/App.jsx` — rework landing state only:
  - Table rows from `GET /api/videos`: filename, size, date, duration (when known), status chip (`queued`/`processing`/`done`/`failed`, failed shows its reason inline or as tooltip), Open action enabled for `done`.
  - **Polling:** refetch every ~2.5 s while any job is `queued` or `processing`; stop otherwise; always refetch after an upload.
  - Multi-upload: existing file input/dropzone gains `multiple`; POST files to `/api/videos` **sequentially** (one at a time), then refresh the list — no parallel big transfers, no new libraries.
  - Clicking Open loads that video into the **existing** dashboard view (calibrate court / run analytics / chart / trim) with its UUID; all of that flow is reused as-is.
  - Empty state: "No videos yet" + upload affordance. Remove every reference to the old `/api/upload` call path.
- `server/server.js` — **only if** an existing court/analytics/trim route turns out not to work with the new UUID-only file naming during implementation: allow a minimal server-side fix in that one place, called out explicitly in the commit message. No endpoint renames or contract changes otherwise.

## 3. Constraints & Guardrails
- Single-file `App.jsx` stays single-file; Tailwind classes already in use — no new UI dependencies, no component-library extraction (that's post-challenge polish).
- Status truth comes from the server on every poll — do not simulate progress client-side, no fake percentages.
- Do not touch calibration/analytics/trim behavior or styling of the per-video dashboard; it must look and behave exactly as before once opened.
- No report button, no reports UI, no links to REP features (not built yet).

## 4. Acceptance Criteria
- [ ] Landing loads `GET /api/videos` into the table on open; zero references to `/api/upload` remain in `web/src`.
- [ ] Selecting 3 small clips at once → 3 rows appear as `queued`, then walk to `done` **live** without manual refresh.
- [ ] A failed row displays its error reason; a processing state survives a full page refresh (server-side truth).
- [ ] Open on a done video → existing dashboard fully functional: court calibration saves, "Run analytics" works, chart renders, trim/highlight clip generates and plays.

## 5. HUMAN GATE (owner runs personally before this ticket is closed)
1. `docker compose up --build`, open the dashboard at :8080 → table view with previous uploads listed with correct statuses/durations.
2. Multi-select **3 small clips** at once → watch all three rows progress live to done; no console errors, no stuck spinners.
3. Upload one broken `.mp4` among them → its row ends red/failed with a readable reason while the others complete normally.
4. Refresh mid-processing → status persists (server truth).
5. Open a finished video → walk the full old flow once: calibrate court, run analytics, inspect chart + rally bands, trim a highlight and play it. **This is the regression check** that removing the sync upload broke nothing else.

---
*After UPL-01…UPL-03 all pass their human gates: tag `v0.1.0` on the branch — Phase 1 (upload & processing) complete.*
