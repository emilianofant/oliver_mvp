import React, { useRef, useState } from "react";

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

export default function App() {
  const videoRef = useRef(null);
  const [videoUrl, setVideoUrl] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");

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
      setVideoUrl(data.videoUrl);
    } catch (err) {
      setUploadError(err.message);
    } finally {
      setUploading(false);
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
      </div>
    </div>
  );
}
