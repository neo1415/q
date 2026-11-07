import type {
  QNavCase,
  QNavCategory,
  QNavContext,
  QNavExpect,
  QNavSide,
  QNavSplit,
  QNavTarget,
  QNavTurn,
} from "./contracts.js";
import { pagesClosedTo } from "./vocabulary.js";
import {
  company,
  investor,
  Q_NAV_FOUNDER_COMPANY_KEY,
  Q_NAV_THINGS,
} from "./world.js";

/** The building blocks every Q-NAV case is made of. */

export const HOME: QNavTarget = { page: "HOME" };

export function context(over: Partial<QNavContext> = {}): QNavContext {
  return {
    at: HOME,
    previous: null,
    pane: "OPEN",
    dirty: false,
    busy: null,
    pageText: null,
    ...over,
  };
}

export type ExpectOptions = {
  readonly forbidden?: readonly string[];
  readonly openPane?: boolean;
  readonly remembered?: QNavTarget;
};

function expectOf(
  side: QNavSide,
  decision: QNavExpect["decision"],
  target: QNavTarget | null,
  why: string,
  options: ExpectOptions,
): QNavExpect {
  return {
    decision,
    target,
    openPane: options.openPane ?? false,
    remembered: options.remembered ?? null,
    forbiddenPages: [
      ...new Set([...pagesClosedTo(side), ...(options.forbidden ?? [])]),
    ],
    why,
  };
}

/** Decisions for one side (its closed pages are always forbidden). */
export function decide(side: QNavSide) {
  return {
    move: (target: QNavTarget, why: string, o: ExpectOptions = {}) =>
      expectOf(side, "MOVE", target, why, o),
    offer: (target: QNavTarget, why: string, o: ExpectOptions = {}) =>
      expectOf(side, "OFFER", target, why, o),
    stay: (why: string, o: ExpectOptions = {}) =>
      expectOf(side, "STAY", null, why, o),
  };
}

export type TurnOptions = {
  readonly modality?: "TEXT" | "VOICE";
  readonly language?: string;
  readonly context?: QNavContext;
  readonly q?: string;
};

export function turn(
  user: string,
  expect: QNavExpect,
  options: TurnOptions = {},
): QNavTurn {
  return {
    user,
    modality: options.modality ?? "TEXT",
    language: options.language ?? "en",
    context: options.context ?? context(),
    expect,
    q:
      options.q ??
      (expect.decision === "MOVE"
        ? "Here it is."
        : expect.decision === "OFFER"
          ? "Here's the answer. Want me to open it?"
          : "Here you go."),
  };
}

const PREFIX: Readonly<Record<QNavCategory, string>> = {
  COVERAGE: "COV",
  RECORD: "REC",
  THREAD: "THR",
  STAY_IN_CHAT: "STY",
  LOOKALIKE_STAY: "LKS",
  LOOKALIKE_MOVE: "LKM",
  FALSE_PAGE_WORD: "FPW",
  TWO_ASKS: "TWO",
  TYPO: "TYP",
  VOICE: "VOC",
  NON_ENGLISH: "LNG",
  SARCASM: "SAR",
  FOLLOW_UP: "FUP",
  GO_BACK: "BACK",
  NOT_THAT_ONE: "NOT",
  STALE_CONTEXT: "STL",
  AMBIGUITY: "AMB",
  DIRTY_FORM: "DRT",
  BUSY_PANE: "BSY",
  COLLAPSED_PANE: "COL",
  ACCESS: "ACC",
  NO_SUCH_PAGE: "NSP",
  DELETED_RECORD: "DEL",
  ADVERSARIAL: "ADV",
  ALREADY_THERE: "AT",
};

/** Collects one split's cases, numbered per category. */
export class CaseSet {
  readonly out: QNavCase[] = [];
  private readonly counters = new Map<QNavCategory, number>();
  readonly split: QNavSplit;
  constructor(split: QNavSplit) {
    this.split = split;
  }

  add(
    category: QNavCategory,
    side: QNavSide,
    turns: readonly QNavTurn[],
  ): void {
    const n = (this.counters.get(category) ?? 0) + 1;
    this.counters.set(category, n);
    this.out.push({
      id: `QNAV-${this.split === "dev" ? "D" : "H"}-${PREFIX[category]}-${String(n).padStart(3, "0")}`,
      category,
      side,
      split: this.split,
      turns: [...turns],
    });
  }
}

// --- Targets (exact W3.1 QNavigateTargets on the world's ids) ------------

export const dest = (
  page: string,
  extra: Omit<QNavTarget, "page"> = {},
): QNavTarget => ({ page, ...extra }) as QNavTarget;
export const section = (page: string, sectionId: string): QNavTarget =>
  dest(page, { sectionId, position: "section" });
/**
 * What the founder's data room still lacks: /company/data-room redirects
 * a founder to their own profile's data-room tab, whose `missing` section
 * it is (W2), so the place is their own company record.
 */
export const ownMissing = (): QNavTarget => ({
  ...profile(Q_NAV_FOUNDER_COMPANY_KEY, "dataroom"),
  sectionId: "missing",
  position: "section",
});
export const profile = (key: string, tab?: string): QNavTarget => ({
  page: "COMPANY",
  recordId: company(key).id,
  ...(tab === undefined ? {} : { tab }),
});
export const deck = (key: string, slide?: number): QNavTarget => ({
  ...profile(key, "deck"),
  ...(slide === undefined ? {} : { slide }),
});
export const dataRoom = (key: string): QNavTarget => profile(key, "dataroom");
export const dataRoomDoc = (key: string, kind: string): QNavTarget => {
  const doc = company(key).documents.find((d) => d.kind === kind);
  if (doc === undefined) throw new Error(`no ${kind} for ${key}`);
  return { ...profile(key, "dataroom"), documentId: doc.id };
};
export const team = (key: string): QNavTarget => profile(key, "team");
export const overview = (key: string, sectionId: string): QNavTarget => ({
  ...profile(key, "overview"),
  sectionId,
  position: "section",
});
export const threadWithCompany = (key: string): QNavTarget => ({
  page: "RELATIONSHIP_COMPANY_MESSAGES",
  recordId: company(key).id,
  position: "latest",
});
export const threadWithInvestor = (key: string): QNavTarget => ({
  page: "RELATIONSHIP_INVESTOR_MESSAGES",
  recordId: investor(key).id,
  position: "latest",
});
export const relationshipWithCompany = (
  key: string,
  tab: string,
): QNavTarget => ({
  page: "RELATIONSHIP_COMPANY",
  recordId: company(key).id,
  tab,
});
export const relationshipWithInvestor = (
  key: string,
  tab: string,
): QNavTarget => ({
  page: "RELATIONSHIP_INVESTOR",
  recordId: investor(key).id,
  tab,
});
export const investorProfile = (key: string): QNavTarget => ({
  page: "INVESTOR",
  recordId: investor(key).id,
});
export const thing = (
  page: string,
  name: keyof typeof Q_NAV_THINGS,
): QNavTarget => ({ page, recordId: Q_NAV_THINGS[name].id }) as QNavTarget;
export const boardItem = (name: keyof typeof Q_NAV_THINGS): QNavTarget => ({
  page: "BOARD",
  itemId: Q_NAV_THINGS[name].id,
});

/** A deterministic typo: two inner letters of the longest word swapped. */
export function typo(text: string): string {
  const words = text.split(" ");
  let at = -1;
  words.forEach((w, i) => {
    if (
      /^[A-Za-z]{5,}$/u.test(w) &&
      (at < 0 || w.length > (words[at] ?? "").length)
    )
      at = i;
  });
  if (at < 0) return text;
  const w = words[at] ?? "";
  words[at] = `${w.slice(0, 1)}${w.slice(2, 3)}${w.slice(1, 2)}${w.slice(3)}`;
  return words.join(" ");
}

/** A stable small number from a string (template choice, not randomness). */
export function pick(seed: string, n: number): number {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % n;
}
