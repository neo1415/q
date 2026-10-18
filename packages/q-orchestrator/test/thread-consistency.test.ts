import { describe, expect, it } from "vitest";

import { DraftReviewResultV2Schema } from "@capital-q/q-core";

import {
  asksLine,
  gradeOf,
  pendingAsks,
  threadProblems,
  writeWithReview,
  type ReviewSheet,
} from "../src/index.js";

/**
 * Thread consistency (Zino, 2026-10-08). Fixtures are the seeded founders'
 * messages and the replies Q actually sent on staging on 2026-10-07
 * (communication.messages), word for word.
 */
const TENSORGATE =
  "Thanks for connecting. Tensorgate is a policy gateway for LLM traffic in regulated industries: 4 design partners, 2 converted to $180k contracts, 31m requests served. Raising a $4m seed. Want the deck, or 20 minutes this week? Daniel";
const TENSORGATE_SENT =
  "Hello Tensorgate team — thank you for the invitation. Running LLM inference inside hardware enclaves and attesting every request addresses a concrete barrier for regulated firms using sensitive data. I’d be interested to hear how those firms are evaluating the gateway in practice. Would you be open to connecting?";
const LEDGERLINE =
  "Hi Zino, thanks for connecting. Ledgerline checks invoices at creation and files VAT for 1,140 Nigerian SMEs; we are raising a $1.8m seed. Happy to share the deck or find 20 minutes this week if useful. Tobenna";
const SHIFTWELL =
  "Thanks for connecting. Shiftwell runs scheduling and same-day pay for home-care agencies: $4.1m ARR, 290 agencies, 38,000 caregivers paid. We are raising a $15m Series A. Happy to send the deck or set up a call. Megan";
const CLEARWATER =
  "Good afternoon. Thank you for connecting. Clearwater Assurance validates credit-risk models for UK lenders: £2.4m ARR across seven banks and building societies, 132% net revenue retention. We are raising a £9m Series A. I would be glad to share our validation methodology or arrange a call at your convenience.";

describe("pendingAsks", () => {
  it("reads Tensorgate's offer as a meeting and a deck, not a question", () => {
    expect(pendingAsks(TENSORGATE)).toEqual([
      { kind: "MEETING", thing: null },
      { kind: "DOCUMENT", thing: "deck" },
    ]);
  });

  it("reads the other three founders' offers the same way", () => {
    expect(pendingAsks(LEDGERLINE).map((ask) => ask.kind)).toEqual([
      "MEETING",
      "DOCUMENT",
    ]);
    expect(pendingAsks(SHIFTWELL).map((ask) => ask.kind)).toEqual([
      "MEETING",
      "DOCUMENT",
    ]);
    expect(pendingAsks(CLEARWATER)).toEqual([
      { kind: "MEETING", thing: null },
      { kind: "DOCUMENT", thing: "methodology" },
    ]);
  });

  it("finds a plain question, and nothing in a thank-you or an empty thread", () => {
    expect(pendingAsks("What is your typical cheque size?")).toEqual([
      { kind: "QUESTION", thing: null },
    ]);
    expect(pendingAsks("Thanks, great to e-meet you.")).toEqual([]);
    expect(pendingAsks(null)).toEqual([]);
    expect(pendingAsks("   ")).toEqual([]);
  });

  it("describes the asks in code's own words, never theirs", () => {
    const line = asksLine(pendingAsks(TENSORGATE));
    expect(line).toBe(
      "They offered or asked for a call or a meeting. They offered to send a document (deck).",
    );
    expect(line).not.toContain("Daniel");
    expect(asksLine([])).toBe("None.");
  });
});

describe("threadProblems", () => {
  it("rejects the reply Q actually sent Tensorgate", () => {
    const problems = threadProblems(TENSORGATE_SENT, pendingAsks(TENSORGATE));
    expect(problems).toHaveLength(2);
    expect(problems[0]).toContain(
      "don't ask whether they are open to connecting",
    );
    expect(problems[1]).toContain("deck");
  });

  it("passes a reply that takes the call and the deck", () => {
    const reply =
      "Hi Daniel, thanks for the clear note. 20 minutes this week works well, and please do send the deck ahead so I can come prepared. Which time suits you?";
    expect(threadProblems(reply, pendingAsks(TENSORGATE))).toEqual([]);
  });

  it("passes a polite decline of both, and a booked time", () => {
    const asks = pendingAsks(SHIFTWELL);
    expect(
      threadProblems(
        "Thanks Megan. It's early for a call on my side; the deck would be welcome first.",
        asks,
      ),
    ).toEqual([]);
    expect(
      threadProblems(
        "Thanks Megan, please send the deck. Thursday 14:00 Lagos works for a call.",
        asks,
      ),
    ).toEqual([]);
  });

  it("flags a reply that ignores the meeting altogether", () => {
    const problems = threadProblems(
      "Thank you, the validation methodology sounds useful; please share it.",
      pendingAsks(CLEARWATER),
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("doesn't respond to it");
  });

  it("leaves a first message alone: nothing is open yet", () => {
    expect(
      threadProblems("Would you be open to connecting?", pendingAsks("")),
    ).toEqual([]);
  });
});

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
      "RESPONDS_TO_THREAD",
    ] as const
  ).map((rule) => ({ rule, ok: true, note: "" })),
  feedback: "",
};

describe("writer -> reviewer with the thread check", () => {
  const asks = pendingAsks(TENSORGATE);

  it("sends the Tensorgate draft back with the concrete fixes and passes the fixed redraft", async () => {
    const fixes: string[] = [];
    const fixed =
      "Hi Daniel, 20 minutes this week works, and please send the deck. Which time suits you?";
    const outcome = await writeWithReview(TENSORGATE_SENT, {
      // A reviewer that would have passed it: code's check still holds it.
      review: () => Promise.resolve(GOOD),
      redraft: (_body, feedback) => {
        fixes.push(feedback);
        return Promise.resolve(fixed);
      },
      consistency: (body) => threadProblems(body, asks),
      threadRule: true,
    });
    expect(outcome.verdict).toBe("PASSED");
    expect(outcome.body).toBe(fixed);
    expect(outcome.attempts).toBe(2);
    expect(fixes).toHaveLength(1);
    expect(fixes[0]).toMatch(/^1\. They already offered or asked for a call/u);
    expect(fixes[0]).toMatch(/\n2\. They offered to send the deck/u);
  });

  it("holds after two rounds with THREAD_MISMATCH, however many redrafts a job allows", async () => {
    let reviews = 0;
    const outcome = await writeWithReview(
      TENSORGATE_SENT,
      {
        review: () => {
          reviews += 1;
          return Promise.resolve(GOOD);
        },
        redraft: () =>
          Promise.resolve("Thanks! Would you be open to connecting?"),
        consistency: (body) => threadProblems(body, asks),
        threadRule: true,
      },
      { threshold: 75, maxRedrafts: 5 },
    );
    expect(outcome.verdict).toBe("HELD");
    expect(outcome.verdict === "HELD" ? outcome.reason : null).toBe(
      "THREAD_MISMATCH",
    );
    expect(outcome.attempts).toBe(2);
    // Tensorgate, 8 Oct: code's check runs on the redraft (and on its one
    // code-fix) before the reviewer: a re-ask never spends a review.
    expect(reviews).toBe(1);
    // What is recorded for the person is the fix list, not a bare score.
    expect(outcome.grade?.feedback).toContain("open to connecting");
  });

  it("holds when the reviewer finds it doesn't respond, even with a high score", async () => {
    const outcome = await writeWithReview(
      "Hi Daniel, thanks. How are design partners finding it?",
      {
        review: () =>
          Promise.resolve({
            ...GOOD,
            integrity: GOOD.integrity.map((one) =>
              one.rule === "RESPONDS_TO_THREAD"
                ? { ...one, ok: false, note: "Ignores the call they offered." }
                : one,
            ),
          }),
        redraft: () => Promise.resolve("Hi Daniel, how is it going?"),
        threadRule: true,
      },
    );
    expect(outcome.verdict === "HELD" ? outcome.reason : null).toBe(
      "THREAD_MISMATCH",
    );
  });

  it("requires RESPONDS_TO_THREAD only when something is open", () => {
    const fourRules: ReviewSheet = {
      ...GOOD,
      integrity: GOOD.integrity.filter(
        (one) => one.rule !== "RESPONDS_TO_THREAD",
      ),
    };
    expect(gradeOf(fourRules, 75).passed).toBe(true);
    expect(gradeOf(fourRules, 75, { threadRule: true }).passed).toBe(false);
  });
});

describe("the reviewer's grade is never refused for its length", () => {
  it("accepts a 350-character note and code cuts it to the record's 300", () => {
    const long = "x".repeat(350);
    const parsed = DraftReviewResultV2Schema.parse({
      ...GOOD,
      criteria: GOOD.criteria.map((one) => ({ ...one, note: long })),
      feedback: "y".repeat(1_500),
    });
    const grade = gradeOf(parsed, 75);
    expect(grade.criteria[0]?.note).toHaveLength(300);
    expect(grade.feedback).toHaveLength(1_000);
    expect(grade.passed).toBe(true);
  });
});
