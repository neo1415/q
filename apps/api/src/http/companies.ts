import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  CompanyIdSchema,
  CompanyNotFoundError,
  declaredFactsForNetwork,
  isNetworkVisible,
  projectCompanyForNetwork,
  toCompanyDto,
  type CompanyId,
  type CompanyProfileFacts,
  type CompanyService,
} from "@capital-q/companies";
import {
  COMPANIES_PATH,
  COMPANY_MARKETPLACE_READINESS_ASSESS_SEGMENT,
  COMPANY_MARKETPLACE_READINESS_SEGMENT,
  COMPANY_NETWORK_PREVIEW_SEGMENT,
  CompanyDtoSchema,
  CompanyNetworkPreviewSchema,
  MarketplaceReadinessAssessmentSchema,
  CorrelationIdSchema,
  CreateCompanyRequestSchema,
  IDEMPOTENCY_KEY_HEADER,
  IdempotencyKeyHeaderSchema,
  parseContract,
  type CorrelationId,
  type PitchSummaryDto,
} from "@capital-q/contracts";
import {
  pitchSummary,
  type DiscoverablePitchQueryPort,
} from "@capital-q/media";
import type { ActorContext } from "@capital-q/security";
import { createCorrelationId } from "@capital-q/observability";

import {
  getActorContext,
  requireActorContextHook,
  type ActorContextDependencies,
} from "../security/actor-context.js";

/**
 * `/v1/companies`. Every operation is organisation-scoped: the actor-context
 * hook resolves tenant, organisation and membership from trusted rows and
 * fails closed (CONTEXT_REQUIRED) when a person has no active organisation.
 * Handlers parse the contract, call the service and map the DTO -- no
 * company rule lives here.
 */

export type CompanyRoutesDependencies = ActorContextDependencies & {
  readonly companies: CompanyService;
  /**
   * The Media context's feed read (CQ-MEDIA-012): the pitch investors can
   * play, if any. The same port and the same rule the feed item uses, so a
   * founder's "what investors will see" cannot disagree with what they see.
   * Absent, every `pitch` is null.
   */
  readonly pitches?: DiscoverablePitchQueryPort | undefined;
  /**
   * Another organisation's company, as the network may see it. Absent: a
   * network preview is readable by the owning organisation only.
   */
  readonly networkView?: CompanyNetworkViewPort | undefined;
  /**
   * Whether the company has a declared sector (taxonomy classification),
   * for the readiness view's discoverability note. Absent: not reported.
   */
  readonly sectorDeclared?:
    ((companyId: string) => Promise<boolean>) | undefined;
  /**
   * Whether this actor watches as an investor (every publishable video of
   * a company discoverable to them) or as anyone else signed in (only the
   * videos their owners opened to the network, ADR 0021). Absent: everyone
   * is treated as a non-investor, so a preview never offers a video the
   * viewer would be refused.
   */
  readonly watchesAsInvestor?:
    ((actor: ActorContext) => Promise<boolean>) | undefined;
};

/**
 * A company someone else owns, read only when disclosure says this actor
 * may view it because it is network-visible or public — never through a
 * relationship grant, which is the Data Room's to make. Null when not.
 */
export type CompanyNetworkViewPort = {
  readonly findNetworkVisible: (
    actor: ActorContext,
    companyId: CompanyId,
  ) => Promise<CompanyProfileFacts | null>;
};

/**
 * The videos a network preview offers this viewer, newest first: every
 * publishable one for an investor or the owner, only NETWORK ones for
 * anyone else (ADR 0021), so nothing is offered that playback would refuse.
 */
async function pitchesFor(
  pitches: DiscoverablePitchQueryPort | undefined,
  companyId: string,
  audience: "INVESTORS" | "NETWORK",
): Promise<{
  pitch: PitchSummaryDto | null;
  morePitches?: PitchSummaryDto[];
}> {
  if (pitches === undefined) return { pitch: null };
  const set = (await pitches.findDiscoverablePitches([companyId])).get(
    companyId,
  );
  if (set === undefined) return { pitch: null };
  const offered = [set, ...set.more].filter(
    (p) => audience === "INVESTORS" || p.audience === "NETWORK",
  );
  const [first, ...rest] = offered;
  return first === undefined
    ? { pitch: null }
    : {
        pitch: pitchSummary(first),
        ...(rest.length === 0 ? {} : { morePitches: rest.map(pitchSummary) }),
      };
}

/**
 * The publishable pitch of one company, in the contract's shape. One
 * bounded call; a company with no publishable pitch — none, processing,
 * private, blocked — is null, and nothing here says which.
 */
async function pitchSummaryOf(
  pitches: DiscoverablePitchQueryPort | undefined,
  companyId: string,
): Promise<PitchSummaryDto | null> {
  if (pitches === undefined) {
    return null;
  }
  const pitch = (await pitches.findDiscoverablePitches([companyId])).get(
    companyId,
  );
  return pitch === undefined ? null : pitchSummary(pitch);
}

function correlation(): CorrelationId {
  return CorrelationIdSchema.parse(createCorrelationId());
}

function companyIdParam(request: FastifyRequest): CompanyId {
  const params = request.params as Record<string, unknown>;
  return parseContract(
    CompanyIdSchema,
    params["companyId"],
    "The company identifier is not valid.",
  );
}

export function registerCompanyRoutes(
  app: FastifyInstance,
  dependencies: CompanyRoutesDependencies,
): void {
  const withContext = requireActorContextHook(dependencies);
  const service = dependencies.companies;

  app.post(
    COMPANIES_PATH,
    { onRequest: withContext },
    async (request, reply) => {
      const actor = getActorContext(request);
      const rawKey = request.headers[IDEMPOTENCY_KEY_HEADER];
      const idempotencyKey = parseContract(
        IdempotencyKeyHeaderSchema,
        typeof rawKey === "string" ? rawKey : undefined,
        "An Idempotency-Key header is required to create a company.",
      );
      const input = parseContract(
        CreateCompanyRequestSchema,
        request.body,
        "The company request is not valid.",
      );

      const company = await service.createCompany({
        actor,
        input,
        idempotencyKey,
        correlationId: correlation(),
      });

      void reply
        .status(201)
        .header("Location", `${COMPANIES_PATH}/${company.id}`)
        .header("Cache-Control", "no-store");
      return CompanyDtoSchema.parse(toCompanyDto(company));
    },
  );

  app.get(
    `${COMPANIES_PATH}/:companyId`,
    { onRequest: withContext },
    async (request, reply) => {
      const company = await service.getCompany({
        actor: getActorContext(request),
        companyId: companyIdParam(request),
      });
      void reply.header("Cache-Control", "no-store");
      return CompanyDtoSchema.parse({
        ...toCompanyDto(company),
        pitch: await pitchSummaryOf(dependencies.pitches, company.id),
      });
    },
  );

  // Declared in the app's action registry (ADR 0040); the route is
  // generated (http/app-actions.ts), as Q's path is.
  // Who may see the declared profile (CQ-PRE-REC-001 §31-§35) is set
  // through the route generated from the action registry (ADR 0040).

  // Marketplace readiness (CQ-MKT-001): what the policy says now, without
  // writing. The body-less POST asks for a reconciliation; there is no
  // field in which a client could name a state.
  app.get(
    `${COMPANIES_PATH}/:companyId${COMPANY_MARKETPLACE_READINESS_SEGMENT}`,
    { onRequest: withContext },
    async (request, reply) => {
      const actor = getActorContext(request);
      const companyId = companyIdParam(request);
      const assessment = await service.getMarketplaceReadiness({
        actor,
        companyId,
      });
      // Read only after the assessment succeeded, i.e. for someone who
      // may read this company's readiness: its own declared facts.
      const discoverability =
        dependencies.sectorDeclared === undefined
          ? undefined
          : await (async () => {
              const company = await service.getCompany({ actor, companyId });
              return {
                sectorDeclared:
                  (await dependencies
                    .sectorDeclared?.(companyId)
                    .catch(() => true)) ?? true,
                stageDeclared: company.currentStageCode !== null,
                countryDeclared: company.headquartersCountry !== null,
              };
            })().catch(() => undefined);
      void reply.header("Cache-Control", "no-store");
      return MarketplaceReadinessAssessmentSchema.parse({
        ...assessment,
        ...(discoverability === undefined ? {} : { discoverability }),
      });
    },
  );

  app.post(
    `${COMPANIES_PATH}/:companyId${COMPANY_MARKETPLACE_READINESS_ASSESS_SEGMENT}`,
    { onRequest: withContext },
    async (request, reply) => {
      const assessment = await service.assessMarketplaceReadiness({
        actor: getActorContext(request),
        companyId: companyIdParam(request),
        correlationId: correlation(),
      });
      void reply.header("Cache-Control", "no-store");
      return MarketplaceReadinessAssessmentSchema.parse(assessment);
    },
  );

  // "What investors will see": the same projection Q serves across the
  // network, built from the declared profile alone (§33). The founder's
  // own read of the company authorises it; nothing founder-private can be
  // in the result because the projection never reads it.
  //
  // An investor opening a company from Discover reads the same
  // projection. Their read is authorised by disclosure (network-visible
  // or public), exactly as Q's company tool is; before, the route only
  // accepted the owner's read, so every company the feed served answered
  // "This company isn't available to you" one click later (CQ-ACCEPT-001).
  app.get(
    `${COMPANIES_PATH}/:companyId${COMPANY_NETWORK_PREVIEW_SEGMENT}`,
    { onRequest: withContext },
    async (request, reply) => {
      const actor = getActorContext(request);
      const companyId = companyIdParam(request);
      const company = await service
        .getCompany({ actor, companyId })
        .catch(async (error: unknown) => {
          if (
            !(error instanceof CompanyNotFoundError) ||
            dependencies.networkView === undefined
          ) {
            throw error;
          }
          const visible = await dependencies.networkView.findNetworkVisible(
            actor,
            companyId,
          );
          if (visible === null) {
            throw error;
          }
          return visible;
        });
      void reply.header("Cache-Control", "no-store");
      const projection = projectCompanyForNetwork(company);
      const asInvestor =
        company.organisationId === actor.organisationId ||
        (dependencies.watchesAsInvestor !== undefined &&
          (await dependencies.watchesAsInvestor(actor).catch(() => false)));
      return CompanyNetworkPreviewSchema.parse({
        ...projection,
        networkVisible: isNetworkVisible(company.marketplaceVisibility),
        ...(await pitchesFor(
          dependencies.pitches,
          company.id,
          asInvestor ? "INVESTORS" : "NETWORK",
        )),
        // Classified from the projection, never from the company row: a
        // fact the projection does not carry cannot be one (CQ-WEB-024).
        facts: declaredFactsForNetwork(projection),
      });
    },
  );
}
