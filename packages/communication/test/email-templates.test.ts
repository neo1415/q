import { describe, expect, it } from "vitest";

import { meetingEmail, noticeEmail, reminderEmail } from "../src/index.js";

/**
 * DOCS: the communication context's emails on the shared Capital Q layout.
 * Each keeps its content and links; names and titles are escaped; links
 * are absolute to the web origin; every one has its plain-text twin.
 */

const ORIGIN = "https://app.capitalq.example";
const HOSTILE = 'Ada <img src=x onerror=alert(1)> "Obi"';

function hrefs(html: string): string[] {
  return [...html.matchAll(/href="([^"]+)"/g)].map((match) => match[1] ?? "");
}

describe("the meeting email", () => {
  const email = meetingEmail({
    meetingId: "11111111-0000-4000-8000-000000000001",
    purpose: `Intro with ${HOSTILE}`,
    startsAt: new Date("2026-10-09T09:00:00Z"),
    endsAt: new Date("2026-10-09T09:30:00Z"),
    meetLink: "https://meet.google.com/abc-defg-hij",
    timeZone: "Africa/Lagos",
    updated: false,
    sequence: 0,
    organiser: { name: "Ada", email: "ada@example.com" },
    attendees: [{ name: "Ben", email: "ben@example.com" }],
    appOrigin: ORIGIN,
    now: new Date("2026-10-01T09:00:00Z"),
  });

  it("keeps the Meet button, the plain Meet URL, the prep link and the .ics", () => {
    expect(email.html).toContain(">Join with Google Meet</a>");
    expect(email.html).toContain(">https://meet.google.com/abc-defg-hij</a>");
    expect(email.html).toContain(
      `href="${ORIGIN}/rehearsals/meeting/11111111-0000-4000-8000-000000000001"`,
    );
    expect(email.html).toContain("invite.ics");
    expect(email.ics).toContain("BEGIN:VCALENDAR");
    expect(email.text).toContain(
      "Join with Google Meet: https://meet.google.com/abc-defg-hij",
    );
    expect(email.html).toContain(">Capital Q</td>");
  });

  it("escapes the purpose and links only absolute https addresses", () => {
    expect(email.html).not.toContain("<img src=x");
    expect(email.html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    for (const href of hrefs(email.html)) {
      expect(href.startsWith("https://"), href).toBe(true);
    }
  });
});

describe("the reminder email", () => {
  it("is the reminder, a button into Capital Q, and a plain-text twin", () => {
    const email = reminderEmail({
      title: `Call ${HOSTILE}`,
      note: "Ask about the Kano pilot.",
      origin: ORIGIN,
    });
    expect(email.subject).toBe(`Reminder: Call ${HOSTILE}`);
    expect(email.html).not.toContain("<img src=x");
    expect(email.html).toContain(`href="${ORIGIN}/home"`);
    expect(email.text).toContain("Ask about the Kano pilot.");
    expect(email.text).toContain(`Open Capital Q: ${ORIGIN}/home`);
  });
});

describe("the notice email", () => {
  it("opens the place in the app, says why it came and how to turn it off", () => {
    const email = noticeEmail({
      title: `${HOSTILE} accepted your interest`,
      body: "Reply in the chat.",
      link: `${ORIGIN}/relationships`,
      origin: ORIGIN,
    });
    expect(email.html).not.toContain("<img src=x");
    expect(email.html).toContain(`href="${ORIGIN}/relationships"`);
    expect(email.html).toContain(`href="${ORIGIN}/settings"`);
    expect(email.text).toContain("Turn these emails off in Settings");
    for (const href of hrefs(email.html)) {
      expect(href.startsWith(ORIGIN), href).toBe(true);
    }
  });
});
