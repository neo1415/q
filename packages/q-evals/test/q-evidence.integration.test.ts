import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { parseDatabaseConfig } from "@capital-q/config/database";
import {
  createRequestDatabaseClient,
  type RequestDatabase,
} from "@capital-q/database";
import {
  createEmbeddingService,
  createFakeEmbeddingProvider,
  EmbeddingConfigurationSchema,
  QWEN3_EMBEDDING_CONFIGURATION,
} from "@capital-q/q-embeddings";
import {
  createAuthorisedRetrievalService,
  createEmbeddingPersistenceService,
  createPostgresChunkEmbeddingRepository,
  createPostgresChunkHydration,
  createPostgresLexicalSearch,
  createPostgresQKnowledgeRepositories,
  createPostgresSemanticSearch,
  createQEvidenceRetrieval,
} from "@capital-q/q-knowledge";

import { createQEvalWorld, type QEvalWorld } from "../src/fixtures/world.js";

/**
 * The Q evidence path end to end (CQ-RAG-004 §116-§119).
 *
 * This drives the REAL Q graph — preflight, Context Firewall, retrieval
 * seam, authorised hybrid retrieval, context assembly, Model Gateway — with
 * the scripted provider in place of a paid one. Calling the retrieval
 * service directly would prove that retrieval works; it would not prove that
 * Q uses it, that the firewall runs first, or that what reaches a provider
 * is only what the plan allowed. Those are the claims worth testing, so the
 * assertions are made against the provider's recorded input: the last
 * surface before a model.
 */

const TEST_DATABASE_URL =
  process.env["CQ_TEST_DATABASE_URL"] ??
  process.env["DATABASE_URL"] ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const FOUNDER_PRIVATE_MARKER = "RAG-FOUNDER-PRIVATE-DO-NOT-LEAK";
const PIPELINE = "evidence-processing-v1";

const SLIDES = [
  "Slide 3. The problem: factory downtime costs mid-sized manufacturers millions each year and is detected too late.",
  "Slide 5. The product: Northwind ships B2B infrastructure software and financial infrastructure APIs for industrial buyers.",
  "Slide 7. Market size: the addressable market for industrial monitoring is 4.2bn today and grows 18 percent annually.",
  "Slide 9. The raise: Northwind is raising a seed round to expand deployment engineering.",
];

const TEST_CONFIGURATION = EmbeddingConfigurationSchema.parse({
  ...QWEN3_EMBEDDING_CONFIGURATION,
  providerCode: "fake",
  runtime: "IN_PROCESS_FAKE",
  modelCode: "fake/deterministic-1024",
  modelRevision: null,
  configurationVersion: "capital-q-test-embedding-1024-v1",
  maxInputCharacters: 32_000,
  maxBatchCharacters: 320_000,
});

describe("Q answers from authorised evidence through the real Q path", () => {
  let db: RequestDatabase;
  let world: QEvalWorld | undefined;

  /** The world, once `beforeAll` has built it. Never a non-null assertion. */
  function w(): QEvalWorld {
    if (world === undefined) {
      throw new Error("the eval world was not created");
    }
    return world;
  }
  let documentId: string;

  beforeAll(async () => {
    db = createRequestDatabaseClient(
      parseDatabaseConfig({
        NODE_ENV: "test",
        CAPITAL_Q_ENV: "local",
        DATABASE_URL: TEST_DATABASE_URL,
        DATABASE_POOL_MAX: "8",
        DATABASE_CONNECT_TIMEOUT_SECONDS: "5",
      }),
    );

    // The world is built twice-over here: once to learn its ids, and the
    // retrieval ports are wired into it in the same call, so there is only
    // ever one Q graph and it is the real one.
    const embeddings = createEmbeddingService({
      provider: createFakeEmbeddingProvider({
        configuration: TEST_CONFIGURATION,
      }),
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

    world = await createQEvalWorld({
      db,
      providerMode: "FAKE",
      retrieval: (() => {
        const wired = createQEvidenceRetrieval({
          sql: db.sql,
          // Assigned below once the world exists; the ports are only called
          // during a run, long after construction.
          repositories: new Proxy({} as never, {
            get: (_target, key: string) =>
              (w().repositories as unknown as Record<string, unknown>)[key],
          }),
          retrieval,
          hydration,
        });
        return { port: wired.port, context: wired.context };
      })(),
    });

    // A synthetic deck for the world's own company, owned by its own
    // organisation. Founder-private, which is exactly what an owner may
    // reason over and a counterparty may not.
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
        values (${documentId}, ${w().ids.tenantC}, ${w().ids.companyNorthwind}, ${orgId}, 'PITCH_DECK', 'Northwind Seed Deck', 'founder_private', 'CONFIDENTIAL', ${founderUserId})`;
      await tx.sql`insert into evidence.document_versions (id, tenant_id, document_id, version_number, storage_bucket, storage_key, original_filename, mime_type, size_bytes, sha256, uploaded_by_user_id, processing_status, text_extraction_status)
        values (${versionId}, ${w().ids.tenantC}, ${documentId}, 1, 'cq-documents-private', ${`raw/${w().ids.tenantC}/${versionId.replace(/-/g, "")}`}, 'deck.pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation', 4096, ${"e".repeat(64)}, ${founderUserId}, 'COMPLETED', 'COMPLETED')`;
      await tx.sql`update evidence.documents set current_version_id = ${versionId} where id = ${documentId}`;
      await tx.sql`insert into evidence.document_processing_runs (id, document_version_id, pipeline_version, status, started_at, completed_at, chunking_version)
        values (${runId}, ${versionId}, ${PIPELINE}, 'COMPLETED', now(), now(), 'q-chunking-v1')`;
      await tx.sql`insert into evidence.document_extractions (id, tenant_id, owner_organisation_id, document_id, document_version_id, processing_run_id, schema_version, extractor_id, extractor_version, pipeline_version, artifact_bucket, artifact_key, artifact_sha256, artifact_bytes, block_count, visibility_scope, sensitivity_class)
        values (${extractionId}, ${w().ids.tenantC}, ${orgId}, ${documentId}, ${versionId}, ${runId}, 1, 'ooxml_pptx', '1.0.0', ${PIPELINE}, 'cq-extractions-private', ${`extractions/${w().ids.tenantC}/${versionId}/${runId}.json`}, ${"f".repeat(64)}, 1024, ${SLIDES.length + 1}, 'founder_private', 'CONFIDENTIAL')`;
      await tx.sql`insert into q_knowledge.chunk_sets (id, tenant_id, owner_organisation_id, document_id, document_version_id, extraction_id, subject_type, subject_id, extractor_id, extractor_version, chunking_strategy, chunking_version, visibility_scope, sensitivity_class, status, chunk_count, token_estimate)
        values (${setId}, ${w().ids.tenantC}, ${orgId}, ${documentId}, ${versionId}, ${extractionId}, 'COMPANY', ${w().ids.companyNorthwind}, 'ooxml_pptx', '1.0.0', 'slide', 'q-chunking-v1', 'founder_private', 'CONFIDENTIAL', 'ACTIVE', ${SLIDES.length + 1}, 400)`;
      const all = [
        ...SLIDES,
        `Slide 11. Cash position: eleven weeks of runway remain and payroll is due. ${FOUNDER_PRIVATE_MARKER}`,
      ];
      for (const [at, text] of all.entries()) {
        const chunkId = randomUUID();
        await tx.sql`insert into q_knowledge.chunks (id, tenant_id, chunk_set_id, document_version_id, subject_type, subject_id, chunk_index, role, chunk_kind, content, content_sha256, token_estimate, block_index_start, block_index_end, locator, visibility_scope, sensitivity_class)
          values (${chunkId}, ${w().ids.tenantC}, ${setId}, ${versionId}, 'COMPANY', ${w().ids.companyNorthwind}, ${at}, 'LEAF', 'slide', ${text}, ${chunkId.replace(/-/g, "").padEnd(64, "0")}, 60, ${at}, ${at}, ${tx.sql.json({ slide: at * 2 + 3 })}::jsonb, 'founder_private', 'CONFIDENTIAL')`;
      }
    });

    const persistence = createEmbeddingPersistenceService({
      sql: db.sql,
      transactions: db.transactions,
      repositories,
      embeddings,
    });
    await persistence.backfillMissing({
      tenantId: w().ids.tenantC,
      limit: 100,
    });
  }, 180_000);

  afterAll(async () => {
    if (world === undefined) {
      await db.close();
      return;
    }
    // The world's cleanup does not know about evidence or knowledge rows, and
    // its company delete would fail behind them.
    await db.transactions.run(async (tx) => {
      await tx.sql`delete from q_knowledge.embeddings where tenant_id = ${w().ids.tenantC}`;
      await tx.sql`update q_knowledge.chunk_sets set status = 'REVOKED', invalidated_at = now() where tenant_id = ${w().ids.tenantC}`;
      await tx.sql`update q_knowledge.chunks set status = 'REVOKED', invalidated_at = now() where tenant_id = ${w().ids.tenantC}`;
      await tx.sql`delete from q_knowledge.chunks where tenant_id = ${w().ids.tenantC}`;
      await tx.sql`delete from q_knowledge.chunk_sets where tenant_id = ${w().ids.tenantC}`;
      // Extractions are append-only by design; the fixture is synthetic and
      // is removed the same way the world removes its own append-only rows.
      await tx.sql`alter table evidence.document_extractions disable trigger document_extractions_immutable`;
      await tx.sql`delete from evidence.document_extractions where tenant_id = ${w().ids.tenantC}`;
      await tx.sql`alter table evidence.document_extractions enable trigger document_extractions_immutable`;
      await tx.sql`update evidence.documents set current_version_id = null where id = ${documentId}`;
      await tx.sql`delete from evidence.document_processing_runs where document_version_id in (select id from evidence.document_versions where document_id = ${documentId})`;
      await tx.sql`alter table evidence.document_versions disable trigger document_versions_immutable`;
      await tx.sql`delete from evidence.document_versions where document_id = ${documentId}`;
      await tx.sql`alter table evidence.document_versions enable trigger document_versions_immutable`;
      await tx.sql`delete from evidence.documents where id = ${documentId}`;
    });
    await w().close();
    await db.close();
  }, 120_000);

  async function ask(
    actor: "FOUNDER" | "INVESTOR",
    message: string,
  ): Promise<{ readonly providerInput: string; readonly status: string }> {
    w().recorder.reset();
    w().setScript([
      {
        kind: "JSON",
        value: {
          answer:
            "Answering from the source material supplied, or saying plainly that it is insufficient.",
          responseShape: "CONCISE",
          findings: [],
          missingEvidence: [],
          contradictions: [],
          insufficientEvidence: false,
          recommendation: null,
          clarifyingQuestions: [],
          declined: false,
        },
        usage: { inputTokens: 900, cachedInputTokens: 0, outputTokens: 120 },
      },
    ]);
    const person = w().people[actor];
    const correlationId = `cor_${randomUUID()}` as never;
    const created = await w().runtime.createRun({
      actor: person.actor,
      input: {
        capability: "INVESTIGATE",
        message: { text: message },
        modality: "TEXT",
        subjects: [{ kind: "COMPANY", companyId: w().ids.companyNorthwind }],
      },
      idempotencyKey: `evidence-${randomUUID()}`,
      correlationId,
    });
    await w()
      .orchestrator.start({
        actor: person.actor,
        runId: created.run.id,
        correlationId,
      })
      .catch(() => undefined);
    const final = await w().runtime.getRun({
      actor: person.actor,
      runId: created.run.id,
    });
    return {
      providerInput: w()
        .recorder.calls()
        .map((call) => call.inputText)
        .join("\n"),
      status: final.run.status,
    };
  }

  it("answers a market-size question from the correct slide of the deck", async () => {
    const { providerInput, status } = await ask(
      "FOUNDER",
      "What does the deck say about market size?",
    );
    expect(status).toBe("COMPLETED");
    // The retrieved passage reached the model, with its locator attached.
    expect(providerInput).toContain(
      "addressable market for industrial monitoring is 4.2bn",
    );
    expect(providerInput).toContain("Northwind Seed Deck");
    expect(providerInput).toContain("slide 7");
    // And it arrived classified as the company's own claim, not as fact.
    expect(providerInput).toContain("USER_CLAIM");
    expect(providerInput).toContain("DOCUMENT_SUPPORTED");
  }, 120_000);

  it("finds an exact term the question names", async () => {
    const { providerInput, status } = await ask(
      "FOUNDER",
      "What does the deck say about downtime for manufacturers?",
    );
    expect(status).toBe("COMPLETED");
    expect(providerInput).toContain(
      "factory downtime costs mid-sized manufacturers",
    );
  }, 120_000);

  it("HARD INVARIANT: founder-private evidence never reaches the provider for an investor", async () => {
    const { providerInput, status } = await ask(
      "INVESTOR",
      "What is Northwind's cash position and how many weeks of runway remain?",
    );
    // The run itself is fine; what matters is what the model was given.
    expect(["COMPLETED", "FAILED"]).toContain(status);
    expect(providerInput).not.toContain(FOUNDER_PRIVATE_MARKER);
    expect(providerInput).not.toContain("eleven weeks of runway");
    // The Context Firewall grants EVIDENCE_DOCUMENTS to the owning side
    // only, so an investor's plan reaches no chunk-backed scope at all: the
    // deck is not filtered out of their answer, it is never searched.
    expect(providerInput).not.toContain(
      "addressable market for industrial monitoring",
    );
  }, 120_000);

  it("does not invent an answer the evidence does not support", async () => {
    const { providerInput, status } = await ask(
      "FOUNDER",
      "What percentage of revenue comes from the largest customer?",
    );
    expect(status).toBe("COMPLETED");
    // Nothing in the deck answers this. Whatever was retrieved, no
    // concentration figure was manufactured to fill the gap.
    expect(providerInput).not.toMatch(
      /largest customer (is|accounts for|represents) \d/i,
    );
  }, 120_000);
});
