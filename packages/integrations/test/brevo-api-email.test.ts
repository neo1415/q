import { describe, expect, it, vi } from "vitest";

import { createBrevoApiEmailSender } from "../src/index.js";

/**
 * App email over HTTPS (founder live 2026-09-29): the deployment blocks
 * outbound SMTP, so reminders go through Brevo's transactional API.
 */

const key = { reveal: () => "disabled-locally-000000000000" };

describe("Brevo API email sender", () => {
  it("posts one plain-text message from the configured sender", async () => {
    const fetch = vi.fn(() =>
      Promise.resolve(new Response("{}", { status: 201 })),
    );
    const sender = createBrevoApiEmailSender({
      apiKey: key,
      sender: "Capital Q <q@example.test>",
      fetch,
    });
    await sender.send({
      to: "founder@example.test",
      subject: "Reminder: follow up",
      text: "Follow up",
    });
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.brevo.com/v3/smtp/email");
    expect(JSON.parse(init.body as string)).toEqual({
      sender: { email: "q@example.test", name: "Capital Q" },
      to: [{ email: "founder@example.test" }],
      subject: "Reminder: follow up",
      textContent: "Follow up",
    });
  });

  it("refuses header injection and throws with the status on refusal", async () => {
    const fetch = vi.fn(() =>
      Promise.resolve(new Response("{}", { status: 401 })),
    );
    const sender = createBrevoApiEmailSender({
      apiKey: key,
      sender: "q@example.test",
      fetch,
    });
    await expect(
      sender.send({ to: "a@b.test\nBcc: x@y", subject: "s", text: "t" }),
    ).rejects.toThrow("header injection refused");
    await expect(
      sender.send({ to: "a@b.test", subject: "s", text: "t" }),
    ).rejects.toMatchObject({ code: "EAPI", responseCode: 401 });
  });
});
