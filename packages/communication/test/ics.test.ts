import { describe, expect, it } from "vitest";

import { meetingIcs } from "../src/index.js";

describe("meetingIcs (RFC 5545)", () => {
  const ics = meetingIcs({
    uid: "00000000-0000-4000-8000-0000000000e1",
    sequence: 0,
    start: new Date("2026-10-05T09:00:00Z"),
    end: new Date("2026-10-05T09:30:00Z"),
    summary: "Intro call; Ledgerfold, Ada",
    description: "Line one\nLine two",
    location: null,
    organiser: { name: 'Ada "the" Investor', email: "ada@fund.example" },
    attendees: [
      { name: "Femi", email: "femi@company.example" },
      { name: "Bad", email: "not an email" },
    ],
    createdAt: new Date("2026-10-02T08:00:00Z"),
  });

  // Content lines may be folded; read them unfolded (RFC 5545 §3.1).
  const unfolded = ics.replace(/\r\n /g, "");

  it("writes UTC instants, escapes text, and uses CRLF", () => {
    expect(ics).toContain("DTSTART:20261005T090000Z\r\n");
    expect(ics).toContain("DTEND:20261005T093000Z\r\n");
    expect(unfolded).toContain(
      String.raw`SUMMARY:Intro call\; Ledgerfold\, Ada` + "\r\n",
    );
    expect(unfolded).toContain("DESCRIPTION:Line one\\nLine two\r\n");
    expect(ics).toContain(
      "UID:00000000-0000-4000-8000-0000000000e1@capitalq\r\n",
    );
    expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(ics.replace(/\r\n/g, "")).not.toContain("\n");
  });

  it("invites real addresses only, and never breaks a quoted name", () => {
    expect(ics).toContain(
      'ORGANIZER;CN="Ada the Investor":mailto:ada@fund.example',
    );
    expect(unfolded).toContain("mailto:femi@company.example");
    expect(ics).not.toContain("not an email");
  });

  it("folds long lines at 75 octets", () => {
    const long = meetingIcs({
      uid: "u",
      sequence: 1,
      start: new Date("2026-10-05T09:00:00Z"),
      end: new Date("2026-10-05T09:30:00Z"),
      summary: "Ünïcödé ".repeat(30),
      description: "x",
      location: null,
      organiser: { name: "A", email: "a@b.example" },
      attendees: [],
      createdAt: new Date("2026-10-02T08:00:00Z"),
    });
    for (const line of long.split("\r\n")) {
      expect(Buffer.byteLength(line, "utf8")).toBeLessThanOrEqual(75);
    }
    expect(long).toContain("\r\n ");
  });
});
