import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { parseDatabaseConfig } from "@capital-q/config/database";
import {
  createRequestDatabaseClient,
  type RequestDatabase,
} from "@capital-q/database";

import {
  redriveBlockedDocuments,
  redriveBlockedDocumentsAtStart,
  selectBlockedForRedrive,
  selectNotScannedForScan,
} from "../src/documents/redrive.js";

/**
 * ADR 0042 against PostgreSQL: the re-drive selects versions whose latest
 * run was BLOCKED for want of a scanner, enqueues one job each under the
 * current pipeline version, and selects nothing a second time once that
 * version has its run. Dry run enqueues nothing; REQUIRE_CLEAN refuses.
 */

const TEST_DATABASE_URL =
  process.env["CQ_TEST_DATABASE_URL"] ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

describe("re-driving documents blocked for want of a scanner", () => {
  let db: RequestDatabase;
  const tenant = randomUUID();
  const org = randomUUID();
  const document = randomUUID();
  const blocked = randomUUID();
  const completed = randomUUID();
  const notScanned = randomUUID();
  const V1 = "evidence-processing-v1";
  const V2 = "evidence-processing-v2";

  beforeAll(async () => {
    db = createRequestDatabaseClient(
      parseDatabaseConfig({
        NODE_ENV: "test",
        CAPITAL_Q_ENV: "local",
        DATABASE_URL: TEST_DATABASE_URL,
        DATABASE_POOL_MAX: "2",
        DATABASE_CONNECT_TIMEOUT_SECONDS: "5",
      }),
    );
    await db.transactions.run(async (tx) => {
      const sql = tx.sql;
      await sql`insert into identity.tenants (id, name) values (${tenant}, 'Redrive tenant')`;
      await sql`insert into identity.organisations (id, tenant_id, organisation_type, display_name, slug)
        values (${org}, ${tenant}, 'company', 'Redrive org', ${`redrive-${org.slice(0, 8)}`})`;
      await sql`insert into identity.tenant_organisations (tenant_id, organisation_id) values (${tenant}, ${org})`;
      const authId = randomUUID();
      await sql`insert into auth.users (id, email) values (${authId}, ${`${authId.slice(0, 8)}@redrive.example.invalid`})`;
      const [profile] = await sql<{ id: string }[]>`
        select id from identity.user_profiles where auth_user_id = ${authId}`;
      const user = profile?.id ?? "";
      await sql`insert into evidence.documents (id, tenant_id, owner_organisation_id, document_type, title, visibility_scope, sensitivity_class, created_by_user_id)
        values (${document}, ${tenant}, ${org}, 'PITCH_DECK', 'Deck', 'organisation_private', 'CONFIDENTIAL', ${user})`;
      for (const [version, n, scan] of [
        [blocked, 1, "PENDING"],
        [completed, 2, "CLEAN"],
        [notScanned, 3, "NOT_SCANNED"],
      ] as const) {
        await sql`insert into evidence.document_versions (id, tenant_id, document_id, version_number, storage_bucket, storage_key, original_filename, mime_type, size_bytes, sha256, uploaded_by_user_id, malware_scan_status)
          values (${version}, ${tenant}, ${document}, ${n}, 'cq-documents-private', ${`raw/${tenant}/${version.replaceAll("-", "")}`},
                  'deck.pdf', 'application/pdf', 613, ${"a".repeat(64)}, ${user}, ${scan})`;
      }
      await sql`insert into evidence.document_processing_runs (document_version_id, pipeline_version, status, error_code)
        values (${blocked}, ${V1}, 'BLOCKED', 'MALWARE_SCAN_UNAVAILABLE')`;
      await sql`insert into evidence.document_processing_runs (document_version_id, pipeline_version, status, completed_at)
        values (${completed}, ${V1}, 'COMPLETED', now())`;
    });
  });

  afterAll(async () => {
    await db.close();
  });

  const mine = <T extends { readonly documentVersionId: string }>(
    rows: readonly T[],
  ) =>
    rows.filter((row) =>
      ([blocked, completed, notScanned] as readonly string[]).includes(
        row.documentVersionId,
      ),
    );

  it("selects only the blocked version, and only under a new pipeline version", async () => {
    expect(
      mine(await selectBlockedForRedrive(db.sql, V2)).map(
        (row) => row.documentVersionId,
      ),
    ).toEqual([blocked]);
    // Under the version it was blocked by, it already has its run.
    expect(mine(await selectBlockedForRedrive(db.sql, V1))).toEqual([]);
  });

  it("refuses under REQUIRE_CLEAN; a dry run enqueues nothing; apply enqueues once; a second apply finds nothing", async () => {
    const sent: unknown[] = [];
    const queues = {
      send: (_queue: string, message: unknown) => {
        sent.push(message);
        return Promise.resolve(sent.length);
      },
    };
    const run = (
      malwarePolicy: "REQUIRE_CLEAN" | "ALLOW_UNSCANNED_WITH_WARNING",
      apply: boolean,
    ) =>
      redriveBlockedDocuments({
        sql: db.sql,
        queues,
        pipelineVersion: V2,
        malwarePolicy,
        apply,
      });

    expect((await run("REQUIRE_CLEAN", true)).kind).toBe("REFUSED");
    const dry = await run("ALLOW_UNSCANNED_WITH_WARNING", false);
    expect(dry.kind).toBe("DRY_RUN");
    expect(sent).toHaveLength(0);

    const applied = await run("ALLOW_UNSCANNED_WITH_WARNING", true);
    expect(applied.kind).toBe("APPLIED");
    const ours = sent.filter(
      (message) =>
        (message as { data: { documentVersionId: string } }).data
          .documentVersionId === blocked,
    );
    expect(ours).toHaveLength(1);
    expect(ours[0]).toMatchObject({
      tenantId: tenant,
      data: { documentVersionId: blocked, pipelineVersion: V2 },
    });

    // The worker takes the job and registers its run under V2.
    await db.sql`insert into evidence.document_processing_runs (document_version_id, pipeline_version, status)
      values (${blocked}, ${V2}, 'QUEUED')`;
    const before = sent.length;
    const again = await run("ALLOW_UNSCANNED_WITH_WARNING", true);
    expect(again.kind === "APPLIED" ? mine(again.candidates) : null).toEqual(
      [],
    );
    expect(
      sent
        .slice(before)
        .filter(
          (message) =>
            (message as { data: { documentVersionId: string } }).data
              .documentVersionId === blocked,
        ),
    ).toHaveLength(0);
  });

  it("at worker start: nothing under REQUIRE_CLEAN; under the interim policy one line, and nothing left to enqueue for an already re-driven version", async () => {
    const lines: string[] = [];
    const sent: unknown[] = [];
    const logger = {
      info: (_fields: Record<string, unknown>, message: string) => {
        lines.push(message);
      },
      warn: (_fields: Record<string, unknown>, message: string) => {
        lines.push(message);
      },
    };
    const queues = {
      send: (_queue: string, message: unknown) => {
        sent.push(message);
        return Promise.resolve(sent.length);
      },
    };
    await redriveBlockedDocumentsAtStart({
      sql: db.sql,
      queues,
      pipelineVersion: V2,
      malwarePolicy: "REQUIRE_CLEAN",
      logger,
    });
    expect(lines).toEqual([]);
    await redriveBlockedDocumentsAtStart({
      sql: db.sql,
      queues,
      pipelineVersion: V2,
      malwarePolicy: "ALLOW_UNSCANNED_WITH_WARNING",
      logger,
    });
    expect(lines).toEqual(["evidence.documents.redriven_at_start"]);
    // The blocked version already has its V2 run (previous test): not again.
    expect(
      sent.filter(
        (message) =>
          (message as { data: { documentVersionId: string } }).data
            .documentVersionId === blocked,
      ),
    ).toHaveLength(0);
  });

  it("TODO when a scanner arrives: every NOT_SCANNED version is selected for its scan", async () => {
    expect(
      mine(await selectNotScannedForScan(db.sql)).map(
        (row) => row.documentVersionId,
      ),
    ).toEqual([notScanned]);
  });
});
