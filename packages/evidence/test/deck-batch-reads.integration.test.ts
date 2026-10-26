import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { parseDatabaseConfig } from "@capital-q/config/database";
import { DECK_SECTIONS } from "@capital-q/contracts";
import {
  createRequestDatabaseClient,
  createRoundTripCounter,
  withRoundTripCounter,
  type RequestDatabase,
  type TransactionContext,
} from "@capital-q/database";

import { createPostgresDataRoom } from "../src/index.js";

/**
 * Coordinator 2026-10-26 (live trace: the fit's top read each shown
 * company's deck and its reading one query at a time). currentDecks and
 * extractionsFor run the very query currentDeck and extractionFor run, per
 * key, in one round trip: the same deck per company (the newest active,
 * never a blocked version), the same newest reading per version.
 */

const TEST_DATABASE_URL =
  process.env["CQ_TEST_DATABASE_URL"] ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

class Rollback extends Error {}

describe("deck reads for many companies against local PostgreSQL", () => {
  let db: RequestDatabase;

  beforeAll(() => {
    db = createRequestDatabaseClient(
      parseDatabaseConfig({
        NODE_ENV: "test",
        CAPITAL_Q_ENV: "local",
        DATABASE_URL: TEST_DATABASE_URL,
        DATABASE_POOL_MAX: "2",
        DATABASE_CONNECT_TIMEOUT_SECONDS: "5",
      }),
    );
  });
  afterAll(async () => {
    await db.close();
  });

  async function company(tx: TransactionContext, label: string) {
    const { sql } = tx;
    const tenantId = randomUUID();
    const organisationId = randomUUID();
    await sql`insert into identity.tenants (id, name) values (${tenantId}, ${label})`;
    await sql`insert into identity.organisations (id, tenant_id, organisation_type, display_name, slug)
      values (${organisationId}, ${tenantId}, 'company', ${label}, ${`dk-${organisationId.slice(0, 8)}`})`;
    await sql`insert into identity.tenant_organisations (tenant_id, organisation_id) values (${tenantId}, ${organisationId})`;
    const authUserId = randomUUID();
    await sql`insert into auth.users (id) values (${authUserId})`;
    const [profile] = await sql<
      { id: string }[]
    >`select id from identity.user_profiles where auth_user_id = ${authUserId}`;
    if (profile === undefined) throw new Error("profile trigger did not run");
    const companyId = randomUUID();
    await sql`insert into core.companies (id, tenant_id, organisation_id, canonical_name, slug)
      values (${companyId}, ${tenantId}, ${organisationId}, ${label}, ${`dk-${companyId.slice(0, 8)}`})`;
    return { tenantId, organisationId, companyId, userId: profile.id };
  }

  async function deck(
    tx: TransactionContext,
    owner: Awaited<ReturnType<typeof company>>,
    options: {
      scan: "CLEAN" | "BLOCKED";
      updatedAt: string;
      readings?: number;
    },
  ) {
    const { sql } = tx;
    const documentId = randomUUID();
    const versionId = randomUUID();
    await sql`insert into evidence.documents (id, tenant_id, company_id, owner_organisation_id, document_type, title, created_by_user_id, updated_at)
      values (${documentId}, ${owner.tenantId}, ${owner.companyId}, ${owner.organisationId}, 'PITCH_DECK', 'Deck', ${owner.userId}, ${options.updatedAt}::timestamptz)`;
    await sql`insert into evidence.document_versions (id, tenant_id, document_id, version_number, storage_bucket, storage_key, original_filename, mime_type, size_bytes, sha256, malware_scan_status, uploaded_by_user_id)
      values (${versionId}, ${owner.tenantId}, ${documentId}, 1, 'evidence', ${`decks/${versionId}.pdf`}, 'deck.pdf', 'application/pdf', 1000, ${"a".repeat(64)}, ${options.scan}, ${owner.userId})`;
    await sql`update evidence.documents set current_version_id = ${versionId}, updated_at = ${options.updatedAt}::timestamptz where id = ${documentId}`;
    for (let reading = 1; reading <= (options.readings ?? 0); reading += 1) {
      await sql`insert into evidence.deck_extractions (tenant_id, company_id, document_id, document_version_id, prompt_version, schema_version, reading_number, sections)
        values (${owner.tenantId}, ${owner.companyId}, ${documentId}, ${versionId}, 1, 1, ${reading},
                ${sql.json(DECK_SECTIONS.map((section) => ({ section, status: "ABSENT", summary: `reading ${String(reading)}`, pages: [], facts: [], confidence: "LOW" })))})`;
    }
    return { documentId, versionId };
  }

  it("reads the decks and their readings of many companies in one round trip each, as one by one", async () => {
    let completed = false;
    try {
      await db.transactions.run(async (tx) => {
        const a = await company(tx, "Deck A");
        const b = await company(tx, "Deck B");
        const c = await company(tx, "Deck C");
        // A: two decks; the newer one is current. B: its only deck is blocked.
        await deck(tx, a, {
          scan: "CLEAN",
          updatedAt: "2026-10-01T00:00:00Z",
          readings: 1,
        });
        const newer = await deck(tx, a, {
          scan: "CLEAN",
          updatedAt: "2026-10-05T00:00:00Z",
          readings: 2,
        });
        await deck(tx, b, {
          scan: "BLOCKED",
          updatedAt: "2026-10-03T00:00:00Z",
        });
        const store = createPostgresDataRoom();
        const ids = [a.companyId, b.companyId, c.companyId];

        const counter = createRoundTripCounter();
        const decks = await withRoundTripCounter(counter, () =>
          store.currentDecks(tx.sql, ids),
        );
        const versions = [...decks.values()].map((d) => d.versionId);
        const readings = await withRoundTripCounter(counter, () =>
          store.extractionsFor(tx.sql, [...versions, randomUUID()]),
        );
        expect(counter.count).toBe(2);

        for (const id of ids) {
          expect(decks.get(id) ?? null, id).toEqual(
            await store.currentDeck(tx.sql, id),
          );
        }
        expect(decks.get(a.companyId)?.versionId).toBe(newer.versionId);
        expect(decks.has(b.companyId)).toBe(false);
        for (const versionId of versions) {
          expect(readings.get(versionId) ?? null).toEqual(
            await store.extractionFor(tx.sql, versionId),
          );
        }
        expect(readings.get(newer.versionId)?.readingNumber).toBe(2);
        completed = true;
        throw new Rollback();
      });
    } catch (error: unknown) {
      if (!(error instanceof Rollback)) throw error;
    }
    expect(completed).toBe(true);
  });
});
