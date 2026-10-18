import type { Logger } from "@capital-q/observability";
import type { QAnswerRequest } from "@capital-q/q-runtime";
import type { ActorContext } from "@capital-q/security";

/**
 * The names across the person's own relationships, for telling whether a
 * request to act is about one of them (lead 2026-10-03, run 9b4ef8d1). A
 * failed read is logged and read as none: it can only narrow what Q is
 * offered, never widen what it may do.
 */
export function createCounterpartNames(dependencies: {
  readonly ownRelationships:
    | ((actor: ActorContext) => Promise<{
        readonly items: readonly {
          readonly counterpart: { readonly name: string };
        }[];
      } | null>)
    | undefined;
  readonly logger?: Logger | undefined;
}): (request: QAnswerRequest) => Promise<readonly string[]> {
  return async (request) => {
    const read = dependencies.ownRelationships;
    if (read === undefined) {
      dependencies.logger?.warn(
        { qRunId: request.runId },
        "q counterparts not composed",
      );
      return [];
    }
    try {
      const own = await read(request.actor);
      const names = (own?.items ?? []).map((item) => item.counterpart.name);
      dependencies.logger?.info(
        { qRunId: request.runId, counterparts: names.length },
        "q counterparts read",
      );
      return names;
    } catch (error: unknown) {
      dependencies.logger?.warn(
        { err: error, qRunId: request.runId },
        "q counterparts not read",
      );
      return [];
    }
  };
}
