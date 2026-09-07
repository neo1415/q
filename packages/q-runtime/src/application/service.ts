import { createPostgresQRuntimeRepositories } from "../infrastructure/postgres-q-runtime-repositories.js";
import { createAppendQRunMessage } from "./append-message.js";
import { createCancelQRun } from "./cancel-run.js";
import { createCreateQRun } from "./create-run.js";
import type { QRuntimeDependencies } from "./dependencies.js";
import { createGetQRun } from "./get-run.js";
import type { QRuntimeRepositories } from "./ports.js";

/**
 * The Q runtime application surface: bound use cases, nothing else.
 *
 * Four operations, all about the durable spine of a run. There is no
 * `execute`, `answer`, `retrieve` or `stream` here; those are the packets
 * that follow, and they will consume this service rather than extend it
 * into an orchestrator.
 */
export type QRuntimeService = {
  readonly createRun: ReturnType<typeof createCreateQRun>;
  readonly getRun: ReturnType<typeof createGetQRun>;
  readonly appendMessage: ReturnType<typeof createAppendQRunMessage>;
  readonly cancelRun: ReturnType<typeof createCancelQRun>;
};

export type QRuntimeServiceOptions = Omit<
  QRuntimeDependencies,
  "repositories"
> & {
  readonly repositories?: QRuntimeRepositories | undefined;
};

export function createQRuntimeService(
  options: QRuntimeServiceOptions,
): QRuntimeService {
  const dependencies: QRuntimeDependencies = {
    ...options,
    repositories: options.repositories ?? createPostgresQRuntimeRepositories(),
  };
  return {
    createRun: createCreateQRun(dependencies),
    getRun: createGetQRun(dependencies),
    appendMessage: createAppendQRunMessage(dependencies),
    cancelRun: createCancelQRun(dependencies),
  };
}
