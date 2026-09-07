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
import type { KnowledgeCandidateInput } from "../knowledge/contracts.js";
import type { RetrievalScopeConstraint } from "../retrieval/contracts.js";

/**
 * Time and disagreement, end to end (CQ-KNW-003 §60).
 *
 *   pnpm knowledge:temporal:smoke
 *
 * Walks the four things this packet exists to keep apart, against the local
 * database, inside one transaction that is rolled back:
 *
 *   growth        January then August ARR — a series, not a discrepancy
 *   definition    gross beside net of churn — both true
 *   correction    June restated — the earlier reading superseded, not deleted
 *   conflict      two settled answers to one question — both kept, neither chosen
 *
 * Synthetic throughout: no provider, no cost, nothing survives the run. What
 * is printed is keys, outcomes, codes and statuses — never a statement and
 * never a value, because a smoke log that quotes a private figure is a
 * private figure in a terminal.
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

async function main(): Promise<number> {
  const database = createRequestDatabaseClient(loadDatabaseConfig());
  let completed = false;
  try {
    await database.transactions.run(async (tx) => {
      const { sql } = tx;

      const tenantId = randomUUID();
      const orgId = randomUUID();
      const companyId = randomUUID();
      const authUserId = randomUUID();
      await sql`insert into identity.tenants (id, name) values (${tenantId}, 'Temporal smoke')`;
      await sql`insert into identity.organisations (id, tenant_id, organisation_type, display_name, slug)
        values (${orgId}, ${tenantId}, 'company', 'Temporal Org', ${`knw3-org-${orgId.slice(0, 8)}`})`;
      await sql`insert into identity.tenant_organisations (tenant_id, organisation_id) values (${tenantId}, ${orgId})`;
      await sql`insert into core.companies (id, tenant_id, organisation_id, canonical_name, slug)
        values (${companyId}, ${tenantId}, ${orgId}, 'Northstar', ${`knw3-co-${companyId.slice(0, 8)}`})`;
      await sql`insert into auth.users (id) values (${authUserId})`;
      const [profile] = await sql<
        { id: string }[]
      >`select id from identity.user_profiles where auth_user_id = ${authUserId}`;
      if (profile === undefined) throw new Error("profile trigger did not run");
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
      const actor = resolution.context;

      const seedEvidence = async () => {
        const sourceId = randomUUID();
        const evidenceItemId = randomUUID();
        await sql`insert into evidence.sources (id, tenant_id, source_type, subject_type, subject_id, title, created_by_user_id, visibility_scope, sensitivity_class)
          values (${sourceId}, ${tenantId}, 'DOCUMENT', 'COMPANY', ${companyId}, 'Report', ${actor.userId}, 'founder_private', 'CONFIDENTIAL')`;
        await sql`insert into evidence.evidence_items (id, tenant_id, source_id, subject_type, subject_id, evidence_type, summary, structured_value, locator, evidence_status, reliability_class, visibility_scope, sensitivity_class, created_by_user_id)
          values (${evidenceItemId}, ${tenantId}, ${sourceId}, 'COMPANY', ${companyId}, 'financial.extracted', 'financial figure', ${sql.json({ kind: "MONEY", amount: 0, currency: "USD" })}::jsonb, ${sql.json({ kind: "statement" })}::jsonb, 'DOCUMENT_SUPPORTED', 'UNKNOWN', 'founder_private', 'CONFIDENTIAL', ${actor.userId})`;
        return evidenceItemId;
      };

      const knowledge = createPostgresKnowledgeRepository();
      const contradictions = createPostgresContradictionRepository();
      const gate = createKnowledgeWriteGate({
        sql,
        transactions: nestedTransactions(tx),
        knowledge,
        contradictions,
        evidence: createPostgresEvidenceRepositories(),
      });
      const query = createKnowledgeQueryService({ sql, knowledge });

      const submit = async (
        label: string,
        overrides: Partial<KnowledgeCandidateInput>,
      ) => {
        const evidenceItemId = await seedEvidence();
        const candidate: KnowledgeCandidateInput = {
          subject: { subjectType: "COMPANY", subjectId: companyId },
          knowledgeType: "fact",
          knowledgeKey: "financial.arr",
          statement: "A financial figure for a period.",
          structuredValue: null,
          truthClassProposal: "USER_CLAIM",
          supportingClaimIds: [],
          supportingEvidenceItemIds: [evidenceItemId],
          supportingSourceIds: [],
          validFrom: null,
          validTo: null,
          lineage: [],
          reason: "EXTRACTED_FROM_DOCUMENT",
          ...overrides,
        };
        const result = await gate.submit({
          actor,
          candidate,
          correlationId: CORRELATION(),
          automatic: true,
        });
        console.log(
          `  ${label.padEnd(28)} ${result.outcome.padEnd(20)} ${result.reason.padEnd(26)} ` +
            `${(result.status ?? "-").padEnd(11)} ${result.comparison ?? "-"}`,
        );
        return result;
      };

      const money = (amount: number) => ({
        kind: "MONEY",
        amount,
        currency: "USD",
      });
      const period = (from: string, to: string | null) => ({
        validFrom: from as never,
        validTo: to as never,
      });

      console.log("");
      console.log(
        "  candidate                    outcome             reason                    status     axis",
      );
      console.log(`  ${"-".repeat(96)}`);

      const january = await submit("january (gross, actual)", {
        structuredValue: money(1_800_000),
        ...period("2026-01-01T00:00:00.000Z", "2026-02-01T00:00:00.000Z"),
      });
      await submit("august (gross, actual)", {
        structuredValue: money(2_400_000),
        ...period("2026-08-01T00:00:00.000Z", "2026-09-01T00:00:00.000Z"),
      });
      await submit("january net of churn", {
        structuredValue: money(1_600_000),
        definitionQualifier: "net_of_churn",
        ...period("2026-01-01T00:00:00.000Z", "2026-02-01T00:00:00.000Z"),
      });
      await submit("january forecast", {
        structuredValue: money(4_000_000),
        measurementBasis: "FORECAST",
        ...period("2026-01-01T00:00:00.000Z", "2026-02-01T00:00:00.000Z"),
      });
      const corrected = await submit("january restated", {
        structuredValue: money(1_750_000),
        correctsEarlier: true,
        reason: "CORRECTION",
        ...period("2026-01-01T00:00:00.000Z", "2026-02-01T00:00:00.000Z"),
      });
      const conflicting = await submit("august, disagreeing", {
        structuredValue: money(1_900_000),
        ...period("2026-08-01T00:00:00.000Z", "2026-09-01T00:00:00.000Z"),
      });

      const subject = { subjectType: "COMPANY" as const, subjectId: companyId };
      const owner: RetrievalScopeConstraint = {
        scopeKind: "EVIDENCE_DOCUMENTS",
        layer: "KNOWLEDGE_OBJECTS",
        subjectIds: [companyId],
        visibilityScopes: ["founder_private", "organisation_private"],
        sensitivityCeiling: "RESTRICTED",
        canDiscloseExistence: true,
        canQuote: true,
        canProvideLink: false,
      };
      const scope = { tenantId, constraints: [owner] };

      const history = await query.historyForKey(
        scope,
        subject,
        "financial.arr",
      );
      const asOfJanuary = await query.asOfForKey(
        scope,
        subject,
        "financial.arr",
        new Date("2026-01-15T00:00:00.000Z"),
      );
      const current = await query.currentForSubject(scope, subject);
      const disputes = await query.disputesForSubject(scope, subject);

      console.log("");
      console.log(
        `  history: ${String(history.length)} readings · current: ${String(current.length)} · open disagreements: ${String(disputes.length)}`,
      );
      console.log(
        `  january restated: ${corrected.outcome} · the earlier reading is ${
          history.find((k) => k.object.id === january.objectId)?.object
            .status ?? "missing"
        }`,
      );
      console.log(
        `  as of 15 January: ${asOfJanuary?.object.id === corrected.objectId ? "the correction" : "an earlier reading"}`,
      );
      console.log(
        `  disagreement: ${String(disputes[0]?.members.length ?? 0)} members travel together · materiality ${
          disputes[0]?.set.materiality ?? "-"
        }`,
      );

      const [chosen] = await sql<{ n: number }[]>`
        select count(*)::int as n from q_knowledge.objects
         where tenant_id = ${tenantId} and knowledge_key = 'financial.arr'
           and status = 'ACTIVE'
           and valid_from = '2026-08-01T00:00:00Z'
           and definition_qualifier is null and measurement_basis = 'ACTUAL'`;
      const [deleted] = await sql<{ n: number }[]>`
        select count(*)::int as n from q_knowledge.objects where tenant_id = ${tenantId}`;
      const [openSets] = await sql<{ visibility_scope: string }[]>`
        select visibility_scope from q_knowledge.contradiction_sets
         where tenant_id = ${tenantId} and status = 'OPEN'`;

      console.log("");
      console.log(
        `  objects kept: ${String(deleted?.n ?? 0)} · settled august answers: ${String(chosen?.n ?? 0)} (must be 0 while contested)`,
      );
      console.log(
        `  the disagreement is filed as: ${openSets?.visibility_scope ?? "-"} (never wider than what it is about)`,
      );
      console.log("");
      console.log(
        "no statement text printed · no value printed · no provider called · rolled back",
      );

      completed =
        history.length === 5 &&
        (chosen?.n ?? 1) === 0 &&
        conflicting.contradictionSetId !== null &&
        disputes.length === 1 &&
        openSets?.visibility_scope === "founder_private";
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
