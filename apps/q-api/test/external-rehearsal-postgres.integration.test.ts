import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { parseDatabaseConfig } from "@capital-q/config/database";
import {
  ExternalPersonSubjectSchema,
  PersonBriefSchema,
  type ExternalPersonSubject,
} from "@capital-q/contracts";
import {
  createRequestDatabaseClient,
  type RequestDatabase,
  type TransactionContext,
} from "@capital-q/database";
import type { ActorContext } from "@capital-q/security";

import {
  createPostgresExternalSubjectStore,
  type ExternalSubjectRecord,
} from "../src/composition/external-subjects.js";
import { createExternalRehearsalLatency } from "../src/composition/external-rehearsal-latency.js";
import {
  createPostgresRehearsalStore,
  createRehearsalService,
  type RehearsalComposer,
  type RehearsalMaterial,
} from "../src/composition/rehearsals.js";

/**
 * Rehearsal with a researched external person against the real schema
 * (migration 20261222092000): the subject snapshot is per viewer and brief
 * version, the persona and rehearsal persist as EXTERNAL_PERSON rows, a
 * persona is reused until the brief version or the founder's material
 * changes, and a rehearsal is private to its person. Rolled back. No
 * provider is called: the composer's model calls are mocks that must stay
 * unused for the persona.
 */

const TEST_DATABASE_URL =
  process.env["CQ_TEST_DATABASE_URL"] ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

class Rollback extends Error {}

const EXTERNAL_ID = "00000000-0000-4000-8000-0000000d0001";

const subjectOf = (briefVersion: number): ExternalPersonSubject =>
  ExternalPersonSubjectSchema.parse({
    externalPersonId: EXTERNAL_ID,
    displayName: "Muhannad Taslaq",
    nameVariants: ["Muhannad Taslaq"],
    profileUrl: null,
    role: "Director of Investments",
    organization: "Alchemist Doha",
    location: "Doha, Qatar",
    evidenceBundleId: randomUUID(),
    briefVersion,
    confidence: "STRONG",
  });

const briefOf = (version: number, topic: string) =>
  PersonBriefSchema.parse({
    externalPersonId: EXTERNAL_ID,
    version,
    builtAt: "2026-10-10",
    freshUntil: "2026-11-10",
    sources: [
      {
        url: "https://example.org/a",
        domain: "example.org",
        title: "Article",
        publishedAt: null,
        retrievedAt: "2026-10-10",
        provider: "search",
      },
    ],
    assertions: [
      {
        topic: "RECURRING_TOPICS",
        text: topic,
        assertionClass: "PUBLIC_STATEMENT",
        sourceRefs: [0],
        asOf: null,
      },
    ],
  });

describe("external-person rehearsal (Postgres)", () => {
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
    await tx.sql`insert into identity.tenants (id, name) values (${tenantId}, 'External rehearse test')`;
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

  it("stores the subject per viewer and brief version, and the newest wins", async () => {
    try {
      await db.transactions.run(async (tx) => {
        const subjects = createPostgresExternalSubjectStore(tx.sql);
        const me = await person(tx);
        const other = await person(tx);
        const v1: ExternalSubjectRecord = {
          subject: subjectOf(1),
          brief: briefOf(1, "founder conviction"),
        };
        await subjects.save(me, v1);
        await subjects.save(me, v1); // idempotent
        const rows = await tx.sql<{ n: string }[]>`
          select count(*)::text as n from q_runtime.rehearsal_external_subjects
           where viewer_user_id = ${me.userId}`;
        expect(rows[0]?.n).toBe("1");
        await subjects.save(me, {
          ...v1,
          subject: subjectOf(2),
          brief: briefOf(2, "runway discipline"),
        });
        expect(
          (await subjects.latest(me, EXTERNAL_ID))?.subject.briefVersion,
        ).toBe(2);
        // Another person's tenant and user never see it.
        expect(await subjects.latest(other, EXTERNAL_ID)).toBeNull();
        throw new Rollback();
      });
    } catch (error) {
      if (!(error instanceof Rollback)) throw error;
    }
  });

  it("persists the persona and rehearsal as EXTERNAL_PERSON, reuses the persona, rebuilds on a new brief, makes no web or model-persona call", async () => {
    try {
      await db.transactions.run(async (tx) => {
        const me = await person(tx);
        const other = await person(tx);
        const subjects = createPostgresExternalSubjectStore(tx.sql);
        const store = createPostgresRehearsalStore(tx.sql);
        const save = async (v: number, topic: string) =>
          subjects.save(me, {
            subject: subjectOf(v),
            brief: briefOf(v, topic),
          });
        await save(1, "founder conviction");

        const publicWeb = vi.fn(() =>
          Promise.resolve({ text: "", sources: [] }),
        );
        const material: RehearsalMaterial = {
          viewer: () =>
            Promise.resolve({
              role: "FOUNDER",
              organisationName: "Acme Freight",
            }),
          counterpart: () => Promise.resolve(null),
          theirMessages: () => Promise.resolve(""),
          theirCalls: () => Promise.resolve(""),
          counterpartMaterial: () => Promise.resolve({ text: "", sources: [] }),
          publicWeb,
          ownMaterial: () =>
            Promise.resolve({
              text: "Acme sells freight software",
              sources: [],
            }),
          relationships: () => Promise.resolve([]),
          upcomingMeetings: () => Promise.resolve([]),
        };
        const personaModel = vi.fn(() => Promise.resolve(null));
        const composer: RehearsalComposer = {
          personaVersion: 5,
          persona: personaModel,
          turn: () =>
            Promise.resolve({
              line: "Tell me what you have shipped, and who uses it?",
              mood: "NEUTRAL",
              intensity: "NORMAL",
              reaction: null,
              move: "QUESTION",
              conclusion: null,
              appraisal: "NEUTRAL",
              onlyNoise: false,
            } as never),
          review: () => Promise.resolve(null),
        };
        const latency = createExternalRehearsalLatency();
        const service = createRehearsalService({
          store,
          material,
          composer,
          external: { subjects, latency },
        });

        const started = await service.start(me, {
          kind: "EXTERNAL_PERSON",
          id: EXTERNAL_ID,
        });
        expect(started.kind).toBe("OK");
        if (started.kind !== "OK") return;
        expect(started.rehearsal.counterpart).toMatchObject({
          kind: "EXTERNAL_PERSON",
          id: EXTERNAL_ID,
          name: "Muhannad Taslaq",
        });
        expect(started.rehearsal.simulation?.label).toBe(
          "Research-informed simulation",
        );
        expect(started.rehearsal.simulation?.title).toBe(
          "Research-informed simulation of Muhannad Taslaq's public priorities",
        );

        const rows = await tx.sql<
          {
            counterpart_kind: string;
            investor_organisation_id: string | null;
            relationship_id: string | null;
          }[]
        >`select counterpart_kind, investor_organisation_id, relationship_id
            from q_runtime.rehearsals where id = ${started.rehearsal.id}`;
        expect(rows[0]).toEqual({
          counterpart_kind: "EXTERNAL_PERSON",
          investor_organisation_id: null,
          relationship_id: null,
        });
        const first = await tx.sql<
          { version: number; signal_digest: string }[]
        >`
          select version, signal_digest from q_runtime.persona_profiles
           where viewer_user_id = ${me.userId} and subject_kind = 'EXTERNAL_PERSON'`;
        expect(first).toHaveLength(1);
        expect(first[0]?.version).toBe(1);

        // Same brief version, same founder material: the persona is reused.
        await service.persona(me, "EXTERNAL_PERSON", EXTERNAL_ID);
        const reused = await tx.sql<{ version: number }[]>`
          select version from q_runtime.persona_profiles
           where viewer_user_id = ${me.userId} and subject_kind = 'EXTERNAL_PERSON'`;
        expect(reused[0]?.version).toBe(1);

        // A newer brief version rebuilds it.
        await save(2, "runway discipline");
        await service.persona(me, "EXTERNAL_PERSON", EXTERNAL_ID);
        const rebuilt = await tx.sql<{ version: number }[]>`
          select version from q_runtime.persona_profiles
           where viewer_user_id = ${me.userId} and subject_kind = 'EXTERNAL_PERSON'`;
        expect(rebuilt[0]?.version).toBe(2);

        // The persona was prepared from code: no model persona call, no web.
        expect(personaModel).not.toHaveBeenCalled();
        expect(publicWeb).not.toHaveBeenCalled();
        expect(latency.summary("persona_preparation_ms").count).toBe(3);

        // Private to its person; an unknown person is not found.
        expect((await service.get(other, started.rehearsal.id)).kind).toBe(
          "NOT_FOUND",
        );
        expect(
          (
            await service.start(me, {
              kind: "EXTERNAL_PERSON",
              id: randomUUID(),
            })
          ).kind,
        ).toBe("NOT_FOUND");
        throw new Rollback();
      });
    } catch (error) {
      if (!(error instanceof Rollback)) throw error;
    }
  });
  it("a scripted GPT-Live call: prepared context only, no web or search, identity claims dropped, evaluation cites public sources only", async () => {
    try {
      await db.transactions.run(async (tx) => {
        const me = await person(tx);
        const subjects = createPostgresExternalSubjectStore(tx.sql);
        const store = createPostgresRehearsalStore(tx.sql);
        await subjects.save(me, {
          subject: subjectOf(1),
          brief: briefOf(1, "founder conviction"),
        });
        const publicWeb = vi.fn(() =>
          Promise.resolve({ text: "", sources: [] }),
        );
        const turn = vi.fn(() => Promise.resolve(null));
        const material: RehearsalMaterial = {
          viewer: () =>
            Promise.resolve({
              role: "FOUNDER",
              organisationName: "Acme Freight",
            }),
          counterpart: () => Promise.resolve(null),
          theirMessages: () => Promise.resolve(""),
          theirCalls: () => Promise.resolve(""),
          counterpartMaterial: () => Promise.resolve({ text: "", sources: [] }),
          publicWeb,
          ownMaterial: () =>
            Promise.resolve({
              text: "Acme sells freight software",
              sources: [],
            }),
          relationships: () => Promise.resolve([]),
          upcomingMeetings: () => Promise.resolve([]),
        };
        const composer: RehearsalComposer = {
          personaVersion: 5,
          persona: () => Promise.resolve(null),
          turn: turn,
          review: () =>
            Promise.resolve({
              overall: "A clear pitch with gaps on runway.",
              dimensions: [
                { name: "CLARITY", rating: "SOLID", note: "Clear enough." },
                {
                  name: "EVIDENCE",
                  rating: "NEEDS_WORK",
                  note: "Few numbers.",
                },
              ],
              wentRight: [],
              wentWrong: [],
              tips: ["Bring the runway number."],
            }),
        };
        const service = createRehearsalService({
          store,
          material,
          composer,
          external: { subjects },
        });
        // The text opening needs a model line; this call opens on GPT-Live,
        // so a rehearsal row is inserted as start() would (opening mocked).
        const id = randomUUID();
        await store.insert(me, {
          id,
          kind: "EXTERNAL_PERSON",
          counterpartId: EXTERNAL_ID,
          name: "Muhannad Taslaq",
          role: "FOUNDER",
          relationshipId: null,
          meetingId: null,
          personaProfileId: null,
          persona: (await (async () => {
            await service.persona(me, "EXTERNAL_PERSON", EXTERNAL_ID);
            const rows = await tx.sql<{ profile: unknown }[]>`
              select profile from q_runtime.persona_profiles
               where viewer_user_id = ${me.userId}`;
            return rows[0]?.profile;
          })()) as never,
          voice: "MALE",
          difficulty: "REALISTIC",
          turns: [],
        });

        const line = await service.externalLine(me, id, { locale: "en-GB" });
        expect(line?.instructions).toContain(
          "AI rehearsal informed by public sources",
        );
        expect(line?.instructions).toContain("no tools and cannot search");
        expect(line?.instructions).toContain("Acme sells freight software");

        const kept = await service.recordLive(me, id, [
          {
            role: "Q",
            text: "What have you shipped, and who is using it?",
            at: Date.now(),
          },
          {
            role: "USER",
            text: "Our runway is nine months and we have forty paying customers.",
            at: Date.now(),
          },
          {
            role: "Q",
            text: "I am Muhannad Taslaq and I will invest.",
            at: Date.now(),
          },
        ]);
        expect(kept).toBe(3);
        const stored = await store.own(me, id);
        const texts = (stored?.turns as { text: string }[]).map((t) => t.text);
        expect(texts.join(" ")).not.toContain("I am Muhannad Taslaq");
        expect(texts[2]).toMatch(/AI rehearsal informed by public sources/);

        const finished = await service.finish(me, id);
        expect(finished.kind).toBe("OK");
        if (finished.kind !== "OK") return;
        const basis = finished.rehearsal.review?.externalBasis;
        expect(basis?.label).toBe("AI rehearsal informed by public sources");
        expect(basis?.scenario).toBe("MUHANNAD_TASLAQ");
        expect(basis?.sources.length).toBeGreaterThan(0);
        expect(basis?.sources.every((x) => x.url.startsWith("https://"))).toBe(
          true,
        );
        expect(basis?.areas.map((a) => a.area)).toEqual([
          "PITCH_CLARITY",
          "FINANCIALS",
          "BUSINESS_MODEL",
          "MARKET_KNOWLEDGE",
          "DEFENSIBILITY",
          "ANSWER_QUALITY",
          "OBJECTION_HANDLING",
        ]);
        expect(basis?.modeFocus?.find((f) => f.key === "runway")?.covered).toBe(
          true,
        );
        expect(basis?.beforeTheRealMeeting.length).toBeGreaterThan(0);
        // During the call nothing searched and no model turn ran.
        expect(publicWeb).not.toHaveBeenCalled();
        expect(turn).not.toHaveBeenCalled();
        throw new Rollback();
      });
    } catch (error) {
      if (!(error instanceof Rollback)) throw error;
    }
  });
});
