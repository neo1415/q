import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { parseDatabaseConfig } from "@capital-q/config/database";
import {
  createRequestDatabaseClient,
  type RequestDatabase,
  type TransactionContext,
} from "@capital-q/database";
import {
  createPostgresChunkHydration,
  createPostgresLexicalSearch,
} from "@capital-q/q-knowledge";

import {
  buildQIqCorpus,
  measureQIqRetrieval,
  renderQIqRetrievalReport,
  serviceQIqRetrieve,
  type QIqChunk,
  type QIqRetrievalReport,
} from "../src/retrieval/q-iq-retrieval.js";

/**
 * The step-5 recall@8 measurement over REAL Postgres full-text search: the
 * Q-IQ corpus seeded as documents and chunks in a fresh tenant (rolled
 * back), searched by the production lexical adapter (`english` tsvector,
 * OR-ed lexemes, `ts_rank`) and hydrated by the production hydration SQL.
 * The in-memory test approximates this; this one is the number to quote.
 */

const TEST_DATABASE_URL =
  process.env["CQ_TEST_DATABASE_URL"] ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const PIPELINE = "evidence-processing-v1";

class Rollback extends Error {}

async function seedQIq(
  tx: TransactionContext,
  chunks: readonly QIqChunk[],
): Promise<string> {
  const tenantId = randomUUID();
  const orgId = randomUUID();
  const authUserId = randomUUID();
  await tx.sql`insert into identity.tenants (id, name) values (${tenantId}, 'Q-IQ retrieval')`;
  await tx.sql`insert into identity.organisations (id, tenant_id, organisation_type, display_name, slug)
    values (${orgId}, ${tenantId}, 'company', 'Q-IQ org', ${`qiq-org-${orgId.slice(0, 8)}`})`;
  await tx.sql`insert into identity.tenant_organisations (tenant_id, organisation_id) values (${tenantId}, ${orgId})`;
  await tx.sql`insert into auth.users (id) values (${authUserId})`;
  const [profile] = await tx.sql<
    { id: string }[]
  >`select id from identity.user_profiles where auth_user_id = ${authUserId}`;
  if (profile === undefined) throw new Error("profile trigger did not run");

  for (const subjectId of new Set(chunks.map((chunk) => chunk.subjectId))) {
    await tx.sql`insert into core.companies (id, tenant_id, organisation_id, canonical_name, slug)
      values (${subjectId}, ${tenantId}, ${orgId}, ${`Q-IQ ${subjectId.slice(0, 8)}`}, ${`qiq-${subjectId.slice(0, 8)}-${tenantId.slice(0, 4)}`})`;
  }
  const documents = new Map<string, QIqChunk[]>();
  for (const chunk of chunks) {
    const list = documents.get(chunk.documentId) ?? [];
    list.push(chunk);
    documents.set(chunk.documentId, list);
  }
  for (const [documentId, members] of documents) {
    const first = members[0];
    if (first === undefined) continue;
    const versionId = randomUUID();
    const runId = randomUUID();
    const extractionId = randomUUID();
    const setId = randomUUID();
    await tx.sql`insert into evidence.documents (id, tenant_id, company_id, owner_organisation_id, document_type, title, visibility_scope, sensitivity_class, created_by_user_id)
      values (${documentId}, ${tenantId}, ${first.subjectId}, ${orgId}, 'PITCH_DECK', ${first.documentTitle}, 'network_visible', 'NETWORK_VISIBLE', ${profile.id})`;
    await tx.sql`insert into evidence.document_versions (id, tenant_id, document_id, version_number, storage_bucket, storage_key, original_filename, mime_type, size_bytes, sha256, uploaded_by_user_id, processing_status, text_extraction_status)
      values (${versionId}, ${tenantId}, ${documentId}, 1, 'cq-documents-private', ${`raw/${tenantId}/${versionId.replace(/-/g, "")}`}, 'deck.pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation', 2048, ${"a".repeat(64)}, ${profile.id}, 'COMPLETED', 'COMPLETED')`;
    await tx.sql`update evidence.documents set current_version_id = ${versionId}, status = 'ACTIVE' where id = ${documentId}`;
    await tx.sql`insert into evidence.document_processing_runs (id, document_version_id, pipeline_version, status, started_at, completed_at)
      values (${runId}, ${versionId}, ${PIPELINE}, 'COMPLETED', now(), now())`;
    await tx.sql`insert into evidence.document_extractions (id, tenant_id, owner_organisation_id, document_id, document_version_id, processing_run_id, schema_version, extractor_id, extractor_version, pipeline_version, artifact_bucket, artifact_key, artifact_sha256, artifact_bytes, block_count, visibility_scope, sensitivity_class)
      values (${extractionId}, ${tenantId}, ${orgId}, ${documentId}, ${versionId}, ${runId}, 1, 'ooxml_pptx', '1.0.0', ${PIPELINE}, 'cq-extractions-private', ${`extractions/${tenantId}/${versionId}/${runId}.json`}, ${"c".repeat(64)}, 512, ${members.length}, 'network_visible', 'NETWORK_VISIBLE')`;
    await tx.sql`insert into q_knowledge.chunk_sets (id, tenant_id, owner_organisation_id, document_id, document_version_id, extraction_id, subject_type, subject_id, extractor_id, extractor_version, chunking_strategy, chunking_version, visibility_scope, sensitivity_class, status, invalidated_at, chunk_count, token_estimate)
      values (${setId}, ${tenantId}, ${orgId}, ${documentId}, ${versionId}, ${extractionId}, 'COMPANY', ${first.subjectId}, 'ooxml_pptx', '1.0.0', 'slide', 'q-chunking-v1', 'network_visible', 'NETWORK_VISIBLE', 'ACTIVE', null, ${members.length}, 100)`;
    for (const [at, chunk] of members.entries()) {
      await tx.sql`insert into q_knowledge.chunks (id, tenant_id, chunk_set_id, document_version_id, subject_type, subject_id, parent_chunk_id, chunk_index, role, chunk_kind, content, content_sha256, token_estimate, block_index_start, block_index_end, locator, visibility_scope, sensitivity_class)
        values (${chunk.chunkId}, ${tenantId}, ${setId}, ${versionId}, 'COMPANY', ${chunk.subjectId}, null, ${at}, 'LEAF', 'slide', ${chunk.content}, ${chunk.chunkId.replace(/-/g, "").padEnd(64, "0")}, 20, ${at}, ${at}, ${tx.sql.json({ slide: at + 1 })}::jsonb, 'network_visible', 'NETWORK_VISIBLE')`;
    }
  }
  return tenantId;
}

describe("Q-IQ retrieval recall at 8 over Postgres FTS (step 5)", () => {
  let db: RequestDatabase;

  beforeAll(() => {
    db = createRequestDatabaseClient(
      parseDatabaseConfig({
        NODE_ENV: "test",
        CAPITAL_Q_ENV: "local",
        DATABASE_URL: TEST_DATABASE_URL,
        DATABASE_POOL_MAX: "4",
        DATABASE_CONNECT_TIMEOUT_SECONDS: "5",
      }),
    );
  });

  afterAll(async () => {
    await db.close();
  });

  it("v2 with the reader's binding reaches >= 95% and beats v1", async () => {
    const reports: QIqRetrievalReport[] = [];
    try {
      await db.transactions.run(async (tx) => {
        const chunks = buildQIqCorpus();
        const tenantId = await seedQIq(tx, chunks);
        const retrieve = serviceQIqRetrieve({
          sql: tx.sql,
          lexical: createPostgresLexicalSearch(),
          hydration: createPostgresChunkHydration(),
          chunks,
          tenantId,
        });
        for (const mode of ["V1_WORDS", "V2_LEDGER", "V2_READER"] as const) {
          reports.push(await measureQIqRetrieval(retrieve, mode));
        }
        throw new Rollback();
      });
    } catch (error) {
      if (!(error instanceof Rollback)) throw error;
    }
    console.log(reports.map(renderQIqRetrievalReport).join("\n"));
    const [before, ledgerOnly, after] = reports;
    expect(after?.share ?? 0).toBeGreaterThanOrEqual(0.95);
    expect(after?.share ?? 0).toBeGreaterThan(before?.share ?? 1);
    expect(ledgerOnly?.share ?? 0).toBeGreaterThan(before?.share ?? 1);
  }, 300_000);
});
