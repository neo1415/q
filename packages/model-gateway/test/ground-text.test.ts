import { describe, expect, it } from "vitest";

import {
  checkSentence,
  claimCorpus,
  groundText,
} from "../src/q/claim-check.js";

const TODAY = new Date("2026-11-06T12:00:00Z");

// Q Intelligence Plan, step 10: what a workforce writer was given.
const MATERIAL = [
  "A founder writing to investors about their company.",
  "- what they do: Kestrel Grid builds battery monitoring for mini-grids (source: your company profile)",
  "- stage: Seed (source: your company profile)",
  "- annual recurring revenue: $420,000 (source: your company profile)",
].join("\n");
const THREAD = "Ngozi Eze: Thanks for reaching out. What is your ARR today?";

describe("groundText (workforce messages and documents)", () => {
  const corpus = claimCorpus([MATERIAL, THREAD], TODAY);

  it("keeps a message whose every figure and name is in the material", () => {
    const body =
      "Hi Ngozi, thanks for asking. Kestrel Grid's ARR is $420k today, and we're at Seed.";
    const out = groundText(body, corpus, { unknownLine: false });
    expect(out.text).toBe(body);
    expect(out.changed).toBe(0);
    expect(out.ungrounded).toEqual([]);
  });

  it("removes an invented figure without Q's own unknown line", () => {
    const out = groundText(
      "Hi Ngozi, thanks for asking. Our ARR is $1.4M and runway is 18 months. Happy to share more.",
      corpus,
      { unknownLine: false },
    );
    expect(out.text).toBe("Hi Ngozi, thanks for asking. Happy to share more.");
    expect(out.changed).toBe(1);
    expect(out.ungrounded).toContain("MONEY");
    expect(out.text).not.toMatch(/sourced figure/u);
  });

  it("removes an invented name the material never held", () => {
    const out = groundText(
      "We already work with Sahara Power Partners. Kestrel Grid is at Seed.",
      corpus,
      { unknownLine: false },
    );
    expect(out.text).toBe("Kestrel Grid is at Seed.");
    expect(out.ungrounded).toEqual(["NAME"]);
  });

  it("leaves names alone when asked to check figures only", () => {
    const out = groundText(
      "Competitors include Sahara Power Partners. The market grew 37% last year.",
      corpus,
      { unknownLine: false, names: false },
    );
    expect(out.text).toBe("Competitors include Sahara Power Partners.");
    expect(out.ungrounded).toEqual(["PERCENT"]);
  });

  it("keeps an exempt (labelled) sentence and nothing invented besides", () => {
    const out = groundText(
      "- Serviceable market of $90M (estimate: 3,000 sites at $30k).\n- Revenue was $9M last year.",
      corpus,
      {
        unknownLine: false,
        exempt: (sentence) => /\(estimate:/u.test(sentence),
      },
    );
    expect(out.text).toBe(
      "- Serviceable market of $90M (estimate: 3,000 sites at $30k).",
    );
  });

  it("returns an empty text when nothing is grounded (never NOTHING_SOURCED)", () => {
    const out = groundText("Our ARR is $3M.", corpus, { unknownLine: false });
    expect(out.text).toBe("");
  });

  it("keeps the answer path's defaults unchanged", () => {
    const said = new Set<string>();
    expect(checkSentence("Our ARR is $3M.", corpus, said).text).toBe(
      "I don't have a sourced figure for ARR yet.",
    );
  });
});
