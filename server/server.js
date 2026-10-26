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

for (const dir of [UPLOADS_DIR, CLIPS_DIR, ANALYSIS_DIR]) {
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

app.use((err, _req, res, _next) => {
  const status = err.statusCode || 500;
  if (!res.headersSent) res.status(status).json({ error: err.message });
});

app.listen(3001, () => console.log("listening on http://localhost:3001"));
