import {
  isTerminalQRunStatus,
  Q_RUN_MESSAGES_MAX,
  type CorrelationId,
  type QRunId,
  type QRunSummary,
  type QVisibleStage,
} from "@capital-q/contracts";
import type { ActorContext } from "@capital-q/security";

import {
  toQRunSummary,
  type QConversationMessage,
  type QRunRecord,
} from "../contracts/index.js";
import { ownedRun } from "./access.js";
import type { QRuntimeDependencies } from "./dependencies.js";

export type GetQRunQuery = {
  readonly actor: ActorContext;
  readonly runId: QRunId;
  readonly correlationId?: CorrelationId | undefined;
};

export type GetQRunResult = {
  readonly run: QRunRecord;
  readonly messages: readonly QConversationMessage[];
  readonly visibleStage: QVisibleStage | null;
  /** The public projection, built by parsing into the contract. */
  readonly summary: QRunSummary;
};

/**
 * Read a run as its owner. The projection is the allowlist: version
 * identities, the internal failure code, the event allocator and every
 * other runtime field stay behind it. The visible stage is the latest one
 * the run's events carry, and none once the run has ended.
 */
export function createGetQRun(dependencies: QRuntimeDependencies) {
  const { sql, repositories } = dependencies;

  return async (query: GetQRunQuery): Promise<GetQRunResult> => {
    const run = await ownedRun(
      dependencies,
      sql,
      query.actor,
      query.runId,
      query.correlationId,
    );
    const messages = await repositories.messages.listForRun(
      sql,
      run.tenantId,
      run.id,
      Q_RUN_MESSAGES_MAX,
    );
    const visibleStage = isTerminalQRunStatus(run.status)
      ? null
      : await repositories.runEvents.latestVisibleStage(
          sql,
          run.tenantId,
          run.id,
        );
    return {
      run,
      messages,
      visibleStage,
      summary: toQRunSummary(run, messages, visibleStage),
    };
  };
}
