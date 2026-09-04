import {
  ContractValidationError,
  CreateInvestorMandateRequestSchema,
  CreateInvestorOrganisationRequestSchema,
  CreateOrganisationRequestSchema,
  InvestorDeploymentStateSchema,
  InvestorTypeSchema,
  UpdateInvestorMandateRequestSchema,
  UpdateInvestorOrganisationRequestSchema,
  UpsertMyInvestorRepresentativeRequestSchema,
  parseContract,
  type CorrelationId,
  type DiscoveryMode,
  type InvestorType,
  type MandateConstraintInput,
  type MandatePreferenceClass,
  type MandateTaxonomyPreferenceInput,
  type OrganisationType,
  type UpdateInvestorMandateRequest,
} from "@capital-q/contracts";
import type { TransactionContext } from "@capital-q/database";
import {
  InvestorMandateIdSchema,
  InvestorMandateNotFoundError,
  InvestorOrganisationIdSchema,
  InvestorOrganisationNotFoundError,
  type InvestorMandate,
  type InvestorMandateId,
  type InvestorOrganisationId,
} from "@capital-q/investors";
import {
  OnboardingContextRequiredError,
  multiSelect,
  decimal,
  resourceIds,
  responseValues,
  singleSelect,
  text,
  type OnboardingActor,
  type OnboardingSession,
  type OnboardingWriteContext,
  type OnboardingWriteTargetHandler,
  type ResponseValues,
} from "@capital-q/onboarding";
import {
  resolveHumanActorContext,
  type ActorContext,
  type OrganisationId,
} from "@capital-q/security";
import { TaxonomyNodeIdSchema } from "@capital-q/taxonomy";

import {
  BUSINESS_MODEL_VOCABULARIES,
  CUSTOMER_TYPE_VOCABULARIES,
  FOUNDER_PREFERENCE_OPTIONS,
  GEOGRAPHY_VOCABULARIES,
  GREEN_FLAG_OPTIONS,
  INVESTOR_STEPS,
  INVESTOR_WRITE_TARGETS,
  PORTFOLIO_MAX_ENTRIES,
  RED_FLAG_OPTIONS,
  SECTOR_VOCABULARIES,
  STAGE_ORDER,
} from "../definition/investor-v1.js";
import {
  createInvestorDomainServices,
  type InvestorDomainDependencies,
  type InvestorDomainServices,
} from "./services.js";

/**
 * Investor write-target handlers. Each maps one semantic target onto the
 * public service of the owning domain, inside the onboarding transaction and
 * under the investor's own actor context. Onboarding orchestrates; the
 * Organisation, Investor and Taxonomy domains own the truth, its versions,
 * its audit and its events. No SQL here, no constraint table, no scoring.
 *
 * Declared mandate only: nothing here reads behaviour, infers, ranks or
 * evaluates GateQ. AVOID is soft and HARD_EXCLUSION is hard, exactly as the
 * investor chose; MUST never becomes an exclusion.
 */

export type InvestorWriteTargetOptions = InvestorDomainDependencies & {
  /** Test seam: compose the domains differently on the transaction. */
  readonly services?:
    ((tx: TransactionContext) => InvestorDomainServices) | undefined;
};

export type BoundInvestor = {
  readonly context: ActorContext;
  readonly investorOrganisationId: InvestorOrganisationId;
};

function invalid(path: string, code: string, message: string): never {
  throw new ContractValidationError(message, [{ path, code, message }]);
}

/** Resolve the actor context for `organisationId` from the verified principal. */
export async function resolveInvestorContext(
  services: InvestorDomainServices,
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

/** The session's bound investor organisation under the investor's context; I0 must have run. */
export async function boundInvestor(
  services: InvestorDomainServices,
  actor: OnboardingActor,
  session: OnboardingSession,
): Promise<BoundInvestor> {
  if (
    session.subject === null ||
    session.subject.subjectType !== "INVESTOR_ORGANISATION" ||
    session.organisationId === null
  ) {
    throw new OnboardingContextRequiredError();
  }
  return {
    context: await resolveInvestorContext(
      services,
      actor,
      session.organisationId,
    ),
    investorOrganisationId: InvestorOrganisationIdSchema.parse(
      session.subject.subjectId,
    ),
  };
}

/** The mandate the journey operates on: the typed I1 response, nothing hidden. */
export function selectedMandateId(values: ResponseValues): InvestorMandateId {
  const ids = resourceIds(values, INVESTOR_STEPS.mandateContext);
  const parsed = InvestorMandateIdSchema.safeParse(ids?.[0]);
  if (!parsed.success) {
    invalid(
      "value.resourceIds",
      "mandate_context_required",
      "Choose the mandate to define first.",
    );
  }
  return parsed.data;
}

// ---------------------------------------------------------------------------
// Canonical vocabularies from option keys
// ---------------------------------------------------------------------------

const STRENGTH: Readonly<Record<string, MandatePreferenceClass>> = {
  must: "MUST",
  strong: "STRONG",
  nice: "NICE",
};

function strengthOf(
  values: ResponseValues,
  stepKey: string,
  fallback: MandatePreferenceClass,
): MandatePreferenceClass {
  const key = singleSelect(values, stepKey);
  return key === null ? fallback : (STRENGTH[key] ?? fallback);
}

/** Investor type → the kind of organisation workspace created for it. */
export function organisationTypeFor(
  investorType: InvestorType,
): OrganisationType {
  switch (investorType) {
    case "FAMILY_OFFICE":
      return "family_office";
    case "SYNDICATE":
      return "syndicate";
    case "ACCELERATOR":
      return "accelerator";
    case "INSTITUTIONAL":
      return "institution";
    case "ANGEL":
    case "VC":
    case "CVC":
    case "SCOUT":
    case "OTHER":
      return "investment_firm";
  }
}

function codesConstraint(
  dimension: MandateConstraintInput["dimension"],
  codes: readonly string[],
  importance: MandatePreferenceClass,
): MandateConstraintInput {
  return {
    dimension,
    operator: codes.length === 1 ? "EQ" : "IN",
    value: { kind: "codes", values: [...codes] },
    importance,
    isHardExclusion: importance === "HARD_EXCLUSION",
  };
}

const allowedCodes = (options: readonly { readonly optionKey: string }[]) =>
  new Set(options.map((option) => option.optionKey));

function requireCodes(
  codes: readonly string[] | null,
  allowed: ReadonlySet<string>,
  path: string,
): readonly string[] {
  for (const code of codes ?? []) {
    if (!allowed.has(code)) {
      invalid(path, "code_not_allowed", "That option is not available.");
    }
  }
  return codes ?? [];
}

// ---------------------------------------------------------------------------
// Stage / cheque / role (I2)
// ---------------------------------------------------------------------------

export function stageChequePatch(values: ResponseValues): Pick<
  UpdateInvestorMandateRequest,
  "chequeRange" | "minStageCode" | "maxStageCode"
> & {
  readonly constraints: MandateConstraintInput[];
} {
  const stages = multiSelect(values, INVESTOR_STEPS.stages) ?? [];
  const ordered = STAGE_ORDER.filter((code) => stages.includes(code));
  const currency = singleSelect(values, INVESTOR_STEPS.currency);
  const min = decimal(values, INVESTOR_STEPS.chequeMin);
  const typical = decimal(values, INVESTOR_STEPS.chequeTypical);
  const max = decimal(values, INVESTOR_STEPS.chequeMax);
  const roles = multiSelect(values, INVESTOR_STEPS.investmentRole) ?? [];
  const constraints: MandateConstraintInput[] = [];
  if (ordered.length > 0) {
    constraints.push(codesConstraint("stage", ordered, "MUST"));
  }
  if (roles.length > 0) {
    constraints.push(codesConstraint("investment_role", roles, "STRONG"));
  }
  return {
    minStageCode: ordered[0] ?? null,
    maxStageCode: ordered[ordered.length - 1] ?? null,
    chequeRange:
      currency === null
        ? null
        : {
            currency: currency.toUpperCase(),
            ...(min === null ? {} : { min }),
            ...(typical === null ? {} : { typical }),
            ...(max === null ? {} : { max }),
          },
    constraints,
  };
}

// ---------------------------------------------------------------------------
// Taxonomy preferences (I3, I4, I7)
// ---------------------------------------------------------------------------

type TaxonomySource = {
  readonly stepKey: string;
  readonly vocabularies: readonly string[];
  readonly strength: (values: ResponseValues) => MandatePreferenceClass;
};

const TAXONOMY_SOURCES: readonly TaxonomySource[] = [
  {
    stepKey: INVESTOR_STEPS.geography,
    vocabularies: GEOGRAPHY_VOCABULARIES,
    strength: (v) => strengthOf(v, INVESTOR_STEPS.geographyStrength, "STRONG"),
  },
  {
    stepKey: INVESTOR_STEPS.sectors,
    vocabularies: SECTOR_VOCABULARIES,
    strength: (v) => strengthOf(v, INVESTOR_STEPS.sectorStrength, "STRONG"),
  },
  {
    stepKey: INVESTOR_STEPS.sectorsAvoid,
    vocabularies: SECTOR_VOCABULARIES,
    strength: () => "AVOID",
  },
  {
    stepKey: INVESTOR_STEPS.businessModels,
    vocabularies: BUSINESS_MODEL_VOCABULARIES,
    strength: () => "STRONG",
  },
  {
    stepKey: INVESTOR_STEPS.customerTypes,
    vocabularies: CUSTOMER_TYPE_VOCABULARIES,
    strength: () => "STRONG",
  },
  {
    stepKey: INVESTOR_STEPS.sectorExclusions,
    vocabularies: SECTOR_VOCABULARIES,
    strength: () => "HARD_EXCLUSION",
  },
];

/**
 * Every taxonomy-bearing answer becomes one declared preference per node
 * with the strength the step explicitly carries. A node named both as a
 * preference and as an exclusion is refused rather than resolved silently.
 */
export async function taxonomyPreferencesFromResponses(
  services: InvestorDomainServices,
  values: ResponseValues,
): Promise<MandateTaxonomyPreferenceInput[]> {
  const wanted = new Map<
    string,
    { strength: MandatePreferenceClass; vocabularies: readonly string[] }
  >();
  for (const source of TAXONOMY_SOURCES) {
    const strength = source.strength(values);
    for (const id of resourceIds(values, source.stepKey) ?? []) {
      const existing = wanted.get(id);
      if (existing !== undefined && existing.strength !== strength) {
        invalid(
          "value.resourceIds",
          "conflicting_preference",
          "A category cannot be both a preference and an exclusion.",
        );
      }
      wanted.set(id, { strength, vocabularies: source.vocabularies });
    }
  }
  if (wanted.size === 0) {
    return [];
  }
  const nodes = await services.taxonomy.findNodesByIds(
    [...wanted.keys()].map((id) => TaxonomyNodeIdSchema.parse(id)),
  );
  const byId = new Map(nodes.map((node) => [String(node.id), node]));
  return [...wanted.entries()].map(([nodeId, item]) => {
    const node = byId.get(nodeId);
    if (
      node === undefined ||
      !item.vocabularies.includes(node.vocabularyCode)
    ) {
      invalid("value.resourceIds", "unknown_node", "Category not available.");
    }
    return {
      nodeId,
      preferenceStrength: item.strength,
      isExclusion: item.strength === "HARD_EXCLUSION",
    };
  });
}

// ---------------------------------------------------------------------------
// Coded constraints (I4 attributes, I5, I6, I7)
// ---------------------------------------------------------------------------

export function businessAttributeConstraints(
  values: ResponseValues,
): MandateConstraintInput[] {
  const constraints: MandateConstraintInput[] = [];
  switch (singleSelect(values, INVESTOR_STEPS.capitalIntensity)) {
    case "capital_light":
      constraints.push(
        codesConstraint("business.attribute", ["capital_light"], "STRONG"),
      );
      break;
    case "avoid_hardware":
      constraints.push(
        codesConstraint("business.attribute", ["hardware"], "AVOID"),
      );
      break;
    case null:
    default:
      break;
  }
  switch (singleSelect(values, INVESTOR_STEPS.regulatoryAppetite)) {
    case "prefer_regulated":
      constraints.push(
        codesConstraint("business.attribute", ["regulated"], "STRONG"),
      );
      break;
    case "avoid_regulated":
      constraints.push(
        codesConstraint("business.attribute", ["regulated"], "AVOID"),
      );
      break;
    case null:
    default:
      break;
  }
  return constraints;
}

export function founderPreferenceConstraints(
  values: ResponseValues,
): MandateConstraintInput[] {
  const codes = requireCodes(
    multiSelect(values, INVESTOR_STEPS.founderPreferences),
    allowedCodes(FOUNDER_PREFERENCE_OPTIONS),
    "value.optionKeys",
  );
  return codes.length === 0
    ? []
    : [
        codesConstraint(
          "founder.business_attribute",
          codes,
          strengthOf(values, INVESTOR_STEPS.founderStrength, "NICE"),
        ),
      ];
}

export function greenFlagConstraints(
  values: ResponseValues,
): MandateConstraintInput[] {
  const constraints: MandateConstraintInput[] = [];
  const codes = requireCodes(
    multiSelect(values, INVESTOR_STEPS.greenFlags),
    allowedCodes(GREEN_FLAG_OPTIONS),
    "value.optionKeys",
  );
  if (codes.length > 0) {
    constraints.push(
      codesConstraint(
        "green_flag",
        codes,
        strengthOf(values, INVESTOR_STEPS.greenFlagStrength, "STRONG"),
      ),
    );
  }
  const custom = text(values, INVESTOR_STEPS.customCriteria);
  if (custom !== null && custom.length > 0) {
    // Bounded prose for people to read; MANUAL_ONLY by registry, never a filter.
    constraints.push({
      dimension: "custom.text",
      operator: "EQ",
      value: { kind: "text", text: custom },
      importance: "NICE",
      isHardExclusion: false,
    });
  }
  return constraints;
}

export function exclusionConstraints(
  values: ResponseValues,
): MandateConstraintInput[] {
  const allowed = allowedCodes(RED_FLAG_OPTIONS);
  const avoid = requireCodes(
    multiSelect(values, INVESTOR_STEPS.avoid),
    allowed,
    "value.optionKeys",
  );
  const hard = requireCodes(
    multiSelect(values, INVESTOR_STEPS.hardExclusions),
    allowed,
    "value.optionKeys",
  );
  const overlap = avoid.filter((code) => hard.includes(code));
  if (overlap.length > 0) {
    invalid(
      "value.optionKeys",
      "conflicting_exclusion",
      "A red flag is either something to avoid or something never to show, not both.",
    );
  }
  const constraints: MandateConstraintInput[] = [];
  if (avoid.length > 0) {
    constraints.push(codesConstraint("red_flag", avoid, "AVOID"));
  }
  if (hard.length > 0) {
    constraints.push(codesConstraint("red_flag", hard, "HARD_EXCLUSION"));
  }
  return constraints;
}

/** One company per line, trimmed, de-duplicated, at most five. */
export function portfolioNames(raw: string | null): readonly string[] {
  if (raw === null) {
    return [];
  }
  const names = [
    ...new Set(
      raw
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0),
    ),
  ];
  if (names.length > PORTFOLIO_MAX_ENTRIES) {
    invalid(
      "value.text",
      "too_many_portfolio_entries",
      `Up to ${String(PORTFOLIO_MAX_ENTRIES)} companies here; you can add more later.`,
    );
  }
  for (const name of names) {
    if (name.length > 200) {
      invalid(
        "value.text",
        "portfolio_name_too_long",
        "Keep each company name under 200 characters.",
      );
    }
  }
  return names;
}

// ---------------------------------------------------------------------------
// Mandate access
// ---------------------------------------------------------------------------

const CLIENT_DIMENSIONS = new Set<string>([
  "stage",
  "geography.country",
  "sector",
  "business.attribute",
  "founder.business_attribute",
  "green_flag",
  "red_flag",
  "investment_role",
  "custom.text",
]);

async function currentMandate(
  services: InvestorDomainServices,
  bound: BoundInvestor,
  mandateId: InvestorMandateId,
): Promise<InvestorMandate> {
  return services.investors.getInvestorMandate({
    actor: bound.context,
    investorOrganisationId: bound.investorOrganisationId,
    mandateId,
  });
}

/** Stored client-editable constraints as inputs, with the given dimensions replaced. */
function mergeConstraints(
  mandate: InvestorMandate,
  replacedDimensions: readonly string[],
  next: readonly MandateConstraintInput[],
): MandateConstraintInput[] {
  const kept: MandateConstraintInput[] = mandate.constraints
    .filter(
      (constraint) =>
        CLIENT_DIMENSIONS.has(constraint.dimension) &&
        !replacedDimensions.includes(constraint.dimension),
    )
    .map((constraint) => ({
      dimension: constraint.dimension as MandateConstraintInput["dimension"],
      operator: constraint.operator,
      value: constraint.value,
      importance: constraint.importance,
      isHardExclusion: constraint.isHardExclusion,
    }));
  return [...kept, ...next];
}

/**
 * One versioned mandate update on the current version read in this
 * transaction. A concurrent change outside onboarding surfaces as the
 * Investor domain's version conflict (409), never a silent retry.
 */
async function updateMandate(
  services: InvestorDomainServices,
  bound: BoundInvestor,
  mandateId: InvestorMandateId,
  patch: (
    mandate: InvestorMandate,
  ) => Omit<UpdateInvestorMandateRequest, "expectedVersion">,
  correlationId: CorrelationId,
): Promise<InvestorMandate> {
  const mandate = await currentMandate(services, bound, mandateId);
  const input = parseContract(
    UpdateInvestorMandateRequestSchema,
    { expectedVersion: mandate.version, ...patch(mandate) },
    "The mandate details are not valid.",
  );
  return services.investors.updateInvestorMandate({
    actor: bound.context,
    investorOrganisationId: bound.investorOrganisationId,
    mandateId,
    input,
    correlationId,
  });
}

// ---------------------------------------------------------------------------
// I0 bootstrap
// ---------------------------------------------------------------------------

async function bootstrapInvestor(
  services: InvestorDomainServices,
  context: OnboardingWriteContext,
  values: ResponseValues,
): Promise<void> {
  const { actor, session, correlationId } = context;
  const name = text(values, INVESTOR_STEPS.organisationName);
  const typeKey = singleSelect(values, INVESTOR_STEPS.investorType);
  const investorType = InvestorTypeSchema.safeParse(typeKey?.toUpperCase());
  if (name === null || name.length === 0) {
    invalid("value.text", "organisation_name_required", "Name your firm.");
  }
  if (!investorType.success) {
    invalid("value", "investor_type_required", "Choose how you invest first.");
  }
  const title = text(values, INVESTOR_STEPS.businessTitle);

  if (session.subject !== null) {
    // Revising the name after binding renames the same investor organisation.
    const bound = await boundInvestor(services, actor, session);
    const investor = await services.investors.getInvestorOrganisation({
      actor: bound.context,
      investorOrganisationId: bound.investorOrganisationId,
    });
    if (
      investor.displayName !== name ||
      investor.investorType !== investorType.data
    ) {
      await services.investors.updateInvestorOrganisation({
        actor: bound.context,
        investorOrganisationId: bound.investorOrganisationId,
        input: parseContract(
          UpdateInvestorOrganisationRequestSchema,
          {
            expectedVersion: investor.version,
            displayName: name,
            investorType: investorType.data,
          },
          "The investor details are not valid.",
        ),
        correlationId,
      });
    }
    return;
  }

  let actorContext: ActorContext;
  if (actor.context?.organisationId !== undefined) {
    // An existing member acts in their explicit active context. Nobody joins
    // an organisation by typing its name.
    actorContext = actor.context;
  } else {
    if (actor.principal === undefined) {
      throw new OnboardingContextRequiredError();
    }
    const membership = await services.organisations.createOrganisation({
      principal: actor.principal,
      input: parseContract(
        CreateOrganisationRequestSchema,
        {
          displayName: name,
          organisationType: organisationTypeFor(investorType.data),
        },
        "The firm name is not valid.",
      ),
      idempotencyKey: `onboarding:${session.id}:organisation`,
      correlationId,
    });
    actorContext = await resolveInvestorContext(
      services,
      actor,
      membership.organisation.id,
    );
  }
  if (actorContext.organisationId === undefined) {
    throw new OnboardingContextRequiredError();
  }

  // One canonical investor organisation per organisation: reuse or create.
  let investorOrganisationId: InvestorOrganisationId;
  try {
    const existing = await services.investors.getCurrentInvestorOrganisation({
      actor: actorContext,
    });
    investorOrganisationId = existing.id;
  } catch (error) {
    if (!(error instanceof InvestorOrganisationNotFoundError)) {
      throw error;
    }
    const created = await services.investors.createInvestorOrganisation({
      actor: actorContext,
      input: parseContract(
        CreateInvestorOrganisationRequestSchema,
        { investorType: investorType.data, displayName: name },
        "The investor details are not valid.",
      ),
      idempotencyKey: `onboarding:${session.id}:investor`,
      correlationId,
    });
    investorOrganisationId = created.id;
  }
  await services.investors.upsertMyInvestorRepresentative({
    actor: actorContext,
    investorOrganisationId,
    input: parseContract(
      UpsertMyInvestorRepresentativeRequestSchema,
      { businessTitle: title },
      "The role is not valid.",
    ),
    correlationId,
  });
  await context.bindContext({
    tenantId: actorContext.tenantId,
    organisationId: actorContext.organisationId,
    subject: {
      subjectType: "INVESTOR_ORGANISATION",
      subjectId: investorOrganisationId,
    },
  });
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

type Handler = (
  services: InvestorDomainServices,
  context: OnboardingWriteContext,
  values: ResponseValues,
) => Promise<void>;

async function withMandate(
  services: InvestorDomainServices,
  context: OnboardingWriteContext,
  values: ResponseValues,
  patch: (
    mandate: InvestorMandate,
  ) =>
    | Omit<UpdateInvestorMandateRequest, "expectedVersion">
    | Promise<Omit<UpdateInvestorMandateRequest, "expectedVersion">>,
): Promise<void> {
  const bound = await boundInvestor(services, context.actor, context.session);
  const mandateId = selectedMandateId(values);
  const mandate = await currentMandate(services, bound, mandateId);
  const resolved = await patch(mandate);
  await updateMandate(
    services,
    bound,
    mandateId,
    () => resolved,
    context.correlationId,
  );
}

export function createInvestorWriteTargets(
  options: InvestorWriteTargetOptions,
): readonly OnboardingWriteTargetHandler[] {
  const servicesFor =
    options.services ??
    ((tx: TransactionContext) => createInvestorDomainServices(tx, options));

  const handlers: Readonly<Record<string, Handler>> = {
    [INVESTOR_WRITE_TARGETS.bootstrap]: bootstrapInvestor,

    [INVESTOR_WRITE_TARGETS.representative]: async (
      services,
      context,
      values,
    ) => {
      const bound = await boundInvestor(
        services,
        context.actor,
        context.session,
      );
      await services.investors.upsertMyInvestorRepresentative({
        actor: bound.context,
        investorOrganisationId: bound.investorOrganisationId,
        input: parseContract(
          UpsertMyInvestorRepresentativeRequestSchema,
          { businessTitle: text(values, INVESTOR_STEPS.businessTitle) },
          "The role is not valid.",
        ),
        correlationId: context.correlationId,
      });
    },

    [INVESTOR_WRITE_TARGETS.deploymentStatus]: async (
      services,
      context,
      values,
    ) => {
      const bound = await boundInvestor(
        services,
        context.actor,
        context.session,
      );
      const state = InvestorDeploymentStateSchema.safeParse(
        singleSelect(values, INVESTOR_STEPS.deploymentStatus)?.toUpperCase(),
      );
      if (!state.success) {
        invalid("value.optionKey", "deployment_state_required", "Choose one.");
      }
      const investor = await services.investors.getInvestorOrganisation({
        actor: bound.context,
        investorOrganisationId: bound.investorOrganisationId,
      });
      if (investor.deploymentState === state.data) {
        return;
      }
      // Operating state only: the mandate's own status is untouched.
      await services.investors.updateInvestorOrganisation({
        actor: bound.context,
        investorOrganisationId: bound.investorOrganisationId,
        input: parseContract(
          UpdateInvestorOrganisationRequestSchema,
          { expectedVersion: investor.version, deploymentState: state.data },
          "The deployment state is not valid.",
        ),
        correlationId: context.correlationId,
      });
    },

    [INVESTOR_WRITE_TARGETS.mandateEnsure]: async (services, context) => {
      const bound = await boundInvestor(
        services,
        context.actor,
        context.session,
      );
      const page = await services.investors.listInvestorMandates({
        actor: bound.context,
        investorOrganisationId: bound.investorOrganisationId,
        limit: 50,
      });
      const open = page.items.filter((m) => m.status !== "CLOSED");
      if (open.length > 0) {
        return;
      }
      // A first DRAFT to define; never activated here.
      await services.investors.createInvestorMandate({
        actor: bound.context,
        investorOrganisationId: bound.investorOrganisationId,
        input: parseContract(
          CreateInvestorMandateRequestSchema,
          { name: "Primary mandate" },
          "The mandate is not valid.",
        ),
        idempotencyKey: `onboarding:${context.session.id}:mandate`,
        correlationId: context.correlationId,
      });
    },

    [INVESTOR_WRITE_TARGETS.mandateSelect]: async (
      services,
      context,
      values,
    ) => {
      const bound = await boundInvestor(
        services,
        context.actor,
        context.session,
      );
      const mandateId = selectedMandateId(values);
      let mandate: InvestorMandate;
      try {
        mandate = await currentMandate(services, bound, mandateId);
      } catch (error) {
        if (error instanceof InvestorMandateNotFoundError) {
          invalid(
            "value.resourceIds",
            "unknown_mandate",
            "That mandate is not available.",
          );
        }
        throw error;
      }
      if (mandate.status === "CLOSED") {
        invalid(
          "value.resourceIds",
          "mandate_closed",
          "A closed mandate cannot be defined.",
        );
      }
    },

    [INVESTOR_WRITE_TARGETS.stageCheque]: (services, context, values) =>
      withMandate(services, context, values, (mandate) => {
        const patch = stageChequePatch(values);
        return {
          minStageCode: patch.minStageCode,
          maxStageCode: patch.maxStageCode,
          chequeRange: patch.chequeRange,
          constraints: mergeConstraints(
            mandate,
            ["stage", "investment_role"],
            patch.constraints,
          ),
        };
      }),

    [INVESTOR_WRITE_TARGETS.taxonomy]: (services, context, values) =>
      withMandate(services, context, values, async () => ({
        taxonomyPreferences: await taxonomyPreferencesFromResponses(
          services,
          values,
        ),
      })),

    [INVESTOR_WRITE_TARGETS.businessAttributes]: (services, context, values) =>
      withMandate(services, context, values, (mandate) => ({
        constraints: mergeConstraints(
          mandate,
          ["business.attribute"],
          businessAttributeConstraints(values),
        ),
      })),

    [INVESTOR_WRITE_TARGETS.founderPreferences]: (services, context, values) =>
      withMandate(services, context, values, (mandate) => ({
        constraints: mergeConstraints(
          mandate,
          ["founder.business_attribute"],
          founderPreferenceConstraints(values),
        ),
      })),

    [INVESTOR_WRITE_TARGETS.greenFlags]: (services, context, values) =>
      withMandate(services, context, values, (mandate) => ({
        constraints: mergeConstraints(
          mandate,
          ["green_flag", "custom.text"],
          greenFlagConstraints(values),
        ),
      })),

    [INVESTOR_WRITE_TARGETS.exclusions]: (services, context, values) =>
      withMandate(services, context, values, (mandate) => ({
        constraints: mergeConstraints(
          mandate,
          ["red_flag"],
          exclusionConstraints(values),
        ),
      })),

    [INVESTOR_WRITE_TARGETS.portfolio]: async (services, context, values) => {
      const bound = await boundInvestor(
        services,
        context.actor,
        context.session,
      );
      const wanted = portfolioNames(text(values, INVESTOR_STEPS.portfolio));
      const current = await services.investors.listInvestorPortfolioReferences({
        actor: bound.context,
        investorOrganisationId: bound.investorOrganisationId,
      });
      for (const reference of current) {
        if (!wanted.includes(reference.companyName)) {
          await services.investors.removeInvestorPortfolioReference({
            actor: bound.context,
            investorOrganisationId: bound.investorOrganisationId,
            portfolioReferenceId: reference.id,
            correlationId: context.correlationId,
          });
        }
      }
      const present = new Set(
        current.map((reference) => reference.companyName),
      );
      for (const companyName of wanted) {
        if (!present.has(companyName)) {
          await services.investors.addInvestorPortfolioReference({
            actor: bound.context,
            investorOrganisationId: bound.investorOrganisationId,
            input: { companyName },
            correlationId: context.correlationId,
          });
        }
      }
    },

    [INVESTOR_WRITE_TARGETS.discoveryMode]: (services, context, values) =>
      withMandate(services, context, values, () => {
        const key = singleSelect(values, INVESTOR_STEPS.discoveryMode);
        const mode = key?.toUpperCase();
        if (
          mode !== "STRICT" &&
          mode !== "BALANCED" &&
          mode !== "EXPLORATORY"
        ) {
          invalid("value.optionKey", "discovery_mode_required", "Choose one.");
        }
        const discoveryMode: DiscoveryMode = mode;
        return { discoveryMode };
      }),

    [INVESTOR_WRITE_TARGETS.rawText]: (services, context, values) =>
      withMandate(services, context, values, () => ({
        rawMandateText: text(values, INVESTOR_STEPS.additionalContext),
      })),

    [INVESTOR_WRITE_TARGETS.confirm]: async (services, context, values) => {
      const bound = await boundInvestor(
        services,
        context.actor,
        context.session,
      );
      const mandateId = selectedMandateId(values);
      const mandate = await currentMandate(services, bound, mandateId);
      if (mandate.status !== "DRAFT") {
        return;
      }
      // Activation is the Investor domain's own transition: capability,
      // version, effective time, audit and event all belong to it.
      await services.investors.activateInvestorMandate({
        actor: bound.context,
        investorOrganisationId: bound.investorOrganisationId,
        mandateId,
        input: { expectedVersion: mandate.version },
        correlationId: context.correlationId,
      });
    },
  };

  return Object.entries(handlers).map(([targetKey, handler]) => ({
    targetKey,
    apply: async (context, response) => {
      if (response.value.type === "CONFIRMATION" && !response.value.confirmed) {
        return;
      }
      await handler(
        servicesFor(context.tx),
        context,
        responseValues(context.currentResponses, response),
      );
    },
  }));
}
