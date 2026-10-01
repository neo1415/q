import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { parseDatabaseConfig } from "@capital-q/config/database";
import {
  createRequestDatabaseClient,
  type RequestDatabase,
  type TransactionContext,
} from "@capital-q/database";
import type { CounterpartPersonaResult } from "@capital-q/q-core";
import type { ActorContext } from "@capital-q/security";

import { createPostgresRehearsalStore } from "../src/composition/rehearsals.js";

/**
 * REHEARSE: the rehearsal store against the real schema (migration
 * 20261111000000). Every read and write is keyed on the acting person and
 * tenant; a closed rehearsal is never written again. Rolled back.
 */

const TEST_DATABASE_URL =
  process.env["CQ_TEST_DATABASE_URL"] ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

class Rollback extends Error {}

const PERSONA: CounterpartPersonaResult = {
  summary: "A sharp investor.",
  style: "Direct.",
  temperament: { baseline: "NEUTRAL", warmsTo: [], coolsOn: [] },
  priorities: [],
  likelyQuestions: [
    { question: "What is your retention?", why: "Focus" },
    { question: "Who else is in?", why: "Signal" },
    { question: "Why now?", why: "Timing" },
  ],
  likelyAnswers: [],
  pushbacks: [],
  howToWin: [],
  dealbreakers: [],
  grounding: "THIN",
};

describe("rehearsal store (Postgres)", () => {
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

  async function person(tx: TransactionContext): Promise<ActorContext> {
    const tenantId = randomUUID();
    await tx.sql`insert into identity.tenants (id, name) values (${tenantId}, 'Rehearse test')`;
    const authUserId = randomUUID();
    await tx.sql`insert into auth.users (id) values (${authUserId})`;
    const [profile] = await tx.sql<
      { id: string }[]
    >`select id from identity.user_profiles where auth_user_id = ${authUserId}`;
    if (profile === undefined) throw new Error("profile trigger did not run");
    return {
      tenantId,
      userId: profile.id,
      actorType: "HUMAN",
    } as unknown as ActorContext;
  }

  it("keeps personas per viewer, rehearsals per person, and never writes a closed one", async () => {
    try {
      await db.transactions.run(async (tx) => {
        const store = createPostgresRehearsalStore(tx.sql);
        const me = await person(tx);
        const other = await person(tx);
        const investor = randomUUID();

        const saved = await store.savePersona(me, {
          kind: "INVESTOR_ORGANISATION",
          id: investor,
          name: "Fund",
          relationshipId: null,
          profile: PERSONA,
          sources: [{ kind: "PROFILE", label: "Fund's profile", url: null }],
          signalDigest: "digest-0001",
          webReadAt: null,
        });
        const again = await store.savePersona(me, {
          kind: "INVESTOR_ORGANISATION",
          id: investor,
          name: "Fund",
          relationshipId: null,
          profile: PERSONA,
          sources: [],
          signalDigest: "digest-0002",
          webReadAt: new Date(),
        });
        expect(again.id).toBe(saved.id);
        expect(again.signalDigest).toBe("digest-0002");
        expect(
          await store.findPersona(other, "INVESTOR_ORGANISATION", investor),
        ).toBeNull();

        const id = randomUUID();
        await store.insert(me, {
          id,
          kind: "INVESTOR_ORGANISATION",
          counterpartId: investor,
          name: "Fund",
          role: "FOUNDER",
          relationshipId: null,
          meetingId: null,
          personaProfileId: saved.id,
          persona: PERSONA,
          voice: "FEMALE",
          difficulty: "TOUGH",
          turns: [
            {
              from: "THEM",
              text: "Hi",
              at: new Date().toISOString(),
              mood: "WARM",
              sawScreen: false,
            },
          ],
        });
        expect(await store.own(other, id)).toBeNull();
        expect((await store.own(me, id))?.difficulty).toBe("TOUGH");
        const closed = await store.saveTurns(me, id, {
          turns: [],
          asked: 1,
          outcome: "STRONG_LATER",
          ended: true,
        });
        expect(closed?.outcome).toBe("STRONG_LATER");
        expect(closed?.endedAt).not.toBeNull();
        expect(
          await store.saveTurns(me, id, {
            turns: [],
            asked: 2,
            outcome: null,
            ended: false,
          }),
        ).toBeNull();
        const finished = await store.finish(me, id, {
          outcome: "STRONG_LATER",
          score: 72,
          review: null,
        });
        expect(finished?.status).toBe("FINISHED");
        expect(finished?.score).toBe(72);
        expect((await store.list(me)).map((row) => row.id)).toEqual([id]);
        expect(await store.list(other)).toEqual([]);
        throw new Rollback();
      });
    } catch (error: unknown) {
      if (!(error instanceof Rollback)) throw error;
    }
  });
});
