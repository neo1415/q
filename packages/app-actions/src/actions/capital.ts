import { z } from "zod";

import {
  CapitalObjectiveIdSchema,
  toCapitalObjectiveDto,
  type CapitalObjective,
  type CapitalService,
} from "@capital-q/capital";
import { CompanyIdSchema } from "@capital-q/companies";
import {
  CAPITAL_OBJECTIVE_CLOSURE_REASONS,
  CAPITAL_ROUND_INSTRUMENTS,
  CAPITAL_ROUND_STEPS,
  CapitalRoundTermsInputSchema,
  CAPITAL_OBJECTIVES_SUFFIX,
  COMPANIES_PATH,
  CapitalObjectiveDtoSchema,
  CloseCapitalObjectiveRequestSchema,
  CreateCapitalObjectiveRequestSchema,
  IDEMPOTENCY_KEY_HEADER,
  IdempotencyKeyHeaderSchema,
  ReplaceCapitalObjectiveRequestSchema,
  UpdateCapitalObjectiveRequestSchema,
  CAPITAL_OBJECTIVE_CLOSE_SUFFIX,
  CAPITAL_OBJECTIVE_REPLACE_SUFFIX,
  type QSubjectRef,
} from "@capital-q/contracts";

import {
  defineAppAction,
  portMissing,
  defineAppActionFamily,
  refusal,
  type AnyAppAction,
  type AppActionContext,
} from "../define.js";
import type { AppActionPorts } from "../ports.js";
import { CLOSE_ROUND, OPEN_ROUND } from "./commitments.js";
import { REVISE_ROUND, ROUND_STEP } from "./rounds.js";

/**
 * Capital (ADR 0040 checklist): the Capital page's raise form -- create,
 * update, close, replace -- each declared once with its own route, and one
 * Q tool for the form (`change_my_raise`), prepared for the founder's
 * approval and run through the same declaration.
 *
 * As with the profile area, Q's approvals bind the values, not the
 * version: a change Q prepared carries `atLatest` and is applied to the
 * raise as it stands when approved. The screen's routes never set it.
 */

const missing = portMissing;

const serviceResult = <T>(): z.ZodType<T> => z.custom<T>();

/** The capital service owns the authorization (capital_objective.*). */
const servicesDecide = () => Promise.resolve({ ok: true as const });

const capital = (ports: AppActionPorts) => ports.capital ?? missing("capital");

const base = `${COMPANIES_PATH}/:companyId${CAPITAL_OBJECTIVES_SUFFIX}`;
const byId = `${base}/:capitalObjectiveId`;
const at = (companyId: string, objectiveId: string) =>
  `${COMPANIES_PATH}/${companyId}${CAPITAL_OBJECTIVES_SUFFIX}/${objectiveId}`;

const AtLatest = z.literal(true).optional();

const Create = z
  .object({
    companyId: CompanyIdSchema,
    idempotencyKey: IdempotencyKeyHeaderSchema,
    input: CreateCapitalObjectiveRequestSchema,
  })
  .strict();
const Objective = {
  companyId: CompanyIdSchema,
  capitalObjectiveId: CapitalObjectiveIdSchema,
};
const Update = z
  .object({
    ...Objective,
    input: UpdateCapitalObjectiveRequestSchema,
    atLatest: AtLatest,
  })
  .strict();
const Close = z
  .object({
    ...Objective,
    input: CloseCapitalObjectiveRequestSchema,
    atLatest: AtLatest,
  })
  .strict();
const Replace = z
  .object({
    ...Objective,
    input: ReplaceCapitalObjectiveRequestSchema,
    atLatest: AtLatest,
  })
  .strict();

const onCompany = (input: {
  readonly companyId: string;
}): readonly QSubjectRef[] => [{ kind: "COMPANY", companyId: input.companyId }];

const dto = (objective: CapitalObjective) =>
  CapitalObjectiveDtoSchema.parse(toCapitalObjectiveDto(objective));

function money(target: { readonly amount: string; readonly currency: string }) {
  return `${target.currency} ${Number(target.amount).toLocaleString("en-GB")}`;
}

/** The raise's fields as the card shows them: the values approved, exactly. */
function previewOf(fields: Readonly<Record<string, unknown>>): string {
  const parts: string[] = [];
  const target = fields["target"] as
    { readonly amount: string; readonly currency: string } | undefined;
  if (target !== undefined) parts.push(`Target: ${money(target)}`);
  const words: Readonly<Record<string, string>> = {
    targetStage: "Stage",
    instrumentCode: "Instrument",
    targetCloseDate: "Target close",
    useOfFundsSummary: "Use of funds",
    reason: "Reason",
  };
  for (const [field, label] of Object.entries(words)) {
    const value = fields[field];
    if (value === null) parts.push(`${label}: cleared`);
    else if (typeof value === "string") {
      parts.push(`${label}: ${value.replaceAll("_", " ").toLowerCase()}`);
    }
  }
  return parts.length === 0 ? "Nothing else changes." : parts.join(" · ");
}

/** The version to write at: the screen's own, or the raise's now for Q. */
async function versionOf(
  ports: AppActionPorts,
  context: {
    readonly actor: Parameters<
      CapitalService["getCapitalObjective"]
    >[0]["actor"];
  },
  input: {
    readonly companyId: z.infer<typeof CompanyIdSchema>;
    readonly capitalObjectiveId: z.infer<typeof CapitalObjectiveIdSchema>;
    readonly input: { readonly expectedVersion: number };
    readonly atLatest?: true | undefined;
  },
): Promise<number> {
  if (input.atLatest !== true) return input.input.expectedVersion;
  const current = await capital(ports).getCapitalObjective({
    actor: context.actor,
    companyId: input.companyId,
    capitalObjectiveId: input.capitalObjectiveId,
  });
  return current.version;
}

const CREATE = defineAppAction<z.infer<typeof Create>, CapitalObjective>({
  name: "capital.objective.create",
  consequence: "TERMS",
  supersedes: true,
  short: "set up a raise",
  area: "capital",
  classification: "CONSEQUENTIAL",
  does: "Sets up their company's raise, as the Capital page's form does.",
  input: Create,
  output: serviceResult(),
  authorize: servicesDecide,
  run: (ports, context, input) =>
    capital(ports).createCapitalObjective({
      actor: context.actor,
      companyId: input.companyId,
      input: input.input,
      idempotencyKey: input.idempotencyKey,
      correlationId: context.correlationId,
    }),
  targets: onCompany,
  card: (input) => ({
    summary: "Set up your raise",
    preview: previewOf(input.input),
  }),
  done: (out) => `Done. Your raise of ${money(out.target)} is set up.`,
  http: {
    method: "POST",
    path: base,
    fromRequest: (params, body, headers) => ({
      companyId: params["companyId"],
      idempotencyKey: headers[IDEMPOTENCY_KEY_HEADER],
      input: body,
    }),
    status: 201,
    location: (out, input) => at(input.companyId, out.id),
    respond: dto,
  },
});

const UPDATE = defineAppAction<z.infer<typeof Update>, CapitalObjective>({
  name: "capital.objective.update",
  consequence: "TERMS",
  supersedes: true,
  short: "change the raise",
  area: "capital",
  classification: "CONSEQUENTIAL",
  does: "Changes their company's current raise, as the Capital page's form does.",
  input: Update,
  output: serviceResult(),
  authorize: servicesDecide,
  run: async (ports, context, input) =>
    capital(ports).updateCapitalObjective({
      actor: context.actor,
      companyId: input.companyId,
      capitalObjectiveId: input.capitalObjectiveId,
      input: {
        ...input.input,
        expectedVersion: await versionOf(ports, context, input),
      },
      correlationId: context.correlationId,
    }),
  targets: onCompany,
  card: (input) => ({
    summary: "Update your raise",
    preview: previewOf(input.input),
  }),
  done: () => "Done. Your raise is updated.",
  http: {
    method: "PATCH",
    path: byId,
    fromRequest: (params, body) => ({
      companyId: params["companyId"],
      capitalObjectiveId: params["capitalObjectiveId"],
      input: body,
    }),
    respond: dto,
  },
});

const CLOSE = defineAppAction<z.infer<typeof Close>, CapitalObjective>({
  name: "capital.objective.close",
  consequence: "TERMS",
  supersedes: true,
  short: "close the raise",
  area: "capital",
  classification: "CONSEQUENTIAL",
  does: "Closes their company's current raise with its reason, as the Capital page does.",
  input: Close,
  output: serviceResult(),
  authorize: servicesDecide,
  run: async (ports, context, input) =>
    capital(ports).closeCapitalObjective({
      actor: context.actor,
      companyId: input.companyId,
      capitalObjectiveId: input.capitalObjectiveId,
      input: {
        ...input.input,
        expectedVersion: await versionOf(ports, context, input),
      },
      correlationId: context.correlationId,
    }),
  targets: onCompany,
  card: (input) => ({
    summary: "Close your raise",
    preview: previewOf(input.input),
  }),
  done: () => "Done. Your raise is closed.",
  http: {
    method: "POST",
    path: `${byId}${CAPITAL_OBJECTIVE_CLOSE_SUFFIX}`,
    fromRequest: (params, body) => ({
      companyId: params["companyId"],
      capitalObjectiveId: params["capitalObjectiveId"],
      input: body,
    }),
    respond: dto,
  },
});

const REPLACE = defineAppAction<
  z.infer<typeof Replace>,
  Awaited<ReturnType<CapitalService["replaceCapitalObjective"]>>
>({
  name: "capital.objective.replace",
  consequence: "TERMS",
  supersedes: true,
  short: "replace the raise",
  area: "capital",
  classification: "CONSEQUENTIAL",
  does: "Replaces their company's current raise with a deliberately new one, as the Capital page does.",
  input: Replace,
  output: serviceResult(),
  authorize: servicesDecide,
  run: async (ports, context, input) =>
    capital(ports).replaceCapitalObjective({
      actor: context.actor,
      companyId: input.companyId,
      capitalObjectiveId: input.capitalObjectiveId,
      input: {
        ...input.input,
        expectedVersion: await versionOf(ports, context, input),
      },
      correlationId: context.correlationId,
    }),
  targets: onCompany,
  card: (input) => ({
    summary: "Replace your raise with a new one",
    preview: previewOf(input.input.replacement),
  }),
  done: (out) =>
    `Done. Your new raise of ${money(out.replacement.target)} replaces the old one.`,
  http: {
    method: "POST",
    path: `${byId}${CAPITAL_OBJECTIVE_REPLACE_SUFFIX}`,
    fromRequest: (params, body) => ({
      companyId: params["companyId"],
      capitalObjectiveId: params["capitalObjectiveId"],
      input: body,
    }),
    status: 201,
    location: (out, input) => at(input.companyId, out.replacement.id),
    respond: (out) => dto(out.replacement),
  },
});

const RaiseTool = z
  .object({
    operation: z
      .enum([
        "CREATE",
        "UPDATE",
        "CLOSE",
        "REPLACE",
        "OPEN_ROUND",
        "CLOSE_ROUND",
        "ROUND_STEP",
        "REVISE_ROUND",
      ])
      .describe(
        "CREATE a raise when they have none; UPDATE the current one's fields; CLOSE it (with closureReason); REPLACE it with a deliberately new raise. OPEN_ROUND: open (or plan, or record a past) funding round such as Pre-seed or Seed with its target; CLOSE_ROUND: close a round (the current one unless roundName says which). ROUND_STEP: a step in a round (roundStep: OPEN a planned one, CLOSE a first or later close, TRANCHE, FINAL_CLOSE, REOPEN for an extension or second close, CANCEL one no money closed in), with stepDate, stepAmount, stepNote. REVISE_ROUND: correct a round's terms (roundTerms: valuation, valuationCap, discountPercent, hardCap, proRataRights, targetCloseOn, reportedRaised) or its target.",
      ),
    target: z
      .object({
        amount: z
          .string()
          .max(32)
          .describe("A positive decimal amount, as digits (e.g. 1500000)."),
        currency: z
          .string()
          .max(3)
          .describe("ISO 4217 code, e.g. USD, GBP, NGN."),
      })
      .strict()
      .optional(),
    targetStage: z
      .string()
      .max(64)
      .optional()
      .describe("lower_snake_case stage code, e.g. seed, series_a."),
    instrumentCode: z
      .string()
      .max(64)
      .optional()
      .describe("lower_snake_case instrument code, e.g. safe, equity."),
    targetCloseDate: z.string().max(10).optional().describe("YYYY-MM-DD"),
    useOfFundsSummary: z.string().max(2000).optional(),
    closureReason: z.enum(CAPITAL_OBJECTIVE_CLOSURE_REASONS).optional(),
    roundName: z
      .string()
      .max(80)
      .optional()
      .describe(
        "OPEN_ROUND / CLOSE_ROUND: the round's name, e.g. Seed, Pre-seed, Series A.",
      ),
    roundInstrument: z
      .enum(CAPITAL_ROUND_INSTRUMENTS)
      .optional()
      .describe(
        "OPEN_ROUND: SAFE, EQUITY, CONVERTIBLE or OTHER, only if they said it.",
      ),
    roundPlanned: z
      .boolean()
      .optional()
      .describe(
        "OPEN_ROUND: true only if they are planning it, not raising it now.",
      ),
    roundPast: z
      .boolean()
      .optional()
      .describe(
        "OPEN_ROUND: true when recording a round that already closed before (history), with stepDate as its close date.",
      ),
    roundStep: z
      .enum(CAPITAL_ROUND_STEPS)
      .optional()
      .describe("ROUND_STEP: which step."),
    stepDate: z
      .string()
      .max(10)
      .optional()
      .describe("ROUND_STEP: YYYY-MM-DD it happened, if they said."),
    stepAmount: z
      .string()
      .max(32)
      .optional()
      .describe(
        "ROUND_STEP CLOSE/TRANCHE/FINAL_CLOSE: the amount as digits, in the round's currency, only if they said it.",
      ),
    stepNote: z
      .string()
      .max(300)
      .optional()
      .describe("ROUND_STEP: a label or reason (e.g. why it was cancelled)."),
    roundTerms: CapitalRoundTermsInputSchema.optional().describe(
      "REVISE_ROUND / OPEN_ROUND: only the terms they stated; amounts as digits in the round's currency; never guess a cap or valuation.",
    ),
  })
  .strict();

/** The raise's instrument code as a round's instrument, when it maps. */
const ROUND_INSTRUMENT_OF: Readonly<
  Record<string, (typeof CAPITAL_ROUND_INSTRUMENTS)[number]>
> = {
  safe: "SAFE",
  equity: "EQUITY",
  priced_equity: "EQUITY",
  convertible: "CONVERTIBLE",
  convertible_note: "CONVERTIBLE",
};

const titleCase = (value: string) =>
  value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
    .replace(/\bPre Seed\b/, "Pre-seed");

/** A round opened or closed through the raise's tool. */
async function roundOperation(
  ports: AppActionPorts,
  context: AppActionContext,
  companyId: z.infer<typeof CompanyIdSchema>,
  said: {
    readonly operation: "OPEN_ROUND" | "CLOSE_ROUND";
    readonly roundName: string | undefined;
    readonly roundInstrument:
      (typeof CAPITAL_ROUND_INSTRUMENTS)[number] | undefined;
    readonly roundPlanned: boolean | undefined;
    readonly roundPast?: boolean | undefined;
    readonly stepDate?: string | undefined;
    readonly roundTerms?:
      z.infer<typeof CapitalRoundTermsInputSchema> | undefined;
    readonly target:
      { readonly amount: string; readonly currency: string } | undefined;
    readonly targetStage: string | undefined;
  },
) {
  if (ports.capitalRounds === undefined) return null;
  if (said.operation === "CLOSE_ROUND") {
    const all = await ports.capitalRounds
      .listRounds({ actor: context.actor, companyId })
      .catch(() => []);
    const wanted = said.roundName?.trim().toLowerCase();
    const round =
      wanted === undefined || wanted === ""
        ? all.find((item) => item.isCurrent)
        : all.find(
            (item) =>
              item.status !== "CLOSED" && item.name.toLowerCase() === wanted,
          );
    if (round === undefined) {
      return refusal(
        wanted === undefined
          ? "You have no current round to close."
          : `No open round is called ${said.roundName ?? ""}.`,
      );
    }
    return {
      operation: "CLOSE_ROUND",
      input: { companyId, roundId: round.id, input: {} },
    };
  }
  if (said.target === undefined) {
    return refusal("What's the round's target, and in which currency?");
  }
  const name =
    said.roundName?.trim() ||
    (said.targetStage === undefined ? "" : titleCase(said.targetStage));
  if (name === "")
    return refusal("What's the round called (Pre-seed, Seed, …)?");
  let instrument = said.roundInstrument;
  if (instrument === undefined) {
    const raise = await ports.capital
      ?.getCurrentCapitalObjective({ actor: context.actor, companyId })
      .catch(() => null);
    const code = raise?.instrumentCode ?? null;
    instrument = code === null ? undefined : ROUND_INSTRUMENT_OF[code];
  }
  if (instrument === undefined) {
    return refusal("Is it a SAFE, equity or a convertible note?");
  }
  return {
    operation: "OPEN_ROUND",
    input: {
      companyId,
      idempotencyKey: context.idempotencyKey,
      input: {
        name: titleCase(name),
        target: said.target,
        instrument,
        ...(said.roundPast === true
          ? {
              status: "CLOSED" as const,
              ...(said.stepDate === undefined
                ? {}
                : { closedOn: said.stepDate }),
            }
          : said.roundPlanned === true
            ? { status: "PLANNED" as const }
            : {}),
        ...(said.roundTerms === undefined ? {} : { terms: said.roundTerms }),
      },
    },
  };
}

/**
 * A step or a correction to a named round (the current one when no name is
 * said), read now so the card carries the revision it was prepared against.
 */
async function roundChange(
  ports: AppActionPorts,
  context: AppActionContext,
  companyId: z.infer<typeof CompanyIdSchema>,
  said: {
    readonly operation: "ROUND_STEP" | "REVISE_ROUND";
    readonly roundName: string | undefined;
    readonly roundStep: (typeof CAPITAL_ROUND_STEPS)[number] | undefined;
    readonly stepDate: string | undefined;
    readonly stepAmount: string | undefined;
    readonly stepNote: string | undefined;
    readonly roundTerms:
      z.infer<typeof CapitalRoundTermsInputSchema> | undefined;
    readonly target:
      { readonly amount: string; readonly currency: string } | undefined;
  },
) {
  if (ports.capitalRounds === undefined) return null;
  const all = await ports.capitalRounds
    .listRounds({ actor: context.actor, companyId })
    .catch(() => []);
  const wanted = said.roundName?.trim().toLowerCase();
  const round =
    wanted === undefined || wanted === ""
      ? all.find((item) => item.isCurrent)
      : all.find((item) => item.name.toLowerCase() === wanted);
  if (round === undefined) {
    return refusal(
      wanted === undefined || wanted === ""
        ? "Which round? You have no current one."
        : `No round is called ${said.roundName ?? ""}.`,
    );
  }
  const at = { companyId, roundId: round.id };
  if (said.operation === "ROUND_STEP") {
    if (said.roundStep === undefined) {
      return refusal(
        "Which step: a close, a tranche, the final close, reopen or cancel?",
      );
    }
    const carriesAmount =
      said.roundStep === "CLOSE" ||
      said.roundStep === "TRANCHE" ||
      said.roundStep === "FINAL_CLOSE";
    return {
      operation: "ROUND_STEP",
      input: {
        ...at,
        idempotencyKey: context.idempotencyKey,
        input: {
          expectedRevision: round.revision,
          step: said.roundStep,
          ...(said.stepDate === undefined ? {} : { on: said.stepDate }),
          ...(carriesAmount && said.stepAmount !== undefined
            ? { amount: said.stepAmount }
            : {}),
          ...(said.stepNote === undefined
            ? {}
            : said.roundStep === "CANCEL" || said.roundStep === "REOPEN"
              ? { note: said.stepNote }
              : { label: said.stepNote }),
        },
      },
    };
  }
  const terms = said.roundTerms ?? {};
  if (Object.keys(terms).length === 0 && said.target === undefined) {
    return refusal("What should change in the round?");
  }
  return {
    operation: "REVISE_ROUND",
    input: {
      ...at,
      input: {
        expectedRevision: round.revision,
        ...(said.target === undefined ? {} : { target: said.target }),
        ...(Object.keys(terms).length === 0 ? {} : { terms }),
      },
    },
  };
}

export const CAPITAL_ACTIONS: readonly AnyAppAction[] = defineAppActionFamily<
  z.infer<typeof RaiseTool>
>({
  name: "capital.objective.change",
  consequence: "TERMS",
  supersedes: true,
  short: "change their raise",
  area: "capital",
  does: "Sets up, changes, closes or replaces their company's raise, as the Capital page's form does.",
  members: {
    CREATE,
    UPDATE,
    CLOSE,
    REPLACE,
    OPEN_ROUND,
    CLOSE_ROUND,
    ROUND_STEP,
    REVISE_ROUND,
  },
  tool: {
    name: "change_my_raise",
    description:
      "Prepares a change to their own company's raise (capital objective), exactly as the Capital page's form makes it: create one, update target (amount + currency), targetStage, instrumentCode, targetCloseDate or useOfFundsSummary, close it with a closureReason (ACHIEVED, CLOSED_BY_FOUNDER, DISCONTINUED), or replace it with a new raise. Also opens or closes a funding round ('open a seed round for $1.5M': OPEN_ROUND with roundName and target). Nothing changes until they approve exactly it.",
    input: RaiseTool,
    references: {},
    scopes: ["COMPANY_PROFILE"],
    purposes: [
      "OWN_COMPANY_QUESTION",
      "ACTION_PREPARATION",
      "GENERAL_QUESTION",
    ],
    eval: {
      say: [
        "Change our raise target to 2 million dollars.",
        "We're raising on a SAFE now, update the raise.",
      ],
    },
    toCanonical: async (tool, context, ports) => {
      const own = await ports.ownCompanyId?.(context.actor).catch(() => null);
      if (own === null || own === undefined || ports.capital === undefined) {
        return null;
      }
      const companyId = CompanyIdSchema.parse(own);
      const {
        operation,
        closureReason,
        roundName,
        roundInstrument,
        roundPlanned,
        roundPast,
        roundStep,
        stepDate,
        stepAmount,
        stepNote,
        roundTerms,
        ...fields
      } = tool;
      if (operation === "ROUND_STEP" || operation === "REVISE_ROUND") {
        return roundChange(ports, context, companyId, {
          operation,
          roundName,
          roundStep,
          stepDate,
          stepAmount,
          stepNote,
          roundTerms,
          target: tool.target,
        });
      }
      if (operation === "OPEN_ROUND" || operation === "CLOSE_ROUND") {
        return roundOperation(ports, context, companyId, {
          operation,
          roundName,
          roundInstrument,
          roundPlanned,
          roundPast,
          stepDate,
          roundTerms,
          target: tool.target,
          targetStage: tool.targetStage,
        });
      }
      const filled = Object.fromEntries(
        Object.entries(fields).filter(([, value]) => value !== undefined),
      );
      if (operation === "CREATE") {
        return {
          operation,
          input: {
            companyId,
            idempotencyKey: context.idempotencyKey,
            input: filled,
          },
        };
      }
      // Their current raise, read now; none means there is nothing to
      // change yet (the tool says so rather than guessing one).
      const current = await ports.capital
        .getCurrentCapitalObjective({ actor: context.actor, companyId })
        .catch(() => null);
      if (current === null) {
        return refusal("Your company has no raise yet: set one up first.");
      }
      const objective = {
        companyId,
        capitalObjectiveId: current.id,
        atLatest: true as const,
      };
      switch (operation) {
        case "UPDATE":
          return {
            operation,
            input: {
              ...objective,
              input: { ...filled, expectedVersion: current.version },
            },
          };
        case "CLOSE":
          return {
            operation,
            input: {
              ...objective,
              input: {
                reason: closureReason,
                expectedVersion: current.version,
              },
            },
          };
        case "REPLACE":
          return {
            operation,
            input: {
              ...objective,
              input: { replacement: filled, expectedVersion: current.version },
            },
          };
      }
    },
  },
});
