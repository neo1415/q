import { z } from "zod";

import { PersonBriefSchema } from "@capital-q/contracts/q";

import {
  allow,
  defineQTool,
  deny,
  type AnyQToolDefinition,
} from "../definition.js";
import { actorWideScope } from "../plan.js";
import type { QToolPorts } from "../ports.js";

/**
 * BRIEF_PUBLIC_ENTITY -- `people.brief` v1 (W2, 2026-10-10).
 *
 * "Research Shadi further" / "prepare me for them": the evidence-classed
 * brief on a public person, company or government body already found. It
 * is reused while fresh and scoped to the member who asked; "refresh"
 * searches again and files a new version. Every assertion is VERIFIED_
 * PUBLIC_FACT, PUBLIC_STATEMENT, REASONABLE_INFERENCE, UNKNOWN or
 * CONTRADICTORY_OR_STALE with sources and dates. An unknown stays unknown:
 * no preference is ever invented, and a finance executive is not a venture
 * investor by title.
 */

export const BRIEF_PUBLIC_ENTITY = "people.brief" as const;

export const BriefPublicEntityInputSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(2)
      .max(120)
      .describe("The name as the member said it, or as the card shows it."),
    externalPersonId: z
      .string()
      .uuid()
      .optional()
      .describe("The card's id, when the member points at a card on screen."),
    refresh: z
      .boolean()
      .default(false)
      .describe(
        "True only when the member asks to search again or refresh; otherwise a fresh stored brief is reused.",
      ),
  })
  .strict();
export type BriefPublicEntityInput = z.infer<
  typeof BriefPublicEntityInputSchema
>;

export const BriefPublicEntityOutputSchema = z
  .object({
    status: z.enum(["OK", "NOT_FOUND"]),
    brief: PersonBriefSchema.nullable(),
    reused: z.boolean(),
    truthClass: z.literal("UNKNOWN"),
    guidance: z.string().max(800),
  })
  .strict();
export type BriefPublicEntityOutput = z.infer<
  typeof BriefPublicEntityOutputSchema
>;

const GUIDANCE =
  "Speak only from the brief's assertions and name their class in plain words (public statement, inference, unknown, stale). Say what is unknown rather than filling it in. Never describe preferences, interests or style the brief does not state. Public sources are unverified.";

export function createBriefPublicEntityTool(
  ports: QToolPorts & {
    readonly people: NonNullable<QToolPorts["people"]>;
  },
): AnyQToolDefinition {
  return defineQTool<
    BriefPublicEntityInput,
    BriefPublicEntityOutput,
    Record<string, never>
  >({
    id: BRIEF_PUBLIC_ENTITY,
    version: 1,
    status: "ACTIVE",
    providerName: "brief_public_entity",
    description:
      "Builds or reuses the evidence-classed brief on a public person, company or government body the member already found: background, role, publicly stated views, interviews, recurring topics, each classed and cited, with unknowns stated. Use it for 'research them further', 'tell me more about them' or 'prepare me for them'. Set refresh only when they ask to search again.",
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
    input: BriefPublicEntityInputSchema,
    output: BriefPublicEntityOutputSchema,
    authorize: (_input, context) =>
      Promise.resolve(
        actorWideScope(context.plan, "PUBLIC_EXTERNAL_DATA") === undefined
          ? deny("NOT_AVAILABLE")
          : allow("PUBLIC", {}),
      ),
    execute: async (input, context) => {
      const outcome = await ports.people.brief({
        tenantId: context.actor.tenantId,
        userId: context.actor.userId,
        name: input.name,
        externalPersonId: input.externalPersonId,
        refresh: input.refresh,
        userText: context.conversation?.latestUserText,
        signal: context.signal,
      });
      if (outcome.status !== "OK") {
        return {
          status: "NOT_FOUND",
          brief: null,
          reused: false,
          truthClass: "UNKNOWN",
          guidance: GUIDANCE,
        };
      }
      return {
        status: "OK",
        brief: outcome.brief,
        reused: outcome.reused,
        truthClass: "UNKNOWN",
        guidance: GUIDANCE,
      };
    },
  });
}
