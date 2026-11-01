CREATE TABLE IF NOT EXISTS calibrations (
  video_id CHAR(36) PRIMARY KEY,
  net_x DOUBLE NULL,
  `left` DOUBLE NULL,
  `right` DOUBLE NULL,
  `top` DOUBLE NULL,
  `bottom` DOUBLE NULL,
  net_y DOUBLE NULL,
  left_tilt DOUBLE NULL,
  right_tilt DOUBLE NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_calibrations_video FOREIGN KEY (video_id) REFERENCES videos(id)
);

CREATE TABLE IF NOT EXISTS rallies (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  video_id CHAR(36) NOT NULL,
  start_s DOUBLE NULL,
  end_s DOUBLE NULL,
  duration_s DOUBLE NULL,
  peak_intensity DOUBLE NULL,
  INDEX idx_rallies_video_start (video_id, start_s),
  CONSTRAINT fk_rallies_video FOREIGN KEY (video_id) REFERENCES videos(id)
);

CREATE TABLE IF NOT EXISTS intensity_samples (
  video_id CHAR(36) NOT NULL,
  t_s INT NOT NULL,
  intensity DOUBLE NULL,
  PRIMARY KEY (video_id, t_s),
  CONSTRAINT fk_intensity_samples_video FOREIGN KEY (video_id) REFERENCES videos(id)
);

CREATE TABLE IF NOT EXISTS reports (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  video_id CHAR(36) NOT NULL,
  language CHAR(2) NOT NULL,
  audience ENUM('coach','player') NOT NULL,
  content JSON NULL,
  rendered MEDIUMTEXT NULL,
  model VARCHAR(64) NULL,
  prompt_version VARCHAR(32) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_reports_video_lang_audience (video_id, language, audience),
  CONSTRAINT fk_reports_video FOREIGN KEY (video_id) REFERENCES videos(id)
);
