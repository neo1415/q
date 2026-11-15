import { describe, expect, it } from "vitest";

import type { QAttentionReport } from "@capital-q/contracts";
import type { DatabaseExecutor } from "@capital-q/database";
import { spokenFactsOfAttention } from "@capital-q/q-core";
import type { ActorContext } from "@capital-q/security";

import { createAttentionSources } from "../src/composition/attention-sources.js";
import { createOpenerFacts } from "../src/voice/returning-opener.js";

/**
 * Live check 15 Nov 2026 (O1): the voice opener and the spoken attention
 * line agree with the digest and the web's Needs you list about which
 * notices still need the person -- one shared "still needed" read
 * (app-actions needs-you.ts). The subjects' state is answered by a fake
 * executor keyed on the SQL text; the real checks run against it.
 */

const actor = {
  userId: "00000000-0000-4000-8000-0000000000a1",
  tenantId: "00000000-0000-4000-8000-0000000000f1",
  actorType: "HUMAN",
} as unknown as ActorContext;
const DECLINED = "d3ed305c-0000-4000-8000-000000000001";
const WAITING = "11111111-0000-4000-8000-000000000003";
const CONV_REPLIED = "22222222-0000-4000-8000-000000000004";
const CONV_OPEN = "22222222-0000-4000-8000-000000000005";
const id = (n: number) =>
  `55555555-0000-4000-8000-${String(n).padStart(12, "0")}`;
const n = (num: number, kind: string, dedupe_key: string, title: string) => ({
  id: id(num),
  kind,
  dedupe_key,
  title,
  body: null,
  priority: "NEEDS_YOU",
  created_at: new Date(Date.UTC(2026, 10, 14, 12, 60 - num)),
});
const NOTICES = [
  // Savanna's counter, which the person then declined: settled.
  n(
    1,
    "TIME_PROPOSED",
    `time_proposed:proposal:${DECLINED}:r1:counter`,
    "Savanna suggested other times for the call",
  ),
  // Watchly's times, still waiting on the person's answer.
  n(
    2,
    "TIME_PROPOSED",
    `time_proposed:proposal:${WAITING}:r2`,
    "Watchly proposed times for a call",
  ),
  // They replied: settled.
  n(3, "CHAT_MESSAGE", `chat:${CONV_REPLIED}`, "Halyard sent you a message"),
  // Still unanswered.
  n(4, "CHAT_MESSAGE", `chat:${CONV_OPEN}`, "Shiftwell messaged you"),
];
const SETTLED = [id(1), id(3)];

function fakeSql() {
  const sql = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join("?");
    if (text.includes("q_runtime.standing_instructions")) {
      return Promise.resolve([]);
    }
    if (text.includes("from communication.meeting_time_proposals")) {
      return Promise.resolve([
        { id: DECLINED, state: "DECLINED", revision: 1 },
        { id: WAITING, state: "PROPOSED", revision: 2 },
      ]);
    }
    if (text.includes("from communication.messages")) {
      return Promise.resolve([{ id: id(3) }]);
    }
    if (text.includes("group by kind")) {
      // The opener's count: the ids it was told to leave out are left out.
      const excluded = new Set(
        values.flatMap((value): unknown[] =>
          Array.isArray(value) ? (value as unknown[]) : [],
        ),
      );
      const kept = NOTICES.filter((row) => !excluded.has(row.id));
      const kinds = [...new Set(kept.map((row) => row.kind))];
      return Promise.resolve(
        kinds.map((kind) => ({
          kind,
          n: kept.filter((row) => row.kind === kind).length,
          body: null,
        })),
      );
    }
    if (text.includes("from communication.notifications")) {
      return Promise.resolve(NOTICES);
    }
    return Promise.resolve([]);
  };
  return sql as unknown as DatabaseExecutor;
}

describe("the voice opener counts only notices that still need the person", () => {
  it("leaves settled proposal and message notices out of its count", async () => {
    const facts = await createOpenerFacts({ sql: fakeSql() })(actor);
    expect(facts.unreadNotices).toBe(NOTICES.length - SETTLED.length);
  });

  it("with every notice settled, says nothing is waiting", async () => {
    const facts = await createOpenerFacts({
      sql: fakeSql(),
      settledUnread: () => Promise.resolve(new Set(NOTICES.map((r) => r.id))),
    })(actor);
    expect(facts.unreadNotices).toBe(0);
  });

  it("a check that cannot be read counts every notice, as before", async () => {
    const facts = await createOpenerFacts({
      sql: fakeSql(),
      settledUnread: () => Promise.reject(new Error("read failed")),
    })(actor);
    expect(facts.unreadNotices).toBe(NOTICES.length);
  });
});

describe("the spoken attention line", () => {
  const reportOf = async (): Promise<QAttentionReport> => {
    const read = createAttentionSources({ sql: fakeSql() }).sources
      ?.NOTICE?.[0];
    if (read === undefined) throw new Error("no NOTICE source");
    const items = await read(actor, { since: new Date(0), now: new Date() });
    return {
      items: [...items],
      activity: null,
      unread: [],
      readAt: "2026-11-15T09:00:00.000Z",
    };
  };

  it("says still-needed notices only, and a name as stored", async () => {
    const facts = spokenFactsOfAttention(await reportOf());
    expect(facts.fallback).toContain("Watchly proposed times for a call.");
    // The second item is joined with "And": the name keeps its case.
    expect(facts.fallback).toContain("And Shiftwell messaged you.");
    expect(facts.fallback).not.toMatch(/shiftwell/u);
    expect(facts.fallback).not.toMatch(/Savanna|Halyard/u);
    expect(facts.fallback).toMatch(/^Two things need you\./u);
  });

  it("keeps a counterpart's name as stored and lowers only an ordinary word", () => {
    const facts = spokenFactsOfAttention({
      items: [
        {
          key: "a",
          source: "UNANSWERED_MESSAGE",
          title: "Spheros is waiting for your reply",
          counterpart: "Spheros",
          since: "2026-11-15T07:00:00.000Z",
          decidable: false,
        },
        {
          key: "b",
          source: "NOTICE",
          title: "A review needs you",
          since: "2026-11-15T07:00:00.000Z",
          decidable: false,
        },
        {
          key: "c",
          source: "UNANSWERED_MESSAGE",
          title: "Shiftwell messaged you",
          counterpart: "Shiftwell",
          since: "2026-11-15T07:00:00.000Z",
          decidable: false,
        },
      ],
      activity: null,
      unread: [],
      readAt: "2026-11-15T09:00:00.000Z",
    });
    expect(facts.fallback).toBe(
      "Three things need you. Spheros is waiting for your reply. Then a review needs you. And Shiftwell messaged you.",
    );
  });
});
