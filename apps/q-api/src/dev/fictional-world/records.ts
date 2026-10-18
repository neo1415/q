import { createHash, randomUUID } from "node:crypto";

import { createPostgresMaterialActionAuditWriter } from "@capital-q/audit";
import { createPostgresCapitalObjectiveQueryPort } from "@capital-q/capital";
import { createPostgresCompanyQueryPort } from "@capital-q/companies";
import {
  CorrelationIdSchema,
  QArtifactContentSchema,
  QInternalFindingSchema,
  QRunIdSchema,
  createEventRegistry,
  type QArtifactVersion,
} from "@capital-q/contracts";
import type { RequestDatabase } from "@capital-q/database";
import { renderArtifactFile } from "@capital-q/deck-render";
import { createOutboxWriter } from "@capital-q/eventing";
import {
  EVIDENCE_EVENTS,
  createCompanyEvidenceSubjectResolver,
  createEvidenceService,
  createEvidenceSubjectResolverRegistry,
  createPostgresDocumentQueryPort,
} from "@capital-q/evidence";
import {
  createPostgresInvestorMandateQueryPort,
  createPostgresInvestorOrganisationQueryPort,
} from "@capital-q/investors";
import {
  createPostgresRelationshipEventRepository,
  createPostgresRelationshipRepository,
  type RelationshipQueryPort,
} from "@capital-q/network";
import {
  createDefaultDisclosureResolvers,
  createDisclosureAccessService,
  createDisclosureResourceResolverRegistry,
  createPostgresDisclosurePolicyRepository,
  createRelationshipPartyResolver,
  systemDisclosureClock,
} from "@capital-q/permissions";
import {
  createArtifactService,
  createPostgresArtifactRepository,
} from "@capital-q/q-artifacts";
import { createContextFirewall } from "@capital-q/q-firewall";
import {
  composePitchDeck,
  type CompanyFinding,
  type CompanyIntelligenceResult,
} from "@capital-q/q-specialists";
import {
  AuthUserIdSchema,
  createAuthorizationService,
  resolveHumanActorContext,
  type ActorContext,
} from "@capital-q/security";
import {
  createPostgresActorContextResolver,
  createPostgresAuthorizationPolicySource,
} from "@capital-q/security/postgres";

import { SeedError } from "./http.js";
import type { FictionalCompany } from "./types.js";

/**
 * The records that have no HTTP route of their own (SEED): Evidence claims
 * and the company's pitch deck.
 *
 * Both go through their owning application services, under the founder's
 * own resolved actor context and the same authorization the API applies:
 * `evidence.record` for claims, and for the deck the artifact service,
 * which re-derives its authority from a Context Firewall plan the real
 * firewall computed for this founder and this company. The deck itself is
 * composed by `composePitchDeck`, the same composer Q uses; the only
 * difference from a Q run is that the findings are this file's handwritten
 * story rather than a model's reading. No model is called anywhere.
 */

const correlation = () => CorrelationIdSchema.parse(`cor_${randomUUID()}`);

/** A stable uuid from a name, so reruns reuse the same identifiers. */
function stableUuid(name: string): string {
  const hex = createHash("sha256").update(name).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export function createSeedRecords(database: RequestDatabase) {
  const { sql, transactions } = database;
  const authorization = createAuthorizationService(
    createPostgresAuthorizationPolicySource({ sql }),
  );
  const outbox = createOutboxWriter({
    registry: createEventRegistry([...EVIDENCE_EVENTS]),
  });
  const companies = createPostgresCompanyQueryPort({ sql });
  const evidence = createEvidenceService({
    sql,
    transactions,
    authorization,
    subjects: createEvidenceSubjectResolverRegistry([
      createCompanyEvidenceSubjectResolver(companies),
    ]),
    outbox,
    audit: createPostgresMaterialActionAuditWriter(),
  });

  // The Context Firewall, composed exactly as q-api composes it.
  const investors = createPostgresInvestorOrganisationQueryPort({ sql });
  const mandates = createPostgresInvestorMandateQueryPort({ sql });
  const capital = createPostgresCapitalObjectiveQueryPort({ sql });
  const documents = createPostgresDocumentQueryPort({ sql });
  const relationshipRepository = createPostgresRelationshipRepository();
  const relationshipEvents = createPostgresRelationshipEventRepository();
  const relationships: RelationshipQueryPort = {
    getById: (id) => relationshipRepository.findById(sql, id),
    findByParties: (companyId, investorOrganisationId) =>
      relationshipRepository.findByParties(
        sql,
        companyId,
        investorOrganisationId,
      ),
    listEvents: (id, page = {}) =>
      relationshipEvents.listByRelationship(sql, id, {
        afterSequence: page.afterSequence,
        limit: page.limit ?? 100,
      }),
    getEventById: (id) => relationshipEvents.findById(sql, id),
  };
  const disclosurePorts = {
    companies,
    investors,
    mandates,
    capital,
    relationships,
  };
  const resolvers = createDisclosureResourceResolverRegistry(
    createDefaultDisclosureResolvers(disclosurePorts),
  );
  const relationshipParties = createRelationshipPartyResolver(disclosurePorts);
  const firewall = createContextFirewall({
    authorization,
    disclosure: createDisclosureAccessService({
      sql,
      policies: createPostgresDisclosurePolicyRepository(),
      resolvers,
      relationshipParties,
      clock: systemDisclosureClock,
    }),
    resolvers,
    relationshipParties,
    documents,
    capital,
    clock: systemDisclosureClock,
  });
  const artifacts = createArtifactService({
    repository: createPostgresArtifactRepository({ sql }),
    transactions,
  });

  const actorFor = async (authUserId: string): Promise<ActorContext> => {
    const resolution = await resolveHumanActorContext(
      createPostgresActorContextResolver({ sql }),
      { principal: { authUserId: AuthUserIdSchema.parse(authUserId) } },
    );
    if (resolution.status !== "RESOLVED") {
      throw new SeedError(`actor not resolved: ${resolution.status}`);
    }
    return resolution.context;
  };

  /** Claims, each once by claim key; DOCUMENT_SUPPORTED ones with their evidence. */
  const seedClaims = async (
    actor: ActorContext,
    companyId: string,
    company: FictionalCompany,
  ): Promise<{ readonly created: number; readonly existing: number }> => {
    const subject = { subjectType: "COMPANY" as const, subjectId: companyId };
    const existing = await evidence.listClaims({ actor, subject });
    const known = new Map(existing.map((claim) => [claim.claimKey, claim]));
    let created = 0;
    const byKey = new Map<string, (typeof existing)[number]["id"]>();
    for (const claim of company.claims) {
      const already = known.get(claim.claimKey);
      if (already !== undefined) {
        byKey.set(claim.claimKey, already.id);
        continue;
      }
      const source = await evidence.registerEvidenceSource({
        actor,
        correlationId: correlation(),
        input: {
          sourceType:
            claim.documentTitle === undefined ? "USER_STATEMENT" : "DOCUMENT",
          subject,
          title: (
            claim.documentTitle ??
            `${company.name} founder statement (fictional)`
          ).slice(0, 200),
          metadata: { fictionalDemo: true, seed: "fictional-world" },
        },
      });
      const statedClaim = await evidence.createClaim({
        actor,
        correlationId: correlation(),
        input: {
          subject,
          claimType: claim.claimType,
          claimKey: claim.claimKey,
          statement: claim.statement,
          structuredValue:
            claim.structuredValue === undefined
              ? null
              : { ...claim.structuredValue },
          truthClass: claim.truthClass,
          evidenceStatus: claim.evidenceStatus,
          lifecycleStatus: claim.lifecycleStatus ?? "CURRENT",
          sourceId: source.id,
        },
      });
      byKey.set(claim.claimKey, statedClaim.id);
      if (claim.documentTitle !== undefined) {
        const item = await evidence.createEvidenceItem({
          actor,
          correlationId: correlation(),
          input: {
            sourceId: source.id,
            evidenceType: `${claim.claimType}.reported`,
            summary: claim.statement,
            structuredValue:
              claim.structuredValue === undefined
                ? null
                : { ...claim.structuredValue },
            locator: { kind: "statement" },
            evidenceStatus: "DOCUMENT_SUPPORTED",
          },
        });
        await evidence.linkClaimEvidence({
          actor,
          correlationId: correlation(),
          input: {
            claimId: statedClaim.id,
            evidenceItemId: item.id,
            relationship: "SUPPORTS",
          },
        });
        // A figure that disagrees with the company's other figure is linked
        // to it as CONTRADICTS. Both stay; neither is chosen.
        if (claim.lifecycleStatus === "CONTRADICTORY") {
          for (const other of company.claims) {
            const otherId = byKey.get(other.claimKey);
            if (
              other !== claim &&
              other.lifecycleStatus === "CONTRADICTORY" &&
              otherId !== undefined
            ) {
              await evidence.linkClaimEvidence({
                actor,
                correlationId: correlation(),
                input: {
                  claimId: otherId,
                  evidenceItemId: item.id,
                  relationship: "CONTRADICTS",
                },
              });
            }
          }
        }
      }
      created += 1;
    }
    return { created, existing: company.claims.length - created };
  };

  /**
   * The company's deck. Composed from the seed file on every run and
   * compared with the stored current version: identical means nothing is
   * written; different (the story in companies.ts changed) appends a new
   * version, because an artifact is never overwritten.
   */
  const seedDeck = async (
    actor: ActorContext,
    companyId: string,
    company: FictionalCompany,
  ): Promise<{
    readonly artifactId: string;
    readonly outcome: "composed" | "revised" | "unchanged";
  }> => {
    const subject = { kind: "COMPANY" as const, companyId };
    const draft = composePitchDeck({
      companyName: company.name,
      result: intelligenceFrom(companyId, company, stableUuid("draft")),
      direction: company.direction ?? "MINIMAL_INSTITUTIONAL",
    });
    if (draft === null) {
      throw new SeedError(`${company.name}: too little to compose a deck from`);
    }
    const fingerprint = createHash("sha256")
      .update(JSON.stringify(QArtifactContentSchema.parse(draft.content)))
      .update(draft.title)
      .update(draft.summary)
      .digest("hex");

    const listed = await artifacts.list(actor, {
      limit: 100,
      subjectId: companyId,
    });
    const found = listed.items.find((item) => item.type === "PITCH_DECK");
    if (found !== undefined) {
      const current = (await artifacts.read(actor, found.artifactId)).current;
      if (current !== null && current !== undefined) {
        const stored = createHash("sha256")
          .update(JSON.stringify(QArtifactContentSchema.parse(current.content)))
          .update(current.title)
          .update(current.summary)
          .digest("hex");
        if (stored === fingerprint) {
          return { artifactId: found.artifactId, outcome: "unchanged" };
        }
      }
    }

    // Provenance: a stable run id per company and content. No Q run was
    // executed; the plan below is the firewall's real decision for that id.
    const runId = QRunIdSchema.parse(
      stableUuid(`fictional-world:deck:${company.key}:${fingerprint}`),
    );
    const decision = await firewall.plan({
      actor,
      runId,
      correlationId: correlation(),
      capability: "INVESTIGATE",
      subjects: [subject],
    });
    if (decision.outcome !== "AUTHORISED") {
      throw new SeedError(
        `${company.name}: firewall ${decision.outcome} (${decision.reason})`,
      );
    }
    if (found !== undefined) {
      await artifacts.reviseArtifact({
        actorContext: actor,
        permittedContextPlan: decision.plan,
        qRunId: runId,
        artifactId: found.artifactId,
        instruction:
          "The fictional-world seed story changed; recomposed from the seed file.",
        content: draft,
      });
      return { artifactId: found.artifactId, outcome: "revised" };
    }
    const detail = await artifacts.prepareArtifact({
      actorContext: actor,
      permittedContextPlan: decision.plan,
      qRunId: runId,
      subject,
      artifactType: "PITCH_DECK",
      content: draft,
    });
    return { artifactId: detail.artifact.artifactId, outcome: "composed" };
  };

  /** The rendered files, exactly as the export route renders them. */
  const renderDeck = async (
    actor: ActorContext,
    artifactId: string,
    companyName: string,
  ): Promise<{
    readonly version: QArtifactVersion;
    readonly pdf: Uint8Array;
    readonly pptx: Uint8Array;
  }> => {
    const detail = await artifacts.read(actor, artifactId);
    const version = detail.current;
    if (version === null || version === undefined)
      throw new SeedError(`${companyName}: deck has no version`);
    const pdf = await renderArtifactFile({
      type: "PITCH_DECK",
      version,
      format: "pdf",
      company: companyName,
    });
    const pptx = await renderArtifactFile({
      type: "PITCH_DECK",
      version,
      format: "pptx",
      company: companyName,
    });
    if (pdf === null || pptx === null)
      throw new SeedError(`${companyName}: deck did not render`);
    return { version, pdf: pdf.bytes, pptx: pptx.bytes };
  };

  return { actorFor, seedClaims, seedDeck, renderDeck };
}

/** The handwritten story, in the shape Company Intelligence hands the composer. */
export function intelligenceFrom(
  companyId: string,
  company: FictionalCompany,
  runId: string,
): CompanyIntelligenceResult {
  const findings: CompanyFinding[] = company.deck.map((line, index) => ({
    ...QInternalFindingSchema.parse({
      findingId: stableUuid(
        `fictional-world:finding:${company.key}:${String(index)}`,
      ),
      type: "FACT",
      statement: line.statement,
      truthClass: line.truthClass ?? "USER_CLAIM",
      evidenceStatus: "SELF_REPORTED",
      confidence: "MODERATE",
      subjects: [{ kind: "COMPANY", companyId }],
      evidenceRefs: [],
      runId,
      // The founder's own record, private to their organisation.
      sensitivity: "CONFIDENTIAL",
      visibilityScope: "organisation_private",
    }),
    dimension: line.dimension,
    derivation: "DETERMINISTIC",
    sources: [`${company.name} founder statements (fictional demo)`],
  }));
  const contradictory = company.claims.filter(
    (claim) => claim.lifecycleStatus === "CONTRADICTORY",
  );
  return {
    companyId,
    companyName: company.name,
    // The cover line is the first sentence of this, so it carries the marker.
    canonicalDescription: `${company.shortDescription.replace(/\.$/, "")} (fictional demo company).`,
    specialistVersion: "fictional-world-seed/v1",
    asOf: new Date().toISOString(),
    blocked: null,
    findings,
    coverage: [],
    materialChanges: [],
    contradictions:
      contradictory.length < 2
        ? []
        : [
            {
              contradictionSetId: stableUuid(
                `fictional-world:contradiction:${company.key}`,
              ),
              knowledgeKey: contradictory[0]?.claimKey ?? "contradiction",
              dimension:
                contradictory[0]?.claimType === "customers"
                  ? "CUSTOMERS"
                  : "TRACTION",
              statements: contradictory.map((claim) => claim.statement),
              evidenceRefs: [],
            },
          ],
    informationConfidence: "MODERATE",
    synthesis: null,
    research: null,
    recordedStatements: [],
    artifactRequest: null,
    telemetry: {
      specialistId: "fictional-world-seed",
      specialistVersion: "fictional-world-seed/v1",
      promptBundleVersion: null,
      providerCode: null,
      modelCode: null,
      routingPolicyCode: null,
      modelCalls: 0,
      retrievalCalls: 0,
      knowledgeReads: 0,
      toolCalls: 0,
      factCount: findings.length,
      promptCharacters: 0,
      latencyMs: 0,
      costUsd: 0,
      findingCountsByType: { FACT: findings.length },
      evidenceRefCount: 0,
      contradictionCount: contradictory.length < 2 ? 0 : 1,
      gapCount: 0,
      uncertaintyCount: 0,
      staleFactCount: 0,
      rejectedFindingCount: 0,
      rejectedCitationCount: 0,
      researchCalls: 0,
      publicSourceCount: 0,
      statementsRecorded: 0,
    },
  };
}
