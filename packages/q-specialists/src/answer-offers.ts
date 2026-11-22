// W3-B (audit finding 4): moved unchanged out of answer.ts, which
// re-exports what it exported. Here: the record-audience tools, Q's stored offers and holding lines, what a turn points at, and page controls.
import { type QPageManifest, type QResultBlock } from "@capital-q/contracts";
import { PLAN_OFFER_LINES } from "@capital-q/q-core";
import {
  type QConversationMessage,
  type QRecordedOffer,
} from "@capital-q/q-runtime";
import { randomUUID } from "node:crypto";

import { type CoreOffer } from "./conversation-core.js";
import {
  asksToOperate,
  type ControlBinding,
  controlBindingOf,
  focusFromHistory,
  hereFromManifest,
  listsFromHistory,
  listsFromManifest,
  type ReferenceAsk,
  referenceAskOf,
  resolutionNote,
  type ResolvedReference,
  resolveReference,
} from "./conversation-entities.js";
import { type HandOverSubject } from "./hand-over.js";
import { type ReferenceLead, referenceLeadOf } from "./list-order.js";
import { type QPlanAskReading } from "./plan-job-port.js";

/**
 * The investor organisation's own visibility action (app action
 * investor.visibility.set). SET_VISIBILITY is the company's hand only.
 */
export const INVESTOR_VISIBILITY_TOOL = "set_investor_visibility";

/**
 * One of their own records' audience is that record's declared action,
 * never the company's visibility (QA run 3af14042: "Make Ajopot seed deck
 * private to my organisation again" prepared "Make your company private").
 * Q intelligence step 4: which record's action is the reader's askedAction
 * (v30), never a word list; the tool resolves the name among their own
 * records and refuses one it cannot find.
 */
const RECORD_AUDIENCE_TOOLS: ReadonlySet<string> = new Set([
  "set_deck_audience",
  "set_pitch_sharing",
]);

/** The record-audience action the reader named, or null. */
export function recordAudienceTool(
  askedAction: string | null | undefined,
): string | null {
  return askedAction !== null &&
    askedAction !== undefined &&
    RECORD_AUDIENCE_TOOLS.has(askedAction)
    ? askedAction
    : null;
}

/** B6: a reference in the turn, bound to records, with its note. */
/**
 * An offer code closed Q's answer with, recorded with the run that made it
 * (live 2026-10-30). PLAN: the full plan offered after the answer to what
 * to do now; `ask` is the question that answer answered, which is what
 * the plan is for.
 */
export type RecordedOffer =
  | {
      readonly kind: "PLAN";
      readonly runId: string;
      readonly ask: string;
    }
  /**
   * C3 (13 Nov 2026): the offer the answer model made and code bound to a
   * tool of that run (model-gateway offer-binding). A yes runs exactly that
   * tool, for exactly that request, under its own approval rules.
   */
  | ({ readonly kind: "ACTION"; readonly runId: string } & QRecordedOffer);

/** C3: the action offer as the conversation core keeps it durably. */
export function coreOfferOf(
  offer: RecordedOffer | undefined,
): CoreOffer | null {
  if (offer?.kind !== "ACTION") return null;
  return {
    runId: offer.runId,
    action: offer.action,
    request: offer.request,
    said: offer.said,
    ...(offer.about === undefined ? {} : { about: offer.about }),
    ...(offer.counterparty === undefined
      ? {}
      : { counterparty: offer.counterparty }),
  };
}

/** The plan offer alone (what planStartWords reads). */
type RecordedPlanOffer = Extract<RecordedOffer, { readonly kind: "PLAN" }>;

/** A stored line of the conversation, as the plan offer reads it. */
type StoredLine = {
  readonly role: string;
  readonly runId: string;
  readonly content: string;
};

/**
 * Q's first words while a turn is read (QA F-23, acceptance 2026-11-04
 * J3): a note to someone is drafted TO them; a document about someone is
 * written ON them, so it never sounds as if something were going to them.
 */
export function holdingLine(
  name: string | null,
  writes: boolean,
  document: boolean,
): string {
  const who = name?.slice(0, 60) ?? null;
  if (document) {
    return who === null
      ? "Writing that up now. "
      : `Writing that up on ${who} now. `;
  }
  if (writes) {
    return who === null
      ? "Drafting that now. "
      : `Drafting that note to ${who} now. `;
  }
  return who === null ? "Looking into that now. " : `Looking into ${who} now. `;
}

/**
 * The plan offer Q's last stored answer closed with, read from history:
 * the answer ends with code's own offer copy (PLAN_OFFER_LINES, any
 * language), and the plan is for their turn in that same run. Only Q's
 * own copy is matched; what the person said is never read for meaning.
 */
export function storedPlanOffer(
  history: readonly StoredLine[],
  lastQ: StoredLine,
): RecordedPlanOffer | null {
  const said = lastQ.content.trimEnd();
  if (!PLAN_OFFER_LINES.some((line) => said.endsWith(line))) return null;
  const asked = history.find(
    (message) => message.role === "USER" && message.runId === lastQ.runId,
  );
  const ask = asked?.content.trim() ?? "";
  return ask.length === 0 ? null : { kind: "PLAN", runId: lastQ.runId, ask };
}

/**
 * What a plan started on this turn is asked and titled with (live
 * 2026-10-31, "Your plan: yes"). Taken up (v74 acceptsOffer / v61
 * workFromEarlier): the question the offer was made for, alone. Offered
 * on Q's last turn but not read as taken up: that question first, then
 * their words, and a title quoting neither (the reading did not say
 * whose words name the plan). No offer: their words, as asked.
 */
export function planStartWords(input: {
  readonly latest: string;
  readonly taken: RecordedPlanOffer | null;
  readonly standing: RecordedPlanOffer | null;
}): { readonly ask: string; readonly quote?: string | null } {
  if (input.taken !== null) return { ask: input.taken.ask };
  if (input.standing === null) return { ask: input.latest };
  return {
    ask: `${input.standing.ask}\n${input.latest.trim()}`.slice(0, 2_000),
    quote: null,
  };
}

/** The plan Q offered: their own, for a goal or period, from what Q holds. */
export const OFFERED_PLAN_ASK: QPlanAskReading = {
  kind: "GOAL",
  research: "NONE",
  side: null,
  subject: "OWN",
  deliverable: "PLAN",
};

export type PointedAt = {
  readonly ask: ReferenceAsk | null;
  /** Null: bound to one of the page's controls, said in `note`. */
  readonly resolved: ResolvedReference | null;
  readonly note: string;
  readonly control?: ControlBinding | undefined;
  /** RC4: the line that says which list a place was counted in. */
  readonly lead?: ReferenceLead | null | undefined;
};

/** B5: spoken words that address Q by name ("thanks, Q"). */
export const NAMES_Q = /(?:^|[\s,!.])(?:q|cue|queue)(?:$|[\s,!.?])/iu;

/** B6: "him" / "them" bound to an organisation, as a hand-over subject. */
export function handOverSubjectPointed(
  pointed: PointedAt | null,
): HandOverSubject | null {
  if (pointed === null || pointed.ask?.kind !== "COUNTERPART") return null;
  if (pointed.resolved?.kind !== "ONE") return null;
  const entity = pointed.resolved.entity;
  if (entity.kind === "COMPANY") {
    return { kind: "COMPANY", companyId: entity.id };
  }
  if (entity.kind === "INVESTOR_ORGANISATION") {
    return { kind: "INVESTOR_ORGANISATION", investorOrganisationId: entity.id };
  }
  return null;
}

/** The reader's [Q context] note with the binding first (it is bounded). */
export function withResolution(
  note: string | null,
  pointed: PointedAt | null,
): string | null {
  if (pointed === null) return note;
  const rest = note === null ? "" : note.replace(/^\[Q context\]\s*/u, " ");
  return `[Q context] ${pointed.note}${rest}`.slice(0, 400);
}

export function pointedAt(
  text: string,
  history: readonly QConversationMessage[],
  manifest: QPageManifest | null | undefined,
): PointedAt | null {
  const ask = referenceAskOf(text);
  const control = controlBindingOf(text, manifest?.controls);
  if (
    control?.target === "list.pipeline" &&
    /\bpipeline\b/iu.test(text) &&
    asksToOperate(text)
  ) {
    return { ask, resolved: null, note: control.note, control };
  }
  if (ask !== null) {
    const latestQ = [...history].reverse().find((one) => one.role === "Q");
    const resolved = resolveReference(ask, {
      page: listsFromManifest(manifest),
      here: hereFromManifest(manifest),
      answers: listsFromHistory(history),
      answerIsNewest: (latestQ?.blocks ?? []).some(
        (block) => block.kind === "ANSWER_CARDS",
      ),
      focus: focusFromHistory(history),
    });
    if (resolved !== null) {
      // RC4: which list the place was counted in, said with the answer.
      const lead = referenceLeadOf(ask, resolved, listsFromHistory(history));
      return {
        ask,
        resolved,
        note:
          lead === null
            ? resolutionNote(ask, resolved)
            : `${resolutionNote(ask, resolved)} ${lead.line} Say which list you counted in; never claim another order.`,
        lead,
      };
    }
    // A2: explicit places with no list that has them all. Never a guess at
    // which records were meant: Q asks.
    if (ask.kind === "POSITIONS" && control === null) {
      return {
        ask,
        resolved: null,
        note: "UNRESOLVED: they named places in a list, but no list they were shown has all of them. Ask which ones they mean; do not pick records.",
      };
    }
  }
  // C's request: the page's own controls ("open the readiness tab", "the
  // second one" on a list the page registered without record refs).
  return control === null
    ? null
    : { ask, resolved: null, note: control.note, control };
}

/** The act on the page's own control, with a fresh act id for its receipt. */
export function controlActBlock(control: ControlBinding): QResultBlock {
  return {
    kind: "UI_INTENT",
    intent: {
      kind: "UI_ACT",
      actId: `uia_${randomUUID().replace(/-/gu, "").slice(0, 24)}`,
      act: control.act,
      target: control.target,
      ...(control.index === undefined ? {} : { index: control.index }),
      ...(control.value === undefined ? {} : { value: control.value }),
    },
  };
}

/** A control to work, with the tab's own visible name when it has one. */
export type PageControlChoice = ControlBinding & {
  readonly label?: string | undefined;
};

/**
 * v55: the control the reader chose, when the page listed it and it is a
 * tab (selected) or a section (shown). Null for anything else.
 */
export function pageControlChosen(
  chosen: string | null,
  controls: QPageManifest["controls"],
): PageControlChoice | null {
  if (chosen === null) return null;
  const control = (controls ?? []).find((one) => one.id === chosen);
  if (control === undefined || control.state === "DISABLED") return null;
  const act =
    control.kind === "TAB"
      ? ("SELECT_TAB" as const)
      : control.kind === "SECTION"
        ? ("SCROLL_TO" as const)
        : null;
  if (act === null) return null;
  return {
    target: control.id,
    act,
    note: `${control.id} on their page`,
    ...(control.label === undefined ? {} : { label: control.label }),
  };
}

/** What Q says as it works a control (never that it is done: the receipt says). */
export function controlActLine(control: PageControlChoice): string {
  if (control.label !== undefined && control.act === "SELECT_TAB") {
    return `Opening ${control.label}.`;
  }
  const name = (control.target.split(".").at(-1) ?? "").replace(/-/gu, " ");
  if (control.act === "SELECT_TAB") return `Opening the ${name} tab.`;
  if (control.act === "SELECT_ITEM") {
    return `Opening number ${String(control.index ?? 1)}.`;
  }
  if (control.act === "SCROLL_TO") return `Taking you to ${name}.`;
  return `Working the ${name} control.`;
}
