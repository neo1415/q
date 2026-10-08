import type { MaterialActionAuditWriter } from "@capital-q/audit";
import {
  CompanyIdSchema,
  createPostgresCompanyQueryPort,
  createPostgresFounderPersonSource,
  projectFounderPerson,
} from "@capital-q/companies";
import {
  CorrelationIdSchema,
  type FounderPersonDto,
} from "@capital-q/contracts";
import type { DatabaseExecutor, TransactionManager } from "@capital-q/database";
import type { OutboxWriter } from "@capital-q/eventing";
import {
  coachDeck,
  createPostgresDataRoom,
  createSharedDocumentDownloads,
  DocumentNotFoundError,
  type PrivateDocumentDownloadAuthorizer,
} from "@capital-q/evidence";
import {
  createPostgresInvestorOrganisationQueryPort,
  InvestorOrganisationIdSchema,
} from "@capital-q/investors";
import {
  createNetworkService,
  createPostgresDiligenceQuestions,
  createPostgresDiligenceRequests,
  createPostgresRelationshipEventRepository,
  createPostgresRelationshipRepository,
  createRelationshipEventAppender,
  createRelationshipEventRegistry,
  RELATIONSHIP_EVENT_DEFINITIONS,
} from "@capital-q/network";
import {
  createCompanyDeckService,
  createDataRoomService,
  createFounderRequestsService,
  createPostgresDisclosurePolicyRepository,
  createPostgresProfileMaterialPorts,
  type DataRoomCompany,
  type DisclosureAccessService,
  type DisclosurePolicyManager,
  type FounderRequestsDependencies,
  type FounderRequestsNotice,
} from "@capital-q/permissions";
import { createCorrelationId } from "@capital-q/observability";
import {
  capability,
  OrganisationIdSchema,
  TenantIdSchema,
  type ActorContext,
  type AuthorizationService,
} from "@capital-q/security";

/**
 * The profile's data room, pitch deck and founder pages (overnight plan
 * A3-A7), composed from the rules that already govern each part: the pitch
 * rule (`investorMayFind`), disclosure policies and the access service,
 * `disclosure.manage` on the owning organisation, the canonical
 * relationship, signed short-lived reads straight from storage.
 */
export function createProfileMaterial(dependencies: {
  readonly sql: DatabaseExecutor;
  readonly transactions: TransactionManager;
  readonly storage: PrivateDocumentDownloadAuthorizer | undefined;
  readonly serveUnscanned: boolean;
  readonly authorization: AuthorizationService;
  readonly policies: Pick<DisclosurePolicyManager, "grant" | "revoke">;
  readonly access: Pick<DisclosureAccessService, "canDisclose">;
  readonly audit: MaterialActionAuditWriter;
  readonly outbox: OutboxWriter;
  readonly investorOrganisationFor: (
    actor: ActorContext,
  ) => Promise<{ readonly investorOrganisationId: string } | null>;
  readonly investorMayFind: (
    actor: ActorContext,
    companyId: string,
  ) => Promise<boolean>;
  readonly notify?:
    | ((input: {
        readonly relationshipId: string;
        readonly actingSide: "INVESTOR" | "COMPANY";
        readonly title: string;
        readonly key: string;
        readonly priority: "NEEDS_YOU" | "UPDATE";
      }) => Promise<unknown>)
    | undefined;
  /** Founder documents (2026-10-08): the requests inbox's notices. */
  readonly notifyRequests?:
    ((input: FounderRequestsNotice) => Promise<unknown>) | undefined;
  /** An answer recorded through the Knowledge Write Gate; absent: words only. */
  readonly answers?: FounderRequestsDependencies["answers"];
}) {
  const { sql } = dependencies;
  const store = createPostgresDataRoom();
  const reads = createPostgresProfileMaterialPorts({ sql });
  const policyRepository = createPostgresDisclosurePolicyRepository();
  const newCorrelationId = () =>
    CorrelationIdSchema.parse(createCorrelationId());
  const downloads =
    dependencies.storage === undefined
      ? undefined
      : createSharedDocumentDownloads({
          sql,
          storage: dependencies.storage,
          serveUnscanned: dependencies.serveUnscanned,
        });
  const inline = async (document: {
    tenantId: string;
    documentId: string;
    versionId: string;
  }) => {
    if (downloads === undefined) throw new DocumentNotFoundError();
    const link = await downloads.authorizeSharedVersion({
      documentTenantId: document.tenantId,
      documentId: document.documentId,
      documentVersionId: document.versionId,
      disposition: "INLINE",
    });
    return { url: link.url, expiresAt: link.expiresAt };
  };
  // A share that includes download (2026-10-08): the same signed read,
  // as an attachment.
  const attachment = async (document: {
    tenantId: string;
    documentId: string;
    versionId: string;
  }) => {
    if (downloads === undefined) throw new DocumentNotFoundError();
    const link = await downloads.authorizeSharedVersion({
      documentTenantId: document.tenantId,
      documentId: document.documentId,
      documentVersionId: document.versionId,
      disposition: "ATTACHMENT",
    });
    return { url: link.url, expiresAt: link.expiresAt };
  };
  const ownerMayManage = async (
    actor: ActorContext,
    company: DataRoomCompany,
  ) =>
    (
      await dependencies.authorization.authorize({
        actor,
        capability: capability("disclosure.manage"),
        resource: {
          kind: "RESOURCE",
          tenantId: TenantIdSchema.parse(company.tenantId),
          organisationId: OrganisationIdSchema.parse(company.organisationId),
          resourceType: "company",
          resourceId: company.id,
        },
      })
    ).outcome === "ALLOW";
  const network = createNetworkService({
    sql,
    transactions: dependencies.transactions,
    companies: createPostgresCompanyQueryPort({ sql }),
    investors: createPostgresInvestorOrganisationQueryPort({ sql }),
    outbox: dependencies.outbox,
    audit: dependencies.audit,
  });
  const investorOf = async (actor: ActorContext) => {
    const found = await dependencies.investorOrganisationFor(actor);
    return found === null
      ? null
      : {
          investorOrganisationId: found.investorOrganisationId,
          name: await reads.investorName(found.investorOrganisationId),
        };
  };

  const appender = createRelationshipEventAppender({
    registry: createRelationshipEventRegistry(RELATIONSHIP_EVENT_DEFINITIONS),
    repositories: {
      relationships: createPostgresRelationshipRepository(),
      events: createPostgresRelationshipEventRepository(),
    },
  });

  const dataRoom = createDataRoomService({
    sql,
    transactions: dependencies.transactions,
    store,
    company: reads.company,
    investorOf,
    investorMayFind: dependencies.investorMayFind,
    ownerMayManage,
    relationshipOf: reads.relationshipOf,
    ensureRelationship: async (command) =>
      (
        await network.ensureRelationship({
          actor: command.actor,
          companyId: CompanyIdSchema.parse(command.companyId),
          investorOrganisationId: InvestorOrganisationIdSchema.parse(
            command.investorOrganisationId,
          ),
          source: { type: "DISCOVER" },
          // The investor's own first contact: private to them until the
          // request (relationship_shared) is appended.
          visibilityScope: "investor_private",
          correlationId: command.correlationId,
        })
      ).relationship.id,
    policies: dependencies.policies,
    policyRepository,
    access: dependencies.access,
    signedInline: (document) => {
      if (document.currentVersionId === null) throw new DocumentNotFoundError();
      return inline({
        tenantId: document.tenantId,
        documentId: document.documentId,
        versionId: document.currentVersionId,
      });
    },
    signedAttachment: (document) => {
      if (document.currentVersionId === null) throw new DocumentNotFoundError();
      return attachment({
        tenantId: document.tenantId,
        documentId: document.documentId,
        versionId: document.currentVersionId,
      });
    },
    nameOf: (actor) => reads.personName(actor.userId),
    appender,
    audit: dependencies.audit,
    notify: dependencies.notify,
    newCorrelationId,
  });

  /**
   * Founder documents (2026-10-08): the founder's requests inbox, answers,
   * and the access editor, on the same rules as the data room: the owner
   * with disclosure.manage, disclosure policies for every share.
   */
  const founderRequests = createFounderRequestsService({
    sql,
    transactions: dependencies.transactions,
    store,
    dataRoom,
    diligenceRequests: createPostgresDiligenceRequests(),
    questions: createPostgresDiligenceQuestions(),
    company: reads.company,
    ownerMayManage,
    relationship: async (relationshipId) => {
      if (!/^[0-9a-f-]{36}$/i.test(relationshipId)) return null;
      const rows = await sql<
        {
          company_id: string;
          tenant_id: string;
          investor_organisation_id: string;
        }[]
      >`
        select company_id, tenant_id, investor_organisation_id
          from network.relationships where id = ${relationshipId}`;
      const row = rows[0];
      return row === undefined
        ? null
        : {
            companyId: row.company_id,
            tenantId: row.tenant_id,
            investorOrganisationId: row.investor_organisation_id,
          };
    },
    // Only relationships the company can see: a private discovery by an
    // investor (investor_private, no shared event yet) is not listed.
    relationshipsOf: async (companyId) => {
      const rows = await sql<{ id: string; display_name: string }[]>`
        select r.id, i.display_name
          from network.relationships r
          join core.investor_organisations i on i.id = r.investor_organisation_id
         where r.company_id = ${companyId}
           and exists (select 1 from network.relationship_events e
                        where e.relationship_id = r.id
                          and e.visibility_scope = 'relationship_shared')
         order by i.display_name
         limit 200`;
      return rows.map((row) => ({
        relationshipId: row.id,
        investorOrganisationName: row.display_name,
      }));
    },
    investorOf: dependencies.investorOrganisationFor,
    relationshipOf: reads.relationshipOf,
    policies: dependencies.policies,
    policyRepository,
    appender,
    audit: dependencies.audit,
    answers: dependencies.answers,
    notify: dependencies.notifyRequests,
    newCorrelationId,
  });

  const companyDeck = createCompanyDeckService({
    sql,
    transactions: dependencies.transactions,
    store,
    company: reads.company,
    isInvestor: async (actor) =>
      (await dependencies.investorOrganisationFor(actor)) !== null,
    investorMayFind: dependencies.investorMayFind,
    ownerMayManage,
    sharedWithActor: async (actor, companyId, documentId) => {
      const view = await dataRoom.view(actor, companyId);
      return (
        view?.viewer === "INVESTOR" &&
        view.documents.some(
          (document) =>
            document.documentId === documentId && document.access === "OPEN",
        )
      );
    },
    coach: coachDeck,
    signedInline: (deck) =>
      inline({
        tenantId: deck.tenantId,
        documentId: deck.documentId,
        versionId: deck.versionId,
      }),
    nameOf: (actor) => reads.personName(actor.userId),
    audit: dependencies.audit,
    newCorrelationId,
  });

  const founders = createPostgresFounderPersonSource({ sql });
  /** A7: the team's own rule (ADR 0041): the owner, or an investor the pitch rule admits. */
  const founderPerson = async (
    actor: ActorContext,
    companyId: string,
    position: number,
  ): Promise<FounderPersonDto | null> => {
    const company = await reads.company(companyId);
    if (company === null) return null;
    const owner = company.organisationId === actor.organisationId;
    if (
      !owner &&
      !(await dependencies
        .investorMayFind(actor, company.id)
        .catch(() => false))
    )
      return null;
    const source = await founders.founderAt({
      tenantId: company.tenantId,
      companyId: company.id,
      position,
    });
    if (source === null) return null;
    const room = owner
      ? null
      : await dataRoom.view(actor, company.id).catch(() => null);
    const open =
      room?.viewer === "INVESTOR"
        ? room.documents
            .filter((document) => document.access === "OPEN")
            .map((document) => document.documentId)
        : [];
    return projectFounderPerson(source, {
      companyId: company.id,
      companyName: company.name,
      position,
      openDocumentIds: new Set(open),
      today: new Date(),
    });
  };

  return { dataRoom, companyDeck, founderPerson, founderRequests };
}
