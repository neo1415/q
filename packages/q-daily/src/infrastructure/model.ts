import type { ModelDataPosture } from "@capital-q/contracts";
import type { ModelGateway } from "@capital-q/model-gateway";
import { budgetForTaskClass } from "@capital-q/model-gateway/q";
import {
  createDefaultPromptRegistry,
  DailyQTakeResultSchema,
  DailyStoryWriterResultSchema,
  DEFAULT_COMMUNICATION_PROFILE,
  renderPrompt,
  type DailyQTakeResult,
  type DailyQTakeVariables,
  type DailyStoryWriterResult,
  type DailyStoryWriterVariables,
} from "@capital-q/q-core";

import type { DailyStoryWriterPort, DailyTakePort } from "../ports.js";

/**
 * The Q Daily's two model steps, through the Q Model Gateway only (DAILY
 * spec §6, §8). Story writing reads public web text (PUBLIC sensitivity);
 * Q's take also reads the reader's own focus and raise, so it is declared
 * CONFIDENTIAL and routed only where that is allowed. A failure is null:
 * the pipeline then prints the source's own words.
 */
type Logger = {
  readonly warn: (fields: Record<string, unknown>, message: string) => void;
};

const NO_TOOLS =
  "No tools are available to you. Use only the material supplied; there is no scoring service.";

export function createGatewayDailyWriters(dependencies: {
  readonly gateway: Pick<ModelGateway, "execute">;
  readonly dataPosture?: ModelDataPosture | undefined;
  readonly logger?: Logger | undefined;
}): { readonly writer: DailyStoryWriterPort; readonly take: DailyTakePort } {
  const registry = createDefaultPromptRegistry();
  const { gateway, logger } = dependencies;
  const posture =
    dependencies.dataPosture === undefined
      ? {}
      : { dataPosture: dependencies.dataPosture };

  return {
    writer: {
      write: async (input, attribution, signal) => {
        const rendered = renderPrompt<DailyStoryWriterVariables>(registry, {
          task: "DAILY_STORY_WRITER",
          operatingMode: "ASSESSMENT",
          communicationProfile: DEFAULT_COMMUNICATION_PROFILE,
          environmentNotes: NO_TOOLS,
          variables: input,
        });
        try {
          const result = await gateway.execute<DailyStoryWriterResult>(
            {
              taskClass: "STRUCTURED_EXTRACTION",
              budget: budgetForTaskClass("STRUCTURED_EXTRACTION"),
              ...posture,
              sensitivity: "PUBLIC",
              messages: [...rendered.messages],
              output: rendered.output,
              attribution,
            },
            {
              schema: DailyStoryWriterResultSchema,
              ...(signal === undefined ? {} : { signal }),
            },
          );
          return result.output.kind === "STRUCTURED"
            ? result.output.value
            : null;
        } catch (error: unknown) {
          logger?.warn(
            { err: error, correlationId: attribution.correlationId },
            "q daily story writer produced nothing; source words printed",
          );
          return null;
        }
      },
    },
    take: {
      take: async (input, attribution, signal) => {
        const rendered = renderPrompt<DailyQTakeVariables>(registry, {
          task: "DAILY_Q_TAKE",
          operatingMode: "ASSESSMENT",
          communicationProfile: DEFAULT_COMMUNICATION_PROFILE,
          environmentNotes: NO_TOOLS,
          variables: input,
        });
        try {
          const result = await gateway.execute<DailyQTakeResult>(
            {
              taskClass: "EVIDENCE_SYNTHESIS",
              budget: budgetForTaskClass("EVIDENCE_SYNTHESIS"),
              ...posture,
              sensitivity: "CONFIDENTIAL",
              messages: [...rendered.messages],
              output: rendered.output,
              attribution,
            },
            {
              schema: DailyQTakeResultSchema,
              ...(signal === undefined ? {} : { signal }),
            },
          );
          return result.output.kind === "STRUCTURED"
            ? result.output.value
            : null;
        } catch (error: unknown) {
          logger?.warn(
            { err: error, correlationId: attribution.correlationId },
            "q daily take produced nothing; edition printed without it",
          );
          return null;
        }
      },
    },
  };
}
