[TASK 04 - DONE]
---
# Task 04: React Dashboard UI (Upload → Video + Intensity Chart → Highlight Generator)

## 1. Goal
Build the Vite + React + Tailwind + Recharts dashboard that consumes the Task 03 API: a drag-and-drop upload with processing indicator, an HTML5 video player for the uploaded clip, a "Player Activity/Intensity over Time" area chart driven by `analysis.frames`, and a highlight generator (start/end pickers synced to the video playhead, auto-select strongest spike window, FFmpeg trim → playable + downloadable clip).

## 2. Scope & Target Files
- **Target Files** (all under `web/` unless noted):
  - `package.json` — deps exactly: react, react-dom, recharts; devDeps: vite + @vitejs/plugin-react + tailwindcss v4 (@tailwindcss/vite). Plain JSX — no TypeScript.
  - `vite.config.js` — plugin setup + dev proxy: `/api` and `/data` → `http://localhost:3001`.
  - `index.html`, `src/main.jsx`, `src/index.css` (Tailwind v4 import line only).
  - `src/App.jsx` — the entire app state + layout, with small local function components for each section in the same file.
  - `.gitignore` (append-only update: add `web/node_modules/`, `web/dist/`).
- **Untouchable Files**: `python/**`, `server/**`, `requirements.txt`, `.tasks/**`. The REST contract is frozen — if the UI needs data the API doesn't provide, stop and flag it; do not modify the backend.

## 3. Constraints & Guardrails
- Single-page app only: NO router, NO state-management library (useState/useReducer in App.jsx), NO forms/UI kit libraries, NO TypeScript, NO unit-test framework in this task. `fetch()` for all API calls — no axios.
- Keep it to the files listed above; do NOT create a component-per-file tree or utility/helper modules beyond what fits naturally inside App.jsx (~150–250 lines total is fine).
- Tailwind: use default palette + utility classes only. NO custom theme tokens, NO custom CSS animations.
- API usage (frozen contract): upload sends the file in multipart field `video` to `POST /api/upload`; processing indicator = the in-flight loading state of that single request (the backend is synchronous — no polling). Derive the trim `source` value as `videoUrl.split('/').pop()`. Trim call: `POST /api/trim-highlight` with `{ source, start, duration }` where `duration = end - start`; response gives `clipUrl`.
- Chart spec: one Recharts AreaChart over `analysis.frames`, x-axis `t` (seconds, ticks formatted mm:ss), area = `intensity` (px/s); chart tooltip also shows `playerCount`. Shade the currently selected highlight window with a `<ReferenceArea>` between start and end. NO second Y axis, NO drag-selection gestures on the chart, NO animated transitions beyond Recharts defaults.
- Highlight controls spec: numeric inputs for start/end in seconds; two buttons "Set start at playhead" / "Set end at playhead" reading `video.currentTime`; one button "Auto-select strongest spike" = pick the 5-second window (constant) maximizing mean non-null intensity, then fill both inputs. Validate `end > start` before enabling Generate (disable the button otherwise).
- Clip result: on successful trim, render a second `<video>` with the clip plus a download link (`<a href={clipUrl} download>`).
- Errors: show backend error bodies as plain red text near the relevant control. NO retry logic, NO toasts/notification system.
- Do NOT build any feature that isn't in this ticket (no playerSummary stats panel yet, no multi-clip list, no settings, no dark mode toggle).
- **Git workflow:** all work on branch `task/04-react-dashboard`; small commits with conventional style (`feat:` / `fix:` / `chore:`); no direct commits to main.

## 4. Acceptance Criteria
- [ ] Prereq: Task 03 backend running on :3001 and passing its own acceptance criteria; a sample clip exists in `samples/`.
- [ ] Stage A — shell + upload: `cd web && npm install && npm run dev` loads the app on :5173 with no console errors; dragging (or selecting) an .mp4 into the dropzone shows a processing indicator while the request is in flight, then the left panel `<video>` plays the uploaded clip and the right panel renders the intensity area chart populated from `analysis.frames`.
- [ ] Stage B — chart + picking: scrubbing the video and clicking "Set start at playhead" / "Set end at playhead" updates the inputs to the current time; the selected window is visible as a shaded region on the chart; "Auto-select strongest spike" fills both inputs with a 5 s peak window (verifiable against the JSON's highest-intensity frames).
- [ ] Stage C — highlight: "Generate Highlight Clip" issues the trim request, then a second `<video>` plays at ~the chosen duration and its download link fetches the clip file.
- [ ] Error paths: uploading a non-.mp4 shows an error message in the UI; Generate stays disabled when `end ≤ start`.
- [ ] `npm run build` completes without errors (production bundle sanity).
- [ ] `git status` shows zero modifications under `python/`, `server/`, and `.tasks/`.
- [ ] Merged into main via `git merge --no-ff task/04-react-dashboard` and tagged `task-04-done` — only after every other checkbox above is checked; branch deleted post-merge.
