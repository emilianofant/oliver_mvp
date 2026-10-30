const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { Queue, Worker } = require("bullmq");
const { query } = require("./db");

const ROOT = path.join(__dirname, "..", "..");
const ANALYSIS_DIR = path.join(ROOT, "data", "analysis");
const QUEUE_NAME = "analyze";
const ERROR_TAIL_MAX_BYTES = 2048; // ~2 KB stderr tail stored on failed jobs

let queue = null;
function getQueue() {
  if (!queue) queue = new Queue(QUEUE_NAME, { connection: redisOptions() });
  return queue;
}

// Producer: enqueue analysis for a video whose DB rows already exist.
async function enqueueAnalyze(videoId) {
  // attempts=1: single-attempt semantics (terminal failed). Retry cap/backoff is UPL-02.
  await getQueue().add("analyze", { videoId }, { jobId: videoId, attempts: 1 });
}

function redisOptions() {
  const url = new URL(process.env.REDIS_URL);
  return { host: url.hostname, port: Number(url.port || 6379) };
}

function tail(text, n) {
  return text.length > n ? text.slice(-n) : text;
}

// UTC second-precision, matches the DATETIME columns.
function nowSql() {
  return new Date().toISOString().slice(0, 19).replace("T", " ");
}

async function processor(job) {
  const { videoId } = job.data;
  const inputPath = path.join(ROOT, "data", "uploads", `${videoId}.mp4`);
  const outFile = `data/analysis/${videoId}.json`;
  await new Promise((resolve, reject) => {
    console.log(`[analyze] start id=${videoId}`);
    const startedAt = Date.now();
    let stderr = "";
    const child = spawn(
      process.env.PYTHON_BIN || path.join(ROOT, ".venv", "bin", "python"),
      ["python/analyze.py", "--input", inputPath, "--output", outFile],
      { cwd: ROOT },
    );
    child.stdout.on("data", () => {}); // per-frame progress; drain only
    child.stderr.on("data", (d) => { stderr += d.toString(); });
    child.on("error", (err) => reject(new Error(`spawn failed: ${err.message}`)));
    child.on("close", (code) => {
      console.log(`[analyze] id=${videoId} exit code=${code} after ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
      if (code === 0) return resolve();
      reject(new Error(tail(stderr.trim(), ERROR_TAIL_MAX_BYTES)));
    });
  });
}

// DB mirrors — the jobs table is the source of truth for all API reads.
async function onActive(job) {
  await query("UPDATE jobs SET status='processing', started_at=?, attempts=attempts+1 WHERE id=?", [nowSql(), job.data.videoId]);
}

async function onCompleted(job) {
  const videoId = job.data.videoId;
  let durationSec = null;
  try {
    const analysis = JSON.parse(fs.readFileSync(path.join(ANALYSIS_DIR, `${videoId}.json`), "utf8"));
    if (Number.isFinite(analysis.meta.durationSec)) durationSec = analysis.meta.durationSec;
  } catch (_e) {
    console.warn(`[analyze] job ${videoId} completed but analysis meta could not be read`);
  }
  await query("UPDATE jobs SET status='done', finished_at=? WHERE id=?", [nowSql(), videoId]);
  await query("UPDATE videos SET duration_s=? WHERE id=?", [durationSec, videoId]);
}

// Single-attempt: a failed job is terminal here. UPL-02 adds the retry cap/backoff in this handler.
async function onFailed(job, err) {
  const message = tail(err ? String(err.message || err) : "unknown error", ERROR_TAIL_MAX_BYTES);
  console.error(`[analyze] job ${job.data.videoId} failed: ${message}`);
  await query("UPDATE jobs SET status='failed', error=?, finished_at=? WHERE id=?", [message, nowSql(), job.data.videoId]);
}

function startWorker() {
  const concurrency = Math.max(1, Number(process.env.ANALYZE_CONCURRENCY ?? 1));
  console.log(`[analyze] worker starting (concurrency=${concurrency})`);
  const worker = new Worker(QUEUE_NAME, processor, { connection: redisOptions(), concurrency });

  // Rows are inserted as 'queued' in server.js; the BullMQ Worker emits no waiting/delayed event.
  // Mirror handlers must never take the process down (DB hiccups during a restart window).
  worker.on("active", (job) => onActive(job).catch((err) => console.error(`[analyze] onActive mirror failed: ${err.message}`)));
  worker.on("completed", (job) => onCompleted(job).catch((err) => console.error(`[analyze] onCompleted mirror failed: ${err.message}`)));
  worker.on("failed", (job, err) => onFailed(job, err).catch((e2) => console.error(`[analyze] onFailed mirror failed (${err ? String(err.message || err) : "?"}): ${e2.message}`)));

  return worker;
}

module.exports = { enqueueAnalyze, startWorker };
