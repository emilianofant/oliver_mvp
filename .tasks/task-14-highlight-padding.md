# Task 14: Highlight Clip Padding

## 1. Goal
Generated highlight clips currently cut exactly at the selected start/end, which feels abrupt — the point's opening and closing moments get clipped off. Add a user-adjustable padding (default **1 s** each side) applied when generating the clip, clamped to the video bounds, so highlights include the context around the picked window.

## 2. Scope & Target Files
- **Target File**: `web/src/App.jsx` — single file.
  - `HighlightControls`: add a third numeric input **"Padding (s)"** next to Start/End (`min=0`, `step=0.5`, default `"1"`), same styling as its siblings; pass the value up like start/end.
  - `handleGenerate`: compute the effective trim range before calling `/api/trim-highlight`:
    - `videoDur = videoRef.current?.duration` if finite, else fall back to the last frame's `t`.
    - `trimStart = max(0, startSec − pad)`; `effectiveEnd = min(videoDur, endSec + pad)`; send `start: trimStart`, `duration: effectiveEnd − trimStart`.
  - Small helper text under the controls when padding > 0 (e.g., "clips include ~1 s of context on each side") so a longer-than-selected clip is never surprising. One `<p>` line, no tooltips/overlays.
- **Untouchable Files**: `server/server.js` (`/api/trim-highlight` already accepts any valid start/duration — no server change), everything else in the app, `python/**`, `.tasks/**`.

## 3. Constraints & Guardrails
- Padding is applied **only at trim time** inside `handleGenerate`; the Start/End fields keep showing the user's exact selection (selection UI stays honest). Do not bake padding into auto-select or the playhead buttons.
- No segment-awareness: do not clamp padding against rally windows, close segments, or boundaries — plain video-bounds clamping only (context across a cut is acceptable and desirable for highlights).
- Keep state minimal: one extra string state + prop, mirroring how start/end already flow. Do not extract helpers/components beyond what the two touch points need; no new dependencies.

## 4. Acceptance Criteria
- [ ] Default behavior on first use: padding input shows `1`; auto-select a mid-rally window and generate → resulting clip is ≈ selection + 2 s total, visibly starting ~1 s before action onset (verify by playing the generated clip).
- [ ] Padding `0` reproduces today's exact trim range (no behavioral drift when disabled).
- [ ] Clamping: with a selection ending within 1 s of video end and padding 1 → generated duration ≤ remaining video length, no negative/zero-duration request; same at the very start of the video.
- [ ] Helper text visible iff padding > 0; Start/End fields still show the un-padded selection after generation.
- [ ] `git status`: modifications limited to `web/src/App.jsx`.
- [ ] Merged into main via `git merge --no-ff task/14-highlight-padding`, tagged `task-14-done` only after every checkbox above passes; branch deleted post-merge.
