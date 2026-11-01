const crypto = require("crypto");
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const express = require("express");
const multer = require("multer");
const { getPool, query, runMigrations } = require("./lib/db");
const { enqueueAnalyze, startWorker } = require("./lib/analyzeQueue");

const ROOT = path.join(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data");
const UPLOADS_DIR = path.join(DATA_DIR, "uploads");
const CLIPS_DIR = path.join(DATA_DIR, "clips");
const ANALYSIS_DIR = path.join(DATA_DIR, "analysis");
const COURT_DIR = path.join(DATA_DIR, "court");

for (const dir of [UPLOADS_DIR, CLIPS_DIR, ANALYSIS_DIR, COURT_DIR]) {
  fs.mkdirSync(dir, { recursive: true });
}

function tail(text, n) {
  return text.length > n ? text.slice(-n) : text;
}

// Runs a child process, drains stdout (analyze.py prints per-frame progress), keeps the stderr tail.
function runCmd(label, bin, args, onDone) {
  let stderr = "";
  const startedAt = Date.now();
  console.log(`[${label}] spawn: ${bin} ${args.join(" ")}`);
  const child = spawn(bin, args, { cwd: ROOT });
  child.stdout.on("data", () => {});
  child.stderr.on("data", (d) => { stderr += d.toString(); });
  child.on("error", (err) => {
    console.error(`[${label}] spawn failed: ${err.message}`);
    onDone(err, stderr);
  });
  child.on("close", (code) => {
    console.log(`[${label}] exited code=${code} after ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
    const err = code === 0 ? null : new Error(`exit code ${code}`);
    onDone(err, tail(stderr.trim(), 1000));
  });
}

// REP-03: chunked multi-row inserts so derived-data mirroring stays correct as data grows.
const INSERT_CHUNK_ROWS = 5000;

async function insertRows(conn, table, columns, rows) {
  for (let i = 0; i < rows.length; i += INSERT_CHUNK_ROWS) {
    const slice = rows.slice(i, i + INSERT_CHUNK_ROWS);
    const placeholders = Array.from({ length: slice.length }, () => `(${columns.map(() => "?").join(",")})`).join(",");
    const params = [];
    for (const row of slice) params.push(...row);
    await conn.query(`INSERT INTO ${table} (${columns.join(", ")}) VALUES ${placeholders}`, params);
  }
}

// REP-03: per-video transaction — replace rallies + intensity_samples from derived.json (values copied verbatim),
// then invalidate that video's cached reports. Idempotent: re-running yields identical row sets.
async function mirrorDerivedToDb(videoId, derived) {
  if (!Array.isArray(derived.rallies)) throw new Error("derived.json missing 'rallies' array");
  if (!Array.isArray(derived.timeSeries1s)) throw new Error("derived.json missing 'timeSeries1s' array");
  const rallyRows = [];
  for (const r of derived.rallies) {
    const row = [videoId, r.startT, r.endT, r.durationSec, r.peakIntensityPxPerSec];
    if (!row.slice(1).every((v) => Number.isFinite(v))) throw new Error(`invalid rally entry: ${JSON.stringify(r)}`);
    rallyRows.push(row);
  }
  const sampleRows = [];
  for (const p of derived.timeSeries1s) {
    if (!Number.isInteger(p.t)) throw new Error(`invalid timeSeries1s t: ${JSON.stringify(p)}`);
    if (!(p.intensity === null || Number.isFinite(p.intensity))) throw new Error(`invalid timeSeries1s intensity: ${JSON.stringify(p)}`);
    sampleRows.push([videoId, p.t, p.intensity]);
  }
  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    await conn.query("DELETE FROM rallies WHERE video_id = ?", [videoId]);
    await conn.query("DELETE FROM intensity_samples WHERE video_id = ?", [videoId]);
    await insertRows(conn, "rallies", ["video_id", "start_s", "end_s", "duration_s", "peak_intensity"], rallyRows);
    await insertRows(conn, "intensity_samples", ["video_id", "t_s", "intensity"], sampleRows);
    await conn.query("DELETE FROM reports WHERE video_id = ?", [videoId]);
    await conn.commit();
  } catch (err) {
    try { await conn.rollback(); } catch (_rollbackErr) {}
    throw err;
  } finally {
    conn.release();
  }
}

const app = express();
app.use(express.json());
app.use("/data", express.static(DATA_DIR));

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
    filename: (_req, _file, cb) => cb(null, `${crypto.randomUUID()}.mp4`),
  }),
  fileFilter: (_req, file, cb) => {
    if (!/\.mp4$/i.test(file.originalname)) {
      return cb(Object.assign(new Error("only .mp4 files are accepted"), { statusCode: 400 }));
    }
    cb(null, true);
  },
});

// REP-03: queryable rally rows with filters/sort/pagination. DB is source of truth for this endpoint.
const RALLY_ORDER_BY = { intensity: "peak_intensity", duration: "duration_s", start: "start_s" };

app.get("/api/rallies", async (req, res) => {
  const q = req.query;
  const where = [];
  const params = [];
  if (q.video_id !== undefined) {
    if (typeof q.video_id !== "string" || q.video_id === "") return res.status(400).json({ error: "video_id must be a non-empty string" });
    where.push("r.video_id = ?");
    params.push(q.video_id);
  }
  for (const [key, op] of [["date_from", ">="], ["date_to", "<="]]) {
    if (q[key] === undefined) continue;
    const d = new Date(q[key]);
    if (Number.isNaN(d.getTime())) return res.status(400).json({ error: `${key} must be an ISO date` });
    where.push(`v.created_at ${op} ?`);
    params.push(d);
  }
  if (q.min_duration_s !== undefined) {
    const v = Number(q.min_duration_s);
    if (!Number.isFinite(v) || v < 0) return res.status(400).json({ error: "min_duration_s must be a number >= 0" });
    where.push("r.duration_s >= ?");
    params.push(v);
  }
  const orderBy = q.order_by === undefined ? "start" : q.order_by;
  if (!Object.prototype.hasOwnProperty.call(RALLY_ORDER_BY, orderBy)) {
    return res.status(400).json({ error: "order_by must be one of intensity|duration|start" });
  }
  const order = q.order === undefined ? (orderBy === "start" ? "asc" : "desc") : q.order;
  if (order !== "asc" && order !== "desc") return res.status(400).json({ error: "order must be asc or desc" });
  const page = q.page === undefined ? 1 : Number(q.page);
  if (!Number.isInteger(page) || page < 1) return res.status(400).json({ error: "page must be an integer >= 1" });
  const perPage = q.per_page === undefined ? 20 : Number(q.per_page);
  if (!Number.isInteger(perPage) || perPage < 1 || perPage > 100) return res.status(400).json({ error: "per_page must be an integer between 1 and 100" });
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  try {
    const countRows = await query(
      `SELECT COUNT(*) AS n FROM rallies r JOIN videos v ON v.id = r.video_id ${whereSql}`,
      params,
    );
    const total = Number(countRows[0].n);
    const rows = await query(
      `SELECT r.id, r.video_id AS videoId, r.start_s AS startS, r.end_s AS endS,
              r.duration_s AS durationS, r.peak_intensity AS peakIntensityPxPerSec,
              v.filename, v.created_at AS createdAt
       FROM rallies r JOIN videos v ON v.id = r.video_id ${whereSql}
       ORDER BY r.${RALLY_ORDER_BY[orderBy]} ${order.toUpperCase()}, r.id ASC
       LIMIT ? OFFSET ?`,
      [...params, perPage, (page - 1) * perPage],
    );
    res.json({ items: rows, total, page, perPage });
  } catch (err) {
    console.error(`[rallies] GET /api/rallies: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// Upload stays synchronous (byte transfer); only analysis is queued.
app.post("/api/videos", upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "missing 'file' file field" });
  const id = path.parse(req.file.filename).name;
  try {
    // Strict order: file on disk before DB rows, DB rows before enqueue.
    await query("INSERT INTO videos (id, filename, size_bytes) VALUES (?, ?, ?)", [id, req.file.originalname, req.file.size]);
    await query("INSERT INTO jobs (id, video_id, status) VALUES (?, ?, 'queued')", [id, id]);
    await enqueueAnalyze(id);
  } catch (err) {
    console.error(`[videos] failed for ${req.file.path}: ${err.message}`);
    return res.status(500).json({ error: `failed to register upload: ${err.message}` });
  }
  console.log(`[videos] queued id=${id} original=${req.file.originalname} (${req.file.size} bytes)`);
  res.status(202).json({ jobId: id });
});

function jobToJson(r) {
  return { jobId: r.id, status: r.status, error: r.error, attempts: r.attempts, createdAt: r.created_at, startedAt: r.started_at, finishedAt: r.finished_at };
}

app.get("/api/jobs/:id", async (req, res) => {
  try {
    const rows = await query("SELECT * FROM jobs WHERE id = ?", [req.params.id]);
    if (rows.length === 0) return res.status(404).json({ error: `unknown job ${req.params.id}` });
    res.json(jobToJson(rows[0]));
  } catch (err) {
    console.error(`[jobs] GET /api/jobs/${req.params.id}: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/videos", async (_req, res) => {
  try {
    const rows = await query(
      `SELECT v.id, v.filename, v.size_bytes, v.duration_s, v.created_at,
              j.status, j.error, j.attempts, j.started_at, j.finished_at
       FROM videos v LEFT JOIN jobs j ON j.video_id = v.id
       ORDER BY v.created_at DESC`,
    );
    res.json(rows.map((r) => ({
      id: r.id,
      filename: r.filename,
      sizeBytes: Number(r.size_bytes),
      durationSec: r.duration_s,
      createdAt: r.created_at,
      videoUrl: `/data/uploads/${r.id}.mp4`,
      job: r.status ? { status: r.status, error: r.error, attempts: r.attempts, startedAt: r.started_at, finishedAt: r.finished_at } : null,
    })));
  } catch (err) {
    console.error(`[videos] GET /api/videos: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/analytics", (req, res) => {
  const { source } = req.body || {};
  console.log(`[analytics] request source=${source}`);
  const name = typeof source === "string" ? path.basename(source) : "";
  if (!name) {
    console.error(`[analytics] rejected: invalid source (source=${JSON.stringify(source)})`);
    return res.status(400).json({ error: `source must be a file name string (got ${JSON.stringify(source)})` });
  }
  const id = path.parse(name).name;
  const analysisPath = `data/analysis/${id}.json`;
  if (!fs.existsSync(path.join(ROOT, analysisPath))) {
    console.error(`[analytics] rejected: no analysis for source=${name}`);
    return res.status(404).json({ error: "no analysis for this clip" });
  }
  const savedCourtPath = path.join(COURT_DIR, `${id}.json`);
  const courtSource = fs.existsSync(savedCourtPath) ? "saved" : "defaults";
  const courtFile = courtSource === "saved" ? `data/court/${id}.json` : "python/court-defaults.json";
  const outFile = `data/analysis/${id}-derived.json`;
  runCmd(
    "analytics",
    process.env.PYTHON_BIN || path.join(ROOT, ".venv", "bin", "python"),
    ["python/metrics.py", "--input", analysisPath, "--court", courtFile, "--output", outFile],
    async (err, stderrTail) => {
      if (err) return res.status(500).json({ error: `analytics failed (${err.message}): ${stderrTail}` });
      let derived;
      try {
        derived = JSON.parse(fs.readFileSync(path.join(ROOT, outFile), "utf8"));
      } catch (_e) {
        console.error(`[analytics] could not read derived output: ${outFile}`);
        return res.status(500).json({ error: `could not read derived output: ${outFile}` });
      }
      try {
        await mirrorDerivedToDb(id, derived);
      } catch (err) {
        console.error(`[analytics] db mirror failed for ${id}: ${err.message}`);
        return res.status(500).json({ error: `derived.json not mirrored to database: ${err.message}` });
      }
      console.log(`[analytics] done id=${id} courtSource=${courtSource} rallies=${derived.rallies.length}`);
      res.json({ courtSource, derivedPath: `/data/analysis/${id}-derived.json`, derived });
    },
  );
});

app.post("/api/trim-highlight", (req, res) => {
  const { source, start, duration } = req.body || {};
  console.log(`[trim] request source=${source} start=${start} duration=${duration}`);
  if (!Number.isFinite(start) || start < 0 || !Number.isFinite(duration) || duration <= 0) {
    console.error(`[trim] rejected: invalid start/duration (start=${start}, duration=${duration})`);
    return res.status(400).json({ error: "start must be >= 0 and duration > 0" });
  }
  const name = typeof source === "string" ? path.basename(source) : "";
  const srcPath = path.join(UPLOADS_DIR, name);
  if (!name || !fs.existsSync(srcPath) || !fs.statSync(srcPath).isFile()) {
    console.error(`[trim] rejected: source not found in uploads (source=${JSON.stringify(source)})`);
    return res.status(400).json({ error: `source not found in uploads: ${JSON.stringify(source)}` });
  }
  const outName = `${crypto.randomUUID()}.mp4`;
  runCmd("trim", "ffmpeg", [
    "-y",
    "-ss", String(start), "-t", String(duration),
    "-i", srcPath,
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "28",
    "-c:a", "aac",
    path.join(CLIPS_DIR, outName),
  ], (err) => {
    if (err) return res.status(500).json({ error: `trim failed (${err.message})` });
    console.log(`[trim] done clip=clips/${outName}`);
    res.json({ clipUrl: `/data/clips/${outName}` });
  });
});

app.post("/api/court", async (req, res) => {
  const { source, court } = req.body || {};
  const name = typeof source === "string" ? path.basename(source) : "";
  const srcPath = path.join(UPLOADS_DIR, name);
  if (!name || !fs.existsSync(srcPath) || !fs.statSync(srcPath).isFile()) {
    console.error(`[court] rejected: source not found in uploads (source=${JSON.stringify(source)})`);
    return res.status(400).json({ error: `source not found in uploads: ${JSON.stringify(source)}` });
  }
  const keys = ["netX", "left", "right", "top", "bottom"];
  if (!court || typeof court !== "object" || !keys.every((k) => Number.isFinite(court[k]) && court[k] >= 0 && court[k] <= 1)) {
    return res.status(400).json({ error: "court must have numeric netX/left/right/top/bottom in [0,1]" });
  }
  if (!(court.left < court.netX && court.netX < court.right && court.top < court.bottom)) {
    return res.status(400).json({ error: "court must satisfy left < netX < right and top < bottom" });
  }
  const leftTilt = req.body.leftTilt;
  const rightTilt = req.body.rightTilt;
  for (const t of [leftTilt, rightTilt]) {
    if (t !== undefined && (!Number.isFinite(t) || Math.abs(t) > 1)) {
      return res.status(400).json({ error: "edge tilts must be numbers in [-1,1]" });
    }
  }
  const netY = req.body.netY;
  if (netY !== undefined && (!Number.isFinite(netY) || netY < 0 || netY > 1)) {
    return res.status(400).json({ error: "netY must be a number in [0,1]" });
  }
  const base = JSON.parse(fs.readFileSync(path.join(ROOT, "python", "court-defaults.json"), "utf8"));
  if (Number.isFinite(req.body.videoWidth) && req.body.videoWidth > 0) base.frameWidthPx = Math.round(req.body.videoWidth);
  if (Number.isFinite(req.body.videoHeight) && req.body.videoHeight > 0) base.frameHeightPx = Math.round(req.body.videoHeight);
  base.court = { netX: court.netX, left: court.left, right: court.right, top: court.top, bottom: court.bottom };
  if (netY !== undefined) base.court.netY = netY;
  if (leftTilt !== undefined) base.court.leftTilt = leftTilt;
  if (rightTilt !== undefined) base.court.rightTilt = rightTilt;
  const id = path.parse(name).name;
  const outName = `${id}.json`;
  fs.writeFileSync(path.join(COURT_DIR, outName), JSON.stringify(base, null, 2) + "\n");
  console.log(`[court] saved data/court/${outName}`);
  try {
    await query(
      `INSERT INTO calibrations (video_id, net_x, \`left\`, \`right\`, \`top\`, \`bottom\`, net_y, left_tilt, right_tilt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE net_x = VALUES(net_x), \`left\` = VALUES(\`left\`),
         \`right\` = VALUES(\`right\`), \`top\` = VALUES(\`top\`), \`bottom\` = VALUES(\`bottom\`),
         net_y = VALUES(net_y), left_tilt = VALUES(left_tilt), right_tilt = VALUES(right_tilt)`,
      [id, court.netX, court.left, court.right, court.top, court.bottom,
       netY === undefined ? null : netY, leftTilt === undefined ? null : leftTilt, rightTilt === undefined ? null : rightTilt],
    );
  } catch (err) {
    console.error(`[court] calibration upsert failed for ${outName}: ${err.message}`);
    return res.status(500).json({ error: `calibration saved to file but database update failed: ${err.message}` });
  }
  res.json({ saved: `data/court/${outName}` });
});

app.get("/api/court", (req, res) => {
  const name = typeof req.query.file === "string" ? path.basename(req.query.file) : "";
  const outName = name ? `${path.parse(name).name}.json` : "";
  const filePath = path.join(COURT_DIR, outName);
  if (!outName || !fs.existsSync(filePath)) return res.status(404).json({ error: `no court config for ${JSON.stringify(req.query.file)}` });
  res.json(JSON.parse(fs.readFileSync(filePath, "utf8")));
});

app.use((err, _req, res, _next) => {
  const status = err.statusCode || 500;
  if (!res.headersSent) res.status(status).json({ error: err.message });
});

// Boot: apply pending migrations (idempotent), start the analysis worker, then listen.
runMigrations()
  .then(() => {
    startWorker();
    app.listen(3001, () => console.log("listening on http://localhost:3001"));
  })
  .catch((err) => {
    console.error(`[db] migrations failed at boot: ${err.message}`);
    process.exit(1);
  });
