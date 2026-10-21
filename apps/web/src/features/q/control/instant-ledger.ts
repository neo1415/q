/**
 * Lane 7: what the screen just did by itself for the latest sentence
 * ("scroll down", "press Show more"). A voice line that also routes the
 * same words to Q (duplex) gets Q's answer carrying the same act seconds
 * later; done twice it would scroll twice or toggle a disclosure back
 * shut. Q's act is dropped once when it is the one already done.
 */
const SAME_ACT_MS = 15_000;

let done: { readonly key: string; readonly at: number } | null = null;

/** The act the screen did: "SCROLL_DOWN", "control:<id>", "theme:dark". */
export function noteInstantAct(key: string): void {
  done = { key, at: Date.now() };
}

/** True once when Q's act is the one the screen already did. */
export function doneByScreen(key: string): boolean {
  if (done === null || Date.now() - done.at > SAME_ACT_MS) return false;
  if (done.key !== key) return false;
  done = null;
  return true;
}

/** Tests. */
export function resetInstantLedger(): void {
  done = null;
}

/**
 * Lane 7 ("names must NOT be required"): what was opened last, by the
 * fast path or by Q's answer, newest first: "it" and "the other one" are
 * read from it (context-set.ts). Ids the person was already shown only.
 */
export type OpenedSubject = {
  readonly kind: "COMPANY" | "INVESTOR";
  readonly id: string;
  readonly name: string | null;
};
export type OpenedDocument =
  | {
      readonly kind: "MATERIAL";
      readonly companyId: string;
      readonly documentId: string;
      readonly title: string | null;
    }
  | { readonly kind: "ARTIFACT"; readonly artifactId: string };
export type Opened = {
  readonly subject?: OpenedSubject | undefined;
  readonly document?: OpenedDocument | undefined;
  readonly label: string | null;
  readonly at: number;
};

const opened: Opened[] = [];
const OPENED_MAX = 8;

export function noteOpened(entry: Omit<Opened, "at">): void {
  opened.unshift({ ...entry, at: Date.now() });
  opened.length = Math.min(opened.length, OPENED_MAX);
}

export function openedRecently(): readonly Opened[] {
  return opened;
}

/** Tests. */
export function resetOpened(): void {
  opened.length = 0;
}

/**
 * The record a record page's intent shows (its subject), for the ledger;
 * null for a page that is not one record's.
 */
export function subjectOfPage(page: string, id: string): OpenedSubject | null {
  if (page === "DOCUMENT" || page === "DATA_ROOM_DOCUMENT") return null;
  if (page.startsWith("COMPANY") || page.startsWith("RELATIONSHIP_COMPANY")) {
    return { kind: "COMPANY", id: id.toLowerCase(), name: null };
  }
  if (page === "INVESTOR" || page.startsWith("RELATIONSHIP_INVESTOR")) {
    return { kind: "INVESTOR", id: id.toLowerCase(), name: null };
  }
  return null;
}
