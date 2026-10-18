import { describe, expect, it } from "vitest";

import type { DatabaseExecutor } from "@capital-q/database";

import {
  BOT_CREATE_MAX_ATTEMPTS,
  botRetryDelayMs,
  createMeetingAssistantService,
  MEETING_BOT_END,
  type MeetingBotProvider,
} from "../src/index.js";

/**
 * meet-47: auto-join must always be there and do its job. One test per
 * failure mode: a call booked inside the window, a reschedule, a link
 * added or changed late, a cancelled call, a provider error (retried with
 * backoff, then said), the lobby, being removed, ending early, a late
 * transcript (poll and webhook), and a call that ended before Q was ever
 * booked. Every failure lands on the record and as a notice to both
 * sides. A scripted executor stands in for Postgres; no provider is called.
 */

const MEETING = "00000000-0000-4000-8000-0000000000b1";
const ASSISTANT = "00000000-0000-4000-8000-0000000000c1";
const NOW = new Date("2026-10-05T10:00:00Z");
const LINK = "https://meet.google.com/abc-defg-hij";

type Statement = { readonly text: string; readonly values: unknown[] };

const call = (startsInMin: number, lengthMin = 30) => ({
  id: MEETING,
  meeting_id: MEETING,
  assistant_id: ASSISTANT,
  relationship_id: "00000000-0000-4000-8000-0000000000e1",
  organiser_user_id: "00000000-0000-4000-8000-0000000000a1",
  organiser_tenant_id: "00000000-0000-4000-8000-0000000000d1",
  purpose: "Intro call",
  starts_at: new Date(NOW.getTime() + startsInMin * 60_000),
  ends_at: new Date(NOW.getTime() + (startsInMin + lengthMin) * 60_000),
  status: "SCHEDULED",
  meet_link: LINK,
});

const assistant = (startsInMin: number) => ({
  ...call(startsInMin),
  id: ASSISTANT,
  tenant_id: "00000000-0000-4000-8000-0000000000d1",
  user_id: "00000000-0000-4000-8000-0000000000a1",
  provider_bot_id: "588ec4d1-914e-46e7-9014-d59a315b4e50",
  status: "SCHEDULED",
  failure: null,
  meeting_status: "SCHEDULED",
});

/** Rows per query, matched by a fragment of its text. */
function scriptedSql(script: readonly [RegExp, unknown[]][]) {
  const statements: Statement[] = [];
  const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join("?");
    statements.push({ text, values });
    const rows = script.find(([pattern]) => pattern.test(text))?.[1] ?? [];
    return Object.assign(Promise.resolve(rows), {
      catch: (f: (e: unknown) => unknown) => Promise.resolve(rows).catch(f),
    });
  }) as unknown as DatabaseExecutor;
  Object.assign(sql, { json: (value: unknown) => value });
  return { sql, statements };
}

function harness(
  script: readonly [RegExp, unknown[]][],
  bots: Partial<MeetingBotProvider> = {},
) {
  const { sql, statements } = scriptedSql(script);
  const created: unknown[] = [];
  const cancelled: string[] = [];
  const provider: MeetingBotProvider = {
    create: (input) => {
      created.push(input);
      return Promise.resolve({ botId: "bot-new-00000001" });
    },
    read: () => Promise.resolve({ state: "WAITING", transcript: null }),
    cancel: (botId) => {
      cancelled.push(botId);
      return Promise.resolve();
    },
    ...bots,
  };
  const service = createMeetingAssistantService({
    sql,
    bots: provider,
    composer: {
      compose: () =>
        Promise.resolve({
          summary: "Good call.",
          flags: [],
          followUps: [],
          attendees: [],
          agreements: [],
          commitments: [],
          composerVersion: "test",
        }),
    },
    nameOf: () => Promise.resolve("Ada"),
    now: () => NOW,
  });
  const notices = () =>
    statements
      .filter((s) => s.text.includes("insert into communication.notifications"))
      .map((s) => ({
        key: s.values.find(
          (v) => typeof v === "string" && v.endsWith(`:${MEETING}`),
        ),
        toEveryone: s.text.includes(
          "from communication.meeting_participants p",
        ),
        values: s.values,
      }));
  const unrecorded = () =>
    statements.filter((s) => s.text.includes("'UNRECORDED'"));
  const failures = () =>
    statements
      .filter(
        (s) =>
          s.text.includes("update communication.meeting_assistants") &&
          s.values[0] === "FAILED",
      )
      .map((s) => s.values[2]);
  return {
    service,
    statements,
    created,
    cancelled,
    notices,
    unrecorded,
    failures,
  };
}

const CLAIM = /set attempts = a\.attempts \+ 1/;
const READ_ROWS = /where a\.status in \('SCHEDULED', 'IN_CALL', 'COMPOSING'\)/;

describe("enlisting Q in every call", () => {
  it("books a call booked inside the 30-minute window at once, to join now", async () => {
    const t = harness([[CLAIM, [{ ...call(5), attempts: 1 }]]]);
    expect(await t.service.enlist()).toBe(1);
    const enlist = t.statements.find((s) =>
      s.text.includes("'enlist:' || m.id::text"),
    );
    expect(enlist?.text).toContain("m.meet_link is not null");
    expect(enlist?.values).toContainEqual(
      new Date(NOW.getTime() + 30 * 60_000),
    );
    expect(t.created).toEqual([
      expect.objectContaining({ meetingUrl: LINK, joinAt: null }),
    ]);
    const booked = t.statements.find((s) =>
      s.text.includes("set status = 'SCHEDULED', provider_bot_id"),
    );
    // What the bot was booked for, so a later move or new link rebooks it.
    expect(booked?.values).toEqual(
      expect.arrayContaining([call(5).starts_at, LINK]),
    );
  });

  it("books a call whose link was added late, like any other, on the next tick", async () => {
    const t = harness([[CLAIM, [{ ...call(-5), attempts: 1 }]]]);
    expect(await t.service.enlist()).toBe(1);
    expect(t.created).toHaveLength(1);
  });

  it("claims each try with a lease so two ticks never book two bots", async () => {
    const t = harness([]);
    await t.service.enlist();
    const claim = t.statements.find((s) => CLAIM.test(s.text));
    expect(claim?.text).toContain("for update of a2 skip locked");
    expect(claim?.values).toContain(BOT_CREATE_MAX_ATTEMPTS);
  });

  it("rebooks a call moved after Q was booked, at its new time", async () => {
    const moved = { ...assistant(240) };
    const t = harness([[/a\.booked_starts_at <> m\.starts_at/, [moved]]]);
    await t.service.enlist();
    expect(t.cancelled).toEqual([moved.provider_bot_id]);
    const reset = t.statements.find((s) =>
      s.text.includes(
        "set status = 'REQUESTED', provider_bot_id = null, failure = null",
      ),
    );
    // Due again 30 minutes before the new start, not now.
    expect(reset?.values).toContainEqual(
      new Date(moved.starts_at.getTime() - 30 * 60_000),
    );
  });

  it("rebooks a call whose Meet link changed after Q was booked", async () => {
    const t = harness([
      [/a\.booked_meet_link is distinct from m\.meet_link/, [assistant(10)]],
    ]);
    await t.service.enlist();
    expect(t.cancelled).toHaveLength(1);
  });

  it("stands Q down quietly when the call is cancelled", async () => {
    const t = harness([
      [
        /m\.status = 'CANCELLED'/,
        [{ id: ASSISTANT, provider_bot_id: "bot-old-00000001" }],
      ],
    ]);
    await t.service.enlist();
    expect(t.cancelled).toEqual(["bot-old-00000001"]);
    expect(
      t.statements.some((s) => s.text.includes("set status = 'CANCELLED'")),
    ).toBe(true);
    expect(t.notices()).toEqual([]);
  });
});

describe("a provider error creating the bot", () => {
  it("backs off 1, 2, 4, 8, 15 minutes", () => {
    expect([1, 2, 3, 4, 5, 6].map((n) => botRetryDelayMs(n) / 60_000)).toEqual([
      1, 2, 4, 8, 15, 15,
    ]);
  });

  it("is retried, said on the record, and told to both sides once", async () => {
    const t = harness([[CLAIM, [{ ...call(5), attempts: 1 }]]], {
      create: () => Promise.reject(new Error("recall POST /bot/ answered 507")),
    });
    expect(await t.service.enlist()).toBe(0);
    const retry = t.statements.find((s) =>
      s.text.includes(
        "set status = 'REQUESTED', provider_bot_id = null,\n               failure =",
      ),
    );
    expect(String(retry?.values[0])).toContain("trying again at 10:01 UTC");
    expect(retry?.values[1]).toEqual(new Date(NOW.getTime() + 60_000));
    expect(t.failures()).toEqual([]);
    expect(t.notices().map((n) => n.key)).toEqual([
      `meeting-q-retrying:${MEETING}`,
    ]);
    expect(t.notices()[0]?.toEveryone).toBe(true);
  });

  it("fails visibly after the last try: record, unrecorded note, notice", async () => {
    const t = harness(
      [[CLAIM, [{ ...call(5), attempts: BOT_CREATE_MAX_ATTEMPTS }]]],
      { create: () => Promise.reject(new Error("recall answered 500")) },
    );
    await t.service.enlist();
    expect(t.failures()).toEqual([
      `Q couldn't be booked into this call (${String(BOT_CREATE_MAX_ATTEMPTS)} tries).`,
    ]);
    expect(t.unrecorded()).toHaveLength(1);
    expect(t.notices().map((n) => n.key)).toEqual([
      `meeting-q-failed:${MEETING}`,
    ]);
  });

  it("fails visibly when the call ended before Q was ever booked", async () => {
    const t = harness([[/m\.ends_at <= /, [{ ...call(-60) }]]]);
    await t.service.enlist();
    expect(t.failures()).toEqual(["Q never got into the call."]);
    expect(t.notices().map((n) => n.key)).toEqual([
      `meeting-q-failed:${MEETING}`,
    ]);
  });
});

describe("in and after the call", () => {
  const settled = (
    read: Awaited<ReturnType<MeetingBotProvider["read"]>>,
    startsInMin = -15,
  ) =>
    harness([[READ_ROWS, [assistant(startsInMin)]]], {
      read: () => Promise.resolve(read),
    });

  it("reads a bot from shortly before the start, so the lobby is seen at once", async () => {
    const t = settled({ state: "LOBBY", transcript: null }, 3);
    await t.service.collect();
    const read = t.statements.find((s) => READ_ROWS.test(s.text));
    expect(read?.values).toContainEqual(new Date(NOW.getTime() + 5 * 60_000));
    expect(read?.text).toContain("m.status <> 'CANCELLED'");
  });

  it("tells both sides, once, that Q is waiting to be let in", async () => {
    const t = settled({ state: "LOBBY", transcript: null });
    await t.service.collect();
    const [notice] = t.notices();
    expect(notice?.key).toBe(`meeting-lobby:${MEETING}`);
    expect(notice?.toEveryone).toBe(true);
    expect(String(notice?.values[0])).toBe(
      "Q is waiting to be let in: Intro call",
    );
    expect(t.failures()).toEqual([]);
  });

  it("says Q was removed when it was kicked with nothing recorded", async () => {
    const t = settled({ state: "ENDED", transcript: null, ended: "REMOVED" });
    await t.service.collect();
    expect(t.failures()).toEqual([MEETING_BOT_END.REMOVED.failure]);
    expect(t.unrecorded()).toHaveLength(1);
    expect(t.notices().map((n) => n.key)).toEqual([
      `meeting-q-failed:${MEETING}`,
    ]);
  });

  it("keeps what it heard when removed part-way, and says the rest is unrecorded", async () => {
    const t = settled({
      state: "ENDED",
      transcript: [{ speaker: "Ada", text: "We grew 30% last quarter." }],
      cutShort: "REMOVED",
    });
    await t.service.collect();
    expect(t.failures()).toEqual([]);
    expect(
      t.statements.some(
        (s) =>
          s.text.includes("update communication.meeting_assistants") &&
          s.values[0] === "DONE",
      ),
    ).toBe(true);
    expect(String(t.unrecorded()[0]?.values.at(-1))).toContain(
      "removed from the call before it ended",
    );
    expect(t.notices().map((n) => n.key)).toContain(
      `meeting-q-cut-short:${MEETING}`,
    );
  });

  it("says so when the call ended early before Q recorded anything", async () => {
    const t = settled({
      state: "ENDED",
      transcript: null,
      ended: "NO_RECORDING",
    });
    await t.service.collect();
    expect(t.failures()).toEqual([MEETING_BOT_END.NO_RECORDING.failure]);
    expect(t.notices()).toHaveLength(1);
  });

  it("waits for a late transcript, then fails visibly after three hours", async () => {
    const waiting = settled({ state: "ENDED", transcript: null });
    await waiting.service.collect();
    expect(waiting.failures()).toEqual([]);
    expect(waiting.notices()).toEqual([]);

    const late = settled({ state: "ENDED", transcript: null }, -4 * 60);
    await late.service.collect();
    expect(late.failures()).toEqual([
      "Q's transcript of the call never came back.",
    ]);
    expect(late.unrecorded()).toHaveLength(1);
    expect(late.notices().map((n) => n.key)).toEqual([
      `meeting-q-failed:${MEETING}`,
    ]);
  });

  it("settles a late transcript the moment Recall's webhook names the bot", async () => {
    const t = harness([[/where a\.provider_bot_id = /, [assistant(-60)]]], {
      read: () =>
        Promise.resolve({
          state: "ENDED",
          transcript: [{ speaker: "Ada", text: "Send the deck by Friday." }],
        }),
    });
    expect(
      await t.service.settleBot("588ec4d1-914e-46e7-9014-d59a315b4e50"),
    ).toBe(true);
    expect(
      t.statements.some(
        (s) =>
          s.text.includes("update communication.meeting_assistants") &&
          s.values[0] === "DONE",
      ),
    ).toBe(true);
  });

  it("ignores a webhook for a bot it does not know or a malformed id", async () => {
    const t = harness([]);
    expect(await t.service.settleBot("not a bot id; drop table")).toBe(false);
    expect(await t.service.settleBot("bot-unknown-0001")).toBe(false);
  });
});
