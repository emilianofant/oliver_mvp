#!/usr/bin/env node
// REP-04 — deterministic volume dataset for API/EXPLAIN validation.
// Parameter contract: docs/seed-dataset-spec.md (REP-01, frozen). If this file and the doc
// ever disagree, the doc wins — fix the script in a ticket, not the numbers below.
// Placement mechanics (gap splits, ramp/decay shapes) belong to REP-04 per spec §3; every
// coherence invariant from spec §5 is enforced by construction AND re-checked in memory on
// exact integer arithmetic before anything touches the database. Seeded videos have no media
// files: videoUrl 404s by design (spec §5.10). px/s values are frame-resolution-dependent,
// not physical speed (consistent with README caveats).

const { getPool } = require("../lib/db");

// --- Parameters — each line cites its section of docs/seed-dataset-spec.md ---
const PRNG_SEED = 0x5eedca1;                 // §5.9 fixed seed → identical dataset on every run
const VIDEO_COUNT = 200;                     // §4 "Videos: ≥200" (worked example uses exactly 200)
const MIX = { match: 150, clip: 30, summary: 20 };   // §4 ~75/15/10 of the 200 videos
const DURATIONS = {                          // §1 duration column (seconds)
  match: [5400, 7200],                       // uniform 90–120 min
  clip: [30, 180],                           // uniform 30 s – 3 min
  summary: [300, 1800],                      // uniform 5–30 min
};
const RALLY_TRI = { a: 3, c: 10, b: 30 };    // §2 rally duration triangular(min/mode/max), mean ≈14.3 s (drawn continuous, stored rounded to whole seconds)
const PEAK_RANGE = [200, 950];               // §2 peak_intensity uniform px/s (engine-observed range)
const MATCH_COUNT = { mu: 122, sd: 15, min: 80, max: 165 };   // §1 clamped normal per match
const CLIP_COUNT = [1, 6];                   // §1 Uniform{1..6} rallies per clip
const SUMMARY_CYCLE = [18, 25];              // §1 point cycle (start-to-start) uniform s → ≈2.4–3.3/min
const FLAT_MATCHES = 3;                      // §4 matches that are zero-rally "flat" sessions
const BASELINE = { min: 15, max: 120 };      // §3 between-rallies uniform px/s, with slow drift (assumption)
const RAMP_SEC = [1, 2];                     // §3 ramp-to-profile duration (shape = assumption)
const DECAY_SEC = [1, 3];                    // §3 decay after end_s (shape = assumption)
// Invariant floors plus a +1 s snap margin: rally boundaries are stored as whole seconds, so
// the raw gaps are drawn ≥ floor+1 to guarantee the stored gap still satisfies the invariant.
const GAP_MIN = 2.0;                         // §5.2 min gap between consecutive rallies of a video
const TAIL_MIN = 1.0;                        // §5.3 last rally ends before duration_s (raw tail kept ≥ 2 s)
const HEAD_MIN = 2;                          // placement choice: no video opens mid-rally at t=0
const JOB_DELAY_SEC = [2, 10];               // §5.6 queue delay ~seconds (upload → worker pickup)
const JOB_TIME_MULT = [1.0, 2.5];            // §5.6 finished−started ≈ duration × U(1.0,2.5), CPU pace
const CREATED_SPREAD_DAYS = 90;              // §5.8 created_at uniform over the last 90 days
const CALIBRATION_SHARE = 0.6;               // §5.7 ~60% of videos carry a saved calibration
const CAL_RANGE = {                          // §5.7 observed real-config ranges (frame fractions)
  netX: [0.45, 0.55], left: [0.08, 0.15], top: [0.20, 0.30], bottom: [0.70, 0.85],
  netY: [0.30, 0.45], tiltMag: [0.1, 0.35], rightJitter: [-0.03, 0.03],
};
const MIN_INTENSITY_ROWS = 500_000;          // §4 fail loudly (non-zero exit) below this
const INSERT_CHUNK = 5000;                   // multi-row bulk insert size (REP-04: ~5–10k rows/statement)

// --- Deterministic PRNG (mulberry32): pure integer math, identical stream every run ---
function makeRng() {
  let a = PRNG_SEED >>> 0;
  const u = () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  let spareNormal = null;
  const uni = (x, y) => x + (y - x) * u();
  const int = (x, y) => x + Math.floor(u() * (y - x + 1));   // inclusive integers
  const normal = (mu, sd) => {                                // Box–Muller; spare cached, draw order fixed
    if (spareNormal !== null) { const s = spareNormal; spareNormal = null; return mu + sd * s; }
    let v1; do { v1 = u(); } while (v1 === 0);
    const r = Math.sqrt(-2 * Math.log(v1)), th = 2 * Math.PI * u();
    spareNormal = r * Math.sin(th);
    return mu + sd * r * Math.cos(th);
  };
  // §2 triangular(min/mode/max) via inverse CDF.
  const tri = (x, y, z) => {
    const rr = u();
    if (rr < (y - x) / (z - x)) return x + Math.sqrt(rr * (z - x) * (y - x));
    return z - Math.sqrt((1 - rr) * (z - x) * (z - y));
  };
  const uuid = () => {
    const h = [];
    for (let i = 0; i < 32; i++) h.push(Math.floor(u() * 16).toString(16));
    return `${h.slice(0, 8).join("")}-${h.slice(8, 12).join("")}-${h.slice(12, 16).join("")}-${h.slice(16, 20).join("")}-${h.join("").slice(20)}`;
  };
  return { u, uni, int, normal, tri, uuid };
}

const round1 = (x) => Math.round(x * 10) / 10;
const sum = (arr) => arr.reduce((s, v) => s + v, 0);

// --- Placement mechanics. Rally boundaries are whole seconds throughout: every invariant is
// then exact integer arithmetic (no float eps anywhere), and the stored duration_s equals
// end_s − start_s exactly. Integer durations ≥3 keep §2's min after rounding. --------------

// Fixed-count placement (match/clip): draw integer durations, drop rallies that cannot fit
// (short clips — infeasibility is physical, see spec §1 density anchor), then split the
// leftover time budget into n+1 gaps with U(0,1)-weighted slack so points cluster naturally.
function placeBudget(rng, D, n) {
  const durs = Array.from({ length: n }, () => Math.max(RALLY_TRI.a, Math.round(rng.tri(RALLY_TRI.a, RALLY_TRI.c, RALLY_TRI.b))));
  let i = n;
  while (i > 0 && sum(durs.slice(0, i)) + HEAD_MIN + (i - 1) * (GAP_MIN + 1) + TAIL_MIN + 1 > D) i--;
  if (i === 0) {                                             // degenerate: not even one rally fits as drawn
    return D >= RALLY_TRI.a + HEAD_MIN + TAIL_MIN ? [{ s: HEAD_MIN, e: HEAD_MIN + RALLY_TRI.a }] : [];   // min-duration rally at the head
  }
  const ds = durs.slice(0, i);
  // Gap slots: head, inner ×(i−1), tail. Each gap gets its floor plus a U(0,1)-weighted share
  // of the one shared slack budget → placed rallies always leave ≥ TAIL_MIN+1 s before D.
  const floors = [HEAD_MIN, ...Array(i - 1).fill(GAP_MIN + 1), TAIL_MIN + 1];
  const weights = Array.from({ length: i + 1 }, () => rng.u());
  const W = sum(weights);
  const slack = D - sum(ds) - sum(floors);                   // ≥ 0 by the feasibility loop above
  let t = floors[0] + Math.floor((slack * weights[0]) / W);
  const out = [];
  for (let k = 0; k < i; k++) {
    const s = t, e = t + ds[k];
    out.push({ s, e });
    if (k === i - 1) break;
    t = e + floors[k + 1] + Math.floor((slack * weights[k + 1]) / W);
  }
  return out;
}

// Density-driven placement (summary): start-to-start point cycles ~ U(18,25) s (spec §1),
// clamped so the stored gap stays ≥ GAP_MIN and the rally leaves a clear tail. Count emerges ≈D/21.5.
function placeCycles(rng, D) {
  const out = [];
  let t = Math.ceil(rng.uni(HEAD_MIN, HEAD_MIN + 6));        // whole seconds from here on
  for (;;) {
    const d = Math.max(RALLY_TRI.a, Math.round(rng.tri(RALLY_TRI.a, RALLY_TRI.c, RALLY_TRI.b)));
    if (t + d > D - TAIL_MIN - 1) break;                     // §5.3: keep a ≥2 s tail after the last rally
    out.push({ s: t, e: t + d });
    const cycle = rng.uni(SUMMARY_CYCLE[0], SUMMARY_CYCLE[1]);   // §1 point cycle
    t = Math.max(Math.round(t + cycle), t + d + GAP_MIN + 1);    // gap ≥2 s wins over the cycle (§5.2)
  }
  return out;
}

// Baseline (spec §3: uniform [15,120] px/s with slow drift — shape is an assumption):
// slowly interpolated waypoints mixed with a fresh per-second uniform draw, hard-clamped to
// [BASELINE.min, BASELINE.max] so invariant 5 holds wherever no rally window covers the sample.
function genBaseline(rng, D) {
  const pts = [[0, rng.uni(BASELINE.min, BASELINE.max)]];
  while (pts[pts.length - 1][0] < D + 240) {
    const lastT = pts[pts.length - 1][0];
    pts.push([lastT + Math.round(rng.uni(60, 240)), rng.uni(BASELINE.min, BASELINE.max)]);
  }
  const base = new Float64Array(D);
  let k = 0;
  for (let i = 0; i < D; i++) {
    while (pts[k + 1][0] <= i) k++;
    const f = Math.min(1, (i - pts[k][0]) / (pts[k + 1][0] - pts[k][0]));
    base[i] = pts[k][1] * (1 - f) + pts[k + 1][1] * f;
  }
  for (let i = 0; i < D; i++) {                              // slow drift × fresh per-second uniform, clamped to the band
    const v = base[i] * 0.5 + rng.uni(BASELINE.min, BASELINE.max) * 0.5;
    base[i] = Math.min(BASELINE.max, Math.max(BASELINE.min, round1(v)));
  }
  return base;
}

// Stamp one rally's profile onto vals (initialized from the baseline). The window W_r is
// [s, floor(e + decay)]: spec §3 places the "~1–3 s decay after end_s" in the same region as
// the rally itself, so "outside all windows" (§5.5) means outside every W_r — that reading is
// what makes §5.4 (in-window max == peak exactly), §5.5 (≤120 elsewhere) and a multi-second
// decay simultaneously satisfiable. Decay is shortened only when the next point starts sooner
// than 3 s, which keeps windows disjoint (no sample owned by two rallies).
function stampRally(rng, vals, base, D, r, nextStart) {
  const P = round1(rng.uni(PEAK_RANGE[0], PEAK_RANGE[1]));   // §2; rounded once so rally row and sample store the exact same value
  r.peak = P;
  let decayMax = DECAY_SEC[1];
  if (nextStart !== undefined) decayMax = Math.min(decayMax, nextStart - r.e - 0.5);
  const decay = rng.uni(DECAY_SEC[0], Math.max(DECAY_SEC[0] + 0.5, decayMax));   // §3 ~1–3 s
  r._windowEnd = Math.min(D - 1, Math.floor(r.e + decay));
  const ramp = rng.uni(RAMP_SEC[0], RAMP_SEC[1]);            // §3 ~1–2 s ramp-to-profile
  const tp = Math.max(r.s, Math.min(r.e, Math.round(r.s + (r.e - r.s) * rng.uni(0.5, 0.85))));   // exact peak sample inside [s,e]
  for (let t = r.s; t <= r.e; t++) {                         // on-court phase: ramp then hold ≈ peak
    const rise = Math.max(0.2, Math.min(1, (t - r.s) / ramp));
    vals[t] = Math.min(round1(P * rise * rng.uni(0.88, 1)), P);
  }
  for (let t = r.e + 1; t <= r._windowEnd; t++) {            // decay: blend peak → local baseline (< P for all f > 0)
    const f = (t - r.e) / decay;
    vals[t] = round1(P * (1 - f) + base[t] * f);
  }
  vals[tp] = P;                                              // §5.4: in-window max == peak_intensity EXACTLY
}

// spec §5 coherence invariants, re-checked on the generated arrays before insert.
function validateVideo(v) {
  const rs = v.rallies;
  for (let i = 0; i < rs.length; i++) {
    const r = rs[i];
    if (i > 0 && r.s - rs[i - 1].e < GAP_MIN) throw new Error(`§5.2 gap < ${GAP_MIN} s in video ${v.id}`);   // exact integers
    if (r.e >= v.D || r.s < 0) throw new Error(`§5.3 rally outside [0, duration_s] in video ${v.id}`);
    let max = -Infinity;
    for (let t = r.s; t <= r.e; t++) max = Math.max(max, v.samples[t]);
    if (max !== r.peak) throw new Error(`§5.4 in-window max ${max} != peak ${r.peak} in video ${v.id}`);
  }
  const covered = new Uint8Array(v.D);                        // §5.5: outside all W_r → baseline band only
  for (const r of rs) for (let t = r.s; t <= r._windowEnd; t++) covered[t] = 1;
  for (let t = 0; t < v.D; t++) {
    if (!covered[t] && !(v.samples[t] >= BASELINE.min - 1e-9 && v.samples[t] <= BASELINE.max + 1e-9)) {
      throw new Error(`§5.5 out-of-window intensity ${v.samples[t]} outside [${BASELINE.min},${BASELINE.max}] at t=${t} in video ${v.id}`);
    }
  }
}

// --- Per-video generation (fixed PRNG draw order → reproducible) -----------------------

function genVideo(rng, type, nowMs, isFlat) {
  const D = Math.round(rng.uni(...DURATIONS[type]));          // whole seconds; one intensity row per second (§3)
  let rallies = [];
  if (!isFlat) {
    if (type === "match") {
      const n = Math.max(MATCH_COUNT.min, Math.min(MATCH_COUNT.max, Math.round(rng.normal(MATCH_COUNT.mu, MATCH_COUNT.sd))));   // §1 clamped normal
      rallies = placeBudget(rng, D, n);
    } else if (type === "clip") {
      rallies = placeBudget(rng, D, rng.int(CLIP_COUNT[0], CLIP_COUNT[1]));   // §1 Uniform{1..6}
    } else if (type === "summary") {
      rallies = placeCycles(rng, D);                                   // §1 point cycles; count emerges ≈D/21.5
    }
  }

  const base = genBaseline(rng, D);
  const vals = Float64Array.from(base);
  for (let i = 0; i < rallies.length; i++) {
    stampRally(rng, vals, base, D, rallies[i], rallies[i + 1] ? rallies[i + 1].s : undefined);
  }

  // §5.6 one done job per video: queue delay ~seconds, finished−started ≈ duration × U(1.0,2.5).
  const createdMs = nowMs - rng.uni(0, CREATED_SPREAD_DAYS * 86400e3);      // §5.8 last-90-days spread
  const jobCreatedMs = createdMs + rng.uni(0.2, 1) * 1000;                  // upload enqueues the job immediately after
  const startedMs = createdMs + rng.uni(JOB_DELAY_SEC[0], JOB_DELAY_SEC[1]) * 1000;
  const finishedMs = startedMs + D * 1000 * rng.uni(JOB_TIME_MULT[0], JOB_TIME_MULT[1]);

  // §5.7 ~60% carry a saved calibration drawn around the observed real-config ranges.
  let cal = null;
  if (rng.u() < CALIBRATION_SHARE) {
    const netX = round2(rng.uni(...CAL_RANGE.netX));
    let left, right;
    for (let i = 0;; i++) {                              // "right ≈ mirror" of left across the net line (§5.7)
      left = rng.uni(...CAL_RANGE.left);
      right = round2(2 * netX - left + rng.uni(...CAL_RANGE.rightJitter));
      if (right < 0.97 && right > netX + 0.05) break;    // keep the mirror geometrically valid inside [0,1]
      if (i >= 24) { right = Math.min(right, 0.96); break; }   // deterministic escape in the rare corner case
    }
    const sgn = () => (rng.u() < 0.5 ? -1 : 1);
    cal = {
      netX, left: round2(left), right,
      top: round2(rng.uni(...CAL_RANGE.top)), bottom: round2(rng.uni(...CAL_RANGE.bottom)),
      netY: round2(rng.uni(...CAL_RANGE.netY)),
      leftTilt: round2(sgn() * rng.uni(...CAL_RANGE.tiltMag)),
      rightTilt: round2(sgn() * rng.uni(...CAL_RANGE.tiltMag)),
    };
  }

  const v = { id: rng.uuid(), type, D, rallies, samples: vals, isFlat, createdMs, jobCreatedMs, startedMs, finishedMs, cal };
  validateVideo(v);
  return v;
}

function round2(x) { return Math.round(x * 100) / 100; }

// --- Bulk insert (multi-row VALUES chunks, same pattern as server.js mirroring) ---------

async function insertRows(conn, table, columns, rows) {
  for (let i = 0; i < rows.length; i += INSERT_CHUNK) {
    const slice = rows.slice(i, i + INSERT_CHUNK);
    const ph = Array.from({ length: slice.length }, () => `(${columns.map(() => "?").join(",")})`).join(",");
    const params = [];
    for (const row of slice) params.push(...row);
    await conn.query(`INSERT INTO ${table} (${columns.join(", ")}) VALUES ${ph}`, params);
  }
}

const MIX_TOTAL = Object.values(MIX).reduce((s, n) => s + n, 0);
if (MIX_TOTAL !== VIDEO_COUNT) throw new Error(`MIX must sum to ${VIDEO_COUNT} videos (spec §4), got ${MIX_TOTAL}`);

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is not set. Run it with the server's database, e.g.:");
    console.error('  DATABASE_URL="mysql://oliver:oliver_dev_password@localhost:3306/oliver" npm run seed -- --fresh');
    console.error("or inside compose: docker compose exec server npm run seed -- --fresh");
    process.exit(1);
  }
  const fresh = process.argv.includes("--fresh");
  const pool = getPool();
  const conn = await pool.getConnection();
  try {
    if (fresh) {
      // Documented danger: wipes ALL six tables — real uploads and their analysis data included.
      // That is the point of a clean volume dataset; hence the explicit --fresh flag.
      await conn.query("SET SESSION FOREIGN_KEY_CHECKS = 0");
      for (const t of ["intensity_samples", "rallies", "reports", "calibrations", "jobs", "videos"]) {
        await conn.query(`TRUNCATE TABLE ${t}`);
      }
      await conn.query("SET SESSION FOREIGN_KEY_CHECKS = 1");
    } else {
      const [[{ n }]] = await conn.query("SELECT COUNT(*) AS n FROM videos");
      if (n > 0) {
        console.error(`refusing to seed a non-empty database: videos has ${n} row(s).`);
        console.error("--fresh TRUNCATEs all six tables, including real uploads — that is deliberate for a clean volume dataset.");
        console.error("To proceed anyway: npm run seed -- --fresh   (or: docker compose exec server npm run seed -- --fresh)");
        process.exit(1);
      }
    }

    const t0 = Date.now();
    const rng = makeRng();
    // Flat sessions: pick FLAT_MATCHES distinct match indices up front (§4). Draw order fixed.
    const flatSet = new Set();
    while (flatSet.size < FLAT_MATCHES) flatSet.add(rng.int(0, MIX.match - 1));

    // Wall-clock anchor for §5.8 only — never fed back into the PRNG stream, so structure,
    // ids and every rally row are identical on re-runs; only absolute timestamps shift.
    const nowMs = Date.now();
    const vids = [];
    let matchIdx = 0;
    for (const [type, count] of Object.entries(MIX)) {      // MIX key order: match, clip, summary
      for (let i = 0; i < count; i++) {
        const isFlat = type === "match" && flatSet.has(matchIdx);
        if (type === "match") matchIdx++;
        vids.push(genVideo(rng, type, nowMs, isFlat));
      }
    }

    // size_bytes stays NULL: seeded videos have no media files by design (spec §5.10).
    const videoRows = vids.map((v) => [v.id, `${v.id}.mp4`, null, v.D, new Date(v.createdMs)]);
    const jobRows = vids.map((v) => [v.id, v.id, "done", null, 1, new Date(v.jobCreatedMs), new Date(v.startedMs), new Date(v.finishedMs)]);
    const calRows = vids.filter((v) => v.cal).map((v) => [v.id, v.cal.netX, v.cal.left, v.cal.right, v.cal.top, v.cal.bottom, v.cal.netY, v.cal.leftTilt, v.cal.rightTilt]);
    const rallyRows = [];
    for (const v of vids) for (const r of v.rallies) {
      rallyRows.push([v.id, r.s, r.e, r.e - r.s, r.peak]);   // peak drawn during stamping; duration_s == end_s − start_s exactly
    }

    await insertRows(conn, "videos", ["id", "filename", "size_bytes", "duration_s", "created_at"], videoRows);
    await insertRows(conn, "jobs", ["id", "video_id", "status", "error", "attempts", "created_at", "started_at", "finished_at"], jobRows);
    await insertRows(conn, "calibrations", ["video_id", "net_x", "`left`", "`right`", "`top`", "`bottom`", "net_y", "left_tilt", "right_tilt"], calRows);

    await insertRows(conn, "rallies", ["video_id", "start_s", "end_s", "duration_s", "peak_intensity"], rallyRows);

    // Intensity samples: one row per second per video (§3). Flat param array, chunked inserts.
    const params = [];
    for (const v of vids) for (let t = 0; t < v.D; t++) params.push(v.id, t, v.samples[t]);
    for (let i = 0; i < params.length; i += INSERT_CHUNK * 3) {
      const slice = params.slice(i, i + INSERT_CHUNK * 3);
      const ph = Array.from({ length: slice.length / 3 }, () => "(?,?,?)").join(",");
      await conn.query(`INSERT INTO intensity_samples (video_id, t_s, intensity) VALUES ${ph}`, slice);
    }

    const tables = ["videos", "jobs", "rallies", "intensity_samples", "calibrations", "reports"];
    console.log(`seed complete in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    let ok = true;
    for (const t of tables) {
      const [[{ n }]] = await conn.query(`SELECT COUNT(*) AS n FROM ${t}`);
      console.log(`${t}: ${n.toLocaleString("en-US")}`);
      if (t === "intensity_samples" && n < MIN_INTENSITY_ROWS) ok = false;
    }
    const byType = {};
    for (const v of vids) {
      byType[v.type] = byType[v.type] || { videos: 0, rallies: 0 };
      byType[v.type].videos++;
      byType[v.type].rallies += v.rallies.length;
    }
    console.log("by type: " + Object.entries(byType).map(([t, s]) => `${t}=${s.videos} videos / ${s.rallies.toLocaleString("en-US")} rallies`).join(", "));
    const flatIds = [...flatSet].map((i) => vids[i].id);
    console.log(`eyeball: flat sessions (0 rallies) = [${flatIds.join(", ")}]`);
    console.log("note: created_at/job timestamps anchor to run time by design (spec §5.8 'last 90 days'); all structure, ids and rally rows are PRNG-fixed.");

    if (!ok) {
      console.error(`FAIL: intensity_samples below ${MIN_INTENSITY_ROWS.toLocaleString("en-US")} — spec §4 violation`);
      process.exitCode = 1;
    }
  } finally {
    conn.release();
    await pool.end();
  }
}

main().catch((err) => {
  if (err.code === "ER_NO_SUCH_TABLE") {
    console.error(`seed failed: missing table (${err.message}). Run migrations first: npm run migrate`);
    process.exit(1);
  }
  console.error(`seed failed: ${err.stack || err.message}`);
  process.exit(1);
});
