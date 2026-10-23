import { z } from "zod";

import {
  CompanyRaiseViewSchema,
  CompanyScoresDtoSchema,
  FIT_COMPARISON_MAX,
  FitComparisonDtoSchema,
  FitProfileDtoSchema,
  MoneySchema,
  MODEL_TOOL_RESULT_MAX_CHARS,
  UuidSchema,
  type CompanyRaiseView,
  type CompanyScoresDto,
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
  'Say each company\'s fit as the score out of 10 given in text beside its profile\'s band in words ("7.5/10 · Good fit"), exactly as given; where no score is given, the band in words alone. Never a percentage, never a score of your own, never a different number. Then the parameter rows that matter, with their reasons. Unknown means not known yet, never bad. Q\'s view, if you give one, is labelled as your view and does not change the fit. When text gives Investability and Suitability, say both exactly as given, each with how much it is based on ("based on 5 of 8 areas") and its confidence: Investability is how investable the company is on its shared evidence (FDN InvestIQ), Suitability is its fit with this investor\'s mandate; they are separate scores, never add or average them. "Not enough shared evidence yet" is not a low score. Do not make a document or PDF unless the person asked for a file.';

/**
 * Owner 23 Oct 2026 (Q explained an unknown cheque fit wrongly): beside
 * rows that carry reasons, the cheque rule. Left off the compact
 * comparison, whose text has no rows (and sits at the tool bound).
 */
const CHEQUE_GUIDANCE =
  "Cheque compatibility is their cheque against the round only. Asked whether a round fits their cheque, open with the row's result: Strong match is yes, Partial is partly, Mismatch is no, then its reason sentence as given; never open with no when the row is not a mismatch. Say a [why unknown: …] reason exactly, never another; an [ESTIMATE …] row is approximate, at the rate and date it names.";

const UNICORN_GUIDANCE =
  "If scores.unicornPotential is present, Unicorn Potential is a separate persisted growth-characteristics indicator: repeat only its actual overallScore (or insufficient evidence), explain its twelve pillars, grades, stage weights, coverage, sources and recorded momentum. Use weighted graded pillar sum divided by scored pillar weights, multiplied by 25 and rounded once; never invent an observation or treat unknown as zero. It is not a probability of reaching a $1 billion valuation. If it is absent, do not infer or reconstruct a premium score; say that assessment is unavailable for this account. A visible assessment card is not proof that its details are expanded. When the entitled person asks to open or show the Unicorn Potential assessment or its calculation on the company Overview, call operate_screen with target disclosure.unicorn-potential and act EXPAND before drafting the explanation. EXPAND is idempotent; do not substitute ACTIVATE or assume the panel is already open. Do not say it opened without the client DONE receipt; until confirmed, describe the opening as requested rather than completed.";

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
    /** What the company does, in its own one line, when known. */
    about: z.string().max(400).nullable().optional(),
    /** The current raise, only where disclosure lets this reader see it. */
    raise: MoneySchema.nullable().optional(),
    /** R2: the raise as the Discover card and the profile say it, for display. */
    raiseView: CompanyRaiseViewSchema.optional(),
    profile: FitProfileDtoSchema.nullable(),
    /** Investability and Suitability, two separate scores (2026-10-16). */
    scores: CompanyScoresDtoSchema.optional(),
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
    /** Canonical comparison text; large results keep the reasons in the typed profiles once. */
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

/**
 * R2: the raise each card shows, from the one company read the Discover
 * card and the profile use. A failed or absent read adds nothing: the card
 * falls back to the disclosed raise, never to a guess.
 */
async function raiseViewsFor(
  ports: QToolPorts,
  actor: QToolExecutionContext["actor"],
  companyIds: readonly string[],
): Promise<ReadonlyMap<string, CompanyRaiseView>> {
  if (ports.companyRaise === undefined || companyIds.length === 0) {
    return new Map();
  }
  return ports.companyRaise
    .raisesFor(actor, companyIds)
    .catch(() => new Map<string, CompanyRaiseView>());
}

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
      "Reads how well one company fits this investor's own mandate, as Capital Q computed it: a score out of 10 (when enough is known), a band and a confidence in words, and for each of nine parameters (stage, sector, geography, cheque size, business model, traction, team, thesis, round terms) an outcome and a reason. Also reads the entitled investor's persisted Unicorn Potential, twelve-pillar calculation, evidence and changes when available. Call it whenever an investor asks about unicorn potential, why its score changed, how a company fits, whether it matches their mandate, or what is unknown about it. Do not work out a fit yourself.",
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
      const views = await raiseViewsFor(ports, context.actor, [
        input.companyId,
      ]);
      const raiseView = views.get(input.companyId);
      const output: FitProfileOutput = {
        status: "OK",
        name: item.name,
        about: item.about ?? null,
        raise: item.raise ?? null,
        ...(raiseView === undefined ? {} : { raiseView }),
        profile: item.assessment.profile,
        ...(item.scores === undefined ? {} : { scores: item.scores }),
        text: fitProfileText(item.name, item.assessment.profile, {
          scores: item.scores,
        }),
        guidance:
          item.scores?.unicornPotential === undefined
            ? `${GUIDANCE} ${CHEQUE_GUIDANCE} Unicorn Potential is unavailable for this account; do not infer or reconstruct a premium score from other scores, public company facts or earlier conversation results.`
            : `${GUIDANCE} ${CHEQUE_GUIDANCE} ${UNICORN_GUIDANCE}`,
      };
      if (
        JSON.stringify(output).length <= MODEL_TOOL_RESULT_MAX_CHARS ||
        output.scores?.unicornPotential === undefined
      )
        return output;
      const full = output.scores.unicornPotential;
      // Keep every numeric input; only bound repeated evidence prose/citations.
      // The full authorized source set remains in the company assessment.
      const clipped = (value: string, limit: number) =>
        value.length > limit ? `${value.slice(0, limit - 1)}…` : value;
      return {
        ...output,
        scores: {
          ...output.scores,
          unicornPotential: {
            ...full,
            missing: full.missing.map((value) => clipped(value, 100)),
            pillars: full.pillars.map((pillar) => ({
              ...pillar,
              criteria: pillar.criteria.map((criterion) => ({
                ...criterion,
                label: clipped(criterion.label, 80),
                anchor: clipped(criterion.anchor, 160),
                sources: criterion.sources.slice(0, 1).map((source) => ({
                  ...source,
                  label: clipped(source.label, 80),
                })),
              })),
            })),
          },
        },
        text: fitProfileText(item.name, item.assessment.profile, {
          scores: item.scores,
          summaryOnly: true,
        }),
        guidance: `${output.guidance} Source details are bounded: one representative citation per criterion, with clipped prose. Do not claim it independently proves the grade or invent omitted evidence. The complete source set is in the company assessment; all grades, weights and contributions above remain the persisted values.`,
      };
    },
  });
}

/**
 * Up to ten entries side by side: each keeps both scores, their coverage
 * and confidence, but not the per-company "why" lists (the profile tool
 * and the company page carry those), so ten stay inside the tool bound.
 */
function compactScores(scores: CompanyScoresDto): CompanyScoresDto {
  return {
    ...scores,
    investability: { ...scores.investability, up: [], down: [], missing: [] },
    suitability:
      scores.suitability === null
        ? null
        : { ...scores.suitability, up: [], down: [], missing: [] },
  };
}

export function createFitTopCandidatesTool(
  ports: QToolPorts,
): AnyQToolDefinition {
  return defineQTool<FitTopCandidatesInput, FitTopCandidatesOutput, null>({
    ...SHARED,
    id: FIT_TOP_CANDIDATES,
    providerName: "fit_top_candidates",
    description:
      "Ranks this investor's own candidates (their relationships, the company requests sent to them, and their feed) by fit with their mandate, and returns the top N side by side: each company's score out of 10 (when enough is known), band, confidence and nine parameter rows with reasons, which row each is best on, and how many were left out and why. Call it for 'give me the top three', 'compare my best matches', or 'which should I look at first'. The order is the platform's; explain it, never reorder it. Show it on screen; it is not a document. Capital Q draws the side-by-side table itself (call read_company_figures for each company too, so its traction row has their numbers): in words, say the two or three differences that matter most, never the whole table.",
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
      const views = await raiseViewsFor(
        ports,
        context.actor,
        result.comparison.entries.map((entry) => entry.companyId),
      );
      const output: FitTopCandidatesOutput = {
        status: "OK",
        comparison: {
          ...result.comparison,
          entries: result.comparison.entries.map((entry) => {
            const raiseView = views.get(entry.companyId);
            const compact =
              entry.scores === undefined
                ? entry
                : { ...entry, scores: compactScores(entry.scores) };
            return raiseView === undefined
              ? compact
              : { ...compact, raiseView };
          }),
        },
        text: fitComparisonText(result.comparison),
        guidance: `${GUIDANCE} ${CHEQUE_GUIDANCE}`,
      };
      // Ten rich profiles can exceed the tool bound when all their reasons
      // are repeated in prose. Keep every authorized row, order and raise;
      // only shorten the redundant text to canonical scores/bands. The
      // executor still enforces the same bound on the complete result.
      if (JSON.stringify(output).length > MODEL_TOOL_RESULT_MAX_CHARS) {
        output.guidance = GUIDANCE;
        output.text = fitComparisonText(result.comparison, {
          summaryOnly: true,
        });
      }
      // Still too large: the scores stay in the text, once, per company.
      if (
        JSON.stringify(output).length > MODEL_TOOL_RESULT_MAX_CHARS &&
        output.comparison !== null
      ) {
        output.comparison = {
          ...output.comparison,
          entries: output.comparison.entries.map(
            ({ scores: _scores, ...entry }) => entry,
          ),
        };
      }
      return output;
    },
  });
}
