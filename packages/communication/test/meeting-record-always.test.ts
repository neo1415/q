import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import type { DatabaseExecutor } from "@capital-q/database";

import {
  createMeetingAssistantService,
  meetingRecapEmail,
  type MeetingBotProvider,
  type MeetingNotes,
  type MeetingRecap,
} from "../src/index.js";

/**
 * meet2-64 (live 2026-10-04, Zino and Nixo): Recall's transcript came back
 * 41 s after the call and the record was written, but the first "notes are
 * ready" notice failed the notifications link check ('#outcome'), and the
 * throw skipped everything after it. Both sides saw nothing: no notice, no
 * email. The record must always reach both sides, and a call ended early
 * or with a failed transcript keeps what Q heard live.
 */
const MEETING = "00000000-0000-4000-8000-0000000000b1";
const START = new Date("2026-10-04T18:38:00Z");
const ZINO = "00000000-0000-4000-8000-0000000000a1";
const NIXO = "00000000-0000-4000-8000-0000000000a2";

const NOTES: MeetingNotes = {
  summary: "A short call.",
  flags: [],
  followUps: [],
  attendees: [
    { name: "Zino", side: "INVESTOR" },
    { name: "Nixo", side: "FOUNDER" },
  ],
  agreements: [],
  commitments: [
    {
      party: "Zino",
      amount: "a million dollars",
      quote: "I'm going to give you one million dollars",
      firmness: "EXPLORATORY",
    },
  ],
  composerVersion: "meeting-notes.v3",
};

function harness(options: {
  readonly read: Awaited<ReturnType<MeetingBotProvider["read"]>>;
  readonly live?: readonly { speaker: string | null; text: string }[];
  readonly failOrganiserNotice?: boolean;
}) {
  const statements: { text: string; values: unknown[] }[] = [];
  const row = {
    id: "00000000-0000-4000-8000-0000000000c1",
    meeting_id: MEETING,
    tenant_id: "00000000-0000-4000-8000-0000000000d1",
    user_id: ZINO,
    provider_bot_id: "6cf27e41-0e34-4fd0-bb40-ce33c5f537a0",
    status: "IN_CALL",
    failure: null,
    transcript: options.live ?? [],
    relationship_id: "00000000-0000-4000-8000-0000000000e1",
    organiser_user_id: ZINO,
    organiser_tenant_id: "00000000-0000-4000-8000-0000000000d1",
    purpose: "check something",
    starts_at: START,
    ends_at: new Date(START.getTime() + 30 * 60_000),
    meeting_status: "SCHEDULED",
    meet_link: "https://meet.google.com/geh-exec-ate",
  };
  const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join("?");
    statements.push({ text, values });
    let result: Promise<unknown[]> = Promise.resolve([]);
    if (/from communication\.meeting_assistants a/.test(text)) {
      result = Promise.resolve([row]);
    } else if (
      options.failOrganiserNotice === true &&
      /'Q''s notes are ready|Q's notes are ready/.test(String(values[3])) &&
      text.includes("insert into communication.notifications")
    ) {
      result = Promise.reject(
        new Error('violates check constraint "notifications_link_path_check"'),
      );
    } else if (text.includes("set emailed_at = clock_timestamp()")) {
      result = Promise.resolve([
        {
          user_id: NIXO,
          email: "nixo@example.test",
          display_name: "Nixo Founder",
          link_path:
            "/relationships/investor/00000000-0000-4000-8000-0000000000f1",
        },
      ]);
    }
    const base = result;
    // Rejections are observed by whoever awaits; a fresh promise is
    // returned so the overridden catch never calls itself.
    base.catch(() => undefined);
    return Object.assign(
      base.then((rows) => rows),
      { catch: (f: (e: unknown) => unknown) => base.catch(f) },
    );
  }) as unknown as DatabaseExecutor;
  Object.assign(sql, { json: (value: unknown) => value });

  const composedFrom: string[] = [];
  const held: unknown[] = [];
  const recaps: MeetingRecap[] = [];
  const service = createMeetingAssistantService({
    sql,
    bots: {
      create: () => Promise.resolve({ botId: "x" }),
      read: () => Promise.resolve(options.read),
      cancel: () => Promise.resolve(),
    },
    composer: {
      compose: (input) => {
        composedFrom.push(input.transcript);
        return Promise.resolve(NOTES);
      },
    },
    nameOf: () => Promise.resolve("Zino"),
    onHeld: (meeting) => {
      held.push(meeting);
      return Promise.resolve();
    },
    recap: (recap) => {
      recaps.push(recap);
      return Promise.resolve();
    },
    now: () => new Date(START.getTime() + 6 * 60_000),
    logger: { warn: () => undefined },
  });
  const notices = () =>
    statements.filter((s) =>
      s.text.includes("insert into communication.notifications"),
    );
  const statuses = () =>
    statements
      .filter((s) => s.text.includes("update communication.meeting_assistants"))
      .map((s) => s.values[0]);
  return { service, statements, notices, statuses, composedFrom, held, recaps };
}

const HEARD = [
  { speaker: "Q", text: "Hi Zino, welcome." },
  {
    speaker: "Zino",
    text: "I like your company, I'm going to give you one million dollars.",
  },
];

describe("the meeting record always reaches both sides", () => {
  it("still tells the other side and emails the recap when one notice fails", async () => {
    const t = harness({
      read: { state: "ENDED", transcript: HEARD },
      failOrganiserNotice: true,
    });
    await t.service.collect();
    expect(t.statuses()).toContain("DONE");
    expect(t.held).toHaveLength(1);
    // Organiser's notice failed; the other side's notice was still written.
    expect(t.notices().some((n) => n.text.includes("p.user_id <> "))).toBe(
      true,
    );
    expect(t.recaps).toHaveLength(1);
    expect(t.recaps[0]?.to).toBe("nixo@example.test");
    expect(t.recaps[0]?.money[0]?.amount).toBe("a million dollars");
  });

  it("never puts a fragment or query in a notice link (the check refuses it)", () => {
    const source = readFileSync(
      fileURLToPath(
        new URL("../src/meeting-assistant/service.ts", import.meta.url),
      ),
      "utf8",
    );
    const links = [...source.matchAll(/'(\/relationships\/[^']*)'/g)].map(
      (m) => m[1] ?? "",
    );
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      expect(link).toMatch(/^\/[A-Za-z0-9/_-]{0,200}$/);
    }
    expect(source).not.toContain("'#");
  });

  it("keeps what Q heard live when the provider's transcript failed", async () => {
    const t = harness({
      read: { state: "ENDED", transcript: null, ended: "TRANSCRIPT_FAILED" },
      live: HEARD,
    });
    await t.service.collect();
    expect(t.composedFrom[0]).toContain("one million dollars");
    expect(t.statuses()).toContain("DONE");
    // Said to be partial, never left to look complete.
    expect(
      t
        .notices()
        .some((n) => n.values.some((v) => String(v).includes("partial"))),
    ).toBe(true);
    expect(t.recaps[0]?.partial).toBe(true);
  });

  it("keeps what Q heard live when the call was ended early with no recording", async () => {
    const t = harness({
      read: { state: "ENDED", transcript: null, ended: "NO_RECORDING" },
      live: HEARD,
    });
    await t.service.collect();
    expect(t.statuses()).toContain("DONE");
  });

  it("marks the call unrecorded only when nobody was heard live either", async () => {
    const t = harness({
      read: { state: "ENDED", transcript: null, ended: "TRANSCRIPT_FAILED" },
      live: [{ speaker: "Q", text: "Hi Zino, welcome." }],
    });
    await t.service.collect();
    expect(t.statuses()).toEqual(["FAILED"]);
    expect(t.composedFrom).toHaveLength(0);
  });
});

describe("the recap email", () => {
  it("carries only what both sides read, and money as detected", () => {
    const email = meetingRecapEmail(
      {
        meetingId: MEETING,
        userId: NIXO,
        to: "nixo@example.test",
        name: "Nixo Founder",
        purpose: "check something",
        startsAt: START,
        linkPath: "/relationships/investor/x",
        attendees: ["Zino", "Nixo"],
        agreements: [],
        money: [
          {
            party: "Zino",
            amount: "a million dollars",
            quote: "I'm going to give you one million dollars",
          },
        ],
        partial: false,
      },
      "https://app.example.test",
    );
    expect(email.text).toContain("a million dollars");
    expect(email.text).toContain("not a commitment");
    expect(email.text).toContain(
      "https://app.example.test/relationships/investor/x",
    );
    expect(email.html).not.toContain("<script");
    expect(email.text).not.toContain("A short call.");
  });
});
