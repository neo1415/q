import {
  Q_ARTIFACT_SECTION_BODY_MAX,
  Q_ARTIFACT_SECTIONS_MAX,
  Q_ARTIFACT_SUMMARY_MAX,
  Q_ARTIFACT_TITLE_MAX,
  type QArtifactContent,
} from "@capital-q/contracts";

/**
 * One of Q's answers as a document (founder live 2026-09-28 #1: "a PDF of
 * an assessment of how I come across" was refused because it was not a
 * deck, a brief or a mandate).
 *
 * Deterministic: the document is the answer as Q wrote it, split at its
 * own headings, and nothing else. No model rewrites it on the way in, so
 * the PDF says exactly what the person read in the conversation; the
 * artifact records that Q wrote it and is no more evidence than the
 * answer was. Markdown the chat renders is reduced to plain text, because
 * an artifact body is plain text (QArtifactSectionSchema).
 */

export const ANSWER_DOCUMENT_ARTIFACT_TYPE = "Q_REPORT";

export type AnswerDocument = {
  readonly title: string;
  readonly summary: string;
  readonly content: QArtifactContent;
};

/** Inline markdown to plain text: the words stay, the markup goes. */
function plain(line: string): string {
  return line
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, "$1 ($2)")
    .replace(/(\*\*|__)(.+?)\1/g, "$2")
    .replace(/(^|[\s(])[*_]([^*_\s][^*_]*?)[*_](?=[\s).,;:!?]|$)/g, "$1$2")
    .replace(/`([^`]+)`/g, "$1");
}

/** A block of lines to body text: list markers become bullets, rules go. */
function body(lines: readonly string[]): string {
  const out: string[] = [];
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (/^\s*([-*_])\s*\1\s*\1[\s\-*_]*$/.test(line)) continue;
    // An empty heading marker says nothing.
    if (/^\s*#+\s*$/.test(line)) continue;
    // A table's separator row carries no words.
    if (/^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line)) {
      continue;
    }
    const table = /^\s*\|(.*)\|\s*$/.exec(line);
    if (table !== null) {
      out.push(
        (table[1] ?? "")
          .split("|")
          .map((cell) => plain(cell.trim()))
          .join(" · "),
      );
      continue;
    }
    const bullet = /^(\s*)(?:[-*+]|\d+[.)])\s+(.*)$/.exec(line);
    if (bullet !== null) {
      out.push(`• ${plain(bullet[2] ?? "")}`);
      continue;
    }
    out.push(plain(line.replace(/^\s*>\s?/, "")));
  }
  return out
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function clip(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trimEnd()}…`;
}

/**
 * The document, or null when the answer holds no words to file (then the
 * caller says there is nothing to put in one).
 */
/**
 * What a piece of Q's work is, from the ask it answered: "Help me prepare
 * for a call with the founder of Anchor" is call prep. A fixed list of the
 * kinds Q writes, compared as words; nothing matched is null (the title
 * then says only who it is about, or the ask itself, never "Q's answer").
 */
const WORK_KINDS: readonly (readonly [RegExp, string])[] = [
  [/\b(prep(are|aring)?|ready)\b.*\bcall\b|\bcall prep\b/iu, "Call prep"],
  [
    /\b(prep(are|aring)?|ready)\b.*\bmeeting\b|\bmeeting prep\b/iu,
    "Meeting prep",
  ],
  [
    /\b(\d{1,2}[- ](month|year|week)\s+)?(growth|go[- ]to[- ]market|fundraising|hiring|business|action)?\s*plan\b/iu,
    "Plan",
  ],
  // F-95 (QA 24 Oct 2026): an IC memo is titled as one ("IC memo: Ledgerfold").
  [/\binvestment(?:\s+committee)?\s+memo\b|\bic\s+memo\b/iu, "IC memo"],
  [/\bmemo\b/iu, "Memo"],
  [/\bcompar(e|ison)\b/iu, "Comparison"],
  [/\bquestions?\b/iu, "Questions"],
  [/\b(summary|summari[sz]e)\b/iu, "Summary"],
  [/\b(outreach|intro(duction)?|email)\b/iu, "Outreach draft"],
  [/\b(analysis|analy[sz]e|assessment|assess|diligence)\b/iu, "Analysis"],
];

/** "12-month growth plan" when the ask names one, else the kind's word. */
function workKind(question: string): string | null {
  for (const [pattern, kind] of WORK_KINDS) {
    const found = pattern.exec(question);
    if (found === null) continue;
    if (kind === "Plan") {
      const named = found[0].trim().replace(/\s+/gu, " ").toLowerCase();
      return named.length > "plan".length
        ? `${named.charAt(0).toUpperCase()}${named.slice(1)}`
        : kind;
    }
    return kind;
  }
  return null;
}

/**
 * F-73 (QA 2026-10-24): saved work is titled by what it is and who it is
 * about -- "Call prep: Anchor", "12-month growth plan: Maji Loop" -- never
 * "Q's answer: <the raw ask>". Q's own first heading names the piece when
 * it gave one (with who it is about, when the heading does not say);
 * otherwise the kind of work the ask was, with its subject; failing a
 * kind, the subject or the ask in a few words.
 */
export function workTitle(input: {
  readonly heading: string | null;
  readonly question: string;
  /** Who or what it is about, as resolved from records or cards; never guessed. */
  readonly subject: string | null;
}): string {
  const subject = input.subject?.trim() ?? "";
  const about = (title: string) =>
    subject.length === 0 || title.toLowerCase().includes(subject.toLowerCase())
      ? title
      : `${title}: ${subject}`;
  if (input.heading !== null && input.heading.length > 0) {
    return about(input.heading);
  }
  const kind = workKind(input.question);
  if (kind !== null) return about(kind);
  if (subject.length > 0) return `Notes: ${subject}`;
  const ask = input.question
    .replace(/^(please\s+|can you\s+|could you\s+|help me\s+|i need\s+)+/iu, "")
    .replace(/[?.!\s]+$/u, "")
    .trim();
  if (ask.length === 0) return "Notes from Q";
  return `${ask.charAt(0).toUpperCase()}${ask.slice(1)}`;
}

export function composeAnswerDocument(input: {
  /** The answer, as Q wrote it (markdown). */
  readonly answer: string;
  /** What they asked, when known: the document says what it answers. */
  readonly question?: string | undefined;
  /** Who or what the work is about, when the turn resolved it (F-73). */
  readonly subject?: string | null | undefined;
}): AnswerDocument | null {
  const lines = input.answer.replace(/\r\n?/g, "\n").split("\n");
  const sections: { heading: string; lines: string[] }[] = [];
  let current: { heading: string; lines: string[] } = {
    heading: "",
    lines: [],
  };
  for (const line of lines) {
    const heading = /^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
    if (heading !== null) {
      sections.push(current);
      current = { heading: plain(heading[1] ?? "").trim(), lines: [] };
      continue;
    }
    current.lines.push(line);
  }
  sections.push(current);

  const filed = sections.flatMap((section) => {
    const text = body(section.lines);
    if (text.length === 0) return [];
    return [
      {
        heading: clip(section.heading || "Answer", Q_ARTIFACT_TITLE_MAX),
        body: clip(text, Q_ARTIFACT_SECTION_BODY_MAX),
        findings: [],
      },
    ];
  });
  if (filed.length === 0) return null;

  const question = input.question?.trim().replace(/\s+/g, " ") ?? "";
  const named = sections.find((s) => s.heading.length > 0)?.heading ?? null;
  const title = clip(
    workTitle({ heading: named, question, subject: input.subject ?? null }),
    Q_ARTIFACT_TITLE_MAX,
  );
  const summary = clip(
    question.length > 0
      ? `Q's written answer to "${question}", as given in the conversation. It is Q's reading of what Capital Q holds, not verified fact.`
      : "Q's written answer, as given in the conversation. It is Q's reading of what Capital Q holds, not verified fact.",
    Q_ARTIFACT_SUMMARY_MAX,
  );
  return {
    title,
    summary,
    content: { sections: filed.slice(0, Q_ARTIFACT_SECTIONS_MAX), gaps: [] },
  };
}
