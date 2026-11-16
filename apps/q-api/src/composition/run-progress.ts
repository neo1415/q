import type {
  ModelGatewayRequestInput,
  ModelGatewayResult,
} from "@capital-q/contracts";
import type {
  ModelGateway,
  ModelGatewayExecuteOptions,
} from "@capital-q/model-gateway";
import type { QToolPort, RunProgress } from "@capital-q/q-runtime";

/**
 * What tells the run progress deadline a run is moving (16 Nov 2026; see
 * packages/q-runtime run-progress.ts): every model call made for a run
 * (attributed by its run id, from the turn reader to a tool's own call)
 * and every tool result. Observation only: arguments, results and errors
 * pass through unchanged, and nothing here can fail a call.
 */

/** The gateway, with each run-attributed call marked started and ended. */
export function progressObservedGateway(
  gateway: ModelGateway,
  progress: RunProgress,
): ModelGateway {
  return {
    execute: async <T = never>(
      request: ModelGatewayRequestInput,
      options?: ModelGatewayExecuteOptions<T>,
    ): Promise<ModelGatewayResult<T>> => {
      const runId = request.attribution.qRunId;
      if (runId === undefined) return gateway.execute<T>(request, options);
      progress.callStarted(runId);
      try {
        return await gateway.execute<T>(request, options);
      } finally {
        progress.callEnded(runId);
      }
    },
  };
}

/** The tool port, with each finished tool call noted on its run. */
export function progressObservedTools(
  port: QToolPort,
  progress: RunProgress,
): QToolPort {
  return {
    ...port,
    execute: async (proposal, context) => {
      try {
        return await port.execute(proposal, context);
      } finally {
        progress.note(context.runId);
      }
    },
  };
}
