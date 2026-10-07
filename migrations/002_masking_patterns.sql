-- Only migrate the known original seed template; do not guess user-defined patterns.
-- The source revision and every registered index profile are invalidated atomically.
WITH updated AS (
  UPDATE rules
  SET condition = jsonb_build_object('operator', 'regex', 'pattern', '^([0-9]{6})-?[0-9]{7}$'),
      action = action || jsonb_build_object(
        'replacement', '$1-*******',
        'resultPattern', '^[0-9]{6}-\*{7}$'
      ),
      version = version + 1,
      "updatedAt" = now()
  WHERE id = '30000000-0000-4000-8000-000000000002'
    AND "ruleType" = 'MASKING'
    AND condition = '{"operator":"mask","pattern":"######-*******"}'::jsonb
    AND NOT (action ? 'replacement' OR action ? 'resultPattern')
    AND "deletedAt" IS NULL
  RETURNING id
)
INSERT INTO index_jobs("profileId", "entityType", "entityId")
SELECT p.id, 'RULE', u.id FROM updated u CROSS JOIN index_profiles p
ON CONFLICT ("profileId", "entityType", "entityId") DO UPDATE
SET revision = index_jobs.revision + 1,
    status = 'PENDING', attempts = 0, error = NULL, "updatedAt" = now();
