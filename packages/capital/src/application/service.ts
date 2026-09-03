import type { CapitalObjective } from "../contracts/index.js";
import {
  createPostgresCapitalObjectiveCreationRequestStore,
  createPostgresCapitalObjectiveHistoryWriter,
  createPostgresCapitalObjectiveRepository,
} from "../infrastructure/postgres-repositories.js";
import type { CapitalServiceDependencies } from "./dependencies.js";
import {
  createCloseCapitalObjective,
  createCreateCapitalObjective,
  createGetCapitalObjective,
  createGetCurrentCapitalObjective,
  createListCapitalObjectives,
  createReplaceCapitalObjective,
  createUpdateCapitalObjective,
  type CapitalObjectivePage,
  type CloseCapitalObjectiveCommand,
  type CreateCapitalObjectiveCommand,
  type GetCapitalObjectiveQuery,
  type GetCurrentCapitalObjectiveQuery,
  type ListCapitalObjectivesQuery,
  type ReplaceCapitalObjectiveCommand,
  type ReplacedCapitalObjective,
  type UpdateCapitalObjectiveCommand,
} from "./use-cases.js";

/**
 * The capital application service: the one entry point HTTP (and later
 * founder onboarding, Q tools and workers) calls. Routes stay thin.
 */
export type CapitalService = {
  readonly createCapitalObjective: (
    command: CreateCapitalObjectiveCommand,
  ) => Promise<CapitalObjective>;
  readonly getCurrentCapitalObjective: (
    query: GetCurrentCapitalObjectiveQuery,
  ) => Promise<CapitalObjective>;
  readonly getCapitalObjective: (
    query: GetCapitalObjectiveQuery,
  ) => Promise<CapitalObjective>;
  readonly listCapitalObjectives: (
    query: ListCapitalObjectivesQuery,
  ) => Promise<CapitalObjectivePage>;
  readonly updateCapitalObjective: (
    command: UpdateCapitalObjectiveCommand,
  ) => Promise<CapitalObjective>;
  readonly closeCapitalObjective: (
    command: CloseCapitalObjectiveCommand,
  ) => Promise<CapitalObjective>;
  readonly replaceCapitalObjective: (
    command: ReplaceCapitalObjectiveCommand,
  ) => Promise<ReplacedCapitalObjective>;
};

export type CapitalServiceOptions = Omit<
  CapitalServiceDependencies,
  "repositories"
> & {
  readonly repositories?:
    CapitalServiceDependencies["repositories"] | undefined;
};

export function createCapitalService(
  options: CapitalServiceOptions,
): CapitalService {
  const dependencies: CapitalServiceDependencies = {
    ...options,
    repositories: options.repositories ?? {
      objectives: createPostgresCapitalObjectiveRepository(),
      history: createPostgresCapitalObjectiveHistoryWriter(),
      creationRequests: createPostgresCapitalObjectiveCreationRequestStore(),
    },
  };

  return {
    createCapitalObjective: createCreateCapitalObjective(dependencies),
    getCurrentCapitalObjective: createGetCurrentCapitalObjective(dependencies),
    getCapitalObjective: createGetCapitalObjective(dependencies),
    listCapitalObjectives: createListCapitalObjectives(dependencies),
    updateCapitalObjective: createUpdateCapitalObjective(dependencies),
    closeCapitalObjective: createCloseCapitalObjective(dependencies),
    replaceCapitalObjective: createReplaceCapitalObjective(dependencies),
  };
}
