-- A user can stop a batch; stopped items and jobs are terminal until explicitly retried.
ALTER TABLE upload_items DROP CONSTRAINT upload_items_status_check;
ALTER TABLE upload_items ADD CONSTRAINT upload_items_status_check
  CHECK (status IN ('UPLOADING','STORED','READY','EXTRACTED','UNSUPPORTED','FAILED','CANCELLED'));
ALTER TABLE ingestion_jobs DROP CONSTRAINT ingestion_jobs_status_check;
ALTER TABLE ingestion_jobs ADD CONSTRAINT ingestion_jobs_status_check
  CHECK (status IN ('PENDING','RUNNING','DONE','FAILED','CANCELLED'));
