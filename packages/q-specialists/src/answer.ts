import {
  appActionOf,
  pendingAppActionStore,
  type PendingAppActionStore,
  type QAppActionAsks,
  type QAppActionPort,
  type QAppActionPrepared,
  type TurnAppAction,
} from "./app-action-turn.js";
import { namesWebAddress, RESEARCH_TOOLS, toolFocusOf } from "./tool-focus.js";
import {
  readingMisfit,
  SPECULATIVE_READING,
  speculationMisfit,
  startSpeculation,
  type QSpeculationEvent,
  type Speculation,
} from "./speculation.js";

/**
 * The investor organisation's own visibility action (app action
 * investor.visibility.set). SET_VISIBILITY is the company's hand only.
 */
const INVESTOR_VISIBILITY_TOOL = "set_investor_visibility";
/**
 * One of their own records' audience is that record's declared action,
 * never the company's visibility (QA run 3af14042: "Make Ajopot seed deck
 * private to my organisation again" prepared "Make your company private").
 * A deck, document or upload first ("pitch deck" is a deck), then a pitch
 * video. The tool resolves the name among their own records and refuses
 * one it cannot find.
 */
const RECORD_AUDIENCE: readonly (readonly [RegExp, string])[] = [
  [
    /\b(?:decks?|documents?|docs?|files?|uploads?|one-pagers?|financials)\b/iu,
    "set_deck_audience",
  ],
  [/\b(?:pitch(?:es)?|videos?|recordings?)\b/iu, "set_pitch_sharing"],
];

/** The record-audience action the words name, or null. */
export function recordAudienceTool(utterance: string): string | null {
  for (const [words, tool] of RECORD_AUDIENCE) {
    if (words.test(utterance)) return tool;
  }
  return null;
}
import {
  type QNavigateDestination,
  type QPageManifest,
  type QResponseMessage,
  type QResultBlock,
  type QVisibleStage,
} from "@capital-q/contracts";
import {
  INITIAL_CONVERSATION_STATE,
  isUnclearTurn,
  NO_RESEARCH,
  noteAnswerFailure,
  readingFromTurnReader,
  reduceConversation,
  researchDirectiveFor,
  stepQuestionSequence,
  unclearTurnReply,
  spokenUnclearReply,
  pleasantryOf,
  pleasantryReply,
  naturalPlaceLine,
  spokenFactsOf,
  withoutRecommendationClaims,
  type ConversationState,
  type FailureOperation,
  type QuestionSequence,
  type TurnToolV14,
  quietlyNoted,
} from "@capital-q/q-core";
import {
  closestByName,
  eligibleCapabilities,
  Q_CAPABILITIES,
  type GetInvestorMandateOutput,
  type QCapability,
  toolAreaOf,
  zoneFromWords,
} from "@capital-q/q-tools";
import { ownInvestorOrganisationIn } from "@capital-q/model-gateway/q";

import {
  ANSWER_DOCUMENT_ARTIFACT_TYPE,
  composeAnswerDocument,
} from "./answer-document.js";
import {
  composeOwnMandateDocument,
  type MandateLabels,
  OWN_MANDATE_ARTIFACT_TYPE,
} from "./own-mandate-document.js";
import type { DatabaseExecutor, TransactionManager } from "@capital-q/database";
import type { Logger } from "@capital-q/observability";
import {
  appendRunEvent,
  toQMessage,
  type QAnswerOutcome,
  type QAnswerPort,
  type QAnswerRequest,
  type QPrereadInput,
  type QCapabilityManifest,
  type QConversationMessage,
  type QResearchDirective,
  type QRuntimeRepositories,
  type QToolFocus,
} from "@capital-q/q-runtime";

import type {
  QSpecialist,
  QSpecialistProbe,
  QSpecialistTurnReading,
} from "./contracts.js";
import {
  actOnHandOver,
  type HandOverSubject,
  type QHandOverPort,
} from "./hand-over.js";
import {
  actOnDelegation,
  DELEGATION_CANDIDATE,
  DELEGATION_TOOL,
  type QDelegationPort,
} from "./delegation.js";
import type { QProfileGapsPort } from "./profile-gaps.js";
import {
  openingLine,
  openTarget,
  referenceNote,
  repeatedAction,
  shownItems,
  type LastAction,
  type QOpenRecordPort,
} from "./references.js";
import {
  CORE_LOAD_DEADLINE_MS,
  loadWithin,
  readCoreSnapshot,
  type ConversationCoreScope,
  type ConversationCoreStore,
} from "./conversation-core.js";
import {
  asksToOperate,
  controlBindingOf,
  focusFromHistory,
  listsFromHistory,
  listsFromManifest,
  referenceAskOf,
  resolutionNote,
  resolveReference,
  type ControlBinding,
  type ReferenceAsk,
  type ResolvedReference,
} from "./conversation-entities.js";

/** B6: a reference in the turn, bound to records, with its note. */
type PointedAt = {
  readonly ask: ReferenceAsk | null;
  /** Null: bound to one of the page's controls, said in `note`. */
  readonly resolved: ResolvedReference | null;
  readonly note: string;
  readonly control?: ControlBinding | undefined;
};

/** B5: spoken words that address Q by name ("thanks, Q"). */
const NAMES_Q = /(?:^|[\s,!.])(?:q|cue|queue)(?:$|[\s,!.?])/iu;

/** B6: "him" / "them" bound to an organisation, as a hand-over subject. */
function handOverSubjectPointed(
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
function withResolution(
  note: string | null,
  pointed: PointedAt | null,
): string | null {
  if (pointed === null) return note;
  const rest = note === null ? "" : note.replace(/^\[Q context\]\s*/u, " ");
  return `[Q context] ${pointed.note}${rest}`.slice(0, 400);
}

function pointedAt(
  text: string,
  history: readonly QConversationMessage[],
  manifest: QPageManifest | null | undefined,
): PointedAt | null {
  const ask = referenceAskOf(text);
  if (ask !== null) {
    const latestQ = [...history].reverse().find((one) => one.role === "Q");
    const resolved = resolveReference(ask, {
      page: listsFromManifest(manifest),
      answers: listsFromHistory(history),
      answerIsNewest: (latestQ?.blocks ?? []).some(
        (block) => block.kind === "ANSWER_CARDS",
      ),
      focus: focusFromHistory(history),
    });
    if (resolved !== null) {
      return { ask, resolved, note: resolutionNote(ask, resolved) };
    }
  }
  // C's request: the page's own controls ("open the readiness tab", "the
  // second one" on a list the page registered without record refs).
  const control = controlBindingOf(text, manifest?.controls);
  return control === null
    ? null
    : { ask, resolved: null, note: control.note, control };
}

import { randomUUID } from "node:crypto";

/** The act on the page's own control, with a fresh act id for its receipt. */
function controlActBlock(control: ControlBinding): QResultBlock {
  return {
    kind: "UI_INTENT",
    intent: {
      kind: "UI_ACT",
      actId: `uia_${randomUUID().replace(/-/gu, "").slice(0, 24)}`,
      act: control.act,
      target: control.target,
      ...(control.index === undefined ? {} : { index: control.index }),
    },
  };
}

/** What Q says as it works a control (never that it is done: the receipt says). */
function controlActLine(control: ControlBinding): string {
  const name = (control.target.split(".").at(-1) ?? "").replace(/-/gu, " ");
  if (control.act === "SELECT_TAB") return `Opening the ${name} tab.`;
  if (control.act === "SELECT_ITEM") {
    return `Opening number ${String(control.index ?? 1)}.`;
  }
  if (control.act === "SCROLL_TO") return `Taking you to ${name}.`;
  return `Working the ${name} control.`;
}
import {
  cannotOpenLine,
  cardAt,
  cardsOnScreen,
  ordinalOf,
  pageRequestOf,
} from "./page-request.js";
import { resolveNamedRecord } from "./fast-navigation.js";
import type { TurnReference } from "@capital-q/q-core";
import type { QOwnRecordsPort } from "./own-records-port.js";
import {
  startPendingDecision,
  type PendingDecisionPort,
  type PendingTurnReading,
} from "./pending-decision.js";
import {
  NO_OWN_RECORDS,
  resolveOwnRecord,
  type OwnRecordMatch,
} from "./company/own-names.js";
import type {
  CompanyIntelligenceRequest,
  CompanyIntelligenceResult,
} from "./company/contracts.js";
import { asksAboutGaps } from "./company/dimensions.js";
import {
  existingDocumentCard,
  namedByPerson,
  personsRecentWords,
  sameCompanyName,
} from "./company/document-request.js";
import {
  latestArtifactCardIn,
  prepareOrReviseArtifact,
  type ArtifactPreparation,
} from "./company/prepare-artifact.js";
import {
  analystResultBlocks,
  askedSubjects,
  provenanceLine,
  type QTurnReader,
} from "@capital-q/model-gateway/q";

/**
 * How a specialist reaches Q (CQ-Q-020 §11, §53, §56, §91).
 *
 * This implements the runtime's existing answer seam, so the investigation
 * graph, the Context Firewall, the run lifecycle and the stream are all
 * untouched. Q asks for an answer; if the Company Intelligence specialist
 * is the right one for the request it produces findings and a synthesis,
 * and Q writes the message. If it is not, the request goes to the
 * delegate — today the conversational answer path — exactly as before.
 *
 *   QOrchestrator → answer seam → supports()? → specialist → findings
 *                                            ↘ no → delegate
 *
 * A person never learns any of this happened. Nothing written here carries
 * the specialist's id, its version, the provider, the prompt bundle or a
 * word of reasoning: those live in the trace and the telemetry, which is
 * where explainability belongs and where a person's message does not (§55,
 * §57, §91, §103).
 */

/** An action the reader is told of; `available: false` is declared but not offered here. */
type ReaderAction = {
  readonly name: string;
  readonly does: string;
  readonly available?: boolean | undefined;
  /** v32: a few words, and the area it is grouped under. */
  readonly short?: string | undefined;
  readonly area?: string | undefined;
};

/** The reader's input: the person's own latest words and own recent turns. */
/** A name without its parenthetical ("Savanna Seed Partners (fictional)"). */
function bareName(text: string): string {
  return text
    .replace(/\([^)]*\)/gu, " ")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/**
 * Whether the words name this counterpart: the whole name, parentheticals
 * dropped on both sides, or a run of as many words heard slightly wrong
 * ("Ledgefold" for Ledgerfold), by the shared name matcher.
 */
export function namedInWords(utterance: string, name: string): boolean {
  const wanted = bareName(name);
  if (wanted.length < 3) return false;
  const said = bareName(utterance);
  if (` ${said} `.includes(` ${wanted} `)) return true;
  const words = said.split(" ").filter((word) => word.length > 0);
  const size = wanted.split(" ").length;
  for (let start = 0; start + size <= words.length; start += 1) {
    const window = words.slice(start, start + size).join(" ");
    if (
      window.length >= 4 &&
      closestByName([wanted], window, (n) => n).length > 0
    ) {
      return true;
    }
  }
  return false;
}

/** Two summaries of one card: the same words, ignoring case and the full stop. */
function sameCard(a: string, b: string): boolean {
  const plain = (text: string) =>
    text
      .trim()
      .replace(/[.\s]+$/u, "")
      .toLowerCase();
  return plain(a) === plain(b);
}

function turnReaderInput(
  history: readonly QConversationMessage[],
  latest: QConversationMessage,
  actions: readonly ReaderAction[],
  context: {
    readonly tenantId: string;
    readonly userId: string;
    readonly correlationId: string;
    readonly signal?: AbortSignal | undefined;
  },
  /**
   * Capital Q's own note of what was shown and the last action (follow-55),
   * read as the last recent turn so "that one" and "try again" bind.
   */
  note: string | null = null,
) {
  // Spoken turns carry the recogniser's utterance; typed ones never do.
  // The reader needs to know which: only speech can be overheard.
  const spoken = latest.utteranceRef !== undefined;
  return {
    utterance: latest.content,
    actions,
    recentTurns: [
      ...history
        .filter((m) => m.id !== latest.id)
        .slice(note === null ? -6 : -5)
        .map((m) => ({
          role: m.role === "USER" ? ("USER" as const) : ("Q" as const),
          text: m.content,
        })),
      ...(note === null ? [] : [{ role: "Q" as const, text: note }]),
    ],
    modality: spoken ? ("VOICE" as const) : ("TEXT" as const),
    attribution: {
      tenantId: context.tenantId,
      userId: context.userId,
      correlationId: context.correlationId,
    },
    signal: context.signal,
  };
}

/** The capability's reader label and area (v32), when it has them. */
const labelOf = (capability: QCapability) => ({
  ...(capability.short === undefined ? {} : { short: capability.short }),
  ...(capability.area === undefined ? {} : { area: capability.area }),
});

const actionsKey = (actions: readonly ReaderAction[]): string =>
  JSON.stringify(
    actions.map((a) => ({
      name: a.name,
      does: a.does,
      ...(a.available === false ? { available: false } : {}),
      ...(a.short === undefined ? {} : { short: a.short }),
      ...(a.area === undefined ? {} : { area: a.area }),
    })),
  );

export type SpecialistQAnswerDependencies = {
  readonly specialist: QSpecialist<
    CompanyIntelligenceRequest,
    CompanyIntelligenceResult
  >;
  /** Where a request this specialist does not support goes. */
  readonly delegate: QAnswerPort;
  readonly repositories: QRuntimeRepositories;
  readonly sql: DatabaseExecutor;
  readonly transactions: TransactionManager;
  /**
   * Preparing a document, when this composition offers it (ADR 0013).
   *
   * Absent on a build with no artifact context, and then a person asking
   * for a brief is answered without one rather than told a lie about why.
   */
  readonly artifacts?: ArtifactPreparation | undefined;
  readonly logger?: Logger | undefined;
  /**
   * Reads each turn into the conversation core's closed vocabulary before
   * it is answered (CQ-QX-005). Absent: no reading, no research forced,
   * and failures carry no notice — the behaviour before the core.
   */
  readonly turns?: QTurnReader | undefined;
  /**
   * A typed yes or no to a change waiting in this conversation, read and
   * acted on by code through the Approval Engine (pending-decision.ts).
   * Absent: approval by conversation is left to the answer's tools.
   */
  readonly pendingDecisions?: PendingDecisionPort | undefined;
  /**
   * A hand-over read by the turn reader (v22), prepared by code as Q's
   * errand for the subject on screen (hand-over.ts). Absent: the answer's
   * own tools decide, as before.
   */
  readonly handOver?: QHandOverPort | undefined;
  /**
   * RECOVERY-2026-10 B3: where the conversation core's state outlives the
   * process (unclear count, last action, question series, tool focus).
   * Absent: memory only, as before.
   */
  readonly coreState?: ConversationCoreStore | undefined;
  /**
   * RECOVERY-2026-10 B5: a turn read as small talk, answered in one short
   * tool-free call (model-gateway createSmallTalkReply). Null: the full
   * path answers it. Absent: small talk takes the full path, as before.
   */
  readonly smallTalk?:
    | ((
        request: QAnswerRequest,
        input: {
          readonly said: string;
          readonly recent: readonly {
            readonly role: "USER" | "Q";
            readonly text: string;
          }[];
        },
      ) => Promise<string | null>)
    | undefined;
  /**
   * Work handed over in general (QA 2026-10-03): prepares a standing
   * instruction. Absent: such a turn is answered as before.
   */
  readonly delegation?: QDelegationPort | undefined;
  /**
   * Their own readiness gaps as the opening lines of "what should I do
   * next?", or null when there are none (or no company of theirs).
   */
  readonly readinessLead?:
    ((request: QAnswerRequest) => Promise<string | null>) | undefined;
  /**
   * ADR 0040: a declared app action the turn's reading names, done by code
   * through its generated tool (parity eval 2026-10-02).
   */
  readonly appActions?: QAppActionPort | undefined;
  /** Where a declared action waits on their reply (durable when composed). */
  readonly pendingAppActions?: PendingAppActionStore | undefined;
  /**
   * A "still waiting" line deferred until the engine's result for this run
   * is known (lead 2026-10-03). Absent: said right after the answer.
   */
  readonly waitingLines?:
    | {
        readonly defer: (
          runId: string,
          waiting: { readonly line: string; readonly actionId: string },
        ) => void;
      }
    | undefined;
  /**
   * The names of the counterparts in their own relationships, for telling
   * a request about one of them (lead 2026-10-03). Absent: never known.
   */
  readonly counterpartNames?:
    ((request: QAnswerRequest) => Promise<readonly string[]>) | undefined;
  /**
   * One app action's inputs from the person's words, against the tool's own
   * input schema (APP_ACTION_ARGUMENTS), for a reading that named the
   * action and gave no arguments. Null: their words don't give them.
   */
  readonly appActionArguments?:
    | ((
        request: QAnswerRequest,
        input: { readonly tool: string; readonly utterance: string },
      ) => Promise<Record<string, unknown> | null>)
    | undefined;
  /**
   * Which one declared app action a request to act asks for, when the
   * turn reader named none (APP_ACTION_ROUTER, lead 2026-10-03). Returns a
   * listed name or null. Absent: only the reader names actions.
   */
  readonly appActionRouter?:
    | ((
        request: QAnswerRequest,
        input: {
          readonly utterance: string;
          readonly candidates: readonly {
            readonly name: string;
            readonly does: string;
            readonly short?: string | undefined;
            readonly area?: string | undefined;
          }[];
        },
      ) => Promise<string | null>)
    | undefined;
  /**
   * Their own profile's open fields filled from public sources, by code,
   * when the turn reader reads saveToOwnProfile (HARDEN P0, 2026-10-02).
   */
  readonly profileGaps?: QProfileGapsPort | undefined;
  /**
   * Opening the one record a turn names or points at (follow-55), through
   * open_page's authorize step. Absent: such a turn is answered as before.
   */
  readonly openRecord?: QOpenRecordPort | undefined;
  /** Whether public research exists in this composition at all. */
  readonly researchAvailable?: boolean | undefined;
  /**
   * Where a turn read as "show / hide my company" is handed to the action
   * proposer (CQ-QACT-001). Absent: such a turn is answered like any other.
   */
  readonly visibility?: QVisibilityNotebook | undefined;
  /**
   * The provider names of the tools the Tool Registry offers this run's
   * answer model. With what is composed here they decide which entries of
   * the capability registry (R20) the run has: the turn reader is told the
   * actions, so it never files a request one of them performs as a
   * document, and the answer's model is told all of them. Absent: none.
   */
  readonly offeredTools?:
    ((request: QAnswerRequest) => Promise<readonly string[]>) | undefined;
  /**
   * The person's own investment mandate, read under this run's plan (the
   * firewall binds it only to the investor's own organisation). NOT_AN_
   * INVESTOR: the person has no investor organisation in this run. Absent:
   * a mandate document is answered without one, never invented.
   */
  readonly ownMandate?:
    | {
        readonly read: (
          request: QAnswerRequest,
        ) => Promise<GetInvestorMandateOutput | "NOT_AN_INVESTOR" | null>;
        /** Display names for the record's codes; absent, codes are said as words. */
        readonly labels?: MandateLabels | undefined;
      }
    | undefined;
  /**
   * The names on the person's own records (their company, firm and own
   * name), read under this run's plan, so a company name they said —
   * misheard or not — is checked against what is theirs before anything
   * is researched (founder live 2026-09-27, failure 6). Absent: no name
   * is resolved and the reading is used as said.
   */
  readonly ownRecords?: QOwnRecordsPort | undefined;
  /**
   * Voice speculation (latency2): a spoken turn's answer starts at once
   * under a conservative default reading, beside the turn reader, and is
   * adopted only where the turn's own path arrives at the same answer
   * (see speculation.ts). Absent or `spoken: false`: never.
   */
  readonly speculation?:
    | {
        readonly spoken: boolean;
        readonly observe?: ((event: QSpeculationEvent) => void) | undefined;
      }
    | undefined;
};

/** What one requested document came to: a line, and its card when made. */
type DocumentReply = {
  readonly content: string;
  readonly blocks?: readonly QResultBlock[] | undefined;
};

/** The proposer's side of a visibility reading; nothing here applies it. */
export type QVisibilityNotebook = {
  readonly noteVisibility: (entry: {
    readonly runId: string;
    readonly tenantId: string;
    readonly companyId: string;
    readonly visibility: "network_visible" | "organisation_private";
  }) => void;
};

/** The person's latest words in this conversation, for varied wording. */
function askedIn(history: readonly QConversationMessage[]): string {
  return [...history].reverse().find((m) => m.role === "USER")?.content ?? "";
}

/**
 * What Q says as it takes somebody somewhere (CQ-QACT-001). The same
 * words voice speaks for the same destinations; the screen follows the
 * UI_INTENT the message carries, through its one route map.
 */
const DESTINATION_LINES: Readonly<Record<QNavigateDestination, string>> = {
  HOME: "Taking you home now.",
  PROFILE: "Opening your profile.",
  CAPITAL: "Taking you to Capital.",
  DISCOVER: "Taking you to Discover.",
  COMPANY_VISIBILITY: "Opening your visibility settings.",
  RELATIONSHIPS: "Opening your relationships.",
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
};

/** A real screen, as offered back to someone who named one that isn't. */
const DESTINATION_NAMES: Readonly<Record<QNavigateDestination, string>> = {
  HOME: "Home",
  PROFILE: "your profile",
  CAPITAL: "Capital",
  DISCOVER: "Discover",
  COMPANY_VISIBILITY: "your visibility settings",
  RELATIONSHIPS: "your relationships",
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
const VISIBILITY_EXPLANATIONS: Readonly<
  Record<"network_visible" | "organisation_private", string>
> = {
  network_visible:
    "Making your company visible means investors on Capital Q can find it by name and read its profile; everything else you've shared with me stays private. Being visible doesn't put you in investor recommendations on its own: the marketplace requirements decide that, separately.",
  organisation_private:
    "Making your company private means only people in your organisation can see it: investors can no longer find it, and I won't mention it to them. If it's in investor recommendations now, it leaves them until it's visible again.",
};

export type SpecialistQAnswer = QAnswerPort & {
  /** The last investigation, for developer smokes and evals. Never a public path. */
  readonly lastResult: () => CompanyIntelligenceResult | null;
};

const ANSWER_LIMIT_CHARS = 32_000;

/**
 * How much of the conversation the specialist reads (CQ-QX-007 H3a).
 * Enough to carry a correction made a few turns back; bounded so a long
 * conversation does not become a long prompt.
 */
const CONVERSATION_TURNS_MAX = 12;
const CONVERSATION_TURN_CHARS_MAX = 4_000;

/** The conversation before this message, as the prompt's DATA. */
export function earlierTurns(
  history: readonly QConversationMessage[],
  latestId: string,
): readonly { readonly role: "USER" | "Q"; readonly content: string }[] {
  return history
    .filter((message) => message.id !== latestId)
    .flatMap((message) =>
      (message.role === "USER" || message.role === "Q") &&
      message.content.trim().length > 0
        ? [
            {
              role: message.role,
              content: message.content.slice(0, CONVERSATION_TURN_CHARS_MAX),
            },
          ]
        : [],
    )
    .slice(-CONVERSATION_TURNS_MAX);
}

/**
 * What a person reads when the specialist could not produce findings.
 *
 * Plain English, and specific enough to be useful without naming a
 * provider, a schema, a policy code or a table (§105). "No eligible route"
 * is deliberately not phrased as an outage: refusing to send private
 * material to an unsuitable provider is Capital Q working, not failing.
 */
function publicBlockedMessage(
  reason: NonNullable<CompanyIntelligenceResult["blocked"]>,
): string {
  switch (reason) {
    case "NO_AUTHORISED_SUBJECT":
      return "I don't have access to that company's information in this conversation, so I can't analyse it.";
    case "NO_ELIGIBLE_MODEL_ROUTE":
      return "Some of the information involved is too sensitive to send for analysis with the options available right now, so I've stopped rather than work around it. I can still answer from what's already recorded if you'd like to ask something narrower.";
    case "MODEL_UNAVAILABLE":
      return "I couldn't get a full review through just now. I can still answer from what's already recorded, read a website you point me at, or you can ask again in a moment.";
    case "MODEL_OUTPUT_REJECTED":
      return "I couldn't put together a reliable answer from the available information this time.";
    case "CANCELLED":
      return "I stopped before finishing that analysis.";
  }
}

/**
 * A last-resort answer built from findings alone, for the case where the
 * model produced findings but no usable prose.
 *
 * Deterministic and dull on purpose: it is better for Q to state what it
 * found in flat sentences than to say nothing, and better still that this
 * path is obviously not the normal one.
 */
function synthesisFromFindings(result: CompanyIntelligenceResult): string {
  const lines: string[] = [];
  const byType = (type: string): readonly string[] =>
    result.findings
      .filter((finding) => finding.type === type)
      .map((finding) => `- ${finding.statement}`);
  const sections: readonly (readonly [string, readonly string[]])[] = [
    ["What the evidence shows", [...byType("FACT"), ...byType("OBSERVATION")]],
    ["What looks strong", byType("STRENGTH")],
    ["What needs attention", byType("RISK")],
    ["What is uncertain", byType("UNCERTAINTY")],
    ["What we don't know", byType("GAP")],
  ];
  for (const [heading, items] of sections) {
    if (items.length > 0) {
      lines.push(`**${heading}**`, ...items, "");
    }
  }
  return lines.length === 0
    ? "I don't have enough information about this company to say anything useful yet."
    : lines.join("\n").trim();
}

export function createSpecialistQAnswer(
  dependencies: SpecialistQAnswerDependencies,
): SpecialistQAnswer {
  const {
    specialist,
    delegate,
    repositories,
    sql,
    transactions,
    artifacts,
    logger,
    turns,
  } = dependencies;
  let last: CompanyIntelligenceResult | null = null;

  /**
   * The conversation core's state per conversation (CQ-QX-005): what has
   * failed and how often. In memory and bounded — it is conversational
   * texture, not a record; a restart forgets a count, never a fact.
   */
  const conversations = new Map<string, ConversationState>();
  /** Declared actions waiting on the person's reply, per conversation. */
  const pendingActions = pendingAppActionStore(dependencies.pendingAppActions);
  /** A port result said as the answer: a line, a card, or a question that waits. */
  /**
   * The last action Q took or tried per conversation (follow-55), so "try
   * again" and "same for X" bind to it. In memory and bounded like the
   * rest of the core's state: a restart forgets it, never a fact.
   */
  const lastActed = new Map<string, LastAction>();
  /** What each run's person said, for the action a run notes. */
  const saidInRun = new Map<string, string>();
  const noteAction = (
    request: QAnswerRequest,
    conversationId: string,
    action: {
      readonly tool: string;
      readonly arguments: Readonly<Record<string, unknown>> | null;
    },
    outcome: LastAction["outcome"],
    utterance?: string,
  ): void => {
    const said = utterance ?? saidInRun.get(request.runId);
    if (said === undefined) return;
    lastActed.delete(conversationId);
    lastActed.set(conversationId, {
      tool: action.tool,
      arguments: action.arguments,
      utterance: said,
      outcome,
    });
    while (lastActed.size > MAX_CONVERSATIONS) {
      const oldest = lastActed.keys().next().value;
      if (oldest === undefined) break;
      lastActed.delete(oldest);
    }
  };
  const saidByAction = async (
    request: QAnswerRequest,
    conversationId: QConversationMessage["conversationId"],
    action: TurnAppAction,
    said: string | QAppActionPrepared | QAppActionAsks,
  ): Promise<QAnswerOutcome> => {
    noteAction(
      request,
      conversationId,
      action,
      typeof said === "string"
        ? "SAID"
        : "asks" in said
          ? "WAITING"
          : "PREPARED",
    );
    if (typeof said === "string") {
      return recordAnswer(request, conversationId, said);
    }
    if ("asks" in said) {
      await pendingActions.hold(
        { tenantId: request.tenantId, conversationId },
        { action, needs: said.needs },
      );
      return recordAnswer(request, conversationId, said.asks);
    }
    return preparedForEngine(request, said.prepared);
  };
  const MAX_CONVERSATIONS = 500;
  const remember = (conversationId: string, state: ConversationState) => {
    conversations.delete(conversationId);
    conversations.set(conversationId, state);
    if (conversations.size > MAX_CONVERSATIONS) {
      const oldest = conversations.keys().next().value;
      if (oldest !== undefined) conversations.delete(oldest);
    }
  };
  /** A failed run's notice, held until the orchestrator reads it once. */
  const notices = new Map<string, string>();

  /** Which subsystem a failed answer failed in, for the ledger. */
  const operationOf = (
    code: Extract<QAnswerOutcome, { kind: "FAILED" }>["diagnosticCode"],
  ): FailureOperation | null => {
    switch (code) {
      case "MODEL_PROVIDER_TIMEOUT":
      case "MODEL_PROVIDER_UNAVAILABLE":
      case "BUDGET_EXCEEDED":
        return "MODEL";
      case "TOOL_FAILED":
      case "RETRIEVAL_FAILED":
      case "EVIDENCE_PROCESSING_UNAVAILABLE":
        return "TOOL";
      // Cancellation, policy and invalid requests are not a subsystem
      // failing, and never earn a notice.
      case "INVALID_REQUEST":
      case "SUBJECT_NOT_RESOLVED":
      case "CONTEXT_RESOLUTION_FAILED":
      case "POLICY_DENIED":
      case "APPROVAL_EXPIRED":
      case "RUN_CANCELLED":
      case "RUN_EXPIRED":
      case "INTERNAL_ERROR":
        return null;
    }
  };

  /** Approved progress only; best effort, never a reason to fail the answer. */
  async function showStage(
    request: QAnswerRequest,
    stage: QVisibleStage,
  ): Promise<void> {
    try {
      await transactions.run((tx) =>
        appendRunEvent(
          repositories,
          tx,
          { id: request.runId, tenantId: request.tenantId },
          { type: "q.stage.changed", data: { stage } },
        ),
      );
    } catch (error: unknown) {
      logger?.warn(
        { err: error, qRunId: request.runId },
        "q specialist stage event not recorded",
      );
    }
  }

  /** A Q message and its durable completion event, committed together. */
  async function recordAnswer(
    request: QAnswerRequest,
    conversationId: QConversationMessage["conversationId"],
    content: string,
    blocks?: readonly QResultBlock[],
  ): Promise<QAnswerOutcome> {
    const message = await transactions.run(async (tx) => {
      const stored = await repositories.messages.insert(tx, {
        tenantId: request.tenantId,
        conversationId,
        runId: request.runId,
        role: "Q",
        content,
        ...(blocks === undefined ? {} : { blocks }),
      });
      await appendRunEvent(
        repositories,
        tx,
        { id: request.runId, tenantId: request.tenantId },
        {
          type: "q.message.completed",
          data: {
            message: {
              ...(toQMessage(stored) as QResponseMessage),
              ...(blocks === undefined ? {} : { blocks: [...blocks] }),
            },
          },
        },
      );
      return stored;
    });
    return {
      kind: "ANSWERED",
      messageId: message.id,
      modelPolicyVersion: "none",
      promptBundleVersion: "none",
    };
  }

  /**
   * "Make me a deck on X", done rather than described (CQ-QACT-002).
   *
   * The chain is the platform's, run to the end without asking permission
   * for any step, because every step is a safe internal action: read what
   * Capital Q holds or what the public web says, reconcile it into typed
   * findings (the specialist's own validation — a finding cites a source
   * or is dropped), compose the document, file it as a private artifact
   * of the person's organisation. Nothing is sent to anybody and nothing
   * in anybody's record changes, which is why none of it waits for
   * approval. What is not known goes into the document as not known.
   *
   * The reply is the result, briefly: the person asked for a document,
   * not for an account of one.
   */
  /**
   * The person's own record a name the reader heard refers to, if any
   * (founder live 2026-09-27, failure 6). Read only when a name was heard;
   * a failed read resolves nothing and the name is used as heard.
   */
  async function ownRecordFor(
    request: QAnswerRequest,
    heard: string | null,
  ): Promise<(OwnRecordMatch & { readonly companyId: string | null }) | null> {
    const port = dependencies.ownRecords;
    if (heard === null || port === undefined) return null;
    const records = await port.read(request).catch((error: unknown) => {
      if (request.signal?.aborted === true) throw error;
      logger?.warn(
        { err: error, qRunId: request.runId },
        "the person's own records were not read to resolve a name",
      );
      return NO_OWN_RECORDS;
    });
    const match = resolveOwnRecord(heard, records);
    if (match === null) return null;
    if (!match.exact) {
      logger?.info(
        { qRunId: request.runId, resolvedTo: match.kind },
        "a name the person said resolved to one of their own records",
      );
    }
    return { ...match, companyId: records.company?.companyId ?? null };
  }

  async function prepareDocument(
    request: QAnswerRequest,
    history: readonly QConversationMessage[],
    ask: {
      readonly documentType: "PITCH_DECK" | "INVESTMENT_BRIEF";
      readonly subjectName: string | null;
    },
  ): Promise<{
    readonly content: string;
    readonly blocks?: readonly QResultBlock[] | undefined;
  }> {
    const noun = ask.documentType === "PITCH_DECK" ? "deck" : "brief";
    const record = request.subjects.find(
      (subject): subject is Extract<typeof subject, { kind: "COMPANY" }> =>
        subject.kind === "COMPANY",
    );
    // The name the reader heard, checked against the person's own records
    // before anything else: their own company named (or misheard) is their
    // own company, and research uses the name as recorded.
    const mine = await ownRecordFor(request, ask.subjectName);
    const ownCompany =
      mine !== null &&
      record !== undefined &&
      (mine.kind === "OWN_COMPANY" ||
        (mine.kind === "OWN_PERSON" && mine.companyId !== null)) &&
      mine.companyId === record.companyId;
    const subjectName = ownCompany
      ? null
      : (mine?.recordedName ?? ask.subjectName);
    // Asked for again: the one already made.
    const existing = existingDocumentCard({
      history,
      documentType: ask.documentType,
      subjectName,
    });
    if (existing !== null) {
      return {
        // Every artifact downloads as a PDF from its card (BIZ-001), so
        // "give me the PDF of my brief" is answered with the file too.
        content: "Here it is. The PDF is one tap away on the card.",
        blocks: [existing],
      };
    }
    const latest = [...history].reverse().find((m) => m.role === "USER");
    const said = latest?.content ?? "";
    const personsWords = personsRecentWords(history);
    if (subjectName === null && record === undefined) {
      return { content: `Which company should the ${noun} be about?` };
    }
    if (
      subjectName !== null &&
      mine === null &&
      !namedByPerson(subjectName, personsWords)
    ) {
      // The reader named a company the person never did, and it is none
      // of theirs.
      return { content: `Which company should the ${noun} be about?` };
    }

    const context = {
      actor: request.actor,
      runId: request.runId,
      correlationId: request.correlationId,
      capability: request.capability,
      plan: request.plan,
      ...(request.signal === undefined ? {} : { signal: request.signal }),
      showStage: (stage: QVisibleStage) => showStage(request, stage),
    };
    const investigatePublic = (name: string) =>
      specialist.investigate(
        {
          company: { kind: "PUBLIC_COMPANY", name },
          // The person's own recent words: what the search may be built
          // from, and what the findings are read against. A name resolved
          // to one of their own records travels as recorded: it is their
          // own identity, and the misheard form names nobody.
          question:
            mine === null
              ? personsWords
              : `${personsWords}\n${mine.recordedName}`,
          publicResearch: true,
        },
        context,
      );

    let result: CompanyIntelligenceResult;
    let subject: typeof record;
    if (record !== undefined) {
      const onRecord = await specialist.investigate(
        { company: record, question: said, publicResearch: true },
        context,
      );
      // Their company, unless they named another one.
      const theirs =
        subjectName === null ||
        (onRecord.companyName !== null &&
          onRecord.companyName !== undefined &&
          sameCompanyName(onRecord.companyName, subjectName));
      if (theirs) {
        result = onRecord;
        subject = record;
      } else {
        result = await investigatePublic(subjectName);
        subject = undefined;
      }
    } else {
      result = await investigatePublic(subjectName ?? "");
      subject = undefined;
    }
    last = result;
    if (result.blocked === "CANCELLED") {
      return { content: `I stopped before the ${noun} was ready.` };
    }
    if (result.blocked !== null) {
      return { content: publicBlockedMessage(result.blocked) };
    }

    const name = result.companyName ?? subjectName ?? "your company";
    const preparation = await prepareOrReviseArtifact({
      artifacts: artifacts as ArtifactPreparation,
      request,
      company: subject,
      companyName: name,
      saidVerbatim: said,
      showStage: (stage) => showStage(request, stage),
      // The reading decided this is a request to prepare; a model's own
      // field (which may be empty for an impatient "just do it") does not
      // get to overrule it. How it should look is still the model's read.
      result: {
        ...result,
        artifactRequest: {
          kind: "PREPARE",
          artifactType: ask.documentType,
          instruction: said.slice(0, 2_000),
          visualDirection: result.artifactRequest?.visualDirection ?? null,
          quote: said.slice(0, 400),
        },
      },
      history,
      ...(logger === undefined ? {} : { logger }),
    });
    const sources = result.research?.sourceCount ?? 0;
    switch (preparation.kind) {
      case "PREPARED": {
        const card: QResultBlock = {
          kind: "ARTIFACT_REFERENCE",
          artifactId: preparation.summary.artifactId,
          type: preparation.summary.type,
          status: preparation.summary.status,
          title: preparation.summary.title,
        };
        const origin =
          subject === undefined
            ? ` Built from ${String(sources)} public source${sources === 1 ? "" : "s"}; what they don't say is marked as not known inside it.`
            : "";
        const pdf =
          ask.documentType === "PITCH_DECK"
            ? " Download the PDF or PowerPoint from the card."
            : " Download the PDF from the card.";
        return {
          content: `Here's the ${noun} for ${name}.${origin}${pdf}`,
          blocks: [card],
        };
      }
      case "THIN_RECORD":
        return {
          content:
            subject === undefined
              ? sources === 0
                ? `I couldn't find public sources on ${name}, so there is nothing to build a ${noun} from. If you have a website or a document for it, give me that and I'll build it from there.`
                : `The public sources I found on ${name} don't say enough about the company to fill a ${noun}. If you have a website or a document for it, give me that and I'll build it from there.`
              : `There isn't enough on record about the company yet to build a ${noun} worth sending. Add your deck or model on your company page, or tell me what you do, for whom, and the traction so far, and I'll build it from that.`,
        };
      case "FAILED":
      case "NOT_ASKED":
        return {
          content: `The ${noun} didn't come through just now, and nothing was saved. Ask again and I'll retry.`,
        };
    }
  }

  /**
   * A document of the person's own mandate, from their record (gap 3).
   * Composed by code from what they declared, filed as their private
   * artifact; a mandate still being defined is filed and named as a draft.
   * It exports as a PDF like every artifact (BIZ-001).
   */
  async function prepareOwnMandate(
    request: QAnswerRequest,
    preparation: ArtifactPreparation,
  ): Promise<DocumentReply> {
    const port = dependencies.ownMandate;
    const record = port === undefined ? null : await port.read(request);
    if (record === "NOT_AN_INVESTOR") {
      return {
        content:
          "A mandate document is for an investor's own mandate, and there isn't one set up for you here.",
      };
    }
    const document =
      record === null ? null : composeOwnMandateDocument(record, port?.labels);
    if (document === null) {
      return {
        content:
          "There's no mandate on your record yet, so there's nothing to put in a document. Set it up with me and I'll make it.",
      };
    }
    await showStage(request, "PREPARING_DOCUMENT");
    try {
      const summary = await preparation.port.prepare({
        actorContext: request.actor,
        permittedContextPlan: request.plan,
        qRunId: request.runId,
        artifactType: OWN_MANDATE_ARTIFACT_TYPE,
        content: {
          title: document.title,
          summary: document.summary,
          content: document.content,
        },
      });
      return {
        content: document.draft
          ? "Here's your mandate as it stands. It's marked as a draft because it isn't confirmed yet. Download the PDF from the card."
          : "Here's your mandate. Download the PDF from the card.",
        blocks: [
          {
            kind: "ARTIFACT_REFERENCE",
            artifactId: summary.artifactId,
            type: summary.type,
            status: summary.status,
            title: summary.title,
          },
        ],
      };
    } catch (error: unknown) {
      if (request.signal?.aborted === true) throw error;
      logger?.warn(
        { err: error, qRunId: request.runId },
        "the mandate document could not be filed",
      );
      return {
        content:
          "I couldn't prepare your mandate document just now. Ask me again in a moment and I'll make it.",
      };
    }
  }

  /**
   * One of Q's answers filed as a document with a PDF (founder live
   * 2026-09-28 #1), exactly as written: see answer-document.ts.
   */
  async function fileAnswer(
    request: QAnswerRequest,
    preparation: ArtifactPreparation,
    answer: string,
    question: string | undefined,
  ): Promise<DocumentReply> {
    const document = composeAnswerDocument({ answer, question });
    if (document === null) {
      return {
        content:
          "There's no written answer here yet to put in a document. Ask me what you want it to say and I'll write it and make the PDF.",
      };
    }
    await showStage(request, "PREPARING_DOCUMENT");
    try {
      const summary = await preparation.port.prepare({
        actorContext: request.actor,
        permittedContextPlan: request.plan,
        qRunId: request.runId,
        artifactType: ANSWER_DOCUMENT_ARTIFACT_TYPE,
        content: {
          title: document.title,
          summary: document.summary,
          content: document.content,
        },
      });
      return {
        content: "Here it is as a document. Download the PDF from the card.",
        blocks: [
          {
            kind: "ARTIFACT_REFERENCE",
            artifactId: summary.artifactId,
            type: summary.type,
            status: summary.status,
            title: summary.title,
          },
        ],
      };
    } catch (error: unknown) {
      if (request.signal?.aborted === true) throw error;
      logger?.warn(
        { err: error, qRunId: request.runId },
        "an answer could not be filed as a document",
      );
      return {
        content:
          "I couldn't make the document just now. Ask me again in a moment and I'll make it.",
      };
    }
  }

  /**
   * The answer Q gave before this turn, and what it answered: the one a
   * "put that in a PDF" means.
   */
  function previousAnswer(
    history: readonly QConversationMessage[],
  ): { readonly answer: string; readonly question?: string } | null {
    const latestUser = history.findLastIndex((m) => m.role === "USER");
    const before = latestUser < 0 ? history : history.slice(0, latestUser);
    const at = before.findLastIndex(
      (m) => m.role === "Q" && m.content.trim().length > 0,
    );
    if (at < 0) return null;
    const answer = before[at];
    if (answer === undefined) return null;
    const asked = before.slice(0, at).findLast((m) => m.role === "USER");
    return {
      answer: answer.content,
      ...(asked === undefined ? {} : { question: asked.content }),
    };
  }

  /**
   * After a Q_REPORT's answer is written: file it as a document and say
   * so in one short follow-up with its card, together with any other
   * document asked for in the same message. The answer stays the answer;
   * the follow-up is the file. A failure here never unsays the answer.
   */
  async function fileWrittenAnswer(
    request: QAnswerRequest,
    conversationId: QConversationMessage["conversationId"],
    outcome: Extract<QAnswerOutcome, { kind: "ANSWERED" }>,
    others: readonly TurnToolV14[],
  ): Promise<void> {
    if (artifacts === undefined || outcome.messageId === null) return;
    try {
      const history =
        await repositories.messages.listRecentForConversationOfRun(
          sql,
          request.tenantId,
          request.runId,
          64,
        );
      const at = history.findIndex((m) => m.id === outcome.messageId);
      const written = history[at];
      const asked =
        at < 0
          ? undefined
          : history.slice(0, at).findLast((m) => m.role === "USER");
      const replies: DocumentReply[] = [
        written === undefined
          ? {
              content:
                "I couldn't make the document just now. Ask me to put that answer in a PDF and I'll make it.",
            }
          : await fileAnswer(
              request,
              artifacts,
              written.content,
              asked?.content,
            ),
      ];
      for (const other of others) {
        const reply = await documentReply(request, other, history);
        if (reply !== null) replies.push(reply);
      }
      const blocks = replies.flatMap((reply) => reply.blocks ?? []);
      await recordAnswer(
        request,
        conversationId,
        replies.map((reply) => reply.content).join("\n\n"),
        blocks.length === 0 ? undefined : blocks,
      );
    } catch (error: unknown) {
      if (request.signal?.aborted === true) throw error;
      logger?.warn(
        { err: error, qRunId: request.runId },
        "a written answer could not be filed as a document",
      );
    }
  }

  /**
   * One requested document, made (or why not, said plainly). Null: this
   * seam is not composed to make that kind of document.
   */
  async function documentReply(
    request: QAnswerRequest,
    tool: TurnToolV14,
    history: readonly QConversationMessage[],
  ): Promise<DocumentReply | null> {
    if (tool.kind !== "PREPARE_DOCUMENT" || artifacts === undefined) {
      return null;
    }
    if (tool.documentType === "OWN_MANDATE") {
      if (dependencies.ownMandate === undefined) return null;
      return prepareOwnMandate(request, artifacts);
    }
    if (tool.documentType === "ANSWER_EXPORT") {
      const previous = previousAnswer(history);
      if (previous === null) {
        return {
          content:
            "I haven't answered anything in this conversation yet, so there's nothing to put in a document. Ask me what you want it to say and I'll write it and make the PDF.",
        };
      }
      return fileAnswer(request, artifacts, previous.answer, previous.question);
    }
    // A Q_REPORT is written by the answer first (answerThenFile).
    if (tool.documentType === "Q_REPORT") return null;
    const companyDocument =
      tool.documentType === "PITCH_DECK" ||
      tool.documentType === "INVESTMENT_BRIEF"
        ? tool.documentType
        : null;
    if (companyDocument === null) return null;
    const noun = companyDocument === "PITCH_DECK" ? "deck" : "brief";
    try {
      return await prepareDocument(request, history, {
        documentType: companyDocument,
        subjectName: tool.subjectName,
      });
    } catch (error: unknown) {
      if (request.signal?.aborted === true) throw error;
      // Asked for a document and not given one: said so, by name, never
      // answered as if nothing had been asked (B1).
      logger?.warn(
        {
          err: error,
          qRunId: request.runId,
          documentType: tool.documentType,
        },
        "a document Q was asked for could not be prepared",
      );
      return {
        content: `I couldn't prepare the ${noun} just now. Ask me again in a moment and I'll make it.`,
      };
    }
  }

  /**
   * Every document the turn asked for, each made in turn, answered in one
   * message with each card (founder live 2026-09-27, failure 7: "a PDF of
   * my mandate AND a PPTX deck" made neither). The same document asked
   * twice is made once. Null: none of them is something this seam makes.
   */
  async function actOnDocuments(
    request: QAnswerRequest,
    conversationId: QConversationMessage["conversationId"],
    tools: readonly TurnToolV14[],
    history: readonly QConversationMessage[],
  ): Promise<QAnswerOutcome | null> {
    const seen = new Set<string>();
    const replies: DocumentReply[] = [];
    for (const tool of tools) {
      const key = `${tool.documentType ?? ""}:${tool.subjectName?.toLowerCase() ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const reply = await documentReply(request, tool, history);
      if (reply !== null) replies.push(reply);
    }
    if (replies.length === 0) return null;
    const blocks = replies.flatMap((reply) => reply.blocks ?? []);
    return recordAnswer(
      request,
      conversationId,
      replies.map((reply) => reply.content).join("\n\n"),
      blocks.length === 0 ? undefined : blocks,
    );
  }

  /**
   * One of Q's own hands, from the turn's reading (CQ-QACT-001).
   *
   * NAVIGATE: the message carries a UI_INTENT the screen follows through
   * its one route map — the same destinations voice uses — and nothing
   * else happens; a surface this run has no subject for is not offered.
   *
   * SET_VISIBILITY: the reading is handed to the proposer, for the company
   * this run is about and nothing else; the message says what the change
   * means and claims nothing. The Approval Engine prepares it, the action
   * port says so from the record, and the person's yes executes it
   * through the companies context — the capability the Visibility screen
   * calls. Null: not something this seam performs; answer normally.
   */
  async function actOnTool(
    request: QAnswerRequest,
    conversationId: QConversationMessage["conversationId"],
    tool: TurnToolV14,
    history: readonly QConversationMessage[],
    /** The screens this run can open, from the capability registry. */
    navigable: readonly QNavigateDestination[],
    moreDocuments: readonly TurnToolV14[] = [],
    /** The answer can open one record's page itself (open_page). */
    opensRecords = false,
  ): Promise<QAnswerOutcome | null> {
    const company = request.subjects.find(
      (subject) => subject.kind === "COMPANY",
    );
    if (tool.kind === "PREPARE_DOCUMENT") {
      return actOnDocuments(
        request,
        conversationId,
        [tool, ...moreDocuments],
        history,
      );
    }
    if (tool.kind === "NAVIGATE" && tool.unknownScreen !== null) {
      // Founder report 2026-09-30: "open my chat with young field agro"
      // was read as an unknown screen and answered here, before the tools
      // that find the record could run. When the answer can open a record
      // itself, it answers: it finds the name among their own records and
      // opens it, or says the screen does not exist.
      if (opensRecords) return null;
      logger?.info(
        { qRunId: request.runId, nearest: tool.unknownScreen.nearest },
        "q was asked for a screen Capital Q does not have",
      );
      return recordAnswer(
        request,
        conversationId,
        unknownScreenLine(
          tool.unknownScreen.named,
          tool.unknownScreen.nearest,
          navigable,
        ),
      );
    }
    if (tool.kind === "NAVIGATE" && tool.destination !== null) {
      const destination = tool.destination;
      if (destination === "COMPANY_VISIBILITY" && company === undefined) {
        return null;
      }
      logger?.info(
        { qRunId: request.runId, destination },
        "q is taking the person to a screen",
      );
      return recordAnswer(
        request,
        conversationId,
        naturalPlaceLine(DESTINATION_LINES[destination], askedIn(history)),
        [{ kind: "UI_INTENT", intent: { kind: "NAVIGATE", destination } }],
      );
    }
    if (
      tool.kind === "SET_VISIBILITY" &&
      tool.visibility !== null &&
      dependencies.visibility !== undefined
    ) {
      if (company === undefined || company.kind !== "COMPANY") {
        return recordAnswer(
          request,
          conversationId,
          "I can change who sees a company once it's set up on Capital Q, and there isn't one in this conversation yet.",
        );
      }
      dependencies.visibility.noteVisibility({
        runId: request.runId,
        tenantId: request.tenantId,
        companyId: company.companyId,
        visibility: tool.visibility,
      });
      logger?.info(
        { qRunId: request.runId, visibility: tool.visibility },
        "visibility change read from the person's words; handed to the proposer",
      );
      return recordAnswer(
        request,
        conversationId,
        VISIBILITY_EXPLANATIONS[tool.visibility],
      );
    }
    return null;
  }

  /**
   * One turn, read and then answered (CQ-QX-005).
   *
   * The reading starts now and runs alongside the answer's own context
   * assembly; the answer path awaits it only where research is decided.
   * What the turn turned out to be decides whether the public web may be
   * read; how the answer ended is noted against the conversation, so a
   * failing subsystem is named once and never in the same words twice.
   */
  /**
   * What this run can do beyond the model's tools, from what is composed
   * here and what the plan holds (CQ-QX-008). Built by code, so Q can
   * neither deny a capability it has nor claim one it has not.
   */
  const capabilitiesOf = async (
    request: QAnswerRequest,
  ): Promise<readonly QCapability[]> => {
    const offeredTools =
      dependencies.offeredTools === undefined
        ? []
        : await dependencies.offeredTools(request).catch(() => []);
    return eligibleCapabilities({
      surface: "HOME_Q",
      offeredTools: new Set(offeredTools),
      company: request.subjects.some((subject) => subject.kind === "COMPANY"),
      ownInvestorOrganisation: ownInvestorOrganisationIn(request.plan) !== null,
      artifacts: artifacts !== undefined,
      ownMandate: dependencies.ownMandate !== undefined,
      visibility: dependencies.visibility !== undefined,
    });
  };
  /** The manifest the answer's note renders, from the registry's hands. */
  const manifestOf = (
    capabilities: readonly QCapability[],
  ): QCapabilityManifest => {
    const hands = capabilities.flatMap((capability) =>
      capability.performedBy.kind === "HAND"
        ? [capability.performedBy.hand]
        : [],
    );
    return {
      navigate: hands.flatMap((hand) =>
        hand.kind === "NAVIGATE" ? [hand.destination] : [],
      ),
      documents: hands.flatMap((hand) =>
        hand.kind === "PREPARE_DOCUMENT" ? [hand.documentType] : [],
      ),
      visibilityChange: hands.some((hand) => hand.kind === "SET_VISIBILITY"),
      // R33: what only the person can do, with the screen that has it.
      offers: capabilities.flatMap((capability) =>
        capability.performedBy.kind === "OFFER"
          ? [
              {
                does: capability.does,
                destination: capability.performedBy.offer.destination,
              },
            ]
          : [],
      ),
    };
  };

  /**
   * voice-cards: a page, a Settings section or a card on screen, opened by
   * code from the person's own words (page-request.ts). Null when the
   * words are not such a request, or name a screen this run cannot open.
   */
  const pageAnswer = (
    text: string,
    history: readonly QConversationMessage[],
    capabilities: readonly QCapability[],
  ): {
    readonly said: string;
    readonly blocks: readonly QResultBlock[];
    readonly log: string;
  } | null => {
    const navigable = manifestOf(capabilities).navigate;
    if (navigable.length === 0) return null;
    const position = ordinalOf(text);
    if (position !== null) {
      const block = cardsOnScreen(history);
      const card = block === null ? null : cardAt(block, position);
      if (card?.subject?.kind !== "COMPANY") return null;
      const blocks: QResultBlock[] = [
        {
          kind: "UI_INTENT",
          intent: {
            kind: "OPEN_RECORD_PAGE",
            page: "COMPANY",
            id: card.subject.companyId,
          },
        },
      ];
      // "Tell me about the third company": talked about from its card
      // (what they do, stage, raise, fit and why, one unknown), and opened
      // -- never only `Opening "Tensorgate".` (founder live 2026-10-08).
      const opening = openingLine("COMPANY", card.name);
      const facts = spokenFactsOf({
        asked: text,
        text: opening,
        blocks,
        shown: [card],
      });
      return {
        said: facts?.fallback ?? opening,
        blocks,
        log: `CARD_${String(position)}`,
      };
    }
    const asked = pageRequestOf(text);
    if (asked === null) return null;
    if (asked.kind === "UNKNOWN") {
      return { said: cannotOpenLine(asked.named), blocks: [], log: "UNKNOWN" };
    }
    const target = asked.target;
    if (target.kind === "SETTINGS") {
      if (!navigable.includes("SETTINGS")) return null;
      return {
        said: "Opening Settings.",
        blocks: [
          {
            kind: "UI_INTENT",
            intent: { kind: "OPEN_SETTINGS", section: target.section },
          },
        ],
        log: `SETTINGS_${target.section}`,
      };
    }
    if (!navigable.includes(target.destination)) return null;
    return {
      said: naturalPlaceLine(DESTINATION_LINES[target.destination], text),
      blocks: [
        {
          kind: "UI_INTENT",
          intent: { kind: "NAVIGATE", destination: target.destination },
        },
      ],
      log: target.destination,
    };
  };

  /**
   * RECOVERY-2026-10 (C, INC-1): a navigation request that names a record
   * (named-record-request.ts). Resolved against their own relationships
   * first; opened through open_page's own authorize step (so nothing they
   * could not open by hand ever opens); a name that means several of theirs,
   * or nothing they can open, gets one truthful line naming candidates.
   * Null: not such a request, or a plain-words name nothing of theirs
   * matches (the normal path answers it).
   */
  const namedRecordAnswer = async (
    request: QAnswerRequest,
    text: string,
  ): Promise<{
    readonly said: string;
    readonly blocks: readonly QResultBlock[];
    readonly log: string;
  } | null> => {
    const port = dependencies.openRecord;
    if (port === undefined) return null;
    // The same resolver the fast path runs at the end of the utterance
    // (fast-navigation.ts), so the screen and the answer agree on the
    // target; the screen dedupes the second move.
    const resolved = await resolveNamedRecord({
      text,
      side:
        ownInvestorOrganisationIn(request.plan) !== null
          ? "INVESTOR"
          : "FOUNDER",
      counterpartNames: () =>
        dependencies.counterpartNames?.(request) ?? Promise.resolve([]),
      open: (page, name) => port.open(request, { page, name }),
    });
    if (resolved === null) return null;
    return resolved.kind === "OPEN"
      ? {
          said: resolved.said,
          blocks: [{ kind: "UI_INTENT", intent: resolved.intent }],
          log: `${resolved.own ? "OWN" : "REACHABLE"}_${resolved.page}`,
        }
      : { said: resolved.said, blocks: [], log: resolved.log };
  };

  /** B6: the reference each run's words were bound to, for its answer. */
  const resolvedInRun = new Map<string, string>();
  const withReferences = (request: QAnswerRequest): QAnswerRequest => {
    const note = resolvedInRun.get(request.runId);
    return note === undefined || request.references !== undefined
      ? request
      : { ...request, references: note };
  };
  const openPointedRecord = (
    text: string,
    pointed: PointedAt,
    capabilities: readonly QCapability[],
  ): {
    readonly said: string;
    readonly blocks: readonly QResultBlock[];
  } | null => {
    if (manifestOf(capabilities).navigate.length === 0) return null;
    const { ask, resolved } = pointed;
    if (ask?.kind !== "ORDINAL" || resolved?.kind !== "ONE") return null;
    // An open request ("open the second one") or a correction of what was
    // opened ("not that investor, the second one"); "explain the second
    // one" is a question, answered with the binding as a note instead.
    if (ordinalOf(text) === null && !ask.correction) return null;
    // Q's own company cards: the existing card path talks about the card.
    if (
      resolved.via === "Q_ANSWER" &&
      resolved.entity.kind === "COMPANY" &&
      !ask.correction
    ) {
      return null;
    }
    const page =
      resolved.entity.kind === "COMPANY"
        ? ("COMPANY" as const)
        : resolved.entity.kind === "INVESTOR_ORGANISATION"
          ? ("INVESTOR" as const)
          : null;
    if (page === null) return null;
    return {
      said: openingLine(page, resolved.entity.name ?? undefined),
      blocks: [
        {
          kind: "UI_INTENT",
          intent: { kind: "OPEN_RECORD_PAGE", page, id: resolved.entity.id },
        },
      ],
    };
  };

  /** Unclear turns in a row, per conversation (bounded with the rest). */
  const unclearInARow = new Map<string, number>();
  /** Runs answering their likely words (TURN_READER v44): never twice. */
  const reheard = new Set<string>();

  /**
   * A series of questions the person asked Q to put to them, per
   * conversation (R35). In memory and bounded like the rest of the core's
   * state: a restart forgets where a series was, never a fact.
   */
  const sequences = new Map<string, QuestionSequence>();
  /** The last turn's tool focus per conversation, bounded like the rest. */
  const focuses = new Map<string, QToolFocus>();

  /**
   * RECOVERY-2026-10 B3 (audit B-02): the core's state, kept durable when a
   * store is composed. Read once per conversation per process (memory is
   * the first read after that); written after every turn. A failed or slow
   * store leaves the turn on memory, never fails it.
   */
  const coreStore = dependencies.coreState;
  const hydrated = new Set<string>();
  const scopeOfRun = new Map<string, ConversationCoreScope>();
  const hydrate = async (scope: ConversationCoreScope): Promise<void> => {
    if (coreStore === undefined || hydrated.has(scope.conversationId)) return;
    hydrated.add(scope.conversationId);
    while (hydrated.size > MAX_CONVERSATIONS) {
      const oldest = hydrated.values().next().value;
      if (oldest === undefined) break;
      hydrated.delete(oldest);
    }
    const snapshot = readCoreSnapshot(
      await loadWithin(coreStore.load(scope), CORE_LOAD_DEADLINE_MS),
    );
    if (snapshot === null) return;
    const id = scope.conversationId;
    // What this process already knows is newer than the stored copy.
    if (!unclearInARow.has(id) && snapshot.unclearInARow > 0) {
      unclearInARow.set(id, snapshot.unclearInARow);
    }
    if (!lastActed.has(id) && snapshot.lastAction !== null) {
      lastActed.set(id, snapshot.lastAction);
    }
    if (!sequences.has(id) && snapshot.sequence !== null) {
      sequences.set(id, snapshot.sequence);
    }
    if (!focuses.has(id) && snapshot.focus !== null) {
      focuses.set(id, snapshot.focus);
    }
  };
  const persistCore = async (runId: string): Promise<void> => {
    const scope = scopeOfRun.get(runId);
    scopeOfRun.delete(runId);
    if (coreStore === undefined || scope === undefined) return;
    const id = scope.conversationId;
    await coreStore
      .save(scope, {
        v: 1,
        unclearInARow: unclearInARow.get(id) ?? 0,
        lastAction: lastActed.get(id) ?? null,
        sequence: sequences.get(id) ?? null,
        focus: focuses.get(id) ?? null,
      })
      .catch((error: unknown) => {
        logger?.warn(
          { err: error, qRunId: runId },
          "the conversation core's state was not saved; memory keeps it",
        );
      });
  };
  const keepSequence = (
    conversationId: string,
    next: QuestionSequence | null,
  ) => {
    sequences.delete(conversationId);
    if (next === null) return;
    sequences.set(conversationId, next);
    if (sequences.size > MAX_CONVERSATIONS) {
      const oldest = sequences.keys().next().value;
      if (oldest !== undefined) sequences.delete(oldest);
    }
  };

  /**
   * The actions each conversation's reader was last given, so an early
   * reading (ADR 0035) can be made before this turn's plan exists and
   * checked against it afterwards. Tool names and what they do: Capital
   * Q's own vocabulary, not anyone's data.
   */
  const lastActions = new Map<string, string>();
  /** Early readings by run, bounded; dropped on refusal or when unused. */
  type EarlyReading = {
    readonly messageId: string;
    readonly actionsKey: string;
    readonly reading: Promise<Awaited<ReturnType<QTurnReader["read"]>> | null>;
  };
  const prereads = new Map<string, Promise<EarlyReading | null>>();
  const PREREADS_MAX = 64;

  /**
   * The turn is about someone across a relationship: a company subject on
   * an investor's run (their own organisation bound in the plan), or a
   * request to act that names one of their relationships' counterparts,
   * matched by the same name matcher every reference uses. Read only for a
   * request to act, and never a reason to show anything: it brings the
   * Relationships area's actions into the offer, which authorize decides.
   */
  const aboutCounterparty = async (
    request: QAnswerRequest,
    utterance: string,
    read: { readonly kind: string } | null,
  ): Promise<boolean> => {
    if (read?.kind !== "TOOL_REQUEST") return false;
    if (
      ownInvestorOrganisationIn(request.plan) !== null &&
      request.subjects.some((subject) => subject.kind === "COMPANY")
    ) {
      return true;
    }
    const names = await (
      dependencies.counterpartNames?.(request) ?? Promise.resolve([])
    ).catch(() => []);
    if (names.length === 0) return false;
    return names.some((name) => namedInWords(utterance, name));
  };

  /**
   * The cards this turn handed to the engine, by run: the engine says
   * their status after the turn, so nothing here says it again (lead
   * 2026-10-03, runs 7468a83f, 7c39eed0: three lines for one card).
   */
  const preparedThisRun = new Map<string, string>();
  const preparedForEngine = (
    request: QAnswerRequest,
    summary: string,
  ): QAnswerOutcome => {
    preparedThisRun.set(request.runId, summary);
    while (preparedThisRun.size > PREREADS_MAX) {
      const oldest = preparedThisRun.keys().next().value;
      if (oldest === undefined) break;
      preparedThisRun.delete(oldest);
    }
    logger?.info(
      { qRunId: request.runId },
      "a change was prepared for approval; the engine says its status",
    );
    return {
      kind: "ANSWERED",
      messageId: null,
      modelPolicyVersion: "none",
      promptBundleVersion: "none",
    };
  };

  const preread = (input: QPrereadInput): void => {
    if (turns === undefined || prereads.has(input.runId)) return;
    const started = (async (): Promise<EarlyReading | null> => {
      // The run's own conversation, read as its owner: the same read the
      // answer makes, under the actor preflight has just checked.
      const history =
        await repositories.messages.listRecentForConversationOfRun(
          sql,
          input.tenantId,
          input.runId,
          64,
        );
      const conversationId = history[0]?.conversationId;
      const latest = [...history].reverse().find((m) => m.role === "USER");
      if (conversationId === undefined || latest === undefined) return null;
      // B5: a pleasantry is answered by code; its reading would be waste.
      if (pleasantryOf(latest.content) !== null) return null;
      const key = lastActions.get(conversationId);
      // A conversation's first turn has no known actions: read later.
      if (key === undefined) return null;
      const actions = JSON.parse(key) as ReaderAction[];
      const reading = turns
        .read(
          turnReaderInput(
            history,
            latest,
            actions,
            {
              tenantId: input.tenantId,
              userId: input.actor.userId,
              correlationId: input.correlationId,
              signal: input.signal,
            },
            referenceNote(
              shownItems(history),
              lastActed.get(conversationId) ?? null,
            ),
          ),
        )
        .catch(() => null);
      return { messageId: latest.id, actionsKey: key, reading };
    })().catch(() => null);
    // Registered at once, so a refusal that arrives first still drops it.
    prereads.set(input.runId, started);
    while (prereads.size > PREREADS_MAX) {
      const oldest = prereads.keys().next().value;
      if (oldest === undefined) break;
      prereads.delete(oldest);
    }
  };

  /** Lines of theirs that were not for Q, marked append-only (20261110030000). */
  const markNotForQ = async (
    request: QAnswerRequest,
    conversationId: string,
    messageIds: readonly string[],
  ): Promise<void> => {
    const mark = repositories.messages.mark;
    if (mark === undefined || messageIds.length === 0) return;
    try {
      await transactions.run((tx) =>
        mark(tx, {
          tenantId: request.tenantId,
          conversationId,
          messageIds,
          mark: "NOT_ADDRESSED_TO_Q",
          markedBy: "Q_READING",
          runId: request.runId,
        }),
      );
      logger?.info(
        { qRunId: request.runId, marked: messageIds.length },
        "lines not meant for Q kept out of what Q reads back",
      );
    } catch (error: unknown) {
      logger?.warn(
        { err: error, qRunId: request.runId },
        "lines not meant for Q were not marked",
      );
    }
  };

  /**
   * Open the one record the turn names or points at (follow-55), through
   * open_page's authorize step: their own documents, relationships and
   * what the network shows them, nothing else. Null: nothing of theirs
   * matched, and the turn is answered as before.
   */
  const openReferenced = async (
    request: QAnswerRequest,
    conversationId: QConversationMessage["conversationId"],
    reference: TurnReference,
    shown: ReturnType<typeof shownItems>,
    history: readonly QConversationMessage[],
  ): Promise<QAnswerOutcome | null> => {
    const port = dependencies.openRecord;
    if (port === undefined) return null;
    const side =
      ownInvestorOrganisationIn(request.plan) !== null ? "INVESTOR" : "FOUNDER";
    const target = openTarget(reference, shown, side);
    if (target === null) return null;
    for (const page of target.pages) {
      const intent = await port
        .open(request, { page, id: target.id, name: target.name })
        .catch(() => null);
      if (intent === null) continue;
      logger?.info(
        { qRunId: request.runId, page, byName: target.id === undefined },
        "q opened the record the turn pointed at",
      );
      remember(
        conversationId,
        reduceConversation(
          conversations.get(conversationId) ?? INITIAL_CONVERSATION_STATE,
          { type: "SUCCEEDED", operation: "TOOL" },
        ),
      );
      // Said from the card on screen when it is one (what they do, the
      // fit and why), else plainly ("Here's Tensorgate.").
      const opening = openingLine(page, target.name);
      const facts =
        page === "COMPANY"
          ? spokenFactsOf({
              asked: askedIn(history),
              text: opening,
              blocks: [{ kind: "UI_INTENT", intent }],
              shown: cardsOnScreen(history)?.cards ?? [],
            })
          : null;
      return recordAnswer(request, conversationId, facts?.fallback ?? opening, [
        { kind: "UI_INTENT", intent },
      ]);
    }
    logger?.info(
      { qRunId: request.runId, open: reference.open },
      "the record the turn pointed at is not one of theirs; answered instead",
    );
    return null;
  };

  /**
   * Q's last action again ("try again", "do it again", "same for X"):
   * the same declared action with the same inputs -- read again from what
   * they said then when they were never read -- through its own authorize
   * step and approval card. Null: it still cannot be done; answered.
   */
  const repeatLastAction = async (
    request: QAnswerRequest,
    conversationId: QConversationMessage["conversationId"],
    last: LastAction,
    sameFor: string | null,
  ): Promise<QAnswerOutcome | null> => {
    const actions = dependencies.appActions;
    if (actions === undefined) return null;
    let action = repeatedAction(last, sameFor);
    if (action === null && dependencies.appActionArguments !== undefined) {
      const said =
        sameFor === null
          ? last.utterance
          : `${last.utterance} (this time for ${sameFor})`;
      const args = await dependencies
        .appActionArguments(request, { tool: last.tool, utterance: said })
        .catch(() => null);
      action =
        args === null || args === undefined
          ? null
          : { tool: last.tool, arguments: args };
    }
    logger?.info(
      {
        qRunId: request.runId,
        tool: last.tool,
        was: last.outcome,
        sameFor: sameFor !== null,
        filled: action !== null,
      },
      "q repeats its last action",
    );
    if (action === null) return null;
    const said = await actions.run(request, action).catch(() => null);
    if (said === null) {
      noteAction(request, conversationId, action, "NOT_DONE", last.utterance);
      return null;
    }
    return saidByAction(request, conversationId, action, said);
  };

  const answerTurn = async (
    request: QAnswerRequest,
  ): Promise<QAnswerOutcome> => {
    // The conversational path's reads (conversation, context, tools, the
    // person's own facts) start now, beside the reading below; the answer
    // takes them up if the turn goes there (speed sweep 2026-10-01: the
    // reading's ~1 s and those reads' ~0.5-1 s ran one after the other).
    // RECOVERY B5: started once the conversation is read (one short DB
    // read later), so a pure pleasantry never pays for them.
    const history = await repositories.messages.listRecentForConversationOfRun(
      sql,
      request.tenantId,
      request.runId,
      64,
    );
    const conversationId = history[0]?.conversationId;
    const latest = [...history].reverse().find((m) => m.role === "USER");
    // RECOVERY B5 (audit B-05): "hi Q", "thanks", "how are you?" -- a turn
    // that is nothing but a pleasantry is answered by code: no reader, no
    // prefetch, no analyst. Spoken, only when it names Q or opens the
    // conversation, since words to the room are the reader's to judge.
    if (conversationId !== undefined && latest !== undefined) {
      const pleasantry = pleasantryOf(latest.content);
      const spokenTurn = latest.utteranceRef !== undefined;
      const opensConversation =
        history.filter((m) => m.role === "USER").length === 1;
      if (
        pleasantry !== null &&
        // A series of questions in hand reads every turn as its own.
        !sequences.has(conversationId) &&
        (!spokenTurn || NAMES_Q.test(latest.content) || opensConversation)
      ) {
        const lastQ = [...history].reverse().find((m) => m.role === "Q");
        logger?.info(
          { qRunId: request.runId, pleasantry },
          "q answered a pleasantry by code",
        );
        return recordAnswer(
          request,
          conversationId,
          pleasantryReply(pleasantry, request.runId, lastQ?.content ?? null),
        );
      }
    }
    delegate.warm?.(request);
    // What this run can do, read beside the conversation rather than after
    // it (latency2): the turn reader is told its actions, so the reading
    // could not start until both were in.
    const capabilitiesRead = capabilitiesOf(request);
    capabilitiesRead.catch(() => undefined);
    if (
      turns === undefined ||
      conversationId === undefined ||
      latest === undefined
    ) {
      return answerOnce(request);
    }
    // A change waiting for their decision is decided by code, from two
    // readings of their words, never by the answer's own tools: the turn's
    // (is this a reply to the card at all?) and the decision's (yes or
    // no?). Run 2026-10-03 ad0b0067: "We've decided not to proceed with
    // Ledgefold for now." -- a request in its own right -- approved and
    // executed the waiting pass. Only a reply decides.
    let afterAnswer: string | null = null;
    /** The card the after-answer line is about, when it is one. */
    let afterAbout: string | null = null;
    let afterAboutId: string | null = null;
    const pendingDecisions = dependencies.pendingDecisions;
    // Begun now, beside the turn reading (L1 latency sweep): the decision
    // reader's call no longer waits for the turn reader's; both are judged
    // together once the turn has been read, exactly as before.
    const pending =
      pendingDecisions === undefined
        ? undefined
        : startPendingDecision(
            pendingDecisions,
            {
              context: {
                actor: request.actor,
                runId: request.runId,
                correlationId: request.correlationId,
                tenantId: request.tenantId,
                userId: request.actor.userId,
              },
              utterance: latest.content,
              recentTurns: history
                .filter((m) => m.id !== latest.id)
                .slice(-6)
                .map((m) => ({
                  role: m.role === "USER" ? ("USER" as const) : ("Q" as const),
                  text: m.content,
                })),
              signal: request.signal,
            },
            { speculative: true },
          );
    let concluded = false;
    const decide =
      pending === undefined
        ? undefined
        : async (turn: PendingTurnReading | null): Promise<string | null> => {
            concluded = true;
            const decided = await pending
              .conclude(turn)
              .catch((error: unknown) => {
                logger?.warn(
                  { err: error, qRunId: request.runId },
                  "a decision on a waiting change was not read; answering normally",
                );
                return { kind: "NONE" } as const;
              });
            if (decided.kind === "REPLY") return decided.line;
            if (decided.kind === "ANSWER_THEN") {
              if (decided.before !== null) {
                await recordAnswer(request, conversationId, decided.before);
              }
              afterAnswer = decided.after;
              afterAbout = decided.about ?? null;
              afterAboutId = decided.aboutId ?? null;
            }
            return null;
          };
    // Decided after the turn is read (J7): whether the words are a reply
    // at all is the decision reader's and the turn reader's reading, never
    // a list of yes and no words. The two readings are made per turn.
    const decideAfterReading = decide;
    const speculative: { current: Speculation | null } = { current: null };
    // B3: the core's state as the last turn left it, on whichever instance.
    const coreScope = { tenantId: request.tenantId, conversationId };
    scopeOfRun.set(request.runId, coreScope);
    while (scopeOfRun.size > PREREADS_MAX) {
      const oldest = scopeOfRun.keys().next().value;
      if (oldest === undefined) break;
      scopeOfRun.delete(oldest);
    }
    await hydrate(coreScope);
    const outcome = await answerTurnRead(
      request,
      history,
      conversationId,
      latest,
      capabilitiesRead,
      speculative,
      decideAfterReading,
    ).finally(() => {
      // A path that never asked: the reading in flight is not wanted.
      if (!concluded) pending?.cancel();
      // Any path that did not adopt the speculation drops it (a no-op once
      // adopted): nothing of it is said, stored or done.
      speculative.current?.cancel("ACTED");
    });
    await persistCore(request.runId);
    // One status per card per answer: a card this turn handed to the
    // engine is named by the engine's own line, never also "still waiting".
    const prepared = preparedThisRun.get(request.runId);
    preparedThisRun.delete(request.runId);
    if (
      afterAnswer !== null &&
      afterAbout !== null &&
      prepared !== undefined &&
      sameCard(prepared, afterAbout)
    ) {
      afterAnswer = null;
    }
    if (afterAnswer !== null && outcome.kind === "ANSWERED") {
      // What the change's real status is, after whatever the answer said
      // about it: from the engine, never from the model's words. Deferred
      // to after the engine's step when composed (runs a05becfe,
      // a5121124): a card this turn superseded or was is not "still
      // waiting".
      if (dependencies.waitingLines !== undefined && afterAboutId !== null) {
        dependencies.waitingLines.defer(request.runId, {
          line: afterAnswer,
          actionId: afterAboutId,
        });
      } else {
        await recordAnswer(request, conversationId, afterAnswer);
      }
    }
    return outcome;
  };

  const answerTurnRead = async (
    request: QAnswerRequest,
    history: readonly QConversationMessage[],
    conversationId: QConversationMessage["conversationId"],
    latest: QConversationMessage,
    capabilitiesRead: Promise<readonly QCapability[]>,
    /** The speculative answer started for a spoken turn, if one was. */
    speculative: { current: Speculation | null },
    /** A waiting change, decided from this turn's reading; a line ends the turn. */
    decide?: (turn: PendingTurnReading | null) => Promise<string | null>,
  ): Promise<QAnswerOutcome> => {
    if (turns === undefined) return answerOnce(request);
    const state =
      conversations.get(conversationId) ?? INITIAL_CONVERSATION_STATE;
    /*
     * The reading is awaited before anything is answered (CQ-QACT-001).
     * It used to run beside the answer and decide only research, which
     * left "take me to Discover" and "make my company visible" to the
     * answer's own reading — one that has no word for either, so the
     * first was told to navigate itself and the second became a deck.
     * A request for one of Q's own hands is now acted on from this
     * reading, through the capability the screen uses; the specialist
     * path already waited on it, so only the conversational path pays
     * the one classification it was already making.
     */
    // What this run can do, from the capability registry (R20), once per
    // turn and cached by composition. The reader is told the actions the
    // answer's model takes, or "make a Q card" reads as a document.
    const capabilities = await capabilitiesRead;
    // R20/R33: every tool that changes something is an action to the
    // reader (a Prepare → Approve change, the app's own action in their
    // browser, a Save or Pass): "reload the page" is not a screen.
    // The declared app actions lead (parity eval 2026-10-02: Save and Pass
    // sat last in a long list, past the reader's cut, so "pass on Ajopot"
    // was read as propose_interest_answer and nothing was done).
    const appToolNames = dependencies.appActions?.tools ?? new Set<string>();
    const offeredActions = capabilities
      .flatMap((capability) =>
        capability.performedBy.kind === "TOOL" && capability.acts
          ? [
              {
                name: capability.performedBy.providerName,
                does: capability.does,
                ...labelOf(capability),
              },
            ]
          : [],
      )
      .sort(
        (a, b) =>
          Number(appToolNames.has(b.name)) - Number(appToolNames.has(a.name)),
      );
    // ADR 0040 parity: what the registry declares that this run does not
    // offer, marked, so the reader can name what was asked (askedAction)
    // and code can tell "not called" from "missing from the registry".
    const offeredNames = new Set(offeredActions.map((action) => action.name));
    const actions: readonly ReaderAction[] = [
      ...offeredActions,
      ...Q_CAPABILITIES.flatMap((capability) =>
        capability.performedBy.kind === "TOOL" &&
        capability.acts &&
        !offeredNames.has(capability.performedBy.providerName)
          ? [
              {
                name: capability.performedBy.providerName,
                does: capability.does,
                available: false,
                ...labelOf(capability),
              },
            ]
          : [],
      ),
    ];
    // Spoken turns carry the recogniser's utterance; typed ones never do.
    // The reader needs to know which: only speech can be overheard.
    const spoken = latest.utteranceRef !== undefined;
    // What Q showed and last did, for "that one" and "try again".
    const shown = shownItems(history);
    const lastAction = lastActed.get(conversationId) ?? null;
    // RECOVERY-2026-10 B6: what the words point at ("the second one", "not
    // that investor, the second one", "compare those two", "go back…",
    // "book a meeting with him"), bound by code to records on their page,
    // in Q's lists or in the conversation's focus. Null: not a reference.
    const pointed = pointedAt(
      latest.content,
      history,
      // The plan's screen: what the firewall kept of the page.
      request.plan.screen?.manifest,
    );
    if (pointed !== null) {
      resolvedInRun.set(request.runId, pointed.note);
      while (resolvedInRun.size > PREREADS_MAX) {
        const oldest = resolvedInRun.keys().next().value;
        if (oldest === undefined) break;
        resolvedInRun.delete(oldest);
      }
      logger?.info(
        {
          qRunId: request.runId,
          ask: pointed.ask?.kind ?? "CONTROL",
          via:
            pointed.resolved === null
              ? "CONTROL"
              : pointed.resolved.kind === "ONE"
                ? pointed.resolved.via
                : "PAIR",
        },
        "q bound a reference",
      );
    }
    // "Open the second one" / "not that investor, the second one": a record
    // on their page or in Q's list, opened by code. Q's own company cards
    // keep their richer path below (talked about from the card).
    const openedByReference =
      pointed === null
        ? null
        : openPointedRecord(latest.content, pointed, capabilities);
    if (openedByReference !== null) {
      return recordAnswer(
        request,
        conversationId,
        openedByReference.said,
        openedByReference.blocks,
      );
    }
    // "Open the readiness tab", "open the second one" on this page: a
    // control the page registered, worked here by code (before the page
    // table, which would navigate away). The screen reports a receipt;
    // the line says what Q is doing, never that it is done.
    if (pointed?.control !== undefined && asksToOperate(latest.content)) {
      logger?.info(
        {
          qRunId: request.runId,
          act: pointed.control.act,
          target: pointed.control.target,
        },
        "q is working a control on their page",
      );
      return recordAnswer(
        request,
        conversationId,
        controlActLine(pointed.control),
        [controlActBlock(pointed.control)],
      );
    }
    // A bare screen command ("scroll down", "go back") is done at once in
    // code, like the wake words: it needs no reading, no model and no view
    // of the screen (founder 2026-10-06: Q said it could not scroll
    // because it could not see the page). Anything more than the command
    // goes to the normal path.
    const screenAct = screenActOf(latest.content);
    if (screenAct !== null) {
      logger?.info(
        { qRunId: request.runId, act: screenAct.act },
        "q is working the screen",
      );
      return recordAnswer(request, conversationId, screenAct.said, [
        {
          kind: "UI_INTENT",
          intent: { kind: "SCREEN_ACT", act: screenAct.act },
        },
      ]);
    }
    // voice-cards: a page asked for by name is opened by code from one
    // route table, before any model ("take me to the explore page" went to
    // Discover twice when the reader chose); a page Capital Q lacks is said
    // so, and "the third company on the list" is the card on screen.
    // RECOVERY-2026-10 (C, INC-1): "take me to Shiftwell relationship",
    // "open Shiftwell", "the data room for Shiftwell": the one record the
    // name means, among their own relationships first, opened by code --
    // or one short line naming who it could be. Never "Understood.".
    const byName = await namedRecordAnswer(request, latest.content);
    if (byName !== null) {
      logger?.info(
        { qRunId: request.runId, outcome: byName.log },
        "q opened a record by its name",
      );
      return recordAnswer(request, conversationId, byName.said, byName.blocks);
    }
    const paged = pageAnswer(latest.content, history, capabilities);
    if (paged !== null) {
      logger?.info(
        { qRunId: request.runId, page: paged.log },
        "q opened a page by name",
      );
      return recordAnswer(request, conversationId, paged.said, paged.blocks);
    }
    saidInRun.set(request.runId, latest.content);
    while (saidInRun.size > PREREADS_MAX) {
      const oldest = saidInRun.keys().next().value;
      if (oldest === undefined) break;
      saidInRun.delete(oldest);
    }
    // Voice speculation (latency2): a spoken question's answer starts now,
    // under the default reading, beside the reading below. Only where the
    // conversational path answers it whatever the reading (no company in
    // question, or a pitch being watched), and never for a turn the
    // default cannot be: a web address is research, setup and a question
    // series carry their own notes.
    const speculativeResearch = researchDirectiveFor(
      state,
      readingFromTurnReader(SPECULATIVE_READING),
      { available: dependencies.researchAvailable ?? true },
    );
    if (
      dependencies.speculation?.spoken === true &&
      spoken &&
      request.speculation === undefined &&
      request.signal?.aborted !== true &&
      (request.plan.viewing !== undefined ||
        !request.subjects.some((subject) => subject.kind === "COMPANY")) &&
      !namesWebAddress(latest.content) &&
      request.plan.screen?.route !== "ONBOARDING" &&
      !sequences.has(conversationId)
    ) {
      speculative.current = startSpeculation({
        request: {
          ...request,
          research: Promise.resolve(speculativeResearch),
          capabilities: manifestOf(capabilities),
          turnKind: SPECULATIVE_READING.kind,
          spoken: true,
          // What a plain question's focus is (toolFocusOf): the purpose's
          // list with the public-web tools leading, so the speculation
          // holds the web exactly as the turn's own answer would.
          toolFocus: { areas: [], tools: [...RESEARCH_TOOLS], widen: true },
        },
        answer: (shaped) => delegate.answer(shaped),
        observe: (event) => {
          logger?.info(
            {
              qRunId: event.runId,
              speculation:
                event.outcome === "ADOPTED" ? "adopted" : "cancelled",
              reason: event.reason,
              decidedAfterMs: event.decidedAfterMs,
            },
            "q voice speculation",
          );
          dependencies.speculation?.observe?.(event);
        },
      });
    }
    const readTurn = () =>
      turns.read(
        turnReaderInput(
          history,
          latest,
          actions,
          {
            tenantId: request.tenantId,
            userId: request.actor.userId,
            correlationId: request.correlationId,
            signal: request.signal,
          },
          withResolution(referenceNote(shown, lastAction), pointed),
        ),
      );
    // Read early, beside the firewall (ADR 0035), with the same words, the
    // same turns and the same actions as now: taken up only when all three
    // match; anything else is read again here.
    const early = prereads.get(request.runId);
    prereads.delete(request.runId);
    lastActions.delete(conversationId);
    lastActions.set(conversationId, actionsKey(actions));
    if (lastActions.size > MAX_CONVERSATIONS) {
      const oldest = lastActions.keys().next().value;
      if (oldest !== undefined) lastActions.delete(oldest);
    }
    const ready = early === undefined ? null : await early;
    const earlyRead =
      ready !== null &&
      ready.messageId === latest.id &&
      ready.actionsKey === actionsKey(actions)
        ? await ready.reading
        : null;
    // A reading that failed is tried once more: the gateway has parked the
    // provider that failed, so the second try goes to the fallback model.
    // A request to make something must never be dropped because one model
    // was down (B1, 2026-09-25).
    let read = earlyRead ?? (await readTurn().catch(() => null));
    let turnUnread = false;
    if (read === null && request.signal?.aborted !== true) {
      read = await readTurn().catch(() => null);
      turnUnread = read === null;
      logger?.warn(
        { qRunId: request.runId, recovered: read !== null },
        "a turn to Q was not read on the first try",
      );
    }
    const research: Promise<QResearchDirective> = Promise.resolve(
      read === null
        ? NO_RESEARCH
        : researchDirectiveFor(state, readingFromTurnReader(read), {
            available: dependencies.researchAvailable ?? true,
            aboutNamedOther: read.aboutNamedOther,
          }),
    );
    if (read !== null) {
      logger?.info(
        {
          qRunId: request.runId,
          kind: read.kind,
          confidence: read.confidence,
          transcript: read.transcript,
          question: read.question?.kind ?? null,
          aboutNamedOther: read.aboutNamedOther,
          addressedToQ: read.addressedToQ ?? true,
          earlierNotForQ: read.earlierNotForQ ?? false,
          research: (await research).mode,
          tool: read.tool?.kind ?? null,
        },
        "q turn read",
      );
    }
    // TURN_READER v44 (Zino live 2026-10-08 11:13): garbled speech read by
    // sound. The likely words become their turn, recorded beside what the
    // recogniser heard (kept, never overwritten), and the turn is answered
    // from them; going silent let the voice ask "could you give me more
    // detail?" about "find anything that needs my attention". Once per run.
    const heardAs = spoken ? (read?.heardAs?.trim() ?? "") : "";
    if (
      heardAs.length > 0 &&
      heardAs.toLowerCase() !== latest.content.trim().toLowerCase() &&
      latest.utteranceRef !== undefined &&
      read?.addressedToQ !== false &&
      !reheard.has(request.runId)
    ) {
      speculative.current?.cancel("ACTED");
      const utteranceRef = latest.utteranceRef;
      await transactions.run((tx) =>
        repositories.messages.insert(tx, {
          tenantId: request.tenantId,
          conversationId,
          runId: request.runId,
          role: "USER",
          content: heardAs,
          // Its own utterance, so it never supersedes the run's first line.
          ...(utteranceRef.length <= 249
            ? { utteranceRef: `${utteranceRef}:heard` }
            : {}),
        }),
      );
      logger?.info(
        { qRunId: request.runId, kind: read?.kind ?? null },
        "q read garbled speech by sound",
      );
      reheard.add(request.runId);
      try {
        return await answerTurn(request);
      } finally {
        reheard.delete(request.runId);
      }
    }
    // A reading the speculation cannot be is known now: stop it at once
    // rather than at the end of the path.
    const misread = readingMisfit(read);
    if (misread !== null) speculative.current?.cancel(misread);
    if (decide !== undefined) {
      const line = await decide(
        read === null
          ? null
          : {
              kind: read.kind,
              addressedToQ: read.addressedToQ ?? true,
              // A turn that asks for an action in its own right is a request,
              // never a reply to the card (the reader named one, or a hand).
              namesAction:
                (typeof read.askedAction === "string" &&
                  read.askedAction.length > 0) ||
                appActionOf(read) !== null ||
                (read.tool ?? null) !== null ||
                (read.handOver ?? null) !== null,
            },
      );
      if (line !== null) return recordAnswer(request, conversationId, line);
    }
    // Spoken words plainly meant for someone else (a call, a colleague,
    // the room) are not a turn to Q: nothing is answered, nothing is
    // recorded as theirs, and Q keeps listening (founder live 2026-09-29:
    // answering the room made Q "talk to itself").
    // The person said what came before was not for Q ("wasn't talking to
    // you"): those lines -- theirs, since Q last spoke -- are kept out of
    // what Q reads back from now on, context, readings and memory alike
    // (founder live 2026-10-01). Nothing is deleted.
    if (read !== null && read.earlierNotForQ === true) {
      // What they said just before: their latest run of lines, and Q's
      // reply to them if Q answered (live check 2026-10-01: Q's reply to
      // a line not meant for it kept the line alive in context).
      const before: string[] = [];
      let seenTheirs = false;
      for (let index = history.length - 1; index >= 0; index -= 1) {
        const message = history[index];
        if (message === undefined || message.id === latest.id) continue;
        if (message.role === "USER") seenTheirs = true;
        else if (seenTheirs) break;
        before.push(message.id);
        if (before.length >= 30) break;
      }
      await markNotForQ(request, conversationId, seenTheirs ? before : []);
    }
    if (spoken && read !== null && read.addressedToQ === false) {
      // Not theirs to Q: kept out of what Q reads back, so a name said to
      // someone else or a dictation never becomes context or memory.
      await markNotForQ(request, conversationId, [latest.id]);
      logger?.info({ qRunId: request.runId }, "q turn not addressed to Q");
      return {
        kind: "ANSWERED",
        messageId: null,
        modelPolicyVersion: "none",
        promptBundleVersion: "none",
      };
    }
    // Words that could not be made out are a transcription matter, not a
    // question: no model is asked (it answered with a meta-statement).
    // One brief prompt; a second unclear turn in a row gets silence, so
    // the prompt is never repeated. A clear turn resets the count.
    if (read !== null && isUnclearTurn(read)) {
      const before = unclearInARow.get(conversationId) ?? 0;
      unclearInARow.set(conversationId, before + 1);
      // RECOVERY-2026-10 (live T1): a spoken turn reaching here was read as
      // addressed to Q (speech for the room was marked not-for-Q above and
      // is the only silent case), so it always gets a short prompt.
      // Silence lost the turn and let the realtime voice improvise for Q.
      // Typed: one prompt, then quiet, as before.
      const reply = spoken
        ? spokenUnclearReply(read, before)
        : unclearTurnReply(read, before);
      logger?.info(
        { qRunId: request.runId, unclearInARow: before + 1, reply: reply.kind },
        "q turn unclear",
      );
      return reply.kind === "PROMPT"
        ? recordAnswer(request, conversationId, reply.line)
        : {
            kind: "ANSWERED",
            messageId: null,
            modelPolicyVersion: "none",
            promptBundleVersion: "none",
          };
    }
    unclearInARow.delete(conversationId);
    // RECOVERY B5 (audit B-05): small talk is one short tool-free call,
    // never the analyst with its prefetch and ~127 tools. Not when the turn
    // is about a record, a series is in hand, or the reading is a guess;
    // a failed reply goes the full way, never silence.
    if (
      dependencies.smallTalk !== undefined &&
      read !== null &&
      read.kind === "SMALL_TALK" &&
      read.confidence !== "LOW" &&
      request.subjects.length === 0 &&
      !sequences.has(conversationId)
    ) {
      const said = await dependencies.smallTalk(request, {
        said: latest.content,
        recent: history
          .filter((m) => m.id !== latest.id)
          .slice(-6)
          .map((m) => ({
            role: m.role === "USER" ? ("USER" as const) : ("Q" as const),
            text: m.content,
          })),
      });
      if (said !== null) {
        speculative.current?.cancel("ACTED");
        logger?.info(
          { qRunId: request.runId },
          "q answered small talk in one tool-free call",
        );
        return recordAnswer(request, conversationId, said);
      }
    }
    // What the turn points back at (TURN_READER v40, follow-55): one record
    // to open, or Q's last action again. Bound here by code to a record of
    // theirs or to that action, before any screen is opened for the turn
    // (Zino live 2026-10-04: "open the questions for…" opened the
    // Documents list; "now try again" opened the profile page again).
    const reference =
      read !== null && read.confidence !== "LOW"
        ? (read.reference ?? null)
        : null;
    if (reference !== null && reference.open !== null) {
      const opened = await openReferenced(
        request,
        conversationId,
        reference,
        shown,
        history,
      );
      if (opened !== null) return opened;
    }
    if (
      reference !== null &&
      reference.retryLast &&
      lastAction !== null &&
      dependencies.appActions !== undefined &&
      dependencies.appActions.tools.has(lastAction.tool)
    ) {
      const again = await repeatLastAction(
        request,
        conversationId,
        lastAction,
        reference.sameFor,
      );
      if (again !== null) return again;
    }
    // A LOW reading is a guess, and a guess never moves anybody's screen or
    // prepares a change: it is answered like any other turn. A document
    // asked for "from what you can find publicly" may be read as a
    // research request as much as a tool request; either way it is a
    // request for the document, and the document is what they get.
    const tool =
      read !== null &&
      read.confidence !== "LOW" &&
      (read.kind === "TOOL_REQUEST" ||
        (read.kind === "RESEARCH_REQUEST" &&
          read.tool?.kind === "PREPARE_DOCUMENT"))
        ? read.tool
        : null;
    // A piece Q writes for them as a document (Q_REPORT) is answered
    // first and filed after; any other document asked with it is made
    // then too, in the same follow-up.
    const documents =
      tool?.kind === "PREPARE_DOCUMENT"
        ? [tool, ...(read?.moreDocuments ?? [])]
        : [];
    const writingDocument =
      artifacts !== undefined &&
      documents.some((document) => document.documentType === "Q_REPORT");
    // Permission to put what research finds into their own profile
    // (TURN_READER v27, by meaning): code fills the open fields and
    // prepares one change; the answer model is not asked (live
    // 2026-10-02, Nixo: it lectured about verification instead).
    if (
      dependencies.profileGaps !== undefined &&
      read !== null &&
      read.confidence !== "LOW" &&
      read.saveToOwnProfile === true &&
      !writingDocument
    ) {
      const filled = await dependencies.profileGaps
        .fill(request)
        .catch((error: unknown) => {
          logger?.warn(
            { err: error, qRunId: request.runId },
            "profile gaps were not filled; answering normally",
          );
          return null;
        });
      if (filled !== null) {
        logger?.info(
          { qRunId: request.runId },
          "their profile's gaps were filled by code, not by the answer",
        );
        return recordAnswer(request, conversationId, filled.line);
      }
    }
    // SET_VISIBILITY is the company's hand (parity eval 2026-10-02, run
    // 1ec08a4b: "make our fund visible to founders" was read as it, and an
    // investor was told Q changes who sees a company). With no company in
    // this run and the fund's own visibility action offered, the request is
    // that action's, filled from their words below.
    const fundVisibility =
      tool?.kind === "SET_VISIBILITY" &&
      !request.subjects.some((subject) => subject.kind === "COMPANY") &&
      offeredNames.has(INVESTOR_VISIBILITY_TOOL) &&
      (dependencies.appActions?.tools.has(INVESTOR_VISIBILITY_TOOL) ?? false);
    // SET_VISIBILITY read for words that name a deck or a pitch of theirs:
    // that record's own action, when this run offers it.
    const audienceTool =
      tool?.kind === "SET_VISIBILITY"
        ? recordAudienceTool(latest.content)
        : null;
    const recordAudience =
      audienceTool !== null &&
      offeredNames.has(audienceTool) &&
      (dependencies.appActions?.tools.has(audienceTool) ?? false)
        ? audienceTool
        : null;
    if (
      tool !== null &&
      !writingDocument &&
      !fundVisibility &&
      recordAudience === null
    ) {
      const acted = await actOnTool(
        request,
        conversationId,
        tool,
        history,
        manifestOf(capabilities).navigate,
        read?.moreDocuments ?? [],
        capabilities.some(
          (capability) =>
            capability.performedBy.kind === "TOOL" &&
            capability.performedBy.providerName === "open_page",
        ),
      );
      if (acted !== null) {
        remember(
          conversationId,
          reduceConversation(state, { type: "SUCCEEDED", operation: "TOOL" }),
        );
        return acted;
      }
    }
    // A declared app action the reading names (ADR 0040): code runs its
    // generated tool, with its own authorize step and approval card, and
    // says the tool's own line; the model is not asked to choose it.
    // Named but not filled (parity eval 2026-10-02: 3 of 12 Discover turns
    // read askedAction pass_company / save_company with appAction empty):
    // one small extraction against that tool's own input schema fills it.
    const appTools = dependencies.appActions?.tools ?? new Set<string>();
    // The reply to a question a declared action asked (QA 7d7e7260 ->
    // 5c2f71aa: "Lagos" after "Which city are you in…" got no card): that
    // action continues, its arguments merged with what this reply adds,
    // read against its own schema. A reply, or the same action asked for
    // again, continues it; anything else is answered as itself.
    const waiting = await pendingActions.take({
      tenantId: request.tenantId,
      conversationId,
    });
    if (
      waiting !== null &&
      dependencies.appActions !== undefined &&
      read !== null &&
      (read.kind === "ANSWER" ||
        read.kind === "CLARIFICATION" ||
        read.kind === "CORRECTION" ||
        read.askedAction === waiting.action.tool)
    ) {
      const added = await dependencies
        .appActionArguments?.(request, {
          tool: waiting.action.tool,
          utterance: latest.content,
        })
        .catch(() => null);
      const merged: Record<string, unknown> = {
        ...waiting.action.arguments,
        ...(added !== null && added !== undefined && typeof added === "object"
          ? added
          : {}),
      };
      // The place they gave when asked for their time zone, turned into
      // one by code (QA runs a87ca38f, 2e053864: "Lagos" was asked about
      // again); the reader's own reading is the fallback.
      if (waiting.needs === "TIME_ZONE") {
        const zone =
          zoneFromWords(latest.content) ??
          (typeof merged["timeZone"] === "string"
            ? zoneFromWords(merged["timeZone"])
            : null);
        if (zone !== null) merged["timeZone"] = zone;
      }
      const action: TurnAppAction = {
        tool: waiting.action.tool,
        arguments: merged,
      };
      logger?.info(
        {
          qRunId: request.runId,
          tool: action.tool,
          needs: waiting.needs,
          added: added !== null && added !== undefined,
        },
        "a declared action waiting on their reply continues",
      );
      const continued = await dependencies.appActions
        .run(request, action)
        .catch(() => null);
      if (continued !== null) {
        return saidByAction(request, conversationId, action, continued);
      }
    }
    const readerNamed =
      read !== null &&
      read.kind === "TOOL_REQUEST" &&
      read.confidence !== "LOW" &&
      typeof read.askedAction === "string" &&
      appTools.has(read.askedAction) &&
      offeredNames.has(read.askedAction)
        ? read.askedAction
        : null;
    // The reader's own app action, only when it is a declared one.
    const readerAppAction = (() => {
      const own = appActionOf(read);
      return own !== null && appTools.has(own.tool) ? own : null;
    })();
    /**
     * A request to act that named no declared action (lead 2026-10-03,
     * runs 9b4ef8d1, 7dd0bc2c, 31d085ac): one small routing call over the
     * declared actions this person may take here, on any purpose. Not for
     * a hand, a hand-over or a document, which have their own paths.
     */
    // What else they said about the grant, read against the tool's own
    // schema by the same small reader app actions use.
    const readDelegationArguments =
      (request: QAnswerRequest, utterance: string) =>
      async (): Promise<Readonly<Record<string, unknown>> | null> => {
        const args = await dependencies.appActionArguments?.(request, {
          tool: DELEGATION_TOOL,
          utterance,
        });
        return args !== null &&
          args !== undefined &&
          typeof args === "object" &&
          !Array.isArray(args)
          ? args
          : null;
      };
    const routed =
      dependencies.appActionRouter !== undefined &&
      dependencies.appActions !== undefined &&
      read !== null &&
      read.kind === "TOOL_REQUEST" &&
      read.confidence !== "LOW" &&
      readerNamed === null &&
      readerAppAction === null &&
      !fundVisibility &&
      recordAudience === null &&
      (read.tool ?? null) === null &&
      (read.handOver ?? null) === null &&
      !writingDocument
        ? await dependencies
            .appActionRouter(request, {
              utterance: latest.content,
              candidates: [
                ...offeredActions.filter((action) => appTools.has(action.name)),
                // Handing work over in general is one of the meanings a
                // request to act can have; the router weighs it with the
                // rest (QA 2026-10-03).
                // Always, when composed: the tool is called under the run's
                // own plan, whatever this turn's focus offered (QA
                // 2026-10-03, run d77f9934).
                ...(dependencies.delegation !== undefined
                  ? [DELEGATION_CANDIDATE]
                  : []),
              ],
            })
            .catch(() => null)
        : null;
    if (routed === DELEGATION_TOOL && dependencies.delegation !== undefined) {
      logger?.info(
        { qRunId: request.runId, routed },
        "q request route: handed over in general; standing instruction",
      );
      return recordAnswer(
        request,
        conversationId,
        await actOnDelegation(
          dependencies.delegation,
          request,
          latest.content,
          readDelegationArguments(request, latest.content),
        ),
      );
    }
    const namedAction =
      readerNamed ??
      (fundVisibility ? INVESTOR_VISIBILITY_TOOL : (recordAudience ?? routed));
    // How a request to act was routed, said once before any path can
    // return (lead 2026-10-03: the focus line came after the code-run
    // return, so a request done by code never logged one).
    if (read?.kind === "TOOL_REQUEST") {
      logger?.info(
        {
          qRunId: request.runId,
          confidence: read.confidence,
          readerNamed,
          readerAppAction: readerAppAction?.tool ?? null,
          hand: read.tool?.kind ?? null,
          recordAudience,
          routed,
          action: readerAppAction?.tool ?? namedAction,
        },
        "q request route",
      );
    }
    const appAction =
      readerAppAction ??
      (dependencies.appActions !== undefined &&
      dependencies.appActionArguments !== undefined &&
      namedAction !== null
        ? await (async () => {
            const tool = namedAction;
            const args = await dependencies
              .appActionArguments?.(request, {
                tool,
                utterance: latest.content,
              })
              .catch(() => null);
            logger?.info(
              { qRunId: request.runId, tool, filled: args != null },
              "app action named without arguments; arguments read for it",
            );
            if (args === null || args === undefined) {
              // Asked for and not prepared: "try again" binds to it.
              noteAction(
                request,
                conversationId,
                { tool, arguments: null },
                "NOT_DONE",
              );
              return null;
            }
            return { tool, arguments: args };
          })()
        : null);
    if (
      dependencies.appActions !== undefined &&
      appAction !== null &&
      read !== null &&
      read.confidence !== "LOW" &&
      dependencies.appActions.tools.has(appAction.tool) &&
      !writingDocument
    ) {
      const said = await dependencies.appActions
        .run(request, appAction)
        .catch(() => null);
      if (said !== null) {
        return saidByAction(request, conversationId, appAction, said);
      }
      // The reader's own arguments did not fit the tool (parity eval
      // 2026-10-02: "Change our fund's website to ..." failed
      // INVALID_ARGUMENTS): once, the arguments are read again against the
      // tool's own schema, and the same tool runs with them.
      if (
        appActionOf(read) !== null &&
        dependencies.appActionArguments !== undefined &&
        offeredNames.has(appAction.tool)
      ) {
        const again = await dependencies
          .appActionArguments(request, {
            tool: appAction.tool,
            utterance: latest.content,
          })
          .catch(() => null);
        logger?.info(
          {
            qRunId: request.runId,
            tool: appAction.tool,
            reread: again !== null,
          },
          "app action refused its read arguments; arguments read for it again",
        );
        if (
          again !== null &&
          JSON.stringify(again) !== JSON.stringify(appAction.arguments)
        ) {
          const retried = await dependencies.appActions
            .run(request, { tool: appAction.tool, arguments: again })
            .catch(() => null);
          if (retried !== null) {
            return saidByAction(
              request,
              conversationId,
              { tool: appAction.tool, arguments: again },
              retried,
            );
          }
        }
      }
      // Tried and not done: what "try again" will run, with its inputs.
      noteAction(request, conversationId, appAction, "NOT_DONE");
    }
    // A hand-over (TURN_READER v22): "get me a meeting with this person",
    // "handle this for me", in any language. Code prepares Q's errand for
    // the subject they are looking at, for their approval, instead of the
    // answer asking who (founder live 2026-10-01).
    if (
      dependencies.handOver !== undefined &&
      read !== null &&
      read.confidence !== "LOW" &&
      read.handOver !== undefined &&
      read.handOver !== null &&
      tool === null &&
      !writingDocument
    ) {
      const handed = await actOnHandOver(
        dependencies.handOver,
        request,
        { ...read.handOver, pointed: handOverSubjectPointed(pointed) },
        read.timeWindow ?? null,
      ).catch((error: unknown) => {
        logger?.warn(
          { err: error, qRunId: request.runId },
          "a hand-over was not prepared; answering normally",
        );
        return { kind: "NONE" } as const;
      });
      if (handed.kind === "STANDING") {
        if (dependencies.delegation !== undefined) {
          return recordAnswer(
            request,
            conversationId,
            await actOnDelegation(
              dependencies.delegation,
              request,
              latest.content,
              readDelegationArguments(request, latest.content),
            ),
          );
        }
      } else if (handed.kind !== "NONE") {
        return recordAnswer(request, conversationId, handed.line);
      }
    }
    // Where a requested series of questions stands, decided from the
    // reading alone (R35): the answer is told which question it is on,
    // and the series moves only once that answer has landed.
    const series = stepQuestionSequence(
      sequences.get(conversationId) ?? null,
      read === null ? null : { kind: read.kind, sequence: read.sequence },
    );
    if (series.step !== null) {
      logger?.info(
        {
          qRunId: request.runId,
          sequence: series.step.kind,
          ...("number" in series.step ? { number: series.step.number } : {}),
          total: "total" in series.step ? series.step.total : null,
        },
        "q question series",
      );
    }
    // A question about what is on their own record ("what do you have on
    // record about my company", "summarise my raise") is read from the
    // record by the conversational path, which reads it directly; the
    // company analysis is for assessment (lead decision 2026-10-01: the
    // analysis took 12.4 s and 1,100 tokens to restate a profile).
    // "What should I do next?" about themselves (ADVICE, no one else
    // named): their readiness gaps open the answer, composed by code, and
    // the conversational path answers the rest (lead 2026-10-03, run
    // 2cba241a: the company analysis led with an operating-market detail).
    const readinessLead =
      !writingDocument &&
      read?.question?.kind === "ADVICE" &&
      read.aboutNamedOther !== true &&
      dependencies.readinessLead !== undefined
        ? await dependencies.readinessLead(request).catch(() => null)
        : null;
    const ownRecords =
      readinessLead !== null ||
      (!writingDocument && read?.question?.kind === "THEIR_OWN_RECORDS");
    // What the turn is about narrows the tool offer (lead 2026-10-02);
    // "yes" to Q's own offer keeps the previous turn's focus.
    const named = [
      ...(read?.askedAction !== undefined &&
      read.askedAction !== null &&
      actions.some((action) => action.name === read.askedAction)
        ? [read.askedAction]
        : []),
      ...(appActionOf(read) === null ? [] : [appActionOf(read)?.tool ?? ""]),
      // What the router named, so a code-run miss still offers it.
      ...(routed === null ? [] : [routed]),
    ].filter((name) => name.length > 0);
    const toolFocus = toolFocusOf({
      reading:
        read === null
          ? null
          : {
              kind: read.kind,
              questionKind: read.question?.kind ?? null,
              namedTools: named,
              hand: read.tool?.kind ?? null,
              handOver: (read.handOver ?? null) !== null,
              research: (await research).mode,
              text: latest.content,
            },
      subjectKinds: request.subjects.map((subject) => subject.kind),
      counterparty: await aboutCounterparty(request, latest.content, read),
      areaOf: toolAreaOf,
      previous: focuses.get(conversationId) ?? null,
      onboarding: request.plan.screen?.route === "ONBOARDING",
    });
    focuses.delete(conversationId);
    if (read?.kind === "TOOL_REQUEST") {
      logger?.info(
        {
          qRunId: request.runId,
          areas: toolFocus?.areas ?? null,
          tools: toolFocus?.tools ?? null,
          widened: toolFocus?.widen === true,
          routed,
        },
        "q tool focus for a request",
      );
    }
    if (toolFocus !== null) {
      focuses.set(conversationId, toolFocus);
      if (focuses.size > MAX_CONVERSATIONS) {
        const oldest = focuses.keys().next().value;
        if (oldest !== undefined) focuses.delete(oldest);
      }
    }
    const finalRequest: QAnswerRequest = {
      ...request,
      research,
      capabilities: manifestOf(capabilities),
      ...(turnUnread ? { turnUnread: true } : {}),
      // Said aloud: the answer is shaped for the ear (2026-10-07).
      ...(spoken ? { spoken: true } : {}),
      ...(read === null ? {} : { turnKind: read.kind }),
      ...(read?.question?.kind === undefined
        ? {}
        : { questionKind: read.question.kind }),
      ...(readinessLead === null ? {} : { leadLines: readinessLead }),
      // Only a name the reader was given counts (ADR 0040 parity).
      ...(read?.askedAction === undefined ||
      read.askedAction === null ||
      !actions.some((action) => action.name === read.askedAction)
        ? {}
        : { askedAction: read.askedAction }),
      ...(writingDocument ? { writingDocument: true } : {}),
      ...(series.step === null ? {} : { questionSequence: series.step }),
      ...(toolFocus === null ? {} : { toolFocus }),
    };
    const finalRoute = {
      ownRecords,
      reading:
        read === null
          ? null
          : {
              kind: read.kind,
              questionKind: read.question?.kind ?? null,
              aboutNamedOther: read.aboutNamedOther,
            },
    };
    // The turn's own path has arrived at its answer: the speculation is
    // adopted only when that answer is the one it is already writing.
    const speculation = speculative.current;
    const misfit =
      speculation === null
        ? null
        : speculationMisfit({
            final: finalRequest,
            finalResearch: await research,
            ownRecords,
            speculative: speculation.request,
            speculativeResearch,
          });
    if (misfit !== null) speculation?.cancel(misfit);
    const outcome =
      speculation !== null && misfit === null
        ? await speculation.adopt()
        : await answerOnce(finalRequest, finalRoute);
    if (writingDocument && outcome.kind === "ANSWERED") {
      await fileWrittenAnswer(
        request,
        conversationId,
        outcome,
        documents.filter((document) => document.documentType !== "Q_REPORT"),
      );
    }
    if (outcome.kind === "ANSWERED" && series.step !== null) {
      keepSequence(conversationId, series.next);
    }
    if (outcome.kind === "FAILED") {
      const operation = operationOf(outcome.diagnosticCode);
      if (operation !== null) {
        const noted = noteAnswerFailure(state, operation);
        remember(conversationId, noted.state);
        if (noted.notice !== null) notices.set(request.runId, noted.notice);
      }
    } else if (outcome.kind === "ANSWERED") {
      remember(
        conversationId,
        reduceConversation(
          reduceConversation(state, { type: "SUCCEEDED", operation: "MODEL" }),
          { type: "SUCCEEDED", operation: "TOOL" },
        ),
      );
    }
    return outcome;
  };

  const answerOnce = async (
    request: QAnswerRequest,
    route: {
      readonly ownRecords?: boolean;
      /** The turn reader's reading; absent when no reader is composed. */
      readonly reading?: QSpecialistTurnReading | null;
    } = {},
  ): Promise<QAnswerOutcome> => {
    // The conversation, not the run: a voice turn is its own run, and a
    // specialist that sees one sentence cannot follow what is being
    // talked about.
    const history = await repositories.messages.listRecentForConversationOfRun(
      sql,
      request.tenantId,
      request.runId,
      64,
    );
    const conversationId = history[0]?.conversationId;
    const latest = [...history].reverse().find((m) => m.role === "USER");
    if (conversationId === undefined || latest === undefined) {
      return { kind: "FAILED", diagnosticCode: "INTERNAL_ERROR" };
    }

    const probe: QSpecialistProbe = {
      capability: request.capability,
      // Their own firm, carried as context for a fit question, is not a
      // second subject: the question is still about the company
      // (CQ-QX-007). The specialist reads their mandate from the plan.
      subjects: askedSubjects(request.subjects, request.plan),
      question: latest.content,
      ...(route.reading === undefined ? {} : { reading: route.reading }),
    };
    // R18: a question asked while watching a pitch is about the moment in
    // the video, which the conversational path reads (get_pitch_moment);
    // the company analysis has no transcript. Decided by the structured
    // context the Q API authorised, never by the question's words.
    if (
      request.plan.viewing !== undefined ||
      route.ownRecords === true ||
      !specialist.supports(probe)
    ) {
      return delegate.answer(withReferences(request));
    }
    const company = request.subjects.find(
      (subject) => subject.kind === "COMPANY",
    );
    if (company === undefined || company.kind !== "COMPANY") {
      return delegate.answer(withReferences(request));
    }

    last = null;
    // The conversation core's decision for this turn (CQ-QX-005): only a
    // turn read as explicitly asking for public information reads the web.
    const directive =
      request.research === undefined ? undefined : await request.research;
    const result = await specialist.investigate(
      {
        company,
        question: latest.content,
        conversation: earlierTurns(history, latest.id),
        publicResearch: directive?.mode === "EXPLICIT",
        // A gap question changes what is emphasised, never what is read.
        ...(asksAboutGaps(latest.content) ? { focus: ["GAPS"] as const } : {}),
        // Their own conversation's most recent document, so a request
        // to change it reads as one.
        ...(() => {
          const card = latestArtifactCardIn(history);
          return card === null ? {} : { openDocument: { title: card.title } };
        })(),
      },
      {
        actor: request.actor,
        runId: request.runId,
        correlationId: request.correlationId,
        capability: request.capability,
        plan: request.plan,
        ...(request.signal === undefined ? {} : { signal: request.signal }),
        showStage: (stage) => showStage(request, stage),
      },
    );
    last = result;

    if (result.blocked === "CANCELLED") {
      return { kind: "FAILED", diagnosticCode: "RUN_CANCELLED" };
    }
    // Last surface before a person reads it (CQ-Q-023). Capital Q has no
    // deterministic recommendation factors yet, so a sentence explaining
    // why something was recommended, ranked or matched was invented — and
    // the prompt forbidding it is not what stops it reaching an investor.
    // A model route that is out is not the end of the answer: what the
    // deterministic pass computed still stands, and saying it beats an
    // apology. Only when nothing was computed does the person hear why.
    const degraded =
      result.blocked === "MODEL_UNAVAILABLE" && result.findings.length > 0;
    const guarded = withoutRecommendationClaims(
      degraded
        ? `${synthesisFromFindings(result)}\n\nThat is what's on record; the fuller review didn't come through this time, so ask again in a moment for more.`
        : result.blocked !== null
          ? publicBlockedMessage(result.blocked)
          : (result.synthesis ?? synthesisFromFindings(result)),
    );
    if (guarded.removed > 0) {
      logger?.warn(
        { qRunId: request.runId, removed: guarded.removed },
        "recommendation claims removed from a Q answer",
      );
    }
    // What the person stated about their own company was recorded as
    // their claim (CQ-Q-RESEARCH-001 §21, §40); the answer says so, in
    // Capital Q's words, deterministically.
    const acknowledgement =
      result.recordedStatements.length === 0
        ? ""
        : `\n\n${quietlyNoted(result.recordedStatements)}`;
    /**
     * Preparing the document they asked for (QX-003D/F; ADR 0013).
     *
     * Everything before this composed; this persists, and it does so
     * through the artifact application service, which re-derives
     * authority from the run's own plan. The model read the request into
     * a closed schema field and the specialist checked it against their
     * own words; nothing here asks a model whether to write.
     *
     * A failure is not a failed answer. The findings still stand and the
     * person still reads them; they are told the document did not come
     * through, which is true and actionable, rather than shown an error.
     */
    const preparation =
      artifacts === undefined || result.artifactRequest === null
        ? null
        : await prepareOrReviseArtifact({
            artifacts,
            request,
            company,
            companyName: "your company",
            saidVerbatim: latest.content,
            result,
            history,
            showStage: (stage) => showStage(request, stage),
            ...(logger === undefined ? {} : { logger }),
          });
    const prepared =
      preparation?.kind === "PREPARED" ? preparation.summary : null;
    /**
     * What the person is told about the document, by how it ended. A
     * record too thin to write from is said as that, with what would fix
     * it; "ask again in a moment" is kept for a failure another moment
     * might cure (CQ-QX-005: never send a person round a loop the
     * platform knows will fail the same way).
     */
    const documentNote =
      prepared !== null
        ? prepared.currentVersion <= 1
          ? `\n\nI've prepared **${prepared.title}** from what's on record. It's a private draft in your workspace — nothing has been shared or sent.`
          : `\n\nI've updated **${prepared.title}** — that's version ${String(prepared.currentVersion)}. The previous version is still there, and nothing has been shared or sent.`
        : preparation?.kind === "THIN_RECORD"
          ? `\n\nThere isn't enough on record about the company yet to build ${preparation.artifactType === "PITCH_DECK" ? "a deck" : "a brief"} worth sending — it would be mostly blanks. Add your existing deck or model on your company page, or tell me what you do, for whom, and the traction so far, and I'll build it from that.`
          : preparation?.kind === "FAILED"
            ? "\n\nI couldn't put that document together just now. What's above is what the record supports; ask again in a moment and I'll try the document again."
            : "";
    // Where the answer's supported findings came from, named the way the
    // person knows it (CQ-QX-007 F1). Resolved from the citations that
    // held, so it can never name a source the answer did not rest on.
    const provenance = (() => {
      if (result.blocked !== null && !degraded) return "";
      const line = provenanceLine(result.findings);
      return line === null
        ? ""
        : `

${line}`;
    })();
    const content =
      `${guarded.text}${provenance}${acknowledgement}${documentNote}`
        .slice(0, ANSWER_LIMIT_CHARS)
        .trim();
    // An answer that was nothing but talk about acting (CQ-QX-007) had
    // every sentence removed; Capital Q's own lines say what happened, and
    // without one it is acknowledged and no more.
    const said =
      content.length === 0 && result.blocked === null && result.synthesis === ""
        ? "Understood."
        : content;
    if (said.length === 0) {
      return { kind: "FAILED", diagnosticCode: "MODEL_PROVIDER_UNAVAILABLE" };
    }

    // The message and its durable completion event commit together
    // (CQ-Q-009 §16-§18), so a client that missed every live delta
    // converges on this text.
    // One projection, used for the event and for the row, so a reopened
    // conversation shows exactly what the live one did.
    const analystBlocks = analystResultBlocks({
      result: {
        findings: result.findings,
        contradictions: result.contradictions.map((contradiction) =>
          contradiction.statements.join(" — and — "),
        ),
      },
      subjects: askedSubjects(request.subjects, request.plan),
    });

    const blocks: QResultBlock[] | undefined =
      prepared === null
        ? analystBlocks === undefined
          ? undefined
          : [...analystBlocks]
        : [
            ...(analystBlocks ?? []),
            {
              kind: "ARTIFACT_REFERENCE" as const,
              artifactId: prepared.artifactId,
              type: prepared.type,
              status: prepared.status,
              title: prepared.title,
            },
          ];
    const message = await transactions.run(async (tx) => {
      const stored = await repositories.messages.insert(tx, {
        tenantId: request.tenantId,
        conversationId,
        runId: request.runId,
        role: "Q",
        content: said,
        ...(blocks === undefined ? {} : { blocks }),
      });
      await appendRunEvent(
        repositories,
        tx,
        { id: request.runId, tenantId: request.tenantId },
        {
          type: "q.message.completed",
          data: {
            message: {
              ...(toQMessage(stored) as QResponseMessage),
              // What the specialist already found, as blocks a client
              // can act on (QX-002/003 §C). The same projection the
              // conversational seam uses, so one answer does not carry
              // a different shape depending on which brain produced it.
              ...(blocks === undefined ? {} : { blocks }),
            },
          },
        },
      );
      return stored;
    });

    logger?.debug(
      {
        qRunId: request.runId,
        findings: result.findings.length,
        blocked: result.blocked,
      },
      "specialist answer recorded",
    );

    return {
      kind: "ANSWERED",
      messageId: message.id,
      modelPolicyVersion: result.telemetry.routingPolicyCode ?? "none",
      promptBundleVersion: result.telemetry.promptBundleVersion ?? "none",
    };
  };

  return {
    lastResult: () => last,
    answer: answerTurn,
    preread,
    discard: (runId: string) => {
      prereads.delete(runId);
      delegate.discard?.(runId);
    },
    failureNotice: (runId: string) => {
      const notice = notices.get(runId);
      notices.delete(runId);
      return notice;
    },
  };
}

/**
 * The few bare screen commands done in code (scroll, top, bottom, back).
 * Deliberately narrow: the whole message must be the command, optionally
 * with "Q", "please" or "the page", so a question never matches.
 */
export function screenActOf(text: string): {
  readonly act:
    "PAGE_DOWN" | "PAGE_UP" | "SCROLL_TOP" | "SCROLL_BOTTOM" | "GO_BACK";
  readonly said: string;
} | null {
  const t = text
    .toLowerCase()
    .replace(/[^a-z ]+/g, " ")
    .replace(/\b(hey|ok|okay|hi|hello)\s+q\b/g, " ")
    .replace(
      /\b(please|q|can you|could you|now|for me|a bit|a little|the page|this page|on this page|on the page)\b/g,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim();
  if (
    /^(scroll|go|move) down( more)?$|^(scroll|page) down$|^keep scrolling$|^scroll$/.test(
      t,
    )
  ) {
    return { act: "PAGE_DOWN", said: "Scrolling down." };
  }
  if (/^(scroll|go|move|page) up$/.test(t))
    return { act: "PAGE_UP", said: "Scrolling up." };
  if (
    /^(scroll |go |take me )?(to )?(the )?top$|^back to (the )?top$/.test(t)
  ) {
    return { act: "SCROLL_TOP", said: "Back to the top." };
  }
  if (/^(scroll |go |take me )?(to )?(the )?bottom$/.test(t)) {
    return { act: "SCROLL_BOTTOM", said: "To the bottom." };
  }
  if (/^go back$|^back$|^go to the previous page$/.test(t)) {
    return { act: "GO_BACK", said: "Going back." };
  }
  return null;
}
