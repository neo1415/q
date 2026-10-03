import type { ModelDataPosture } from "@capital-q/contracts";
import type { ModelGateway } from "@capital-q/model-gateway";
import type { Logger } from "@capital-q/observability";
import {
  createDefaultPromptRegistry,
  DEFAULT_COMMUNICATION_PROFILE,
  ProfileGapReaderResultSchema,
  renderPrompt,
  type ProfileGapReaderResult,
  type ProfileGapReaderVariables,
} from "@capital-q/q-core";
import type { ProfileGapReader } from "@capital-q/q-specialists";

/**
 * The constrained model step of filling a profile's gaps (HARDEN P0,
 * 2026-10-02): PROFILE_GAP_READER under STRUCTURED_EXTRACTION, a strict
 * schema, no tools. It maps sources onto the open fields and nothing else;
 * the analyst is never asked. What it returns is checked by code twice
 * after it (quote in a cited source; open field, run source, no conflict).
 */

const BUDGET = {
  maxAttempts: 2,
  maxEstimatedCostUsd: 0.03,
  maxOutputTokens: 1_200,
  attemptTimeoutMs: 25_000,
} as const;

/** The form each company field's value takes, as the profile holds it. */
const FORMS: Readonly<Record<string, string>> = {
  legalName: "the registered legal name, as written",
  websiteUrl: "the company's own website, as an https:// address",
  foundedDate:
    "the founding date as YYYY-MM-DD (YYYY-01-01 when only the year is stated)",
  headquartersCountry:
    "the headquarters country as a two-letter ISO 3166 code, such as NG",
  headquartersCity: "the headquarters city, as a name",
  currentStageCode:
    "the funding stage as lower_snake_case: pre_seed, seed, series_a, series_b, growth",
  primaryDescription: "what the company does, two to four plain sentences",
  shortDescription: "what the company does, one line",
  canonicalName: "the company's name",
};

export function createProfileGapReader(dependencies: {
  readonly gateway: ModelGateway;
  readonly dataPosture?: ModelDataPosture | undefined;
  readonly logger?: Logger | undefined;
}): ProfileGapReader {
  const registry = createDefaultPromptRegistry();
  const { gateway, logger } = dependencies;
  return async ({ request, companyName, openFields, forms, sources }) => {
    if (openFields.length === 0 || sources.length === 0) return null;
    const rendered = renderPrompt<ProfileGapReaderVariables>(registry, {
      task: "PROFILE_GAP_READER",
      operatingMode: "ASSESSMENT",
      communicationProfile: DEFAULT_COMMUNICATION_PROFILE,
      environmentNotes:
        "No tools are available to you. Report only what the supplied sources say.",
      variables: {
        companyName: companyName.slice(0, 160),
        openFields: openFields.map((field) => ({
          field,
          form: forms[field] ?? FORMS[field] ?? "as the source states it",
        })),
        sources: sources.slice(0, 8).map((source) => ({
          index: source.index,
          url: source.url.slice(0, 500),
          title: source.title === null ? null : source.title.slice(0, 300),
          excerpt: source.excerpt.slice(0, 4_000),
        })),
      },
    });
    try {
      const result = await gateway.execute<ProfileGapReaderResult>(
        {
          taskClass: "STRUCTURED_EXTRACTION",
          budget: BUDGET,
          ...(dependencies.dataPosture === undefined
            ? {}
            : { dataPosture: dependencies.dataPosture }),
          // Public sources about the founder's own company.
          sensitivity: "INTERNAL",
          messages: [...rendered.messages],
          output: rendered.output,
          attribution: {
            purpose: "ONBOARDING",
            tenantId: request.actor.tenantId,
            userId: request.actor.userId,
            correlationId: request.correlationId,
          },
        },
        { schema: ProfileGapReaderResultSchema },
      );
      return result.output.kind === "STRUCTURED"
        ? ProfileGapReaderResultSchema.parse(result.output.value)
        : null;
    } catch (error: unknown) {
      logger?.warn(
        { err: error, correlationId: request.correlationId },
        "profile gap reader produced nothing",
      );
      return null;
    }
  };
}
