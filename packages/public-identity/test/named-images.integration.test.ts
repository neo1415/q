import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { parseDatabaseConfig } from "@capital-q/config/database";
import {
  createRequestDatabaseClient,
  type RequestDatabase,
} from "@capital-q/database";

import { createPostgresNamedImageStore } from "../src/index.js";

/**
 * The named-images store against local PostgreSQL: one query returns the
 * current (READY) images of exactly the subjects asked, never history and
 * never anyone else's; card scopes come only from ACTIVE cards. Everything
 * runs in a transaction that is rolled back.
 */

const TEST_DATABASE_URL =
  process.env["CQ_TEST_DATABASE_URL"] ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

class Rollback extends Error {}

describe("createPostgresNamedImageStore against local PostgreSQL", () => {
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

  it("reads only the asked subjects' READY images and ACTIVE cards", async () => {
    const store = createPostgresNamedImageStore();
    await db.transactions
      .run(async (tx) => {
        const tenant = randomUUID();
        const org = randomUUID();
        await tx.sql`insert into identity.tenants (id, name) values (${tenant}, 'Named Images')`;
        await tx.sql`insert into identity.organisations (id, tenant_id, organisation_type, display_name, slug)
          values (${org}, ${tenant}, 'company', 'named-images', ${`named-${org.slice(0, 8)}`})`;
        await tx.sql`insert into identity.tenant_organisations (tenant_id, organisation_id) values (${tenant}, ${org})`;
        const people: string[] = [];
        for (let i = 0; i < 2; i += 1) {
          const auth = randomUUID();
          await tx.sql`insert into auth.users (id) values (${auth})`;
          const [row] = await tx.sql<{ id: string }[]>`
            select id from identity.user_profiles where auth_user_id = ${auth}`;
          if (row === undefined) throw new Error("profile trigger did not run");
          people.push(row.id);
        }
        const [named, unasked] = people as [string, string];
        const company = randomUUID();
        await tx.sql`insert into core.companies (id, tenant_id, organisation_id, canonical_name, slug)
          values (${company}, ${tenant}, ${org}, 'Kivu Freight', ${`kivu-${company.slice(0, 8)}`})`;

        const image = async (input: {
          subjectType: "PERSON" | "COMPANY";
          subjectId: string;
          kind: "AVATAR" | "COVER";
          status: "READY" | "SUPERSEDED";
          key: string;
        }) => {
          const ended = input.status === "SUPERSEDED";
          await tx.sql`
            insert into core.profile_images
              (tenant_id, organisation_id, subject_type, subject_id, kind, status,
               upload_key, declared_content_type, declared_byte_size, object_key,
               width, height, byte_size, created_by_user_id, upload_expires_at,
               ready_at, ended_at)
            values
              (${tenant}, ${input.subjectType === "PERSON" ? null : org},
               ${input.subjectType}, ${input.subjectId}, ${input.kind}, ${input.status},
               ${`raw/${input.key}`}, 'image/webp', 100, ${input.key},
               400, 400, 100, ${input.subjectType === "PERSON" ? input.subjectId : named},
               now(), now(), ${ended ? new Date().toISOString() : null}::timestamptz)`;
        };
        await image({
          subjectType: "PERSON",
          subjectId: named,
          kind: "AVATAR",
          status: "SUPERSEDED",
          key: "old",
        });
        await image({
          subjectType: "PERSON",
          subjectId: named,
          kind: "AVATAR",
          status: "READY",
          key: "named-now",
        });
        await image({
          subjectType: "PERSON",
          subjectId: unasked,
          kind: "AVATAR",
          status: "READY",
          key: "unasked",
        });
        await image({
          subjectType: "COMPANY",
          subjectId: company,
          kind: "AVATAR",
          status: "READY",
          key: "logo",
        });
        await image({
          subjectType: "COMPANY",
          subjectId: company,
          kind: "COVER",
          status: "READY",
          key: "cover",
        });

        const rows = await store.readyImages(tx.sql, [
          { subjectType: "PERSON", subjectId: named },
          { subjectType: "COMPANY", subjectId: company },
          // The right id under the wrong type is someone else: nothing.
          { subjectType: "INVESTOR_ORGANISATION", subjectId: company },
        ]);
        expect(rows.map((row) => row.objectKey).sort()).toEqual(
          ["cover", "logo", "named-now"].sort(),
        );

        // No card yet: no cover scope. An ACTIVE card: its scopes.
        const subject = { subjectType: "COMPANY" as const, subjectId: company };
        expect((await store.activeCardScopes(tx.sql, [subject])).size).toBe(0);
        await tx.sql`
          insert into core.shareable_identities
            (tenant_id, organisation_id, subject_type, subject_id, public_code, field_scopes)
          values (${tenant}, ${org}, 'COMPANY', ${company}, ${`n${company.replaceAll("-", "").slice(0, 9)}`},
                  ${tx.sql.json({ cover: "network_visible" })})`;
        expect(
          (await store.activeCardScopes(tx.sql, [subject])).get(
            `COMPANY:${company}`,
          ),
        ).toEqual({ cover: "network_visible" });
        await tx.sql`update core.shareable_identities set status = 'REVOKED' where subject_id = ${company}`;
        expect((await store.activeCardScopes(tx.sql, [subject])).size).toBe(0);
        throw new Rollback();
      })
      .catch((error: unknown) => {
        if (!(error instanceof Rollback)) throw error;
      });
  });
});
