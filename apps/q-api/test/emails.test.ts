import { describe, expect, it } from "vitest";

import {
  accountPausedEmail,
  callInviteEmail,
} from "../src/composition/emails.js";

/** DOCS: the Q API's emails on the shared Capital Q layout. */

const ORIGIN = "https://app.capitalq.example";

describe("the Q API's emails", () => {
  it("call invite: escaped purpose, the time and zone, and its text twin", () => {
    const email = callInviteEmail({
      purpose: "Intro <script>x</script>",
      when: "Thursday 9 October 2026 at 10:00",
      timeZone: "Africa/Lagos",
      origin: ORIGIN,
    });
    expect(email.subject).toBe("Call: Intro <script>x</script>");
    expect(email.html).not.toContain("<script>x");
    expect(email.html).toContain("Africa/Lagos");
    expect(email.text).toContain("invite.ics");
  });

  it("account paused: an absolute link to the admin console, never a relative one", () => {
    const email = accountPausedEmail({
      name: 'Eve "<b>"',
      strikes: 3,
      origin: ORIGIN,
    });
    expect(email.html).toContain(`href="${ORIGIN}/admin"`);
    expect(email.html).not.toContain('href="/admin"');
    expect(email.html).not.toContain("<b>");
    expect(email.text).toContain(`${ORIGIN}/admin`);
  });
});
