import { describe, expect, it } from "vitest";

import { createSentenceCutter, streamedPiece } from "@capital-q/q-core";

import {
  checkTableRow,
  claimCorpus,
  checkAnswer,
  createClaimChecker,
  NOT_KNOWN_CELL,
} from "../src/q/claim-check.js";
import { streamRetractions } from "../src/q/stream-fidelity.js";

/**
 * HQ-6: stream fidelity (table rows, retractions), deterministic.
 */
describe("HQ-6: a table row streams as its own unit, cell by cell", () => {
  it("cuts a row on its own newline, never inside it", () => {
    const cutter = createSentenceCutter();
    const out = [
      ...cutter.push("Here is how they compare:\n| Company | ARR | Stage |\n"),
      ...cutter.push(
        "| Maji Loop | $420k | Seed |\n| Baridi | 3.5x. Inc. | A |\n",
      ),
    ];
    expect(out).toEqual([
      "Here is how they compare:",
      "| Company | ARR | Stage |",
      "| Maji Loop | $420k | Seed |",
      "| Baridi | 3.5x. Inc. | A |",
    ]);
    expect(cutter.rest()).toBeNull();
  });

  it("an unfinished row waits for its newline", () => {
    const cutter = createSentenceCutter();
    expect(cutter.push("| Maji Loop | $4")).toEqual([]);
    expect(cutter.push("20k |\n")).toEqual(["| Maji Loop | $420k |"]);
  });

  it("a list line closes on its newline", () => {
    const cutter = createSentenceCutter();
    expect(cutter.push("- Revenue is company-reported\n- Next")).toEqual([
      "- Revenue is company-reported",
    ]);
  });

  it("an invented figure in a row becomes a not-known cell; the row stays", () => {
    const checker = createClaimChecker(() => [
      "Maji Loop's stated annual revenue is $420,000.",
    ]);
    const header = checker.sentence("| Company | Revenue |");
    expect(header.text).toBe("| Company | Revenue |");
    const row = checker.sentence("| Maji Loop | $9.7m |");
    expect(row.text).toBe(`| Maji Loop | ${NOT_KNOWN_CELL} |`);
    expect(row.ungrounded.length).toBeGreaterThan(0);
    const grounded = checker.sentence("| Maji Loop | $420,000 |");
    expect(grounded.text).toBe("| Maji Loop | $420,000 |");
  });

  it("the stored answer keeps the same rows the stream showed", () => {
    const corpus = claimCorpus([
      "Maji Loop's stated annual revenue is $420,000.",
    ]);
    const stored = checkAnswer(
      "| Company | Revenue |\n| --- | --- |\n| Maji Loop | $9.7m |",
      corpus,
    );
    expect(stored.text).toBe(
      `| Company | Revenue |\n| --- | --- |\n| Maji Loop | ${NOT_KNOWN_CELL} |`,
    );
  });

  it("separator rows pass as they are; a non-row is not a row", () => {
    expect(
      checkTableRow("| --- | :---: |", () => ({ text: null, ungrounded: [] }))
        ?.text,
    ).toBe("| --- | :---: |");
    expect(
      checkTableRow("Just a sentence.", () => ({ text: "", ungrounded: [] })),
    ).toBeNull();
  });

  it("rows stream as one table: a single newline between rows, a blank line around it", () => {
    expect(streamedPiece("| A | B |", false, "Here it is:")).toBe(
      "\n\n| A | B |",
    );
    expect(streamedPiece("| 1 | 2 |", false, "| A | B |")).toBe("\n| 1 | 2 |");
    expect(streamedPiece("After the table.", false, "| 1 | 2 |")).toBe(
      "\n\nAfter the table. ",
    );
  });
});

describe("HQ-6: retractions are counted by kind, never the words", () => {
  it("counts streamed sentences the stored answer no longer holds", () => {
    const counted = streamRetractions(
      [
        "Maji Loop is a seed-stage cold-chain company.",
        "It made $4m last year.",
        "Its revenue is company-reported.",
      ],
      "Maji Loop is a seed-stage cold-chain company. Its revenue is company-reported.",
    );
    expect(counted).toEqual({ count: 1, kinds: { FIGURE: 1, TEXT: 0 } });
    expect(JSON.stringify(counted)).not.toContain("$4m");
  });

  it("formatting differences are not retractions", () => {
    expect(
      streamRetractions(
        ["**Maji Loop** is seed-stage."],
        "Maji Loop is seed-stage.",
      ).count,
    ).toBe(0);
  });
});
