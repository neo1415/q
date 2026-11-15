import { describe, expect, it } from "vitest";

import type { DatabaseExecutor } from "@capital-q/database";
import type { ActorContext } from "@capital-q/security";

import {
  createAttentionSources,
  jobAttentionItems,
  stillNeededNotices,
  type NoticeSettledCheck,
} from "../src/composition/attention-sources.js";

/**
 * Live check 15 Nov 2026 (O1): a notice that asks for an action is shown
 * only while its subject still needs it. The notices query and each
 * subject's state are answered by a fake executor keyed on the SQL text.
 */
describe("NEEDS_YOU notices, against the subject's current state", () => {
  const actor = {
    userId: "00000000-0000-4000-8000-0000000000a1",
    tenantId: "00000000-0000-4000-8000-0000000000f1",
    actorType: "HUMAN",
  } as unknown as ActorContext;
  const P1 = "d3ed305c-0000-4000-8000-000000000001";
  const P2 = "7ae7ca6e-0000-4000-8000-000000000002";
  const P3 = "11111111-0000-4000-8000-000000000003";
  const CONV = "22222222-0000-4000-8000-000000000004";
  const APPROVAL = "33333333-0000-4000-8000-000000000005";
  const INSTR = "44444444-0000-4000-8000-000000000006";
  const n = (id: number, kind: string, dedupe_key: string, title: string) => ({
    id: `55555555-0000-4000-8000-${String(id).padStart(12, "0")}`,
    kind,
    dedupe_key,
    title,
    body: null,
    created_at: new Date(Date.UTC(2026, 10, 14, 12, 60 - id)),
  });
  const NOTICES = [
    n(
      1,
      "TIME_PROPOSED",
      `time_proposed:proposal:${P1}:r1:counter`,
      "Savanna suggested other times for the call",
    ),
    n(
      2,
      "TIME_PROPOSED",
      `time_proposed:proposal:${P2}:r1:counter`,
      "Savanna suggested other times for the call",
    ),
    n(
      3,
      "TIME_PROPOSED",
      `time_proposed:proposal:${P3}:r2`,
      "Watchly proposed times for a call",
    ),
    n(4, "CHAT_MESSAGE", `chat:${CONV}`, "Savanna sent you a message"),
    n(
      5,
      "Q_WORK",
      `instr:${INSTR}:card-waiting:${APPROVAL}`,
      "Ajopot is waiting for your yes",
    ),
    n(6, "HUMAN_REVIEW", "human_review:abc12345", "A review needs you"),
  ];

  /** Rows by the table the query reads; every query is recorded. */
  function fakeSql(state: {
    proposals: { id: string; state: string; revision: number }[];
    chatSettled: string[];
    approvalsAnswered: string[];
  }) {
    const queries: string[] = [];
    const sql = (strings: TemplateStringsArray) => {
      const text = strings.join("?");
      queries.push(text);
      if (text.includes("from communication.notifications")) {
        return Promise.resolve(NOTICES);
      }
      if (text.includes("from communication.meeting_time_proposals")) {
        return Promise.resolve(state.proposals);
      }
      if (text.includes("from communication.messages")) {
        return Promise.resolve(state.chatSettled.map((id) => ({ id })));
      }
      if (text.includes("q_runtime.approvals")) {
        return Promise.resolve(state.approvalsAnswered.map((id) => ({ id })));
      }
      return Promise.resolve([]);
    };
    return { sql: sql as unknown as DatabaseExecutor, queries };
  }

  const titlesOf = async (sql: DatabaseExecutor) => {
    const read = createAttentionSources({ sql }).sources?.NOTICE?.[0];
    if (read === undefined) throw new Error("no NOTICE source");
    const items = await read(actor, { since: new Date(0), now: new Date() });
    return items.map((item) => item.key.replace(/^notice:/u, ""));
  };

  it("hides a proposal notice once the proposal was declined or accepted, and a message notice once they replied", async () => {
    const { sql, queries } = fakeSql({
      proposals: [
        // Watchly declined Savanna's counter.
        { id: P1, state: "DECLINED", revision: 1 },
        // Accepted.
        { id: P2, state: "CONFIRMED", revision: 1 },
        // Still waiting on Savanna's answer to revision 2.
        { id: P3, state: "PROPOSED", revision: 2 },
      ],
      chatSettled: [NOTICES[3]?.id ?? ""],
      approvalsAnswered: [NOTICES[4]?.id ?? ""],
    });
    expect(await titlesOf(sql)).toEqual([NOTICES[2]?.id, NOTICES[5]?.id]);
    // The person's own notices only: user and tenant are the actor's.
    const read = queries.find((q) => q.includes("communication.notifications"));
    expect(read).toMatch(/user_id = \?/u);
    expect(read).toMatch(/tenant_id = \?/u);
  });

  it("keeps every notice whose subject still waits on them", async () => {
    const { sql } = fakeSql({
      proposals: [
        { id: P1, state: "COUNTERPROPOSED", revision: 1 },
        { id: P2, state: "COUNTERPROPOSED", revision: 1 },
        { id: P3, state: "INVESTOR_REVIEW", revision: 2 },
      ],
      chatSettled: [],
      approvalsAnswered: [],
    });
    expect(await titlesOf(sql)).toEqual(NOTICES.map((row) => row.id));
  });

  it("a re-proposal settles the earlier revision's notice; a proposal it cannot find stays shown", async () => {
    const { sql } = fakeSql({
      proposals: [{ id: P3, state: "PROPOSED", revision: 3 }],
      chatSettled: [],
      approvalsAnswered: [],
    });
    const shown = await titlesOf(sql);
    expect(shown).not.toContain(NOTICES[2]?.id);
    expect(shown).toContain(NOTICES[0]?.id);
    expect(shown).toContain(NOTICES[1]?.id);
  });

  it("D20: a chat notice names its relationship, so the report can list it once beside the reply owed", async () => {
    const RELATIONSHIP = "66666666-0000-4000-8000-000000000007";
    const chat = { ...NOTICES[3], relationship_id: RELATIONSHIP };
    const queries: string[] = [];
    const sql = ((strings: TemplateStringsArray) => {
      const text = strings.join("?");
      queries.push(text);
      return Promise.resolve(
        text.includes("from communication.notifications")
          ? [chat, { ...NOTICES[5], relationship_id: null }]
          : [],
      );
    }) as unknown as DatabaseExecutor;
    const read = createAttentionSources({
      sql,
      noticeChecks: {},
    }).sources?.NOTICE?.[0];
    const items =
      (await read?.(actor, { since: new Date(0), now: new Date() })) ?? [];
    expect(items.map((item) => item.entity ?? null)).toEqual([
      { kind: "RELATIONSHIP", id: RELATIONSHIP },
      null,
    ]);
    // The subject is the notice's own conversation, matched by its key.
    expect(
      queries.find((q) => q.includes("communication.notifications")),
    ).toMatch(/n\.dedupe_key = 'chat:' \|\| cv\.id::text/u);
  });

  it("a check that fails fails the source (marked unread), never shows stale notices as current", async () => {
    const { sql } = fakeSql({
      proposals: [],
      chatSettled: [],
      approvalsAnswered: [],
    });
    const failing: NoticeSettledCheck = () =>
      Promise.reject(new Error("read failed"));
    const read = createAttentionSources({
      sql,
      noticeChecks: { CHAT_MESSAGE: [failing] },
    }).sources?.NOTICE?.[0];
    await expect(
      read?.(actor, { since: new Date(0), now: new Date() }),
    ).rejects.toThrow("read failed");
  });

  it("checks each kind once, with that kind's notices only, and keeps the order", async () => {
    const seen: string[][] = [];
    const record: NoticeSettledCheck = (notices) => {
      seen.push(notices.map((one) => one.dedupeKey));
      return Promise.resolve(new Set([notices[0]?.id ?? ""]));
    };
    const rows = [
      { id: "a", userId: "u", kind: "X", dedupeKey: "x:1" },
      { id: "b", userId: "u", kind: "Y", dedupeKey: "y:1" },
      { id: "c", userId: "u", kind: "X", dedupeKey: "x:2" },
    ];
    const kept = await stillNeededNotices(rows, { X: [record] });
    expect(seen).toEqual([["x:1", "x:2"]]);
    expect(kept.map((row) => row.id)).toEqual(["b", "c"]);
  });
});

/**
 * QA 2026-10-24 (I1): "What needs my attention today?" said "An agent's
 * job stopped: …", the same job three times. The person sees Q's work,
 * never an agent, and one line per piece of work.
 */

const at = (minutes: number) => new Date(Date.UTC(2026, 9, 24, 12, minutes));

describe("stopped and held work, as attention items", () => {
  it("says Q's work, never an agent, and lists the same work once with how often", () => {
    const items = jobAttentionItems([
      {
        id: "j1",
        goal: "Follow up with Nixo",
        status: "FAILED",
        updated_at: at(30),
      },
      {
        id: "j2",
        goal: "Follow up with Nixo",
        status: "FAILED",
        updated_at: at(20),
      },
      {
        id: "j3",
        goal: "Follow up with Nixo",
        status: "FAILED",
        updated_at: at(10),
      },
      {
        id: "j4",
        goal: "Book a call with Tarmacly",
        status: "HELD",
        updated_at: at(5),
      },
    ]);
    expect(items.map((item) => item.title)).toEqual([
      "Q's work on “Follow up with Nixo” stopped (3 times)",
      "Q's work on “Book a call with Tarmacly” is waiting on you",
    ]);
    // The newest of the repeats is the one kept, and acted on.
    expect(items[0]?.entity).toEqual({ kind: "JOB", id: "j1" });
    // The words they read; the source code AGENT_BLOCKED is internal.
    for (const item of items) expect(item.title).not.toMatch(/agent/iu);
  });
});
