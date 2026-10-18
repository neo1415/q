import { z } from "zod";

import {
  AssumptionBoardDtoSchema,
  FIT_COMPARE_MAX,
  FIT_COMPARE_MIN,
  FitComparisonDtoSchema,
  InvestorMandateDtoSchema,
  ThesisReadingDtoSchema,
  UuidSchema,
  type AssumptionBoardDto,
  type InvestorMandateDto,
  type ThesisReadingDto,
} from "@capital-q/contracts";
import { fitComparisonText, readThesis } from "@capital-q/discovery";
import {
  assumptionBoardText,
  buildAssumptionBoard,
  withAskedQuestions,
} from "@capital-q/evidence";
import {
  InvestorOrganisationIdSchema,
  toInvestorMandateDto,
  type InvestorService,
} from "@capital-q/investors";
import type { ActorContext } from "@capital-q/security";
import { capability } from "@capital-q/security";

import {
  allow,
  defineQTool,
  deny,
  type AnyQToolDefinition,
} from "../definition.js";
import { actorWideScope, boundScopeFor } from "../plan.js";
import type { InvestorFeedDecision, QToolPorts } from "../ports.js";
import { planAdmits, type ProfileMaterialPort } from "./profile-material.js";

/**
 * Investor promises (2026-10-07): three read tools, each the same answer
 * the investor's screen shows, so "Q, ..." and the page never disagree.
 *
 *   company_assumptions  Q.07: one company's claims as assumptions to test,
 *                        with truth class and evidence status kept apart,
 *                        what each rests on and a question to ask. Built
 *                        in code from the deck view the deck service
 *                        projected for THIS investor (confirmed readings
 *                        only); a founder-private record is never read.
 *   fit_compare          Q.10: 2-4 companies (default: their latest saved)
 *                        side by side on the same fit as the top three.
 *   thesis_reading       Q.02: declared rules, saves/passes counted, and
 *                        Q's inference with suggestions they may approve.
 *
 * None of them writes. Sending questions and applying a suggestion are
 * app actions (approved on a card): send_questions_to_founder and
 * apply_thesis_suggestion.
 */

export const COMPANY_ASSUMPTIONS = "company.assumptions" as const;
export const FIT_COMPARE = "fit.compare" as const;
export const THESIS_READING = "investor.thesis_reading" as const;

const SHARED = {
  version: 1,
  status: "ACTIVE",
  classification: "READ_ONLY",
  riskClass: "SAFE_READ",
  approval: "NONE",
  idempotency: "SAFE_TO_REPEAT",
  owner: "q-tools",
} as const;

// --- Q.07 ------------------------------------------------------------------

const AssumptionsInputSchema = z
  .object({
    companyId: UuidSchema.describe(
      "The company (UUID), as given in the conversation context or a company card; never invented.",
    ),
  })
  .strict();
type AssumptionsInput = z.infer<typeof AssumptionsInputSchema>;

const AssumptionsOutputSchema = z
  .object({
    board: AssumptionBoardDtoSchema,
    text: z.string(),
    guidance: z.string(),
  })
  .strict();
type AssumptionsOutput = z.infer<typeof AssumptionsOutputSchema>;

const ASSUMPTIONS_GUIDANCE =
  "Say what the board says: each claim as the founder's claim (or Q's reading of the deck, said as yours, never as their fact), its evidence status as a separate word, and 'not known yet' for unknowns, which are never a weakness. No percentages, no figures of your own. Offer to send the questions they pick (send_questions_to_founder) and show the board with show(EVIDENCE_BOARD) or show(ASSUMPTIONS).";

export function createCompanyAssumptionsTool(
  port: ProfileMaterialPort,
): AnyQToolDefinition {
  return defineQTool<AssumptionsInput, AssumptionsOutput, AssumptionBoardDto>({
    ...SHARED,
    id: COMPANY_ASSUMPTIONS,
    providerName: "company_assumptions",
    description:
      "For an investor: a company's key claims as assumptions to test, from what that investor may see (the founder's confirmed deck reading), each with its truth class and evidence status as separate labels, what it rests on, a question to ask the founder, and the evidence board counts (evidenced, claimed, not known yet). Call it for 'what assumptions should I test on X', 'what's evidenced and what isn't', or 'what should I ask the founder'.",
    requiredCapabilities: [capability("company.view")],
    supportedPurposes: [
      "COUNTERPARTY_COMPANY_QUESTION",
      "INVESTOR_QUESTION",
      "RELATIONSHIP_QUESTION",
      "GENERAL_QUESTION",
    ],
    requiredScopeKinds: ["COMPANY_PROFILE", "NETWORK_VISIBLE_DATA"],
    visibleStage: "REVIEWING_COMPANY",
    input: AssumptionsInputSchema,
    output: AssumptionsOutputSchema,
    authorize: async (input, context) => {
      // Firewall first: the plan must admit the company before anything
      // is read; then the deck service decides the reader and projection.
      if (!planAdmits(context, input.companyId)) return deny("NOT_AVAILABLE");
      const view = await port
        .deck(context.actor, input.companyId)
        .catch(() => null);
      const board = view === null ? null : buildAssumptionBoard(view);
      if (board === null) return deny("NOT_AVAILABLE");
      // Their own questions and the founder's answers, as the screen shows.
      const asked =
        (await port
          .askedQuestions?.(context.actor, input.companyId)
          .catch(() => null)) ?? [];
      return allow("CONFIDENTIAL", withAskedQuestions(board, asked));
    },
    execute: (_input, _context, board) =>
      Promise.resolve({
        board,
        text: assumptionBoardText("This company", board),
        guidance: ASSUMPTIONS_GUIDANCE,
      }),
  });
}

// --- Q.10 ------------------------------------------------------------------

const CompareInputSchema = z
  .object({
    companyIds: z
      .array(UuidSchema)
      .min(FIT_COMPARE_MIN)
      .max(FIT_COMPARE_MAX)
      .optional()
      .describe(
        "2 to 4 companies to compare (UUIDs from their saved list or cards). Omit to compare their most recently saved companies.",
      ),
  })
  .strict();
type CompareInput = z.infer<typeof CompareInputSchema>;

const CompareOutputSchema = z
  .object({
    status: z.enum([
      "OK",
      "NOT_INVESTOR",
      "NO_MANDATE",
      "TOO_FEW",
      "NOT_AVAILABLE",
    ]),
    comparison: FitComparisonDtoSchema.nullable(),
    text: z.string(),
  })
  .strict();
type CompareOutput = z.infer<typeof CompareOutputSchema>;

/** Their own saved companies, newest first (the Saved page's order). */
export async function savedCompanyIds(
  decisions: InvestorFeedDecisionsPort | undefined,
  actor: ActorContext,
): Promise<readonly string[]> {
  if (decisions === undefined) return [];
  const listed = await decisions(actor, 30).catch(() => []);
  return listed
    .filter((d) => d.decision === "SAVED")
    .map((d) => d.companyId)
    .slice(0, FIT_COMPARE_MAX);
}

type InvestorFeedDecisionsPort = (
  actor: ActorContext,
  limit: number,
) => Promise<readonly InvestorFeedDecision[]>;

export function createFitCompareTool(ports: QToolPorts): AnyQToolDefinition {
  return defineQTool<CompareInput, CompareOutput, null>({
    ...SHARED,
    id: FIT_COMPARE,
    providerName: "fit_compare",
    description:
      "Puts 2 to 4 companies side by side on the investor's own fit (the same score out of 10, band, nine parameter rows and 'best of these' as the top three), by default their most recently saved companies. Call it for 'compare my saved companies' or 'compare X and Y'. The order is the platform's; explain it, never reorder it. Show it with show(SAVED_COMPARISON).",
    requiredCapabilities: [],
    supportedPurposes: [
      "COMPARISON",
      "INVESTOR_QUESTION",
      "COUNTERPARTY_COMPANY_QUESTION",
      "GENERAL_QUESTION",
    ],
    requiredScopeKinds: ["NETWORK_VISIBLE_DATA"],
    visibleStage: "COMPARING_OPPORTUNITIES",
    input: CompareInputSchema,
    output: CompareOutputSchema,
    authorize: (_input, context) => {
      const network = actorWideScope(context.plan, "NETWORK_VISIBLE_DATA");
      return Promise.resolve(
        network === undefined
          ? deny<null>("NOT_AVAILABLE")
          : allow<null>(network.sensitivity, null),
      );
    },
    execute: async (input, context) => {
      const fit = ports.fit;
      const none = (status: CompareOutput["status"], text: string) => ({
        status,
        comparison: null,
        text,
      });
      if (fit === undefined) {
        return none("NOT_AVAILABLE", "Comparing is not available right now.");
      }
      const ids =
        input.companyIds ??
        (await savedCompanyIds(ports.investorFeed?.decisions, context.actor));
      if (ids.length < FIT_COMPARE_MIN) {
        return none(
          "TOO_FEW",
          "Save at least two companies, or name two to four, to compare them.",
        );
      }
      // The fit service re-checks VIEW eligibility for every id first.
      const result = await fit.compare(context.actor, ids);
      if (result.kind === "NOT_INVESTOR") {
        return none("NOT_INVESTOR", "Comparing on fit is for investors.");
      }
      if (result.kind === "NO_MANDATE") {
        return none(
          "NO_MANDATE",
          "There is no active mandate to compare against yet.",
        );
      }
      return {
        status: "OK",
        comparison: result.comparison,
        text: fitComparisonText(result.comparison),
      };
    },
  });
}

// --- Q.02 ------------------------------------------------------------------

export type ThesisPorts = {
  readonly ownInvestorOrganisationId?:
    ((actor: ActorContext) => Promise<string | null>) | undefined;
  readonly investors?:
    | Pick<InvestorService, "listInvestorMandates" | "getInvestorMandate">
    | undefined;
  readonly decisions?: InvestorFeedDecisionsPort | undefined;
  readonly clock?: (() => Date) | undefined;
};

/**
 * The investor's own thesis reading, read through the investor service
 * (which authorises their own organisation's mandate) and their own
 * decisions. Null when they are not on an investor organisation's side.
 * Shared by the tool and the Q API's route, so they never disagree.
 */
export async function readOwnThesis(
  ports: ThesisPorts,
  actor: ActorContext,
): Promise<ThesisReadingDto | null> {
  const own = await ports.ownInvestorOrganisationId?.(actor).catch(() => null);
  if (own === null || own === undefined || ports.investors === undefined) {
    return null;
  }
  const organisation = InvestorOrganisationIdSchema.parse(own);
  const page = await ports.investors
    .listInvestorMandates({
      actor,
      investorOrganisationId: organisation,
      limit: 20,
    })
    .catch(() => null);
  const active = page?.items.find((item) => item.status === "ACTIVE");
  let mandate: InvestorMandateDto | null = null;
  if (active !== undefined) {
    const full = await ports.investors
      .getInvestorMandate({
        actor,
        investorOrganisationId: organisation,
        mandateId: active.id,
      })
      .catch(() => null);
    mandate =
      full === null
        ? null
        : InvestorMandateDtoSchema.parse(toInvestorMandateDto(full));
  }
  const decisions =
    ports.decisions === undefined
      ? []
      : await ports.decisions(actor, 200).catch(() => []);
  return readThesis({
    mandate,
    decisions: decisions.map((d) => ({
      decision: d.decision,
      stageCode: d.stageCode,
      country: d.headquartersCountry,
    })),
    now: (ports.clock ?? (() => new Date()))(),
  });
}

const ThesisOutputSchema = z
  .object({
    reading: ThesisReadingDtoSchema.nullable(),
    guidance: z.string(),
  })
  .strict();
type ThesisOutput = z.infer<typeof ThesisOutputSchema>;

const THESIS_GUIDANCE =
  "Keep the three apart: what they declared (their rules, which decide their feed), what they did (saves and passes, counted; viewing counts for nothing), and what you read from it (your inference, said as yours). Never say their mandate changed. Offer each suggestion as a question; apply one only through apply_thesis_suggestion, which they approve. Show it with show(THESIS).";

export function createThesisReadingTool(ports: QToolPorts): AnyQToolDefinition {
  return defineQTool<Record<string, never>, ThesisOutput, string>({
    ...SHARED,
    id: THESIS_READING,
    providerName: "thesis_reading",
    description:
      "For an investor: how Q reads their thesis. Their declared mandate rules, what they saved and passed (counted by stage and country), Q's inference from the gap, and suggested mandate edits with ids that change nothing unless they approve one. Call it for 'how do you read my thesis', 'what have you learned about what I like', or 'should I change my mandate'.",
    requiredCapabilities: [capability("investor.mandate.view")],
    supportedPurposes: ["INVESTOR_QUESTION", "GENERAL_QUESTION"],
    requiredScopeKinds: ["INVESTOR_MANDATE"],
    visibleStage: "REVIEWING_INVESTOR_CRITERIA",
    input: z.object({}).strict(),
    output: ThesisOutputSchema,
    authorize: async (_input, context) => {
      const own = await ports.appActions?.ownInvestorOrganisationId?.(
        context.actor,
      );
      if (own === null || own === undefined) return deny("NOT_AVAILABLE");
      // The plan must bind their own organisation's mandate scope: the
      // firewall grants it to the owner alone.
      const bound = boundScopeFor(
        context.plan,
        "INVESTOR_MANDATE",
        (filter) => filter.investorOrganisationId === own,
      );
      return bound === undefined
        ? deny("NOT_AVAILABLE")
        : allow(bound.sensitivity, own);
    },
    execute: async (_input, context) => ({
      reading: await readOwnThesis(
        {
          ownInvestorOrganisationId:
            ports.appActions?.ownInvestorOrganisationId,
          investors: ports.appActions?.investors,
          decisions: ports.investorFeed?.decisions,
        },
        context.actor,
      ),
      guidance: THESIS_GUIDANCE,
    }),
  });
}
