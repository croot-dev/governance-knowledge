import type {
  DocumentTypeDef,
  JobGradeDef,
  RuleSnapshot,
  TermDef,
} from "../../domain/catalog";
import type { GovernanceCatalog } from "../../domain/ports";
import type { Sql } from "./connection";

const LIVE = `status='ACTIVE' AND "deletedAt" IS NULL`;

export class CatalogRepository implements GovernanceCatalog {
  constructor(private db: Sql) {}

  async listDocumentTypes(): Promise<DocumentTypeDef[]> {
    const { rows } = await this.db.query<DocumentTypeDef>(
      `SELECT id, code, name, definition, "positiveExamples", "negativeExamples", version
      FROM document_types WHERE ${LIVE} ORDER BY code`,
    );
    return rows;
  }

  async listJobGrades(gradeSchemeId?: string): Promise<JobGradeDef[]> {
    const { rows } = await this.db.query<JobGradeDef>(
      `SELECT id, "gradeSchemeId", code, name, rank, "termId", version
      FROM job_grades WHERE ${LIVE} AND ($1::text IS NULL OR "gradeSchemeId"=$1)
      ORDER BY "gradeSchemeId", rank`,
      [gradeSchemeId ?? null],
    );
    return rows;
  }

  async getTerms(ids: string[]): Promise<TermDef[]> {
    if (!ids.length) return [];
    const { rows } = await this.db.query<TermDef>(
      `SELECT t.id, t.name, t.definition, t.domain, t.version,
        COALESCE(array_agg(e.text ORDER BY e.text) FILTER (WHERE e.id IS NOT NULL), '{}') AS expressions
      FROM terms t LEFT JOIN expressions e
        ON e."termId"=t.id AND e.status='ACTIVE' AND e."deletedAt" IS NULL
      WHERE t.id = ANY($1::uuid[]) AND t.status='ACTIVE' AND t."deletedAt" IS NULL
      GROUP BY t.id ORDER BY t.name`,
      [ids],
    );
    return rows;
  }

  async activeRulesForTerms(termIds: string[]): Promise<RuleSnapshot[]> {
    if (!termIds.length) return [];
    const { rows } = await this.db.query<RuleSnapshot>(
      `SELECT r.id, r."termId", r.name, r.description, r."ruleType", r.scope, r.condition, r.action,
        r.priority, r.version,
        COALESCE(array_agg(d.code ORDER BY d.code) FILTER (WHERE d.id IS NOT NULL), '{}') AS "documentTypeCodes"
      FROM rules r JOIN terms t ON t.id=r."termId"
      LEFT JOIN rule_document_types b ON b."ruleId"=r.id
      -- Deleted types stay in the list so a binding never silently widens to every document.
      LEFT JOIN document_types d ON d.id=b."documentTypeId"
      WHERE r."termId" = ANY($1::uuid[]) AND r.status='ACTIVE' AND r."deletedAt" IS NULL
        AND t.status='ACTIVE' AND t."deletedAt" IS NULL
      GROUP BY r.id ORDER BY r.priority DESC, r.id`,
      [termIds],
    );
    return rows;
  }

  async getRuleVersion(ruleId: string, version: number) {
    const { rows } = await this.db.query<{ content: Record<string, unknown> }>(
      `SELECT content FROM rule_versions WHERE "ruleId"=$1 AND version=$2`,
      [ruleId, version],
    );
    return rows[0]?.content ?? null;
  }

  async activeVocabulary() {
    const { rows } = await this.db.query<{ text: string; termId: string }>(
      `SELECT t.name AS text, t.id AS "termId" FROM terms t
      WHERE t.status='ACTIVE' AND t."deletedAt" IS NULL
      UNION ALL
      SELECT e.text, e."termId" FROM expressions e JOIN terms t ON t.id=e."termId"
      WHERE e.status='ACTIVE' AND e."deletedAt" IS NULL
        AND t.status='ACTIVE' AND t."deletedAt" IS NULL`,
    );
    return rows;
  }
}
