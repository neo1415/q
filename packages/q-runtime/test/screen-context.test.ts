import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  CreateQRunRequestSchema,
  type QScreenContext,
  type QSubjectRef,
} from "@capital-q/contracts";
import { ActorContextSchema, type ActorContext } from "@capital-q/security";

import { createCreateQRun } from "../src/application/create-run.js";
import type { QRuntimeDependencies } from "../src/application/dependencies.js";

/**
 * What is on the person's screen (R21) is a request, never authority. Each
 * entity it shows joins the run's subjects -- where the Context Firewall
 * plans over it -- only when it resolves for this actor through its owning
 * context, exactly like a named subject; otherwise it is dropped silently
 * and the question is still asked. It is this turn's, so it is never
 * written to the conversation's subjects.
 */

const TENANT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const COMPANY = "c0000000-0000-4000-8000-000000000001";
const INVESTOR = "d0000000-0000-4000-8000-000000000001";
const DOCUMENT = "e0000000-0000-4000-8000-000000000001";

const person = ActorContextSchema.parse({
  userId: "a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1",
  tenantId: TENANT,
  organisationId: "a0a0a0a0-a0a0-4a0a-8a0a-a0a0a0a0a0a0",
  membershipId: "a2a2a2a2-a2a2-4a2a-8a2a-a2a2a2a2a2a2",
  actorType: "HUMAN",
});

function harness(resolves: (ref: QSubjectRef) => boolean | "throws") {
  const runs: { subjects: readonly QSubjectRef[] }[] = [];
  const conversations: { subjects: readonly QSubjectRef[] }[] = [];
  const resolved: QSubjectRef[] = [];
  const dependencies = {
    sql: {} as never,
    transactions: {
      run: (work: (tx: unknown) => unknown) => work({ sql: {} }),
    },
    subjects: {
      supports: () => true,
      resolve: (_actor: ActorContext, ref: QSubjectRef) => {
        resolved.push(ref);
        const answer = resolves(ref);
        return answer === "throws"
          ? Promise.reject(new Error("context unavailable"))
          : Promise.resolve(
              answer ? { ref, tenantId: TENANT, organisationId: null } : null,
            );
      },
    },
    repositories: {
      runCreationRequests: {
        lock: () => Promise.resolve(),
        find: () => Promise.resolve(null),
        record: () => Promise.resolve(),
      },
      conversations: {
        insert: (_tx: unknown, input: { subjects: readonly QSubjectRef[] }) => {
          conversations.push(input);
          return Promise.resolve({ id: randomUUID(), ...input });
        },
        setSubjects: () => Promise.resolve(),
      },
      runs: {
        insert: (_tx: unknown, input: { subjects: readonly QSubjectRef[] }) => {
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
  } as unknown as QRuntimeDependencies;
  const create = createCreateQRun(dependencies);
  const ask = (screen: QScreenContext | undefined) =>
    create({
      actor: person,
      input: {
        capability: "ANSWER",
        message: { text: "what do you make of this?" },
        modality: "TEXT",
        ...(screen === undefined ? {} : { screen }),
      },
      idempotencyKey: randomUUID(),
      correlationId: "cor_test",
    });
  return { ask, runs, conversations, resolved };
}

const company: QSubjectRef = { kind: "COMPANY", companyId: COMPANY };
const investor: QSubjectRef = {
  kind: "INVESTOR_ORGANISATION",
  investorOrganisationId: INVESTOR,
};
const document: QSubjectRef = { kind: "DOCUMENT", documentId: DOCUMENT };

describe("the screen context on a Q run", () => {
  it("adds each entity on screen as a subject when it resolves for the person", async () => {
    const h = harness(() => true);
    await h.ask({
      route: "COMPANY",
      companyId: COMPANY,
      investorOrganisationId: INVESTOR,
      documentId: DOCUMENT,
    });
    expect(h.runs[0]?.subjects).toEqual([company, investor, document]);
  });

  it("drops silently -- the question still asked -- an entity that does not resolve", async () => {
    for (const refusal of [false, "throws"] as const) {
      const h = harness((ref) => (ref.kind === "COMPANY" ? refusal : true));
      await h.ask({
        route: "COMPANY",
        companyId: COMPANY,
        documentId: DOCUMENT,
      });
      expect(h.runs).toHaveLength(1);
      expect(h.runs[0]?.subjects).toEqual([document]);
    }
  });

  it("a screen with no entities, or none at all, changes nothing", async () => {
    for (const screen of [undefined, { route: "PROFILE" as const }]) {
      const h = harness(() => true);
      await h.ask(screen);
      expect(h.runs[0]?.subjects).toEqual([]);
    }
  });

  it("is this turn's only: the conversation does not keep the screen's entities", async () => {
    const h = harness(() => true);
    await h.ask({ route: "COMPANY", companyId: COMPANY });
    expect(h.runs[0]?.subjects).toEqual([company]);
    expect(h.conversations[0]?.subjects).toEqual([]);
  });

  it("the contract refuses anything beyond route and entity ids", () => {
    const base = {
      capability: "ANSWER",
      message: { text: "hi" },
      modality: "TEXT",
    };
    expect(
      CreateQRunRequestSchema.safeParse({
        ...base,
        screen: { route: "HOME", pixels: "..." },
      }).success,
    ).toBe(false);
    expect(
      CreateQRunRequestSchema.safeParse({
        ...base,
        screen: { route: "SETTINGS_ADMIN" },
      }).success,
    ).toBe(false);
    expect(
      CreateQRunRequestSchema.safeParse({
        ...base,
        screen: { route: "COMPANY", companyId: "not-a-uuid" },
      }).success,
    ).toBe(false);
  });
});
