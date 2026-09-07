import { randomUUID } from "node:crypto";

import { parseDatabaseConfig } from "@capital-q/config/database";
import type { QConversationId } from "@capital-q/contracts";
import { createRequestDatabaseClient } from "@capital-q/database";
import {
  createEmbeddingService,
  createFakeEmbeddingProvider,
  EmbeddingConfigurationSchema,
  QWEN3_EMBEDDING_CONFIGURATION,
} from "@capital-q/q-embeddings";
import {
  createAuthorisedRetrievalService,
  createEmbeddingPersistenceService,
  createKnowledgeQueryService,
  createPostgresChunkEmbeddingRepository,
  createPostgresChunkHydration,
  createPostgresKnowledgeRepository,
  createPostgresLexicalSearch,
  createPostgresQKnowledgeRepositories,
  createPostgresSemanticSearch,
  createQEvidenceRetrieval,
} from "@capital-q/q-knowledge";
import {
  createCompanyIntelligenceSpecialist,
  createKnowledgeCompanyPort,
  createRetrievalEvidencePort,
  createSpecialistQAnswer,
  createToolCanonicalPort,
  type CompanyIntelligenceResult,
  type SpecialistQAnswer,
} from "@capital-q/q-specialists";

import { createQEvalWorld, type QEvalWorld } from "../fixtures/world.js";

/**
 * The Company Intelligence developer smoke (CQ-Q-020 §111, §112).
 *
 * Four turns of one conversation through the REAL Q path — createRun, the
 * LangGraph orchestrator, the Context Firewall, the Safe Read tools,
 * authorised Q Knowledge, authorised hybrid retrieval, the Model Gateway
 * and the specialist behind the answer seam — with the provider scripted
 * so the run costs nothing and needs no key.
 *
 * What it prints is a safe readout: the specialist's version, counts by
 * finding type, evidence-reference counts, and what Q said. What it never
 * prints is a fixture marker, a finding statement, a fact or a prompt, so
 * the output can be pasted into an issue without pasting a company's
 * numbers with it (§102).
 *
 *   pnpm q:company-intelligence:smoke
 *   pnpm q:company-intelligence:smoke --live
 *
 * Everything is synthetic and nothing survives the run.
 */

const PIPELINE = "evidence-processing-v1";
const PRIVATE_MARKER = "QCI-SMOKE-PRIVATE-DO-NOT-LEAK";

const SLIDES: readonly string[] = [
  "Slide 2. The problem: mid-sized manufacturers lose production hours to unplanned equipment failure and find out days later.",
  "Slide 4. The product: Northstar ships B2B infrastructure software that instruments plant equipment and bills enterprise customers on annual contracts.",
  "Slide 6. Customers: eleven enterprise customers, contracted annually, with the largest accounting for 64 percent of contracted revenue.",
  "Slide 8. Traction: annual recurring revenue reached USD 2.4m in August 2026, up from USD 1.8m in January 2026.",
  `Slide 11. Cash position: nine weeks of runway remain at the current burn. ${PRIVATE_MARKER}`,
];

const CONFIGURATION = EmbeddingConfigurationSchema.parse({
  ...QWEN3_EMBEDDING_CONFIGURATION,
  providerCode: "fake",
  runtime: "IN_PROCESS_FAKE",
  modelCode: "fake/deterministic-1024",
  modelRevision: null,
  configurationVersion: "capital-q-test-embedding-1024-v1",
  maxInputCharacters: 32_000,
  maxBatchCharacters: 320_000,
});

const QUESTIONS: readonly string[] = [
  "Analyse Northstar.",
  "What worries you most?",
  "What don't we know?",
  "What changed since January?",
];

function scripted(answer: string) {
  return {
    kind: "JSON" as const,
    value: {
      answer,
      responseShape: "ANALYTICAL",
      findings: [],
      missingEvidence: ["Twelve-month retention is not established."],
      contradictions: [],
      insufficientEvidence: false,
      recommendation: null,
      clarifyingQuestions: [],
      declined: false,
      companyFindings: [
        {
          dimension: "TRACTION",
          type: "OBSERVATION",
          statement:
            "Annual recurring revenue is recorded at USD 2.4m for August 2026.",
          truthClass: "USER_CLAIM",
          confidence: "MODERATE",
          citations: ["F1"],
          assumptions: [],
        },
        {
          dimension: "CUSTOMERS",
          type: "RISK",
          statement:
            "One customer accounts for 64 percent of contracted revenue, so losing it would remove most of the contracted base.",
          truthClass: "USER_CLAIM",
          confidence: "MODERATE",
          citations: ["F2"],
          assumptions: [],
        },
        {
          // Rejected on the way out: no authorised fact supports it (§89).
          dimension: "TEAM",
          type: "FACT",
          statement: "Northstar has 80 employees.",
          truthClass: "VERIFIED",
          confidence: "HIGH",
          citations: [],
          assumptions: [],
        },
      ],
      coverage: [{ dimension: "TRACTION", coverage: "DOCUMENT_SUPPORTED" }],
      materialChanges: [],
    },
    usage: { inputTokens: 1_200, cachedInputTokens: 0, outputTokens: 220 },
  };
}

function readout(
  question: string,
  result: CompanyIntelligenceResult | null,
  reply: string,
): void {
  console.log(`\n  Q: ${question}`);
  if (result === null) {
    console.log("    (the specialist did not run for this turn)");
    return;
  }
  const byType = Object.entries(result.telemetry.findingCountsByType)
    .map(([type, count]) => `${type}=${String(count)}`)
    .join(" ");
  console.log(`    specialist        ${result.specialistVersion}`);
  console.log(`    blocked           ${result.blocked ?? "no"}`);
  console.log(
    `    findings          ${String(result.findings.length)} (${byType})`,
  );
  console.log(
    `    evidence refs     ${String(result.telemetry.evidenceRefCount)}`,
  );
  console.log(
    `    contradictions    ${String(result.telemetry.contradictionCount)}   gaps ${String(result.telemetry.gapCount)}   uncertainties ${String(result.telemetry.uncertaintyCount)}`,
  );
  console.log(
    `    stale facts       ${String(result.telemetry.staleFactCount)}   rejected findings ${String(result.telemetry.rejectedFindingCount)}   rejected citations ${String(result.telemetry.rejectedCitationCount)}`,
  );
  console.log(
    `    model             ${result.telemetry.providerCode ?? "-"} / ${result.telemetry.modelCode ?? "-"}  calls=${String(result.telemetry.modelCalls)} retrieval=${String(result.telemetry.retrievalCalls)} knowledge=${String(result.telemetry.knowledgeReads)} tools=${String(result.telemetry.toolCalls)}`,
  );
  console.log(
    `    prompt            ${result.telemetry.promptBundleVersion ?? "-"}  ${String(result.telemetry.promptCharacters)} chars  ${String(result.telemetry.latencyMs)}ms  $${result.telemetry.costUsd.toFixed(6)}`,
  );
  console.log(`    information conf. ${result.informationConfidence}`);
  console.log(
    `    coverage          ${result.coverage.map((c) => `${c.dimension}:${c.coverage}`).join(" ") || "-"}`,
  );
  // The reply is what a person would read, so it is shown — and checked
  // for the private marker before it is, because a smoke that leaked one
  // would be worse than no smoke.
  const safe = reply.includes(PRIVATE_MARKER)
    ? "!! REDACTED: the reply contained the private fixture marker !!"
    : reply.replace(/\s+/g, " ").slice(0, 400);
  console.log(`    Q said            ${safe}`);
}

export async function main(argv: readonly string[]): Promise<number> {
  const live = argv.includes("--live");
  const db = createRequestDatabaseClient(
    parseDatabaseConfig({
      NODE_ENV: "development",
      CAPITAL_Q_ENV: "local",
      DATABASE_URL:
        process.env["DATABASE_URL"] ??
        "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
      DATABASE_POOL_MAX: "8",
      DATABASE_CONNECT_TIMEOUT_SECONDS: "5",
    }),
  );

  let world: QEvalWorld | undefined;
  let seam: SpecialistQAnswer | undefined;
  const w = (): QEvalWorld => {
    if (world === undefined) throw new Error("world not created");
    return world;
  };
  let documentId = "";

  try {
    const embeddings = createEmbeddingService({
      provider: createFakeEmbeddingProvider({ configuration: CONFIGURATION }),
    });
    const repositories = {
      ...createPostgresQKnowledgeRepositories(),
      embeddings: createPostgresChunkEmbeddingRepository(),
    };
    const hydration = createPostgresChunkHydration();
    const retrieval = createAuthorisedRetrievalService({
      sql: db.sql,
      lexical: createPostgresLexicalSearch(),
      semantic: createPostgresSemanticSearch(),
      hydration,
      embeddings,
    });
    const knowledgeQuery = createKnowledgeQueryService({
      sql: db.sql,
      knowledge: createPostgresKnowledgeRepository(),
    });

    world = await createQEvalWorld({
      db,
      providerMode: live ? "LIVE" : "FAKE",
      retrieval: (() => {
        const wired = createQEvidenceRetrieval({
          sql: db.sql,
          repositories: new Proxy({} as never, {
            get: (_t, key: string) =>
              (w().repositories as unknown as Record<string, unknown>)[key],
          }),
          retrieval,
          hydration,
          knowledge: knowledgeQuery,
        });
        return { port: wired.port, context: wired.context };
      })(),
      specialist: (delegate) => {
        const specialist = createCompanyIntelligenceSpecialist({
          gateway: { execute: (req, opts) => w().gateway.execute(req, opts) },
          canonical: createToolCanonicalPort(
            new Proxy({} as never, {
              get: (_t, key: string) =>
                (w().toolPort as unknown as Record<string, unknown>)[key],
            }),
          ),
          knowledge: createKnowledgeCompanyPort(knowledgeQuery),
          evidence: createRetrievalEvidencePort(retrieval),
          sensitivity: { kind: "DECLARED_SYNTHETIC", sensitivity: "PUBLIC" },
        });
        seam = createSpecialistQAnswer({
          specialist,
          delegate,
          repositories: new Proxy({} as never, {
            get: (_t, key: string) =>
              (w().repositories as unknown as Record<string, unknown>)[key],
          }),
          sql: db.sql,
          transactions: db.transactions,
        });
        return seam;
      },
    });

    const [company] = await db.sql<{ organisation_id: string }[]>`
      select organisation_id from core.companies where id = ${w().ids.companyNorthwind}`;
    const orgId = company?.organisation_id;
    if (orgId === undefined) throw new Error("company organisation missing");
    const founderUserId = w().people.FOUNDER.userId;
    documentId = randomUUID();
    const versionId = randomUUID();
    const runId = randomUUID();
    const extractionId = randomUUID();
    const setId = randomUUID();

    await db.transactions.run(async (tx) => {
      await tx.sql`insert into evidence.documents (id, tenant_id, company_id, owner_organisation_id, document_type, title, visibility_scope, sensitivity_class, created_by_user_id)
        values (${documentId}, ${w().ids.tenantC}, ${w().ids.companyNorthwind}, ${orgId}, 'PITCH_DECK', 'Northstar Seed Deck', 'founder_private', 'CONFIDENTIAL', ${founderUserId})`;
      await tx.sql`insert into evidence.document_versions (id, tenant_id, document_id, version_number, storage_bucket, storage_key, original_filename, mime_type, size_bytes, sha256, uploaded_by_user_id, processing_status, text_extraction_status)
        values (${versionId}, ${w().ids.tenantC}, ${documentId}, 1, 'cq-documents-private', ${`raw/${w().ids.tenantC}/${versionId.replace(/-/g, "")}`}, 'deck.pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation', 4096, ${"c".repeat(64)}, ${founderUserId}, 'COMPLETED', 'COMPLETED')`;
      await tx.sql`update evidence.documents set current_version_id = ${versionId} where id = ${documentId}`;
      await tx.sql`insert into evidence.document_processing_runs (id, document_version_id, pipeline_version, status, started_at, completed_at, chunking_version)
        values (${runId}, ${versionId}, ${PIPELINE}, 'COMPLETED', now(), now(), 'q-chunking-v1')`;
      await tx.sql`insert into evidence.document_extractions (id, tenant_id, owner_organisation_id, document_id, document_version_id, processing_run_id, schema_version, extractor_id, extractor_version, pipeline_version, artifact_bucket, artifact_key, artifact_sha256, artifact_bytes, block_count, visibility_scope, sensitivity_class)
        values (${extractionId}, ${w().ids.tenantC}, ${orgId}, ${documentId}, ${versionId}, ${runId}, 1, 'ooxml_pptx', '1.0.0', ${PIPELINE}, 'cq-extractions-private', ${`extractions/${w().ids.tenantC}/${versionId}/${runId}.json`}, ${"d".repeat(64)}, 1024, ${SLIDES.length}, 'founder_private', 'CONFIDENTIAL')`;
      await tx.sql`insert into q_knowledge.chunk_sets (id, tenant_id, owner_organisation_id, document_id, document_version_id, extraction_id, subject_type, subject_id, extractor_id, extractor_version, chunking_strategy, chunking_version, visibility_scope, sensitivity_class, status, chunk_count, token_estimate)
        values (${setId}, ${w().ids.tenantC}, ${orgId}, ${documentId}, ${versionId}, ${extractionId}, 'COMPANY', ${w().ids.companyNorthwind}, 'ooxml_pptx', '1.0.0', 'slide', 'q-chunking-v1', 'founder_private', 'CONFIDENTIAL', 'ACTIVE', ${SLIDES.length}, 400)`;
      for (const [at, text] of SLIDES.entries()) {
        const chunkId = randomUUID();
        await tx.sql`insert into q_knowledge.chunks (id, tenant_id, chunk_set_id, document_version_id, subject_type, subject_id, chunk_index, role, chunk_kind, content, content_sha256, token_estimate, block_index_start, block_index_end, locator, visibility_scope, sensitivity_class)
          values (${chunkId}, ${w().ids.tenantC}, ${setId}, ${versionId}, 'COMPANY', ${w().ids.companyNorthwind}, ${at}, 'LEAF', 'slide', ${text}, ${chunkId.replace(/-/g, "").padEnd(64, "0")}, 60, ${at}, ${at}, ${tx.sql.json({ slide: at * 2 + 2 })}::jsonb, 'founder_private', 'CONFIDENTIAL')`;
      }
    });

    await createEmbeddingPersistenceService({
      sql: db.sql,
      transactions: db.transactions,
      repositories,
      embeddings,
    }).backfillMissing({ tenantId: w().ids.tenantC, limit: 100 });

    console.log("Company Intelligence smoke — synthetic Northstar");
    console.log(`  provider mode     ${live ? "LIVE" : "FAKE (scripted)"}`);
    console.log(`  providers         ${w().providerCodes.join(", ")}`);
    console.log(`  firewall policy   ${w().firewallPolicyVersion}`);
    console.log(`  orchestration     ${w().orchestrationVersion}`);

    const founder = w().people.FOUNDER;
    let conversationId: QConversationId | null = null;
    for (const question of QUESTIONS) {
      if (!live) {
        w().setScript([
          scripted("Here is what the recorded evidence supports."),
        ]);
      }
      const correlationId = `cor_${randomUUID()}` as never;
      const created = await w().runtime.createRun({
        actor: founder.actor,
        input: {
          capability: "INVESTIGATE",
          message: { text: question },
          modality: "TEXT",
          subjects: [{ kind: "COMPANY", companyId: w().ids.companyNorthwind }],
          ...(conversationId === null ? {} : { conversationId }),
        },
        idempotencyKey: `qci-smoke-${randomUUID()}`,
        correlationId,
      });
      await w()
        .orchestrator.start({
          actor: founder.actor,
          runId: created.run.id,
          correlationId,
        })
        .catch(() => undefined);
      const messages = await w().repositories.messages.listForRun(
        db.sql,
        founder.actor.tenantId,
        created.run.id,
        16,
      );
      conversationId = messages[0]?.conversationId ?? conversationId;
      readout(
        question,
        seam?.lastResult() ?? null,
        messages
          .filter((m) => m.role === "Q")
          .map((m) => m.content)
          .join(" "),
      );
    }

    console.log("\n  one conversation, four investigations, one Q.");
    return 0;
  } finally {
    if (world !== undefined) {
      // Cleanup failures are REPORTED, never swallowed. A smoke that leaves
      // synthetic rows behind quietly is worse than one that fails: the
      // next run of the pgTAP suite counts them and blames the schema.
      let cleaned = true;
      await db.transactions
        .run(async (tx) => {
          await tx.sql`delete from q_knowledge.embeddings where tenant_id = ${w().ids.tenantC}`;
          await tx.sql`update q_knowledge.chunk_sets set status = 'REVOKED', invalidated_at = now() where tenant_id = ${w().ids.tenantC}`;
          await tx.sql`update q_knowledge.chunks set status = 'REVOKED', invalidated_at = now() where tenant_id = ${w().ids.tenantC}`;
          await tx.sql`delete from q_knowledge.chunks where tenant_id = ${w().ids.tenantC}`;
          await tx.sql`delete from q_knowledge.chunk_sets where tenant_id = ${w().ids.tenantC}`;
          await tx.sql`alter table evidence.document_extractions disable trigger document_extractions_immutable`;
          await tx.sql`delete from evidence.document_extractions where tenant_id = ${w().ids.tenantC}`;
          await tx.sql`alter table evidence.document_extractions enable trigger document_extractions_immutable`;
          await tx.sql`update evidence.documents set current_version_id = null where id = ${documentId}`;
          await tx.sql`delete from evidence.document_processing_runs where document_version_id in (select id from evidence.document_versions where document_id = ${documentId})`;
          await tx.sql`alter table evidence.document_versions disable trigger document_versions_immutable`;
          await tx.sql`delete from evidence.document_versions where document_id = ${documentId}`;
          await tx.sql`alter table evidence.document_versions enable trigger document_versions_immutable`;
          await tx.sql`delete from evidence.documents where id = ${documentId}`;
        })
        .catch((error: unknown) => {
          cleaned = false;
          console.error("  cleanup failed (evidence/knowledge rows):", error);
        });
      await world.close().catch((error: unknown) => {
        cleaned = false;
        console.error("  cleanup failed (world):", error);
      });
      if (!cleaned) {
        console.error(
          "  synthetic rows may remain in the local database. Run pnpm db:reset before pnpm test:rls.",
        );
      }
    }
    await db.close();
  }
}

const exitCode = await main(process.argv.slice(2));
process.exit(exitCode);
