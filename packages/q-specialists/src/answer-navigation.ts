// W3-B (audit finding 4): moved unchanged out of answer.ts, which
// re-exports what it exported. Here: navigation readings, screen lines and offers.
import {
  type QNavigateDestination,
  type QNavigationOfferBlock,
  type QResultBlock,
} from "@capital-q/contracts";
import { type QTurnReading } from "@capital-q/model-gateway/q";
import {
  readsAsGo,
  type TurnNavigationIntentV84,
  type TurnToolV14,
} from "@capital-q/q-core";
import {
  type QAnswerRequest,
  type QConversationMessage,
} from "@capital-q/q-runtime";
import { MANAGER_SCREENS } from "@capital-q/q-tools";

import { questionAfterMove } from "./answer-turn-asks.js";
import { asksToGo } from "./page-request.js";
import { type TabAsk } from "./tab-request.js";
import { namesWebAddress } from "./tool-focus.js";

/**
 * Whether a turn may be answered by a move alone (QA 2026-10-23, F-33 /
 * F-41 / F-34 / QO-39: "accept their interest...", "tell me more about
 * the second one", "show me my Q Card and the share link", "express
 * interest in Ledgerfold with this note" were each answered by opening a
 * page, and the ask was lost). Only words that ask to go somewhere are a
 * move; a question or an action is answered, and the answer may open a
 * page beside its words through its own tool. Words in a script with no
 * Latin letters are taken as the reading says: the move words are only
 * known in English, and the reading is by meaning in any language (F-36).
 */
export function onlyAMove(text: string): boolean {
  return (
    asksToGo(text) ||
    /\bopen(?:ed|ing|s)?\b/iu.test(text) ||
    !/\p{Script=Latin}/u.test(text)
  );
}

/**
 * C10 (owner directive and correction 13 Nov 2026: semantic intent, not
 * keyword routing; keep contextual workspace navigation). What a reading
 * says about navigation (TURN_READER v84) and the turn's parts. Whether a
 * turn asks to be taken somewhere is the reading's `navigation`; the word
 * rules beside it (asksToGo, onlyAMove, wordsNamePage, asksToGoExplicitly,
 * questionAfterMove) are kept ONLY as the fallback for a turn with no
 * navigation reading -- a reading that failed, an older reader, or one
 * that left the field out -- and for CONTEXT where no workspace pane
 * exists (there is no adjacent pane to bring a page into, so behaviour
 * there is as before).
 */
export type NavigationReading = {
  /** v87: `tab`, the part of a record page they mean, read by meaning. */
  readonly navigation?:
    | (TurnNavigationIntentV84 & {
        readonly tab?: TabAsk["tab"] | null | undefined;
      })
    | null
    | undefined;
  readonly parts?: readonly unknown[] | undefined;
  /** A8: their company's pitch video or picture asked for (by meaning). */
  readonly companyMedia?:
    { readonly pitch: boolean; readonly picture: boolean } | null | undefined;
};

/**
 * The reading's navigation with its record tab as placed. Live 13 Nov 2026
 * (550ecdd5c): "Could I watch how Clinicrest presents itself? Play me their
 * pitch." was read tab deck with companyMedia.pitch: a pitch to watch lives
 * on the profile's Elevator pitch tab, never the deck (a pitch-deck request
 * reads pitch false and keeps deck). The reading's own fields; no words.
 */
function placedNavigation(
  navigation: NavigationReading["navigation"],
  companyMedia: NavigationReading["companyMedia"],
): NonNullable<NavigationReading["navigation"]> | null {
  if (navigation === null || navigation === undefined) return null;
  return companyMedia?.pitch === true && navigation.tab === "deck"
    ? { ...navigation, tab: "elevator" }
    : navigation;
}

/** The reading's navigation intent; null when there is none (word fallback). */
export function navigationOf(
  read: NavigationReading | null | undefined,
  workspace: boolean,
): NonNullable<NavigationReading["navigation"]> | null {
  const navigation = placedNavigation(read?.navigation, read?.companyMedia);
  return navigation?.mode === "CONTEXT" && !workspace ? null : navigation;
}

/** A8: the pitch is played in the answer (COMPANY_MEDIA), never opened. */
export function asksToWatchPitch(
  read: NavigationReading | null | undefined,
): boolean {
  return read?.companyMedia?.pitch === true;
}

/** Whether this run's screen has the Q Workspace's adjacent page pane. */
export function inWorkspace(request: QAnswerRequest): boolean {
  return request.plan.screen?.workspace !== undefined;
}

/** They ask to go somewhere: the reading's GO; with none, the words (fallback). */
export function asksToGoRead(
  read: NavigationReading | null | undefined,
  text: string,
  workspace: boolean,
): boolean {
  const navigation = navigationOf(read, workspace);
  return navigation === null ? asksToGo(text) : readsAsGo(navigation);
}

/**
 * More is asked beside the move ("open Clinicrest and tell me its stage"):
 * the reading's parts (two or more asks); with no navigation reading, the
 * clause split of the words (fallback).
 */
export function moreThanTheMove(
  read: NavigationReading | null | undefined,
  text: string,
  workspace: boolean,
): boolean {
  if (navigationOf(read, workspace) === null) return questionAfterMove(text);
  return (read?.parts?.length ?? 0) > 1;
}

/**
 * The reader's own tool this turn acts on, if any: a LOW reading is a
 * guess and acts on nothing; a reply continuing Q's question moves no
 * screen unless they ask to go. Shared by the answer path and the fast GO
 * check, so both read the same tool.
 */
export function readerToolOf(
  read: QTurnReading | null,
  text: string,
  workspace: boolean,
): TurnToolV14 | null {
  return read !== null &&
    read.confidence !== "LOW" &&
    // v65: no screen move for a reply that continues Q's question.
    !(
      read.tool?.kind === "NAVIGATE" &&
      read.replyTo?.kind === "Q_QUESTION" &&
      !asksToGoRead(read, text, workspace)
    ) &&
    (read.kind === "TOOL_REQUEST" ||
      (read.kind === "RESEARCH_REQUEST" &&
        read.tool?.kind === "PREPARE_DOCUMENT") ||
      // Q Pitch v6 (live 2026-10-17): "Can you pitch Capital Q to me?"
      // is read as a question about Capital Q that carries NAVIGATE to
      // Q_PITCH; the tour is the answer to it. Still gated by the words
      // (wordsNamePage) in actOnTool when there is no navigation reading.
      (read.kind === "QUESTION_TO_Q" &&
        read.tool?.kind === "NAVIGATE" &&
        read.tool.destination === "Q_PITCH"))
    ? read.tool
    : null;
}

/** Their own Q Card, asked about: read and offered by the answer, never a page move (F-34). */
export const NAMES_Q_CARD = /\bq[\s-]?card\b/iu;

/**
 * Their words answer a question Q itself just asked ("Want me to find three
 * investors for Halyard?" -> "Yes. No, not Halyard. Capital Q"), and do
 * not ask to go anywhere: the question is continued, never a page or a
 * record opened by name. Code's own "which one do you mean?" about a
 * record they asked to open is the exception: its answer is that record.
 */
export function continuesQsQuestion(
  history: readonly Pick<QConversationMessage, "role" | "content">[],
  text: string,
): boolean {
  const before = [...history];
  // The turn itself is the last USER message; Q's question precedes it.
  if (before.at(-1)?.role === "USER") before.pop();
  const lastQ = [...before].reverse().find((m) => m.role === "Q");
  if (lastQ === undefined) return false;
  const asked = lastQ.content.trim();
  // A question, or an invitation to answer one ("… Tell me which to look
  // into further." -- coordinator replay 2026-10-24: "Yes. No, not
  // Halyard. Capital Q" after it opened Capital Q's page).
  const lastSentence = asked.split(/(?<=[.!?])\s+/u).at(-1) ?? asked;
  const invites =
    /\?["”)]?$/u.test(asked) ||
    /^(?:tell me|let me know|say|just say|pick|choose|which)\b/iu.test(
      lastSentence.trim(),
    );
  if (!invites) return false;
  if (
    /^(?:Which one do you mean|I can't find)\b/u.test(asked) ||
    /\bDid you mean [^?]*\?$/u.test(asked)
  ) {
    return false;
  }
  return !asksToGo(text) && !/\bopen\b/iu.test(text);
}

/** The person's latest words in this conversation, for varied wording. */
/** Two records the turn could mean: which one, by name (never a guess). */
export function whichRecordLine(names: readonly string[]): string {
  const shown = names.slice(0, 4);
  const last = shown.at(-1) ?? "";
  return shown.length < 2
    ? `Do you mean ${last}?`
    : `Do you mean ${shown.slice(0, -1).join(", ")} or ${last}?`;
}

export function askedIn(history: readonly QConversationMessage[]): string {
  return [...history].reverse().find((m) => m.role === "USER")?.content ?? "";
}

/**
 * What Q says as it takes somebody somewhere (CQ-QACT-001). The same
 * words voice speaks for the same destinations; the screen follows the
 * UI_INTENT the message carries, through its one route map.
 */
/**
 * S7 (lane S, live 2026-10-15 runs d3fdbd12 and f72d9994, "What are the
 * main risks here?" on a company page): advice takes research by default
 * (q-core), so every such ask about a company Capital Q holds searched the
 * public web first -- 6.3 s before the synthesis started, a paid provider
 * call each time. Advice alone is answered from Capital Q's records; it
 * still researches when they ask for the web (Q intelligence step 4: the
 * reader's asksForWeb, never a word list) or name a web address.
 */
export function adviceOnCapitalQRecord(
  request: Pick<QAnswerRequest, "turnKind" | "questionKind" | "asksForWeb">,
  text: string,
): boolean {
  return (
    request.turnKind === "QUESTION_TO_Q" &&
    request.questionKind === "ADVICE" &&
    request.asksForWeb !== true &&
    !namesWebAddress(text)
  );
}

/**
 * A screen of an investor's own (INVESTOR_SCREENS) asked for by someone
 * with no investor organisation: what it is, and where their own side of
 * it lives. Never "Opening …" for a page this person cannot open.
 */
export function notTheirSideLine(
  asked: QNavigateDestination,
  own: QNavigateDestination | null,
): string {
  const what =
    asked === "MANDATE"
      ? "A mandate is an investor's: what they invest in, cheque size, stage and places, so there isn't one on your account."
      : "That page is for investors, so there's nothing of yours there.";
  return own === "CAPITAL_RAISE"
    ? `${what} What investors match you on is your raise, so I'm opening it.`
    : own === "PROFILE"
      ? `${what} What investors see of you is your profile, so I'm opening it.`
      : what;
}

/**
 * Q-NAV: an organisation screen this person is not offered. The import is
 * for the organisation's owners and admins; the rest is for anyone acting
 * for an organisation. Never "Opening …" for a page they cannot open.
 */
export function notTheirOrganisationScreenLine(
  asked: QNavigateDestination,
  organisation: boolean,
): string {
  if (MANAGER_SCREENS.has(asked)) {
    return organisation
      ? "Importing a pipeline is for your organisation's owners and admins, so I'm opening your organisation instead. An owner or admin can import it, or change your role."
      : "Importing a pipeline is for an organisation's owners and admins, and you aren't acting for an organisation.";
  }
  return "You aren't acting for an organisation, so there's no organisation page to open. Switch to your organisation first, then ask again.";
}

/**
 * Their own counterpart of an investor's screen, when this run may open
 * it (a founder's raise, else their profile); null when neither.
 */
function ownCounterpart(
  navigable: readonly QNavigateDestination[],
): QNavigateDestination | null {
  return navigable.includes("CAPITAL_RAISE")
    ? "CAPITAL_RAISE"
    : navigable.includes("PROFILE")
      ? "PROFILE"
      : null;
}

/**
 * Live 2026-10-30 (founder, "take me to my mandate"): Q said "Opening
 * your mandate…", sent a founder's screen to /mandate and stayed on Home.
 * A screen of the capability registry's investor side (INVESTOR_SCREENS),
 * asked for by someone with no investor organisation in this run's plan,
 * is never claimed: Q says what it is and opens their own counterpart
 * when this run may.
 */
export function notTheirSideMove(
  asked: QNavigateDestination,
  navigable: readonly QNavigateDestination[],
): { readonly said: string; readonly blocks: readonly QResultBlock[] } {
  const own = ownCounterpart(navigable);
  return {
    said: notTheirSideLine(asked, own),
    blocks:
      own === null
        ? []
        : [
            {
              kind: "UI_INTENT",
              intent: { kind: "NAVIGATE", destination: own },
            },
          ],
  };
}

export const DESTINATION_LINES: Readonly<Record<QNavigateDestination, string>> =
  {
    HOME: "Taking you home now.",
    PROFILE: "Opening your profile.",
    CAPITAL: "Taking you to Capital.",
    DISCOVER: "Taking you to Discover.",
    COMPANY_VISIBILITY: "Opening your visibility settings.",
    RELATIONSHIPS: "Opening the CRM.",
    SETTINGS: "Opening Settings.",
    VERIFICATION: "Opening verification.",
    PITCH: "Opening Pitch & media.",
    COMPANY_INTEREST: "Opening your investor interest.",
    SAVED: "Opening Saved.",
    PASSED: "Opening Passed.",
    INVESTORS: "Opening Investors.",
    SEARCH: "Opening Search.",
    GATEWAY: "Opening your gateway.",
    MEMORY: "Opening what I remember about you.",
    USAGE: "Opening what I used for you this month.",
    NEW_PITCH: "Opening a new pitch video.",
    REHEARSALS: "Opening Rehearsals.",
    DOCUMENTS: "Opening your documents.",
    DAILY: "Opening The Q Daily.",
    RESULTS: "Opening Results.",
    YOUR_COMPANIES: "Opening Your companies.",
    WORK: "Opening Work.",
    EXPLORE: "Opening Explore.",
    PEOPLE_SEARCH: "Opening Search.",
    WORK_NEEDS: "Opening what needs you on Work.",
    WORK_PROGRESS: "Opening what's in progress on Work.",
    WORK_DONE: "Opening what's done on Work.",
    WORK_TEAM: "Opening the Team tab on Work.",
    WORK_COST: "Opening the Cost tab on Work.",
    OWN_DATA_ROOM: "Opening your data room.",
    OWN_DECK: "Opening your pitch deck.",
    GATEQ_INBOX: "Opening your GateQ inbox.",
    GATEQ_FIND: "Opening Find on GateQ.",
    GATEQ_CLAIM: "Opening Claim on GateQ.",
    GATEQ_APPLICATIONS: "Opening your GateQ applications.",
    SAVED_COMPARE: "Opening Compare.",
    REVIEWS: "Opening Human review.",
    TOP_INVESTORS: "Opening your top three investors.",
    CAPITAL_RAISE: "Opening Raise & rounds on Capital.",
    CAPITAL_READINESS: "Opening your readiness on Capital.",
    CAPITAL_ACTION_PLAN: "Opening your action plan.",
    CAPITAL_PLAN: "Opening your 12-month plan.",
    CAPITAL_INVESTORS: "Opening your investors on Capital.",
    CRM_PIPELINE: "Opening your pipeline.",
    Q_PITCH: "Let me show you Capital Q.",
    BOARD: "Opening your board.",
    MANDATE: "Opening your mandate.",
    ANALYTICS: "Opening your analytics.",
    ORGANISATION: "Opening your organisation.",
    ORGANISATION_MEMBERS: "Opening your organisation's members.",
    ORGANISATION_ROLES: "Opening your organisation's roles.",
    ORGANISATION_PLAN: "Opening your organisation's plan.",
    ORGANISATION_IMPORT: "Opening your organisation's import.",
    ORGANISATION_ACTIVITY: "Opening your organisation's activity log.",
    PIPELINE_IMPORT: "Opening the pipeline import.",
  };

/**
 * N1 (owner 2026-11-04): what Q says after answering in place, and the
 * offer card's words, for each page it answers in place first
 * (ANSWERED_IN_PLACE). Code's words, never a model's.
 */
export const OFFER_WORDS: Readonly<
  Record<
    string,
    {
      readonly line: string;
      readonly place: string;
      readonly openLabel: string;
    }
  >
> = {
  CRM_PIPELINE: {
    line: "Your full pipeline is in Relationships. Would you like to open it?",
    place: "Relationships",
    openLabel: "Open pipeline",
  },
  RELATIONSHIPS: {
    line: "Everything with each of them is in Relationships. Would you like to open it?",
    place: "Relationships",
    openLabel: "Open Relationships",
  },
};

/** N1: what Q says when they choose to stay where they are. */
export const STAY_HERE_LINE =
  "Sure, we'll stay here. Ask me anything about it.";

/**
 * C3: a yes to an offer whose tool this run no longer holds. Nothing is
 * done, and no other tool is tried in its place.
 */
export const OFFER_NOT_AVAILABLE_LINE =
  "I can't do that from here right now, so I haven't started anything. Tell me what you'd like instead and I'll take it from there.";

/** N1: the page Q's last answer offered to open, from its stored blocks. */
export function navigationOfferOf(
  history: readonly QConversationMessage[],
): QNavigationOfferBlock | null {
  const before = [...history];
  if (before.at(-1)?.role === "USER") before.pop();
  const lastQ = before.reverse().find((m) => m.role === "Q");
  const offer = (lastQ?.blocks ?? []).findLast(
    (block) => block.kind === "NAVIGATION_OFFER",
  );
  return offer?.kind === "NAVIGATION_OFFER" ? offer : null;
}

/** What Q says as it opens the offered page. */
export function openedOfferLine(offer: QNavigationOfferBlock): string {
  return offer.intent.kind === "NAVIGATE"
    ? DESTINATION_LINES[offer.intent.destination]
    : `Opening ${offer.place}.`;
}

/**
 * A founder's own data room: never where an investor is taken (QO-15). The
 * line said instead is about requests, so only this page is remapped.
 */
export const FOUNDER_OWN_PAGES: ReadonlySet<QNavigateDestination> = new Set([
  "OWN_DATA_ROOM",
]);

/** A real screen, as offered back to someone who named one that isn't. */
const DESTINATION_NAMES: Readonly<Record<QNavigateDestination, string>> = {
  HOME: "Home",
  PROFILE: "your profile",
  CAPITAL: "Capital",
  DISCOVER: "Discover",
  COMPANY_VISIBILITY: "your visibility settings",
  RELATIONSHIPS: "the CRM",
  SETTINGS: "Settings",
  VERIFICATION: "Verification",
  PITCH: "Pitch & media",
  COMPANY_INTEREST: "your investor interest",
  SAVED: "Saved",
  PASSED: "Passed",
  INVESTORS: "Investors",
  SEARCH: "Search",
  GATEWAY: "your gateway",
  MEMORY: "what Q remembers",
  USAGE: "what Q used for you",
  NEW_PITCH: "a new pitch video",
  REHEARSALS: "Rehearsals",
  DOCUMENTS: "Documents",
  DAILY: "The Q Daily",
  RESULTS: "Results",
  YOUR_COMPANIES: "Your companies",
  WORK: "Work",
  EXPLORE: "Explore",
  PEOPLE_SEARCH: "Search",
  WORK_NEEDS: "Work (Needs you)",
  WORK_PROGRESS: "Work (In progress)",
  WORK_DONE: "Work (Done)",
  WORK_TEAM: "Work (Team)",
  WORK_COST: "Work (Cost)",
  OWN_DATA_ROOM: "your data room",
  OWN_DECK: "your pitch deck",
  GATEQ_INBOX: "your GateQ inbox",
  GATEQ_FIND: "GateQ Find",
  GATEQ_CLAIM: "GateQ Claim",
  GATEQ_APPLICATIONS: "your GateQ applications",
  SAVED_COMPARE: "Compare",
  REVIEWS: "Human review",
  TOP_INVESTORS: "your top three investors",
  CAPITAL_RAISE: "Capital (Raise & rounds)",
  CAPITAL_READINESS: "Capital (Readiness)",
  CAPITAL_ACTION_PLAN: "Capital (Action plan)",
  CAPITAL_PLAN: "Capital (12-month plan)",
  CAPITAL_INVESTORS: "Capital (Investors)",
  CRM_PIPELINE: "CRM (Pipeline)",
  Q_PITCH: "Q Pitch",
  BOARD: "Work (Board)",
  MANDATE: "your mandate",
  ANALYTICS: "your analytics",
  ORGANISATION: "your organisation",
  ORGANISATION_MEMBERS: "your organisation's members",
  ORGANISATION_ROLES: "your organisation's roles",
  ORGANISATION_PLAN: "your organisation's plan",
  ORGANISATION_IMPORT: "your organisation's import",
  ORGANISATION_ACTIVITY: "your organisation's activity log",
  PIPELINE_IMPORT: "the pipeline import",
};

/**
 * A screen Capital Q does not have (founder live test 2026-09-27 #5): said
 * plainly, and the nearest real one offered, never a silent move. The
 * nearest comes from the reading but is offered only if this run can open
 * it; otherwise the screens it can open are named. `named` is the person's
 * own words echoed back, bounded to plain text.
 */
export function unknownScreenLine(
  named: string,
  nearest: QNavigateDestination,
  navigable: readonly QNavigateDestination[],
): string {
  const plain = named
    .replace(/[^\p{L}\p{N}\s'-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    // "the queue page" is named with its own "page": said once, not twice.
    .replace(/\s+(page|screen|tab)$/iu, "")
    .replace(/^(the|my|a)\s+/iu, "")
    .slice(0, 60);
  const opening =
    plain.length === 0
      ? "Capital Q doesn't have that page."
      : `Capital Q doesn't have a "${plain}" page.`;
  if (navigable.includes(nearest)) {
    return `${opening} The nearest is ${DESTINATION_NAMES[nearest]}. Shall I take you there?`;
  }
  if (navigable.length === 0) return opening;
  return `${opening} I can take you to ${navigable
    .map((destination) => DESTINATION_NAMES[destination])
    .join(", ")}.`;
}

/**
 * What changing visibility means, said before the proposal (which Q only
 * claims once it exists). The Visibility & Discovery screen's own terms,
 * readiness included: visible and recommended are separate states.
 */
export const VISIBILITY_EXPLANATIONS: Readonly<
  Record<"network_visible" | "organisation_private", string>
> = {
  network_visible:
    "Making your company visible means investors on Capital Q can find it by name and read its profile; everything else you've shared with me stays private. Being visible doesn't put you in investor recommendations on its own: the marketplace requirements decide that, separately.",
  organisation_private:
    "Making your company private means only people in your organisation can see it: investors can no longer find it, and I won't mention it to them. If it's in investor recommendations now, it leaves them until it's visible again.",
};
