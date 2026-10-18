import type { ModelDataPosture } from "@capital-q/contracts";
import type { Logger } from "@capital-q/observability";
import {
  createDefaultPromptRegistry,
  DEFAULT_COMMUNICATION_PROFILE,
  PersonBriefReaderResultSchema,
  renderPrompt,
  type PersonBriefReaderResult,
  type PersonBriefReaderVariables,
} from "@capital-q/q-core";

import type { ModelGateway } from "../gateway.js";

/**
 * W2: the model that reads a few public pages about a public person,
 * organisation or agency and PROPOSES assertions with the page's own words.
 * It is a reader; code decides what is admitted (`admitAssertions`), and no
 * private Capital Q context is in its prompt (only public page text and
 * the name the member gave).
 */

const READER_BUDGET = {
  maxAttempts: 2,
  maxEstimatedCostUsd: 0.05,
  maxOutputTokens: 2_400,
  attemptTimeoutMs: 20_000,
} as const;

export type PersonBriefReaderInput = {
  readonly subjectName: string;
  readonly entityKind: "PERSON" | "ORGANIZATION" | "GOVERNMENT_AGENCY";
  readonly sources: readonly {
    readonly url: string;
    readonly title: string | null;
    readonly publishedAt: string | null;
    readonly excerpt: string;
  }[];
  readonly attribution: {
    readonly tenantId: string;
    readonly userId: string;
    readonly correlationId: string;
  };
  readonly signal?: AbortSignal | undefined;
};

export type ProposedBriefAssertion = {
  readonly topic: PersonBriefReaderResult["assertions"][number]["topic"];
  readonly text: string;
  readonly assertionClass: PersonBriefReaderResult["assertions"][number]["assertionClass"];
  readonly sourceRefs: readonly number[];
  readonly quote: string;
};

export function createPersonBriefReader(dependencies: {
  readonly gateway: ModelGateway;
  readonly dataPosture?: ModelDataPosture | undefined;
  readonly logger?: Logger | undefined;
}): (
  input: PersonBriefReaderInput,
) => Promise<readonly ProposedBriefAssertion[] | null> {
  const registry = createDefaultPromptRegistry();
  return async (input) => {
    const rendered = renderPrompt<PersonBriefReaderVariables>(registry, {
      task: "PERSON_BRIEF_READER",
      operatingMode: "ASSESSMENT",
      communicationProfile: DEFAULT_COMMUNICATION_PROFILE,
      environmentNotes:
        "No tools are available to you. Report only what the supplied pages say.",
      variables: {
        subjectName: input.subjectName.slice(0, 200),
        entityKind: input.entityKind,
        sources: input.sources.slice(0, 10).map((source, index) => ({
          index,
          url: source.url.slice(0, 500),
          title: source.title === null ? null : source.title.slice(0, 300),
          publishedAt: source.publishedAt,
          excerpt: source.excerpt.slice(0, 6_000),
        })),
      },
    });
    try {
      const result =
        await dependencies.gateway.execute<PersonBriefReaderResult>(
          {
            taskClass: "STRUCTURED_EXTRACTION",
            budget: READER_BUDGET,
            ...(dependencies.dataPosture === undefined
              ? {}
              : { dataPosture: dependencies.dataPosture }),
            // Public pages and a name the member typed. Nothing confidential
            // is in the prompt, and nothing may be added to it.
            sensitivity: "INTERNAL",
            messages: [...rendered.messages],
            output: rendered.output,
            attribution: {
              purpose: "RESEARCH",
              tenantId: input.attribution.tenantId,
              userId: input.attribution.userId,
              correlationId: input.attribution.correlationId,
            },
          },
          {
            schema: PersonBriefReaderResultSchema,
            ...(input.signal === undefined ? {} : { signal: input.signal }),
          },
        );
      if (result.output.kind !== "STRUCTURED") return null;
      const value = PersonBriefReaderResultSchema.safeParse(
        result.output.value,
      );
      if (!value.success || value.data.wrongSubject) return null;
      return value.data.assertions;
    } catch (error: unknown) {
      dependencies.logger?.warn(
        { err: error, correlationId: input.attribution.correlationId },
        "person brief reader produced nothing",
      );
      return null;
    }
  };
}
