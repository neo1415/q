import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import type { QSubjectRef, QViewingMoment } from "@capital-q/contracts";
import { ActorContextSchema, type ActorContext } from "@capital-q/security";

import { createCreateQRun } from "../src/application/create-run.js";
import type { QRuntimeDependencies } from "../src/application/dependencies.js";

/**
 * What the person was viewing when they asked (R18) is a request, never
 * authority. It reaches the run only when the media context says this
 * person may play that pitch now and the company resolves for them as a
 * subject; otherwise it is dropped silently, exactly as if absent, and the
 * question is still asked. The company becomes the run's subject so the
 * firewall can bind it.
 */

const TENANT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const COMPANY = "c0000000-0000-4000-8000-000000000001";
const PITCH = "f0000000-0000-4000-8000-000000000001";

const investor = ActorContextSchema.parse({
  userId: "a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1",
  tenantId: TENANT,
  organisationId: "a0a0a0a0-a0a0-4a0a-8a0a-a0a0a0a0a0a0",
  membershipId: "a2a2a2a2-a2a2-4a2a-8a2a-a2a2a2a2a2a2",
  actorType: "HUMAN",
});

const viewing: QViewingMoment = {
  kind: "PITCH_PLAYBACK",
  companyId: COMPANY,
  mediaAssetId: PITCH,
  positionSeconds: 102,
};

type Recorded = {
  subjects: readonly QSubjectRef[];
  viewing?: QViewingMoment | null;
};

function harness(options: {
  readonly mayPlay?: boolean | "throws";
  readonly companyResolves?: boolean;
  readonly composed?: boolean;
}) {
  const runs: Recorded[] = [];
  const asked: { actor: ActorContext; viewing: QViewingMoment }[] = [];
  const dependencies = {
    sql: {} as never,
    transactions: {
      run: (work: (tx: unknown) => unknown) => work({ sql: {} }),
    },
    subjects: {
      supports: () => true,
      resolve: (_actor: ActorContext, ref: QSubjectRef) =>
        Promise.resolve(
          ref.kind === "COMPANY" && options.companyResolves === false
            ? null
            : { ref, tenantId: TENANT, organisationId: null },
        ),
    },
    repositories: {
      runCreationRequests: {
        lock: () => Promise.resolve(),
        find: () => Promise.resolve(null),
        record: () => Promise.resolve(),
      },
      conversations: {
        insert: (_tx: unknown, input: { subjects: readonly QSubjectRef[] }) =>
          Promise.resolve({ id: randomUUID(), ...input }),
        setSubjects: () => Promise.resolve(),
      },
      runs: {
        insert: (_tx: unknown, input: Recorded) => {
          runs.push(input);
          return Promise.resolve({
            id: randomUUID(),
            tenantId: TENANT,
            status: "RECEIVED",
            ...input,
          });
        },
        allocateEventSequence: () => Promise.resolve(1),
      },
      messages: {
        insert: (_tx: unknown, input: unknown) =>
          Promise.resolve({ id: randomUUID(), ...(input as object) }),
      },
      runEvents: {
        append: (_tx: unknown, input: unknown) => Promise.resolve(input),
      },
    },
    ...(options.composed === false
      ? {}
      : {
          viewing: {
            authorise: (actor: ActorContext, moment: QViewingMoment) => {
              asked.push({ actor, viewing: moment });
              return options.mayPlay === "throws"
                ? Promise.reject(new Error("media unavailable"))
                : Promise.resolve(options.mayPlay ?? true);
            },
          },
        }),
  } as unknown as QRuntimeDependencies;
  const create = createCreateQRun(dependencies);
  const ask = (subjects: readonly QSubjectRef[] = []) =>
    create({
      actor: investor,
      input: {
        capability: "ANSWER",
        message: { text: "what did they just say about revenue?" },
        modality: "TEXT",
        subjects: [...subjects],
        viewing,
      },
      idempotencyKey: randomUUID(),
      correlationId: "cor_test",
    });
  return { ask, runs, asked };
}

const company: QSubjectRef = { kind: "COMPANY", companyId: COMPANY };

describe("the viewing moment on a Q run", () => {
  it("is kept, with the company as subject, when the person may play the pitch", async () => {
    const h = harness({ mayPlay: true });
    await h.ask();
    expect(h.runs[0]?.viewing).toEqual(viewing);
    expect(h.runs[0]?.subjects).toEqual([company]);
    expect(h.asked).toEqual([{ actor: investor, viewing }]);
  });

  it("does not repeat a company the turn already names", async () => {
    const h = harness({ mayPlay: true });
    await h.ask([company]);
    expect(h.runs[0]?.subjects).toEqual([company]);
  });

  it("is dropped silently -- the question still asked -- when the person may not play the pitch", async () => {
    for (const mayPlay of [false, "throws"] as const) {
      const h = harness({ mayPlay });
      await h.ask();
      expect(h.runs).toHaveLength(1);
      expect(h.runs[0]?.viewing).toBeNull();
      expect(h.runs[0]?.subjects).toEqual([]);
    }
  });

  it("is dropped when the company does not resolve for the person as a subject", async () => {
    const h = harness({ mayPlay: true, companyResolves: false });
    await h.ask();
    expect(h.runs[0]?.viewing).toBeNull();
    expect(h.runs[0]?.subjects).toEqual([]);
  });

  it("is never kept in a composition that cannot authorise it", async () => {
    const h = harness({ composed: false });
    await h.ask();
    expect(h.runs[0]?.viewing).toBeNull();
  });
});
