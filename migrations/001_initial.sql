CREATE TYPE lifecycle AS ENUM ('DRAFT', 'ACTIVE', 'INACTIVE', 'DEPRECATED');
CREATE TABLE terms (
  id uuid PRIMARY KEY, name text NOT NULL, "normalizedName" text NOT NULL,
  definition text NOT NULL, domain text NOT NULL,
  status lifecycle NOT NULL DEFAULT 'ACTIVE', version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  "createdAt" timestamptz NOT NULL DEFAULT now(), "updatedAt" timestamptz NOT NULL DEFAULT now(), "deletedAt" timestamptz
);
CREATE UNIQUE INDEX terms_live_name ON terms(domain, "normalizedName") WHERE "deletedAt" IS NULL;
CREATE TABLE expressions (
  id uuid PRIMARY KEY, "termId" uuid NOT NULL REFERENCES terms(id), text text NOT NULL, "normalizedText" text NOT NULL,
  type text NOT NULL CHECK (type IN ('ALIAS','ABBREVIATION','TRANSLATION','OTHER')),
  status lifecycle NOT NULL DEFAULT 'ACTIVE', version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  "createdAt" timestamptz NOT NULL DEFAULT now(), "updatedAt" timestamptz NOT NULL DEFAULT now(), "deletedAt" timestamptz
);
CREATE UNIQUE INDEX expressions_live_text ON expressions("termId", "normalizedText") WHERE "deletedAt" IS NULL;
CREATE TABLE rules (
  id uuid PRIMARY KEY, "termId" uuid NOT NULL REFERENCES terms(id), name text NOT NULL, description text NOT NULL,
  "ruleType" text NOT NULL CHECK ("ruleType" IN ('FORMAT','MASKING','REQUIRED','ENUM','RANGE','PROHIBITED','RELATION','CUSTOM')),
  scope jsonb NOT NULL DEFAULT '{}', condition jsonb NOT NULL, action jsonb NOT NULL, priority integer NOT NULL DEFAULT 100,
  status lifecycle NOT NULL DEFAULT 'ACTIVE', version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  "createdAt" timestamptz NOT NULL DEFAULT now(), "updatedAt" timestamptz NOT NULL DEFAULT now(), "deletedAt" timestamptz,
  CHECK (jsonb_typeof(scope) = 'object' AND jsonb_typeof(condition) = 'object' AND jsonb_typeof(action) = 'object')
);
CREATE INDEX rules_term ON rules("termId");
CREATE TABLE index_profiles (
  id text PRIMARY KEY, provider text NOT NULL, model text NOT NULL, dimensions integer NOT NULL, revision text NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE index_jobs (
  "profileId" text NOT NULL REFERENCES index_profiles(id), "entityType" text NOT NULL CHECK ("entityType" IN ('TERM','EXPRESSION','RULE')),
  "entityId" uuid NOT NULL, revision integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','PROCESSING','READY','FAILED')),
  attempts integer NOT NULL DEFAULT 0, error text, "updatedAt" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("profileId", "entityType", "entityId")
);
CREATE INDEX index_jobs_pending ON index_jobs("profileId", status, "updatedAt");
