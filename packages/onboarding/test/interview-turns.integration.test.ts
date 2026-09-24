import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { parseDatabaseConfig } from "@capital-q/config/database";
import { createEventRegistry, type CorrelationId } from "@capital-q/contracts";
import {
  createRequestDatabaseClient,
  type RequestDatabase,
  type TransactionContext,
  type TransactionManager,
} from "@capital-q/database";
import { createOutboxWriter } from "@capital-q/eventing";
import { UserIdSchema } from "@capital-q/security";

import { ONBOARDING_EVENTS } from "../src/events/index.js";
import {
  createOnboardingService,
  createOnboardingStepContextRegistry,
  createOnboardingSubjectResolverRegistry,
  createOnboardingUseCases,
  createOnboardingWriteTargetRegistry,
  createPostgresOnboardingDefinitionRepository,
  createPostgresOnboardingIdempotencyRepository,
  createPostgresOnboardingResponseRepository,
  createPostgresOnboardingSessionRepository,
  createPostgresOnboardingStepStateRepository,
  createPostgresOnboardingSuggestionRepository,
  OnboardingMutationConflictError,
  OnboardingRuntimeConfigurationError,
  OnboardingSessionNotFoundError,
  type OnboardingActor,
  type OnboardingService,
  type OnboardingSessionId,
} from "../src/index.js";
import { SYNTHETIC_FOUNDER_MANIFEST } from "./synthetic-manifest.js";

/**
 * CQ-QX-006: the interview thread against the real local database. Every
 * test runs in one rolled-back transaction with a savepoint-backed
 * TransactionManager, as the runtime suite does.
 */

const TEST_DATABASE_URL =
  process.env["CQ_TEST_DATABASE_URL"] ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

const CORRELATION = (): CorrelationId => `cor_${randomUUID()}`;
const registry = createEventRegistry([...ONBOARDING_EVENTS]);

class Rollback extends Error {}

type World = {
  readonly tx: TransactionContext;
  readonly service: OnboardingService;
  readonly owner: OnboardingActor;
  readonly other: OnboardingActor;
  readonly sessionId: OnboardingSessionId;
};

function nestedTransactions(tx: TransactionContext): TransactionManager {
  return {
    run: async (work) => {
      const { value } = await tx.sql.savepoint(async (inner) => ({
        value: await work({ sql: inner }),
      }));
      return value;
    },
  };
}

describe("onboarding interview thread against local PostgreSQL", () => {
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

  async function insertPerson(
    tx: TransactionContext,
  ): Promise<OnboardingActor> {
    const authUserId = randomUUID();
    await tx.sql`insert into auth.users (id) values (${authUserId})`;
    const [profile] = await tx.sql<{ id: string }[]>`
      select id from identity.user_profiles where auth_user_id = ${authUserId}`;
    if (profile === undefined) {
      throw new Error("profile trigger did not run");
    }
    return { userId: UserIdSchema.parse(profile.id), context: null };
  }

  async function withWorld(work: (world: World) => Promise<void>) {
    let completed = false;
    try {
      await db.transactions.run(async (tx) => {
        const service = createOnboardingService({
          sql: tx.sql,
          transactions: nestedTransactions(tx),
          outbox: createOutboxWriter({ registry }),
        });
        await service.publisher.publish(SYNTHETIC_FOUNDER_MANIFEST);
        const owner = await insertPerson(tx);
        const other = await insertPerson(tx);
        const started = await service.runtime.startSession({
          actor: owner,
          journeyType: "external_investor_conversion",
          idempotencyKey: randomUUID(),
          correlationId: CORRELATION(),
        });
        await work({
          tx,
          service,
          owner,
          other,
          sessionId: started.view.session.id as OnboardingSessionId,
        });
        completed = true;
        throw new Rollback();
      });
    } catch (error) {
      if (!(error instanceof Rollback)) {
        throw error;
      }
    }
    expect(completed).toBe(true);
  }

  it("appends an exchange and reads it back oldest first, both channels", async () => {
    await withWorld(async ({ service, owner, sessionId }) => {
      const first = await service.runtime.appendInterviewTurns({
        actor: owner,
        sessionId,
        turnRef: randomUUID(),
        turns: [
          {
            role: "PERSON",
            text: "We are raising a seed round.",
            stepKey: "intent",
            channel: "TEXT",
          },
          { role: "Q", text: "How much are you raising?", channel: "TEXT" },
        ],
      });
      expect(first.written).toBe(true);
      await service.runtime.appendInterviewTurns({
        actor: owner,
        sessionId,
        turnRef: randomUUID(),
        turns: [{ role: "PERSON", text: "Two million.", channel: "VOICE" }],
      });

      const all = await service.runtime.listInterviewTurns({
        actor: owner,
        sessionId,
      });
      expect(all.map((t) => [t.role, t.text, t.channel])).toEqual([
        ["PERSON", "We are raising a seed round.", "TEXT"],
        ["Q", "How much are you raising?", "TEXT"],
        ["PERSON", "Two million.", "VOICE"],
      ]);

      // The newest N, still oldest first.
      const recent = await service.runtime.listInterviewTurns({
        actor: owner,
        sessionId,
        limit: 2,
      });
      expect(recent.map((t) => t.text)).toEqual([
        "How much are you raising?",
        "Two million.",
      ]);
    });
  });

  it("a retried exchange writes nothing; the missing role of a partial one is added", async () => {
    await withWorld(async ({ tx, service, owner, sessionId }) => {
      const turnRef = randomUUID();
      const person = {
        role: "PERSON" as const,
        text: "We sell to banks.",
        channel: "VOICE" as const,
      };
      const reply = {
        role: "Q" as const,
        text: "Which banks?",
        channel: "VOICE" as const,
      };
      expect(
        (
          await service.runtime.appendInterviewTurns({
            actor: owner,
            sessionId,
            turnRef,
            turns: [person],
          })
        ).written,
      ).toBe(true);
      expect(
        (
          await service.runtime.appendInterviewTurns({
            actor: owner,
            sessionId,
            turnRef,
            turns: [person, reply],
          })
        ).written,
      ).toBe(true);
      expect(
        (
          await service.runtime.appendInterviewTurns({
            actor: owner,
            sessionId,
            turnRef,
            turns: [person, reply],
          })
        ).written,
      ).toBe(false);
      const [row] = await tx.sql<{ count: number }[]>`
        select count(*)::int as count from onboarding.interview_turns
         where session_id = ${sessionId}`;
      expect(row?.count).toBe(2);

      // A reference reused for different words is a conflict, never an overwrite.
      await expect(
        service.runtime.appendInterviewTurns({
          actor: owner,
          sessionId,
          turnRef,
          turns: [{ ...reply, text: "Which regions?" }],
        }),
      ).rejects.toBeInstanceOf(OnboardingMutationConflictError);
    });
  });

  it("another person's session is refused both ways and nothing is written", async () => {
    await withWorld(async ({ tx, service, owner, other, sessionId }) => {
      await service.runtime.appendInterviewTurns({
        actor: owner,
        sessionId,
        turnRef: randomUUID(),
        turns: [{ role: "PERSON", text: "Private words.", channel: "TEXT" }],
      });
      await expect(
        service.runtime.listInterviewTurns({ actor: other, sessionId }),
      ).rejects.toBeInstanceOf(OnboardingSessionNotFoundError);
      await expect(
        service.runtime.appendInterviewTurns({
          actor: other,
          sessionId,
          turnRef: randomUUID(),
          turns: [{ role: "Q", text: "Injected.", channel: "TEXT" }],
        }),
      ).rejects.toBeInstanceOf(OnboardingSessionNotFoundError);
      await expect(
        service.runtime.listInterviewTurns({
          actor: owner,
          sessionId: randomUUID() as OnboardingSessionId,
        }),
      ).rejects.toBeInstanceOf(OnboardingSessionNotFoundError);
      const [row] = await tx.sql<{ count: number }[]>`
        select count(*)::int as count from onboarding.interview_turns
         where session_id = ${sessionId}`;
      expect(row?.count).toBe(1);
    });
  });

  it("the thread is append-only in the database", async () => {
    await withWorld(async ({ tx, service, owner, sessionId }) => {
      await service.runtime.appendInterviewTurns({
        actor: owner,
        sessionId,
        turnRef: randomUUID(),
        turns: [{ role: "Q", text: "Welcome.", channel: "TEXT" }],
      });
      await expect(
        tx.sql.savepoint(
          (inner) =>
            inner`update onboarding.interview_turns set text = 'Rewritten.' where session_id = ${sessionId}`,
        ),
      ).rejects.toMatchObject({ code: "23001" });
      await expect(
        tx.sql.savepoint(
          (inner) =>
            inner`delete from onboarding.interview_turns where session_id = ${sessionId}`,
        ),
      ).rejects.toMatchObject({ code: "23001" });
    });
  });

  it("refuses an exchange naming a role twice, and an unbounded read", async () => {
    await withWorld(async ({ service, owner, sessionId }) => {
      await expect(
        service.runtime.appendInterviewTurns({
          actor: owner,
          sessionId,
          turnRef: randomUUID(),
          turns: [
            { role: "Q", text: "One.", channel: "TEXT" },
            { role: "Q", text: "Two.", channel: "TEXT" },
          ],
        }),
      ).rejects.toThrow();
      await expect(
        service.runtime.listInterviewTurns({
          actor: owner,
          sessionId,
          limit: 101,
        }),
      ).rejects.toThrow();
    });
  });

  it("without a composed repository the thread is refused, never silently empty", async () => {
    await withWorld(async ({ tx, owner, sessionId }) => {
      const bare = createOnboardingUseCases({
        sql: tx.sql,
        transactions: nestedTransactions(tx),
        outbox: createOutboxWriter({ registry }),
        definitions: createPostgresOnboardingDefinitionRepository(),
        sessions: createPostgresOnboardingSessionRepository(),
        stepStates: createPostgresOnboardingStepStateRepository(),
        responses: createPostgresOnboardingResponseRepository(),
        suggestions: createPostgresOnboardingSuggestionRepository(),
        idempotency: createPostgresOnboardingIdempotencyRepository(),
        subjects: createOnboardingSubjectResolverRegistry([]),
        writeTargets: createOnboardingWriteTargetRegistry([]),
        stepContexts: createOnboardingStepContextRegistry([]),
      });
      await expect(
        bare.listInterviewTurns({ actor: owner, sessionId }),
      ).rejects.toBeInstanceOf(OnboardingRuntimeConfigurationError);
    });
  });
});
