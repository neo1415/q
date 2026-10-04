import { describe, expect, it } from "vitest";

import {
  INBOUND_TEXT_MAX_CHARS,
  newInboundToken,
  readPostmarkInbound,
} from "../src/index.js";

const TOKEN = "abcdefghijklmnopqrstuvwxyz";

describe("readPostmarkInbound", () => {
  it("keeps sender, recipients, subject, text and attachment metadata only", () => {
    const email = readPostmarkInbound({
      MessageID: "0f1e2d3c-aaaa-bbbb-cccc-000000000001",
      From: "Sam <sam@example.invalid>",
      FromFull: { Email: "Sam@Example.invalid", Name: "Sam\r\nBcc: x" },
      ToFull: [
        { Email: `hash+${TOKEN}@inbound.example.invalid`, MailboxHash: TOKEN },
      ],
      CcFull: [{ Email: "cc@example.invalid" }],
      MailboxHash: TOKEN.toUpperCase(),
      Subject: "Hello\r\nBcc: victim@example.invalid",
      TextBody: "Line one\r\nLine two\u0000",
      Attachments: [
        {
          Name: "a.pdf",
          ContentType: "application/pdf",
          ContentLength: 10,
          Content: "QUJD",
        },
      ],
      Headers: [{ Name: "X-Anything", Value: "ignored" }],
    });
    expect(email).toEqual({
      providerMessageId: "0f1e2d3c-aaaa-bbbb-cccc-000000000001",
      mailboxHash: TOKEN,
      fromAddress: "sam@example.invalid",
      fromName: "Sam Bcc: x",
      toAddresses: `hash+${TOKEN}@inbound.example.invalid`,
      ccAddresses: "cc@example.invalid",
      subject: "Hello Bcc: victim@example.invalid",
      textBody: "Line one\nLine two",
      textTruncated: false,
      attachments: [
        { name: "a.pdf", contentType: "application/pdf", size: 10 },
      ],
    });
    expect(JSON.stringify(email)).not.toContain("QUJD");
  });

  it("finds the token on a recipient, and treats a malformed one as none", () => {
    const base = {
      MessageID: "m-1",
      From: "x@example.invalid",
      ToFull: [{ Email: "a@example.invalid", MailboxHash: TOKEN }],
    };
    expect(readPostmarkInbound(base)?.mailboxHash).toBe(TOKEN);
    expect(
      readPostmarkInbound({ ...base, ToFull: [], MailboxHash: "not a token" })
        ?.mailboxHash,
    ).toBeNull();
  });

  it("truncates a long body and says so; falls back to the HTML's text", () => {
    const long = readPostmarkInbound({
      MessageID: "m-2",
      From: "x@example.invalid",
      TextBody: "a".repeat(INBOUND_TEXT_MAX_CHARS + 5),
    });
    expect(long?.textBody).toHaveLength(INBOUND_TEXT_MAX_CHARS);
    expect(long?.textTruncated).toBe(true);
    const html = readPostmarkInbound({
      MessageID: "m-3",
      From: "x@example.invalid",
      HtmlBody: "<p>Hi <b>there</b></p><script>alert(1)</script>",
    });
    expect(html?.textBody).toBe("Hi there");
  });

  it("refuses what is not an inbound message", () => {
    expect(readPostmarkInbound(null)).toBeNull();
    expect(readPostmarkInbound({ MessageID: "m-4" })).toBeNull();
    expect(
      readPostmarkInbound({ MessageID: "bad id!", From: "x@example.invalid" }),
    ).toBeNull();
  });
});

describe("newInboundToken", () => {
  it("is 26 lowercase base32 characters and does not repeat", () => {
    const tokens = new Set(
      Array.from({ length: 200 }, () => newInboundToken()),
    );
    expect(tokens.size).toBe(200);
    for (const token of tokens) expect(token).toMatch(/^[a-z2-7]{26}$/);
  });
});
