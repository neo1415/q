import { describe, expect, it, vi } from "vitest";

import { brandedEmailHtml, createBrevoApiEmailSender } from "../src/index.js";

/**
 * App email over HTTPS (founder live 2026-09-29): the deployment blocks
 * outbound SMTP, so reminders go through Brevo's transactional API.
 */

const key = { reveal: () => "disabled-locally-000000000000" };

describe("Brevo API email sender", () => {
  it("posts one message, plain text and Capital Q's branded HTML, from the configured sender", async () => {
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
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body).toMatchObject({
      sender: { email: "q@example.test", name: "Capital Q" },
      to: [{ email: "founder@example.test" }],
      subject: "Reminder: follow up",
      textContent: "Follow up",
    });
    expect(String(body["htmlContent"])).toContain("Capital Q");
    expect(String(body["htmlContent"])).toContain("Follow up");
  });

  it("names a bare sender address Capital Q (founder direction 2026-09-30)", async () => {
    const fetch = vi.fn(() =>
      Promise.resolve(new Response("{}", { status: 201 })),
    );
    await createBrevoApiEmailSender({
      apiKey: key,
      sender: "q@example.test",
      fetch,
    }).send({ to: "a@b.test", subject: "s", text: "t" });
    const [, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(
      (JSON.parse(init.body as string) as { sender: unknown }).sender,
    ).toEqual({ email: "q@example.test", name: "Capital Q" });
  });

  it("escapes the words it frames and links only https addresses", () => {
    const html = brandedEmailHtml({
      subject: "Hi",
      text: "<script>x</script> see https://capitalq.app/profile",
    });
    expect(html).not.toContain("<script>x");
    expect(html).toContain('href="https://capitalq.app/profile"');
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
