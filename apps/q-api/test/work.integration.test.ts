import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { parseDatabaseConfig } from "@capital-q/config/database";
import {
  createRequestDatabaseClient,
  type RequestDatabase,
} from "@capital-q/database";
import { createPostgresQCheckpointStore } from "@capital-q/q-orchestrator";
import {
  ActorContextSchema,
  type ActorContext,
  type ActorContextResolver,
} from "@capital-q/security";

import type { WorkComposers } from "../src/composition/work/composers.js";
import {
  createWorkRuntime,
  type WorkRuntimeDependencies,
} from "../src/composition/work/runtime.js";
import { createPostgresWorkStore } from "../src/composition/work/store.js";
import {
  createWorkPort,
  createWorkActionBoard,
} from "../src/composition/work/actions.js";

/**
 * AUTO (ADR 0030) against the local database: the work store, the real
 * LangGraph PostgresSaver on q_runtime.checkpoint*, and a fresh runtime
 * standing in for a deploy. Chat, feed, interest and the model are fakes
 * (no provider calls); everything Q records is read back from the rows.
 */

const TEST_DATABASE_URL =
  process.env["CQ_TEST_DATABASE_URL"] ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const COMPANY = randomUUID();
const OTHER = randomUUID();
const RELATIONSHIP = randomUUID();

describe("Q's delegated work against PostgreSQL", () => {
  let db: RequestDatabase;
  let actor: ActorContext;
  const tenant = randomUUID();
  const authId = randomUUID();
  let userId = "";

  beforeAll(async () => {
    db = createRequestDatabaseClient(
      parseDatabaseConfig({
        NODE_ENV: "test",
        CAPITAL_Q_ENV: "local",
        DATABASE_URL: TEST_DATABASE_URL,
        DATABASE_POOL_MAX: "3",
        DATABASE_CONNECT_TIMEOUT_SECONDS: "5",
      }),
    );
    await db.sql`insert into identity.tenants (id, name) values (${tenant}, 'Work tenant')`;
    await db.sql`insert into auth.users (id, email) values (${authId}, ${`${authId.slice(0, 8)}@work.example.invalid`})`;
    const [profile] = await db.sql<{ id: string }[]>`
      select id from identity.user_profiles where auth_user_id = ${authId}`;
    userId = profile?.id ?? "";
    await db.sql`update identity.user_profiles set display_name = 'Ada Investor' where id = ${userId}`;
    actor = ActorContextSchema.parse({
      userId,
      tenantId: tenant,
      actorType: "HUMAN",
    });
  });

  afterAll(async () => {
    await db.close();
  });

  it("sources, opens lanes, survives a restart, interviews, reports, and stops", async () => {
    const store = createPostgresWorkStore(db.sql);
    const delegationId = await store.insertDelegation({
      owner: { tenantId: tenant, userId, organisationId: null },
      kind: "INVESTOR_OUTREACH",
      qActionId: randomUUID(),
      grant: {
        maxCompanies: 2,
        openingMessage: "Hello, I'm Q for Ada. Ada liked your pitch.",
        brief: null,
        topics: [],
        interview: { questions: ["Who are your first customers?"] },
        call: null,
      },
      expiresAt: new Date(Date.now() + 14 * 24 * 3_600_000),
      summary: "Starting.",
    });

    let connected = false;
    const posts: { key: string; body: string; envelope: unknown }[] = [];
    let founderMessages: {
      id: string;
      viaQ: boolean;
      envelope: unknown;
      from: "YOU" | "YOUR_SIDE" | "OTHER_SIDE";
      senderName: string;
      kind: "TEXT";
      text: string | null;
      attachmentTitle: null;
      sentAt: string;
    }[] = [];
    const resolver: ActorContextResolver = {
      resolveHumanContext: () =>
        Promise.resolve({ status: "RESOLVED", context: actor }),
    };
    const composers: WorkComposers = {
      shortlist: () =>
        Promise.resolve({
          picks: [
            {
              companyId: COMPANY,
              reasons: [
                {
                  reason: "Seed payments",
                  quote: "seed-stage payments company",
                },
              ],
            },
            // Not grounded: the quote is not in the material.
            {
              companyId: OTHER,
              reasons: [
                { reason: "Logistics", quote: "two hundred trucks in Kenya" },
              ],
            },
          ],
        }),
      converse: () =>
        Promise.resolve({
          reply: null,
          learned: [],
          forPerson: [],
          ready: true,
        }),
      interviewTurn: (_who, variables) =>
        Promise.resolve({
          answered: true,
          answer: variables.answerSoFar,
          followUp: null,
        }),
      report: () =>
        Promise.resolve({
          headline: "Three bank customers, by their own account.",
          howItWent: "Quick, clear answers.",
          strengths: [{ point: "Three paying banks", basis: "CLAIM" }],
          concerns: [],
          openQuestions: ["How concentrated is revenue?"],
          recommendation: "PROCEED",
          why: "Fits the mandate on what was said.",
        }),
      standInReply: () => Promise.resolve(null),
    };
    const dependencies = (): WorkRuntimeDependencies => ({
      store,
      checkpoints: createPostgresQCheckpointStore({
        connectionString: TEST_DATABASE_URL,
        poolMax: 2,
      }),
      resolver,
      authUserOf: () => Promise.resolve(authId),
      composers,
      chat: {
        readForQ: () =>
          Promise.resolve({
            side: "INVESTOR",
            connected,
            blocked: false,
            messages: founderMessages,
          }),
        send: (input) => {
          if (input.request.kind === "TEXT") {
            posts.push({
              key: input.idempotencyKey,
              body: input.request.body,
              envelope: input.qEnvelope ?? null,
            });
          }
          return Promise.resolve(null);
        },
      },
      schedule: {
        findSlots: () => Promise.reject(new Error("no calls in this plan")),
        schedule: () => Promise.reject(new Error("no calls in this plan")),
      },
      interests: {
        expressInterest: () =>
          Promise.resolve({
            interest: { relationshipId: RELATIONSHIP } as never,
            deduplicated: false,
          }),
      },
      relationships: {
        byRelationship: () =>
          Promise.resolve({
            side: "INVESTOR",
            counterpart: { kind: "COMPANY", id: COMPANY },
            status: null,
          }),
      },
      feed: () =>
        Promise.resolve([
          {
            companyId: COMPANY,
            name: "Pay Co",
            stageCode: "SEED",
            headquartersCountry: "NG",
            shortDescription: "We are a seed-stage payments company in Lagos.",
            websiteUrl: null,
            reasonCodes: [],
          },
          {
            companyId: OTHER,
            name: "Haul Co",
            stageCode: null,
            headquartersCountry: null,
            shortDescription: "Logistics marketplace with 40 trucks.",
            websiteUrl: null,
            reasonCodes: [],
          },
        ]),
      pitchTranscript: () => Promise.resolve(null),
      mandateText: () => Promise.resolve("Seed fintech in Nigeria."),
      ownCompany: () => Promise.resolve(null),
      nameOf: () => Promise.resolve("Ada Investor"),
    });

    // ADMIN (ADR 0033): with the operators' kill switch off nothing runs;
    // the delegation stays ACTIVE and the person is told it is paused.
    const paused = dependencies();
    expect(
      await createWorkRuntime({
        ...paused,
        enabled: () => Promise.resolve(false),
      }).tick(50),
    ).toBe(0);
    expect(await store.lanes(delegationId)).toEqual([]);
    expect((await store.delegation(delegationId))?.status).toBe("ACTIVE");
    const held = await db.sql<{ title: string }[]>`
      select title from communication.notifications where user_id = ${userId}`;
    expect(held.map((row) => row.title)).toEqual([
      "Q paused your delegated work",
    ]);
    await paused.checkpoints.close();

    // First process: sources and expresses interest in the grounded pick only.
    const first = dependencies();
    await createWorkRuntime(first).tick(50);
    const lanes = await store.lanes(delegationId);
    expect(lanes.map((lane) => lane.counterpart_name)).toEqual(["Pay Co"]);
    expect(lanes[0]?.stage).toBe("WAITING_ACCEPTANCE");
    expect(lanes[0]?.relationship_id).toBe(RELATIONSHIP);
    const notices = await db.sql<{ title: string; priority: string }[]>`
      select title, priority from communication.notifications
       where user_id = ${userId} order by created_at`;
    expect(notices[1]?.title).toBe("Q expressed interest in Pay Co");
    await first.checkpoints.close();

    // A deploy later: a fresh runtime and saver; the founder has accepted.
    connected = true;
    const second = dependencies();
    await createWorkRuntime(second).tick(50);
    expect(posts[0]?.body).toBe("Hello, I'm Q for Ada. Ada liked your pitch.");
    expect(posts[0]?.envelope).toEqual({
      protocol: "cq.q2q/1",
      side: "INVESTOR",
      intent: "INFO",
    });
    expect(posts[0]?.key).toBe(`work:${delegationId}:${RELATIONSHIP}:open`);
    await createWorkRuntime(second).tick(50);
    expect(posts.at(-1)?.body).toContain(
      "Question 1 of 1: Who are your first customers?",
    );

    founderMessages = [
      {
        id: randomUUID(),
        viaQ: false,
        envelope: null,
        from: "OTHER_SIDE",
        senderName: "Femi",
        kind: "TEXT",
        text: "Three banks in Lagos pay us monthly.",
        attachmentTitle: null,
        sentAt: new Date(Date.now() + 1_000).toISOString(),
      },
    ];
    await createWorkRuntime(second).tick(50);
    const [reported] = await store.lanes(delegationId);
    expect(reported?.stage).toBe("REPORT_READY");
    expect(reported?.report).toMatchObject({
      recommendation: "PROCEED",
      counterpartName: "Pay Co",
      interview: [
        {
          question: "Who are your first customers?",
          answer: "Three banks in Lagos pay us monthly.",
        },
      ],
    });
    const report = await db.sql<
      { title: string; priority: string; link_path: string }[]
    >`
      select title, priority, link_path from communication.notifications
       where user_id = ${userId} and title like 'First-stage report%'`;
    expect(report[0]?.priority).toBe("NEEDS_YOU");
    expect(report[0]?.link_path).toBe(
      `/work/${delegationId}/report/${reported?.id ?? ""}`,
    );

    // The person reads it as they would in the app, and the delegation is done.
    const port = createWorkPort({
      store,
      board: createWorkActionBoard(),
      isInvestor: () => Promise.resolve(true),
      ownCompany: () => Promise.resolve(null),
    });
    const listed = await port.list(actor);
    expect(listed[0]?.lanes[0]?.report?.recommendation).toBe("PROCEED");
    expect(listed[0]?.status).toBe("DONE");
    const detail = await port.detail(actor, delegationId);
    expect(detail?.steps.map((step) => step.words).join(" ")).toContain(
      "Q expressed your interest in Pay Co",
    );
    // Someone else's id reads as nothing.
    const stranger = ActorContextSchema.parse({
      userId: randomUUID(),
      tenantId: tenant,
      actorType: "HUMAN",
    });
    expect(await port.detail(stranger, delegationId)).toBeNull();
    expect(await port.stop(stranger, delegationId, null)).toBe(false);
    await second.checkpoints.close();
  });
});
