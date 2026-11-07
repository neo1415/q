import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { parseDatabaseConfig } from "@capital-q/config/database";
import {
  createRequestDatabaseClient,
  type RequestDatabase,
} from "@capital-q/database";

import {
  founderSectionsFor,
  storedFounderSections,
} from "../src/founder-sections.js";

/**
 * Owner 2026-11-07: the Overview's F9 read against the real schema, in one
 * rolled-back transaction. Only this company's founder sessions in its own
 * tenant, only the current F9 answer, never a withdrawn, superseded or
 * cancelled one, and never another step of the journey.
 */

const TEST_DATABASE_URL =
  process.env["CQ_TEST_DATABASE_URL"] ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

class Rollback extends Error {}

describe("the founder's F9 answers, read for the Overview", () => {
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

  it("returns the current F9 answers of this company only", async () => {
    await expect(
      db.transactions.run(async ({ sql: tx }) => {
        const [version] = await tx<{ id: string }[]>`
          select v.id from onboarding.definition_versions v
            join onboarding.definitions d on d.id = v.definition_id
           where d.journey_type = 'founder'
           order by v.version desc limit 1`;
        if (version === undefined) throw new Error("no founder definition");
        const tenant = randomUUID();
        const otherTenant = randomUUID();
        for (const id of [tenant, otherTenant]) {
          await tx`insert into identity.tenants (id, name) values (${id}, 'F9 read tenant')`;
        }
        const person = async (): Promise<string> => {
          const authId = randomUUID();
          await tx`insert into auth.users (id, email) values (${authId}, ${`${authId.slice(0, 8)}@f9.example.invalid`})`;
          const [profile] = await tx<{ id: string }[]>`
            select id from identity.user_profiles where auth_user_id = ${authId}`;
          return profile?.id ?? "";
        };
        const user = await person();
        // One ACTIVE session per person, journey and subject: the other
        // tenant's session is someone else's.
        const otherUser = await person();
        const company = randomUUID();
        const otherCompany = randomUUID();

        const session = async (
          tenantId: string,
          subjectId: string,
          status: "ACTIVE" | "CANCELLED",
          userId: string = user,
        ): Promise<string> => {
          const [row] = await tx<{ id: string }[]>`
            insert into onboarding.sessions
              (tenant_id, user_id, journey_type, definition_version_id,
               subject_type, subject_id, status, current_step_key)
            values (${tenantId}, ${userId}, 'founder', ${version.id},
                    'COMPANY', ${subjectId}, ${status},
                    ${status === "ACTIVE" ? "F9.problem" : null})
            returning id`;
          return row?.id ?? "";
        };
        const answer = async (
          sessionId: string,
          stepKey: string,
          text: string,
          id: string = randomUUID(),
        ): Promise<string> => {
          await tx`
            insert into onboarding.responses
              (id, session_id, step_key, response_type, response_jsonb, raw_text, source_modality)
            values (${id}, ${sessionId}, ${stepKey}, 'TEXT',
                    ${tx.json({ type: "TEXT", text })}, ${text}, 'TYPED_TEXT')`;
          return id;
        };

        const ours = await session(tenant, company, "ACTIVE");
        // Superseded: the old words are history, the new ones are current.
        // The old row links forward first (the link is deferred).
        const old = await answer(ours, "F9.problem", "Old words.");
        const replacement = randomUUID();
        await tx`update onboarding.responses set superseded_by_response_id = ${replacement} where id = ${old}`;
        await answer(ours, "F9.problem", "New words.", replacement);
        await answer(ours, "F9.solution", "We advance the claim.");
        // Withdrawn: taken back, so not shown.
        const takenBack = await answer(ours, "F9.moats", "A moat.");
        await tx`update onboarding.responses set withdrawn_at = now() where id = ${takenBack}`;
        // Not a section step: never read here.
        await answer(ours, "F1.website", "https://example.invalid");
        // "I don't know" is an answer, not content.
        await answer(ours, "F9.vision", "I don't know");
        // Another company, a cancelled session, another tenant: none read.
        await answer(
          await session(tenant, otherCompany, "ACTIVE"),
          "F9.competition",
          "Theirs.",
        );
        await answer(
          await session(tenant, company, "CANCELLED"),
          "F9.roadmap",
          "Cancelled words.",
        );
        await answer(
          await session(otherTenant, company, "ACTIVE", otherUser),
          "F9.closing",
          "Other tenant.",
        );

        const rows = await storedFounderSections(tx, {
          tenantId: tenant,
          id: company,
        });
        const sent = founderSectionsFor(rows);
        expect(rows.map((row) => row.stepKey).sort()).toEqual([
          "F9.problem",
          "F9.solution",
          "F9.vision",
        ]);
        expect(
          sent.map((section) => [section.sectionKey, section.text]),
        ).toEqual([
          ["problem", "New words."],
          ["solution", "We advance the claim."],
        ]);
        throw new Rollback();
      }),
    ).rejects.toBeInstanceOf(Rollback);
  });
});
