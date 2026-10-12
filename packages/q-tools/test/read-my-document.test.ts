import { describe, expect, it, vi } from "vitest";
import { createOwnWorkTools, createQToolRegistry } from "../src/index.js";
import { actorA, contextFor, planFor } from "./support.js";

import {
  createReadMyDocumentTool,
  documentText,
  READ_MY_DOCUMENT_TEXT_MAX,
  ReadMyDocumentOutputSchema,
} from "../src/tools/own-work.js";

/**
 * voiceq-63 (founder, live 2026-10-04): Q opened the prep PDF and could not
 * read what it showed. read_my_document reads one of their documents as the
 * actor, through the artifact service's own read, which refuses what is
 * not theirs.
 */
const ID = "e0000000-0000-4000-8000-000000000001";
const actor = { userId: "u1" } as never;

describe("read_my_document", () => {
  it("is not offered without a reader", () => {
    expect(
      createReadMyDocumentTool({ list: () => Promise.resolve([]) }),
    ).toBeNull();
  });

  it("reads the document as the asker, its sections as written", async () => {
    const asked: string[] = [];
    const tool = createReadMyDocumentTool({
      list: () => Promise.resolve([]),
      read: (who, artifactId) => {
        asked.push(
          `${String((who as { userId: string }).userId)}:${artifactId}`,
        );
        return Promise.resolve({
          title: "Prep questions for the call with Nixo",
          type: "Q_REPORT",
          version: 2,
          sections: [
            { heading: "Questions", body: "1. What is the burn?" },
            { heading: "Risks", body: "Churn is unknown." },
          ],
          gaps: ["Runway not on record"],
        });
      },
    });
    if (tool === null) throw new Error("absent");
    const out = await tool.execute(
      { artifactId: ID },
      { actor } as never,
      null,
    );
    expect(asked).toEqual([`u1:${ID}`]);
    expect(out).toEqual({
      status: "FOUND",
      title: "Prep questions for the call with Nixo",
      type: "Q_REPORT",
      version: 2,
      text: "Questions\n1. What is the burn?\n\nRisks\nChurn is unknown.",
      truncated: false,
      gaps: ["Runway not on record"],
    });
  });

  it("NONE when the service refuses or has nothing (not theirs, preparing)", async () => {
    const tool = createReadMyDocumentTool({
      list: () => Promise.resolve([]),
      read: () => Promise.reject(new Error("NOT_FOUND")),
    });
    if (tool === null) throw new Error("absent");
    expect(
      await tool.execute({ artifactId: ID }, { actor } as never, null),
    ).toMatchObject({ status: "NONE", text: null });
  });

  it("passes an explicit immutable version and retains public revision context", async () => {
    const read = vi.fn(() =>
      Promise.resolve({
        title: "Investment memo",
        type: "MEMO",
        version: 1,
        sections: [{ heading: "Summary", body: "Original wording." }],
        gaps: [],
        instruction:
          "Second-specialist review: distinguish stated traction from inference.",
        history: [
          {
            version: 1,
            title: "Investment memo",
            createdAt: "2026-10-12T00:00:00Z",
          },
        ],
      }),
    );
    const tool = createReadMyDocumentTool({
      list: () => Promise.resolve([]),
      read,
    });
    if (tool === null) throw new Error("absent");
    const input = tool.input.parse({ artifactId: ID, version: 1 });
    const out = await tool.execute(input, { actor } as never, null);
    expect(read).toHaveBeenCalledWith(actor, ID, 1);
    expect(out).toMatchObject({
      version: 1,
      instruction:
        "Second-specialist review: distinguish stated traction from inference.",
      history: [{ version: 1 }],
    });
  });

  it("never substitutes the latest document when a requested version is missing", async () => {
    const read = vi.fn(() => Promise.reject(new Error("NOT_FOUND")));
    const tool = createReadMyDocumentTool({
      list: () => Promise.resolve([]),
      read,
    });
    if (tool === null) throw new Error("absent");
    const input = tool.input.parse({ artifactId: ID, version: 99 });
    expect(await tool.execute(input, { actor } as never, null)).toMatchObject({
      status: "NONE",
      text: null,
    });
    expect(read).toHaveBeenCalledOnce();
    expect(read).toHaveBeenCalledWith(actor, ID, 99);
  });

  it("refuses a legacy reader returning latest when an immutable version was requested", async () => {
    const tool = createReadMyDocumentTool({
      list: () => Promise.resolve([]),
      read: () =>
        Promise.resolve({
          title: "Memo",
          type: "MEMO",
          version: 2,
          sections: [{ heading: "Summary", body: "Latest text." }],
          gaps: [],
        }),
    });
    if (tool === null) throw new Error("absent");
    expect(
      await tool.execute(
        tool.input.parse({ artifactId: ID, version: 1 }),
        { actor } as never,
        null,
      ),
    ).toMatchObject({ status: "NONE", text: null });
  });

  it("bounds newest-first history and keeps requested changes separate from applied text", async () => {
    const tool = createReadMyDocumentTool({
      list: () => Promise.resolve([]),
      read: () =>
        Promise.resolve({
          title: "Memo",
          type: "MEMO",
          version: 20,
          instruction: "Review: attribute the claim.",
          sections: [
            { heading: "Evidence", body: "The founder stated the claim." },
          ],
          gaps: [],
          history: Array.from({ length: 20 }, (_, i) => ({
            version: 20 - i,
            title: "Memo",
            createdAt: "2026-10-12T00:00:00Z",
          })),
        }),
    });
    if (tool === null) throw new Error("absent");
    const out = await tool.execute(
      { artifactId: ID },
      { actor } as never,
      null,
    );
    expect(out).toMatchObject({
      instruction: "Review: attribute the claim.",
      text: "Evidence\nThe founder stated the claim.",
    });
    const parsed = ReadMyDocumentOutputSchema.parse(out);
    expect(parsed.history).toHaveLength(12);
    expect(parsed.history?.[0]?.version).toBe(20);
    expect(parsed.history?.[11]?.version).toBe(9);
    expect(JSON.stringify(out)).not.toContain('"version":8');
    for (const version of [0, -1, 1.5])
      expect(tool.input.safeParse({ artifactId: ID, version }).success).toBe(
        false,
      );
  });

  it("offers own document reads for a named counterparty memo without widening ownership", () => {
    const registry = createQToolRegistry(
      createOwnWorkTools({
        documents: {
          list: () => Promise.resolve([]),
          read: () => Promise.resolve(null),
        },
      }),
    );
    const plan = planFor(actorA, "COUNTERPARTY_COMPANY_QUESTION", [
      { kind: "OWN_Q_CONVERSATION", sensitivity: "CONFIDENTIAL" },
    ]);
    expect(
      registry
        .eligible(contextFor(actorA, plan))
        .map((record) => record.definition.providerName),
    ).toEqual(
      expect.arrayContaining(["list_my_documents", "read_my_document"]),
    );
    expect(
      registry.eligible(contextFor(actorA, { ...plan, scopes: [] })),
    ).toEqual([]);
  });

  it("cuts a long document at a sentence and says so", () => {
    const long = documentText([
      { heading: "Body", body: "A sentence. ".repeat(3_000) },
    ]);
    expect(long.truncated).toBe(true);
    expect(long.text.length).toBeLessThanOrEqual(READ_MY_DOCUMENT_TEXT_MAX + 1);
  });
});
