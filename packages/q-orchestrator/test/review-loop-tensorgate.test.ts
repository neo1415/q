import { describe, expect, it } from "vitest";

import {
  gradeOf,
  pendingAsks,
  threadProblems,
  writeWithReview,
  type ReviewSheet,
} from "../src/index.js";

/**
 * Tensorgate, 2026-10-08 11:01 (job 6a3fae2d): Q's reply to Zino Aviation
 * was graded 45 (draft d369ae2e), redrafted into Zino's own question
 * (90f708da, "would you be open to connecting?"), graded 56, and held:
 * nothing reached Daniel. Fixtures are those drafts and the reviewer's
 * production sheet for draft 1, word for word.
 */

const ZINO =
  "Hello Tensorgate team — thank you for the invitation. Running LLM inference inside hardware enclaves and attesting every request addresses a concrete barrier for regulated firms using sensitive data. I’d be interested to hear how those firms are evaluating the gateway in practice. Would you be open to connecting?";
const DRAFT_1 =
  "Thanks for the thoughtful note, and for sharing your focus on B2B SaaS and enterprise software. Tensorgate is a policy gateway for LLM traffic in regulated industries: we have four design partners, two converted to $180k contracts, and 31m requests served. We’re raising a $4m seed. Happy to share the deck, and Daniel can come back on anything I can’t answer here. Would 20 minutes this week be useful?";
const DRAFT_2 =
  "Hello Zino team — your question about how regulated firms are evaluating the gateway is exactly the right one. In practice, our four design partners have tested it against operational requirements for sensitive LLM workloads; two have since converted to $180k annual contracts, and the platform has served 31m requests. We’re raising a $4m seed. I’d be happy to walk you through the evaluation process and share the deck ahead of our conversation—would you be open to connecting?";
/** What the v3 redraft is asked to write: answers, accepts with a time. */
const FIXED =
  "Thanks, Zino — glad the enclave approach resonates. On how regulated firms evaluate it: our four design partners tested the gateway on sensitive LLM workloads, two converted to $180k contracts, and it has served 31m requests. Daniel can walk you through the details on a call. Would Tuesday or Wednesday next week suit for 20 minutes? Happy to share the deck before then.";

const CRITERIA = [
  "WARM_OPENING",
  "ASK_TIMING",
  "ANSWERS_THEM",
  "CONCISE_AND_CALM",
  "READS_SIGNALS",
  "PERSONAL_STYLE",
] as const;
const RULES = [
  "GROUNDED",
  "NO_COMMITMENTS",
  "NOTHING_PRIVATE",
  "HONEST_IDENTITY",
  "RESPONDS_TO_THREAD",
] as const;

const sheet = (
  scores: readonly number[],
  respondsOk: boolean,
  feedback = "",
): ReviewSheet => ({
  criteria: CRITERIA.map((criterion, index) => ({
    criterion,
    score: scores[index] ?? 0,
    note: "",
  })),
  integrity: RULES.map((rule) => ({
    rule,
    ok: rule === "RESPONDS_TO_THREAD" ? respondsOk : true,
    note: "",
  })),
  feedback,
});

/** Production grade ade7a9ac for draft d369ae2e: 45, RESPONDS_TO_THREAD failed. */
const PROD_DRAFT_1 = sheet(
  [2, 1, 2, 4, 2, 3],
  false,
  "1. RESPONDS_TO_THREAD: It does not answer their open question and asks whether they want a meeting after they already said they would be interested in connecting.",
);
const GOOD = sheet([5, 5, 4, 4, 5, 4], true);

const asks = pendingAsks(ZINO);

describe("Tensorgate -> Zino Aviation, the 11:01 kick", () => {
  it("code reads Zino's message as an ask to connect and a question (no question mark needed)", () => {
    expect(asks.map((ask) => ask.kind)).toEqual(["MEETING", "QUESTION"]);
    expect(threadProblems(DRAFT_2, asks)).toEqual([
      expect.stringContaining("don't ask whether they are open to connecting"),
    ]);
    expect(threadProblems(DRAFT_1, asks)).toEqual([]);
    expect(threadProblems(FIXED, asks)).toEqual([]);
    expect(gradeOf(PROD_DRAFT_1, 75, { threadRule: true }).score).toBe(45);
  });

  it("the redraft that re-asks Zino's question never reaches the reviewer: code sends it back once, and the fixed reply passes", async () => {
    const reviewed: string[] = [];
    const feedbacks: string[] = [];
    let redrafts = 0;
    const outcome = await writeWithReview(
      DRAFT_1,
      {
        review: (body) => {
          reviewed.push(body);
          return Promise.resolve(body === DRAFT_1 ? PROD_DRAFT_1 : GOOD);
        },
        redraft: (_body, feedback) => {
          feedbacks.push(feedback);
          redrafts += 1;
          return Promise.resolve(redrafts === 1 ? DRAFT_2 : FIXED);
        },
        consistency: (body) => threadProblems(body, asks),
        threadRule: true,
      },
      { threshold: 75, maxRedrafts: 1 },
    );
    expect(outcome).toMatchObject({ verdict: "PASSED", body: FIXED });
    expect(reviewed).toEqual([DRAFT_1, FIXED]);
    expect(feedbacks[1]).toContain("open to connecting");
  });

  it("a code-clean draft just under the bar is handed back as a near miss for the person's card", async () => {
    const nearly = sheet([4, 3, 3, 4, 3, 4], true); // 69
    const outcome = await writeWithReview(
      FIXED,
      {
        review: () => Promise.resolve(nearly),
        redraft: () => Promise.resolve(DRAFT_2),
        consistency: (body) => threadProblems(body, asks),
        threadRule: true,
        nearMissPoints: 10,
      },
      { threshold: 75, maxRedrafts: 1 },
    );
    expect(outcome).toMatchObject({
      verdict: "HELD",
      reason: "THREAD_MISMATCH",
      body: FIXED,
      nearMiss: true,
    });
    expect(outcome.grade?.score).toBe(69);
  });

  it("no near miss unless asked, and never for a draft that failed an integrity rule or is far under", async () => {
    const nearly = sheet([4, 3, 3, 4, 3, 4], true);
    const plain = await writeWithReview(
      FIXED,
      {
        review: () => Promise.resolve(nearly),
        redraft: () => Promise.resolve(DRAFT_2),
        consistency: (body) => threadProblems(body, asks),
        threadRule: true,
      },
      { threshold: 75, maxRedrafts: 1 },
    );
    expect(plain).toMatchObject({ verdict: "HELD" });
    expect("nearMiss" in plain && plain.nearMiss === true).toBe(false);
    const production = await writeWithReview(
      DRAFT_1,
      {
        review: () => Promise.resolve(PROD_DRAFT_1),
        redraft: () => Promise.resolve(DRAFT_2),
        consistency: (body) => threadProblems(body, asks),
        threadRule: true,
        nearMissPoints: 10,
      },
      { threshold: 75, maxRedrafts: 1 },
    );
    expect(production).toMatchObject({ verdict: "HELD", body: DRAFT_2 });
    expect("nearMiss" in production && production.nearMiss === true).toBe(
      false,
    );
  });
});
