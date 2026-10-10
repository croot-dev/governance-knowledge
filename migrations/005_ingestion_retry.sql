-- Transient failures wait before the next attempt instead of burning every retry within seconds.
ALTER TABLE ingestion_jobs ADD COLUMN "runAfter" timestamptz NOT NULL DEFAULT now();
DROP INDEX ingestion_jobs_ready;
CREATE INDEX ingestion_jobs_ready ON ingestion_jobs(status, "runAfter");
