import {
  CapitalObjectiveNotFoundError,
  type CapitalObjective,
} from "@capital-q/capital";
import {
  CompanyIdSchema,
  CompanyTeamFactsNotFoundError,
  type Company,
} from "@capital-q/companies";
import {
  ContractValidationError,
  CreateCapitalObjectiveRequestSchema,
  CreateCompanyRequestSchema,
  CreateOrganisationRequestSchema,
  TaxonomyVocabularyCodeSchema,
  UpdateCapitalObjectiveRequestSchema,
  UpdateCompanyRequestSchema,
  UpdateCompanyTeamFactsRequestSchema,
  UpsertMyCompanyMembershipRequestSchema,
  parseContract,
  type CorrelationId,
} from "@capital-q/contracts";
import type { TransactionContext } from "@capital-q/database";
import {
  OnboardingContextRequiredError,
  type OnboardingActor,
  type OnboardingSession,
  type OnboardingWriteContext,
  type OnboardingWriteTargetHandler,
} from "@capital-q/onboarding";
import {
  resolveHumanActorContext,
  type ActorContext,
  type OrganisationId,
} from "@capital-q/security";
import { TaxonomyNodeIdSchema, type TaxonomyNode } from "@capital-q/taxonomy";

import {
  CATEGORY_VOCABULARIES,
  COUNTRY_OTHER_OPTION,
  FOUNDER_ROLE_TITLES,
  FOUNDER_STEPS,
  FOUNDER_WRITE_TARGETS,
  INSTRUMENT_CODES,
  STAGE_UNKNOWN_OPTION,
  USE_OF_FUNDS_OPTIONS,
} from "../definition/founder-v1.js";
import {
  decimal,
  integer,
  labelsOf,
  multiSelect,
  resourceIds,
  responseValues,
  singleSelect,
  text,
  type ResponseValues,
} from "./responses.js";
import {
  createFounderDomainServices,
  type FounderDomainDependencies,
  type FounderDomainServices,
} from "./services.js";

/**
 * Founder write-target handlers. Each maps one semantic target onto the
 * public service of the owning domain, inside the onboarding transaction
 * and under the founder's own actor context. No SQL, no direct table access,
 * no temporary "company truth": the canonical Company exists from F1 on and
 * every later step revises it through its own contract, version and audit.
 *
 * Handlers run before the response is stored, so a refused or failed
 * canonical write rolls back the whole step. They are retry-safe: a repeat
 * of F1 after the session is bound revises the same company; a repeat of F6
 * recalibrates the same objective; idempotency keys derive from the session.
 */

export type FounderWriteTargetOptions = FounderDomainDependencies & {
  /** Test seam: compose the domains differently on the transaction. */
  readonly services?:
    ((tx: TransactionContext) => FounderDomainServices) | undefined;
};

export type BoundCompany = {
  readonly context: ActorContext;
  readonly companyId: Company["id"];
};

/**
 * Resolve the actor context for `organisationId` on the transaction's
 * executor. Uses the request context when it already names that
 * organisation; otherwise re-resolves from the verified principal, so a
 * founder who bootstrapped a workspace seconds ago (or is acting under no
 * context) is authorised by their real membership, never by the session row.
 */
export async function resolveFounderContext(
  services: FounderDomainServices,
  actor: OnboardingActor,
  organisationId: OrganisationId,
): Promise<ActorContext> {
  if (actor.context?.organisationId === organisationId) {
    return actor.context;
  }
  if (actor.principal === undefined) {
    throw new OnboardingContextRequiredError();
  }
  const resolution = await resolveHumanActorContext(services.resolver, {
    principal: actor.principal,
    selection: { organisationId },
  });
  if (resolution.status !== "RESOLVED") {
    throw new OnboardingContextRequiredError();
  }
  return resolution.context;
}

/** The session's bound company under the founder's context; F1 must have run. */
export async function boundCompany(
  services: FounderDomainServices,
  actor: OnboardingActor,
  session: OnboardingSession,
): Promise<BoundCompany> {
  if (
    session.subject === null ||
    session.subject.subjectType !== "COMPANY" ||
    session.organisationId === null
  ) {
    throw new OnboardingContextRequiredError();
  }
  return {
    context: await resolveFounderContext(
      services,
      actor,
      session.organisationId,
    ),
    companyId: CompanyIdSchema.parse(session.subject.subjectId),
  };
}

function invalid(path: string, code: string, message: string): never {
  throw new ContractValidationError(message, [{ path, code, message }]);
}

/** "example.com" is what founders type; the canonical field is an http(s) URL. */
export function normaliseWebsite(raw: string): string {
  const trimmed = raw.trim();
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

async function updateCompanyIfChanged(
  services: FounderDomainServices,
  bound: BoundCompany,
  changes: Record<string, string | null>,
  correlationId: CorrelationId,
): Promise<void> {
  const company = await services.companies.getCompany({
    actor: bound.context,
    companyId: bound.companyId,
  });
  const differing = Object.fromEntries(
    Object.entries(changes).filter(
      ([field, value]) => (company as Record<string, unknown>)[field] !== value,
    ),
  );
  if (Object.keys(differing).length === 0) {
    return;
  }
  await services.companies.updateCompany({
    actor: bound.context,
    companyId: bound.companyId,
    input: parseContract(
      UpdateCompanyRequestSchema,
      { expectedVersion: company.version, ...differing },
      "The company details are not valid.",
    ),
    correlationId,
  });
}

// ---------------------------------------------------------------------------
// company.bootstrap (F1.company_name)
// ---------------------------------------------------------------------------

async function bootstrapCompany(
  services: FounderDomainServices,
  context: OnboardingWriteContext,
  name: string,
): Promise<void> {
  const { actor, session, correlationId } = context;
  if (session.subject !== null) {
    // A revised name after binding renames the same canonical company.
    const bound = await boundCompany(services, actor, session);
    await updateCompanyIfChanged(
      services,
      bound,
      { canonicalName: name },
      correlationId,
    );
    return;
  }

  let actorContext: ActorContext;
  if (actor.context?.organisationId !== undefined) {
    // An existing member creates the company in their active organisation;
    // the company service decides whether they may.
    actorContext = actor.context;
  } else {
    if (actor.principal === undefined) {
      throw new OnboardingContextRequiredError();
    }
    // First workspace: the organisation service creates tenant, organisation
    // and the founder's admin membership, then activates the context.
    const membership = await services.organisations.createOrganisation({
      principal: actor.principal,
      input: parseContract(
        CreateOrganisationRequestSchema,
        { displayName: name, organisationType: "company" },
        "The company name is not valid.",
      ),
      idempotencyKey: `onboarding:${session.id}:organisation`,
      correlationId,
    });
    actorContext = await resolveFounderContext(
      services,
      actor,
      membership.organisation.id,
    );
  }
  if (actorContext.organisationId === undefined) {
    throw new OnboardingContextRequiredError();
  }

  const company = await services.companies.createCompany({
    actor: actorContext,
    input: parseContract(
      CreateCompanyRequestSchema,
      { canonicalName: name },
      "The company name is not valid.",
    ),
    idempotencyKey: `onboarding:${session.id}:company`,
    correlationId,
  });
  await services.companies.upsertMyCompanyMembership({
    actor: actorContext,
    companyId: company.id,
    input: { relationshipType: "team_member", isFounder: true },
    correlationId,
  });
  // One-way: from here every session mutation is scoped to this company.
  await context.bindContext({
    tenantId: actorContext.tenantId,
    organisationId: actorContext.organisationId,
    subject: { subjectType: "COMPANY", subjectId: company.id },
  });
}

// ---------------------------------------------------------------------------
// company.basics (F1.website / country / stage / description)
// ---------------------------------------------------------------------------

function companyBasicsChanges(
  stepKey: string,
  values: ResponseValues,
): Record<string, string | null> {
  switch (stepKey) {
    case FOUNDER_STEPS.website: {
      const raw = text(values, stepKey);
      return { websiteUrl: raw === null ? null : normaliseWebsite(raw) };
    }
    case FOUNDER_STEPS.country: {
      const code = singleSelect(values, stepKey);
      return {
        headquartersCountry:
          code === null || code === COUNTRY_OTHER_OPTION
            ? null
            : code.toUpperCase(),
      };
    }
    case FOUNDER_STEPS.stage: {
      const code = singleSelect(values, stepKey);
      return {
        currentStageCode:
          code === null || code === STAGE_UNKNOWN_OPTION ? null : code,
      };
    }
    case FOUNDER_STEPS.description:
      return { primaryDescription: text(values, stepKey) };
    default:
      return invalid(
        "stepKey",
        "unsupported_step",
        `step ${stepKey} does not map to company basics`,
      );
  }
}

// ---------------------------------------------------------------------------
// company.taxonomy (F1.categories) -- explicit confirmation, never auto-accept
// ---------------------------------------------------------------------------

async function replaceCategories(
  services: FounderDomainServices,
  bound: BoundCompany,
  ids: readonly string[],
  correlationId: CorrelationId,
): Promise<void> {
  const nodeIds = ids.map((id) => TaxonomyNodeIdSchema.parse(id));
  const nodes = await services.taxonomy.query.findNodesByIds(nodeIds);
  const byId = new Map(nodes.map((node) => [String(node.id), node]));
  const allowed = new Set<string>(CATEGORY_VOCABULARIES);
  const grouped = new Map<string, TaxonomyNode[]>();
  for (const id of ids) {
    const node = byId.get(id);
    if (node === undefined) {
      invalid("value.resourceIds", "unknown_node", "Category not available.");
    }
    if (!allowed.has(node.vocabularyCode)) {
      invalid(
        "value.resourceIds",
        "vocabulary_not_allowed",
        "Category not available here.",
      );
    }
    grouped.set(node.vocabularyCode, [
      ...(grouped.get(node.vocabularyCode) ?? []),
      node,
    ]);
  }
  // Every allowed vocabulary is replaced, so a deselected vocabulary clears.
  for (const code of CATEGORY_VOCABULARIES) {
    await services.taxonomy.replaceCompanyAssignments({
      actor: bound.context,
      companyId: bound.companyId,
      vocabularyCode: TaxonomyVocabularyCodeSchema.parse(code),
      nodes: (grouped.get(code) ?? []).map((node) => ({ nodeId: node.id })),
      correlationId,
    });
  }
}

// ---------------------------------------------------------------------------
// company.team_facts (F4.founder_count / full_time / team_size)
// ---------------------------------------------------------------------------

export function teamFactsInput(
  values: ResponseValues,
): Record<string, number> | null {
  const founderCount = integer(values, FOUNDER_STEPS.founderCount);
  const teamSize = integer(values, FOUNDER_STEPS.teamSize);
  const fullTime = singleSelect(values, FOUNDER_STEPS.fullTime);
  const input: Record<string, number> = {};
  if (founderCount !== null) {
    input["founderCount"] = founderCount;
  }
  if (teamSize !== null) {
    input["teamSize"] = teamSize;
  }
  // "all" and "none" are exact; "some" is a real answer whose count is
  // unknown, and unknown is recorded as absence, never as a guess.
  if (fullTime === "none") {
    input["fullTimeFounderCount"] = 0;
  } else if (fullTime === "all" && founderCount !== null) {
    input["fullTimeFounderCount"] = founderCount;
  }
  return Object.keys(input).length === 0 ? null : input;
}

// ---------------------------------------------------------------------------
// capital.objective (F6.confirm) -- create once, recalibrate thereafter
// ---------------------------------------------------------------------------

export function capitalObjectiveInput(values: ResponseValues): {
  readonly target: { readonly amount: string; readonly currency: string };
  readonly instrumentCode: string | null;
  readonly useOfFundsSummary: string | null;
  readonly targetStage: string | null;
} {
  const currency = singleSelect(values, FOUNDER_STEPS.currency);
  const amount = decimal(values, FOUNDER_STEPS.targetAmount);
  if (currency === null || amount === null) {
    invalid(
      "value",
      "raise_incomplete",
      "Currency and target amount are needed before saving the raise.",
    );
  }
  const instrument = singleSelect(values, FOUNDER_STEPS.instrument);
  const useOfFunds = labelsOf(
    USE_OF_FUNDS_OPTIONS,
    multiSelect(values, FOUNDER_STEPS.useOfFunds),
  );
  const stage = singleSelect(values, FOUNDER_STEPS.stage);
  return {
    target: { amount, currency: currency.toUpperCase() },
    instrumentCode:
      instrument === null ? null : (INSTRUMENT_CODES[instrument] ?? null),
    useOfFundsSummary:
      useOfFunds === null || useOfFunds.length === 0
        ? null
        : useOfFunds.map((item) => item.label).join("; "),
    targetStage:
      stage === null || stage === STAGE_UNKNOWN_OPTION ? null : stage,
  };
}

async function currentObjective(
  services: FounderDomainServices,
  bound: BoundCompany,
): Promise<CapitalObjective | null> {
  try {
    return await services.capital.getCurrentCapitalObjective({
      actor: bound.context,
      companyId: bound.companyId,
    });
  } catch (error) {
    if (error instanceof CapitalObjectiveNotFoundError) {
      return null;
    }
    throw error;
  }
}

async function saveCapitalObjective(
  services: FounderDomainServices,
  context: OnboardingWriteContext,
  values: ResponseValues,
): Promise<void> {
  const bound = await boundCompany(services, context.actor, context.session);
  const input = capitalObjectiveInput(values);
  const existing = await currentObjective(services, bound);
  if (existing === null) {
    await services.capital.createCapitalObjective({
      actor: bound.context,
      companyId: bound.companyId,
      input: parseContract(
        CreateCapitalObjectiveRequestSchema,
        {
          target: input.target,
          ...(input.instrumentCode === null
            ? {}
            : { instrumentCode: input.instrumentCode }),
          ...(input.useOfFundsSummary === null
            ? {}
            : { useOfFundsSummary: input.useOfFundsSummary }),
          ...(input.targetStage === null
            ? {}
            : { targetStage: input.targetStage }),
        },
        "The raise details are not valid.",
      ),
      idempotencyKey: `onboarding:${context.session.id}:F6`,
      correlationId: context.correlationId,
    });
    return;
  }
  // Recalibrate the one active objective; never a duplicate.
  await services.capital.updateCapitalObjective({
    actor: bound.context,
    companyId: bound.companyId,
    capitalObjectiveId: existing.id,
    input: parseContract(
      UpdateCapitalObjectiveRequestSchema,
      {
        expectedVersion: existing.version,
        target: input.target,
        instrumentCode: input.instrumentCode,
        useOfFundsSummary: input.useOfFundsSummary,
        targetStage: input.targetStage,
      },
      "The raise details are not valid.",
    ),
    correlationId: context.correlationId,
  });
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export function createFounderWriteTargets(
  options: FounderWriteTargetOptions,
): readonly OnboardingWriteTargetHandler[] {
  const servicesFor =
    options.services ??
    ((tx: TransactionContext) => createFounderDomainServices(tx, options));

  return [
    {
      targetKey: FOUNDER_WRITE_TARGETS.companyBootstrap,
      apply: async (context, response) => {
        const values = responseValues(context.currentResponses, response);
        const name = text(values, response.stepKey);
        if (name === null || name.length === 0) {
          invalid("value.text", "company_name_required", "Name the company.");
        }
        await bootstrapCompany(servicesFor(context.tx), context, name);
      },
    },
    {
      targetKey: FOUNDER_WRITE_TARGETS.companyBasics,
      apply: async (context, response) => {
        const services = servicesFor(context.tx);
        const bound = await boundCompany(
          services,
          context.actor,
          context.session,
        );
        await updateCompanyIfChanged(
          services,
          bound,
          companyBasicsChanges(
            response.stepKey,
            responseValues(context.currentResponses, response),
          ),
          context.correlationId,
        );
      },
    },
    {
      targetKey: FOUNDER_WRITE_TARGETS.companyTaxonomy,
      apply: async (context, response) => {
        const services = servicesFor(context.tx);
        const bound = await boundCompany(
          services,
          context.actor,
          context.session,
        );
        const ids = resourceIds(
          responseValues(context.currentResponses, response),
          response.stepKey,
        );
        await replaceCategories(
          services,
          bound,
          ids ?? [],
          context.correlationId,
        );
      },
    },
    {
      targetKey: FOUNDER_WRITE_TARGETS.founderMembership,
      apply: async (context, response) => {
        const services = servicesFor(context.tx);
        const bound = await boundCompany(
          services,
          context.actor,
          context.session,
        );
        const role = singleSelect(
          responseValues(context.currentResponses, response),
          response.stepKey,
        );
        await services.companies.upsertMyCompanyMembership({
          actor: bound.context,
          companyId: bound.companyId,
          input: parseContract(
            UpsertMyCompanyMembershipRequestSchema,
            {
              relationshipType: "team_member",
              businessTitle:
                role === null ? null : (FOUNDER_ROLE_TITLES[role] ?? null),
              isFounder: true,
            },
            "The role is not valid.",
          ),
          correlationId: context.correlationId,
        });
      },
    },
    {
      targetKey: FOUNDER_WRITE_TARGETS.companyTeamFacts,
      apply: async (context, response) => {
        const input = teamFactsInput(
          responseValues(context.currentResponses, response),
        );
        if (input === null) {
          return;
        }
        const services = servicesFor(context.tx);
        const bound = await boundCompany(
          services,
          context.actor,
          context.session,
        );
        // Facts are versioned: read the current row so this step revises it
        // rather than racing a concurrent edit; absence means create.
        let expectedVersion: number | undefined;
        try {
          expectedVersion = (
            await services.companies.getCompanyTeamFacts({
              actor: bound.context,
              companyId: bound.companyId,
            })
          ).version;
        } catch (error) {
          if (!(error instanceof CompanyTeamFactsNotFoundError)) {
            throw error;
          }
        }
        await services.companies.updateCompanyTeamFacts({
          actor: bound.context,
          companyId: bound.companyId,
          input: parseContract(
            UpdateCompanyTeamFactsRequestSchema,
            expectedVersion === undefined
              ? input
              : { expectedVersion, ...input },
            "The team facts are not valid.",
          ),
          correlationId: context.correlationId,
        });
      },
    },
    {
      targetKey: FOUNDER_WRITE_TARGETS.capitalObjective,
      apply: async (context, response) => {
        const values = responseValues(context.currentResponses, response);
        if (
          response.value.type !== "CONFIRMATION" ||
          !response.value.confirmed
        ) {
          return;
        }
        await saveCapitalObjective(servicesFor(context.tx), context, values);
      },
    },
  ];
}
