/**
 * Single swap point for storage.
 *
 * When the team picks a database, add the new implementation (e.g.
 * `prisma-repository.ts`) and change the one line below. Nothing else in the
 * codebase imports a concrete repository.
 */

import { memoryRepository } from "./memory-repository";
import type { Repository } from "./repository";

export function getRepository(): Repository {
  return memoryRepository;
}
