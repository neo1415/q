import { readFileSync, writeFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  authEmailTemplates,
  EMAIL_COLOURS,
  renderEmail,
  renderPlainTextEmail,
  safeUrl,
} from "../src/index.js";

/**
 * DOCS: the one Capital Q email layout. Structure, plain text, escaping,
 * absolute links, contrast, and the Supabase Auth templates kept in step
 * with what is on disk.
 */

const ORIGIN = "https://app.capitalq.example";

const sample = () =>
  renderEmail({
    subject: "Your call is booked",
    preheader: "Thursday at 10:00",
    heading: "Your call is booked: Intro with Ada <b>Obi</b>",
    blocks: [
      {
        kind: "paragraph",
        text: 'Ada wrote "<script>alert(1)</script>" & more.',
      },
      { kind: "facts", rows: [{ label: "When", value: "Thursday 10:00 <i>" }] },
      {
        kind: "button",
        label: "Join",
        href: "https://meet.google.com/abc-defg-hij",
      },
      {
        kind: "link",
        label: "Or open:",
        href: "https://meet.google.com/abc-defg-hij",
        showUrl: true,
      },
      { kind: "note", text: "Time zone: Africa/Lagos" },
    ],
    reason:
      "You're receiving this because this call was arranged on Capital Q.",
    origin: ORIGIN,
  });

function luminance(hex: string): number {
  const channel = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const n = Number.parseInt(hex.slice(1), 16);
  return (
    0.2126 * channel((n >> 16) & 255) +
    0.7152 * channel((n >> 8) & 255) +
    0.0722 * channel(n & 255)
  );
}
function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return ((x ?? 0) + 0.05) / ((y ?? 0) + 0.05);
}

describe("the Capital Q email layout", () => {
  it("is one 600px column with the wordmark, a heading, a preheader and a footer", () => {
    const email = sample();
    expect(email.html.startsWith("<!doctype html>")).toBe(true);
    expect(email.html).toContain("max-width:600px");
    expect(email.html).toContain(">Capital Q</td>");
    expect(email.html).toContain("display:none;max-height:0");
    expect(email.html).toContain("Thursday at 10:00");
    expect(email.html).toContain(
      '<meta name="color-scheme" content="light dark">',
    );
    expect(email.html).toContain("prefers-color-scheme: dark");
    expect(email.html).toContain(`href="${ORIGIN}/settings"`);
    expect(email.html).toContain(
      "Investment intelligence for founders and investors",
    );
    // Nothing depends on an image.
    expect(email.html).not.toContain("<img");
  });

  it("escapes everything a template passes in", () => {
    const email = sample();
    expect(email.html).not.toContain("<script>");
    expect(email.html).not.toContain("<b>Obi</b>");
    expect(email.html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(email.html).toContain("&lt;i&gt;");
  });

  it("has a plain-text alternative carrying the same content and links", () => {
    const email = sample();
    expect(email.text).toContain(
      "Your call is booked: Intro with Ada <b>Obi</b>",
    );
    expect(email.text).toContain("Join: https://meet.google.com/abc-defg-hij");
    expect(email.text).toContain("When: Thursday 10:00 <i>");
    expect(email.text).toContain(`Manage notifications: ${ORIGIN}/settings`);
    expect(email.text).not.toContain("<td");
  });

  it("sends only absolute https links (local origins in development); refuses the rest", () => {
    expect(safeUrl("https://app.capitalq.example/home")).not.toBeNull();
    expect(safeUrl("http://127.0.0.1:3000/home")).not.toBeNull();
    for (const bad of [
      "/admin",
      "javascript:alert(1)",
      "http://evil.example/x",
      "data:text/html,hi",
      "https://user:pw@evil.example/",
    ]) {
      expect(safeUrl(bad), bad).toBeNull();
    }
    const email = renderEmail({
      subject: "s",
      preheader: "p",
      heading: "h",
      blocks: [
        { kind: "button", label: "Go", href: "javascript:alert(1)" },
        { kind: "link", label: "Rel", href: "/admin" },
      ],
      reason: "r",
      origin: null,
    });
    expect(email.html).not.toContain("javascript:");
    expect(email.html).not.toContain('href="/admin"');
    for (const href of email.html.matchAll(/href="([^"]+)"/g)) {
      expect(href[1]?.startsWith("https://") ?? false).toBe(true);
    }
  });

  it("meets WCAG AA contrast in light and dark", () => {
    for (const mode of ["light", "dark"] as const) {
      const c = EMAIL_COLOURS[mode];
      for (const ink of [c.text, c.secondary, c.tertiary, c.accent]) {
        expect(
          contrast(ink, c.surface),
          `${mode} ${ink}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
      expect(
        contrast(c.tertiary, c.canvas),
        `${mode} footer`,
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        contrast(c.onAccent, c.accent),
        `${mode} button`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("frames a text-only message under its subject, URLs as links", () => {
    const email = renderPlainTextEmail({
      subject: "Note",
      text: "Something changed\n\nOpen it here https://app.capitalq.example/home\n\n-- Capital Q",
      origin: null,
    });
    expect(email.html).toContain(">Note</h1>");
    expect(email.html).toContain("Something changed");
    expect(email.html).toContain('href="https://app.capitalq.example/home"');
    expect(email.text).toContain("https://app.capitalq.example/home");
  });
});

describe("the Supabase Auth templates", () => {
  it("magic link shows the typed code for the step-up sign-in", () => {
    const magic = authEmailTemplates().find((t) => t.name === "magic_link");
    expect(magic?.html).toContain("Or enter this code:");
    expect(magic?.html).toContain("{{ .Token }}");
    // Recovery and confirmation are link-only (token_hash in the callback).
    expect(
      authEmailTemplates().find((t) => t.name === "recovery")?.html,
    ).not.toContain("{{ .Token }}");
  });

  it("are on the layout, link only the confirmation placeholder, and match the files", () => {
    for (const template of authEmailTemplates()) {
      expect(template.html).toContain('href="{{ .ConfirmationURL }}"');
      expect(template.html).toContain(">Capital Q</td>");
      const path = new URL(
        `../../../supabase/templates/${template.name}.html`,
        import.meta.url,
      );
      if (process.env["CQ_WRITE_EMAIL_TEMPLATES"] === "1") {
        writeFileSync(path, template.html);
      }
      expect(readFileSync(path, "utf8")).toBe(template.html);
    }
  });
});
