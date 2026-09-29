import { z } from "zod";

import {
  CapitalObjectiveIdSchema,
  type CapitalService,
} from "@capital-q/capital";
import {
  CloseCapitalObjectiveRequestSchema,
  CreateCapitalObjectiveRequestSchema,
  CreateInvestorMandateRequestSchema,
  InvestorMandateTransitionRequestSchema,
  QActionTypeSchema,
  ReplaceCapitalObjectiveRequestSchema,
  SetInvestorVisibilityRequestSchema,
  UpdateCapitalObjectiveRequestSchema,
  UpdateCompanyTeamFactsRequestSchema,
  UpdateInvestorMandateRequestSchema,
  UpdateMyFounderProfileRequestSchema,
  UpdateQCardRequestSchema,
  UpsertMyCompanyMembershipRequestSchema,
  UpsertMyInvestorRepresentativeRequestSchema,
  UuidSchema,
  type QSubjectRef,
} from "@capital-q/contracts";
import {
  CompanyIdSchema,
  type CompanyQueryPort,
  type CompanyService,
} from "@capital-q/companies";
import {
  InvestorMandateIdSchema,
  InvestorOrganisationIdSchema,
  type InvestorOrganisationQueryPort,
  type InvestorService,
} from "@capital-q/investors";
import type { Logger } from "@capital-q/observability";
import type { PublicIdentityService } from "@capital-q/public-identity";
import {
  defineQAction,
  type AnyQActionDefinition,
  type QActionProposer,
} from "@capital-q/q-actions";
import type { RecordChange, RecordChangePort } from "@capital-q/q-tools";
import {
  capability,
  type ActorContext,
  type AuthorizationService,
} from "@capital-q/security";

import {
  ONBOARDING_ANSWER_REVISE,
  ProfileAnswerPayloadSchema,
  resolveProfileAnswer,
  type ProfileAnswersPort,
} from "./profile-answer-action.js";

/**
 * R33: the app's own record forms, as Approval Engine actions (lead-owned
 * action types): the raise, the mandate, founder profile / team facts /
 * one's own role, one's investor role, Q Card details, and the investor
 * organisation's visibility.
 *
 * Each payload binds the subject, the operation and the exact fields; the
 * fields are checked against the route's own request schema when Q
 * prepares the change and again when it executes. Approval-time
 * authorisation is ownership (the subject belongs to the approver's own
 * organisation, read through the owning context's query port: absent,
 * another tenant's and another organisation's are one answer); the
 * capability that binds -- capital_objective.*, investor.mandate.*,
 * company.team.*, handle.manage, investor.edit -- is checked by the owning
 * service itself at execution, under the approver's authority, exactly as
 * for the page. The version a write needs is read at execution; nothing
 * here writes a row.
 */

export const CAPITAL_OBJECTIVE_CHANGE = QActionTypeSchema.parse(
  "capital.objective.change",
);
export const INVESTOR_MANDATE_CHANGE = QActionTypeSchema.parse(
  "investor.mandate.change",
);
export const COMPANY_TEAM_CHANGE = QActionTypeSchema.parse(
  "company.team.change",
);
export const INVESTOR_REPRESENTATIVE_UPDATE = QActionTypeSchema.parse(
  "investor.representative.update",
);
export const Q_CARD_UPDATE = QActionTypeSchema.parse("q_card.update");
export const INVESTOR_VISIBILITY_SET = QActionTypeSchema.parse(
  "investor.visibility.set",
);

export const RECORD_CHANGE_ACTION_TYPES = [
  CAPITAL_OBJECTIVE_CHANGE,
  INVESTOR_MANDATE_CHANGE,
  COMPANY_TEAM_CHANGE,
  INVESTOR_REPRESENTATIVE_UPDATE,
  Q_CARD_UPDATE,
  INVESTOR_VISIBILITY_SET,
] as const;

const Fields = z.record(z.string(), z.unknown());

export const CapitalObjectiveChangePayloadSchema = z
  .object({
    companyId: UuidSchema,
    operation: z.enum(["CREATE", "UPDATE", "CLOSE", "REPLACE"]),
    capitalObjectiveId: UuidSchema.nullable(),
    fields: Fields,
  })
  .strict();
export const InvestorMandateChangePayloadSchema = z
  .object({
    investorOrganisationId: UuidSchema,
    operation: z.enum(["CREATE", "UPDATE", "ACTIVATE", "CLOSE"]),
    mandateId: UuidSchema.nullable(),
    fields: Fields,
  })
  .strict();
export const CompanyTeamChangePayloadSchema = z
  .object({
    companyId: UuidSchema,
    part: z.enum(["FOUNDER_PROFILE", "TEAM_FACTS", "COMPANY_MEMBERSHIP"]),
    fields: Fields,
  })
  .strict();
export const InvestorRepresentativePayloadSchema = z
  .object({ investorOrganisationId: UuidSchema, fields: Fields })
  .strict();
export const QCardUpdatePayloadSchema = z
  .object({
    subjectType: z.enum(["COMPANY", "INVESTOR_ORGANISATION"]),
    subjectId: UuidSchema,
    fields: Fields,
  })
  .strict();
export const InvestorVisibilityPayloadSchema = z
  .object({
    investorOrganisationId: UuidSchema,
    visibility: z.enum(["network_visible", "organisation_private"]),
  })
  .strict();

const DoneSchema = z.object({ version: z.number().int() }).strict();
type Done = z.infer<typeof DoneSchema>;

/** A version placeholder: validation only; execution reads the real one. */
const ANY_VERSION = 1;

/** The request body the route would take, or a person-facing reason. */
export function requestFor(
  change: RecordChange,
):
  | { readonly ok: true; readonly fields: Record<string, unknown> }
  | { readonly ok: false; readonly reason: string } {
  // ADR 0024: an answer is resolved against its step, not a request schema.
  if (change.kind === "PROFILE_ANSWER") return { ok: true, fields: {} };
  const fields = { ...change.fields };
  const check = (schema: z.ZodType, value: unknown) => {
    const parsed = schema.safeParse(value);
    return parsed.success
      ? ({ ok: true, fields } as const)
      : ({
          ok: false,
          reason: `That doesn't fit the form: ${parsed.error.issues
            .map(
              (issue) => `${issue.path.join(".") || "change"} ${issue.message}`,
            )
            .join("; ")
            .slice(0, 300)}`,
        } as const);
  };
  switch (change.kind) {
    case "CAPITAL_OBJECTIVE":
      switch (change.operation) {
        case "CREATE":
          return check(CreateCapitalObjectiveRequestSchema, fields);
        case "UPDATE":
          return check(UpdateCapitalObjectiveRequestSchema, {
            ...fields,
            expectedVersion: ANY_VERSION,
          });
        case "CLOSE":
          return check(CloseCapitalObjectiveRequestSchema, {
            ...fields,
            expectedVersion: ANY_VERSION,
          });
        case "REPLACE":
          return check(ReplaceCapitalObjectiveRequestSchema, {
            replacement: fields,
            expectedVersion: ANY_VERSION,
          });
      }
      break;
    case "INVESTOR_MANDATE":
      switch (change.operation) {
        case "CREATE":
          return check(CreateInvestorMandateRequestSchema, fields);
        case "UPDATE":
          return check(UpdateInvestorMandateRequestSchema, {
            ...fields,
            expectedVersion: ANY_VERSION,
          });
        case "ACTIVATE":
        case "CLOSE":
          return check(InvestorMandateTransitionRequestSchema, {});
      }
      break;
    case "FOUNDER_PROFILE":
      return check(UpdateMyFounderProfileRequestSchema, fields);
    case "TEAM_FACTS":
      return check(UpdateCompanyTeamFactsRequestSchema, fields);
    case "COMPANY_MEMBERSHIP":
      return check(UpsertMyCompanyMembershipRequestSchema, fields);
    case "INVESTOR_REPRESENTATIVE":
      return check(UpsertMyInvestorRepresentativeRequestSchema, fields);
    case "INVESTOR_VISIBILITY":
      return check(SetInvestorVisibilityRequestSchema, {
        ...fields,
        expectedVersion: ANY_VERSION,
      });
    case "Q_CARD":
      return check(UpdateQCardRequestSchema, {
        ...fields,
        expectedVersion: ANY_VERSION,
      });
  }
}

const LABELS: Readonly<Record<string, string>> = {
  target: "target",
  targetStage: "stage",
  instrumentCode: "instrument",
  targetCloseDate: "target close date",
  useOfFundsSummary: "use of funds",
  reason: "reason",
  name: "name",
  discoveryMode: "discovery mode",
  chequeRange: "cheque range",
  minStageCode: "earliest stage",
  maxStageCode: "latest stage",
  rawMandateText: "mandate in your words",
  professionalSummary: "professional summary",
  backgroundSummary: "background",
  founderCount: "founders",
  fullTimeFounderCount: "full-time founders",
  teamSize: "team size",
  relationshipType: "your relationship to the company",
  businessTitle: "your title",
  isFounder: "founder",
  indexable: "findable by search engines",
  fieldScopes: "what the card shows",
  visibility: "who can see it",
};

function valueText(value: unknown): string {
  if (value === null) return "(cleared)";
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (
      typeof record["amount"] === "string" &&
      typeof record["currency"] === "string"
    ) {
      return `${record["currency"]} ${record["amount"]}`;
    }
    return Object.entries(record)
      .map(([key, entry]) => `${key}: ${JSON.stringify(entry)}`)
      .join(", ");
  }
  return typeof value === "string" ? value : JSON.stringify(value);
}

/** Exactly what will change, one line per field, in the form's words. */
export function previewOf(fields: Readonly<Record<string, unknown>>): string {
  const lines = Object.entries(fields).map(
    ([key, value]) => `${LABELS[key] ?? key}: ${valueText(value)}`,
  );
  return (lines.length === 0 ? ["No field changes."] : lines)
    .join("\n")
    .slice(0, 2000);
}

const RAISE_SUMMARY = {
  CREATE: "Set up your raise",
  UPDATE: "Update your raise",
  CLOSE: "Close your raise",
  REPLACE: "Replace your raise with a new one",
} as const;
const MANDATE_SUMMARY = {
  CREATE: "Create a new mandate",
  UPDATE: "Update your mandate",
  ACTIVATE: "Activate your mandate",
  CLOSE: "Close your mandate",
} as const;
const TEAM_SUMMARY = {
  FOUNDER_PROFILE: "Update your founder profile",
  TEAM_FACTS: "Update your company's team facts",
  COMPANY_MEMBERSHIP: "Update your role at your company",
} as const;

export type RecordChangeDependencies = {
  readonly companies: CompanyQueryPort;
  readonly investors: InvestorOrganisationQueryPort;
  readonly capital: CapitalService;
  readonly companyService: CompanyService;
  readonly investorService: InvestorService;
  readonly publicIdentity: PublicIdentityService;
  readonly authorization: AuthorizationService;
  readonly logger?: Logger | undefined;
};

type Deny = { outcome: "DENY"; code: string };
type Verdict = { outcome: "ALLOW" } | Deny;

async function ownCompany(
  deps: RecordChangeDependencies,
  actor: ActorContext,
  companyId: string,
): Promise<Verdict> {
  if (actor.actorType !== "HUMAN")
    return { outcome: "DENY", code: "NOT_A_PERSON" };
  const id = CompanyIdSchema.safeParse(companyId);
  const profile = id.success
    ? await deps.companies
        .findCanonicalCompanyProfile(id.data)
        .catch(() => null)
    : null;
  return profile !== null &&
    profile.tenantId === actor.tenantId &&
    actor.organisationId !== undefined &&
    profile.organisationId === actor.organisationId
    ? { outcome: "ALLOW" }
    : { outcome: "DENY", code: "NOT_AVAILABLE" };
}

async function ownInvestor(
  deps: RecordChangeDependencies,
  actor: ActorContext,
  investorOrganisationId: string,
): Promise<Verdict> {
  if (actor.actorType !== "HUMAN")
    return { outcome: "DENY", code: "NOT_A_PERSON" };
  const id = InvestorOrganisationIdSchema.safeParse(investorOrganisationId);
  const found = id.success
    ? await deps.investors
        .findCanonicalInvestorOrganisation(id.data)
        .catch(() => null)
    : null;
  return found !== null &&
    found.tenantId === actor.tenantId &&
    actor.organisationId !== undefined &&
    found.organisationId === actor.organisationId
    ? { outcome: "ALLOW" }
    : { outcome: "DENY", code: "NOT_AVAILABLE" };
}

/**
 * Defence in depth (lead decision 2026-09-27): at approval the approver
 * must also hold the capability the owning service will check, on the same
 * resource type and id it checks it on (read from each service: capital
 * use-cases, investors mandate/representative/visibility use-cases,
 * companies team use-cases, public-identity service). The service checks
 * again at execution.
 */
async function holds(
  deps: RecordChangeDependencies,
  actor: ActorContext,
  checks: readonly {
    readonly code: string;
    readonly resourceType: string;
    readonly resourceId: string;
  }[],
): Promise<Verdict> {
  if (actor.organisationId === undefined) {
    return { outcome: "DENY", code: "NOT_AVAILABLE" };
  }
  for (const check of checks) {
    const decision = await deps.authorization.authorize({
      actor,
      capability: capability(check.code),
      resource: {
        kind: "RESOURCE",
        tenantId: actor.tenantId,
        organisationId: actor.organisationId,
        resourceType: check.resourceType,
        resourceId: check.resourceId,
      },
    });
    if (decision.outcome !== "ALLOW") {
      return { outcome: "DENY", code: "NOT_PERMITTED" };
    }
  }
  return { outcome: "ALLOW" };
}

/** Ownership first (one answer for "not yours"), then the capabilities. */
async function both(
  owned: Promise<Verdict>,
  then: () => Promise<Verdict>,
): Promise<Verdict> {
  const first = await owned;
  return first.outcome === "ALLOW" ? then() : first;
}

/** The shared executor shape: run, or FAILED with a code, logged. */
async function run(
  deps: RecordChangeDependencies,
  code: string,
  context: { actionId: string; attempt: number },
  write: () => Promise<Done>,
) {
  try {
    return { outcome: "EXECUTED" as const, result: await write() };
  } catch (error: unknown) {
    deps.logger?.warn(
      { err: error, actionId: context.actionId, attempt: context.attempt },
      "a record change was not applied",
    );
    return { outcome: "FAILED" as const, failureCode: code, retryable: false };
  }
}

export function createRecordChangeActions(
  deps: RecordChangeDependencies,
): readonly AnyQActionDefinition[] {
  const capital = defineQAction<
    z.infer<typeof CapitalObjectiveChangePayloadSchema>,
    Done
  >({
    actionType: CAPITAL_OBJECTIVE_CHANGE,
    version: 1,
    riskClass: "CONFIRM_REQUIRED",
    owner: "q-api",
    description:
      "Creates, updates, closes or replaces the approver's own company's raise, exactly as approved, through the capital context's own commands.",
    payload: CapitalObjectiveChangePayloadSchema,
    result: DoneSchema,
    targets: (payload): readonly QSubjectRef[] => [
      { kind: "COMPANY", companyId: payload.companyId },
    ],
    describe: (payload) => ({
      summary: RAISE_SUMMARY[payload.operation],
      preview: previewOf(payload.fields),
    }),
    confirm: (payload) => `Done. ${RAISE_SUMMARY[payload.operation]}: saved.`,
    authorize: (payload, actor) =>
      both(ownCompany(deps, actor, payload.companyId), () => {
        const onCompany = (code: string) => ({
          code,
          resourceType: "company",
          resourceId: payload.companyId,
        });
        const onObjective = (code: string) => ({
          code,
          resourceType: "capital_objective",
          resourceId: payload.capitalObjectiveId ?? "",
        });
        if (
          payload.operation !== "CREATE" &&
          payload.capitalObjectiveId === null
        ) {
          return Promise.resolve<Verdict>({
            outcome: "DENY",
            code: "NOT_AVAILABLE",
          });
        }
        switch (payload.operation) {
          case "CREATE":
            return holds(deps, actor, [onCompany("capital_objective.create")]);
          case "UPDATE":
            return holds(deps, actor, [onObjective("capital_objective.edit")]);
          case "CLOSE":
            return holds(deps, actor, [onObjective("capital_objective.close")]);
          case "REPLACE":
            return holds(deps, actor, [
              onObjective("capital_objective.close"),
              onCompany("capital_objective.create"),
            ]);
        }
      }),
    executor: {
      execute: (action, context) =>
        run(
          deps,
          "RAISE_CHANGE_REFUSED",
          { actionId: action.actionId, attempt: context.attempt },
          async () => {
            const actor = context.approver;
            const { operation, fields } = action.payload;
            const companyId = CompanyIdSchema.parse(action.payload.companyId);
            const correlationId = context.correlationId;
            if (operation === "CREATE") {
              const created = await deps.capital.createCapitalObjective({
                actor,
                companyId,
                input: CreateCapitalObjectiveRequestSchema.parse(fields),
                idempotencyKey: `q-action:${action.actionId}`,
                correlationId,
              });
              return { version: created.version };
            }
            const capitalObjectiveId = CapitalObjectiveIdSchema.parse(
              action.payload.capitalObjectiveId,
            );
            const current = await deps.capital.getCapitalObjective({
              actor,
              companyId,
              capitalObjectiveId,
            });
            const expectedVersion = current.version;
            if (operation === "UPDATE") {
              const updated = await deps.capital.updateCapitalObjective({
                actor,
                companyId,
                capitalObjectiveId,
                input: UpdateCapitalObjectiveRequestSchema.parse({
                  ...fields,
                  expectedVersion,
                }),
                correlationId,
              });
              return { version: updated.version };
            }
            if (operation === "CLOSE") {
              const closed = await deps.capital.closeCapitalObjective({
                actor,
                companyId,
                capitalObjectiveId,
                input: CloseCapitalObjectiveRequestSchema.parse({
                  ...fields,
                  expectedVersion,
                }),
                correlationId,
              });
              return { version: closed.version };
            }
            const { replacement } = await deps.capital.replaceCapitalObjective({
              actor,
              companyId,
              capitalObjectiveId,
              input: ReplaceCapitalObjectiveRequestSchema.parse({
                replacement: fields,
                expectedVersion,
              }),
              correlationId,
            });
            return { version: replacement.version };
          },
        ),
    },
  });

  const mandate = defineQAction<
    z.infer<typeof InvestorMandateChangePayloadSchema>,
    Done
  >({
    actionType: INVESTOR_MANDATE_CHANGE,
    version: 1,
    riskClass: "CONFIRM_REQUIRED",
    owner: "q-api",
    description:
      "Creates, updates, activates or closes the approver's own investor organisation's mandate, exactly as approved, through the investors context's own commands.",
    payload: InvestorMandateChangePayloadSchema,
    result: DoneSchema,
    targets: (payload): readonly QSubjectRef[] => [
      {
        kind: "INVESTOR_ORGANISATION",
        investorOrganisationId: payload.investorOrganisationId,
      },
    ],
    describe: (payload) => ({
      summary: MANDATE_SUMMARY[payload.operation],
      preview:
        payload.operation === "ACTIVATE"
          ? "Your Discover feed will use this mandate."
          : payload.operation === "CLOSE"
            ? "This mandate stops shaping your feed. Its history is kept."
            : previewOf(payload.fields),
    }),
    confirm: (payload) => `Done. ${MANDATE_SUMMARY[payload.operation]}: saved.`,
    authorize: (payload, actor) =>
      both(ownInvestor(deps, actor, payload.investorOrganisationId), () => {
        if (payload.operation === "CREATE") {
          return holds(deps, actor, [
            {
              code: "investor.mandate.create",
              resourceType: "investor_organisation",
              resourceId: payload.investorOrganisationId,
            },
          ]);
        }
        if (payload.mandateId === null) {
          return Promise.resolve<Verdict>({
            outcome: "DENY",
            code: "NOT_AVAILABLE",
          });
        }
        return holds(deps, actor, [
          {
            code: "investor.mandate.edit",
            resourceType: "investor_mandate",
            resourceId: payload.mandateId,
          },
        ]);
      }),
    executor: {
      execute: (action, context) =>
        run(
          deps,
          "MANDATE_CHANGE_REFUSED",
          { actionId: action.actionId, attempt: context.attempt },
          async () => {
            const actor = context.approver;
            const investorOrganisationId = InvestorOrganisationIdSchema.parse(
              action.payload.investorOrganisationId,
            );
            const { operation, fields } = action.payload;
            const correlationId = context.correlationId;
            if (operation === "CREATE") {
              const created = await deps.investorService.createInvestorMandate({
                actor,
                investorOrganisationId,
                input: CreateInvestorMandateRequestSchema.parse(fields),
                idempotencyKey: `q-action:${action.actionId}`,
                correlationId,
              });
              return { version: created.version };
            }
            const mandateId = InvestorMandateIdSchema.parse(
              action.payload.mandateId,
            );
            const current = await deps.investorService.getInvestorMandate({
              actor,
              investorOrganisationId,
              mandateId,
            });
            const input = { expectedVersion: current.version };
            if (operation === "UPDATE") {
              const updated = await deps.investorService.updateInvestorMandate({
                actor,
                investorOrganisationId,
                mandateId,
                input: UpdateInvestorMandateRequestSchema.parse({
                  ...fields,
                  ...input,
                }),
                correlationId,
              });
              return { version: updated.version };
            }
            const transitioned = await (
              operation === "ACTIVATE"
                ? deps.investorService.activateInvestorMandate
                : deps.investorService.closeInvestorMandate
            )({
              actor,
              investorOrganisationId,
              mandateId,
              input,
              correlationId,
            });
            return { version: transitioned.version };
          },
        ),
    },
  });

  const team = defineQAction<
    z.infer<typeof CompanyTeamChangePayloadSchema>,
    Done
  >({
    actionType: COMPANY_TEAM_CHANGE,
    version: 1,
    riskClass: "CONFIRM_REQUIRED",
    owner: "q-api",
    description:
      "Updates the approver's own founder profile, their company's team facts, or their own role at the company, exactly as approved, through the companies context's team commands.",
    payload: CompanyTeamChangePayloadSchema,
    result: DoneSchema,
    targets: (payload): readonly QSubjectRef[] => [
      { kind: "COMPANY", companyId: payload.companyId },
    ],
    describe: (payload) => ({
      summary: TEAM_SUMMARY[payload.part],
      preview: previewOf(payload.fields),
    }),
    confirm: (payload) => `Done. ${TEAM_SUMMARY[payload.part]}: saved.`,
    authorize: (payload, actor) =>
      both(ownCompany(deps, actor, payload.companyId), () =>
        holds(deps, actor, [
          {
            code:
              payload.part === "TEAM_FACTS"
                ? "company.team.manage"
                : "company.team.self_edit",
            resourceType: "company",
            resourceId: payload.companyId,
          },
        ]),
      ),
    executor: {
      execute: (action, context) =>
        run(
          deps,
          "TEAM_CHANGE_REFUSED",
          { actionId: action.actionId, attempt: context.attempt },
          async () => {
            const actor = context.approver;
            const companyId = CompanyIdSchema.parse(action.payload.companyId);
            const { fields } = action.payload;
            const correlationId = context.correlationId;
            switch (action.payload.part) {
              case "FOUNDER_PROFILE": {
                const saved = await deps.companyService.updateMyFounderProfile({
                  actor,
                  companyId,
                  input: UpdateMyFounderProfileRequestSchema.parse(fields),
                  correlationId,
                });
                return { version: saved.version };
              }
              case "TEAM_FACTS": {
                const saved = await deps.companyService.updateCompanyTeamFacts({
                  actor,
                  companyId,
                  input: UpdateCompanyTeamFactsRequestSchema.parse(fields),
                  correlationId,
                });
                return { version: saved.version };
              }
              case "COMPANY_MEMBERSHIP": {
                const saved =
                  await deps.companyService.upsertMyCompanyMembership({
                    actor,
                    companyId,
                    input: UpsertMyCompanyMembershipRequestSchema.parse(fields),
                    correlationId,
                  });
                return { version: saved.version };
              }
            }
          },
        ),
    },
  });

  const representative = defineQAction<
    z.infer<typeof InvestorRepresentativePayloadSchema>,
    Done
  >({
    actionType: INVESTOR_REPRESENTATIVE_UPDATE,
    version: 1,
    riskClass: "CONFIRM_REQUIRED",
    owner: "q-api",
    description:
      "Updates the approver's own role and title at their investor organisation, exactly as approved, through the investors context.",
    payload: InvestorRepresentativePayloadSchema,
    result: DoneSchema,
    targets: (payload): readonly QSubjectRef[] => [
      {
        kind: "INVESTOR_ORGANISATION",
        investorOrganisationId: payload.investorOrganisationId,
      },
    ],
    describe: (payload) => ({
      summary: "Update your role at your investor organisation",
      preview: previewOf(payload.fields),
    }),
    confirm: () => "Done. Your role is saved.",
    authorize: (payload, actor) =>
      both(ownInvestor(deps, actor, payload.investorOrganisationId), () =>
        holds(deps, actor, [
          {
            code: "investor.representative.self_edit",
            resourceType: "investor_organisation",
            resourceId: payload.investorOrganisationId,
          },
        ]),
      ),
    executor: {
      execute: (action, context) =>
        run(
          deps,
          "REPRESENTATIVE_REFUSED",
          { actionId: action.actionId, attempt: context.attempt },
          async () => {
            const saved =
              await deps.investorService.upsertMyInvestorRepresentative({
                actor: context.approver,
                investorOrganisationId: InvestorOrganisationIdSchema.parse(
                  action.payload.investorOrganisationId,
                ),
                input: UpsertMyInvestorRepresentativeRequestSchema.parse(
                  action.payload.fields,
                ),
                correlationId: context.correlationId,
              });
            return { version: saved.version };
          },
        ),
    },
  });

  const card = defineQAction<z.infer<typeof QCardUpdatePayloadSchema>, Done>({
    actionType: Q_CARD_UPDATE,
    version: 1,
    riskClass: "CONFIRM_REQUIRED",
    owner: "q-api",
    description:
      "Changes the approver's own Q Card details (findable by search engines, which fields it shows to whom), exactly as approved, through the public identity service.",
    payload: QCardUpdatePayloadSchema,
    result: DoneSchema,
    targets: (payload): readonly QSubjectRef[] => [
      payload.subjectType === "COMPANY"
        ? { kind: "COMPANY", companyId: payload.subjectId }
        : {
            kind: "INVESTOR_ORGANISATION",
            investorOrganisationId: payload.subjectId,
          },
    ],
    describe: (payload) => ({
      summary: "Update your Q Card",
      preview: previewOf(payload.fields),
    }),
    confirm: () => "Done. Your Q Card is updated.",
    authorize: (payload, actor) =>
      both(
        payload.subjectType === "COMPANY"
          ? ownCompany(deps, actor, payload.subjectId)
          : ownInvestor(deps, actor, payload.subjectId),
        () =>
          holds(deps, actor, [
            {
              code: "handle.manage",
              resourceType:
                payload.subjectType === "COMPANY"
                  ? "company"
                  : "investor_organisation",
              resourceId: payload.subjectId,
            },
          ]),
      ),
    executor: {
      execute: (action, context) =>
        run(
          deps,
          "Q_CARD_REFUSED",
          { actionId: action.actionId, attempt: context.attempt },
          async () => {
            const actor = context.approver;
            const subject = {
              subjectType: action.payload.subjectType,
              subjectId: action.payload.subjectId,
            };
            const current = await deps.publicIdentity.getCard({
              actor,
              subject,
            });
            if (current === null) throw new Error("no card yet");
            const saved = await deps.publicIdentity.updateCard({
              actor,
              subject,
              input: UpdateQCardRequestSchema.parse({
                ...action.payload.fields,
                expectedVersion: current.version,
              }),
              correlationId: context.correlationId,
            });
            return { version: saved.version };
          },
        ),
    },
  });

  const visibility = defineQAction<
    z.infer<typeof InvestorVisibilityPayloadSchema>,
    Done
  >({
    actionType: INVESTOR_VISIBILITY_SET,
    version: 1,
    riskClass: "CONFIRM_REQUIRED",
    owner: "q-api",
    description:
      "Sets who can see the approver's own investor organisation -- founders on the network, or its own people only -- exactly as approved, through the investors context's visibility command.",
    payload: InvestorVisibilityPayloadSchema,
    result: DoneSchema,
    targets: (payload): readonly QSubjectRef[] => [
      {
        kind: "INVESTOR_ORGANISATION",
        investorOrganisationId: payload.investorOrganisationId,
      },
    ],
    describe: (payload) =>
      payload.visibility === "network_visible"
        ? {
            summary:
              "Make your investor organisation visible to founders on Capital Q",
            preview:
              "Founders on Capital Q can find your organisation and read its declared profile. Your mandate, portfolio and activity stay private.",
          }
        : {
            summary: "Make your investor organisation private",
            preview:
              "Only people in your organisation can see it. Founders can no longer find it.",
          },
    confirm: (payload) =>
      payload.visibility === "network_visible"
        ? "Done. Founders on Capital Q can now find your organisation."
        : "Done. Your organisation is private again.",
    authorize: (payload, actor) =>
      both(ownInvestor(deps, actor, payload.investorOrganisationId), () =>
        holds(deps, actor, [
          {
            code: "investor.edit",
            resourceType: "investor_organisation",
            resourceId: payload.investorOrganisationId,
          },
        ]),
      ),
    executor: {
      execute: (action, context) =>
        run(
          deps,
          "INVESTOR_VISIBILITY_REFUSED",
          { actionId: action.actionId, attempt: context.attempt },
          async () => {
            const actor = context.approver;
            const investorOrganisationId = InvestorOrganisationIdSchema.parse(
              action.payload.investorOrganisationId,
            );
            const current = await deps.investorService.getInvestorOrganisation({
              actor,
              investorOrganisationId,
            });
            const saved = await deps.investorService.setInvestorVisibility({
              actor,
              investorOrganisationId,
              input: SetInvestorVisibilityRequestSchema.parse({
                visibility: action.payload.visibility,
                expectedVersion: current.version,
              }),
              correlationId: context.correlationId,
            });
            return { version: saved.version };
          },
        ),
    },
  });

  return [capital, mandate, team, representative, card, visibility];
}

// ---------------------------------------------------------------------------
// The board the record-change tools write to
// ---------------------------------------------------------------------------

const READING_TTL_MS = 10 * 60 * 1000;

type Prepared = {
  readonly tenantId: string;
  readonly actorUserId: string;
  readonly actionType: string;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly summary: string;
  readonly at: number;
};

export type RecordChangeBoard = RecordChangePort & {
  readonly proposer: QActionProposer;
};

/**
 * One prepared record change per run, for the run's own person, until the
 * run's prepare step asks for it; the proposal is then re-validated against
 * the action's own payload schema. Resolves what the form would have in
 * hand (the current raise, the current mandate) as the actor.
 */
export function createRecordChangeBoard(
  deps: Pick<
    RecordChangeDependencies,
    "capital" | "investorService" | "logger"
  > & {
    readonly now?: (() => number) | undefined;
    /** ADR 0024: the person's own completed onboarding sessions. */
    readonly profileAnswers?: ProfileAnswersPort | undefined;
  },
): RecordChangeBoard {
  const now = deps.now ?? (() => Date.now());
  const prepared = new Map<string, Prepared>();
  const sweep = () => {
    const cutoff = now() - READING_TTL_MS;
    for (const [runId, entry] of prepared) {
      if (entry.at < cutoff) prepared.delete(runId);
    }
  };

  const refused = (reason: string) => ({
    status: "REFUSED" as const,
    awaitingApprovalOf: null,
    reason,
  });

  /** The action and payload for a change, or a person-facing reason. */
  const resolve = async (
    actor: ActorContext,
    change: RecordChange,
  ): Promise<
    | { actionType: string; payload: Record<string, unknown>; summary: string }
    | { reason: string }
  > => {
    const request = requestFor(change);
    if (!request.ok) return { reason: request.reason };
    switch (change.kind) {
      case "CAPITAL_OBJECTIVE": {
        let capitalObjectiveId: string | null = null;
        if (change.operation !== "CREATE") {
          const current = await deps.capital
            .getCurrentCapitalObjective({
              actor,
              companyId: CompanyIdSchema.parse(change.companyId),
            })
            .catch(() => null);
          if (current === null) {
            return {
              reason:
                "Your company has no current raise yet: set one up first.",
            };
          }
          capitalObjectiveId = current.id;
        }
        return {
          actionType: CAPITAL_OBJECTIVE_CHANGE,
          payload: {
            companyId: change.companyId,
            operation: change.operation,
            capitalObjectiveId,
            fields: request.fields,
          },
          summary: RAISE_SUMMARY[change.operation],
        };
      }
      case "INVESTOR_MANDATE": {
        let mandateId = change.mandateId;
        // An id the model supplied is input, never proof (founder live
        // 2026-09-28: it passed the organisation's own id as the mandate's,
        // the change was approved and then refused at execution). Only a
        // mandate on this organisation's own list is ever named; anything
        // else means their current one.
        if (change.operation !== "CREATE") {
          const page = await deps.investorService
            .listInvestorMandates({
              actor,
              investorOrganisationId: InvestorOrganisationIdSchema.parse(
                change.investorOrganisationId,
              ),
              limit: 20,
            })
            .catch(() => null);
          const items = page?.items ?? [];
          const named =
            mandateId === null
              ? undefined
              : items.find((item) => item.id === mandateId);
          const chosen =
            named ??
            items.find((item) => item.status === "ACTIVE") ??
            items.find((item) => item.status === "DRAFT");
          if (chosen === undefined) {
            return {
              reason: "You have no mandate to change yet: create one first.",
            };
          }
          mandateId = chosen.id;
        }
        return {
          actionType: INVESTOR_MANDATE_CHANGE,
          payload: {
            investorOrganisationId: change.investorOrganisationId,
            operation: change.operation,
            mandateId,
            fields: request.fields,
          },
          summary: MANDATE_SUMMARY[change.operation],
        };
      }
      case "FOUNDER_PROFILE":
      case "TEAM_FACTS":
      case "COMPANY_MEMBERSHIP":
        return {
          actionType: COMPANY_TEAM_CHANGE,
          payload: {
            companyId: change.companyId,
            part: change.kind,
            fields: request.fields,
          },
          summary: TEAM_SUMMARY[change.kind],
        };
      case "INVESTOR_REPRESENTATIVE":
        return {
          actionType: INVESTOR_REPRESENTATIVE_UPDATE,
          payload: {
            investorOrganisationId: change.investorOrganisationId,
            fields: request.fields,
          },
          summary: "Update your role at your investor organisation",
        };
      case "INVESTOR_VISIBILITY":
        return {
          actionType: INVESTOR_VISIBILITY_SET,
          payload: {
            investorOrganisationId: change.investorOrganisationId,
            visibility: request.fields["visibility"],
          },
          summary: "Change who can see your investor organisation",
        };
      case "PROFILE_ANSWER": {
        const answer = resolveProfileAnswer(change.field, change.value);
        if ("reason" in answer) return { reason: answer.reason };
        const own =
          deps.profileAnswers === undefined
            ? null
            : await deps.profileAnswers
                .completedSession(actor, answer.journey)
                .catch(() => null);
        if (own === null) {
          return {
            reason:
              "Your setup isn't finished yet, so this is still an answer in your setup: finish it there first.",
          };
        }
        return {
          actionType: ONBOARDING_ANSWER_REVISE,
          payload: {
            journey: answer.journey,
            sessionId: own.sessionId,
            stepKey: answer.stepKey,
            value: answer.value,
            preview: answer.preview,
          },
          summary: "Update your profile",
        };
      }
      case "Q_CARD":
        return {
          actionType: Q_CARD_UPDATE,
          payload: {
            subjectType: change.subjectType,
            subjectId: change.subjectId,
            fields: request.fields,
          },
          summary: "Update your Q Card",
        };
    }
  };

  const SCHEMAS: Readonly<Record<string, z.ZodType>> = {
    [CAPITAL_OBJECTIVE_CHANGE]: CapitalObjectiveChangePayloadSchema,
    [INVESTOR_MANDATE_CHANGE]: InvestorMandateChangePayloadSchema,
    [COMPANY_TEAM_CHANGE]: CompanyTeamChangePayloadSchema,
    [INVESTOR_REPRESENTATIVE_UPDATE]: InvestorRepresentativePayloadSchema,
    [Q_CARD_UPDATE]: QCardUpdatePayloadSchema,
    [INVESTOR_VISIBILITY_SET]: InvestorVisibilityPayloadSchema,
    [ONBOARDING_ANSWER_REVISE]: ProfileAnswerPayloadSchema,
  };

  return {
    prepare: async ({ runId, actor, change }) => {
      sweep();
      const resolved = await resolve(actor, change);
      if ("reason" in resolved) return refused(resolved.reason);
      const existing = prepared.get(runId);
      if (existing !== undefined) {
        return existing.actionType === resolved.actionType &&
          JSON.stringify(existing.payload) === JSON.stringify(resolved.payload)
          ? {
              status: "PREPARED",
              awaitingApprovalOf: existing.summary,
              reason: null,
            }
          : { status: "ONE_PER_TURN", awaitingApprovalOf: null, reason: null };
      }
      prepared.set(runId, {
        tenantId: actor.tenantId,
        actorUserId: actor.userId,
        actionType: resolved.actionType,
        payload: resolved.payload,
        summary: resolved.summary,
        at: now(),
      });
      return {
        status: "PREPARED",
        awaitingApprovalOf: resolved.summary,
        reason: null,
      };
    },
    proposer: {
      propose: (context) => {
        const entry = prepared.get(context.runId);
        if (entry === undefined) return Promise.resolve(null);
        prepared.delete(context.runId);
        if (
          entry.tenantId !== context.actor.tenantId ||
          entry.actorUserId !== context.actor.userId
        ) {
          return Promise.resolve(null);
        }
        const schema = SCHEMAS[entry.actionType];
        const parsed = schema?.safeParse(entry.payload);
        if (schema === undefined || parsed === undefined || !parsed.success) {
          deps.logger?.warn(
            { qRunId: context.runId, actionType: entry.actionType },
            "a prepared record change did not fit its payload",
          );
          return Promise.resolve({
            refused: "that isn't something I can prepare from here",
          });
        }
        return Promise.resolve({
          actionType: QActionTypeSchema.parse(entry.actionType),
          payload: parsed.data as Record<string, unknown>,
        });
      },
    },
  };
}
