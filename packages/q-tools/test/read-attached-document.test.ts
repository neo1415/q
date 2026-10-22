import { describe, expect, it } from "vitest";

import type { PermittedContextPlan } from "@capital-q/contracts";

import {
  ATTACHED_TEXT_MAX_CHARS,
  boundedPages,
  createReadAttachedDocumentTool,
  type AttachedDocumentsPort,
} from "../src/index.js";
import { actorA, actorB, contextFor, planFor } from "./support.js";

/**
 * Lane 8 (owner 2026-10-22): a document attached in Q's composer is read
 * for the person at once, as them, and found again later by its name. One
 * that is not theirs reads exactly like one that does not exist.
 */

const DOC = "d0000000-0000-4000-8000-000000000001";

function ownPlan(actor = actorA): PermittedContextPlan {
  const plan = planFor(actor, "GENERAL_QUESTION", [
    { kind: "OWN_Q_CONVERSATION", sensitivity: "CONFIDENTIAL" },
  ]);
  return {
    ...plan,
    scopes: plan.scopes.map((scope) =>
      scope.kind === "OWN_Q_CONVERSATION"
        ? { ...scope, filter: { ...scope.filter, userId: actor.userId } }
        : scope,
    ),
  };
}

const identity = {
  documentId: DOC,
  title: "Term sheet",
  filename: "term-sheet.pdf",
  uploadedAt: "2026-10-22T09:00:00.000Z",
};

describe("read_attached_document", () => {
  it("reads their document as them, pages cited, a claim not a fact", async () => {
    const asked: string[] = [];
    const port: AttachedDocumentsPort = {
      read: (actor, request) => {
        asked.push(`${actor.userId}:${request.documentId ?? "-"}`);
        return Promise.resolve({
          document: {
            ...identity,
            state: "READ",
            pageCount: 2,
            whole: true,
            pages: [
              { page: 2, text: "Liquidation preference 1x." },
              { page: 1, text: "Valuation $8m pre-money." },
            ],
          },
          others: [],
        });
      },
    };
    const tool = createReadAttachedDocumentTool(port);
    const plan = ownPlan();
    const context = contextFor(actorA, plan);
    const grant = await tool.authorize({ documentId: DOC }, context);
    expect(grant.outcome).toBe("ALLOW");
    const out = await tool.execute({ documentId: DOC }, context, null);
    expect(asked).toEqual([`${actorA.userId}:${DOC}`]);
    expect(out).toMatchObject({
      status: "READ",
      title: "Term sheet",
      pageCount: 2,
      whole: true,
      pages: [
        { page: 1, text: "Valuation $8m pre-money." },
        { page: 2, text: "Liquidation preference 1x." },
      ],
      truthClass: "USER_CLAIM",
      evidenceStatus: "DOCUMENT_SUPPORTED",
    });
  });

  it("is refused outside the person's own conversation", async () => {
    const tool = createReadAttachedDocumentTool({
      read: () => Promise.reject(new Error("never called")),
    });
    // actorB's plan, presented by actorA: not actorA's own conversation.
    const grant = await tool.authorize(
      { documentId: DOC },
      contextFor(actorA, ownPlan(actorB)),
    );
    expect(grant.outcome).toBe("DENY");
  });

  it("NONE when Evidence refuses it (another tenant's, revoked, deleted)", async () => {
    const tool = createReadAttachedDocumentTool({
      read: () => Promise.reject(new Error("DOCUMENT_NOT_FOUND")),
    });
    const out = await tool.execute(
      { documentId: DOC },
      contextFor(actorA, ownPlan()),
      null,
    );
    expect(out).toMatchObject({ status: "NONE", pages: [], title: null });
  });

  it("says plainly why a file can't be read, and when it is still reading", async () => {
    const unreadable = createReadAttachedDocumentTool({
      read: () =>
        Promise.resolve({
          document: {
            ...identity,
            state: "UNREADABLE",
            reason: "It is an image, and Q can't read text in images yet.",
          },
          others: [],
        }),
    });
    expect(
      await unreadable.execute({}, contextFor(actorA, ownPlan()), null),
    ).toMatchObject({
      status: "UNREADABLE",
      reason: "It is an image, and Q can't read text in images yet.",
    });
    const reading = createReadAttachedDocumentTool({
      read: () =>
        Promise.resolve({
          document: { ...identity, state: "READING" },
          others: [],
        }),
    });
    expect(
      await reading.execute({}, contextFor(actorA, ownPlan()), null),
    ).toMatchObject({ status: "READING", title: "Term sheet" });
  });

  it("finds one sent earlier by name, and names the others when none match", async () => {
    const names: (string | undefined)[] = [];
    const tool = createReadAttachedDocumentTool({
      read: (_actor, request) => {
        names.push(request.name);
        return Promise.resolve({
          document: null,
          others: [
            {
              documentId: DOC,
              title: "Board pack",
              uploadedAt: "2026-10-20T09:00:00.000Z",
            },
          ],
        });
      },
    });
    const out = await tool.execute(
      { name: "that contract" },
      contextFor(actorA, ownPlan()),
      null,
    );
    expect(names).toEqual(["that contract"]);
    expect(out).toMatchObject({
      status: "NONE",
      others: [{ documentId: DOC, title: "Board pack" }],
    });
  });

  it("bounds what one read hands on, and says it was cut", () => {
    const { pages, cut } = boundedPages([
      { page: 1, text: "a".repeat(ATTACHED_TEXT_MAX_CHARS - 10) },
      { page: 2, text: "b".repeat(100) },
      { page: 3, text: "c".repeat(100) },
    ]);
    expect(cut).toBe(true);
    expect(pages.map((page) => page.page)).toEqual([1, 2]);
    expect(
      pages.reduce((sum, page) => sum + page.text.length, 0),
    ).toBeLessThanOrEqual(ATTACHED_TEXT_MAX_CHARS);
  });
});
