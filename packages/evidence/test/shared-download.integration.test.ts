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
    notScanned: randomUUID(),
    blocked: randomUUID(),
    company: randomUUID(),
    deck: randomUUID(),
    deckVersion: randomUUID(),
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
        [ids.notScanned, 3, "NOT_SCANNED"],
        [ids.blocked, 4, "BLOCKED"],
      ] as const) {
        await sql`insert into evidence.document_versions (id, tenant_id, document_id, version_number, storage_bucket, storage_key, original_filename, mime_type, size_bytes, sha256, uploaded_by_user_id, malware_scan_status)
          values (${version}, ${ids.tenant}, ${ids.document}, ${n}, 'cq-documents-private', ${`raw/${ids.tenant}/${version.replaceAll("-", "")}`},
                  'deck.pdf', 'application/pdf', 2048, ${"a".repeat(64)}, ${user}, ${status})`;
      }
      // ADR 0042: a company's investor-audience deck that was never scanned.
      await sql`insert into core.companies (id, tenant_id, organisation_id, canonical_name, slug)
        values (${ids.company}, ${ids.tenant}, ${ids.org}, 'Unscanned Co', ${`unscanned-${ids.company.slice(0, 8)}`})`;
      await sql`insert into evidence.documents (id, tenant_id, company_id, owner_organisation_id, document_type, title, visibility_scope, sensitivity_class, created_by_user_id, download_audience)
        values (${ids.deck}, ${ids.tenant}, ${ids.company}, ${ids.org}, 'PITCH_DECK', 'Seed deck', 'organisation_private', 'CONFIDENTIAL', ${user}, 'INVESTORS')`;
      await sql`insert into evidence.document_versions (id, tenant_id, document_id, version_number, storage_bucket, storage_key, original_filename, mime_type, size_bytes, sha256, uploaded_by_user_id, malware_scan_status)
        values (${ids.deckVersion}, ${ids.tenant}, ${ids.deck}, 1, 'cq-documents-private', ${`raw/${ids.tenant}/${ids.deckVersion.replaceAll("-", "")}`},
                'deck.pdf', 'application/pdf', 2048, ${"a".repeat(64)}, ${user}, 'NOT_SCANNED')`;
      await sql`update evidence.documents set current_version_id = ${ids.deckVersion} where id = ${ids.deck}`;
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

  it("ADR 0042: a NOT_SCANNED version is handed out only under the interim policy, flagged scanned:false; never PENDING or BLOCKED, never another tenant", async () => {
    const share = {
      documentTenantId: ids.tenant,
      documentId: ids.document,
      disposition: "ATTACHMENT" as const,
    };
    const strict = createSharedDocumentDownloads({ sql: db.sql, storage });
    const interim = createSharedDocumentDownloads({
      sql: db.sql,
      storage,
      serveUnscanned: true,
    });
    const before = signed.length;
    // Default: CLEAN only.
    await expect(
      strict.authorizeSharedVersion({
        ...share,
        documentVersionId: ids.notScanned,
      }),
    ).rejects.toBeInstanceOf(DocumentNotFoundError);
    // Interim: the same caller's NOT_SCANNED version, flagged.
    await expect(
      interim.authorizeSharedVersion({
        ...share,
        documentVersionId: ids.notScanned,
      }),
    ).resolves.toMatchObject({ scanned: false });
    await expect(
      interim.authorizeSharedVersion({
        ...share,
        documentVersionId: ids.clean,
      }),
    ).resolves.toMatchObject({ scanned: true });
    // Nothing wider: PENDING, BLOCKED and another tenant stay refused.
    for (const wrong of [
      { ...share, documentVersionId: ids.pending },
      { ...share, documentVersionId: ids.blocked },
      {
        ...share,
        documentVersionId: ids.notScanned,
        documentTenantId: ids.otherTenant,
      },
    ]) {
      await expect(
        interim.authorizeSharedVersion(wrong),
      ).rejects.toBeInstanceOf(DocumentNotFoundError);
    }
    expect(signed.length - before).toBe(2);
  });

  it("ADR 0042: an unscanned investor-audience deck is found only under the interim policy, flagged; never for another tenant", async () => {
    const company = { companyTenantId: ids.tenant, companyId: ids.company };
    await expect(
      createSharedDocumentDownloads({
        sql: db.sql,
        storage,
      }).investorAudienceDeck(company),
    ).resolves.toBeNull();
    const interim = createSharedDocumentDownloads({
      sql: db.sql,
      storage,
      serveUnscanned: true,
    });
    await expect(interim.investorAudienceDeck(company)).resolves.toMatchObject({
      documentId: ids.deck,
      scanned: false,
    });
    await expect(
      interim.investorAudienceDeck({
        ...company,
        companyTenantId: ids.otherTenant,
      }),
    ).resolves.toBeNull();
  });
});
