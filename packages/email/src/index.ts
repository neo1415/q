/**
 * Capital Q's one email layout (DOCS, founder directive 2026-10-01:
 * "brand all the email templates and make sure the emails look nice and
 * professional").
 *
 * Every email Capital Q sends renders through `renderEmail`: the same
 * wordmark, colours, type, 600px single column, button and footer, a
 * preheader, and a plain-text alternative built from the same blocks so
 * the two can never say different things.
 *
 * Rules this module holds for every template:
 * - Everything a template passes in is TEXT and is escaped here. The one
 *   exception is `trustedHtml`, which only this package's own builders and
 *   The Q Daily's escaped layout produce; nothing a person typed reaches it
 *   unescaped.
 * - Links are absolute https (or the local web origin in development).
 *   A relative or script link is refused rather than sent.
 * - Nothing depends on an image: the wordmark is text, so an email reads
 *   the same with images blocked, in dark mode, and in a screen reader.
 * - Calm and institutional (CLAUDE.md design rules): no gradients, glows,
 *   badges or uppercase eyebrows.
 */

/**
 * The --cq-* tokens (packages/ui/src/tokens/tokens.css, light and dark),
 * converted once from OKLCH to the hex every email client understands.
 * The only place an email colour is defined.
 */
export const EMAIL_COLOURS = {
  light: {
    canvas: "#f4f3f0", // --cq-surface-subtle: the page around the card
    surface: "#ffffff", // --cq-surface-raised
    subtle: "#fbfaf7", // --cq-canvas: quiet panels inside the card
    text: "#101419", // --cq-text-primary (17.9:1 on surface)
    secondary: "#4c5057", // --cq-text-secondary (8.1:1)
    tertiary: "#686c72", // --cq-text-tertiary (5.3:1, AA)
    border: "#dfe1e5", // --cq-border-subtle
    accent: "#1767d1", // --cq-accent (5.3:1 on white; white on it 5.3:1)
    onAccent: "#ffffff",
  },
  dark: {
    canvas: "#0b0d12", // --cq-canvas (dark)
    surface: "#171b20", // --cq-surface-raised (dark)
    subtle: "#1c1f24", // --cq-surface-subtle (dark)
    text: "#efeeeb", // --cq-text-primary (dark, 15.2:1)
    secondary: "#abaeb3", // --cq-text-secondary (dark, 8.0:1)
    tertiary: "#9a9da2", // lifted from #86898e to keep AA on #171b20
    border: "#26292e", // --cq-border-subtle (dark)
    accent: "#66a5ff", // --cq-accent (dark)
    onAccent: "#0b0d12",
  },
} as const;

const FONT =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif";

export const EMAIL_COMPANY_LINE =
  "Capital Q · Investment intelligence for founders and investors";

export function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** A URL a person may be sent to from an email, or null. */
export function safeUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.username !== "" || parsed.password !== "") return null;
    if (parsed.protocol === "https:") return parsed.href;
    // Development origins only: an email from a local stack links back to it.
    if (
      parsed.protocol === "http:" &&
      (parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost")
    ) {
      return parsed.href;
    }
    return null;
  } catch {
    return null;
  }
}

/** HTML a template built from escaped parts; see the module comment. */
export type TrustedHtml = { readonly trustedHtml: string };

export type EmailBlock =
  /** A paragraph of plain text; blank lines are not needed between blocks. */
  | { readonly kind: "paragraph"; readonly text: string }
  /** A small, quiet line (a time zone, a caveat). */
  | { readonly kind: "note"; readonly text: string }
  /** Label/value rows: when, where, how long. */
  | {
      readonly kind: "facts";
      readonly rows: readonly {
        readonly label: string;
        readonly value: string;
      }[];
    }
  /** The one primary action, as a bulletproof table button. */
  | { readonly kind: "button"; readonly label: string; readonly href: string }
  /** A link written out, for clients that hide buttons. */
  | {
      readonly kind: "link";
      readonly label: string;
      readonly href: string;
      /** Show the URL itself after the label (a Meet link). */
      readonly showUrl?: boolean | undefined;
    }
  /** A hairline between parts. */
  | { readonly kind: "divider" }
  /** A layout another template built (The Q Daily), with its own text. */
  | {
      readonly kind: "trusted";
      readonly html: TrustedHtml;
      readonly text: string;
    };

export type EmailInput = {
  readonly subject: string;
  /** What an inbox shows after the subject; never repeated in the body. */
  readonly preheader: string;
  /** The first line of the email, large. */
  readonly heading: string;
  readonly blocks: readonly EmailBlock[];
  /** Why this person got this email, in one sentence. */
  readonly reason: string;
  /** The web origin, for "Manage notifications"; null leaves it out. */
  readonly origin: string | null;
  /** Wider content (The Q Daily) uses less inner padding. */
  readonly density?: "regular" | "editorial" | undefined;
};

export type RenderedEmail = {
  readonly subject: string;
  readonly preheader: string;
  readonly html: string;
  readonly text: string;
};

const C = EMAIL_COLOURS.light;

/** Dark-mode overrides for clients that honour prefers-color-scheme. */
const DARK_CSS = `
:root{color-scheme:light dark;supported-color-schemes:light dark}
@media (prefers-color-scheme: dark){
.cq-canvas{background:${EMAIL_COLOURS.dark.canvas}!important}
.cq-card{background:${EMAIL_COLOURS.dark.surface}!important;border-color:${EMAIL_COLOURS.dark.border}!important}
.cq-subtle{background:${EMAIL_COLOURS.dark.subtle}!important}
.cq-text{color:${EMAIL_COLOURS.dark.text}!important}
.cq-secondary{color:${EMAIL_COLOURS.dark.secondary}!important}
.cq-tertiary{color:${EMAIL_COLOURS.dark.tertiary}!important}
.cq-rule{border-color:${EMAIL_COLOURS.dark.border}!important}
.cq-link{color:${EMAIL_COLOURS.dark.accent}!important}
.cq-button{background:${EMAIL_COLOURS.dark.accent}!important;border-color:${EMAIL_COLOURS.dark.accent}!important}
.cq-button a{color:${EMAIL_COLOURS.dark.onAccent}!important}
.cq-mark{background:${EMAIL_COLOURS.dark.text}!important;color:${EMAIL_COLOURS.dark.canvas}!important}
[style*="color:${EMAIL_COLOURS.light.text}"]{color:${EMAIL_COLOURS.dark.text}!important}
[style*="color:${EMAIL_COLOURS.light.secondary}"]{color:${EMAIL_COLOURS.dark.secondary}!important}
[style*="color:${EMAIL_COLOURS.light.tertiary}"]{color:${EMAIL_COLOURS.dark.tertiary}!important}
[style*="solid ${EMAIL_COLOURS.light.border}"]{border-color:${EMAIL_COLOURS.dark.border}!important}
[style*="solid ${EMAIL_COLOURS.light.text}"],[style*="double ${EMAIL_COLOURS.light.text}"]{border-color:${EMAIL_COLOURS.dark.secondary}!important}
[style*="background:${EMAIL_COLOURS.light.accent}"]{background:${EMAIL_COLOURS.dark.accent}!important}
}
@media only screen and (max-width:620px){
.cq-pad{padding-left:20px!important;padding-right:20px!important}
.cq-h1{font-size:22px!important;line-height:30px!important}
.cq-button,.cq-button a{display:block!important;width:100%!important;box-sizing:border-box}
}`;

function block(item: EmailBlock): { html: string; text: string } {
  switch (item.kind) {
    case "paragraph":
      return {
        html: `<p class="cq-text" style="margin:0 0 16px;font:16px/26px ${FONT};color:${C.text}">${escapeHtml(item.text).replaceAll("\n", "<br>")}</p>`,
        text: item.text,
      };
    case "note":
      return {
        html: `<p class="cq-secondary" style="margin:0 0 16px;font:14px/22px ${FONT};color:${C.secondary}">${escapeHtml(item.text).replaceAll("\n", "<br>")}</p>`,
        text: item.text,
      };
    case "facts":
      return {
        html: `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="cq-subtle" style="margin:0 0 20px;background:${C.subtle};border-radius:8px">${item.rows
          .map(
            (row, index) =>
              `<tr><td class="cq-tertiary" valign="top" style="padding:${index === 0 ? 14 : 4}px 16px ${index === item.rows.length - 1 ? 14 : 4}px;width:96px;font:13px/22px ${FONT};color:${C.tertiary}">${escapeHtml(row.label)}</td><td class="cq-text" valign="top" style="padding:${index === 0 ? 14 : 4}px 16px ${index === item.rows.length - 1 ? 14 : 4}px 0;font:15px/22px ${FONT};color:${C.text};font-weight:600">${escapeHtml(row.value)}</td></tr>`,
          )
          .join("")}</table>`,
        text: item.rows.map((row) => `${row.label}: ${row.value}`).join("\n"),
      };
    case "button": {
      const href = safeUrl(item.href);
      if (href === null) return { html: "", text: "" };
      return {
        html: `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:8px 0 24px"><tr><td class="cq-button" align="center" bgcolor="${C.accent}" style="background:${C.accent};border:1px solid ${C.accent};border-radius:8px"><a href="${escapeHtml(href)}" target="_blank" style="display:inline-block;padding:13px 24px;font:600 16px/20px ${FONT};color:${C.onAccent};text-decoration:none;border-radius:8px">${escapeHtml(item.label)}</a></td></tr></table>`,
        text: `${item.label}: ${href}`,
      };
    }
    case "link": {
      const href = safeUrl(item.href);
      if (href === null) return { html: "", text: "" };
      const shown =
        item.showUrl === true
          ? `${escapeHtml(item.label)} <a class="cq-link" href="${escapeHtml(href)}" target="_blank" style="color:${C.accent};text-decoration:underline;word-break:break-all">${escapeHtml(href)}</a>`
          : `<a class="cq-link" href="${escapeHtml(href)}" target="_blank" style="color:${C.accent};text-decoration:underline">${escapeHtml(item.label)}</a>`;
      return {
        html: `<p class="cq-secondary" style="margin:0 0 16px;font:14px/22px ${FONT};color:${C.secondary}">${shown}</p>`,
        text: `${item.label}${item.showUrl === true ? " " : ": "}${href}`,
      };
    }
    case "divider":
      return {
        html: `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:8px 0 20px"><tr><td class="cq-rule" style="border-top:1px solid ${C.border};font-size:0;line-height:0">&nbsp;</td></tr></table>`,
        text: "",
      };
    case "trusted":
      return { html: item.html.trustedHtml, text: item.text };
  }
}

/** Render one email: HTML and its plain-text alternative. */
export function renderEmail(input: EmailInput): RenderedEmail {
  const subject = input.subject
    .replace(/[\r\n]+/g, " ")
    .trim()
    .slice(0, 180);
  const preheader = input.preheader.replace(/\s+/g, " ").trim().slice(0, 140);
  const parts = input.blocks.map(block);
  const settings =
    input.origin === null ? null : safeUrl(`${input.origin}/settings`);
  const pad = input.density === "editorial" ? 24 : 40;

  const footer = [
    `<p class="cq-tertiary" style="margin:0 0 8px;font:13px/20px ${FONT};color:${C.tertiary}">${escapeHtml(input.reason)}</p>`,
    settings === null
      ? ""
      : `<p class="cq-tertiary" style="margin:0 0 8px;font:13px/20px ${FONT};color:${C.tertiary}"><a class="cq-link" href="${escapeHtml(settings)}" target="_blank" style="color:${C.tertiary};text-decoration:underline">Manage notifications</a></p>`,
    `<p class="cq-tertiary" style="margin:0;font:13px/20px ${FONT};color:${C.tertiary}">${escapeHtml(EMAIL_COMPANY_LINE)}</p>`,
  ].join("");

  // Hidden preheader, padded so clients do not pull body text after it.
  const preheaderHtml = `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:${C.canvas};opacity:0">${escapeHtml(preheader)}${"&#8199;&#65279;&#847;".repeat(40)}</div>`;

  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><meta name="supported-color-schemes" content="light dark"><meta name="x-apple-disable-message-reformatting"><title>${escapeHtml(subject)}</title><style>${DARK_CSS}</style></head><body class="cq-canvas" style="margin:0;padding:0;background:${C.canvas};-webkit-text-size-adjust:100%">${preheaderHtml}<table role="presentation" width="100%" cellpadding="0" cellspacing="0" class="cq-canvas" style="background:${C.canvas}"><tr><td align="center" style="padding:32px 12px"><table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px"><tr><td class="cq-pad" style="padding:0 ${pad}px 20px"><table role="presentation" cellpadding="0" cellspacing="0"><tr><td class="cq-mark" width="28" height="28" align="center" valign="middle" style="width:28px;height:28px;border-radius:7px;background:${C.text};color:${C.surface};font:700 15px/28px ${FONT};mso-line-height-rule:exactly">Q</td><td class="cq-text" style="padding-left:10px;font:600 17px/28px ${FONT};color:${C.text};letter-spacing:-0.2px">Capital Q</td></tr></table></td></tr><tr><td class="cq-card" role="article" aria-label="${escapeHtml(subject)}" style="background:${C.surface};border:1px solid ${C.border};border-radius:12px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td class="cq-pad" style="padding:${pad}px ${pad}px ${pad - 16}px"><h1 class="cq-text cq-h1" style="margin:0 0 20px;font:600 24px/32px ${FONT};color:${C.text};letter-spacing:-0.3px">${escapeHtml(input.heading)}</h1>${parts
    .map((part) => part.html)
    .join(
      "",
    )}</td></tr></table></td></tr><tr><td class="cq-pad" style="padding:24px ${pad}px 8px">${footer}</td></tr></table></td></tr></table></body></html>`;

  const text = [
    input.heading,
    "",
    ...parts
      .map((part) => part.text)
      .filter((line) => line.length > 0)
      .flatMap((line) => [line, ""]),
    "--",
    input.reason,
    ...(settings === null ? [] : [`Manage notifications: ${settings}`]),
    EMAIL_COMPANY_LINE,
  ].join("\n");

  return { subject, preheader, html, text };
}

/**
 * A message that only ever had plain text (the fallback for any sender
 * that did not build one): its paragraphs, its https URLs as links, inside
 * the same layout, under its subject as the heading.
 */
export function renderPlainTextEmail(input: {
  readonly subject: string;
  readonly text: string;
  readonly origin: string | null;
}): RenderedEmail {
  const paragraphs = input.text
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && part !== "-- Capital Q");
  const blocks: EmailBlock[] = paragraphs.flatMap((paragraph): EmailBlock[] => {
    const urls = paragraph.match(/https?:\/\/[^\s<>"]+/g) ?? [];
    const words = paragraph.replace(/https?:\/\/[^\s<>"]+/g, "").trim();
    return [
      ...(words.length === 0
        ? []
        : [{ kind: "paragraph", text: words } as const]),
      ...urls.map(
        (url) =>
          ({ kind: "link", label: "Open", href: url, showUrl: true }) as const,
      ),
    ];
  });
  return renderEmail({
    subject: input.subject,
    preheader: paragraphs[0] ?? input.subject,
    heading: input.subject,
    blocks,
    reason: "You're receiving this because of your Capital Q account.",
    origin: input.origin,
  });
}

export { authEmailTemplates, type AuthTemplate } from "./auth-templates.js";
