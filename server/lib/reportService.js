// REP-05 — AI report context builder, validator/hydrator and renderer (docs/report-spec.md).
// Invariant: no number passes through the model. Context values are rounded once at this
// boundary (§1/§2); hydration uses full-precision DB rows/bucket computations (§4.5).

const { query } = require("./db");

class MalformedReportError extends Error {}

// §0 rounding convention: decimal half-up to 1 fraction digit, applied once at the context boundary.
function round1(x) {
  if (x === null || x === undefined || !Number.isFinite(x)) return null;
  const sign = Math.sign(x) || 1;
  return (sign * Math.round(Math.abs(x) * 10)) / 10;
}

// §1.2 — rallies ordered by (start_s ASC, end_s ASC); rallyIndex = 1-based position. Full precision.
async function loadRallies(videoId) {
  const rows = await query(
    "SELECT start_s, end_s, duration_s, peak_intensity FROM rallies WHERE video_id = ? ORDER BY start_s ASC, end_s ASC",
    [videoId],
  );
  return rows.map((r, i) => ({
    rallyIndex: i + 1,
    startS: r.start_s,
    endS: r.end_s,
    durationS: r.duration_s,
    peakIntensityPxPerSec: r.peak_intensity,
  }));
}

// §1.3 — top ≤5 by (peak DESC, duration DESC, rallyIndex ASC).
function pickCandidates(rallies) {
  return [...rallies]
    .sort((a, b) => (b.peakIntensityPxPerSec - a.peakIntensityPxPerSec) || (b.durationS - a.durationS) || (a.rallyIndex - b.rallyIndex))
    .slice(0, 5);
}

// §1.4 — 60 s buckets; top-3 peaks + bottom-3 troughs of the remaining by mean; renumbered 1..N.
// Full precision (no rounding): context rounds via round1 at its boundary, hydration uses these raw values.
async function loadWindows(videoId) {
  const videoRows = await query("SELECT duration_s FROM videos WHERE id = ?", [videoId]);
  const samples = await query("SELECT t_s, intensity FROM intensity_samples WHERE video_id = ? ORDER BY t_s ASC", [videoId]);
  const durationSec = videoRows.length > 0 ? videoRows[0].duration_s : null;
  const clamp = Number.isFinite(durationSec) && durationSec > 0 ? durationSec : Infinity;
  const byBucket = new Map();
  for (const s of samples) {
    if (!Number.isFinite(s.intensity)) continue;
    const i = Math.floor(s.t_s / 60);
    let b = byBucket.get(i);
    if (!b) {
      b = { from: i * 60, to: Math.min((i + 1) * 60, clamp), sum: 0, count: 0, max: -Infinity };
      byBucket.set(i, b);
    }
    b.sum += s.intensity;
    b.count += 1;
    if (s.intensity > b.max) b.max = s.intensity;
  }
  const all = [...byBucket.values()].map((b) => ({ from: b.from, to: b.to, mean: b.sum / b.count, max: b.max }));
  const peaks = [...all].sort((a, b) => (b.mean - a.mean) || (a.from - b.from)).slice(0, 3);
  const peakFroms = new Set(peaks.map((b) => b.from));
  const troughs = all.filter((b) => !peakFroms.has(b.from)).sort((a, b) => (a.mean - b.mean) || (a.from - b.from)).slice(0, 3);
  return [...peaks.map((b) => ({ ...b, kind: "peak" })), ...troughs.map((b) => ({ ...b, kind: "trough" }))]
    .sort((a, b) => a.from - b.from)
    .map((w, i) => ({ index: i + 1, fromS: w.from, toS: w.to, kind: w.kind, meanPxPerSec: w.mean }));
}

// §1/§2 — context JSON sent to the model. No user-controlled string enters here (no filename).
async function buildContext(videoId) {
  const videoRows = await query(
    "SELECT duration_s, DATE_FORMAT(created_at, '%Y-%m-%d') AS createdDate FROM videos WHERE id = ?",
    [videoId],
  );
  if (videoRows.length === 0) throw new Error(`unknown video ${videoId}`);
  const video = videoRows[0];
  const rallies = await loadRallies(videoId);
  const windows = await loadWindows(videoId);

  const durations = rallies.map((r) => r.durationS).sort((a, b) => a - b);
  const rallyCount = durations.length;
  const sumExact = durations.reduce((a, b) => a + b, 0);
  const durationSec = video.duration_s;

  let medianRallyDurSec = null;
  if (rallyCount > 0) {
    const mid = Math.floor(rallyCount / 2);
    medianRallyDurSec = rallyCount % 2 === 1 ? durations[mid] : (durations[mid - 1] + durations[mid]) / 2;
  }

  let longestRally = null;
  if (rallyCount > 0) {
    const longest = rallies.reduce((best, r) => (best === null || r.durationS > best.durationS ? r : best), null);
    longestRally = { durationS: round1(longest.durationS), startS: round1(longest.startS) };
  }

  const calRows = await query("SELECT 1 FROM calibrations WHERE video_id = ?", [videoId]);

  const context = {
    session: {
      durationSec: Number.isFinite(durationSec) ? round1(durationSec) : null,
      createdAt: video.createdDate,
      rallyCount,
      noRalliesDetected: rallyCount === 0,
      totalActiveTimeSec: round1(sumExact),
      activeTimePct: durationSec == null || durationSec <= 0 ? null : round1((sumExact / durationSec) * 100),
      avgRallyDurSec: rallyCount > 0 ? round1(sumExact / rallyCount) : null,
      medianRallyDurSec: medianRallyDurSec === null ? null : round1(medianRallyDurSec),
      longestRally,
      calibration: calRows.length > 0 ? "saved" : "default",
    },
    highlightCandidates: pickCandidates(rallies).map((r) => ({
      rallyIndex: r.rallyIndex,
      startS: round1(r.startS),
      endS: round1(r.endS),
      durationS: round1(r.durationS),
      peakIntensityPxPerSec: round1(r.peakIntensityPxPerSec),
    })),
    intensityWindows: windows.map((w) => ({
      index: w.index,
      fromS: round1(w.fromS),
      toS: round1(w.toS),
      kind: w.kind,
      meanPxPerSec: round1(w.meanPxPerSec),
    })),
  };
  return { context };
}

// §4 — parse → per-entry validate → cap → hydrate. Throws MalformedReportError on shape failure (§4.1).
async function validateAndHydrate(videoId, modelOutput, language) {
  if (
    typeof modelOutput !== "object" || modelOutput === null || Array.isArray(modelOutput) ||
    typeof modelOutput.summary !== "string" || modelOutput.summary.trim() === "" ||
    !Array.isArray(modelOutput.highlights) || !Array.isArray(modelOutput.intensityObservations)
  ) {
    throw new MalformedReportError("model output is not a valid report object");
  }

  const rallies = await loadRallies(videoId);
  const candidatesByIndex = new Map(pickCandidates(rallies).map((r) => [r.rallyIndex, r]));
  const windowsByIndex = new Map((await loadWindows(videoId)).map((w) => [w.index, w]));

  let dropped = 0;
  const seenRallies = new Set();
  const validHighlights = [];
  for (const entry of modelOutput.highlights) {
    const idx = entry && typeof entry === "object" ? entry.rallyIndex : null;
    if (!Number.isInteger(idx) || !candidatesByIndex.has(idx)) dropped += 1;
    else if (typeof entry.reason !== "string" || entry.reason.trim() === "") dropped += 1;
    else if (seenRallies.has(idx)) dropped += 1; // first occurrence wins
    else {
      seenRallies.add(idx);
      validHighlights.push({ rallyIndex: idx, reason: entry.reason.trim() });
    }
  }
  const cap = Math.min(3, candidatesByIndex.size);
  const highlights = validHighlights.slice(0, cap);
  dropped += validHighlights.length - highlights.length;

  const seenWindows = new Set();
  const observations = [];
  for (const entry of modelOutput.intensityObservations) {
    const idx = entry && typeof entry === "object" ? entry.windowIndex : null;
    if (!Number.isInteger(idx) || !windowsByIndex.has(idx)) dropped += 1;
    else if (typeof entry.note !== "string" || entry.note.trim() === "") dropped += 1;
    else if (seenWindows.has(idx)) dropped += 1;
    else {
      seenWindows.add(idx);
      observations.push({ windowIndex: idx, note: entry.note.trim() });
    }
  }

  const warnings =
    dropped > 0
      ? [language === "en" ? `${dropped} invalid model references were dropped.` : `Se descartaron ${dropped} referencias inválidas del modelo.`]
      : [];

  // §4.5 — hydrate with full-precision DB rows / bucket values (never rounded).
  const content = {
    summary: modelOutput.summary.trim(),
    highlights: highlights.map((h) => ({
      rallyIndex: h.rallyIndex,
      startS: candidatesByIndex.get(h.rallyIndex).startS,
      endS: candidatesByIndex.get(h.rallyIndex).endS,
      durationS: candidatesByIndex.get(h.rallyIndex).durationS,
      peakIntensityPxPerSec: candidatesByIndex.get(h.rallyIndex).peakIntensityPxPerSec,
      reason: h.reason,
    })),
    intensityObservations: observations.map((o) => ({
      windowIndex: o.windowIndex,
      fromS: windowsByIndex.get(o.windowIndex).fromS,
      toS: windowsByIndex.get(o.windowIndex).toS,
      kind: windowsByIndex.get(o.windowIndex).kind,
      meanPxPerSec: windowsByIndex.get(o.windowIndex).meanPxPerSec,
      note: o.note,
    })),
  };

  return { content, validation: { dropped }, warnings };
}

// §7 — rendered markdown stored in reports.rendered. Labels per request language; m:ss from full-precision values.
const MS = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;
// §7 — active-time units: <60 s as seconds; [60, 600) s as minutes with 1 decimal; ≥600 s as whole minutes.
const FMT_ACTIVE = (sec) => {
  if (sec < 60) return `${round1(sec)}s`;
  if (sec < 600) return `${(Math.round((sec / 60) * 10)) / 10} min`;
  return `${Math.round(sec / 60)} min`;
};

const LABELS = {
  es: {
    summary: "Resumen general",
    highlights: "Momentos destacados",
    intensity: "Intensidad a lo largo del video",
    stats1: (s) => `- ${s.rallyCount} puntos · tiempo activo ${FMT_ACTIVE(s.totalActiveTimeSec)}${s.activeTimePct === null ? "" : ` (${s.activeTimePct}% del video)`}`,
    stats2: (s) => `- duración media ${s.avgRallyDurSec}s · mediana ${s.medianRallyDurSec}s`,
    stats3: (s) => `- punto más largo: ${s.longestRally.durationS}s desde ${MS(s.longestRally.startS)}`,
    highlightLine: (h) => `- Punto ${h.rallyIndex}: ${MS(h.startS)}–${MS(h.endS)} — ${h.reason}`,
    windowLine: (o) => `- Ventana ${o.windowIndex} (${MS(o.fromS)}–${MS(o.toS)}): ${o.note}`,
    emptyHighlights: "No se detectaron momentos destacados.",
    emptyIntensity: "Sin ventanas de intensidad disponibles.",
    footer: "*Análisis realizado con límites de pista por defecto (sin calibración guardada).*",
  },
  en: {
    summary: "Overall summary",
    highlights: "Highlights",
    intensity: "Intensity over time",
    stats1: (s) => `- ${s.rallyCount} points · active time ${FMT_ACTIVE(s.totalActiveTimeSec)}${s.activeTimePct === null ? "" : ` (${s.activeTimePct}% of the video)`}`,
    stats2: (s) => `- average duration ${s.avgRallyDurSec}s · median ${s.medianRallyDurSec}s`,
    stats3: (s) => `- longest point: ${s.longestRally.durationS}s from ${MS(s.longestRally.startS)}`,
    highlightLine: (h) => `- Point ${h.rallyIndex}: ${MS(h.startS)}–${MS(h.endS)} — ${h.reason}`,
    windowLine: (o) => `- Window ${o.windowIndex} (${MS(o.fromS)}–${MS(o.toS)}): ${o.note}`,
    emptyHighlights: "No standout moments were detected.",
    emptyIntensity: "No intensity windows available.",
    footer: "*Analysis ran on default court boundaries (no saved calibration).*",
  },
};

function renderReport({ language, session, content }) {
  const L = LABELS[language] || LABELS.es;
  const statsLines = [L.stats1(session)];
  if (session.avgRallyDurSec !== null) statsLines.push(L.stats2(session));
  if (session.longestRally !== null) statsLines.push(L.stats3(session));

  const sections = [
    [`## ${L.summary}`, ...statsLines, "", content.summary].join("\n"),
    [`## ${L.highlights}`, ...(content.highlights.length > 0 ? content.highlights.map(L.highlightLine) : [L.emptyHighlights])].join("\n"),
    [`## ${L.intensity}`, ...(content.intensityObservations.length > 0 ? content.intensityObservations.map(L.windowLine) : [L.emptyIntensity])].join("\n"),
  ];
  let out = sections.join("\n\n");
  if (session.calibration === "default") out += `\n\n${L.footer}`;
  return out;
}

module.exports = { buildContext, validateAndHydrate, renderReport, MalformedReportError };
