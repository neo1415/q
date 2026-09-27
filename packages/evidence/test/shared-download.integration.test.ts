import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { parseDatabaseConfig } from "@capital-q/config/database";
import {
  createRequestDatabaseClient,
  type RequestDatabase,
} from "@capital-q/database";

import {
  createSharedDocumentDownloads,
  DocumentNotFoundError,
  type PrivateDocumentDownloadAuthorizer,
} from "../src/index.js";

/**
 * R34 against PostgreSQL: a shared version is signed only when it belongs
 * to the named document in its tenant and a scanner found it clean; any
 * other pairing is the same not-found, and storage is never asked.
 */

const TEST_DATABASE_URL =
  process.env["CQ_TEST_DATABASE_URL"] ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

describe("shared document downloads against PostgreSQL", () => {
  let db: RequestDatabase;
  const signed: string[] = [];
  const storage: PrivateDocumentDownloadAuthorizer = {
    createDownloadAuthorization: (input) => {
      signed.push(input.object.key);
      return Promise.resolve({
        url: "https://storage.example.invalid/object/sign/x?token=t",
        providerExpiresAt: "2026-09-27T09:01:00.000Z",
      });
    },
  };
  const ids = {
    tenant: randomUUID(),
    otherTenant: randomUUID(),
    org: randomUUID(),
    document: randomUUID(),
    clean: randomUUID(),
    pending: randomUUID(),
  };

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
      await sql`insert into identity.tenants (id, name) values (${ids.tenant}, 'Share tenant'), (${ids.otherTenant}, 'Other tenant')`;
      await sql`insert into identity.organisations (id, tenant_id, organisation_type, display_name, slug)
        values (${ids.org}, ${ids.tenant}, 'company', 'Share org', ${`share-${ids.org.slice(0, 8)}`})`;
      await sql`insert into identity.tenant_organisations (tenant_id, organisation_id) values (${ids.tenant}, ${ids.org})`;
      const authId = randomUUID();
      await sql`insert into auth.users (id, email) values (${authId}, ${`${authId.slice(0, 8)}@share.example.invalid`})`;
      const [profile] = await sql<{ id: string }[]>`
        select id from identity.user_profiles where auth_user_id = ${authId}`;
      const user = profile?.id ?? "";
      await sql`insert into evidence.documents (id, tenant_id, owner_organisation_id, document_type, title, visibility_scope, sensitivity_class, created_by_user_id)
        values (${ids.document}, ${ids.tenant}, ${ids.org}, 'PITCH_DECK', 'Deck', 'organisation_private', 'CONFIDENTIAL', ${user})`;
      for (const [version, n, status] of [
        [ids.clean, 1, "CLEAN"],
        [ids.pending, 2, "PENDING"],
      ] as const) {
        await sql`insert into evidence.document_versions (id, tenant_id, document_id, version_number, storage_bucket, storage_key, original_filename, mime_type, size_bytes, sha256, uploaded_by_user_id, malware_scan_status)
          values (${version}, ${ids.tenant}, ${ids.document}, ${n}, 'cq-documents-private', ${`raw/${ids.tenant}/${version.replaceAll("-", "")}`},
                  'deck.pdf', 'application/pdf', 2048, ${"a".repeat(64)}, ${user}, ${status})`;
      }
    });
  });

  afterAll(async () => {
    await db.close();
  });

  it("signs only a clean version of the named document in its own tenant", async () => {
    const shared = createSharedDocumentDownloads({ sql: db.sql, storage });
    const share = {
      documentTenantId: ids.tenant,
      documentId: ids.document,
      documentVersionId: ids.clean,
      disposition: "ATTACHMENT" as const,
    };
    await expect(shared.authorizeSharedVersion(share)).resolves.toMatchObject({
      mimeType: "application/pdf",
    });
    expect(signed).toHaveLength(1);

    for (const wrong of [
      { ...share, documentVersionId: ids.pending },
      { ...share, documentTenantId: ids.otherTenant },
      { ...share, documentId: randomUUID() },
      { ...share, documentVersionId: "not-a-uuid" },
    ]) {
      await expect(shared.authorizeSharedVersion(wrong)).rejects.toBeInstanceOf(
        DocumentNotFoundError,
      );
    }
    expect(signed).toHaveLength(1);
  });
});
