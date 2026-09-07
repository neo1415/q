import { createPostgresEvidenceRepositories } from "@capital-q/evidence";

import { createPostgresQKnowledgeRepositories } from "../infrastructure/postgres-chunk-repositories.js";
import type { QKnowledgeRepositories } from "./ports.js";
import {
  createBuildChunkSet,
  createListActiveChunks,
  createListChunks,
  createListChunkSets,
  createRebuildChunkSet,
  createRevokeChunkSets,
  type QKnowledgeDependencies,
} from "./use-cases.js";

/**
 * The chunk service the processing worker and operator commands compose.
 * Server-internal. There is deliberately no query that searches chunk text
 * across documents or subjects: retrieval arrives in later packets behind
 * the Context Firewall, and Q never receives this surface as a tool.
 */
export type QKnowledgeService = {
  readonly buildChunkSet: ReturnType<typeof createBuildChunkSet>;
  readonly rebuildChunkSet: ReturnType<typeof createRebuildChunkSet>;
  readonly revokeChunkSets: ReturnType<typeof createRevokeChunkSets>;
  readonly listChunkSets: ReturnType<typeof createListChunkSets>;
  readonly listChunks: ReturnType<typeof createListChunks>;
  readonly listActiveChunks: ReturnType<typeof createListActiveChunks>;
};

export type QKnowledgeServiceOptions = Omit<
  QKnowledgeDependencies,
  "repositories" | "evidence"
> & {
  readonly repositories?: QKnowledgeRepositories | undefined;
  readonly evidence?: QKnowledgeDependencies["evidence"] | undefined;
};

export function createQKnowledgeService(
  options: QKnowledgeServiceOptions,
): QKnowledgeService {
  const dependencies: QKnowledgeDependencies = {
    ...options,
    evidence: options.evidence ?? createPostgresEvidenceRepositories(),
    repositories:
      options.repositories ?? createPostgresQKnowledgeRepositories(),
  };
  return {
    buildChunkSet: createBuildChunkSet(dependencies),
    rebuildChunkSet: createRebuildChunkSet(dependencies),
    revokeChunkSets: createRevokeChunkSets(dependencies),
    listChunkSets: createListChunkSets(dependencies),
    listChunks: createListChunks(dependencies),
    listActiveChunks: createListActiveChunks(dependencies),
  };
}
