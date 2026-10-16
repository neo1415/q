import { EMAIL_ARABIC } from "./arabic.js";
import { renderPlainTextEmail } from "./index.js";

/**
 * Transactional emails in the recipient's language (multilingual Q).
 *
 * The sender localises a message that a template already rendered in
 * English, so every template, and every sender that only brings text, is
 * covered by one step at the point of sending. The text a template wrote
 * is matched exactly against the catalogue (./arabic.ts); a placeholder
 * captures what must stay exact (names, codes, links, dates, amounts) and
 * puts it back unchanged. Anything not in the catalogue (what a person or
 * Q wrote) stays as it is. Arabic HTML is marked lang="ar" dir="rtl".
 */
export type EmailLanguage = "en" | "ar";

type Pattern = {
  readonly regex: RegExp;
  readonly names: readonly string[];
  readonly template: string;
};

const PLACEHOLDER = /\{([A-Za-z][A-Za-z0-9]*)\}/g;
const HAS_PLACEHOLDER = /\{[A-Za-z][A-Za-z0-9]*\}/;

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function compile(key: string, template: string): Pattern {
  const names: string[] = [];
  let source = "";
  let last = 0;
  for (const match of key.matchAll(PLACEHOLDER)) {
    source += escapeRegex(key.slice(last, match.index));
    const name = match[1] ?? "";
    // {n}: a figure only, so someone's words are never taken for one.
    source += /^n\d*$/.test(name) ? "([\\d.,]+)" : "(.+?)";
    names.push(name);
    last = match.index + match[0].length;
  }
  source += escapeRegex(key.slice(last));
  return { regex: new RegExp(`^${source}$`, "s"), names, template };
}

const PATTERNS: readonly Pattern[] = Object.entries(EMAIL_ARABIC)
  .filter(([key]) => HAS_PLACEHOLDER.test(key))
  .map(([key, template]) => compile(key, template));

/** One piece of English in Arabic; unchanged when the catalogue lacks it. */
export function translateEmailText(english: string): string {
  const exact = EMAIL_ARABIC[english];
  if (exact !== undefined) return exact;
  for (const pattern of PATTERNS) {
    const match = pattern.regex.exec(english);
    if (match === null) continue;
    const values = new Map<string, string>();
    pattern.names.forEach((name, index) => {
      const value = match[index + 1] ?? "";
      // A role or "company" inside a sentence; a name stays as written.
      values.set(name, EMAIL_ARABIC[value] ?? value);
    });
    return pattern.template.replace(
      PLACEHOLDER,
      (whole, name: string) => values.get(name) ?? whole,
    );
  }
  return english;
}

/** A line of the plain-text part: whole, or "Label: value" / "Label: url". */
function translateLine(line: string): string {
  const trimmed = line.trim();
  if (trimmed === "") return line;
  const whole = translateEmailText(trimmed);
  if (whole !== trimmed) return line.replace(trimmed, whole);
  // "Label: https://…", "Label https://…" (a written-out link), "Label: value".
  const labelled =
    /^(.+?)(:? )(\S+:\/\/\S+)$/su.exec(trimmed) ??
    /^(.+?)(: )(.+)$/su.exec(trimmed);
  if (labelled !== null) {
    const [, label = "", gap = "", value = ""] = labelled;
    const left = translateEmailText(label);
    if (left !== label) {
      const right = /^\S+:\/\/\S+$/u.test(value)
        ? value
        : translateEmailText(value);
      return line.replace(trimmed, `${left}${gap}${right}`);
    }
  }
  return line;
}

const ENTITIES: Readonly<Record<string, string>> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
};

function unescape(text: string): string {
  return text.replace(/&(?:amp|lt|gt|quot|#39);/g, (entity) => {
    return ENTITIES[entity] ?? entity;
  });
}

function escape(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** Every text node of the HTML (not styles), translated in place. */
function translateHtml(html: string): string {
  const parts = html.split(/(<style[\s\S]*?<\/style>|<[^>]+>)/u);
  const out = parts.map((part) => {
    if (part === "" || part.startsWith("<")) return part;
    // The hidden preheader ends in invisible padding entities; keep them.
    const split = /^([\s\S]*?)((?:&#\d+;)*)$/u.exec(part);
    const body = split?.[1] ?? part;
    const padding = split?.[2] ?? "";
    const trimmed = body.trim();
    if (trimmed === "") return part;
    const english = unescape(trimmed);
    const arabic = translateEmailText(english);
    if (arabic === english) return part;
    return body.replace(trimmed, escape(arabic)) + padding;
  });
  const joined = out.join("");
  // A fragment (a template that brought its own markup) gets a wrapper.
  if (!/<html[\s>]/u.test(joined)) {
    return `<div dir="rtl" lang="ar">${joined}</div>`;
  }
  return joined
    .replace(/<html(?: lang="[^"]*")?>/u, '<html lang="ar" dir="rtl">')
    .replace(/<body /u, '<body dir="rtl" ');
}

export type LocalisableMessage = {
  readonly subject: string;
  readonly text: string;
  readonly html?: string | undefined;
  readonly fromName?: string | undefined;
};

/** The same message in `language`; English is returned untouched. */
export function localiseEmail<M extends LocalisableMessage>(
  message: M,
  language: EmailLanguage,
): M {
  if (language === "en") return message;
  return {
    ...message,
    subject: translateEmailText(message.subject),
    text: message.text.split("\n").map(translateLine).join("\n"),
    // A text-only message gets the branded layout here, so its HTML is
    // right to left too (the sender would otherwise build an English one).
    html: translateHtml(
      message.html ??
        renderPlainTextEmail({
          subject: message.subject,
          text: message.text,
          origin: null,
        }).html,
    ),
    ...(message.fromName === undefined
      ? {}
      : { fromName: translateEmailText(message.fromName) }),
  };
}
