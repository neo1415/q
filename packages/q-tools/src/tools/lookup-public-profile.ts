import { z } from "zod";

import {
  PublicCompanyProfileSchema,
  PublicPersonProfileSchema,
  isResearchProviderFailure,
  type PublicProfileLookupProvider,
} from "@capital-q/q-research";

import {
  allow,
  defineQTool,
  deny,
  type AnyQToolDefinition,
} from "../definition.js";
import { actorWideScope } from "../plan.js";
import type { QToolPorts } from "../ports.js";

/**
 * LOOKUP_PUBLIC_PROFILE — `public_profile.lookup` v1 (CQ-Q-RESEARCH-001,
 * rework). One public LinkedIn person or company page, by the URL the
 * person gave, through a compliant data provider. Bounded public fields
 * come back as unverified material; nothing is recorded, and the only
 * thing that leaves Capital Q is the URL itself.
 */

export const LOOKUP_PUBLIC_PROFILE = "public_profile.lookup" as const;

export const LookupPublicProfileInputSchema = z
  .object({
    url: z
      .string()
      .trim()
      .url()
      .max(2_048)
      .describe(
        "A public LinkedIn page URL the person gave: linkedin.com/in/<person> or linkedin.com/company/<company>.",
      ),
  })
  .strict();
export type LookupPublicProfileInput = z.infer<
  typeof LookupPublicProfileInputSchema
>;

export const LookupPublicProfileOutputSchema = z
  .object({
    status: z.enum([
      "FOUND",
      "NOT_FOUND",
      "NOT_LINKEDIN",
      "PENDING",
      "PROVIDER_UNAVAILABLE",
    ]),
    /** Plain sentence for the person when status is not FOUND. */
    message: z.string().max(400).nullable(),
    profile: z
      .discriminatedUnion("kind", [
        PublicCompanyProfileSchema,
        PublicPersonProfileSchema,
      ])
      .nullable(),
    /** Public profile material is unverified until Capital Q's evidence rules say otherwise. */
    truthClass: z.literal("UNKNOWN"),
    guidance: z.string().max(600),
  })
  .strict();
export type LookupPublicProfileOutput = z.infer<
  typeof LookupPublicProfileOutputSchema
>;

const GUIDANCE =
  "This is what a public LinkedIn page says today, as a data provider read it: unverified and possibly stale. Say it as 'their LinkedIn page says', offer it as suggestions the person confirms or corrects, and never treat it as a fact about them.";

const MESSAGES: Readonly<
  Record<Exclude<LookupPublicProfileOutput["status"], "FOUND">, string>
> = {
  NOT_FOUND: "That page could not be read as a public profile.",
  NOT_LINKEDIN:
    "Only public LinkedIn person or company pages can be looked up here.",
  PENDING:
    "That page is taking longer to read than a conversation allows; ask again in a minute.",
  PROVIDER_UNAVAILABLE:
    "The profile provider is not available just now; nothing was looked up.",
};

export function createLookupPublicProfileTool(
  ports: QToolPorts & { readonly profiles: PublicProfileLookupProvider },
): AnyQToolDefinition {
  return defineQTool<
    LookupPublicProfileInput,
    LookupPublicProfileOutput,
    Record<string, never>
  >({
    id: LOOKUP_PUBLIC_PROFILE,
    version: 1,
    status: "ACTIVE",
    providerName: "lookup_public_profile",
    description:
      "Looks up one public LinkedIn person or company page by URL through a compliant data provider and returns bounded public fields: name, headline or about, location, current role or industries, company size, headquarters, website, follower counts. Call it when the person gives a LinkedIn link for themselves, their company or an investor, or asks what a LinkedIn page says. Unverified public material, never facts; it never changes Capital Q records.",
    classification: "READ_ONLY",
    riskClass: "SAFE_READ",
    requiredCapabilities: [],
    supportedPurposes: [
      "OWN_COMPANY_QUESTION",
      "COUNTERPARTY_COMPANY_QUESTION",
      "INVESTOR_QUESTION",
      "COMPARISON",
      "GENERAL_QUESTION",
    ],
    requiredScopeKinds: ["PUBLIC_EXTERNAL_DATA"],
    approval: "NONE",
    idempotency: "SAFE_TO_REPEAT",
    owner: "q-tools",
    visibleStage: "SEARCHING_PUBLIC_SOURCES",
    input: LookupPublicProfileInputSchema,
    output: LookupPublicProfileOutputSchema,
    authorize: (_input, context) => {
      if (actorWideScope(context.plan, "PUBLIC_EXTERNAL_DATA") === undefined) {
        return Promise.resolve(deny("NOT_AVAILABLE"));
      }
      return Promise.resolve(allow("PUBLIC", {}));
    },
    execute: async (input, context) => {
      try {
        const result = await ports.profiles.lookup(
          { url: input.url },
          { signal: context.signal },
        );
        if (result.status === "FOUND" && result.profile !== null) {
          return {
            status: "FOUND",
            message: null,
            profile: result.profile,
            truthClass: "UNKNOWN",
            guidance: GUIDANCE,
          };
        }
        const status = result.status === "FOUND" ? "NOT_FOUND" : result.status;
        return {
          status,
          message: MESSAGES[status],
          profile: null,
          truthClass: "UNKNOWN",
          guidance: GUIDANCE,
        };
      } catch (error: unknown) {
        if (isResearchProviderFailure(error)) {
          return {
            status: "PROVIDER_UNAVAILABLE",
            message: MESSAGES.PROVIDER_UNAVAILABLE,
            profile: null,
            truthClass: "UNKNOWN",
            guidance: GUIDANCE,
          };
        }
        throw error;
      }
    },
  });
}
