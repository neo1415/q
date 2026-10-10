import type {
  QClientActionIntent,
  QRecordPage,
  QUiIntent,
} from "@capital-q/contracts";

import { openingLine } from "./references.js";
import {
  cannotOpenPartLine,
  matchOwnCounterpart,
  misheardOwnCounterpart,
  namedRecordRequestOf,
  notFoundLine,
  ownCounterpartWithin,
  pagesFor,
  plausibleName,
  whichOneLine,
} from "./named-record-request.js";
import { pageRequestOf, takenBack } from "./page-request.js";

/**
 * RECOVERY-2026-10 (C, founder 2026-10-09: "stupid fast"): where the
 * person's words go, read by code alone, with no model -- the same two
 * readers the answer uses (a page by its name, a record by its name), so
 * the screen can move the moment the sentence ends while Q's answer is
 * still being composed. The answer path runs the same functions, so the
 * two can never disagree about the target.
 */

export type OpenRecordIntent = Extract<
  QClientActionIntent,
  { kind: "OPEN_RECORD_PAGE" }
>;

/** A record by its name: opened, asked about, or not such a request. */
export type NamedRecordResolution =
  | {
      readonly kind: "OPEN";
      readonly intent: OpenRecordIntent;
      readonly page: QRecordPage;
      readonly said: string;
      readonly own: boolean;
    }
  | { readonly kind: "ASK"; readonly said: string; readonly log: string }
  | null;

/**
 * The record a navigation request names, resolved against their own
 * relationships first (never guessing between two), opened through
 * `open` -- open_page's own authorize step -- or one truthful line.
 */
export async function resolveNamedRecord(input: {
  readonly text: string;
  readonly side: "INVESTOR" | "FOUNDER";
  readonly counterpartNames: () => Promise<readonly string[]>;
  readonly open: (
    page: QRecordPage,
    name: string,
  ) => Promise<OpenRecordIntent | null>;
}): Promise<NamedRecordResolution> {
  const asked = namedRecordRequestOf(input.text);
  if (asked === null) return null;
  const names = await input
    .counterpartNames()
    .catch(() => [] as readonly string[]);
  const direct = matchOwnCounterpart(asked.name, names);
  // Their own counterpart written inside the words (a transcript's spacing,
  // repeats and fillers around it) is that one record.
  const within =
    direct.kind === "NONE" ? ownCounterpartWithin(asked.name, names) : null;
  // R3: misheard by speech recognition ("TensorFlow" for their Tensorgate):
  // their own set only, high confidence only (else Q's answer asks).
  const misheard =
    direct.kind === "NONE" && within === null
      ? misheardOwnCounterpart(asked.name, names)
      : null;
  const found = within ?? misheard;
  const match = found === null ? direct : { kind: "ONE" as const, name: found };
  if (match.kind === "SEVERAL") {
    return { kind: "ASK", said: whichOneLine(match.names), log: "SEVERAL" };
  }
  // Not one of theirs and not plainly a name: Q answers, nothing is quoted.
  if (
    match.kind === "NONE" &&
    (!asked.explicit || !plausibleName(asked.name))
  ) {
    return null;
  }
  const name = match.kind === "ONE" ? match.name : asked.name;
  for (const page of pagesFor(asked.facet, input.side)) {
    const intent = await input.open(page, name).catch(() => null);
    if (intent === null) continue;
    return {
      kind: "OPEN",
      intent,
      page,
      said: openingLine(page, name),
      own: match.kind === "ONE",
    };
  }
  return match.kind === "ONE"
    ? {
        kind: "ASK",
        said: cannotOpenPartLine(asked, name),
        log: "PART_UNAVAILABLE",
      }
    : {
        kind: "ASK",
        said: notFoundLine(asked, match.near),
        log: "NOT_FOUND",
      };
}

export type FastNavigation =
  | {
      /** Move now: the screen performs this before Q has answered. */
      readonly kind: "NAVIGATE";
      readonly intent: Extract<
        QUiIntent,
        { kind: "NAVIGATE" | "OPEN_SETTINGS" | "OPEN_RECORD_PAGE" }
      >;
    }
  /** Not confident (a name meaning several, nothing found): Q's answer asks. */
  | { readonly kind: "LEAVE_TO_Q" };

/**
 * The fast path's decision. Only a confident, single target moves the
 * screen early; anything taken back, ambiguous or unknown is left to Q's
 * answer, which reads the same words with the same functions and asks.
 */
export async function resolveFastNavigation(input: {
  readonly text: string;
  readonly side: "INVESTOR" | "FOUNDER";
  readonly counterpartNames: () => Promise<readonly string[]>;
  readonly open: (
    page: QRecordPage,
    name: string,
  ) => Promise<OpenRecordIntent | null>;
}): Promise<FastNavigation> {
  const text = input.text.trim();
  if (text.length === 0 || text.length > 300 || takenBack(text)) {
    return { kind: "LEAVE_TO_Q" };
  }
  const page = pageRequestOf(text);
  if (page?.kind === "PAGE") {
    return page.target.kind === "SETTINGS"
      ? {
          kind: "NAVIGATE",
          intent: { kind: "OPEN_SETTINGS", section: page.target.section },
        }
      : {
          kind: "NAVIGATE",
          intent: { kind: "NAVIGATE", destination: page.target.destination },
        };
  }
  if (page !== null) return { kind: "LEAVE_TO_Q" };
  const record = await resolveNamedRecord(input);
  return record?.kind === "OPEN"
    ? { kind: "NAVIGATE", intent: record.intent }
    : { kind: "LEAVE_TO_Q" };
}
