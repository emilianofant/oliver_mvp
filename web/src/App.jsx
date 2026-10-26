import React, { useRef, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const SPIKE_WINDOW_SECONDS = 5;

function formatTime(seconds) {
  const s = Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
}

function toSeconds(value) {
  const n = parseFloat(String(value));
  return Number.isFinite(n) ? n : null;
}

function numToStr(n) {
  return String(Math.round((n + Number.EPSILON) * 100) / 100);
}

// Sliding 5 s window over frames (full windows only), maximizing mean of non-null intensity.
function findStrongestSpike(frames) {
  const pts = frames.filter((f) => f.intensity != null).map((f) => ({ t: f.t, v: f.intensity }));
  if (pts.length === 0) return null;
  const maxT = pts[pts.length - 1].t;
  let bestStart = null;
  let bestMean = -Infinity;
  let sum = 0;
  let j = 0;
  for (let i = 0; i < pts.length; i++) {
    while (j < pts.length && pts[j].t <= pts[i].t + SPIKE_WINDOW_SECONDS) {
      sum += pts[j].v;
      j += 1;
    }
    if (pts[i].t + SPIKE_WINDOW_SECONDS <= maxT) {
      const mean = sum / (j - i);
      if (mean > bestMean) {
        bestMean = mean;
        bestStart = pts[i].t;
      }
    }
    sum -= pts[i].v;
  }
  if (bestStart == null) bestStart = Math.max(pts[0].t, maxT - SPIKE_WINDOW_SECONDS);
  return [bestStart, bestStart + SPIKE_WINDOW_SECONDS];
}

function UploadZone({ onFile, uploading }) {
  const inputRef = useRef(null);
  const [dragOver, setDragOver] = useState(false);

  function pick(file) {
    if (!file || uploading) return;
    onFile(file);
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => inputRef.current && inputRef.current.click()}
      onKeyDown={(e) => e.key === "Enter" && inputRef.current && inputRef.current.click()}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        pick(e.dataTransfer.files && e.dataTransfer.files[0]);
      }}
      className={`flex cursor-pointer items-center justify-center gap-3 rounded-lg border-2 border-dashed p-6 text-center ${
        dragOver ? "border-blue-500 bg-blue-50" : "border-gray-300"
      }`}
    >
      {uploading ? (
        <>
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-gray-300 border-t-blue-600" />
          <span>Processing video…</span>
        </>
      ) : (
        <span>Drag &amp; drop an .mp4 here, or click to browse</span>
      )}
      <input
        ref={inputRef}
        type="file"
        accept=".mp4,video/mp4"
        className="hidden"
        onChange={(e) => {
          pick(e.target.files && e.target.files[0]);
          e.target.value = "";
        }}
      />
    </div>
  );
}

function ChartTooltip({ active, payload }) {
  if (!active || !payload || !payload.length) return null;
  const p = payload[0].payload;
  return (
    <div className="rounded bg-gray-900/90 px-2 py-1 text-xs text-white">
      <div>t = {formatTime(p.t)}</div>
      <div>intensity: {p.intensity == null ? "–" : `${numToStr(p.intensity)} px/s`}</div>
      <div>players: {p.playerCount}</div>
    </div>
  );
}

function IntensityChart({ frames, startSec, endSec }) {
  const showWindow = Number.isFinite(startSec) && Number.isFinite(endSec) && endSec > startSec;
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={frames} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="t" type="number" domain={[0, "auto"]} tickFormatter={(v) => formatTime(v)} />
          <YAxis width={56} label={{ value: "px/s", angle: -90, position: "insideLeft" }} />
          <Tooltip content={<ChartTooltip />} />
          {showWindow && (
            <ReferenceArea x1={startSec} x2={endSec} fill="#f59e0b" fillOpacity={0.3} stroke="#f59e0b" />
          )}
          <Area type="monotone" dataKey="intensity" stroke="#2563eb" fill="#3b82f6" fillOpacity={0.4} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

function HighlightControls({
  frames,
  videoRef,
  startStr,
  endStr,
  setStartStr,
  setEndStr,
  canGenerate,
  trimming,
  error,
  onAutoSelect,
  onGenerate,
}) {
  const hasFrames = Array.isArray(frames) && frames.length > 0;
  function setAtPlayhead(setter) {
    const t = videoRef.current && videoRef.current.currentTime;
    if (Number.isFinite(t)) setter(numToStr(t));
  }
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-4">
        <label className="text-sm">
          <span className="mb-1 block font-medium">Start (s)</span>
          <input
            type="number"
            min="0"
            step="0.1"
            value={startStr}
            onChange={(e) => setStartStr(e.target.value)}
            className="w-28 rounded border border-gray-300 px-2 py-1"
          />
        </label>
        <label className="text-sm">
          <span className="mb-1 block font-medium">End (s)</span>
          <input
            type="number"
            min="0"
            step="0.1"
            value={endStr}
            onChange={(e) => setEndStr(e.target.value)}
            className="w-28 rounded border border-gray-300 px-2 py-1"
          />
        </label>
      </div>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => setAtPlayhead(setStartStr)} className="rounded bg-gray-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800">
          Set start at playhead
        </button>
        <button type="button" onClick={() => setAtPlayhead(setEndStr)} className="rounded bg-gray-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800">
          Set end at playhead
        </button>
        <button
          type="button"
          onClick={onAutoSelect}
          disabled={!hasFrames}
          className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300"
        >
          Auto-select strongest spike
        </button>
      </div>
      <button
        type="button"
        onClick={onGenerate}
        disabled={!canGenerate || trimming}
        className="rounded bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700 disabled:cursor-not-allowed disabled:bg-gray-300"
      >
        {trimming ? "Trimming…" : "Generate Highlight Clip"}
      </button>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}

function ClipResult({ clipUrl }) {
  if (!clipUrl) return null;
  return (
    <div className="space-y-2">
      <h3 className="font-semibold">Highlight clip</h3>
      <video src={clipUrl} controls className="w-full rounded" />
      <a href={clipUrl} download className="inline-block rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700">
        Download clip
      </a>
    </div>
  );
}

export default function App() {
  const videoRef = useRef(null);
  const [videoUrl, setVideoUrl] = useState(null);
  const [frames, setFrames] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [startStr, setStartStr] = useState("");
  const [endStr, setEndStr] = useState("");
  const [trimming, setTrimming] = useState(false);
  const [clipUrl, setClipUrl] = useState(null);
  const [trimError, setTrimError] = useState("");

  async function handleFile(file) {
    if (!/\.mp4$/i.test(file.name)) {
      setUploadError("Only .mp4 files are accepted");
      return;
    }
    setUploading(true);
    setUploadError("");
    const form = new FormData();
    form.append("video", file);
    try {
      const resp = await fetch("/api/upload", { method: "POST", body: form });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data.error || `upload failed (${resp.status})`);
      let analysis = data.analysis;
      if (!analysis && data.id) {
        // upload response may omit the inlined analysis; fetch it from the static /data mount.
        const aResp = await fetch(`/data/analysis/${data.id}.json`);
        if (!aResp.ok) throw new Error(`could not load analysis (${aResp.status})`);
        analysis = await aResp.json();
      }
      setVideoUrl(data.videoUrl);
      setFrames(analysis && Array.isArray(analysis.frames) ? analysis.frames : []);
      setStartStr("");
      setEndStr("");
      setClipUrl(null);
    } catch (err) {
      setUploadError(err.message);
    } finally {
      setUploading(false);
    }
  }

  const startSec = toSeconds(startStr);
  const endSec = toSeconds(endStr);
  const windowValid = startSec != null && endSec != null && endSec > startSec;

  function handleAutoSelect() {
    const win = findStrongestSpike(frames);
    if (!win) return;
    setStartStr(numToStr(win[0]));
    setEndStr(numToStr(win[1]));
  }

  async function handleGenerate() {
    if (!windowValid || !videoUrl) return;
    setTrimming(true);
    setTrimError("");
    try {
      const resp = await fetch("/api/trim-highlight", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: videoUrl.split("/").pop(), start: startSec, duration: endSec - startSec }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data.error || `trim failed (${resp.status})`);
      setClipUrl(data.clipUrl);
    } catch (err) {
      setTrimError(err.message);
    } finally {
      setTrimming(false);
    }
  }

  return (
    <div className="min-h-screen bg-gray-100 p-6 text-gray-900">
      <h1 className="mb-4 text-xl font-semibold">Oliver Video Dashboard</h1>
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="space-y-4 rounded-lg bg-white p-4 shadow">
          <UploadZone onFile={handleFile} uploading={uploading} />
          {uploadError && <p className="text-sm text-red-600">{uploadError}</p>}
          {videoUrl ? (
            <video ref={videoRef} src={videoUrl} controls className="w-full rounded" />
          ) : (
            <div className="flex h-48 items-center justify-center rounded bg-gray-50 text-sm text-gray-400">
              No video yet — upload a clip to get started.
            </div>
          )}
        </section>
        <section className="space-y-4 rounded-lg bg-white p-4 shadow">
          <h2 className="font-semibold">Player activity / intensity over time</h2>
          {frames.length > 0 ? (
            <IntensityChart frames={frames} startSec={startSec} endSec={endSec} />
          ) : (
            <div className="flex h-64 items-center justify-center rounded bg-gray-50 text-sm text-gray-400">
              Upload a clip to see the intensity chart.
            </div>
          )}
          {frames.length > 0 && (
            <HighlightControls
              frames={frames}
              videoRef={videoRef}
              startStr={startStr}
              endStr={endStr}
              setStartStr={setStartStr}
              setEndStr={setEndStr}
              canGenerate={windowValid && !!videoUrl}
              trimming={trimming}
              error={trimError}
              onAutoSelect={handleAutoSelect}
              onGenerate={handleGenerate}
            />
          )}
          <ClipResult clipUrl={clipUrl} />
        </section>
      </div>
    </div>
  );
}
