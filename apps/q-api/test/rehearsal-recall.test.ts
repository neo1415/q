import { describe, expect, it } from "vitest";

import type { DatabaseExecutor } from "@capital-q/database";
import {
  createMemoryService,
  NO_REHEARSALS_LINE,
  REHEARSALS_LABEL,
  renderMemoryBundle,
  type MemoryRepository,
} from "@capital-q/q-knowledge";
import { ActorContextSchema } from "@capital-q/security";

import {
  createRehearsalRecallPort,
  rehearsalDigestOf,
} from "../src/composition/rehearsal-recall.js";

/**
 * The founder journey (2026-10-12): "You helped me prepare my pitch last
 * week. What did I struggle with, and what should I practise before
 * tomorrow's investor meeting?" Q's recall carries the founder's own
 * rehearsal reviews -- what went wrong, what went well, what to practise,
 * dated and labelled as coaching -- and never anyone else's.
 */

const TENANT = "c0000000-0000-4000-8000-000000000001";
const OTHER_TENANT = "c0000000-0000-4000-8000-000000000002";
const FOUNDER = "b0000000-0000-4000-8000-000000000001";
const OTHER_USER = "b0000000-0000-4000-8000-000000000002";
const ASKED =
  "You helped me prepare my pitch last week. What did I struggle with, and what should I practise before tomorrow's investor meeting?";

const founder = ActorContextSchema.parse({
  userId: FOUNDER,
  tenantId: TENANT,
  actorType: "HUMAN",
});

function review(struggle: string) {
  return {
    overall: "The story is clear; the numbers need sourcing.",
    dimensions: [
      { name: "CLARITY", rating: "STRONG", note: "Crisp problem." },
      { name: "EVIDENCE", rating: "NEEDS_WORK", note: "Unsourced churn." },
    ],
    wentRight: [{ moment: "The opening story.", why: "Concrete customer." }],
    wentWrong: [
      {
        moment: struggle,
        why: "A moving number reads as not knowing it.",
        better: "Give the trailing-twelve-month figure and its source.",
      },
    ],
    tips: ["Say the ask in one sentence with amount and use."],
  };
}

type StoredRow = {
  id: string;
  user_id: string;
  tenant_id: string;
  status: "ACTIVE" | "FINISHED";
  counterpart_name: string;
  difficulty: string;
  outcome: string | null;
  score: number | null;
  scorecard: unknown;
  at: Date;
};

const TABLE: StoredRow[] = [
  {
    id: "r-own-new",
    user_id: FOUNDER,
    tenant_id: TENANT,
    status: "FINISHED",
    counterpart_name: "Amara Okafor",
    difficulty: "TOUGH",
    outcome: "STRONG_LATER",
    score: 64,
    scorecard: {
      ...review("You hesitated on churn when pushed."),
      presence: [{ observation: "Looked down.", tip: "Look up." }],
    },
    at: new Date("2026-10-05T14:00:00Z"),
  },
  {
    id: "r-own-old",
    user_id: FOUNDER,
    tenant_id: TENANT,
    status: "FINISHED",
    counterpart_name: "Amara Okafor",
    difficulty: "REALISTIC",
    outcome: "INDECISIVE",
    score: 47,
    scorecard: review("You could not say how big the round was."),
    at: new Date("2026-09-30T10:00:00Z"),
  },
  {
    id: "r-other-user",
    user_id: OTHER_USER,
    tenant_id: TENANT,
    status: "FINISHED",
    counterpart_name: "Someone",
    difficulty: "GENTLE",
    outcome: null,
    score: 90,
    scorecard: review("OTHER USER SECRET STRUGGLE"),
    at: new Date("2026-10-06T10:00:00Z"),
  },
  {
    id: "r-other-tenant",
    user_id: FOUNDER,
    tenant_id: OTHER_TENANT,
    status: "FINISHED",
    counterpart_name: "Someone",
    difficulty: "GENTLE",
    outcome: null,
    score: 90,
    scorecard: review("OTHER TENANT SECRET STRUGGLE"),
    at: new Date("2026-10-07T10:00:00Z"),
  },
];

/**
 * A stand-in for the one query the port runs: it applies the bound user,
 * tenant and limit the way the SQL does, so a port that keyed on anything
 * else would read the wrong rows here too.
 */
function fakeSql(table: readonly StoredRow[]) {
  const calls: { text: string; values: unknown[] }[] = [];
  const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    calls.push({ text: strings.join("?"), values });
    const [userId, tenantId, limit] = values as [string, string, number];
    const rows = table
      .filter(
        (r) =>
          r.user_id === userId &&
          r.tenant_id === tenantId &&
          r.status === "FINISHED" &&
          r.scorecard !== null &&
          (r.scorecard as { provisional?: unknown }).provisional !== true,
      )
      .sort((a, b) => b.at.getTime() - a.at.getTime())
      .slice(0, limit);
    return Promise.resolve(rows);
  }) as unknown as DatabaseExecutor;
  return { sql, calls };
}

const emptyRepository = {
  listLive: () => Promise.resolve([]),
  markUsed: () => Promise.resolve(),
} as unknown as MemoryRepository;

function memoryOver(table: readonly StoredRow[]) {
  const { sql, calls } = fakeSql(table);
  const memory = createMemoryService({
    sql,
    transactions: { run: () => Promise.reject(new Error("no writes")) },
    repository: emptyRepository,
    rehearsals: createRehearsalRecallPort(sql),
  });
  return { memory, calls };
}

describe("rehearsal recall for the founder's own pitch practice", () => {
  it("renders the founder's own struggles, dated and labelled, newest first", async () => {
    const { memory, calls } = memoryOver(TABLE);
    const text = renderMemoryBundle(
      await memory.recall({ actor: founder, utterance: ASKED }),
    );
    expect(text.startsWith(REHEARSALS_LABEL)).toBe(true);
    expect(text).toContain("Struggled: You hesitated on churn when pushed.");
    expect(text).toContain(
      "Struggled: You could not say how big the round was.",
    );
    expect(text.indexOf("2026-10-05")).toBeLessThan(text.indexOf("2026-09-30"));
    expect(text).toContain("score 64/100");
    expect(text).toContain("score 47/100");
    expect(text).toContain("Needed work: evidence");
    expect(text).toContain("Strong: clarity");
    expect(text).toContain(
      "Practise: Say the ask in one sentence with amount and use.",
    );
    // Keyed on the actor, and only on the actor.
    expect(calls).toHaveLength(1);
    expect(calls[0]?.values.slice(0, 2)).toEqual([FOUNDER, TENANT]);
    expect(calls[0]?.text).toContain("user_id = ? and tenant_id = ?");
  });

  it("never shows another user's or another tenant's rehearsals", async () => {
    const { memory } = memoryOver(TABLE);
    const text = renderMemoryBundle(
      await memory.recall({ actor: founder, utterance: ASKED }),
    );
    expect(text).not.toContain("OTHER USER SECRET STRUGGLE");
    expect(text).not.toContain("OTHER TENANT SECRET STRUGGLE");

    const other = ActorContextSchema.parse({
      userId: OTHER_USER,
      tenantId: TENANT,
      actorType: "HUMAN",
    });
    const theirs = renderMemoryBundle(
      await memory.recall({ actor: other, utterance: ASKED }),
    );
    expect(theirs).toContain("OTHER USER SECRET STRUGGLE");
    expect(theirs).not.toContain("You hesitated on churn");
  });

  it("says none on record when the founder has no reviewed rehearsals", async () => {
    const { memory } = memoryOver([
      {
        ...(TABLE[0] as StoredRow),
        scorecard: { provisional: true, overall: "Held.", tips: [] },
      },
    ]);
    const text = renderMemoryBundle(
      await memory.recall({ actor: founder, utterance: ASKED }),
    );
    expect(text).toBe(NO_REHEARSALS_LINE);
  });

  it("reads nothing for a turn that is not about practice", async () => {
    const { memory, calls } = memoryOver(TABLE);
    const text = renderMemoryBundle(
      await memory.recall({
        actor: founder,
        utterance: "What is Tensorgate's runway?",
      }),
    );
    expect(calls).toHaveLength(0);
    expect(text).toBe("");
  });
});

describe("a stored review becomes a digest field by field", () => {
  it("skips provisional, missing and unreadable reviews rather than guessing", () => {
    const row = TABLE[1] as StoredRow;
    expect(rehearsalDigestOf({ ...row, scorecard: null })).toBeNull();
    expect(
      rehearsalDigestOf({
        ...row,
        scorecard: { provisional: true, overall: "x", tips: [] },
      }),
    ).toBeNull();
    expect(rehearsalDigestOf({ ...row, scorecard: { overall: 3 } })).toBeNull();
    expect(rehearsalDigestOf(row)).toMatchObject({
      rehearsalId: "r-own-old",
      at: "2026-09-30T10:00:00.000Z",
      needsWork: ["EVIDENCE"],
      strong: ["CLARITY"],
      wentRight: ["The opening story."],
    });
  });
});
