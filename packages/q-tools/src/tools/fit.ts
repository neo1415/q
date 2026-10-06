import { z } from "zod";

import {
  FIT_COMPARISON_MAX,
  FitComparisonDtoSchema,
  FitProfileDtoSchema,
  UuidSchema,
} from "@capital-q/contracts";
import { fitComparisonText, fitProfileText } from "@capital-q/discovery";

import {
  allow,
  defineQTool,
  deny,
  type AnyQToolDefinition,
  type QToolAuthorization,
} from "../definition.js";
import type { QToolExecutionContext } from "@capital-q/q-runtime";

import { actorWideScope } from "../plan.js";
import type { QToolPorts } from "../ports.js";

/**
 * FIT_PROFILE (`fit.profile` v1) and FIT_TOP_CANDIDATES
 * (`fit.top_candidates` v1): fit with the investor's own mandate, by Q
 * (founder brief B1, B2; ADR 0052).
 *
 * Q does not work out a fit. It reads the one the platform computed
 * (`ranking-config.v4`, deterministic, versioned) and explains it, the
 * same answer the cards and the profile show. The top N is ordered by
 * that model over the investor's OWN candidates only (their
 * relationships, the company requests sent to them, their feed); Q
 * explains the order, it never chooses it.
 *
 * Authorisation is the fit service's, before anything is read: the
 * actor's own investor organisation, then eligibility for VIEW under the
 * actor's viewpoint (Context Firewall). A company the reader may not see
 * is simply absent. Neither tool returns the internal value.
 *
 * Output is the typed `FitComparison` DTO plus a plain-text fallback, so a
 * surface that renders answer cards renders the DTO, and one that does
 * not still gets the same words.
 */

export const FIT_PROFILE = "fit.profile" as const;
export const FIT_TOP_CANDIDATES = "fit.top_candidates" as const;

// ADR 0059 (autopilot P2): the score out of 10 is Capital Q's, computed in
// code from the rows (`text` carries it as "7.5/10 · Good fit"); the model
// repeats it, never makes one.
const GUIDANCE =
  "Say each company's fit as the score out of 10 given in text beside its band in words (\"7.5/10 · Good fit\"), exactly as given; where no score is given, the band in words alone. Never a percentage, never a score of your own, never a different number. Then the parameter rows that matter, with their reasons. Unknown means not known yet, never bad. Q's view, if you give one, is labelled as your view and does not change the fit. Do not make a document or PDF unless the person asked for a file.";

const STATUSES = [
  "OK",
  /** The person is not on an investor organisation's side. */
  "NOT_INVESTOR",
  /** No active mandate: nothing to fit against yet. */
  "NO_MANDATE",
  /** The company is not one this person may see, or does not exist. */
  "NOT_FOUND",
  /** Fit is not composed in this deployment. */
  "NOT_AVAILABLE",
] as const;

export const FitProfileInputSchema = z
  .object({
    companyId: UuidSchema.describe(
      "The company. Use an id from discovery.slate, relationships or company requests; never invent one.",
    ),
  })
  .strict();
export type FitProfileInput = z.infer<typeof FitProfileInputSchema>;

export const FitProfileOutputSchema = z
  .object({
    status: z.enum(STATUSES),
    name: z.string().nullable(),
    profile: FitProfileDtoSchema.nullable(),
    /** The same profile as plain text. */
    text: z.string(),
    guidance: z.string(),
  })
  .strict();
export type FitProfileOutput = z.infer<typeof FitProfileOutputSchema>;

export const FitTopCandidatesInputSchema = z
  .object({
    limit: z
      .number()
      .int()
      .min(1)
      .max(FIT_COMPARISON_MAX)
      .optional()
      .describe("How many to put side by side. Default 3, up to 10."),
  })
  .strict();
export type FitTopCandidatesInput = z.infer<typeof FitTopCandidatesInputSchema>;

export const FitTopCandidatesOutputSchema = z
  .object({
    status: z.enum(STATUSES),
    /** The typed comparison the answer canvas renders. */
    comparison: FitComparisonDtoSchema.nullable(),
    /** The same comparison as plain text, for any surface without cards. */
    text: z.string(),
    guidance: z.string(),
  })
  .strict();
export type FitTopCandidatesOutput = z.infer<
  typeof FitTopCandidatesOutputSchema
>;

const TEXT: Readonly<Record<(typeof STATUSES)[number], string>> = {
  OK: "",
  NOT_INVESTOR: "Fit with a mandate is for investors.",
  NO_MANDATE:
    "There is no active mandate to measure fit against yet. Setting one up takes a minute.",
  NOT_FOUND: "That company is not one you can see a fit for.",
  NOT_AVAILABLE: "Fit is not available right now.",
};

const authorize = (
  _input: unknown,
  context: QToolExecutionContext,
): Promise<QToolAuthorization<null>> => {
  const network = actorWideScope(context.plan, "NETWORK_VISIBLE_DATA");
  return Promise.resolve(
    network === undefined
      ? deny<null>("NOT_AVAILABLE")
      : allow<null>(network.sensitivity, null),
  );
};

const SHARED = {
  version: 1,
  status: "ACTIVE",
  classification: "READ_ONLY",
  riskClass: "SAFE_READ",
  requiredCapabilities: [],
  supportedPurposes: [
    "COUNTERPARTY_COMPANY_QUESTION",
    "INVESTOR_QUESTION",
    "RELATIONSHIP_QUESTION",
    "COMPARISON",
    "GENERAL_QUESTION",
  ],
  requiredScopeKinds: ["NETWORK_VISIBLE_DATA"],
  approval: "NONE",
  idempotency: "SAFE_TO_REPEAT",
  owner: "q-tools",
  visibleStage: "COMPARING_OPPORTUNITIES",
} as const;

export function createFitProfileTool(ports: QToolPorts): AnyQToolDefinition {
  return defineQTool<FitProfileInput, FitProfileOutput, null>({
    ...SHARED,
    id: FIT_PROFILE,
    providerName: "fit_profile",
    description:
      "Reads how well one company fits this investor's own mandate, as Capital Q computed it: a score out of 10 (when enough is known), a band and a confidence in words, and for each of nine parameters (stage, sector, geography, cheque size, business model, traction, team, thesis, round terms) an outcome and a reason. Call it whenever an investor asks how a company fits, whether it matches their mandate, or what is unknown about it. Do not work out a fit yourself.",
    input: FitProfileInputSchema,
    output: FitProfileOutputSchema,
    authorize,
    execute: async (input, context) => {
      const fit = ports.fit;
      const none = (status: (typeof STATUSES)[number]): FitProfileOutput => ({
        status,
        name: null,
        profile: null,
        text: TEXT[status],
        guidance: GUIDANCE,
      });
      if (fit === undefined) return none("NOT_AVAILABLE");
      const result = await fit.profiles(context.actor, [input.companyId]);
      if (result.kind !== "OK") return none(result.kind);
      const item = result.items[0];
      if (item === undefined) return none("NOT_FOUND");
      return {
        status: "OK",
        name: item.name,
        profile: item.assessment.profile,
        text: fitProfileText(item.name, item.assessment.profile),
        guidance: GUIDANCE,
      };
    },
  });
}

export function createFitTopCandidatesTool(
  ports: QToolPorts,
): AnyQToolDefinition {
  return defineQTool<FitTopCandidatesInput, FitTopCandidatesOutput, null>({
    ...SHARED,
    id: FIT_TOP_CANDIDATES,
    providerName: "fit_top_candidates",
    description:
      "Ranks this investor's own candidates (their relationships, the company requests sent to them, and their feed) by fit with their mandate, and returns the top N side by side: each company's score out of 10 (when enough is known), band, confidence and nine parameter rows with reasons, which row each is best on, and how many were left out and why. Call it for 'give me the top three', 'compare my best matches', or 'which should I look at first'. The order is the platform's; explain it, never reorder it. Show it on screen; it is not a document.",
    input: FitTopCandidatesInputSchema,
    output: FitTopCandidatesOutputSchema,
    authorize,
    execute: async (input, context) => {
      const fit = ports.fit;
      const none = (
        status: (typeof STATUSES)[number],
      ): FitTopCandidatesOutput => ({
        status,
        comparison: null,
        text: TEXT[status],
        guidance: GUIDANCE,
      });
      if (fit === undefined) return none("NOT_AVAILABLE");
      const result = await fit.top(context.actor, input.limit ?? 3);
      if (result.kind !== "OK") return none(result.kind);
      return {
        status: "OK",
        comparison: result.comparison,
        text: fitComparisonText(result.comparison),
        guidance: GUIDANCE,
      };
    },
  });
}
