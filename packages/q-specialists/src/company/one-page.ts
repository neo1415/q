import { QArtifactIdSchema, type QArtifactContent } from "@capital-q/contracts";
import {
  documentFromArtifact,
  documentPageCount,
} from "@capital-q/deck-render";
import { splitSentences } from "@capital-q/q-core";

/**
 * A one-page document fits on one page (live6 2026-11-04, production
 * 7b9a267ce: "Write me a one-page memo on Ledgerline" printed on two).
 *
 * The page count is read from the same renderer the PDF download uses;
 * the type sizes are that renderer's and are never reduced here. What
 * gives way is length: findings' repeated lines first, then the last
 * sentence (or list line) of the longest section, again and again, until
 * it fits. The opening section is never removed whole, and the person's
 * own words are not touched: this only shortens what Q wrote.
 */

/** Enough rounds for a page and a half of overflow, and a hard stop. */
const ROUNDS_MAX = 120;
const PLACEHOLDER_ID = QArtifactIdSchema.parse(
  "00000000-0000-4000-8000-000000000000",
);

export type OnePageFrame = {
  /** The artifact type, as the document prints its kind. */
  readonly type: string;
  readonly title: string;
  readonly summary: string;
};

async function pagesOf(
  frame: OnePageFrame,
  content: QArtifactContent,
): Promise<number> {
  const document = documentFromArtifact({
    type: frame.type,
    version: {
      artifactId: PLACEHOLDER_ID,
      version: 1,
      title: frame.title,
      summary: frame.summary,
      content,
      createdAt: new Date().toISOString(),
    },
  });
  return documentPageCount(document, { title: frame.title });
}

/** The body without its last sentence, or its last line when it has lines. */
function shortened(body: string): string {
  const lines = body.trimEnd().split("\n");
  if (lines.length > 1) {
    return lines.slice(0, -1).join("\n").trimEnd();
  }
  const sentences = splitSentences(body.trim());
  return sentences.length > 1 ? sentences.slice(0, -1).join("").trim() : "";
}

/** One step shorter, or null when nothing more can give way. */
function trimmedOnce(content: QArtifactContent): QArtifactContent | null {
  const sections = content.sections;
  let longest = -1;
  for (let at = 0; at < sections.length; at += 1) {
    const length = sections[at]?.body.length ?? 0;
    if (longest < 0 || length > (sections[longest]?.body.length ?? 0)) {
      longest = at;
    }
  }
  const target = sections[longest];
  if (target !== undefined && target.body.trim().length > 0) {
    const body = shortened(target.body);
    // A section left with nothing to say goes, unless it is the opening.
    const next =
      body.length === 0 && longest > 0
        ? sections.filter((_, at) => at !== longest)
        : sections.map((section, at) =>
            at === longest ? { ...section, body } : section,
          );
    return { ...content, sections: next };
  }
  if (content.gaps.length > 0) {
    return { ...content, gaps: content.gaps.slice(0, -1) };
  }
  return null;
}

export async function fitToOnePage(
  frame: OnePageFrame,
  content: QArtifactContent,
): Promise<QArtifactContent> {
  if ((await pagesOf(frame, content)) <= 1) return content;
  let next: QArtifactContent = {
    ...content,
    sections: content.sections.map((section) => ({
      ...section,
      findings: [],
    })),
  };
  for (let round = 0; round < ROUNDS_MAX; round += 1) {
    if ((await pagesOf(frame, next)) <= 1) return next;
    const shorter = trimmedOnce(next);
    if (shorter === null) return next;
    next = shorter;
  }
  return next;
}
