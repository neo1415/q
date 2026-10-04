import { describe, expect, it } from "vitest";

import {
  createReadMyDocumentTool,
  documentText,
  READ_MY_DOCUMENT_TEXT_MAX,
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

  it("cuts a long document at a sentence and says so", () => {
    const long = documentText([
      { heading: "Body", body: "A sentence. ".repeat(3_000) },
    ]);
    expect(long.truncated).toBe(true);
    expect(long.text.length).toBeLessThanOrEqual(READ_MY_DOCUMENT_TEXT_MAX + 1);
  });
});
