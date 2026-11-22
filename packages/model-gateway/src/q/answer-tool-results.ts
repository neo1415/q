import {
  QClientActionToolResultSchema,
  QDocumentToolResultSchema,
  type QResultBlock,
} from "@capital-q/contracts";
import type { PublicSourceLike } from "@capital-q/q-core";
import type { QToolCallOutcome } from "@capital-q/q-runtime";

import {
  CalendarConnectCarrierSchema,
  LanguageCarrierSchema,
  RoomCardCarrierSchema,
} from "./answer-plan.js";
import type { SearchEvidence } from "./picture-corroboration.js";
import { scheduleBlock } from "./result-blocks.js";

/**
 * W5-A (audit finding 4, part 3): two phases of the answer, moved out of
 * createModelGatewayQAnswer unchanged. Each tool outcome the model's round
 * produced is read here, by code, into what rides on the answer:
 *
 *   1. its blocks: a client action (a navigation, a calendar connect card,
 *      a language switch, a room card), a revised document's card and its
 *      slide, the day's schedule card;
 *   2. the public sources a web read cited, and the evidence beside them.
 *
 * Each takes the answer's own collections explicitly and changes them in
 * place, exactly as the closures did; nothing else is read or written.
 */

/** Phase 1a: a client action from a tool's authorised result. */
export function collectClientActionBlock(input: {
  /** The answer's client-action blocks, in order; changed in place. */
  readonly blocks: QResultBlock[];
  readonly outcome: QToolCallOutcome;
}): void {
  const { blocks: clientActionBlocks, outcome } = input;
  if (!outcome.result.ok) return;
  const read = QClientActionToolResultSchema.safeParse(outcome.result.data);
  // Q room R5: a calendar answer carries its connect card (display
  // only; the person starts the connect flow from it).
  const card = read.success
    ? null
    : CalendarConnectCarrierSchema.safeParse(outcome.result.data);
  const language =
    read.success || card?.success === true
      ? null
      : LanguageCarrierSchema.safeParse(outcome.result.data);
  const room =
    read.success || card?.success === true || language?.success === true
      ? null
      : RoomCardCarrierSchema.safeParse(outcome.result.data);
  const intent = read.success
    ? read.data.clientAction
    : card?.success === true
      ? card.data.clientAction
      : language?.success === true
        ? language.data.clientAction
        : room?.success === true
          ? room.data.clientAction
          : null;
  if (intent === null) return;
  const block: QResultBlock = { kind: "UI_INTENT", intent };
  if (
    !clientActionBlocks.some(
      (known) => JSON.stringify(known) === JSON.stringify(block),
    )
  ) {
    clientActionBlocks.push(block);
  }
}

/**
 * Phase 1b: a document the person asked Q to change, filed as a new
 * version by `revise_my_document`: its card rides on the answer, from the
 * tool's own authorised result only (founder directive 2026-09-28).
 */
export function collectDocumentBlock(input: {
  /** The answer's client-action blocks, in order; changed in place. */
  readonly blocks: QResultBlock[];
  readonly outcome: QToolCallOutcome;
}): void {
  const { blocks: clientActionBlocks, outcome } = input;
  if (!outcome.result.ok) return;
  const read = QDocumentToolResultSchema.safeParse(outcome.result.data);
  if (!read.success) return;
  const block: QResultBlock = {
    kind: "ARTIFACT_REFERENCE",
    artifactId: read.data.document.artifactId,
    type: read.data.document.type,
    status: read.data.document.status,
    title: read.data.document.title,
  };
  const at = clientActionBlocks.findIndex(
    (known) =>
      known.kind === "ARTIFACT_REFERENCE" &&
      known.artifactId === block.artifactId,
  );
  // The latest revision's card replaces an earlier one in this answer.
  if (at >= 0) clientActionBlocks.splice(at, 1, block);
  else clientActionBlocks.push(block);
  // Q room W5: an edit by slide takes the room's viewer to that slide.
  if (read.data.slide !== undefined) {
    const go: QResultBlock = {
      kind: "UI_INTENT",
      intent: {
        kind: "DOCUMENT_ACT",
        act: "GO_TO_PAGE",
        page: read.data.slide,
      },
    };
    const seen = clientActionBlocks.findIndex(
      (known) =>
        known.kind === "UI_INTENT" &&
        known.intent.kind === "DOCUMENT_ACT" &&
        known.intent.act === "GO_TO_PAGE",
    );
    if (seen >= 0) clientActionBlocks.splice(seen, 1, go);
    else clientActionBlocks.push(go);
  }
}

/**
 * Phase 1c. Live 2026-10-28 ("what's on my schedule today?" was words
 * alone): when the model reads their schedule this turn, the read's own
 * result becomes their schedule card, with what waits for their approval
 * from the day's reads beside it. Built by code from the tool's authorised
 * result; the model chose only to read it.
 */
export function collectScheduleBlock(input: {
  /** The answer's client-action blocks, in order; changed in place. */
  readonly blocks: QResultBlock[];
  readonly name: string;
  readonly outcome: QToolCallOutcome;
  /** The turn's own-day reads (WideReads.ownDayReads). */
  readonly ownDayReads: {
    readonly approvals: unknown;
    readonly timeZone: string | null;
  } | null;
}): void {
  const { blocks: clientActionBlocks, name, outcome } = input;
  if (name !== "list_schedule" || !outcome.result.ok) return;
  const block = scheduleBlock({
    schedule: outcome.result.data,
    approvals: input.ownDayReads?.approvals,
    now: new Date(),
    timeZone: input.ownDayReads?.timeZone ?? null,
  });
  if (block === null) return;
  const at = clientActionBlocks.findIndex((known) => known.kind === "SCHEDULE");
  if (at >= 0) clientActionBlocks.splice(at, 1, block);
  else clientActionBlocks.push(block);
}

/**
 * Phase 2: the public sources a web read (or a profile gap fill) cited,
 * and the evidence beside them. Only a well-formed public source is
 * presentable; anything else stays in the tool transcript as data.
 */
export function collectPublicSources(input: {
  readonly outcome: QToolCallOutcome;
  /** Every source's domain, subject match, countries and excerpt. */
  readonly webEvidence: SearchEvidence[];
  /** A presentable source's URL to its subject match. */
  readonly pageSubjectMatch: Map<string, string>;
  /** The presentable sources, one per URL, in first-seen order. */
  readonly publicSources: PublicSourceLike[];
}): void {
  const { outcome, webEvidence, pageSubjectMatch, publicSources } = input;
  if (
    (outcome.toolName !== "public_web.search" &&
      outcome.toolName !== "profile.gaps.fill") ||
    !outcome.result.ok
  ) {
    return;
  }
  const data = outcome.result.data as {
    sources?: readonly (PublicSourceLike & {
      readonly subjectMatch?: unknown;
      readonly mentionedCountries?: unknown;
      readonly excerpt?: unknown;
    })[];
  };
  for (const source of data.sources ?? []) {
    if (typeof source.domain === "string") {
      webEvidence.push({
        domain: source.domain,
        subjectMatch:
          typeof source.subjectMatch === "string" ? source.subjectMatch : null,
        countries: Array.isArray(source.mentionedCountries)
          ? source.mentionedCountries.filter(
              (country): country is string => typeof country === "string",
            )
          : [],
        text: typeof source.excerpt === "string" ? source.excerpt : null,
        title: typeof source.title === "string" ? source.title : null,
      });
    }
    // Only a well-formed public source is presentable; anything else
    // stays in the tool transcript as data and is never cited.
    if (
      typeof source.url !== "string" ||
      typeof source.domain !== "string" ||
      typeof source.retrievedAt !== "string" ||
      typeof source.index !== "number"
    ) {
      continue;
    }
    if (
      typeof source.url === "string" &&
      typeof source.subjectMatch === "string"
    ) {
      pageSubjectMatch.set(source.url, source.subjectMatch);
    }
    if (!publicSources.some((known) => known.url === source.url)) {
      publicSources.push({
        index: source.index,
        url: source.url,
        domain: source.domain,
        title: source.title,
        publishedAt: source.publishedAt,
        retrievedAt: source.retrievedAt,
      });
    }
  }
}
