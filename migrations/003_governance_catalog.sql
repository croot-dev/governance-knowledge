-- Reference data the enrichment pipeline resolves by stable code, never by vector similarity.
CREATE TABLE document_types (
  id uuid PRIMARY KEY, code text NOT NULL CHECK (code ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  name text NOT NULL, definition text NOT NULL,
  "positiveExamples" jsonb NOT NULL DEFAULT '[]', "negativeExamples" jsonb NOT NULL DEFAULT '[]',
  status lifecycle NOT NULL DEFAULT 'ACTIVE', version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  "createdAt" timestamptz NOT NULL DEFAULT now(), "updatedAt" timestamptz NOT NULL DEFAULT now(), "deletedAt" timestamptz,
  CHECK (jsonb_typeof("positiveExamples") = 'array' AND jsonb_typeof("negativeExamples") = 'array')
);
CREATE UNIQUE INDEX document_types_live_code ON document_types(code) WHERE "deletedAt" IS NULL;

-- Grades compare only within one scheme; rank 1 is the most junior.
CREATE TABLE job_grades (
  id uuid PRIMARY KEY, "gradeSchemeId" text NOT NULL, code text NOT NULL CHECK (code ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  name text NOT NULL, rank integer NOT NULL CHECK (rank > 0), "termId" uuid REFERENCES terms(id),
  status lifecycle NOT NULL DEFAULT 'ACTIVE', version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  "createdAt" timestamptz NOT NULL DEFAULT now(), "updatedAt" timestamptz NOT NULL DEFAULT now(), "deletedAt" timestamptz
);
CREATE UNIQUE INDEX job_grades_live_code ON job_grades("gradeSchemeId", code) WHERE "deletedAt" IS NULL;
CREATE UNIQUE INDEX job_grades_live_rank ON job_grades("gradeSchemeId", rank) WHERE "deletedAt" IS NULL;

-- A rule without bindings applies to every document type; with bindings, only to those types.
CREATE TABLE rule_document_types (
  "ruleId" uuid NOT NULL REFERENCES rules(id), "documentTypeId" uuid NOT NULL REFERENCES document_types(id),
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("ruleId", "documentTypeId")
);

-- Governance keeps no edit history, so every rule version is captured for reproducible judgments.
CREATE TABLE rule_versions (
  "ruleId" uuid NOT NULL REFERENCES rules(id), version integer NOT NULL,
  content jsonb NOT NULL, "recordedAt" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("ruleId", version)
);
CREATE FUNCTION record_rule_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO rule_versions("ruleId", version, content)
  VALUES (NEW.id, NEW.version, to_jsonb(NEW) - 'createdAt' - 'updatedAt')
  ON CONFLICT ("ruleId", version) DO NOTHING;
  RETURN NEW;
END $$;
CREATE TRIGGER rules_record_version AFTER INSERT OR UPDATE ON rules
FOR EACH ROW EXECUTE FUNCTION record_rule_version();
INSERT INTO rule_versions("ruleId", version, content)
SELECT id, version, to_jsonb(r) - 'createdAt' - 'updatedAt' FROM rules r
ON CONFLICT DO NOTHING;
