import { z } from "zod";

import {
  ExternalEntityKindSchema,
  PersonSearchResultSchema,
} from "@capital-q/contracts/q";

import {
  allow,
  defineQTool,
  deny,
  type AnyQToolDefinition,
} from "../definition.js";
import { actorWideScope } from "../plan.js";
import type { QToolPorts } from "../ports.js";

/**
 * FIND_PUBLIC_ENTITY -- `people.find` v1 (W2, 2026-10-10).
 *
 * "Find Shadi Qishta, Doha, Qatar": identify one named person, company or
 * government body outside Capital Q from public sources, fast. A prepared
 * entity answers from the known-entity index with no web call; anyone else
 * goes through a bounded parallel identity search (a few seconds, never a
 * research report). The result is an identity card or a short question
 * between plausible people, built by code; the model never writes it.
 *
 * Read-only and public-only: nothing here reads Capital Q records, and the
 * query that leaves is composed from the member's own words only. What is
 * found is public material of unknown reliability, never a Capital Q fact.
 */

export const FIND_PUBLIC_ENTITY = "people.find" as const;

export const FindPublicEntityInputSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(2)
      .max(120)
      .describe(
        "The person's, company's or body's name exactly as the member said it, in the script they used. Never add or translate anything.",
      ),
    entityKind: ExternalEntityKindSchema.default("PERSON").describe(
      "PERSON, ORGANIZATION or GOVERNMENT_AGENCY.",
    ),
    city: z.string().trim().max(80).nullable().default(null),
    country: z.string().trim().max(80).nullable().default(null),
    organization: z
      .string()
      .trim()
      .max(120)
      .nullable()
      .default(null)
      .describe("Only an employer the member named; never a guess."),
    role: z
      .string()
      .trim()
      .max(120)
      .nullable()
      .default(null)
      .describe("Only a role the member named; never a guess."),
    freshSearch: z
      .boolean()
      .default(false)
      .describe(
        "True only when the member asks to search again, refresh, or check what is new.",
      ),
  })
  .strict();
export type FindPublicEntityInput = z.infer<typeof FindPublicEntityInputSchema>;

export const FindPublicEntityOutputSchema = z
  .object({
    result: PersonSearchResultSchema,
    /** KNOWN_ENTITY: prepared and answered with no web call. WEB: searched now. */
    source: z.enum(["KNOWN_ENTITY", "WEB"]),
    truthClass: z.literal("UNKNOWN"),
    guidance: z.string().max(800),
  })
  .strict();
export type FindPublicEntityOutput = z.infer<
  typeof FindPublicEntityOutputSchema
>;

const GUIDANCE =
  "The identity card is already on screen, built from public sources: do not repeat its fields. Say in one short sentence who was found, as REPORTED (reportedly, according to their LinkedIn, using the card's attributionLine) and how sure it is; search-indexed findings are usable but never stated as verified fact, then offer to research them further or to rehearse a conversation with them. If there are several candidates, ask the one question given. If nothing was found, say so plainly and ask for a city or company; never guess or describe someone from general knowledge. Public sources are unverified.";

export function createFindPublicEntityTool(
  ports: QToolPorts & {
    readonly people: NonNullable<QToolPorts["people"]>;
  },
): AnyQToolDefinition {
  return defineQTool<
    FindPublicEntityInput,
    FindPublicEntityOutput,
    Record<string, never>
  >({
    id: FIND_PUBLIC_ENTITY,
    version: 1,
    status: "ACTIVE",
    providerName: "find_public_entity",
    description:
      "Finds one named person, company or government body outside Capital Q from public sources and returns an identity card (name, public profile link, role, organisation, location, sources, confidence, uncertainty), or the few plausible people to choose between. Fast: use it for any 'find / look up / who is <name>' request instead of the general research tool. Prepared entities answer instantly. Results are unverified public material; they never change Capital Q records.",
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
    input: FindPublicEntityInputSchema,
    output: FindPublicEntityOutputSchema,
    authorize: (_input, context) =>
      Promise.resolve(
        actorWideScope(context.plan, "PUBLIC_EXTERNAL_DATA") === undefined
          ? deny("NOT_AVAILABLE")
          : allow("PUBLIC", {}),
      ),
    execute: async (input, context) => {
      const place =
        [input.city, input.country]
          .filter((part): part is string => part !== null && part.length > 0)
          .join(" ") || null;
      const found = await ports.people.find({
        tenantId: context.actor.tenantId,
        userId: context.actor.userId,
        name: input.name,
        place,
        organization: input.organization,
        role: input.role,
        userText: context.conversation?.latestUserText ?? "",
        earlierUserText: context.conversation?.earlierUserText,
        freshSearch: input.freshSearch,
        signal: context.signal,
      });
      return {
        result: found.result,
        source: found.source,
        truthClass: "UNKNOWN",
        guidance: GUIDANCE,
      };
    },
  });
}
