import { describe, expect, it } from "vitest";

import {
  readersDraft,
  readersWords,
} from "../src/composition/workforce/analysis.js";

/**
 * Live 2026-10-30 (artifact 008da91c): an investor's report summary said
 * "the supplied evidence does not establish ...", the writer's name for
 * its own inputs. Said as "the evidence" after the last model call, so no
 * prompt and no recorded research case changes.
 */
describe("the report in the reader's words", () => {
  it("drops the writer's 'supplied' and keeps the sentence whole", () => {
    expect(
      readersWords(
        "The supplied evidence does not establish the B2B share, revenue pool or demand.",
      ),
    ).toBe(
      "The evidence does not establish the B2B share, revenue pool or demand.",
    );
    expect(
      readersWords("Unknown from supplied evidence; request legal opinion."),
    ).toBe("Unknown from the evidence; request legal opinion.");
    expect(
      readersWords(
        "It is not shown in the supplied research, but the supplied record names it.",
      ),
    ).toBe("It is not shown in the research, but the record names it.");
    expect(readersWords("No supplied source gives a size.")).toBe(
      "No source gives a size.",
    );
    expect(readersWords("Supplied evidence is thin.")).toBe(
      "Evidence is thin.",
    );
  });

  it("leaves every other use of the word alone", () => {
    const text =
      "Merchants supplied by distributors; the company supplied figures on request.";
    expect(readersWords(text)).toBe(text);
  });

  it("covers every part of the filed draft", () => {
    const draft = readersDraft({
      title: "Nigerian B2B payments",
      summary: "The supplied evidence supports the product patterns.",
      sections: [
        { heading: "Market", body: "Unknown from supplied evidence." },
      ],
      topRecommendations: ["Ask beyond the supplied sources."],
      gaps: ["Not in the supplied facts."],
    });
    expect(draft.summary).toBe("The evidence supports the product patterns.");
    expect(draft.sections[0]?.body).toBe("Unknown from the evidence.");
    expect(draft.topRecommendations[0]).toBe("Ask beyond the sources.");
    expect(draft.gaps[0]).toBe("Not in the facts.");
  });
});
