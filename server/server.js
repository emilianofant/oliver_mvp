const crypto = require("crypto");
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");
const express = require("express");
const multer = require("multer");

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

app.post("/api/upload", upload.single("video"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "missing 'video' file field" });
  const id = path.parse(req.file.filename).name;
  console.log(`[upload] received ${req.file.originalname} (${req.file.size} bytes), saved as uploads/${req.file.filename}`);
  const outFile = `data/analysis/${id}.json`;
  runCmd(
    "analyze",
    process.env.PYTHON_BIN || path.join(ROOT, ".venv", "bin", "python"),
    ["python/analyze.py", "--input", req.file.path, "--output", outFile],
    (err, stderrTail) => {
      if (err) return res.status(500).json({ error: `analysis failed (${err.message}): ${stderrTail}` });
      let analysis;
      try {
        analysis = JSON.parse(fs.readFileSync(path.join(ROOT, outFile), "utf8"));
      } catch (_e) {
        console.error(`[upload] could not read analysis output: ${outFile}`);
        return res.status(500).json({ error: `could not read analysis output: ${outFile}` });
      }
      console.log(`[upload] done id=${id} frames=${analysis.frames.length} segments=${analysis.segments.length}`);
      res.json({ status: "ok", id, videoUrl: `/data/uploads/${req.file.filename}` });
    },
  );
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
    (err, stderrTail) => {
      if (err) return res.status(500).json({ error: `analytics failed (${err.message}): ${stderrTail}` });
      let derived;
      try {
        derived = JSON.parse(fs.readFileSync(path.join(ROOT, outFile), "utf8"));
      } catch (_e) {
        console.error(`[analytics] could not read derived output: ${outFile}`);
        return res.status(500).json({ error: `could not read derived output: ${outFile}` });
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

app.post("/api/court", (req, res) => {
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
  const outName = `${path.parse(name).name}.json`;
  fs.writeFileSync(path.join(COURT_DIR, outName), JSON.stringify(base, null, 2) + "\n");
  console.log(`[court] saved data/court/${outName}`);
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

app.listen(3001, () => console.log("listening on http://localhost:3001"));
