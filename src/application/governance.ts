import { AppError, type Collection } from "../domain/model";
import {
  idSchema,
  listSchema,
  validateEntity,
  validatePatch,
} from "../domain/validation";
import type { GovernancePort } from "../domain/ports";
export class GovernanceService {
  constructor(private repository: GovernancePort) {}
  list(collection: Collection, input: unknown) {
    return this.repository.list(collection, listSchema.parse(input));
  }
  async get(collection: Collection, id: string) {
    const entity = await this.repository.get(collection, idSchema.parse(id));
    if (!entity)
      throw new AppError(404, "NOT_FOUND", "항목을 찾을 수 없습니다.");
    return entity;
  }
  create(collection: Collection, input: unknown) {
    return this.repository.create(
      collection,
      validateEntity(collection, input),
    );
  }
  update(collection: Collection, id: string, input: unknown) {
    const patch = validatePatch(collection, input);
    return this.repository.update(collection, idSchema.parse(id), (current) =>
      validateEntity(collection, { ...current, ...patch }),
    );
  }
  delete(collection: Collection, id: string) {
    return this.repository.delete(collection, idSchema.parse(id));
  }
}
