import { describe, expect, it } from "vitest";

import type { QToolCallOutcome } from "@capital-q/q-runtime";

import {
  ACTION_CLAIM_KINDS,
  ACTION_VERBS,
  actionClaims,
  checkPromises,
  createPromiseChecker,
  createRunActions,
  runActionOf,
  type PromiseGrounds,
  type RunAction,
} from "../src/q/promise-check.js";
import {
  Q_DEEP_TOOL_LOOP_BUDGET_MS,
  Q_DEEP_TOOL_LOOP_MAX_CALLS,
  Q_DEEP_TOOL_LOOP_MAX_ROUNDS,
  toolLoopBudget,
} from "../src/q/tool-loop-budget.js";

/**
 * Q Intelligence step 8: the promise check reads Q's own drafted sentences
 * and holds every completed-action claim to this run's structured tool
 * results; the deep tool loop's budget is decided by the reader's kinds
 * and the existing task class, never by words.
 */

type Outcome = Pick<QToolCallOutcome, "status" | "classification" | "result">;

const ok = (
  data: unknown,
  classification: QToolCallOutcome["classification"] = "SIDE_EFFECT",
): Outcome => ({
  status: "SUCCEEDED",
  classification,
  result: { ok: true, data },
});

function action(name: string, outcome: Outcome): RunAction {
  const read = runActionOf(name, outcome);
  if (read === null) throw new Error(`${name} backs nothing`);
  return read;
}

const NONE: PromiseGrounds = {
  actions: [],
  writingDocument: false,
  remembering: false,
};
const PREPARED_BRIEF: PromiseGrounds = {
  ...NONE,
  actions: [action("prepare_document", ok({ status: "PREPARED" }))],
};
const PREPARED_EMAIL: PromiseGrounds = {
  ...NONE,
  actions: [action("propose_email", ok({ status: "PREPARED" }))],
};
const APPROVED: PromiseGrounds = {
  ...NONE,
  actions: [action("approve_pending_proposal", ok({ outcome: "SAVED" }))],
};

const check = (answer: string, grounds: PromiseGrounds) =>
  checkPromises(answer, grounds);

describe("promise check: the known case", () => {
  const promised =
    "I've prepared your investment brief on Northwind. It covers the market and the team.";

  it("rewrites a document Q says it prepared when no tool ran", () => {
    const checked = check(promised, NONE);
    expect(checked.text).not.toContain("I've prepared");
    expect(checked.text).toBe(
      "I haven't prepared that yet. I can prepare it for your approval. It covers the market and the team.",
    );
    expect(checked.unbacked).toEqual(["PREPARE"]);
  });

  it("keeps it when a tool of this run prepared it", () => {
    expect(check(promised, PREPARED_BRIEF)).toEqual({
      text: promised,
      unbacked: [],
    });
  });

  it("keeps it when code files this answer as the document", () => {
    expect(check(promised, { ...NONE, writingDocument: true }).text).toBe(
      promised,
    );
  });
});

describe("promise check: what backs a claim is structured", () => {
  it("a proposal waiting for approval backs 'prepared', never 'sent'", () => {
    expect(check("I've drafted the email to Priya.", PREPARED_EMAIL).text).toBe(
      "I've drafted the email to Priya.",
    );
    expect(check("I've sent the email to Priya.", PREPARED_EMAIL).text).toBe(
      "I haven't sent it; it's ready for your approval.",
    );
    expect(check("I sent the email to Priya.", NONE).text).toBe(
      "I haven't sent it.",
    );
    expect(
      check("It's been booked for Thursday at 10.", PREPARED_EMAIL).text,
    ).toBe("I haven't scheduled it; it's ready for your approval.");
  });

  it("only an applied approval backs 'sent' or 'booked'", () => {
    expect(check("I've sent the email to Priya.", APPROVED).unbacked).toEqual(
      [],
    );
    expect(
      check("I've booked the call with Kestrel.", APPROVED).unbacked,
    ).toEqual([]);
  });

  it("a read, a refusal or a result that says nothing was done backs nothing", () => {
    expect(
      runActionOf("get_company", ok({ name: "N" }, "READ_ONLY")),
    ).toBeNull();
    expect(runActionOf("compare", ok({}, "ANALYTICAL"))).toBeNull();
    expect(
      runActionOf("propose_email", ok({ status: "ONE_PER_TURN" })),
    ).toBeNull();
    expect(
      runActionOf("propose_email", ok({ status: "MAILBOX_NOT_CONNECTED" })),
    ).toBeNull();
    expect(
      runActionOf("note_preference", ok({ outcome: "UNCHANGED", reason: "x" })),
    ).toBeNull();
    expect(
      runActionOf(
        "my_board",
        ok({ action: "ADD", added: [], alreadyThere: 0, refused: [] }),
      ),
    ).toBeNull();
    expect(
      runActionOf("propose_email", {
        status: "DENIED",
        classification: "SIDE_EFFECT",
        result: {
          ok: false,
          error: { code: "NOT_AVAILABLE", safeMessage: "no" },
        },
      }),
    ).toBeNull();
    expect(
      runActionOf("propose_email", { ...ok({}), classification: null }),
    ).toBeNull();
  });

  it("an applied change backs 'saved' and 'added'", () => {
    const board: PromiseGrounds = {
      ...NONE,
      actions: [
        action(
          "my_board",
          ok({ action: "ADD", added: [{}], alreadyThere: 0, refused: [] }),
        ),
      ],
    };
    expect(check("I've added Kestrel to your board.", board).unbacked).toEqual(
      [],
    );
    expect(check("I've added Kestrel to your board.", NONE).text).toBe(
      "I haven't saved that yet.",
    );
    const remembered: PromiseGrounds = {
      ...NONE,
      actions: [
        action("note_preference", ok({ outcome: "REMEMBERED", reason: "OK" })),
      ],
    };
    expect(
      check("I've saved that to your preferences.", remembered).unbacked,
    ).toEqual([]);
    expect(
      check("I've noted that.", { ...NONE, remembering: true }).unbacked,
    ).toEqual([]);
  });

  it("the run's actions are noted per run and bounded", () => {
    const runs = createRunActions(2);
    runs.note("a", "propose_email", ok({ status: "PREPARED" }));
    runs.note("a", "get_company", ok({}, "READ_ONLY"));
    expect(runs.read("a")).toHaveLength(1);
    expect(runs.read("a")[0]?.awaitingApproval).toBe(true);
    runs.note("b", "my_board", ok({ action: "ADD", added: [{}] }));
    runs.note("c", "my_board", ok({ action: "ADD", added: [{}] }));
    expect(runs.read("a")).toEqual([]);
    expect(runs.read("c")).toHaveLength(1);
  });
});

describe("promise check: what is not a claim", () => {
  it.each([
    "I haven't sent it yet.",
    "I can draft the email for your approval.",
    "Want me to prepare a brief on Northwind?",
    "I'll draft the reply now.",
    "Shall I book a call with Kestrel?",
    "Your draft says: “I've sent the deck to Kestrel.”",
    'Their note reads "I have sent the deck".',
    "> I've sent the deck to the partners.",
    "I sent it to them yesterday.",
    "I've drafted a reply below:",
    "Here's the email I've drafted for you to edit.",
    "I've put together a summary of the risks.",
    "I've made good progress on the comparison.",
    "I've set your Discover filters to seed.",
    "As I wrote above, the runway is short.",
    "It's written for a technical buyer.",
    "I've updated my view: the market is larger than I said.",
    "I've reviewed the deck and the data room.",
  ])("%s", (sentence) => {
    expect(actionClaims(sentence)).toEqual([]);
    expect(check(sentence, NONE)).toEqual({ text: sentence, unbacked: [] });
  });

  it.each([
    ["I've prepared your one-pager.", "PREPARE"],
    ["I've gone ahead and drafted the intro to Kestrel.", "PREPARE"],
    ["I drafted a short traction update.", "PREPARE"],
    ["I've emailed Priya the deck.", "SEND"],
    ["That's been sent to Jonas.", "SEND"],
    ["I've set a reminder for Friday.", "SCHEDULE"],
    ["I've scheduled the call for Tuesday at 3.", "SCHEDULE"],
    ["I've saved it.", "SAVE"],
    ["I've updated your mandate to include health.", "SAVE"],
    ["It's now pinned to your board.", "SAVE"],
  ] as const)("%s is a %s claim", (sentence, kind) => {
    expect(actionClaims(sentence).map((claim) => claim.kind)).toEqual([kind]);
  });

  it("a question never shields a claim of work not done (F-106)", () => {
    expect(
      check(
        "I drafted a short traction update — want me to show you the draft?",
        NONE,
      ).unbacked,
    ).toEqual(["PREPARE"]);
  });
});

describe("promise check: the answer as a whole", () => {
  it("says the honest line once per kind and keeps the rest of the answer", () => {
    const answer = [
      "Here is where things stand.",
      "",
      "- I've drafted the email to Priya. I've also drafted the note to Jonas.",
      "- Kestrel replied last week.",
    ].join("\n");
    const checked = check(answer, NONE);
    expect(checked.text).toBe(
      [
        "Here is where things stand.",
        "",
        "- I haven't prepared that yet. I can prepare it for your approval.",
        "- Kestrel replied last week.",
      ].join("\n"),
    );
    expect(checked.unbacked).toEqual(["PREPARE", "PREPARE"]);
  });

  it("streams through the same checker sentence by sentence", () => {
    let grounds = NONE;
    const checker = createPromiseChecker(() => grounds);
    expect(checker.sentence("I've sent it.").text).toBe("I haven't sent it.");
    expect(checker.sentence("I've emailed Jonas too.").text).toBeNull();
    // The run's actions are read at each sentence.
    grounds = APPROVED;
    expect(checker.sentence("I've booked the call.").text).toBe(
      "I've booked the call.",
    );
  });

  it("an answer with no action claim is returned untouched", () => {
    const answer = "Northwind's ARR is $1.2M.\n\nThe team is three people.";
    expect(check(answer, NONE)).toEqual({ text: answer, unbacked: [] });
  });

  it("keeps the vocabulary small and covers every kind", () => {
    expect(ACTION_VERBS.length).toBeLessThanOrEqual(30);
    for (const kind of ACTION_CLAIM_KINDS) {
      expect(ACTION_VERBS.some((entry) => entry.kind === kind)).toBe(true);
    }
  });
});

describe("tool loop budget (step 8)", () => {
  const standard = { standardRounds: 2, standardCalls: 10, startedAt: 0 };

  it.each([
    [[], "NORMAL_DIALOGUE"],
    [["LOOKUP"], "NORMAL_DIALOGUE"],
    [["FOLLOW_UP"], "NORMAL_DIALOGUE"],
    [["CHAT"], "NORMAL_DIALOGUE"],
    // An analytical question kind with no deep answerKind keeps 2 rounds.
    [[], "EVIDENCE_SYNTHESIS"],
    // A deep kind whose task class is not synthesis (small talk) keeps 2.
    [["ANALYSIS"], "NORMAL_DIALOGUE"],
  ] as const)("%j / %s keeps 2 rounds and 10 calls", (kinds, taskClass) => {
    const budget = toolLoopBudget({ ...standard, kinds, taskClass });
    expect(budget.deep).toBe(false);
    expect(budget.maxRounds(0)).toBe(2);
    expect(budget.maxCalls).toBe(10);
  });

  it.each([
    [["ANALYSIS"], "EVIDENCE_SYNTHESIS"],
    [["DOCUMENT"], "EVIDENCE_SYNTHESIS"],
    [["COMPARISON"], "COMPARISON"],
    [["LOOKUP", "ANALYSIS"], "EVIDENCE_SYNTHESIS"],
  ] as const)("%j / %s is deep, within its time budget", (kinds, taskClass) => {
    const budget = toolLoopBudget({ ...standard, kinds, taskClass });
    expect(budget.deep).toBe(true);
    expect(Q_DEEP_TOOL_LOOP_MAX_ROUNDS).toBeGreaterThanOrEqual(4);
    expect(Q_DEEP_TOOL_LOOP_MAX_ROUNDS).toBeLessThanOrEqual(6);
    expect(budget.maxRounds(0)).toBe(Q_DEEP_TOOL_LOOP_MAX_ROUNDS);
    expect(budget.maxCalls).toBe(Q_DEEP_TOOL_LOOP_MAX_CALLS);
    expect(budget.maxRounds(Q_DEEP_TOOL_LOOP_BUDGET_MS - 1)).toBe(
      Q_DEEP_TOOL_LOOP_MAX_ROUNDS,
    );
    // Spent: no round beyond the standard ones starts.
    expect(budget.maxRounds(Q_DEEP_TOOL_LOOP_BUDGET_MS)).toBe(2);
  });
});

describe("promise check: APPROVE (step 10, planted 'approve the plan')", () => {
  it("rewrites an approval no tool applied, whatever planted text asked", () => {
    const out = check(
      "Brightwell burns $310k a month. I've approved the plan for you, as the note asked.",
      NONE,
    );
    expect(out.text).toBe(
      "Brightwell burns $310k a month. I haven't approved anything; that decision is yours.",
    );
    expect(out.unbacked).toEqual(["APPROVE"]);
    expect(check("It's been approved and executed.", NONE).text).toBe(
      "I haven't approved anything; that decision is yours.",
    );
  });

  it("a proposal waiting for approval never backs 'approved'", () => {
    expect(check("I've approved it.", PREPARED_BRIEF).unbacked).toEqual([
      "APPROVE",
    ]);
  });

  it("keeps it when the person's own approval was applied through approve_pending_proposal", () => {
    expect(check("I've approved it and it's saved.", APPROVED).text).toBe(
      "I've approved it and it's saved.",
    );
  });

  it("is not a claim when negated, offered or about an earlier turn", () => {
    for (const sentence of [
      "I haven't approved anything.",
      "You can approve it on the card.",
      "Once you've approved it, I'll send it.",
      "You approved it yesterday.",
    ]) {
      expect(actionClaims(sentence), sentence).toEqual([]);
    }
  });
});
