import {
  Q_ARTIFACT_PREVIEW_SUBJECTS_MAX,
  type QArtifactPreview,
  type QArtifactPreviewLayout,
  type QArtifactPreviewSubject,
} from "@capital-q/contracts";

import { companyNameAt, type RunRead } from "./card-subjects.js";

/**
 * Artifacts live (owner 2026-10-20): "as Q talks, the artifact for what it
 * is saying comes up at that moment".
 *
 * Each sentence Q is about to say is read for the companies and investors
 * this run's own tools returned (the authorised reads the answer's cards
 * are built from). The first time a sentence names one, the subjects named
 * so far go out ahead of that sentence, so the screen can put each card up
 * as it is named and fill it when the answer's blocks land.
 *
 * Nothing here comes from a model: a name only counts when it is the whole
 * name a read returned (or that name without a legal suffix), and the id
 * is the read's. A sentence that names nobody new announces nothing.
 */

const LEGAL_SUFFIX =
  /\s+(?:ltd\.?|limited|inc\.?|incorporated|plc|llc|l\.l\.c\.|gmbh|s\.a\.|sa|pty|co\.?|corp\.?|corporation)$/iu;

/** The forms of a name that count as naming it. */
function namesOf(name: string): readonly string[] {
  const plain = name
    .replace(/\([^)]*\)/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  const bare = plain.replace(LEGAL_SUFFIX, "").trim();
  return bare.length >= 3 && bare !== plain ? [plain, bare] : [plain];
}

/** Where in `text` any form of the name first appears, or -1. */
function firstAt(text: string, name: string): number {
  let at = -1;
  for (const form of namesOf(name)) {
    const found = companyNameAt(text, form);
    if (found >= 0 && (at < 0 || found < at)) at = found;
  }
  return at;
}

type Candidate = QArtifactPreviewSubject & { readonly id: string };

function candidatesOf(read: RunRead): readonly Candidate[] {
  const out: Candidate[] = [];
  for (const [companyId, name] of read.companyNames) {
    out.push({
      id: companyId,
      name: name.slice(0, 80),
      subject: { kind: "COMPANY", companyId },
    });
  }
  for (const investor of read.investors.values()) {
    out.push({
      id: investor.investorOrganisationId,
      name: investor.name.slice(0, 80),
      subject: {
        kind: "INVESTOR_ORGANISATION",
        investorOrganisationId: investor.investorOrganisationId,
      },
    });
  }
  return out.filter((one) => one.name.trim().length > 0);
}

/** What the person asked for, as the shape the answer will take. */
export function previewLayoutFor(
  question: string,
  named: number,
): QArtifactPreviewLayout | null {
  if (
    /\b(compare|comparison|versus|vs\.?|side[ -]by[ -]side|table|tabulate|line (?:them|those) up)\b/iu.test(
      question,
    ) &&
    named >= 2
  ) {
    return "TABLE";
  }
  if (named >= 2) return "CARDS";
  if (named === 1) return "CARD";
  return null;
}

/**
 * The subjects in `text`, in the order the words name them. Pure, for the
 * announcer below and its tests.
 */
export function subjectsNamedIn(
  text: string,
  read: RunRead,
): readonly QArtifactPreviewSubject[] {
  return candidatesOf(read)
    .map((one) => ({ one, at: firstAt(text, one.name) }))
    .filter((hit) => hit.at >= 0)
    .sort((a, b) => a.at - b.at)
    .map(({ one }) => ({ subject: one.subject, name: one.name }));
}

export type SubjectAnnouncer = {
  /**
   * The preview to send ahead of `sentence`, when it names a subject not
   * named before in this answer; otherwise null.
   */
  readonly sentence: (
    sentence: string,
  ) => Pick<QArtifactPreview, "subjects" | "layout"> | null;
};

export function createSubjectAnnouncer(input: {
  /** This run's authorised reads, as they stand now. */
  readonly read: () => RunRead;
  /** The person's question: a comparison is laid out as a table. */
  readonly question: string;
}): SubjectAnnouncer {
  const named: QArtifactPreviewSubject[] = [];
  const seen = new Set<string>();
  const idOf = (subject: QArtifactPreviewSubject["subject"]): string =>
    subject.kind === "COMPANY"
      ? subject.companyId
      : subject.kind === "INVESTOR_ORGANISATION"
        ? subject.investorOrganisationId
        : "";
  let seeded = false;
  return {
    sentence: (sentence) => {
      const read = input.read();
      let fresh = false;
      // A comparison the person asked for by name: both cards go up with
      // Q's first words, in the order they were asked for, so the table's
      // frame is there before Q reaches the second name.
      if (!seeded) {
        seeded = true;
        const asked = subjectsNamedIn(input.question, read);
        if (previewLayoutFor(input.question, asked.length) === "TABLE") {
          for (const one of asked) {
            const id = idOf(one.subject);
            if (seen.has(id)) continue;
            seen.add(id);
            named.push(one);
            fresh = true;
          }
        }
      }
      for (const one of subjectsNamedIn(sentence, read)) {
        if (named.length >= Q_ARTIFACT_PREVIEW_SUBJECTS_MAX) break;
        const id = idOf(one.subject);
        if (seen.has(id)) continue;
        seen.add(id);
        named.push(one);
        fresh = true;
      }
      if (!fresh || named.length === 0) return null;
      return {
        subjects: [...named],
        layout: previewLayoutFor(input.question, named.length),
      };
    },
  };
}
