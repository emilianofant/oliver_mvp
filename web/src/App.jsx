import { useEffect, useRef, useState } from "react";
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

// Sliding 5 s windows fully contained within a single wide segment, maximizing mean of non-null intensity.
function findStrongestSpike(frames, segments) {
  const wide = Array.isArray(segments) ? segments.filter((s) => s.type === "wide") : [];
  let bestStart = null;
  let bestMean = -Infinity;
  for (const seg of wide) {
    const pts = frames
      .filter((f) => f.intensity != null && f.t >= seg.startT && f.t < seg.endT)
      .map((f) => ({ t: f.t, v: f.intensity }));
    let sum = 0;
    let j = 0;
    for (let i = 0; i < pts.length; i++) {
      while (j < pts.length && pts[j].t <= pts[i].t + SPIKE_WINDOW_SECONDS) {
        sum += pts[j].v;
        j += 1;
      }
      if (pts[i].t + SPIKE_WINDOW_SECONDS <= seg.endT) {
        const mean = sum / (j - i);
        if (mean > bestMean) {
          bestMean = mean;
          bestStart = pts[i].t;
        }
      }
      sum -= pts[i].v;
    }
  }
  return bestStart == null ? null : [bestStart, bestStart + SPIKE_WINDOW_SECONDS];
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

function IntensityChart({ frames, closeSegments, rallies = [], startSec, endSec }) {
  const showWindow = Number.isFinite(startSec) && Number.isFinite(endSec) && endSec > startSec;
  // clamp to the data range: recharts discards a ReferenceArea whose points fall outside the axis domain
  const maxT = frames.length ? frames[frames.length - 1].t : 0;
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={frames} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" />
          <XAxis dataKey="t" type="number" domain={[0, "auto"]} tickFormatter={(v) => formatTime(v)} />
          <YAxis width={56} label={{ value: "px/s", angle: -90, position: "insideLeft" }} />
          <Tooltip content={<ChartTooltip />} />
          {closeSegments.map((seg) => (
            <ReferenceArea
              key={`close-${seg.startT}`}
              x1={Math.max(0, seg.startT)}
              x2={Math.min(maxT, seg.endT)}
              fill="#6b7280"
              fillOpacity={0.15}
            />
          ))}
          {rallies.map((rally, i) => (
            <ReferenceArea
              key={`rally-${i}`}
              x1={Math.max(0, rally.startT)}
              x2={Math.min(maxT, rally.endT)}
              fill="#16a34a"
              fillOpacity={0.25}
            />
          ))}
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
  padStr,
  setStartStr,
  setEndStr,
  setPadStr,
  canGenerate,
  trimming,
  error,
  onAutoSelect,
  onGenerate,
}) {
  const hasFrames = Array.isArray(frames) && frames.length > 0;
  const padSec = toSeconds(padStr);
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
        <label className="text-sm">
          <span className="mb-1 block font-medium">Padding (s)</span>
          <input
            type="number"
            min="0"
            step="0.5"
            value={padStr}
            onChange={(e) => setPadStr(e.target.value)}
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
      {padSec != null && padSec > 0 && (
        <p className="text-xs text-gray-500">Clips include ~{numToStr(padSec)} s of context on each side.</p>
      )}
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

const COURT_KEYS = [
  { key: "left", label: "Left edge" },
  { key: "netX", label: "Net line" },
  { key: "right", label: "Right edge" },
  { key: "top", label: "Top edge" },
  { key: "bottom", label: "Bottom edge" },
];

const DEFAULT_COURT = { netX: 0.5, left: 0.14, right: 0.82, top: 0.28, bottom: 0.66 };

// Trapezoid model (broadcast view): top/bottom baselines are horizontal; each sideline has its own
// slant (leftTilt/rightTilt = bottom-x minus top-x), so the edges can converge toward the far end.
// Saved values remain the axis-aligned extents metrics.py consumes: left/right = min/max x of each
// sideline's endpoints, netX/netY = position of the middle (net) line — draggable freely in x and
// y; defaults to mid-depth when no custom depth has been set. Tilts/netY are visual-only fit params.
function CourtOverlay({ court, leftTilt, rightTilt, netY, onChange, onNetYChange }) {
  const boxRef = useRef(null);
  const dragKey = useRef(null);

  function onHandleDown(e) {
    e.preventDefault();
    dragKey.current = e.currentTarget.dataset.key;
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function onHandleMove(e) {
    const key = dragKey.current;
    if (!key || !boxRef.current) return;
    const rect = boxRef.current.getBoundingClientRect();
    const px = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const py = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height));
    if (key === "left" || key === "right") {
      // Shift the whole slanted line so it passes under the pointer at that depth.
      const span = court.bottom - court.top;
      const u = span > 0 ? Math.min(1, Math.max(0, (py - court.top) / span)) : 0.5;
      // left is anchored at its min-x endpoint, right at its max-x endpoint
      const slant = key === "left" ? leftTilt : rightTilt;
      const anchorX = key === "left" ? court.left + Math.abs(slant) / 2 : court.right - Math.abs(slant) / 2;
      onChange(key, court[key] + (px - (anchorX + slant * (u - 0.5))));
    } else if (key === "top" || key === "bottom") {
      onChange(key, py);
    } else {
      // middle line: free 2-D placement, follows the pointer in both axes
      onChange("netX", px);
      onNetYChange(py);
    }
  }

  function onHandleUp() {
    dragKey.current = null;
  }

  const { left, right, top, bottom, netX } = court;
  // sideline x (viewBox units) at depth u in [0..1] (top -> bottom); left anchored at min-x end,
  // right at max-x end, so saved {left,right} is the exact axis-aligned extent of the quad
  const lx = (u) => (left + Math.abs(leftTilt) / 2 + leftTilt * (u - 0.5)) * 100;
  const rx = (u) => (right - Math.abs(rightTilt) / 2 + rightTilt * (u - 0.5)) * 100;
  const topY = top * 100;
  const botY = bottom * 100;
  const midY = (netY != null ? netY : (top + bottom) / 2) * 100;
  // net spans between the two sidelines at mid-depth (clamped if they cross)
  const netHalf = Math.max(0, right - left - (Math.abs(leftTilt) + Math.abs(rightTilt)) / 2) * 50;

  const handles = [
    { key: "left", x1: lx(0), y1: topY, x2: lx(1), y2: botY, cursor: "ew-resize" },
    { key: "right", x1: rx(0), y1: topY, x2: rx(1), y2: botY, cursor: "ew-resize" },
    { key: "top", x1: lx(0), y1: topY, x2: rx(0), y2: topY, cursor: "ns-resize" },
    { key: "bottom", x1: lx(1), y1: botY, x2: rx(1), y2: botY, cursor: "ns-resize" },
    { key: "netX", x1: netX * 100 - netHalf, y1: midY, x2: netX * 100 + netHalf, y2: midY, cursor: "ew-resize" },
  ];

  return (
    <div ref={boxRef} className="pointer-events-none absolute inset-0 select-none">
      <svg className="h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none">
        {handles.map((h) => (
          <g key={h.key}>
            <line x1={h.x1} y1={h.y1} x2={h.x2} y2={h.y2} stroke="#fde047" strokeWidth="2" vectorEffect="non-scaling-stroke" />
            <line
              x1={h.x1}
              y1={h.y1}
              x2={h.x2}
              y2={h.y2}
              data-key={h.key}
              onPointerDown={onHandleDown}
              onPointerMove={onHandleMove}
              onPointerUp={onHandleUp}
              className="touch-none"
              style={{ pointerEvents: "auto", cursor: h.cursor }}
              stroke="transparent"
              strokeWidth="16"
              vectorEffect="non-scaling-stroke"
            >
              <title>{`${h.key} = ${Number(court[h.key]).toFixed(3)}`}</title>
            </line>
          </g>
        ))}
      </svg>
    </div>
  );
}

function CourtControls({ videoRef, videoUrl, court, netY, leftTilt, rightTilt, onLeftTiltChange, onRightTiltChange }) {
  const [saving, setSaving] = useState(false);
  const [calibError, setCalibError] = useState("");

  const sourceName = videoUrl ? videoUrl.split("/").pop() : null;
  const orderValid =
    court.left < court.netX && court.netX < court.right && court.top < court.bottom;

  async function handleSave() {
    if (!sourceName) return;
    setSaving(true);
    setCalibError("");
    try {
      const v = videoRef.current;
      const resp = await fetch("/api/court", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source: sourceName,
          court,
          netY: netY ?? undefined,
          leftTilt,
          rightTilt,
          videoWidth: v ? v.videoWidth : undefined,
          videoHeight: v ? v.videoHeight : undefined,
        }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data.error || `save failed (${resp.status})`);
    } catch (err) {
      setCalibError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3">
      {!videoUrl ? (
        <p className="text-sm text-gray-400">Upload a clip to calibrate its court.</p>
      ) : (
        <>
          <p className="text-xs text-gray-500">Scrub the video above to a static WIDE shot, then drag the yellow lines over the court boundaries. If the sidelines converge (broadcast view), nudge Left/Right edge tilt until each line runs along its sideline. The middle line drags in any direction — park it on the actual net.</p>
          {([["Left edge", leftTilt, onLeftTiltChange], ["Right edge", rightTilt, onRightTiltChange]]).map(
            ([label, value, onChange]) => (
              <label key={label} className="flex items-center gap-2 text-sm">
                <span className="w-20 font-medium">{label}</span>
                <input
                  type="range"
                  min="-0.5"
                  max="0.5"
                  step="0.001"
                  value={value}
                  onChange={(e) => onChange(parseFloat(e.target.value))}
                  className="w-48 accent-yellow-400"
                />
                <span className="font-mono text-xs">{Number(value).toFixed(3)}</span>
              </label>
            )
          )}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-xs">
            {COURT_KEYS.map(({ key, label }) => (
              <span key={key} title={label}>
                {key}: {Number(court[key]).toFixed(3)}
              </span>
            ))}
            <span title="Middle-line depth (custom)">netY: {netY == null ? "mid" : Number(netY).toFixed(3)}</span>
          </div>
          {!orderValid && (
            <p className="text-sm text-amber-600">Ordering violated: keep left &lt; netX &lt; right and top &lt; bottom.</p>
          )}
          <button
            type="button"
            onClick={handleSave}
            disabled={!orderValid || saving}
            className="rounded bg-green-600 px-4 py-2 text-sm font-semibold text-white hover:bg-green-700 disabled:cursor-not-allowed disabled:bg-gray-300"
          >
            {saving ? "Saving…" : "Save court config"}
          </button>
          {calibError && <p className="text-sm text-red-600">{calibError}</p>}
        </>
      )}
    </div>
  );
}

export default function App() {
  const videoRef = useRef(null);
  const [videoUrl, setVideoUrl] = useState(null);
  const [frames, setFrames] = useState([]);
  const [segments, setSegments] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [startStr, setStartStr] = useState("");
  const [endStr, setEndStr] = useState("");
  const [padStr, setPadStr] = useState("1");
  const [trimming, setTrimming] = useState(false);
  const [clipUrl, setClipUrl] = useState(null);
  const [trimError, setTrimError] = useState("");
  const [court, setCourt] = useState(DEFAULT_COURT);
  const [leftTilt, setLeftTilt] = useState(0);
  const [rightTilt, setRightTilt] = useState(0);
  const [netY, setNetY] = useState(null);
  const [derived, setDerived] = useState(null);
  const [analyticsRunning, setAnalyticsRunning] = useState(false);
  const [analyticsError, setAnalyticsError] = useState("");

  // Reopening a video pre-fills its saved court (if any).
  useEffect(() => {
    if (!videoUrl) return undefined;
    let cancelled = false;
    fetch(`/api/court?file=${encodeURIComponent(videoUrl.split("/").pop())}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((cfg) => {
        if (!cancelled && cfg && cfg.court) {
          setCourt(cfg.court);
          setLeftTilt(Number.isFinite(cfg.court.leftTilt) ? cfg.court.leftTilt : 0);
          setRightTilt(Number.isFinite(cfg.court.rightTilt) ? cfg.court.rightTilt : 0);
          setNetY(Number.isFinite(cfg.court.netY) ? cfg.court.netY : null);
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [videoUrl]);

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
      setSegments(analysis && Array.isArray(analysis.segments) ? analysis.segments : []);
      setStartStr("");
      setEndStr("");
      setClipUrl(null);
      setDerived(null);
      setAnalyticsError("");
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
    const win = findStrongestSpike(frames, segments);
    if (!win) return;
    setStartStr(numToStr(win[0]));
    setEndStr(numToStr(win[1]));
  }

  async function handleRunAnalytics() {
    if (!videoUrl || uploading || analyticsRunning) return;
    setAnalyticsRunning(true);
    setAnalyticsError("");
    try {
      const resp = await fetch("/api/analytics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: videoUrl.split("/").pop() }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data.error || `analytics failed (${resp.status})`);
      setDerived({ ...data.derived, courtSource: data.courtSource });
    } catch (err) {
      setAnalyticsError(err.message);
    } finally {
      setAnalyticsRunning(false);
    }
  }

  async function handleGenerate() {
    if (!windowValid || !videoUrl) return;
    setTrimming(true);
    setTrimError("");
    try {
      const padSec = Math.max(0, toSeconds(padStr) ?? 0);
      const vDur = videoRef.current && Number.isFinite(videoRef.current.duration)
        ? videoRef.current.duration
        : frames[frames.length - 1].t;
      const trimStart = Math.max(0, startSec - padSec);
      const effectiveEnd = Math.min(vDur, endSec + padSec);
      const duration = effectiveEnd - trimStart;
      if (duration <= 0) throw new Error("selection is outside the video bounds");
      const resp = await fetch("/api/trim-highlight", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: videoUrl.split("/").pop(), start: trimStart, duration }),
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
            <div className="relative">
              <video ref={videoRef} src={videoUrl} controls className="w-full rounded" />
              <CourtOverlay
                court={court}
                leftTilt={leftTilt}
                rightTilt={rightTilt}
                netY={netY}
                onChange={(key, value) => setCourt((c) => ({ ...c, [key]: Math.min(1, Math.max(0, value)) }))}
                onNetYChange={(v) => setNetY(Math.min(1, Math.max(0, v)))}
              />
            </div>
          ) : (
            <div className="flex h-48 items-center justify-center rounded bg-gray-50 text-sm text-gray-400">
              No video yet — upload a clip to get started.
            </div>
          )}
        </section>
        <section className="space-y-4 rounded-lg bg-white p-4 shadow">
          <h2 className="font-semibold">Player activity / intensity over time</h2>
          {frames.length > 0 ? (
            <IntensityChart
            frames={frames}
            closeSegments={segments.filter((s) => s.type === "close")}
            rallies={derived ? derived.rallies : []}
            startSec={startSec}
            endSec={endSec}
          />
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
              padStr={padStr}
              setStartStr={setStartStr}
              setEndStr={setEndStr}
              setPadStr={setPadStr}
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
      <section className="mt-6 space-y-4 rounded-lg bg-white p-4 shadow">
        <h2 className="font-semibold">Court calibration</h2>
        <CourtControls
          videoRef={videoRef}
          videoUrl={videoUrl}
          court={court}
          netY={netY}
          leftTilt={leftTilt}
          rightTilt={rightTilt}
          onLeftTiltChange={(v) => setLeftTilt(Math.min(0.5, Math.max(-0.5, v)))}
          onRightTiltChange={(v) => setRightTilt(Math.min(0.5, Math.max(-0.5, v)))}
        />
        <button
          type="button"
          onClick={handleRunAnalytics}
          disabled={!videoUrl || uploading || analyticsRunning}
          className="rounded bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-gray-300"
        >
          {analyticsRunning ? "Running…" : "Run analytics"}
        </button>
        {analyticsError && <p className="text-sm text-red-600">{analyticsError}</p>}
        {derived && (
          <div className="space-y-1 rounded bg-gray-50 p-3">
            <p className="text-sm font-medium">
              rallies: {derived.rallies.length} · players on court: {derived.clip.onCourtPlayerCount} · court: {derived.courtSource}
            </p>
            {derived.courtSource === "defaults" && (
              <p className="text-xs text-amber-600">no saved court — using defaults</p>
            )}
            {derived.rallies.map((rally, i) => (
              <div key={i} className="font-mono text-sm">
                {formatTime(rally.startT)} – {formatTime(rally.endT)}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
