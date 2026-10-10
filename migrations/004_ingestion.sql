CREATE TABLE upload_batches (
  id uuid PRIMARY KEY, mode text NOT NULL CHECK (mode IN ('FILES','FOLDER','ZIP')),
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','FINALIZED')),
  -- False until every archive is fully listed; a partial listing must never look complete.
  "enumerationComplete" boolean NOT NULL DEFAULT false,
  "createdAt" timestamptz NOT NULL DEFAULT now(), "finalizedAt" timestamptz
);

-- One row is one immutable original. Object keys are server-generated; relativePath is metadata only.
CREATE TABLE upload_items (
  id uuid PRIMARY KEY, "batchId" uuid NOT NULL REFERENCES upload_batches(id),
  "parentItemId" uuid REFERENCES upload_items(id), "relativePath" text NOT NULL,
  format text CHECK (format IN ('MARKDOWN','TEXT','LOG','PDF','IMAGE','ZIP')),
  status text NOT NULL DEFAULT 'UPLOADING'
    CHECK (status IN ('UPLOADING','STORED','READY','EXTRACTED','UNSUPPORTED','FAILED')),
  "objectKey" text, size bigint CHECK (size >= 0), sha256 text CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  error text, "createdAt" timestamptz NOT NULL DEFAULT now(), "updatedAt" timestamptz NOT NULL DEFAULT now(),
  CHECK (status IN ('UPLOADING','UNSUPPORTED','FAILED') OR ("objectKey" IS NOT NULL AND sha256 IS NOT NULL))
);
CREATE UNIQUE INDEX upload_items_path ON upload_items("batchId", "relativePath");
CREATE INDEX upload_items_parent ON upload_items("parentItemId");

CREATE TABLE content_documents (
  id uuid PRIMARY KEY, "itemId" uuid NOT NULL REFERENCES upload_items(id),
  "sourceSha256" text NOT NULL, extractor text NOT NULL, "extractorVersion" text NOT NULL,
  "objectKey" text NOT NULL, quality text NOT NULL CHECK (quality IN ('COMPLETE','PARTIAL')),
  "blockCount" integer NOT NULL CHECK ("blockCount" >= 0), "createdAt" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("itemId", extractor, "extractorVersion")
);

-- Separate from index_jobs: long extraction and analysis work must not occupy the index worker.
CREATE TABLE ingestion_jobs (
  id uuid PRIMARY KEY, "itemId" uuid NOT NULL REFERENCES upload_items(id),
  kind text NOT NULL CHECK (kind IN ('EXPAND_ARCHIVE','EXTRACT')),
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','RUNNING','DONE','FAILED')),
  attempts integer NOT NULL DEFAULT 0, "leaseOwner" text, "leaseUntil" timestamptz, error text,
  "createdAt" timestamptz NOT NULL DEFAULT now(), "updatedAt" timestamptz NOT NULL DEFAULT now(),
  UNIQUE ("itemId", kind)
);
CREATE INDEX ingestion_jobs_ready ON ingestion_jobs(status, "updatedAt");
