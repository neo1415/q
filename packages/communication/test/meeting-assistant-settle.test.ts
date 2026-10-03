import { describe, expect, it } from "vitest";

import type { DatabaseExecutor } from "@capital-q/database";

import {
  createMeetingAssistantService,
  MEETING_BOT_END,
  type MeetingBotProvider,
} from "../src/index.js";

/**
 * meet-47 (live 2026-09-30 and 2026-10-02): what the collector does with
 * each thing Recall reports. Two of three bots sat in the Meet lobby until
 * Recall's timeout and were recorded hours later as "captions never came
 * back"; one heard only its own greeting and was filed as a meeting. A
 * fake executor stands in for Postgres; no provider is reached.
 */
const MEETING = "00000000-0000-4000-8000-0000000000b1";
const START = new Date("2026-10-02T14:00:00Z");

function fakeSql() {
  const statements: { text: string; values: unknown[] }[] = [];
  const row = {
    id: "00000000-0000-4000-8000-0000000000c1",
    meeting_id: MEETING,
    tenant_id: "00000000-0000-4000-8000-0000000000d1",
    user_id: "00000000-0000-4000-8000-0000000000a1",
    provider_bot_id: "588ec4d1-914e-46e7-9014-d59a315b4e50",
    status: "SCHEDULED",
    failure: null,
    relationship_id: "00000000-0000-4000-8000-0000000000e1",
    organiser_user_id: "00000000-0000-4000-8000-0000000000a1",
    organiser_tenant_id: "00000000-0000-4000-8000-0000000000d1",
    purpose: "Intro call",
    starts_at: START,
    ends_at: new Date(START.getTime() + 30 * 60_000),
    meeting_status: "SCHEDULED",
    meet_link: "https://meet.google.com/abc-defg-hij",
  };
  const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join("?");
    statements.push({ text, values });
    const rows = /from communication\.meeting_assistants a/.test(text)
      ? [row]
      : [];
    return Object.assign(Promise.resolve(rows), {
      catch: (f: (e: unknown) => unknown) => Promise.resolve(rows).catch(f),
    });
  }) as unknown as DatabaseExecutor;
  Object.assign(sql, { json: (value: unknown) => value });
  return { sql, statements };
}

function serviceWith(read: Awaited<ReturnType<MeetingBotProvider["read"]>>) {
  const { sql, statements } = fakeSql();
  let composed = 0;
  const bots: MeetingBotProvider = {
    create: () => Promise.resolve({ botId: "x" }),
    read: () => Promise.resolve(read),
    cancel: () => Promise.resolve(),
  };
  const service = createMeetingAssistantService({
    sql,
    bots,
    composer: {
      compose: () => {
        composed += 1;
        return Promise.resolve(null);
      },
    },
    nameOf: () => Promise.resolve("Ada"),
    now: () => new Date(START.getTime() + 15 * 60_000),
  });
  const updates = () =>
    statements
      .filter((s) => s.text.includes("update communication.meeting_assistants"))
      .map((s) => ({ status: s.values[0], failure: s.values[2] }));
  return { service, statements, updates, composed: () => composed };
}

describe("settling Q's bot after a call", () => {
  it("fails at once, saying nobody admitted Q, when the lobby timed out", async () => {
    const t = serviceWith({
      state: "ENDED",
      transcript: null,
      ended: "NOT_ADMITTED",
    });
    await t.service.collect();
    expect(t.updates()).toEqual([
      { status: "FAILED", failure: MEETING_BOT_END.NOT_ADMITTED.failure },
    ]);
    expect(
      t.statements.some(
        (s) =>
          s.text.includes("'UNRECORDED'") &&
          String(s.values.at(-1)).includes("not admitted from the lobby"),
      ),
    ).toBe(true);
  });

  it("tells everyone on the booking once while Q waits in the lobby", async () => {
    const t = serviceWith({ state: "LOBBY", transcript: null });
    await t.service.collect();
    const notice = t.statements.find(
      (s) =>
        s.text.includes("insert into communication.notifications") &&
        s.values.includes(`meeting-lobby:${MEETING}`),
    );
    expect(notice?.text).toContain("from communication.meeting_participants p");
    expect(notice?.text).toContain(
      "on conflict (user_id, dedupe_key) do nothing",
    );
    expect(t.updates()).toEqual([]);
  });

  it("keeps waiting while the transcript is processing", async () => {
    const t = serviceWith({ state: "ENDED", transcript: null });
    await t.service.collect();
    expect(t.updates()).toEqual([]);
  });

  it("never files Q's own greeting as a meeting", async () => {
    const t = serviceWith({
      state: "ENDED",
      transcript: [
        {
          speaker: "Q",
          text: "Hi, Ada! I'm Q from Capital Q here to take notes.",
        },
      ],
    });
    await t.service.collect();
    expect(t.updates()).toEqual([
      { status: "FAILED", failure: "Nothing was said that Q could hear." },
    ]);
    expect(t.composed()).toBe(0);
  });

  it("writes notes when a person was heard", async () => {
    const t = serviceWith({
      state: "ENDED",
      transcript: [
        { speaker: "Q", text: "I'm Q from Capital Q." },
        { speaker: "Ada", text: "We grew 30% last quarter." },
      ],
    });
    await t.service.collect();
    expect(t.composed()).toBe(1);
    expect(t.updates()[0]?.status).toBe("COMPOSING");
  });
});
