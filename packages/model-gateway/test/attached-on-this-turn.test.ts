import { describe, expect, it } from "vitest";

import { attachedOnThisTurn } from "../src/q/attached-document-intent.js";

/**
 * Owner live 9 Nov: the composer sends every file of the conversation on
 * every turn. "What's this about?" means the one attached on this turn --
 * uploaded after their previous message -- whatever became of it.
 */

const read = (title: string, uploadedAt: string, status = "READ") => ({
  status,
  title,
  uploadedAt,
});

describe("the document attached on this turn", () => {
  const before = "2026-11-09T14:59:00.000Z";
  const previousTurn = "2026-11-09T15:00:33.000Z";
  const after = "2026-11-09T15:01:08.000Z";

  it("a file uploaded after their previous message, still being read, is this turn's", () => {
    expect(
      attachedOnThisTurn(
        [
          read("TERMS AND CONDITIONS", before),
          read("Talent Q", after, "READING"),
        ],
        previousTurn,
      ),
    ).toEqual({ titles: ["Talent Q"], state: "READING" });
  });

  it("files sent on earlier turns are not this turn's", () => {
    expect(
      attachedOnThisTurn([read("TERMS AND CONDITIONS", before)], previousTurn),
    ).toBeNull();
  });

  it("the first turn: any file read is this turn's; read wins over reading", () => {
    expect(
      attachedOnThisTurn(
        [
          read("A", after, "READING"),
          read("B", after),
          read("C", after, "UNREADABLE"),
        ],
        null,
      ),
    ).toEqual({ titles: ["B"], state: "READ" });
  });

  it("nothing found, or no time to go by, is nothing", () => {
    expect(
      attachedOnThisTurn([{ status: "NONE", title: null }, null], null),
    ).toBeNull();
    expect(
      attachedOnThisTurn([read("X", "not a time")], previousTurn),
    ).toBeNull();
  });
});
