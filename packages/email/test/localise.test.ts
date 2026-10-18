import { describe, expect, it } from "vitest";

import {
  EMAIL_ARABIC,
  localiseEmail,
  renderEmail,
  translateEmailText,
} from "../src/index.js";

/**
 * Transactional emails in the recipient's language (multilingual Q): the
 * rendered English becomes Arabic, right to left, while names, codes,
 * links, dates and amounts stay exactly as rendered.
 */
const PLACEHOLDERS = /\{[A-Za-z][A-Za-z0-9]*\}/gu;
const ARABIC = /[؀-ۿ]/u;

function invitation() {
  return renderEmail({
    subject: "Ada Obi invited you to join Kiln Ventures on Capital Q",
    preheader: "Join as a Member. The link works for 7 days.",
    heading: "Join Kiln Ventures",
    blocks: [
      {
        kind: "paragraph",
        text: "Ada Obi invited you to join Kiln Ventures on Capital Q as a Member. You'll work on the firm's relationships, notes and documents together.",
      },
      {
        kind: "button",
        label: "Join Kiln Ventures",
        href: "https://app.capitalq.example/join/abc?x=1&y=2",
      },
      {
        kind: "link",
        label: "Or open this link",
        href: "https://app.capitalq.example/join/abc?x=1&y=2",
        showUrl: true,
      },
      {
        kind: "facts",
        rows: [{ label: "When", value: "Thursday 16 October, 14:00 BST" }],
      },
    ],
    reason:
      "Ada Obi entered this address to invite you to their firm on Capital Q.",
    origin: "https://app.capitalq.example",
  });
}

describe("the email catalogue", () => {
  it("is Arabic and keeps every placeholder", () => {
    for (const [english, arabic] of Object.entries(EMAIL_ARABIC)) {
      if (
        /[A-Za-z]{2}/u.test(english.replace(PLACEHOLDERS, "")) &&
        arabic !== english
      ) {
        expect(ARABIC.test(arabic), english).toBe(true);
      }
      expect((arabic.match(PLACEHOLDERS) ?? []).toSorted(), english).toEqual(
        (english.match(PLACEHOLDERS) ?? []).toSorted(),
      );
    }
  });
});

describe("localiseEmail", () => {
  it("renders an invitation in Arabic, right to left, names and links exact", () => {
    const english = invitation();
    const message = {
      to: "person@acme.example",
      subject: english.subject,
      text: english.text,
      html: english.html,
      fromName: "Ada Obi via Capital Q",
    };
    const arabic = localiseEmail(message, "ar");
    expect(arabic.to).toBe("person@acme.example");
    expect(arabic.subject).toBe(
      "دعاك Ada Obi للانضمام إلى Kiln Ventures على Capital Q",
    );
    expect(arabic.fromName).toBe("Ada Obi عبر Capital Q");
    expect(arabic.html).toContain('<html lang="ar" dir="rtl">');
    expect(arabic.html).toContain('<body dir="rtl" ');
    expect(arabic.html).toContain("بصفة عضو");
    expect(arabic.html).toContain("المؤسسة الاستثمارية");
    expect(arabic.html).toContain("انضم إلى Kiln Ventures");
    // Links and dates are untouched, in the HTML and the text.
    expect(arabic.html).toContain(
      'href="https://app.capitalq.example/join/abc?x=1&amp;y=2"',
    );
    expect(arabic.html).toContain("Thursday 16 October, 14:00 BST");
    expect(arabic.text).toContain(
      "أو افتح هذا الرابط https://app.capitalq.example/join/abc?x=1&y=2",
    );
    expect(arabic.text).toContain("الموعد: Thursday 16 October, 14:00 BST");
    expect(arabic.text).toContain(
      "إدارة الإشعارات: https://app.capitalq.example/settings",
    );
    expect(arabic.html).not.toContain(">Or open this link");
  });

  it("returns English untouched", () => {
    const english = invitation();
    const message = {
      to: "a@b.example",
      subject: english.subject,
      text: english.text,
      html: english.html,
    };
    expect(localiseEmail(message, "en")).toBe(message);
  });

  it("keeps codes and figures exact, and leaves what a person wrote alone", () => {
    expect(
      translateEmailText("Enter 482913 on Capital Q. It works for 15 minutes."),
    ).toBe("أدخل 482913 على Capital Q. يعمل لمدة 15 دقيقة.");
    expect(translateEmailText("Your code: 482913")).toBe("رمزك: 482913");
    expect(translateEmailText("We'd love to see your deck next quarter.")).toBe(
      "We'd love to see your deck next quarter.",
    );
  });

  it("gives a text-only message the branded layout, right to left", () => {
    const out = localiseEmail(
      {
        to: "a@b.example",
        subject: "Reminder: Call Kiln",
        text: "Open Capital Q to act on it.",
        html: undefined,
      },
      "ar",
    );
    expect(out.subject).toBe("تذكير: Call Kiln");
    expect(out.html).toContain('dir="rtl"');
    expect(out.html).toContain("افتح Capital Q للتصرف بشأنه.");
  });
});
