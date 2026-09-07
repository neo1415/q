import { randomUUID } from "node:crypto";

import { loadDatabaseConfig } from "@capital-q/config/database";
import type { CorrelationId } from "@capital-q/contracts";
import {
  createRequestDatabaseClient,
  type TransactionContext,
  type TransactionManager,
} from "@capital-q/database";
import { createPostgresEvidenceRepositories } from "@capital-q/evidence";
import {
  AuthUserIdSchema,
  resolveHumanActorContext,
} from "@capital-q/security";
import { createPostgresActorContextResolver } from "@capital-q/security/postgres";

import { createPostgresContradictionRepository } from "../infrastructure/postgres-contradiction-repository.js";
import { createPostgresKnowledgeRepository } from "../infrastructure/postgres-knowledge-repository.js";
import { createKnowledgeQueryService } from "../knowledge/query.js";
import { createKnowledgeWriteGate } from "../knowledge/write-gate.js";
import type { RetrievalScopeConstraint } from "../retrieval/contracts.js";

/**
 * The Knowledge Write Gate smoke (CQ-KNW-002 §49).
 *
 *   pnpm knowledge:write:smoke
 *
 * Claim and evidence in, candidate through the gate, knowledge object out,
 * read back through the permission-aware query service — against the local
 * database, inside one transaction that is rolled back. Synthetic
 * throughout; no provider, no cost, and nothing survives the run.
 *
 * It runs six scenarios, and the ones that record nothing matter as much as
 * the one that does. What is printed is keys, classes and codes: never the
 * statement of a private understanding, and never a value.
 */

class Rollback extends Error {}

function nestedTransactions(tx: TransactionContext): TransactionManager {
  return {
    run: async (work) => {
      const { value } = await tx.sql.savepoint(async (inner) => ({
        value: await work({ sql: inner }),
      }));
      return value;
    },
  };
}

const CORRELATION = (): CorrelationId => `cor_${randomUUID()}`;
const row = (...cells: readonly string[]): string =>
  cells
    .map((cell, at) => cell.padEnd([26, 11, 23, 40, 23, 20][at] ?? 12))
    .join("")
    .trimEnd();

async function main(): Promise<number> {
  const database = createRequestDatabaseClient(loadDatabaseConfig());
  let completed = false;
  try {
    await database.transactions.run(async (tx) => {
      const { sql } = tx;

      // ---- two synthetic tenants ----------------------------------------
      const world = async (label: string) => {
        const tenantId = randomUUID();
        const orgId = randomUUID();
        const companyId = randomUUID();
        const authUserId = randomUUID();
        await sql`insert into identity.tenants (id, name) values (${tenantId}, ${`Knowledge smoke ${label}`})`;
        await sql`insert into identity.organisations (id, tenant_id, organisation_type, display_name, slug)
          values (${orgId}, ${tenantId}, 'company', ${`Org ${label}`}, ${`knw-s-${orgId.slice(0, 8)}`})`;
        await sql`insert into identity.tenant_organisations (tenant_id, organisation_id) values (${tenantId}, ${orgId})`;
        await sql`insert into core.companies (id, tenant_id, organisation_id, canonical_name, slug)
          values (${companyId}, ${tenantId}, ${orgId}, ${`Northstar ${label}`}, ${`knw-s-co-${companyId.slice(0, 8)}`})`;
        await sql`insert into auth.users (id) values (${authUserId})`;
        const [profile] = await sql<
          { id: string }[]
        >`select id from identity.user_profiles where auth_user_id = ${authUserId}`;
        if (profile === undefined)
          throw new Error("profile trigger did not run");
        const membershipId = randomUUID();
        await sql`insert into identity.organisation_memberships (id, tenant_id, organisation_id, user_id)
          values (${membershipId}, ${tenantId}, ${orgId}, ${profile.id})`;
        await sql`insert into identity.membership_roles (membership_id, role_id)
          select ${membershipId}, r.id from permissions.roles r where r.code = 'organisation_admin'`;
        await sql`insert into identity.user_active_contexts (user_id, membership_id) values (${profile.id}, ${membershipId})`;
        const resolution = await resolveHumanActorContext(
          createPostgresActorContextResolver({ sql }),
          { principal: { authUserId: AuthUserIdSchema.parse(authUserId) } },
        );
        if (resolution.status !== "RESOLVED") {
          throw new Error(`actor not resolved: ${resolution.status}`);
        }
        return { tenantId, orgId, companyId, actor: resolution.context };
      };

      const a = await world("A");
      const b = await world("B");

      const evidenceFor = async (
        owner: typeof a,
        visibility: string,
        sensitivity: string,
      ) => {
        const sourceId = randomUUID();
        const evidenceItemId = randomUUID();
        await sql`insert into evidence.sources (id, tenant_id, source_type, subject_type, subject_id, title, created_by_user_id, visibility_scope, sensitivity_class)
          values (${sourceId}, ${owner.tenantId}, 'DOCUMENT', 'COMPANY', ${owner.companyId}, 'Seed deck', ${owner.actor.userId}, ${visibility}, ${sensitivity})`;
        await sql`insert into evidence.evidence_items (id, tenant_id, source_id, subject_type, subject_id, evidence_type, summary, structured_value, locator, evidence_status, reliability_class, visibility_scope, sensitivity_class, created_by_user_id)
          values (${evidenceItemId}, ${owner.tenantId}, ${sourceId}, 'COMPANY', ${owner.companyId}, 'financial.extracted', 'ARR: $2.4m', ${sql.json({ kind: "MONEY", amount: 2400000, currency: "USD" })}::jsonb, ${sql.json({ kind: "statement" })}::jsonb, 'DOCUMENT_SUPPORTED', 'UNKNOWN', ${visibility}, ${sensitivity}, ${owner.actor.userId})`;
        return { sourceId, evidenceItemId };
      };

      const deck = await evidenceFor(a, "founder_private", "CONFIDENTIAL");
      const accounts = await evidenceFor(a, "founder_private", "RESTRICTED");
      const foreign = await evidenceFor(b, "founder_private", "CONFIDENTIAL");

      const knowledge = createPostgresKnowledgeRepository();
      const gate = createKnowledgeWriteGate({
        sql,
        transactions: nestedTransactions(tx),
        knowledge,
        contradictions: createPostgresContradictionRepository(),
        evidence: createPostgresEvidenceRepositories(),
      });
      const query = createKnowledgeQueryService({ sql, knowledge });

      const base = {
        subject: { subjectType: "COMPANY" as const, subjectId: a.companyId },
        knowledgeType: "fact" as const,
        knowledgeKey: "financial.arr",
        statement: "Annual recurring revenue is approximately USD 2.4m.",
        structuredValue: {
          kind: "MONEY",
          amount: 2_400_000,
          currency: "USD",
        },
        truthClassProposal: "USER_CLAIM" as const,
        supportingClaimIds: [],
        supportingEvidenceItemIds: [deck.evidenceItemId],
        supportingSourceIds: [deck.sourceId],
        validFrom: null,
        validTo: null,
        lineage: [],
        reason: "EXTRACTED_FROM_DOCUMENT",
      };

      console.log(
        row(
          "scenario",
          "outcome",
          "reason",
          "truth / evidence",
          "confidence",
          "scope",
        ),
      );
      const show = (
        name: string,
        result: Awaited<ReturnType<typeof gate.submit>>,
      ): void => {
        console.log(
          row(
            name,
            result.outcome,
            result.reason,
            `${result.truthClass ?? "-"} / ${result.evidenceStatus ?? "-"}`,
            result.confidenceClass ?? "-",
            result.visibilityScope ?? "-",
          ),
        );
      };

      // 1. A document-supported understanding, recorded.
      const accepted = await gate.submit({
        actor: a.actor,
        candidate: base,
        correlationId: CORRELATION(),
        automatic: true,
      });
      show("document-supported", accepted);

      // 2. The same understanding again. Nothing written twice.
      show(
        "same candidate again",
        await gate.submit({
          actor: a.actor,
          candidate: base,
          correlationId: CORRELATION(),
          automatic: true,
        }),
      );

      // 3. A second, independent source. Better support, new revision.
      show(
        "second source",
        await gate.submit({
          actor: a.actor,
          candidate: {
            ...base,
            supportingEvidenceItemIds: [accounts.evidenceItemId],
            supportingSourceIds: [accounts.sourceId],
          },
          correlationId: CORRELATION(),
          automatic: true,
        }),
      );

      // 4. A conflicting reading. Held; neither value chosen.
      show(
        "conflicting value",
        await gate.submit({
          actor: a.actor,
          candidate: {
            ...base,
            statement: "Annual recurring revenue is approximately USD 1.9m.",
            structuredValue: {
              kind: "MONEY",
              amount: 1_900_000,
              currency: "USD",
            },
            supportingEvidenceItemIds: [accounts.evidenceItemId],
          },
          correlationId: CORRELATION(),
          automatic: true,
        }),
      );

      // 5. Another tenant's evidence. Nothing written.
      show(
        "cross-tenant evidence",
        await gate.submit({
          actor: a.actor,
          candidate: {
            ...base,
            knowledgeKey: "financial.mrr",
            supportingEvidenceItemIds: [foreign.evidenceItemId],
            supportingSourceIds: [],
          },
          correlationId: CORRELATION(),
          automatic: true,
        }),
      );

      // 6. A candidate asserting VERIFIED, ACTIVE and a percentage.
      show(
        "asserts verified/92%",
        await gate.submit({
          actor: a.actor,
          candidate: {
            ...base,
            knowledgeKey: "team.employee_count",
            truthClassProposal: "VERIFIED",
            status: "ACTIVE",
            confidence: 0.92,
            visibilityScope: "network_visible",
          } as never,
          correlationId: CORRELATION(),
          automatic: true,
        }),
      );

      // ---- read it back, under an envelope -------------------------------
      const owner: RetrievalScopeConstraint = {
        scopeKind: "EVIDENCE_DOCUMENTS",
        layer: "KNOWLEDGE_OBJECTS",
        subjectIds: [a.companyId],
        visibilityScopes: ["founder_private", "organisation_private"],
        sensitivityCeiling: "RESTRICTED",
        canDiscloseExistence: true,
        canQuote: true,
        canProvideLink: false,
      };
      const asOwner = await query.currentForSubject(
        { tenantId: a.tenantId, constraints: [owner] },
        { subjectType: "COMPANY", subjectId: a.companyId },
      );
      const asCounterparty = await query.currentForSubject(
        {
          tenantId: a.tenantId,
          constraints: [
            {
              ...owner,
              scopeKind: "NETWORK_VISIBLE_DATA",
              subjectIds: null,
              visibilityScopes: ["network_visible"],
              sensitivityCeiling: "NETWORK_VISIBLE",
            },
          ],
        },
        { subjectType: "COMPANY", subjectId: a.companyId },
      );
      const asOtherTenant = await query.currentForSubject(
        { tenantId: b.tenantId, constraints: [owner] },
        { subjectType: "COMPANY", subjectId: a.companyId },
      );

      console.log("");
      console.log("read back, under the owner's envelope:");
      for (const entry of asOwner) {
        console.log(
          `  ${entry.object.knowledgeKey.padEnd(24)} ${entry.object.truthClass.padEnd(12)} ` +
            `${entry.object.evidenceStatus.padEnd(22)} ${entry.object.confidenceClass.padEnd(22)} ` +
            `${String(entry.evidence.length)} evidence · ${String(entry.sourceIds.length)} source(s)`,
        );
      }
      console.log("");
      console.log(
        `counterparty envelope: ${String(asCounterparty.length)} · other tenant: ${String(asOtherTenant.length)} (both must be 0)`,
      );

      const [objects] = await sql<{ n: number }[]>`
        select count(*)::int as n from q_knowledge.objects where tenant_id = ${a.tenantId}`;
      const [verified] = await sql<{ n: number }[]>`
        select count(*)::int as n from q_knowledge.objects
         where tenant_id = ${a.tenantId} and truth_class = 'VERIFIED'`;
      const [shared] = await sql<{ n: number }[]>`
        select count(*)::int as n from q_knowledge.objects
         where tenant_id = ${a.tenantId} and visibility_scope not in
           ('personal_private','organisation_private','founder_private','investor_private')`;
      const revisions = await sql<
        { revision_number: number; confidence_class: string }[]
      >`select revision_number, confidence_class from q_knowledge.revisions
          where knowledge_object_id = ${accepted.objectId ?? ""} order by revision_number`;
      console.log("");
      console.log(
        `objects: ${String(objects?.n ?? 0)} · VERIFIED: ${String(verified?.n ?? 0)} · non-private: ${String(shared?.n ?? 0)} (last two must be 0)`,
      );
      console.log(
        `history of the accepted object: ${revisions.map((r) => `r${String(r.revision_number)}=${r.confidence_class}`).join(" -> ")}`,
      );
      console.log("");
      console.log(
        "no statement text printed · no provider called · synthetic data rolled back",
      );
      completed =
        (verified?.n ?? 1) === 0 &&
        (shared?.n ?? 1) === 0 &&
        asCounterparty.length === 0 &&
        asOtherTenant.length === 0;
      throw new Rollback();
    });
  } catch (error: unknown) {
    if (!(error instanceof Rollback)) {
      throw error;
    }
  } finally {
    await database.close();
  }
  return completed ? 0 : 1;
}

process.exitCode = await main();
