import { randomUUID } from "node:crypto";
import {
  AppError,
  collectionOf,
  collections,
  kindOf,
  normalize,
  snapshot,
  type Collection,
  type Entity,
  type EntityType,
  type ListOptions,
  type Page,
  type Profile,
} from "../../domain/model";
import type {
  ActiveGovernance,
  ActiveGovernancePort,
  ActiveRule,
  IndexJob,
  IndexRepository,
} from "../../domain/ports";
import type { Database, Sql } from "./connection";

const writable: Record<Collection, string[]> = {
  terms: ["name", "definition", "domain", "status"],
  expressions: ["termId", "text", "type", "status"],
  rules: [
    "termId",
    "name",
    "description",
    "ruleType",
    "scope",
    "condition",
    "action",
    "priority",
    "status",
  ],
};
function projection(collection: Collection) {
  return collection === "terms"
    ? "e.*"
    : 'e.*, t.domain, t.name AS "termName", t.version AS "parentVersion", t.status AS "parentStatus", t."deletedAt" AS "parentDeletedAt"';
}
function joined(collection: Collection) {
  return `${collection} e ${collection === "terms" ? "" : 'JOIN terms t ON t.id=e."termId"'}`;
}
function publicRow(row: Entity): Entity {
  const data = { ...row } as Entity & {
    normalizedName?: string;
    normalizedText?: string;
  };
  delete data.normalizedName;
  delete data.normalizedText;
  return data;
}
export class GovernanceRepository
  implements IndexRepository, ActiveGovernancePort
{
  constructor(
    public db: Database,
    public profile: Profile,
  ) {}
  async initialize() {
    await this.db.transaction(async (sql) => {
      const p = this.profile;
      const { rows } = await sql.query(
        "INSERT INTO index_profiles(id,provider,model,dimensions,revision) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING RETURNING id",
        [p.id, p.provider, p.model, p.dimensions, p.revision],
      );
      if (rows.length) await this.enqueueAll(sql);
    });
  }
  async enqueueAll(sql: Sql = this.db) {
    for (const c of collections)
      await sql.query(
        `INSERT INTO index_jobs("profileId","entityType","entityId") SELECT $1,$2,id FROM ${c}
      ON CONFLICT ("profileId","entityType","entityId") DO UPDATE SET revision=index_jobs.revision+1,status='PENDING',attempts=0,error=NULL,"updatedAt"=now()`,
        [this.profile.id, kindOf[c]],
      );
  }
  private async enqueue(sql: Sql, type: EntityType, ids: string[]) {
    if (!ids.length) return;
    await sql.query(
      `INSERT INTO index_jobs("profileId","entityType","entityId") SELECT p.id,$1,entity_id FROM index_profiles p CROSS JOIN unnest($2::uuid[]) AS entity_id
      ON CONFLICT ("profileId","entityType","entityId") DO UPDATE SET revision=index_jobs.revision+1,status='PENDING',attempts=0,error=NULL,"updatedAt"=now()`,
      [type, ids],
    );
  }
  async get(
    collection: Collection,
    id: string,
    sql: Sql = this.db,
    includeDeleted = false,
  ): Promise<Entity | null> {
    const { rows } = await sql.query<Entity>(
      `SELECT ${projection(collection)}, COALESCE(j.status,'PENDING') AS "embeddingStatus", j.error AS "embeddingError", j."updatedAt" AS "embeddingUpdatedAt"
      FROM ${joined(collection)} LEFT JOIN index_jobs j ON j."profileId"=$2 AND j."entityType"=$3 AND j."entityId"=e.id
      WHERE e.id=$1 ${includeDeleted ? "" : 'AND e."deletedAt" IS NULL'}`,
      [id, this.profile.id, kindOf[collection]],
    );
    return rows[0] ? publicRow(rows[0]) : null;
  }
  async list(collection: Collection, options: ListOptions): Promise<Page> {
    const values: unknown[] = [this.profile.id, kindOf[collection]];
    const where = ['e."deletedAt" IS NULL'];
    const add = (clause: string, value: unknown) => {
      values.push(value);
      where.push(clause.replace("?", `$${values.length}`));
    };
    if (options.q) {
      const field = collection === "expressions" ? "e.text" : "e.name";
      add(
        `${field} ILIKE ? ESCAPE '\\'`,
        `%${options.q.replace(/[\\%_]/g, "\\$&")}%`,
      );
    }
    if (options.domain)
      add(`${collection === "terms" ? "e" : "t"}.domain=?`, options.domain);
    if (options.status) add("e.status=?", options.status);
    if (options.termId && collection !== "terms")
      add('e."termId"=?', options.termId);
    const from = `${joined(collection)} LEFT JOIN index_jobs j ON j."profileId"=$1 AND j."entityType"=$2 AND j."entityId"=e.id WHERE ${where.join(" AND ")}`;
    const count = await this.db.query<{ count: string }>(
      `SELECT count(*) FROM ${from}`,
      values,
    );
    const { rows } = await this.db.query<Entity>(
      `SELECT ${projection(collection)}, COALESCE(j.status,'PENDING') AS "embeddingStatus",j.error AS "embeddingError" FROM ${from}
      ORDER BY e."createdAt" DESC,e.id LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, options.pageSize, (options.page - 1) * options.pageSize],
    );
    return {
      items: rows.map(publicRow),
      total: Number(count.rows[0].count),
      page: options.page,
      pageSize: options.pageSize,
    };
  }
  private async parent(
    sql: Sql,
    collection: Collection,
    data: Record<string, unknown>,
  ) {
    if (collection === "terms") return;
    const { rows } = await sql.query(
      'SELECT id FROM terms WHERE id=$1 AND "deletedAt" IS NULL FOR UPDATE',
      [data.termId],
    );
    if (!rows.length)
      throw new AppError(
        409,
        "INVALID_TERM",
        "연결할 Term이 없거나 삭제되었습니다.",
      );
  }
  async create(
    collection: Collection,
    data: Record<string, unknown>,
    id: string = randomUUID(),
  ): Promise<Entity> {
    return this.db.transaction(async (sql) => {
      await sql.query("SELECT pg_advisory_xact_lock(782419302)");
      await this.parent(sql, collection, data);
      const fields = [...writable[collection]];
      const values = fields.map((f) => data[f]);
      if (collection === "terms") {
        fields.push("normalizedName");
        values.push(normalize(data.name as string));
      }
      if (collection === "expressions") {
        fields.push("normalizedText");
        values.push(normalize(data.text as string));
      }
      await sql.query(
        `INSERT INTO ${collection}(id,${fields.map((f) => `"${f}"`).join(",")}) VALUES($1,${values.map((_, i) => `$${i + 2}`).join(",")})`,
        [id, ...values],
      );
      await this.enqueue(sql, kindOf[collection], [id]);
      return (await this.get(collection, id, sql))!;
    });
  }
  async update(
    collection: Collection,
    id: string,
    transform: (data: Record<string, unknown>) => Record<string, unknown>,
  ): Promise<Entity> {
    return this.db.transaction(async (sql) => {
      await sql.query("SELECT pg_advisory_xact_lock(782419302)");
      const current = await this.get(collection, id, sql);
      if (!current)
        throw new AppError(404, "NOT_FOUND", "항목을 찾을 수 없습니다.");
      const editable = Object.fromEntries(
        writable[collection].map((f) => [f, current[f as keyof Entity]]),
      );
      const data = transform(editable);
      await this.parent(sql, collection, data);
      const fields = [...writable[collection]];
      const values = fields.map((f) => data[f]);
      if (collection === "terms") {
        fields.push("normalizedName");
        values.push(normalize(data.name as string));
      }
      if (collection === "expressions") {
        fields.push("normalizedText");
        values.push(normalize(data.text as string));
      }
      await sql.query(
        `UPDATE ${collection} SET ${fields.map((f, i) => `"${f}"=$${i + 2}`).join(",")},version=version+1,"updatedAt"=now() WHERE id=$1`,
        [id, ...values],
      );
      await this.enqueue(sql, kindOf[collection], [id]);
      // Parent version is part of every child's search stamp, so all children are invalidated.
      if (collection === "terms")
        for (const child of ["expressions", "rules"] as const) {
          const { rows } = await sql.query<{ id: string }>(
            `SELECT id FROM ${child} WHERE "termId"=$1`,
            [id],
          );
          await this.enqueue(
            sql,
            kindOf[child],
            rows.map((r) => r.id),
          );
        }
      return (await this.get(collection, id, sql))!;
    });
  }
  async delete(collection: Collection, id: string) {
    await this.db.transaction(async (sql) => {
      await sql.query("SELECT pg_advisory_xact_lock(782419302)");
      if (!(await this.get(collection, id, sql)))
        throw new AppError(404, "NOT_FOUND", "항목을 찾을 수 없습니다.");
      if (collection === "terms") {
        const { rows } = await sql.query(
          `SELECT id FROM expressions WHERE "termId"=$1 AND "deletedAt" IS NULL UNION ALL SELECT id FROM rules WHERE "termId"=$1 AND "deletedAt" IS NULL LIMIT 1`,
          [id],
        );
        if (rows.length)
          throw new AppError(
            409,
            "HAS_RELATIONS",
            "연결된 Expression과 Rule을 먼저 삭제하거나 다른 Term으로 옮겨주세요.",
          );
      }
      await sql.query(
        `UPDATE ${collection} SET "deletedAt"=now(),"updatedAt"=now(),version=version+1 WHERE id=$1`,
        [id],
      );
      await this.enqueue(sql, kindOf[collection], [id]);
    });
  }
  async getSnapshot(type: EntityType, id: string) {
    const entity = await this.get(collectionOf[type], id, this.db, true);
    return entity ? snapshot(type, entity) : null;
  }
  async claim(): Promise<IndexJob | null> {
    const { rows } = await this.db.query<IndexJob>(
      `UPDATE index_jobs SET status='PROCESSING',attempts=attempts+1,error=NULL,"updatedAt"=now()
      WHERE ("profileId","entityType","entityId") IN (SELECT "profileId","entityType","entityId" FROM index_jobs WHERE "profileId"=$1 AND status='PENDING' ORDER BY "updatedAt","entityId" LIMIT 1)
      RETURNING "entityType","entityId",revision,attempts`,
      [this.profile.id],
    );
    return rows[0] ?? null;
  }
  async finish(job: IndexJob, error?: string) {
    await this.db.query(
      `UPDATE index_jobs SET status=$5,error=$6,"updatedAt"=now()
      WHERE "profileId"=$1 AND "entityType"=$2 AND "entityId"=$3 AND revision=$4`,
      [
        this.profile.id,
        job.entityType,
        job.entityId,
        job.revision,
        error ? "FAILED" : "READY",
        error?.slice(0, 1000) ?? null,
      ],
    );
  }
  async recover() {
    await this.db.query(
      `UPDATE index_jobs SET status='PENDING',"updatedAt"=now() WHERE "profileId"=$1 AND status='PROCESSING'`,
      [this.profile.id],
    );
  }
  async retry() {
    await this.db.query(
      `UPDATE index_jobs SET status='PENDING',error=NULL,"updatedAt"=now() WHERE "profileId"=$1 AND status='FAILED'`,
      [this.profile.id],
    );
  }
  async loadActive(): Promise<ActiveGovernance> {
    const live = `t.status='ACTIVE' AND t."deletedAt" IS NULL AND e.status='ACTIVE' AND e."deletedAt" IS NULL`;
    const [expressions, rules] = await Promise.all([
      this.db.query<ActiveGovernance["expressions"][number]>(
        `SELECT e.text, e."termId", t.name AS "termName" FROM expressions e JOIN terms t ON t.id=e."termId" WHERE ${live}`,
      ),
      this.db.query<ActiveRule>(
        `SELECT e.id, e.name, e."ruleType", e.condition, e.action FROM rules e JOIN terms t ON t.id=e."termId" WHERE ${live}
        ORDER BY e.priority DESC, e.id`,
      ),
    ]);
    return { expressions: expressions.rows, rules: rules.rows };
  }
}
