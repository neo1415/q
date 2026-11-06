import { describe, expect, it } from "vitest";

import { claimCorpus, groundText } from "@capital-q/model-gateway/q";

import { writeWithReview, type ReviewSheet } from "../src/index.js";

/**
 * Q Intelligence Plan, step 10: the workforce writer and reviewer work
 * from the same authorised material, and code's claim check (step 6) runs
 * on every draft before the reviewer reads it. A figure or name the
 * material does not hold never reaches the reviewer, the record or the
 * other side.
 */

const MATERIAL = [
  "A founder writing to investors about their company.",
  "- what they do: Tensorgate is a policy gateway for LLM traffic in regulated industries (source: your company profile)",
  "- traction: four design partners; two converted to $180k contracts; 31m requests served (source: your company profile)",
].join("\n");
const THREAD =
  "Zino Aviation: How are regulated firms evaluating the gateway in practice?";
const corpus = claimCorpus([MATERIAL, THREAD, "Daniel", "Zino Aviation"]);
const ground = (body: string): string | null => {
  const out = groundText(body, corpus, { unknownLine: false });
  return out.text.length === 0 ? null : out.text;
};

const GOOD: ReviewSheet = {
  criteria: (
    [
      "WARM_OPENING",
      "ASK_TIMING",
      "ANSWERS_THEM",
      "CONCISE_AND_CALM",
      "READS_SIGNALS",
      "PERSONAL_STYLE",
    ] as const
  ).map((criterion) => ({ criterion, score: 5, note: "" })),
  integrity: (
    [
      "GROUNDED",
      "NO_COMMITMENTS",
      "NOTHING_PRIVATE",
      "HONEST_IDENTITY",
    ] as const
  ).map((rule) => ({ rule, ok: true, note: "" })),
  feedback: "",
};

describe("writeWithReview with code's claim check (step 10)", () => {
  it("the reviewer, the record and the sent text never carry an invented figure", async () => {
    const reviewed: string[] = [];
    const recorded: string[] = [];
    const outcome = await writeWithReview(
      "Thanks for asking. Two of our four design partners converted to $180k contracts. We're raising a $4m seed at a $20m cap. Daniel can walk you through it.",
      {
        review: (body) => {
          reviewed.push(body);
          return Promise.resolve(GOOD);
        },
        redraft: () => Promise.resolve(null),
        ground,
        onDraft: (draft) => {
          recorded.push(draft.body);
          return Promise.resolve("draft-1");
        },
      },
    );
    const clean =
      "Thanks for asking. Two of our four design partners converted to $180k contracts. Daniel can walk you through it.";
    expect(outcome).toMatchObject({ verdict: "PASSED", body: clean });
    expect(reviewed).toEqual([clean]);
    expect(recorded).toEqual([clean]);
  });

  it("an invented name in a redraft is taken out before the reviewer reads it", async () => {
    const reviewed: string[] = [];
    let first = true;
    const outcome = await writeWithReview(
      "Thanks for asking about evaluation.",
      {
        review: (body) => {
          reviewed.push(body);
          if (first) {
            first = false;
            return Promise.resolve({
              ...GOOD,
              criteria: GOOD.criteria.map((one) => ({ ...one, score: 2 })),
            });
          }
          return Promise.resolve(GOOD);
        },
        redraft: () =>
          Promise.resolve(
            "Thanks for asking. Lagos Federal Bank ran it on sensitive workloads. It has served 31m requests.",
          ),
        ground,
      },
      { threshold: 75, maxRedrafts: 1 },
    );
    expect(outcome).toMatchObject({
      verdict: "PASSED",
      body: "Thanks for asking. It has served 31m requests.",
    });
    expect(reviewed.at(-1)).not.toContain("Lagos Federal Bank");
  });

  it("a draft with nothing grounded is held as INTEGRITY, never reviewed or sent", async () => {
    let reviews = 0;
    const outcome = await writeWithReview(
      "Our ARR is $2.4M and we have 18 months of runway.",
      {
        review: () => {
          reviews += 1;
          return Promise.resolve(GOOD);
        },
        redraft: () => Promise.resolve(null),
        ground,
        onDraft: () => Promise.resolve("held-draft"),
      },
    );
    expect(outcome).toMatchObject({
      verdict: "HELD",
      reason: "INTEGRITY",
      draftId: "held-draft",
    });
    expect(reviews).toBe(0);
  });

  it("without a ground port, the loop is unchanged", async () => {
    const outcome = await writeWithReview("We're raising a $4m seed.", {
      review: () => Promise.resolve(GOOD),
      redraft: () => Promise.resolve(null),
    });
    expect(outcome).toMatchObject({
      verdict: "PASSED",
      body: "We're raising a $4m seed.",
    });
  });
});
