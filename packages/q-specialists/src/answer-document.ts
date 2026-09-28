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
export function composeAnswerDocument(input: {
  /** The answer, as Q wrote it (markdown). */
  readonly answer: string;
  /** What they asked, when known: the document says what it answers. */
  readonly question?: string | undefined;
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
  // The first heading names the piece when Q gave it one; otherwise what
  // was asked does, and failing both it is simply Q's answer.
  const named = sections.find((s) => s.heading.length > 0)?.heading;
  const title = clip(
    named ?? (question.length > 0 ? `Q's answer: ${question}` : "Q's answer"),
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
