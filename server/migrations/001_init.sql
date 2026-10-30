CREATE TABLE IF NOT EXISTS videos (
  id CHAR(36) PRIMARY KEY,
  filename VARCHAR(255),
  size_bytes BIGINT NULL,
  duration_s DOUBLE NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_videos_created_at (created_at)
);

CREATE TABLE IF NOT EXISTS jobs (
  id CHAR(36) PRIMARY KEY,
  video_id CHAR(36) UNIQUE NOT NULL,
  status ENUM('queued','processing','done','failed') NOT NULL DEFAULT 'queued',
  error TEXT NULL,
  attempts INT NOT NULL DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  started_at DATETIME NULL,
  finished_at DATETIME NULL,
  CONSTRAINT fk_jobs_video FOREIGN KEY (video_id) REFERENCES videos(id)
);
