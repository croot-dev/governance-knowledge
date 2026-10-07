import type {
  Candidate,
  Collection,
  Entity,
  EntityType,
  ListOptions,
  Page,
  Profile,
  Snapshot,
  VectorRecord,
} from "./model";
export interface EmbeddingProvider {
  profile: Profile;
  embedQuery(text: string): Promise<number[]>;
  embedDocuments(texts: string[]): Promise<number[][]>;
}
export interface VectorStore {
  initialize(): Promise<void>;
  upsert(record: VectorRecord): Promise<void>;
  delete(key: string): Promise<void>;
  search(
    vector: number[],
    filter: { types: EntityType[]; domain?: string; limit: number },
  ): Promise<Candidate[]>;
  clear(): Promise<void>;
}
export interface IndexJob {
  entityType: EntityType;
  entityId: string;
  revision: number;
  attempts: number;
}
export interface IndexRepository {
  claim(): Promise<IndexJob | null>;
  getSnapshot(type: EntityType, id: string): Promise<Snapshot | null>;
  finish(job: IndexJob, error?: string): Promise<void>;
}

export interface GovernancePort {
  list(collection: Collection, options: ListOptions): Promise<Page>;
  get(collection: Collection, id: string): Promise<Entity | null>;
  create(
    collection: Collection,
    data: Record<string, unknown>,
  ): Promise<Entity>;
  update(
    collection: Collection,
    id: string,
    transform: (current: Record<string, unknown>) => Record<string, unknown>,
  ): Promise<Entity>;
  delete(collection: Collection, id: string): Promise<void>;
}

export interface ActiveRule {
  id: string;
  name: string;
  ruleType: string;
  condition: Record<string, unknown>;
  action: Record<string, unknown>;
}
export interface ActiveGovernance {
  expressions: { text: string; termId: string; termName: string }[];
  rules: ActiveRule[];
}
// Reads only the relational source; document transformation never needs the vector index.
export interface ActiveGovernancePort {
  loadActive(): Promise<ActiveGovernance>;
}
