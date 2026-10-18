import { describe, expect, it } from "vitest";

import type { DatabaseExecutor } from "@capital-q/database";

import { createMeetingMailer, type MeetingMailer } from "../src/index.js";

/**
 * The booked-call email (founder report 2026-10-02): every participant
 * gets one, in their own zone, with the Meet link and an invite file; an
 * unchanged meeting is never re-sent; a changed time or link sends one
 * updated email with a higher SEQUENCE.
 */

const MEETING = "cfccb9a9-0000-4000-8000-000000000001";
const ORGANISER = "00000000-0000-4000-8000-0000000000a1";
const ATTENDEE = "00000000-0000-4000-8000-0000000000a2";
const NOW = new Date("2026-10-02T12:00:00Z");

type Meeting = {
  starts_at: Date;
  ends_at: Date;
  meet_link: string | null;
  purpose: string;
};

function world(options: { failFirstSend?: boolean } = {}) {
  const meeting: Meeting = {
    starts_at: new Date("2026-10-06T09:00:00Z"),
    ends_at: new Date("2026-10-06T09:30:00Z"),
    meet_link: "https://meet.google.com/abc-defg-hij",
    purpose: "Intro call: Zino and Nixo",
  };
  const people = [
    {
      user_id: ORGANISER,
      display_name: "Zino",
      email: "zino@founder.example.co",
      timezone: "Africa/Lagos",
    },
    {
      user_id: ATTENDEE,
      display_name: "Priya",
      email: "priya@fund.example.co",
      timezone: "Asia/Kolkata",
    },
  ];
  const ledger = new Map<string, { version: string; sequence: number }>();
  const sent: {
    to: string;
    subject: string;
    text: string;
    html?: string | undefined;
    attachments?:
      | readonly { filename: string; content: string; contentType: string }[]
      | undefined;
  }[] = [];
  let failNext = options.failFirstSend === true;

  const fake = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join("?");
    if (text.includes("from communication.meetings")) {
      return Promise.resolve(
        people.map((person) => ({
          meeting_id: MEETING,
          ...meeting,
          time_zone: "Europe/London",
          organiser_user_id: ORGANISER,
          ...person,
          version: ledger.get(person.user_id)?.version ?? null,
          sequence: ledger.get(person.user_id)?.sequence ?? null,
        })),
      );
    }
    if (text.includes("insert into communication.meeting_emails")) {
      const [, userId, version, sequence] = values;
      ledger.set(String(userId), {
        version: String(version),
        sequence: Number(sequence),
      });
      return Promise.resolve([]);
    }
    return Promise.reject(new Error(`unexpected query: ${text}`));
  };

  const mailer: MeetingMailer = createMeetingMailer({
    sql: fake as unknown as DatabaseExecutor,
    email: {
      available: true,
      send: (message) => {
        if (failNext) {
          failNext = false;
          return Promise.reject(new Error("relay down"));
        }
        sent.push(message);
        return Promise.resolve();
      },
    },
    appOrigin: "https://app.capitalq.example",
    now: () => NOW,
  });
  return { meeting, people, ledger, sent, mailer };
}

describe("meeting email", () => {
  it("emails the organiser and the attendee once each, in their own zone", async () => {
    const w = world();
    expect(await w.mailer.tick()).toEqual({ sent: 2 });
    expect(w.sent.map((m) => m.to)).toEqual([
      "zino@founder.example.co",
      "priya@fund.example.co",
    ]);
    const [zino, priya] = w.sent;
    // 09:00Z is 10:00 in Lagos and 14:30 in Kolkata.
    expect(zino?.text).toContain("10:00");
    expect(priya?.text).toContain("14:30");
    for (const message of w.sent) {
      expect(message.subject).toContain("Intro call: Zino and Nixo");
      expect(message.text).toContain(
        "Join with Google Meet: https://meet.google.com/abc-defg-hij",
      );
      expect(message.text).toContain(
        `https://app.capitalq.example/rehearsals/meeting/${MEETING}`,
      );
      expect(message.html).toContain(
        'href="https://meet.google.com/abc-defg-hij"',
      );
      expect(message.html).toContain("Join with Google Meet");
      const ics = message.attachments?.[0];
      expect(ics?.filename).toBe("invite.ics");
      expect(ics?.contentType).toContain("text/calendar");
      expect(ics?.content).toContain(
        "LOCATION:https://meet.google.com/abc-defg-hij",
      );
      expect(ics?.content).toContain(
        "URL:https://meet.google.com/abc-defg-hij",
      );
      expect(ics?.content).toContain(`UID:${MEETING}`);
      expect(ics?.content).toContain("SEQUENCE:0");
    }
  });

  it("is idempotent per meeting and person", async () => {
    const w = world();
    await w.mailer.tick();
    expect(await w.mailer.tick()).toEqual({ sent: 0 });
    expect(w.sent).toHaveLength(2);
  });

  it("sends one updated email when the time or the link changes", async () => {
    const w = world();
    await w.mailer.tick();
    w.meeting.starts_at = new Date("2026-10-06T10:00:00Z");
    w.meeting.ends_at = new Date("2026-10-06T10:30:00Z");
    expect(await w.mailer.tick()).toEqual({ sent: 2 });
    const updated = w.sent.slice(2);
    expect(updated.every((m) => m.subject.startsWith("Updated: "))).toBe(true);
    expect(updated[0]?.attachments?.[0]?.content).toContain("SEQUENCE:1");
    expect(await w.mailer.tick()).toEqual({ sent: 0 });

    w.meeting.meet_link = "https://meet.google.com/xyz-wxyz-xyz";
    expect(await w.mailer.tick()).toEqual({ sent: 2 });
    expect(w.sent[4]?.text).toContain("https://meet.google.com/xyz-wxyz-xyz");
    expect(w.sent[4]?.attachments?.[0]?.content).toContain("SEQUENCE:2");
  });

  it("says the link will follow, then emails it when it arrives", async () => {
    const w = world();
    w.meeting.meet_link = null;
    await w.mailer.tick();
    expect(w.sent[0]?.text).toContain("Video link: to follow.");
    expect(w.sent[0]?.attachments?.[0]?.content).not.toContain("URL:");
    w.meeting.meet_link = "https://meet.google.com/abc-defg-hij";
    expect(await w.mailer.tick()).toEqual({ sent: 2 });
    expect(w.sent[2]?.html).toContain(
      'href="https://meet.google.com/abc-defg-hij"',
    );
  });

  it("retries a failed send next pass, and never mails reserved domains", async () => {
    const w = world({ failFirstSend: true });
    const attendee = w.people[1];
    if (attendee !== undefined)
      attendee.email = "priya@fictional.capitalq.local";
    expect(await w.mailer.tick()).toEqual({ sent: 0 });
    expect(w.ledger.size).toBe(0);
    expect(await w.mailer.tick()).toEqual({ sent: 1 });
    expect(w.sent.map((m) => m.to)).toEqual(["zino@founder.example.co"]);
  });
});
