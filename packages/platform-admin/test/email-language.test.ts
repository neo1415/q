import { renderEmail } from "@capital-q/email";
import { describe, expect, it, vi } from "vitest";

import { recordingEmailSender } from "../src/index.js";

/**
 * The one sender gives each message the recipient's language: a known
 * person who chose Arabic gets Arabic, right to left; an unknown address
 * (or one whose lookup fails) gets the English as rendered.
 */
type Message = {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  readonly html?: string | undefined;
};

/**
 * A fake database: the language lookup answers from `languages`, the
 * shared machine translations from `machine` (language -> English -> text).
 */
function database(
  languages: Readonly<Record<string, string>>,
  machine: Readonly<Record<string, Readonly<Record<string, string>>>> = {},
) {
  return ((strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join("?");
    if (text.includes("person_standing")) {
      const language = languages[String(values[0])];
      return Promise.resolve(language === undefined ? [] : [{ language }]);
    }
    if (text.includes("ui_translations")) {
      const wanted = new Set(values[2] as readonly string[]);
      return Promise.resolve(
        Object.entries(machine[String(values[0])] ?? {})
          .filter(([english]) => wanted.has(english))
          .map(([source_text, translated_text]) => ({ source_text, translated_text })),
      );
    }
    return Promise.resolve([]);
  }) as never;
}

function codeEmail(to: string): Message {
  const rendered = renderEmail({
    subject: "Your code to claim Fennel Pay on Capital Q",
    preheader: "Enter 482913 on Capital Q. It works for 15 minutes.",
    heading: "Your code: 482913",
    blocks: [
      {
        kind: "paragraph",
        text: "Someone using this address asked to claim Fennel Pay on Capital Q. Enter this code on the screen where you asked; it works for 15 minutes, once.",
      },
    ],
    reason: "This address was entered to claim Fennel Pay on Capital Q.",
    origin: null,
  });
  return {
    to,
    subject: rendered.subject,
    text: rendered.text,
    html: rendered.html,
  };
}

describe("emails in the recipient's language", () => {
  it("sends a known Arabic recipient Arabic, right to left, with the name and code exact", async () => {
    const send = vi
      .fn<(message: Message) => Promise<void>>()
      .mockResolvedValue();
    const sender = recordingEmailSender(
      { available: true, send },
      {
        sql: database({ "ada@fennelpay.co": "ar" }),
        source: "api.gateq",
        provider: "BREVO_API",
      },
    );
    await sender.send(codeEmail("Ada@FennelPay.co"));
    const sent = send.mock.calls[0]?.[0];
    expect(sent?.to).toBe("Ada@FennelPay.co");
    expect(sent?.subject).toBe("رمزك للمطالبة بـ Fennel Pay على Capital Q");
    expect(sent?.html).toContain('<html lang="ar" dir="rtl">');
    expect(sent?.html).toContain("رمزك: 482913");
    expect(sent?.text).toContain("يعمل لمدة 15 دقيقة، مرة واحدة.");
    expect(sent?.text).toContain("Fennel Pay");
  });

  it("sends any other language from the shared machine translations, left to right or right to left by the runtime's data", async () => {
    const send = vi
      .fn<(message: Message) => Promise<void>>()
      .mockResolvedValue();
    const sender = recordingEmailSender(
      { available: true, send },
      {
        sql: database(
          { "zoe@fennelpay.co": "fr", "ali@fennelpay.co": "ur", "kim@fennelpay.co": "sw" },
          {
            fr: {
              "Your code to claim {company} on Capital Q":
                "Votre code pour revendiquer {company} sur Capital Q",
            },
            ur: {
              "Your code to claim {company} on Capital Q":
                "Capital Q پر {company} کا دعویٰ کرنے کے لیے آپ کا کوڈ",
            },
          },
        ),
        source: "api.gateq",
        provider: "BREVO_API",
      },
    );
    await sender.send(codeEmail("zoe@fennelpay.co"));
    await sender.send(codeEmail("ali@fennelpay.co"));
    await sender.send(codeEmail("kim@fennelpay.co"));
    const [french, urdu, swahili] = send.mock.calls.map((call) => call[0]);
    expect(french?.subject).toBe("Votre code pour revendiquer Fennel Pay sur Capital Q");
    expect(french?.html).toContain('<html lang="fr" dir="ltr">');
    expect(urdu?.html).toContain('<html lang="ur" dir="rtl">');
    expect(urdu?.subject).toContain("Fennel Pay");
    // Nothing translated yet for Swahili: the English as rendered, never half.
    expect(swahili?.subject).toBe("Your code to claim Fennel Pay on Capital Q");
  });

  it("sends an unknown recipient the English as rendered", async () => {
    const send = vi
      .fn<(message: Message) => Promise<void>>()
      .mockResolvedValue();
    const sender = recordingEmailSender(
      { available: true, send },
      { sql: database({}), source: "api.gateq", provider: "BREVO_API" },
    );
    const english = codeEmail("someone@elsewhere.co.uk");
    await sender.send(english);
    expect(send.mock.calls[0]?.[0]).toEqual(english);
  });

  it("keeps someone who never chose (AUTO) or chose English in English", async () => {
    const send = vi
      .fn<(message: Message) => Promise<void>>()
      .mockResolvedValue();
    const sender = recordingEmailSender(
      { available: true, send },
      {
        sql: database({
          "a@acme-freight.co.uk": "AUTO",
          "b@acme-freight.co.uk": "en",
        }),
        source: "api.gateq",
        provider: "BREVO_API",
      },
    );
    await sender.send(codeEmail("a@acme-freight.co.uk"));
    await sender.send(codeEmail("b@acme-freight.co.uk"));
    for (const call of send.mock.calls) {
      expect(call[0].subject).toBe(
        "Your code to claim Fennel Pay on Capital Q",
      );
    }
  });

  it("falls back to English when the lookup fails, and still sends", async () => {
    const send = vi
      .fn<(message: Message) => Promise<void>>()
      .mockResolvedValue();
    const sender = recordingEmailSender(
      { available: true, send },
      {
        sql: database({}),
        source: "api.gateq",
        provider: "BREVO_API",
        language: () => Promise.reject(new Error("db down")),
      },
    );
    await sender.send(codeEmail("ada@fennelpay.co"));
    expect(send.mock.calls[0]?.[0].subject).toBe(
      "Your code to claim Fennel Pay on Capital Q",
    );
  });
});
