import { z } from "zod";

import {
  DISCOVERY_MODES,
  CreateInvestorMandateRequestSchema,
  IDEMPOTENCY_KEY_HEADER,
  IdempotencyKeyHeaderSchema,
  INVESTOR_MANDATE_ACTIVATE_SUFFIX,
  INVESTOR_MANDATE_CLOSE_SUFFIX,
  INVESTOR_MANDATES_SUFFIX,
  INVESTORS_PATH,
  InvestorMandateDtoSchema,
  InvestorMandateTransitionRequestSchema,
  UpdateInvestorMandateRequestSchema,
  type QSubjectRef,
} from "@capital-q/contracts";
import {
  InvestorMandateIdSchema,
  InvestorOrganisationIdSchema,
  toInvestorMandateDto,
  type InvestorMandate,
} from "@capital-q/investors";

import {
  defineAppAction,
  portMissing,
  defineAppActionFamily,
  refusal,
  type AnyAppAction,
  type AppActionContext,
} from "../define.js";
import type { AppActionPorts } from "../ports.js";

/**
 * Mandate (ADR 0040 checklist): the mandate form -- create, update,
 * activate, close -- each declared once with its own route, and one Q tool
 * for the form (`change_my_mandate`), prepared for the investor's approval
 * and run through the same declaration. An update Q prepared carries
 * `atLatest` and is applied to the mandate as it stands when approved;
 * activate and close take no version from Q at all.
 */

const missing = portMissing;

const serviceResult = <T>(): z.ZodType<T> => z.custom<T>();

/** The investors service owns the authorization (investor.mandate.*). */
const servicesDecide = () => Promise.resolve({ ok: true as const });

const investors = (ports: AppActionPorts) =>
  ports.investors ?? missing("investors");

const base = `${INVESTORS_PATH}/:investorOrganisationId${INVESTOR_MANDATES_SUFFIX}`;
const byId = `${base}/:mandateId`;

const Create = z
  .object({
    investorOrganisationId: InvestorOrganisationIdSchema,
    idempotencyKey: IdempotencyKeyHeaderSchema,
    input: CreateInvestorMandateRequestSchema,
  })
  .strict();
const Mandate = {
  investorOrganisationId: InvestorOrganisationIdSchema,
  mandateId: InvestorMandateIdSchema,
};
const Update = z
  .object({
    ...Mandate,
    input: UpdateInvestorMandateRequestSchema,
    atLatest: z.literal(true).optional(),
  })
  .strict();
const Transition = z
  .object({ ...Mandate, input: InvestorMandateTransitionRequestSchema })
  .strict();

const onInvestor = (input: {
  readonly investorOrganisationId: string;
}): readonly QSubjectRef[] => [
  {
    kind: "INVESTOR_ORGANISATION",
    investorOrganisationId: input.investorOrganisationId,
  },
];

const dto = (mandate: InvestorMandate) =>
  InvestorMandateDtoSchema.parse(toInvestorMandateDto(mandate));

const fromMandate = (params: Record<string, string>, body: unknown) => ({
  investorOrganisationId: params["investorOrganisationId"],
  mandateId: params["mandateId"],
  input: body,
});

const WORDS: Readonly<Record<string, string>> = {
  name: "Name",
  discoveryMode: "Discovery",
  minStageCode: "Earliest stage",
  maxStageCode: "Latest stage",
  rawMandateText: "In your words",
};

/** The mandate's fields as the card shows them: the values approved. */
function previewOf(fields: Readonly<Record<string, unknown>>): string {
  const parts: string[] = [];
  for (const [field, label] of Object.entries(WORDS)) {
    const value = fields[field];
    if (value !== null && typeof value !== "string") continue;
    const text = value ?? "cleared";
    parts.push(
      `${label}: ${text.length > 120 ? `${text.slice(0, 117)}...` : text}`,
    );
  }
  const cheque = fields["chequeRange"] as
    | {
        readonly currency: string;
        readonly min?: string;
        readonly typical?: string;
        readonly max?: string;
      }
    | null
    | undefined;
  if (cheque !== undefined) {
    parts.push(
      cheque === null
        ? "Cheque: cleared"
        : `Cheque: ${cheque.currency} ${[cheque.min, cheque.typical, cheque.max]
            .filter((value) => value !== undefined)
            .join(" / ")}`,
    );
  }
  return parts.length === 0 ? "Nothing else changes." : parts.join(" · ");
}

const CREATE = defineAppAction<z.infer<typeof Create>, InvestorMandate>({
  name: "investor.mandate.create",
  short: "create a mandate",
  area: "mandate",
  classification: "CONSEQUENTIAL",
  does: "Creates a mandate for their investor organisation, as the mandate form does.",
  input: Create,
  output: serviceResult(),
  authorize: servicesDecide,
  run: (ports, context, input) =>
    investors(ports).createInvestorMandate({
      actor: context.actor,
      investorOrganisationId: input.investorOrganisationId,
      input: input.input,
      idempotencyKey: input.idempotencyKey,
      correlationId: context.correlationId,
    }),
  targets: onInvestor,
  card: (input) => ({
    summary: "Create a mandate",
    preview: previewOf(input.input),
  }),
  done: (out) => `Done. Your mandate "${out.name}" is created.`,
  http: {
    method: "POST",
    path: base,
    fromRequest: (params, body, headers) => ({
      investorOrganisationId: params["investorOrganisationId"],
      idempotencyKey: headers[IDEMPOTENCY_KEY_HEADER],
      input: body,
    }),
    status: 201,
    location: (out, input) =>
      `${INVESTORS_PATH}/${input.investorOrganisationId}${INVESTOR_MANDATES_SUFFIX}/${out.id}`,
    respond: dto,
  },
});

const UPDATE = defineAppAction<z.infer<typeof Update>, InvestorMandate>({
  name: "investor.mandate.update",
  supersedes: true,
  short: "change the mandate",
  area: "mandate",
  classification: "CONSEQUENTIAL",
  does: "Changes their mandate's fields, as the mandate form does.",
  input: Update,
  output: serviceResult(),
  authorize: servicesDecide,
  run: async (ports, context, input) => {
    const expectedVersion =
      input.atLatest === true
        ? (
            await investors(ports).getInvestorMandate({
              actor: context.actor,
              investorOrganisationId: input.investorOrganisationId,
              mandateId: input.mandateId,
            })
          ).version
        : input.input.expectedVersion;
    return investors(ports).updateInvestorMandate({
      actor: context.actor,
      investorOrganisationId: input.investorOrganisationId,
      mandateId: input.mandateId,
      input: { ...input.input, expectedVersion },
      correlationId: context.correlationId,
    });
  },
  targets: onInvestor,
  card: (input) => ({
    summary: "Update your mandate",
    preview: previewOf(input.input),
  }),
  done: () => "Done. Your mandate is updated.",
  http: { method: "PATCH", path: byId, fromRequest: fromMandate, respond: dto },
});

function transition(operation: "ACTIVATE" | "CLOSE"): AnyAppAction {
  const activate = operation === "ACTIVATE";
  return defineAppAction<z.infer<typeof Transition>, InvestorMandate>({
    name: activate ? "investor.mandate.activate" : "investor.mandate.close",
    supersedes: true,
    short: activate ? "make a mandate active" : "close a mandate",
    area: "mandate",
    classification: "CONSEQUENTIAL",
    does: activate
      ? "Makes a mandate the one their Discover feed uses, as the mandate page does."
      : "Closes a mandate, as the mandate page does; its history is kept.",
    input: Transition,
    output: serviceResult(),
    authorize: servicesDecide,
    run: (ports, context, input) =>
      investors(ports)[
        activate ? "activateInvestorMandate" : "closeInvestorMandate"
      ]({
        actor: context.actor,
        investorOrganisationId: input.investorOrganisationId,
        mandateId: input.mandateId,
        input: input.input,
        correlationId: context.correlationId,
      }),
    targets: onInvestor,
    card: () =>
      activate
        ? {
            summary: "Make this your active mandate",
            preview: "Your Discover feed will use this mandate.",
          }
        : {
            summary: "Close your mandate",
            preview:
              "This mandate stops shaping your feed. Its history is kept.",
          },
    done: (out) =>
      activate
        ? `Done. "${out.name}" is your active mandate; your feed uses it.`
        : `Done. "${out.name}" is closed.`,
    http: {
      method: "POST",
      path: `${byId}${activate ? INVESTOR_MANDATE_ACTIVATE_SUFFIX : INVESTOR_MANDATE_CLOSE_SUFFIX}`,
      fromRequest: fromMandate,
      respond: dto,
    },
  });
}

const MandateTool = z
  .object({
    operation: z
      .enum(["CREATE", "UPDATE", "ACTIVATE", "CLOSE"])
      .describe(
        "CREATE a new mandate (needs name); UPDATE fields; ACTIVATE it so their feed uses it; CLOSE it.",
      ),
    mandateId: z
      .string()
      .max(64)
      .optional()
      .describe(
        "Which mandate, exactly as a tool gave it. Omit for their current one.",
      ),
    name: z.string().max(120).optional(),
    discoveryMode: z.enum(DISCOVERY_MODES).optional(),
    chequeRange: z
      .object({
        currency: z.string().max(3),
        min: z.string().max(32).optional(),
        typical: z.string().max(32).optional(),
        max: z.string().max(32).optional(),
      })
      .strict()
      .optional()
      .describe("Cheque sizes as decimal strings in one ISO currency."),
    minStageCode: z.string().max(64).optional(),
    maxStageCode: z.string().max(64).optional(),
    rawMandateText: z
      .string()
      .max(8000)
      .optional()
      .describe("Their mandate in their own words."),
  })
  .strict();

/**
 * Which mandate a change is about. An id the model supplied is input,
 * never proof (founder live 2026-09-28: it passed the organisation's own
 * id as the mandate's): only a mandate on their own list is named;
 * otherwise their active one, else their draft.
 */
async function whichMandate(
  ports: AppActionPorts,
  context: AppActionContext,
  investorOrganisationId: z.infer<typeof InvestorOrganisationIdSchema>,
  named: string | undefined,
) {
  const page = await ports.investors
    ?.listInvestorMandates({
      actor: context.actor,
      investorOrganisationId,
      limit: 20,
    })
    .catch(() => null);
  const items = page?.items ?? [];
  return (
    (named === undefined
      ? undefined
      : items.find((item) => item.id === named)) ??
    items.find((item) => item.status === "ACTIVE") ??
    items.find((item) => item.status === "DRAFT") ??
    null
  );
}

export const MANDATE_ACTIONS: readonly AnyAppAction[] = defineAppActionFamily<
  z.infer<typeof MandateTool>
>({
  name: "investor.mandate.change",
  supersedes: true,
  short: "change their mandate",
  area: "mandate",
  does: "Creates, changes, activates or closes their investor organisation's mandate, as the mandate form does.",
  members: {
    CREATE,
    UPDATE,
    ACTIVATE: transition("ACTIVATE"),
    CLOSE: transition("CLOSE"),
  },
  tool: {
    name: "change_my_mandate",
    description:
      "Prepares a change to their own investor organisation's mandate, as the mandate form makes it: create one, update name, discoveryMode, chequeRange, minStageCode, maxStageCode or rawMandateText, activate it, or close it. Sectors, geographies, business models, criteria, founder preferences and exclusions are propose_profile_answer_change. Nothing changes until they approve exactly it.",
    input: MandateTool,
    references: {},
    scopes: ["INVESTOR_PROFILE", "INVESTOR_MANDATE"],
    purposes: ["INVESTOR_QUESTION", "ACTION_PREPARATION", "GENERAL_QUESTION"],
    eval: {
      say: [
        "Change our typical cheque to 250,000 dollars.",
        "We now invest from pre-seed to Series A, update the mandate.",
      ],
    },
    toCanonical: async (tool, context, ports) => {
      const own = await ports
        .ownInvestorOrganisationId?.(context.actor)
        .catch(() => null);
      if (own === null || own === undefined) return null;
      const investorOrganisationId = InvestorOrganisationIdSchema.parse(own);
      const { operation, mandateId, ...fields } = tool;
      const filled = Object.fromEntries(
        Object.entries(fields).filter(([, value]) => value !== undefined),
      );
      if (operation === "CREATE") {
        return {
          operation,
          input: {
            investorOrganisationId,
            idempotencyKey: context.idempotencyKey,
            input: filled,
          },
        };
      }
      const mandate = await whichMandate(
        ports,
        context,
        investorOrganisationId,
        mandateId,
      );
      if (mandate === null) {
        return refusal("You have no mandate to change yet: create one first.");
      }
      const which = { investorOrganisationId, mandateId: mandate.id };
      return operation === "UPDATE"
        ? {
            operation,
            input: {
              ...which,
              input: { ...filled, expectedVersion: mandate.version },
              atLatest: true as const,
            },
          }
        : { operation, input: { ...which, input: {} } };
    },
  },
});
