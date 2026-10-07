import { connect, type Connection, type Table } from "@lancedb/lancedb";
import {
  Field,
  FixedSizeList,
  Float32,
  Int32,
  Schema,
  Utf8,
} from "apache-arrow";
import type {
  Candidate,
  EntityType,
  Profile,
  VectorRecord,
} from "../../domain/model";
import type { VectorStore } from "../../domain/ports";
import { normalizeVector } from "../embedding/providers";
const literal = (value: string) => `'${value.replace(/'/g, "''")}'`;
export class LanceVectorStore implements VectorStore {
  private connection?: Connection;
  private name: string;
  constructor(
    private uri: string,
    private profile: Profile,
  ) {
    this.name = `governance_${profile.id}`;
  }
  private async db() {
    return (this.connection ??= await connect(this.uri, {
      readConsistencyInterval: 0,
    }));
  }
  private schema() {
    return new Schema(
      [
        ...["key", "entityType", "entityId", "termId", "domain", "stamp"].map(
          (f) => new Field(f, new Utf8(), false),
        ),
        new Field("version", new Int32(), false),
        new Field(
          "vector",
          new FixedSizeList(
            this.profile.dimensions,
            new Field("item", new Float32(), true),
          ),
          false,
        ),
      ],
      new Map([["profile", JSON.stringify(this.profile)]]),
    );
  }
  async initialize() {
    const db = await this.db();
    if (!(await db.tableNames()).includes(this.name))
      await db.createEmptyTable(this.name, this.schema());
    const table = await db.openTable(this.name);
    const schema = await table.schema();
    if (schema.metadata.get("profile") !== JSON.stringify(this.profile))
      throw new Error(
        "LanceDB profile이 일치하지 않습니다. 새 revision으로 재인덱싱하세요.",
      );
  }
  private async table(): Promise<Table | null> {
    const db = await this.db();
    if (!(await db.tableNames()).includes(this.name)) return null;
    // Open a fresh handle; readers see the latest committed worker snapshot.
    return db.openTable(this.name);
  }
  async upsert(record: VectorRecord) {
    const table = await this.table();
    if (!table) throw new Error("인덱스가 초기화되지 않았습니다.");
    const vector = normalizeVector(record.vector, this.profile.dimensions);
    await table
      .mergeInsert("key")
      .whenMatchedUpdateAll()
      .whenNotMatchedInsertAll()
      .execute([{ ...record, vector }]);
  }
  async delete(key: string) {
    const table = await this.table();
    if (table) await table.delete(`key = ${literal(key)}`);
  }
  async clear() {
    const table = await this.table();
    if (table) await table.delete("true");
  }
  async search(
    vector: number[],
    filter: { types: EntityType[]; domain?: string; limit: number },
  ): Promise<Candidate[]> {
    const table = await this.table();
    if (!table)
      throw new Error(
        "인덱스가 없습니다. worker 또는 재인덱싱 명령을 실행하세요.",
      );
    const clauses = [`entityType IN (${filter.types.map(literal).join(",")})`];
    if (filter.domain) clauses.push(`domain = ${literal(filter.domain)}`);
    const rows = await table
      .vectorSearch(normalizeVector(vector, this.profile.dimensions))
      .distanceType("cosine")
      .where(clauses.join(" AND "))
      .limit(filter.limit)
      .toArray();
    return rows.map((row) => ({
      key: String(row.key),
      entityType: row.entityType as EntityType,
      entityId: String(row.entityId),
      termId: String(row.termId),
      domain: String(row.domain),
      version: Number(row.version),
      stamp: String(row.stamp),
      score: Math.max(-1, Math.min(1, 1 - Number(row._distance))),
    }));
  }
}
