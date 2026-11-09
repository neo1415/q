import { describe, expect, it } from "vitest";

import type { DatabaseExecutor } from "@capital-q/database";
import type { ActorContext } from "@capital-q/security";

import { createDocumentReadyFollowUp } from "../src/composition/document-ready-follow-up.js";

/**
 * D82 (owner live 2026-11-09; approved): a turn answered "I'm reading it
 * now" is answered once its file is read -- as its own person, resolved
 * afresh, through the same engine, once per (turn, document).
 */

const DOC = "D0000000-0000-4000-8000-0000000000A1";
const RUN = "11111111-0000-4000-8000-000000000001";
const USER = "a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1";
const ORG = "a0a0a0a0-a0a0-4a0a-8a0a-a0a0a0a0a0a0";
const CONVERSATION = "33333333-0000-4000-8000-000000000001";

const person = {
  userId: USER,
  tenantId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  organisationId: ORG,
  actorType: "HUMAN",
} as unknown as ActorContext;

function harness(options: {
  readonly rows?: readonly unknown[];
  readonly actor?: ActorContext | null;
  readonly created?: boolean;
}) {
  const queries: string[] = [];
  const bound: unknown[][] = [];
  const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    queries.push(strings.join("?"));
    bound.push(values);
    return Promise.resolve(
      options.rows ?? [
        {
          run_id: RUN,
          user_id: USER,
          conversation_id: CONVERSATION,
          actor_organisation_id: ORG,
          screen: { route: "RELATIONSHIP_COMPANY", attachedDocumentIds: [DOC] },
        },
      ],
    );
  }) as unknown as DatabaseExecutor;
  const actorsAsked: unknown[][] = [];
  const created: unknown[] = [];
  const started: unknown[] = [];
  const followUp = createDocumentReadyFollowUp({
    sql,
    actorFor: (userId, organisationId) => {
      actorsAsked.push([userId, organisationId]);
      return Promise.resolve(
        options.actor === undefined ? person : options.actor,
      );
    },
    createRun: (command) => {
      created.push(command);
      return Promise.resolve({
        created: options.created ?? true,
        run: {
          id: "44444444-0000-4000-8000-000000000001",
          conversationId: CONVERSATION,
        },
      });
    },
    start: (input) => {
      started.push(input);
    },
    newCorrelationId: () => "cor_test",
  });
  return { followUp, queries, bound, actorsAsked, created, started };
}

describe("a turn answered while its file was being read is answered once the file is read (D82.2)", () => {
  it("finds the turn by its own READING read of that document, and answers it as its person, once", async () => {
    const h = harness({});
    expect(await h.followUp.onDocumentReady(DOC)).toBe(1);
    // Which turns: that document's kept read came back READING, the run
    // completed, and the person has asked nothing since.
    const query = h.queries[0] ?? "";
    expect(query).toContain("documents.attached.read");
    expect(query).toContain("'READING'");
    expect(query).toContain("r.status = 'COMPLETED'");
    expect(query).toContain("later.role = 'USER'");
    expect(h.bound[0]).toContain(DOC);
    // As its person, resolved afresh.
    expect(h.actorsAsked).toEqual([[USER, ORG]]);
    expect(h.created).toEqual([
      expect.objectContaining({
        actor: person,
        openedBy: "Q",
        quiet: true,
        idempotencyKey: `doc-ready:${RUN}:${DOC.toLowerCase()}`,
        input: expect.objectContaining({
          capability: "ANSWER",
          conversationId: CONVERSATION,
          screen: {
            route: "RELATIONSHIP_COMPANY",
            attachedDocumentIds: [DOC.toLowerCase()],
          },
        }) as unknown,
      }),
    ]);
    expect(h.started).toEqual([
      expect.objectContaining({
        actor: person,
        conversationId: CONVERSATION,
      }),
    ]);
  });

  it("a repeated wake starts nothing new (the same key replays the run)", async () => {
    const h = harness({ created: false });
    expect(await h.followUp.onDocumentReady(DOC)).toBe(0);
    expect(h.started).toEqual([]);
  });

  it("a person who can no longer be acted for (suspended, removed) is not answered", async () => {
    const h = harness({ actor: null });
    expect(await h.followUp.onDocumentReady(DOC)).toBe(0);
    expect(h.created).toEqual([]);
  });

  it("no turn waiting on it: nothing", async () => {
    const h = harness({ rows: [] });
    expect(await h.followUp.onDocumentReady(DOC)).toBe(0);
    expect(h.actorsAsked).toEqual([]);
  });
});
