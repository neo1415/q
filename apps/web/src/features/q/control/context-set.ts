import type { QRecordPage } from "@capital-q/contracts";
import type {
  ContextAsk,
  ContextPart,
} from "@capital-q/q-specialists/context-request";

import { recordPagePath, type EarlyDocument } from "../client-actions";
import type { QTurn, QTurnObjectBlock } from "../conversation";
import {
  openedRecently,
  resetOpened,
  type OpenedSubject,
} from "./instant-ledger";
import { controlOf } from "./registry";
import { shownNow } from "./show-store";

/**
 * Lane 7 (owner 2026-10-21, binding: "names must NOT be required"): what
 * "their deck", "this one", "that", "the other one", "the second one" point
 * at, from what is real in this tab only:
 *   - the record on screen (its route) and its own tabs;
 *   - what Q's answers named, newest first: the records it opened, its
 *     cards' and comparisons' subjects, the documents it made;
 *   - what Q is showing over the page now (the modal's cards);
 *   - what was opened last, by Q or by the fast path.
 * Every candidate is a record or document this person was already shown;
 * whatever wins is still opened through the page's or the viewer's own
 * authorised read, as a click would. Nothing here is authority.
 */

export type SubjectKind = OpenedSubject["kind"];
export type Subject = OpenedSubject;

export type ContextTarget =
  | {
      readonly kind: "PATH";
      readonly path: string;
      readonly label: string;
      /** The record or document, for the permission-checked tie-break. */
      readonly ref: ContextRef;
    }
  | {
      readonly kind: "DOCUMENT";
      readonly document: EarlyDocument;
      readonly label: string;
      readonly ref: ContextRef;
    };

/** A candidate as the Q API checks it: a page of a record, or a document. */
export type ContextRef = {
  readonly page: QRecordPage;
  readonly id: string;
  readonly companyId?: string | undefined;
};

export type Scored = { readonly target: ContextTarget; readonly score: number };

export type ContextDecision =
  | { readonly kind: "ONE"; readonly target: ContextTarget }
  /** Code is torn: the best two or three, best first. */
  | { readonly kind: "TORN"; readonly candidates: readonly Scored[] }
  | null;

// ---------------------------------------------------------------------------
// The conversation and what was opened, as this tab knows them.
// ---------------------------------------------------------------------------

let turns: readonly QTurn[] = [];

/** The global Q session's turns, as they change (QShowModal). */
export function setConversationTurns(next: readonly QTurn[]): void {
  turns = next;
}

const OPENED_FRESH_MS = 10 * 60_000;

/** Tests. */
export function resetContextSet(): void {
  turns = [];
  resetOpened();
}

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const ROUTE_RECORD = new RegExp(
  `/(company|investors|relationships/company|relationships/investor)/(${UUID})(?:[/?#]|$)`,
  "iu",
);

/** The record the page shows, from its route. */
export function subjectOnScreen(pathname: string): Subject | null {
  const match = ROUTE_RECORD.exec(pathname);
  if (match === null) return null;
  const id = (match[2] ?? "").toLowerCase();
  const kind: SubjectKind =
    match[1] === "company" || match[1] === "relationships/company"
      ? "COMPANY"
      : "INVESTOR";
  const heading =
    typeof document === "undefined"
      ? null
      : (document
          .querySelector("main h1")
          ?.textContent?.replace(/\s+/gu, " ")
          .trim()
          .slice(0, 80) ?? null);
  return { kind, id, name: heading === "" ? null : heading };
}

function subjectsOfBlock(block: QTurnObjectBlock): Subject[] {
  switch (block.kind) {
    case "ANSWER_CARDS":
      return block.cards.flatMap((card): Subject[] =>
        card.subject?.kind === "COMPANY"
          ? [{ kind: "COMPANY", id: card.subject.companyId, name: card.name }]
          : card.subject?.kind === "INVESTOR_ORGANISATION"
            ? [
                {
                  kind: "INVESTOR",
                  id: card.subject.investorOrganisationId,
                  name: card.name,
                },
              ]
            : [],
      );
    case "COMPARISON":
      return block.subjects.flatMap((subject): Subject[] =>
        subject.kind === "COMPANY"
          ? [{ kind: "COMPANY", id: subject.companyId, name: null }]
          : subject.kind === "INVESTOR_ORGANISATION"
            ? [
                {
                  kind: "INVESTOR",
                  id: subject.investorOrganisationId,
                  name: null,
                },
              ]
            : [],
      );
    case "COMPANY_REFERENCE":
      return [{ kind: "COMPANY", id: block.companyId, name: null }];
    case "INVESTOR_REFERENCE":
      return [
        { kind: "INVESTOR", id: block.investorOrganisationId, name: null },
      ];
    case "UI_INTENT": {
      const intent = block.intent;
      if (intent.kind !== "OPEN_RECORD_PAGE") return [];
      if (
        intent.page.startsWith("COMPANY") ||
        intent.page.endsWith("COMPANY")
      ) {
        return [{ kind: "COMPANY", id: intent.id, name: null }];
      }
      if (
        intent.page === "INVESTOR" ||
        intent.page.startsWith("RELATIONSHIP_INVESTOR")
      ) {
        return [{ kind: "INVESTOR", id: intent.id, name: null }];
      }
      return [];
    }
    case "COMPARISON_CARDS":
    case "CLARIFICATION_REQUEST":
    case "ACTION_PROPOSAL":
    case "ARTIFACT_REFERENCE":
    case "TABLE":
    case "CHART":
    case "MAP":
    case "TIMELINE":
    case "ATTENTION":
    case "SUMMARY":
    case "PICTURE":
    case "WORK_IN_PROGRESS": // the person's own job, not a subject
    case "SCHEDULE": // the person's own day, not a subject
    case "PLAN": // the person's own plan, not a subject
      // Names without a record (comparison cards), or no record at all.
      return [];
  }
}

/** The lists Q showed, newest first: what "the second one" counts in. */
function listsShown(): Subject[][] {
  const lists: Subject[][] = [];
  const modal = shownNow();
  if (modal !== null) {
    const items = modal.blocks.flatMap(subjectsOfBlock);
    if (items.length > 0) lists.push(items);
  }
  for (const turn of [...turns].reverse()) {
    if (turn.kind !== "Q") continue;
    for (const block of turn.blocks) {
      if (block.kind !== "ANSWER_CARDS" && block.kind !== "COMPARISON")
        continue;
      const items = subjectsOfBlock(block);
      if (items.length > 0) lists.push(items);
    }
    if (lists.length >= 3) break;
  }
  return lists;
}

type MadeDocument = {
  readonly artifactId: string;
  readonly title: string;
  readonly type: string;
};

// ---------------------------------------------------------------------------
// Scoring.
// ---------------------------------------------------------------------------

const keyOf = (subject: Subject) =>
  `${subject.kind}:${subject.id.toLowerCase()}`;

type Weights = {
  readonly screen: number;
  readonly modal: number;
  /** For Q's newest answer; each older answer one less. */
  readonly said: number;
  readonly opened: number;
};

/** "this": where they are. "that": what was just shown or said. */
const THIS_WEIGHTS: Weights = { screen: 6, modal: 3, said: 3, opened: 2 };
const THAT_WEIGHTS: Weights = { screen: 2, modal: 6, said: 5, opened: 3 };

function scoredSubjects(
  pathname: string,
  weights: Weights,
): { readonly subject: Subject; readonly score: number }[] {
  const scores = new Map<string, { subject: Subject; score: number }>();
  const add = (subject: Subject, points: number) => {
    const key = keyOf(subject);
    const known = scores.get(key);
    if (known === undefined) {
      scores.set(key, { subject, score: points });
      return;
    }
    known.score = Math.max(known.score, points);
    if (known.subject.name === null && subject.name !== null) {
      known.subject = subject;
    }
  };
  const screen = subjectOnScreen(pathname);
  if (screen !== null) add(screen, weights.screen);
  const modal = shownNow();
  // A modal of several cards is a list ("the second one"), not one subject.
  const modalSubjects = modal?.blocks.flatMap(subjectsOfBlock) ?? [];
  if (modalSubjects.length === 1 && modalSubjects[0] !== undefined) {
    add(modalSubjects[0], weights.modal);
  }
  let age = 0;
  for (const turn of [...turns].reverse()) {
    if (turn.kind !== "Q") continue;
    const subjects = turn.blocks.flatMap(subjectsOfBlock);
    // An answer about one record points at it; a list of five does not.
    if (subjects.length > 0 && subjects.length <= 2) {
      for (const subject of subjects) add(subject, weights.said - age);
    }
    age += 1;
    if (age >= 3) break;
  }
  for (const [index, one] of openedRecently().entries()) {
    if (Date.now() - one.at > OPENED_FRESH_MS || one.subject === undefined) {
      continue;
    }
    add(one.subject, weights.opened - index);
  }
  return [...scores.values()]
    .filter((one) => one.score > 0)
    .sort((a, b) => b.score - a.score);
}

function madeDocuments(): MadeDocument[] {
  const out: MadeDocument[] = [];
  const seen = new Set<string>();
  for (const turn of [...turns].reverse()) {
    if (turn.kind !== "Q") continue;
    for (const block of turn.blocks) {
      if (block.kind !== "ARTIFACT_REFERENCE") continue;
      const id = block.artifactId.toLowerCase();
      if (seen.has(id)) continue;
      seen.add(id);
      out.push({ artifactId: id, title: block.title, type: block.type });
    }
    if (out.length >= 6) break;
  }
  return out;
}

const DOCUMENT_KIND: Partial<Record<ContextPart, RegExp>> = {
  MEMO: /memo|brief|one[\s-]?pager|write[\s-]?up|report/iu,
  FINANCIALS: /financ|model|accounts|p&l|projection/iu,
  DECK: /deck|slides|pitch/iu,
};

// ---------------------------------------------------------------------------
// Targets.
// ---------------------------------------------------------------------------

const label = (subject: Subject, part?: string) =>
  `${subject.name ?? (subject.kind === "COMPANY" ? "This company" : "This investor")}${part === undefined ? "" : ` · ${part}`}`;

function pathTarget(
  subject: Subject,
  page: QRecordPage,
  part?: string,
): ContextTarget {
  return {
    kind: "PATH",
    path: recordPagePath(page, subject.id),
    label: label(subject, part),
    ref: { page, id: subject.id },
  };
}

/** Whether the page on screen registered this tab (the deck may be absent). */
function tabHere(tab: string): boolean {
  return controlOf(`tab.${tab}`) !== undefined;
}

/** The record's own page or part, or null when it has none of that kind. */
export function partTarget(
  subject: Subject,
  part: ContextPart | null,
  onScreen: boolean,
): ContextTarget | null {
  if (subject.kind === "INVESTOR") {
    switch (part) {
      case null:
      case "PROFILE":
      case "DATA_ROOM":
      case "STUFF":
      case "DOCUMENT":
      case "FINANCIALS":
      case "MEMO":
        // Their relationship page is the investor's page for them; what
        // they shared is there (named-record-request pagesFor).
        return pathTarget(subject, "RELATIONSHIP_INVESTOR");
      case "CHAT":
        return pathTarget(subject, "RELATIONSHIP_INVESTOR_MESSAGES", "Chat");
      case "DECK":
      case "TEAM":
        return null;
    }
  }
  switch (part) {
    case null:
    case "PROFILE":
      return pathTarget(subject, "COMPANY");
    case "DECK":
      return pathTarget(subject, "COMPANY_DECK", "Pitch deck");
    case "TEAM":
      return pathTarget(subject, "COMPANY_TEAM", "Team");
    case "CHAT":
      return pathTarget(subject, "RELATIONSHIP_COMPANY_MESSAGES", "Chat");
    case "DATA_ROOM":
    case "FINANCIALS":
    case "DOCUMENT":
    case "MEMO":
      return pathTarget(subject, "COMPANY_DATA_ROOM", "Data room");
    case "STUFF":
      // Their primary material: the deck, else the data room. On their
      // page, the deck only when the page has a deck tab.
      return onScreen && !tabHere("deck") && tabHere("dataroom")
        ? pathTarget(subject, "COMPANY_DATA_ROOM", "Data room")
        : pathTarget(subject, "COMPANY_DECK", "Pitch deck");
  }
}

function documentTarget(made: MadeDocument): ContextTarget {
  return {
    kind: "DOCUMENT",
    document: { kind: "ARTIFACT", artifactId: made.artifactId },
    label: made.title,
    ref: { page: "DOCUMENT", id: made.artifactId },
  };
}

/** What wins outright: this far ahead of the next. */
export const CLEAR_LEAD = 2;

function decide(scored: readonly Scored[]): ContextDecision {
  const best = scored[0];
  if (best === undefined) return null;
  const next = scored[1];
  if (next === undefined || best.score - next.score >= CLEAR_LEAD) {
    return { kind: "ONE", target: best.target };
  }
  return { kind: "TORN", candidates: scored.slice(0, 3) };
}

/**
 * What the pointing words mean here and now. ONE: act on it at once; TORN:
 * the best two or three, for a tie-break; null: nothing in context fits
 * (Q's answer reads it).
 */
export function resolveContext(
  ask: ContextAsk,
  pathname: string,
): ContextDecision {
  const screen = subjectOnScreen(pathname);
  const onScreen = (subject: Subject) =>
    screen !== null && keyOf(screen) === keyOf(subject);

  // "The second one": the newest list Q showed.
  if (ask.pointer?.kind === "ORDINAL") {
    const list = listsShown()[0];
    if (list === undefined) return null;
    const index =
      ask.pointer.position === -1 ? list.length - 1 : ask.pointer.position - 1;
    const subject = list[index];
    if (subject === undefined) return null;
    const target = partTarget(subject, ask.part, onScreen(subject));
    return target === null ? null : { kind: "ONE", target };
  }

  // "The other one": of the pair in play, the one not in front of them.
  if (ask.pointer?.kind === "OTHER") {
    const current =
      screen ?? scoredSubjects(pathname, THAT_WEIGHTS)[0]?.subject;
    const pool: Subject[] = [];
    for (const list of listsShown()) {
      if (list.length === 2) pool.push(...list);
    }
    for (const one of openedRecently()) {
      if (one.subject !== undefined) pool.push(one.subject);
    }
    for (const one of scoredSubjects(pathname, THAT_WEIGHTS)) {
      pool.push(one.subject);
    }
    const other = pool.find(
      (subject) => current === undefined || keyOf(subject) !== keyOf(current),
    );
    if (other === undefined) return null;
    const target = partTarget(other, ask.part, false);
    return target === null ? null : { kind: "ONE", target };
  }

  // A document of Q's by its kind ("the memo", "that doc"), when Q made one
  // and no record owns the ask.
  const made = madeDocuments();
  const kindWord = ask.part === null ? undefined : DOCUMENT_KIND[ask.part];
  const madeOfKind =
    ask.part === "DOCUMENT"
      ? made
      : kindWord === undefined
        ? []
        : made.filter((one) => kindWord.test(`${one.title} ${one.type}`));

  const weights = ask.pointer?.kind === "THAT" ? THAT_WEIGHTS : THIS_WEIGHTS;
  const subjects = scoredSubjects(pathname, weights);
  const scored: Scored[] = [];
  for (const { subject, score } of subjects) {
    const target = partTarget(subject, ask.part, onScreen(subject));
    if (target !== null) scored.push({ target, score });
  }
  // Q's own document: strongest when the words name only a kind of
  // document ("the memo") or point at what was just made ("open that").
  const newestAnswer = [...turns].reverse().find((turn) => turn.kind === "Q");
  const inNewest = (one: MadeDocument) =>
    newestAnswer?.kind === "Q" &&
    newestAnswer.blocks.some(
      (block) =>
        block.kind === "ARTIFACT_REFERENCE" &&
        block.artifactId.toLowerCase() === one.artifactId,
    );
  for (const [index, one] of madeOfKind.entries()) {
    // The one Q made in its latest answer is what "the doc" means, even
    // on a record's page; "their memo" leans to the record's own.
    scored.push({
      target: documentTarget(one),
      score: ask.owned ? 2 - index : inNewest(one) ? 8 : 6 - index,
    });
  }
  if (ask.part === null && ask.pointer?.kind === "THAT") {
    const newest = made[0];
    const newestTurn = [...turns].reverse().find((turn) => turn.kind === "Q");
    const justMade =
      newest !== undefined &&
      newestTurn?.kind === "Q" &&
      newestTurn.blocks.some(
        (block) =>
          block.kind === "ARTIFACT_REFERENCE" &&
          block.artifactId.toLowerCase() === newest.artifactId,
      );
    if (justMade) scored.push({ target: documentTarget(newest), score: 7 });
  }
  // A document opened moments ago is "it" when nothing else is said.
  const lastDocument = openedRecently().find(
    (one) =>
      one.document !== undefined && Date.now() - one.at <= OPENED_FRESH_MS,
  );
  if (
    lastDocument?.document !== undefined &&
    ask.part === null &&
    ask.pointer !== null &&
    openedRecently()[0] === lastDocument
  ) {
    const document = lastDocument.document;
    const id =
      document.kind === "MATERIAL" ? document.documentId : document.artifactId;
    scored.push({
      target: {
        kind: "DOCUMENT",
        document,
        label: lastDocument.label ?? "Document",
        ref:
          document.kind === "MATERIAL"
            ? { page: "DATA_ROOM_DOCUMENT", id, companyId: document.companyId }
            : { page: "DOCUMENT", id },
      },
      score: weights.opened + 1,
    });
  }
  // One entry per destination, at its best score.
  const best = new Map<string, Scored>();
  for (const one of scored) {
    const key =
      one.target.kind === "PATH" ? one.target.path : `doc:${one.target.ref.id}`;
    const known = best.get(key);
    if (known === undefined || known.score < one.score) best.set(key, one);
  }
  return decide([...best.values()].sort((a, b) => b.score - a.score));
}
