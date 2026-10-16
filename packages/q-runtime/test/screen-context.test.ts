import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  CreateQRunRequestSchema,
  QConversationIdSchema,
  type QScreenContext,
  type QSubjectRef,
} from "@capital-q/contracts";
import { ActorContextSchema, type ActorContext } from "@capital-q/security";

import {
  createCreateQRun,
  RUN_SCREEN_MAX_CHARS,
  screenCompanyFirst,
} from "../src/application/create-run.js";
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

function harness(
  resolves: (ref: QSubjectRef) => boolean | "throws",
  carried: readonly QSubjectRef[] = [],
) {
  const conversationId = QConversationIdSchema.parse(randomUUID());
  const runs: {
    subjects: readonly QSubjectRef[];
    screen?: QScreenContext | null;
  }[] = [];
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
        // An earlier page's conversation, whose subjects carry forward.
        findForOwner: () =>
          Promise.resolve({
            id: conversationId,
            tenantId: TENANT,
            userId: person.userId,
            organisationId: person.organisationId,
            contextType: "GENERAL",
            subjects: carried,
            title: null,
            summary: null,
            archivedAt: null,
          }),
      },
      runs: {
        insert: (
          _tx: unknown,
          input: {
            subjects: readonly QSubjectRef[];
            screen?: QScreenContext | null;
          },
        ) => {
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
        ...(carried.length === 0 ? {} : { conversationId }),
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

  it("the run records the screen: the route, and only the entities that resolved", async () => {
    const h = harness((ref) => ref.kind !== "COMPANY");
    await h.ask({
      route: "COMPANY",
      companyId: COMPANY,
      documentId: DOCUMENT,
    });
    expect(h.runs[0]?.screen).toEqual({
      route: "COMPANY",
      documentId: DOCUMENT,
    });
  });

  it("a screen with only a route is still recorded, so Q knows where they are", async () => {
    const h = harness(() => true);
    await h.ask({ route: "PROFILE" });
    expect(h.runs[0]?.screen).toEqual({ route: "PROFILE" });
    const none = harness(() => true);
    await none.ask(undefined);
    expect(none.runs[0]?.screen).toBeNull();
  });

  it("keeps the open artifact and its position as read-back hints, without granting a subject", async () => {
    const h = harness(() => false);
    const screen = {
      route: "DOCUMENTS" as const,
      artifactId: DOCUMENT,
      artifactVersion: 1,
      artifactSlide: 2,
    };
    await h.ask(screen);
    expect(h.runs[0]?.screen).toEqual(screen);
    expect(h.runs[0]?.subjects).toEqual([]);
    expect(h.conversations[0]?.subjects).toEqual([]);
    expect(h.resolved).toEqual([]);
  });

  it("does not retain artifact positions without an artifact reference", async () => {
    const h = harness(() => true);
    await h.ask({ route: "DOCUMENTS", artifactVersion: 1, artifactSlide: 2 });
    expect(h.runs[0]?.screen).toEqual({ route: "DOCUMENTS" });
  });

  it("keeps a document page only with the resolved document", async () => {
    for (const allowed of [true, false]) {
      const h = harness(() => allowed);
      await h.ask({
        route: "DOCUMENTS",
        documentId: DOCUMENT,
        documentPage: 3,
      });
      expect(h.runs[0]?.screen).toEqual(
        allowed
          ? { route: "DOCUMENTS", documentId: DOCUMENT, documentPage: 3 }
          : { route: "DOCUMENTS" },
      );
    }
  });

  it("R35: the Discover card on screen is 'this company' -- a subject, with no words read", async () => {
    // The request carries no phrase to match: whatever the person says
    // ("what is this about?", "save it", "I'm interested"), the screen
    // names the company and the run binds it.
    const h = harness(() => true);
    await h.ask({ route: "DISCOVER", companyId: COMPANY });
    expect(h.runs[0]?.subjects).toEqual([company]);
    expect(h.runs[0]?.screen).toEqual({
      route: "DISCOVER",
      companyId: COMPANY,
    });
    // A card the person may not see is dropped, as if absent.
    const refused = harness(() => false);
    await refused.ask({ route: "DISCOVER", companyId: COMPANY });
    expect(refused.runs[0]?.subjects ?? []).toEqual([]);
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

describe("a busy page's manifest on the run (G-D8)", () => {
  // The largest manifest the contract accepts: every list at its maximum,
  // every id at its longest. It used to fail the run's 512-character check.
  const uuid = "c0000000-0000-4000-8000-000000000001";
  const slug = (n: number) => `s${String(n)}`.padEnd(40, "x");
  const part = (n: number) => `p${String(n)}`.padEnd(48, "x");
  const largest = {
    v: 2 as const,
    seq: Number.MAX_SAFE_INTEGER,
    inView: Array.from({ length: 12 }, (_, n) => slug(n)),
    sections: Array.from({ length: 12 }, (_, n) => ({
      id: slug(n),
      kind: "GATEQ_APPLICATION" as const,
      refs: Array.from({ length: 12 }, () => ({
        kind: "GATEQ_APPLICATION" as const,
        id: uuid,
      })),
      total: 10_000,
    })),
    dialogs: Array.from({ length: 3 }, (_, n) => ({
      id: slug(n),
      kind: "DOCUMENT_VIEWER" as const,
      refs: Array.from({ length: 4 }, () => ({
        kind: "GATEQ_APPLICATION" as const,
        id: uuid,
      })),
    })),
    focus: { kind: "GATEQ_APPLICATION" as const, id: uuid },
    controls: Array.from({ length: 48 }, (_, n) => ({
      id: `${"c".padEnd(32, "x")}.${part(n)}.${part(n)}.${part(n)}`,
      kind: "LIST" as const,
      count: 10_000,
    })),
  };

  it("keeps the largest manifest the contract accepts, inside the run's bound", async () => {
    const h = harness(() => true);
    await h.ask({ route: "WORK", manifest: largest });
    expect(h.runs).toHaveLength(1);
    expect(h.runs[0]?.screen?.manifest).toEqual(largest);
    const stored = JSON.stringify(h.runs[0]?.screen);
    expect(stored.length).toBeGreaterThan(512);
    expect(stored.length).toBeLessThanOrEqual(RUN_SCREEN_MAX_CHARS);
  });
});

describe("the company on screen is the run's first subject (run 5, 16 Oct)", () => {
  const EARLIER = "c0000000-0000-4000-8000-000000000002";
  const earlier: QSubjectRef = { kind: "COMPANY", companyId: EARLIER };

  it("leads over a company the conversation carried from an earlier page", async () => {
    const h = harness(() => true, [earlier]);
    // The profile is still loading: the screen names the company, no focus yet.
    await h.ask({ route: "COMPANY", companyId: COMPANY });
    expect(h.runs[0]?.subjects.slice(0, 2)).toEqual([company, earlier]);
  });

  it("keeps the order when the screen names two companies (it asks, never guesses)", () => {
    const refs = [earlier, company];
    expect(
      screenCompanyFirst(refs, {
        route: "COMPANY",
        companyId: COMPANY,
        manifest: {
          v: 2,
          seq: 1,
          inView: [],
          dialogs: [],
          sections: [],
          focus: { kind: "COMPANY", id: EARLIER },
        },
      }),
    ).toBe(refs);
    expect(screenCompanyFirst(refs, { route: "COMPANY" })).toBe(refs);
    expect(screenCompanyFirst(refs, undefined)).toBe(refs);
  });

  it("never chooses a company the person may not see", async () => {
    const h = harness(
      (ref) => ref.kind !== "COMPANY" || ref.companyId !== COMPANY,
      [earlier],
    );
    await h.ask({ route: "COMPANY", companyId: COMPANY });
    const subjects = h.runs[0]?.subjects ?? [];
    expect(subjects[0]).toEqual(earlier);
    expect(subjects).not.toContainEqual(company);
  });
});
