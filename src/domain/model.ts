export const collections = ["terms", "expressions", "rules"] as const;
export type Collection = (typeof collections)[number];
export const entityTypes = ["TERM", "EXPRESSION", "RULE"] as const;
export type EntityType = (typeof entityTypes)[number];
export const statuses = ["DRAFT", "ACTIVE", "INACTIVE", "DEPRECATED"] as const;
export type Status = (typeof statuses)[number];
export const ruleTypes = [
  "FORMAT",
  "MASKING",
  "REQUIRED",
  "ENUM",
  "RANGE",
  "PROHIBITED",
  "RELATION",
  "CUSTOM",
] as const;
export const expressionTypes = [
  "ALIAS",
  "ABBREVIATION",
  "TRANSLATION",
  "OTHER",
] as const;
export const kindOf: Record<Collection, EntityType> = {
  terms: "TERM",
  expressions: "EXPRESSION",
  rules: "RULE",
};
export const collectionOf: Record<EntityType, Collection> = {
  TERM: "terms",
  EXPRESSION: "expressions",
  RULE: "rules",
};
export type JsonObject = Record<string, unknown>;
export type IndexStatus = "PENDING" | "PROCESSING" | "READY" | "FAILED";
export interface Entity {
  id: string;
  status: Status;
  version: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  name?: string;
  definition?: string;
  domain: string;
  text?: string;
  type?: (typeof expressionTypes)[number];
  termId?: string;
  description?: string;
  ruleType?: (typeof ruleTypes)[number];
  scope?: JsonObject;
  condition?: JsonObject;
  action?: JsonObject;
  priority?: number;
  termName?: string;
  parentVersion?: number;
  parentStatus?: Status;
  parentDeletedAt?: string | null;
  embeddingStatus?: IndexStatus;
  embeddingError?: string | null;
  embeddingUpdatedAt?: string | null;
}
export interface Profile {
  id: string;
  provider: string;
  model: string;
  dimensions: number;
  revision: string;
}
export interface Snapshot {
  entityType: EntityType;
  entity: Entity;
  stamp: string;
  searchable: boolean;
  text: string;
}
export interface VectorRecord {
  key: string;
  entityType: EntityType;
  entityId: string;
  termId: string;
  domain: string;
  version: number;
  stamp: string;
  vector: number[];
}
export interface Candidate extends Omit<VectorRecord, "vector"> {
  score: number;
}
export interface SearchOptions {
  query: string;
  types: EntityType[];
  domain?: string;
  topK: number;
}
export interface ListOptions {
  q?: string;
  domain?: string;
  status?: Status;
  termId?: string;
  page: number;
  pageSize: number;
}
export interface Page {
  items: Entity[];
  total: number;
  page: number;
  pageSize: number;
}
export interface SearchResult {
  type: EntityType;
  id: string;
  text: string;
  termId?: string;
  termName?: string;
  domain: string;
  score: number;
}
export function normalize(text: string) {
  return text
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[A-Z]/g, (c) => c.toLowerCase());
}
export function snapshot(entityType: EntityType, entity: Entity): Snapshot {
  const text =
    entityType === "TERM"
      ? `표준용어: ${entity.name}\n정의: ${entity.definition}\n도메인: ${entity.domain}`
      : entityType === "EXPRESSION"
        ? entity.text!
        : `규칙명: ${entity.name}\n규칙유형: ${entity.ruleType}\n설명: ${entity.description}`;
  return {
    entityType,
    entity,
    text,
    stamp: `${entity.version}:${entity.parentVersion ?? 0}`,
    searchable:
      !entity.deletedAt &&
      entity.status === "ACTIVE" &&
      (entityType === "TERM" ||
        (!entity.parentDeletedAt && entity.parentStatus === "ACTIVE")),
  };
}
export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
