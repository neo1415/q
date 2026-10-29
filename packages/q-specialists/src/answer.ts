import {
  appActionOf,
  pendingAppActionStore,
  type PendingAppActionStore,
  type QAppActionAsks,
  type QAppActionPort,
  type QAppActionPrepared,
  type QAppActionRedirect,
  type TurnAppAction,
} from "./app-action-turn.js";
import {
  namesWebAddress,
  PLAIN_QUESTION_FOCUS,
  toolFocusOf,
} from "./tool-focus.js";
import { callPrepLine, type QCallPrepPort } from "./call-prep.js";
import { planAskRoutes, type QPlanJobPort } from "./plan-job-port.js";
import {
  goAheadGoal,
  earlierRequestGoal,
  priorAnswerOf,
  teamJobBlocks,
  teamJobLine,
  teamJobOutcomeOf,
  type QTeamJobPort,
  type TeamJobAudience,
} from "./team-job.js";
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
  QMessageIdSchema,
  sensitivityWithin,
  type QNavigateDestination,
  type QPageManifest,
  type QResponseMessage,
  type QResultBlock,
  type QRunId,
  type QUiIntent,
  type QStageAbout,
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
  inTurnLanguage,
} from "@capital-q/q-core";
import {
  buildShownSheet,
  closestByName,
  eligibleCapabilities,
  Q_CAPABILITIES,
  SPREADSHEET_ARTIFACT_TYPE,
  spreadsheetReceipt,
  spreadsheetSections,
  tabularBlocks,
  type GetInvestorMandateOutput,
  type QCapability,
  type TabularBlock,
  toolAreaOf,
  zoneFromWords,
} from "@capital-q/q-tools";
import {
  asksForOwnMandate,
  conversationContextOf,
  ownInvestorOrganisationIn,
  reRenderAskOf,
  reshownBlocks,
  shownTurnOf,
  withoutStatusTalk,
} from "@capital-q/model-gateway/q";
import {
  cardsLaneOf,
  fastLaneOf,
  knownEntityLaneOf,
  lastShownEntityId,
  type PreparedFollowUpPort,
  dailyLaneOf,
  fitRankingLaneOf,
  type KnownEntityMatcher,
} from "./fast-lane.js";

import {
  ANSWER_DOCUMENT_ARTIFACT_TYPE,
  composeAnswerDocument,
  workTitle,
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
  type QConversationFetch,
  type QConversationMessage,
  type QLiveDeltaBus,
  type QResearchDirective,
  type QRuntimeRepositories,
  type QToolFocus,
} from "@capital-q/q-runtime";

import type { ActorContext, TenantId } from "@capital-q/security";
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
  asksToReviseDocument,
  openTarget,
  spokenRecordName,
  referenceNote,
  repeatedAction,
  rehearsalNameOf,
  rehearseWithPersonCard,
  shownItems,
  type LastAction,
  type QOpenRecordPort,
} from "./references.js";
import {
  boundedCoreSnapshot,
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
  hereFromManifest,
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
      return { ask, resolved, note: resolutionNote(ask, resolved) };
    }
  }
  // C's request: the page's own controls ("open the readiness tab", "the
  // second one" on a list the page registered without record refs).
  return control === null
    ? null
    : { ask, resolved: null, note: control.note, control };
}

import { createHash, randomUUID } from "node:crypto";

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
function controlActLine(control: PageControlChoice): string {
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
import {
  cannotOpenLine,
  cardAt,
  cardsOnScreen,
  asksToGo,
  ordinalOf,
  pageRequestOf,
  takenBack,
  wordsNamePage,
} from "./page-request.js";
import {
  resolveNamedRecord,
  withTabs,
  type OpenRecordIntent,
} from "./fast-navigation.js";
import { deckSectionSpeech, deckSpeech } from "./deck-speech.js";
import {
  screenTabTarget,
  lastOpenedScreen,
  tabAskOf,
  tabPlace,
  type TabAsk,
} from "./tab-request.js";
import { instantRequestOf, type InstantPageAct } from "./instant-request.js";
import { movePhaseLine } from "@capital-q/q-core/speech";
import {
  namedRecordRequestOf,
  ownCounterpartWithin,
} from "./named-record-request.js";
import type { TurnReferenceV64 as TurnReference } from "@capital-q/q-core";
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
  type QTurnSkim,
  type QTurnSkimmer,
} from "@capital-q/model-gateway/q";

/**
 * A speed hint only (owner 2026-10-23: "the model decides; a hint can only
 * speed things up"): words shaped as a question or a lookup. It starts the
 * nameless holding line early and decides nothing else -- never whom Q
 * looks into, never whether to research.
 */
const ASKS_SOMETHING =
  /^(tell me|who|what|what's|whats|where|when|how|why|is|are|does|do|find|search|look up|lookup|show me|give me|any|latest|news|research|check)\b|\?\s*$/iu;

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

/** Q already showed company cards in this conversation (v56). */
function companyCardsShownIn(
  history: readonly {
    readonly role: string;
    readonly blocks?: readonly QResultBlock[] | null | undefined;
  }[],
): boolean {
  return history.some(
    (message) =>
      message.role === "Q" &&
      (message.blocks ?? []).some(
        (block) =>
          block.kind === "ANSWER_CARDS" &&
          block.cards.some((card) => card.subject?.kind === "COMPANY"),
      ),
  );
}

/** Blocks that are words, not something on screen to look at again. */
const TEXT_ONLY_BLOCKS: ReadonlySet<QResultBlock["kind"]> = new Set([
  "FINDING",
  "UNCERTAINTY",
  "EVIDENCE",
  "TEXT",
  "SUMMARY",
  "COMPANY_REFERENCE",
  "INVESTOR_REFERENCE",
  "PUBLIC_SOURCE",
  "CLARIFICATION_REQUEST",
  "ATTENTION",
]);

/** Said when an earlier turn's own blocks are shown again (v54 fromShown). */
export const RESHOWN_LINE = "Here's what I showed you, back on screen.";

const ORDINAL_WORDS =
  "first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|last|1st|2nd|3rd|[4-6]th";
/**
 * "What was the second one?", "which was the third company again?",
 * "remind me what the last one was": only the name of a record Q listed,
 * asked back. Anything more ("…and why does it fit?") is a question for
 * the reading and the answer.
 */
const ORDINAL_RECALL = new RegExp(
  [
    `^(?:(?:and|so|sorry|ok(?:ay)?|wait|hold\\s+on)[,\\s]+)*(?:what|which|who)(?:'s|\\s+(?:was|is))\\s+(?:the\\s+)?(${ORDINAL_WORDS})(?:\\s+(?:one|company|investor|fund|firm|startup|card))?(?:\\s+(?:again|you\\s+(?:showed|mentioned|named|said)(?:\\s+me)?))*[\\s?.!]*$`,
    `^(?:(?:can|could)\\s+you\\s+)?remind\\s+me\\s+(?:what|which|who)\\s+(?:the\\s+)?(${ORDINAL_WORDS})(?:\\s+(?:one|company|investor|fund|firm|startup|card))?\\s+(?:was|is)(?:\\s+again)?[\\s?.!]*$`,
  ].join("|"),
  "iu",
);

/**
 * Owner live 2026-10-17 ("what was the second one?" took 3.3 s: two
 * classification calls and a 1.8 s recall reply): the name of the record
 * at that place in Q's own latest list, said by code with no model call.
 * Only Q's own list in this conversation -- what this person was already
 * shown -- and only when the words ask for nothing but that name.
 */
export function ordinalRecallLine(
  text: string,
  resolved: ResolvedReference | null,
): string | null {
  const said = text.replace(/[’]/gu, "'").trim();
  const asked = ORDINAL_RECALL.exec(said);
  if (asked === null) return null;
  if (resolved?.kind !== "ONE" || resolved.via !== "Q_ANSWER") return null;
  const name = resolved.entity.name?.trim() ?? "";
  if (name.length === 0) return null;
  const place = (asked[1] ?? asked[2] ?? "").toLowerCase();
  const word: Readonly<Record<string, string>> = {
    "1st": "first",
    "2nd": "second",
    "3rd": "third",
    "4th": "fourth",
    "5th": "fifth",
    "6th": "sixth",
  };
  return `The ${word[place] ?? place} one was ${name}.`;
}

/** The same binding from the conversation alone (Q's lists, no page). */
function ordinalRecallFromHistory(
  text: string,
  history: readonly QConversationMessage[],
): string | null {
  if (!ORDINAL_RECALL.test(text.replace(/[’]/gu, "'").trim())) return null;
  const ask = referenceAskOf(text);
  if (ask?.kind !== "ORDINAL") return null;
  const resolved = resolveReference(ask, {
    page: [],
    answers: listsFromHistory(history),
    answerIsNewest: true,
    focus: focusFromHistory(history),
  });
  return ordinalRecallLine(text, resolved);
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
    /** The run the reading is for, so its model usage is the run's. */
    readonly runId: string;
    readonly signal?: AbortSignal | undefined;
  },
  /**
   * Capital Q's own note of what was shown and the last action (follow-55),
   * read as the last recent turn so "that one" and "try again" bind.
   */
  note: string | null = null,
  /** v55: the page's own registered controls (the firewall's manifest). */
  screenControls?: QPageManifest["controls"],
) {
  // Spoken turns carry the recogniser's utterance; typed ones never do.
  // The reader needs to know which: only speech can be overheard.
  const spoken = latest.utteranceRef !== undefined;
  return {
    utterance: latest.content,
    actions,
    // v54: what Q already said and showed here, so the reader binds "the
    // second one" or "show them again" by meaning to an earlier turn.
    shown: conversationContextOf(history, latest.id).text,
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
    ...(screenControls === undefined ? {} : { screenControls }),
    attribution: {
      tenantId: context.tenantId,
      userId: context.userId,
      correlationId: context.correlationId,
      qRunId: context.runId,
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

/**
 * One more reading after the first failed, cut off at its deadline or by
 * the run's own abort; never started for a run already aborted. A reader
 * that ignores its signal is still not waited on past the deadline.
 */
async function rereadTurn<T>(
  read: (signal: AbortSignal) => Promise<T | null>,
  runSignal: AbortSignal,
  deadlineMs: number,
): Promise<T | null> {
  if (runSignal.aborted) return null;
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), deadlineMs);
  const signal = AbortSignal.any([runSignal, deadline.signal]);
  try {
    return await Promise.race([
      read(signal).catch(() => null),
      new Promise<null>((resolve) => {
        signal.addEventListener("abort", () => resolve(null), { once: true });
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

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
  /**
   * The person's own work board (owner 2026-10-23): "save that plan to my
   * board" files Q's answer and keeps it there. Absent: board asks are
   * left to the my_board tool.
   */
  readonly board?: BoardKeeper | undefined;
  readonly logger?: Logger | undefined;
  /**
   * QA F-96: the shared translation layer (q-api's localiseWords). A turn
   * that is not in English gets every English line code wrote here (a
   * pipeline summary, the board, a move) in its own language. Absent:
   * English, as before.
   */
  readonly localiseWords?:
    | ((
        who: {
          readonly tenantId: string;
          readonly userId: string;
          readonly runId: string;
          readonly turn?: string | undefined;
        },
        texts: readonly string[],
      ) => Promise<readonly (string | null)[]>)
    | undefined;
  /**
   * Reads each turn into the conversation core's closed vocabulary before
   * it is answered (CQ-QX-005). Absent: no reading, no research forced,
   * and failures carry no notice — the behaviour before the core.
   */
  readonly turns?: QTurnReader | undefined;
  /**
   * K fast lane: a short first read beside the turn reader; a HIGH
   * confidence "companies of a kind" or "fit" is answered by the read-only
   * app query before the full reading lands. Absent: no fast lane.
   */
  readonly turnSkim?: QTurnSkimmer | undefined;
  /**
   * S3 (lane S): the live delta bus the run stream publishes from, so the
   * company specialist's answer reaches a person sentence by sentence.
   * Absent: the specialist's answer arrives whole, as before.
   */
  readonly deltas?: QLiveDeltaBus | undefined;
  /**
   * The wall clock of the one extra reading tried after the gateway's own
   * attempts failed (default TURN_REREAD_DEADLINE_MS). Tests shorten it.
   */
  readonly turnRereadDeadlineMs?: number | undefined;
  /**
   * The warm prepared-entity index, as a pure in-memory matcher. A plain
   * "who is / tell me about / find <prepared entity>" is answered by code
   * with no model call at all. Absent: the normal path.
   */
  readonly knownEntities?: KnownEntityMatcher | undefined;
  /**
   * Follow-ups about a prepared entity, answered by code from its stored
   * brief: no web search, no model call. Absent: the normal path.
   */
  readonly preparedFollowUp?: PreparedFollowUpPort | undefined;
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
  /**
   * Owner live 2026-10-17: a follow-up the turn reader found answered by
   * an earlier turn of Q's in this conversation (v54 fromShown), answered
   * from that record in one tool-free call (model-gateway
   * createConversationRecall). Null: the record does not hold the answer,
   * and the full path looks it up. Absent: the full path, as before.
   */
  /**
   * Owner live 2026-10-17: what earlier runs of this conversation fetched
   * (q_runtime.conversation_tool_results), for its owner only, newest
   * first and bounded. Absent: none, as before.
   */
  readonly conversationFetched?:
    | ((scope: {
        readonly tenantId: string;
        readonly userId: string;
        readonly runId: string;
      }) => Promise<readonly QConversationFetch[]>)
    | undefined;
  readonly conversationRecall?:
    | ((
        request: QAnswerRequest,
        input: {
          readonly said: string;
          readonly recent: readonly {
            readonly role: "USER" | "Q";
            readonly text: string;
          }[];
          /** Capital Q's record of Q's own earlier turns (conversationContextOf). */
          readonly shown: string;
          /** The T number of SHOWN the reading pointed at. */
          readonly turn: number;
        },
      ) => Promise<string | null>)
    | undefined;
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
  /** Several kinds of work at once: the lead Q plans a team job. */
  readonly teamJob?: QTeamJobPort | undefined;
  /**
   * Situation-first planning (S5): a plan of their own (the reader's
   * planAsk) starts the plan job; their words to running work (the
   * reader's directsWork) are filed as direction. Absent: answered as
   * before.
   */
  readonly plan?: QPlanJobPort | undefined;
  /**
   * Owner 2026-10-23: a call with one named counterpart (TURN_READER v58
   * meetingPrep), prepared in the answer. Absent: answered as before.
   */
  readonly callPrep?: QCallPrepPort | undefined;
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
   * Coordinator 23 Oct 2026: a move to their pipeline says what is in it
   * first (pipeline-summary.ts), from their own relationships as their side
   * may see them. Null or absent: the move is said alone.
   */
  readonly destinationSummary?:
    | ((
        request: QAnswerRequest,
        destination: QNavigateDestination,
      ) => Promise<string | null>)
    | undefined;
  /**
   * QO-15: an investor's own data room requests, as their relationships'
   * Diligence tabs hold them, in one or two lines with each one's state.
   * Null when none can be read.
   */
  readonly diligenceSummary?:
    ((request: QAnswerRequest) => Promise<string | null>) | undefined;
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
  /**
   * W4: a researched person, organisation or agency the asker can already
   * reach by name -- a prepared public seed or one of their own researched
   * records -- with its identity card ready to show. No web search: the
   * fallback when a name is none of their relationships.
   */
  readonly externalEntities?:
    | {
        readonly find: (
          request: QAnswerRequest,
          name: string,
        ) => Promise<{
          readonly externalPersonId: string;
          readonly displayName: string;
          readonly said: string;
          readonly blocks: readonly QResultBlock[];
        } | null>;
      }
    | undefined;
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
/** What the answer seam needs of the work board: reading it, and adding as Q for them. */
export type BoardKeeper = {
  readonly list: (actor: ActorContext) => Promise<{
    readonly items: readonly {
      readonly id?: string;
      readonly kind?: string;
      readonly title: string;
      readonly status: "TODO" | "DOING" | "DONE";
      readonly createdBy?: "PERSON" | "Q";
      readonly createdAt?: string;
    }[];
  }>;
  readonly add: (
    actor: ActorContext,
    request: {
      readonly kind: "DOCUMENT" | "TASK" | "WORK_JOB";
      readonly title: string;
      readonly refId?: string;
    },
    options: { readonly by: "Q"; readonly idempotencyKey: string },
  ) => Promise<
    | {
        readonly outcome: "OK";
        readonly replayed: boolean;
        readonly value?: { readonly id: string };
      }
    | { readonly outcome: "REFUSED"; readonly code: string }
  >;
  /**
   * Their most recent Q job still under way (QA 2026-10-24: "save that
   * plan" after "On it. Starting now" filed only the opening line). Their
   * own jobs only, read by the server. Absent: such a save says so.
   */
  readonly latestRunningJob?: (
    actor: ActorContext,
  ) => Promise<{ readonly jobId: string } | null>;
  /** Links their item to their own Q job: it moves to DOING, then DONE. */
  readonly linkJob?: (
    actor: ActorContext,
    itemId: string,
    jobId: string,
    options: { readonly idempotencyKey: string },
  ) => Promise<{ readonly outcome: "OK" } | { readonly outcome: "REFUSED" }>;
  /** Q's own work on items they name (the board tool's WORK, by code). */
  readonly work?: (
    request: QAnswerRequest,
    itemIds: readonly string[],
  ) => Promise<{
    readonly status: string;
    readonly working: readonly { readonly title: string }[];
    readonly firstRead: string | null;
    readonly waiting: readonly string[];
    /** STARTED: the job doing it (the reply's live document card). */
    readonly jobId?: string | null | undefined;
    /** PLAN_LIMIT: the plan's own sentence (counts and reset). */
    readonly message?: string | null | undefined;
    readonly summary?: string | null | undefined;
  }>;
};

/** A job id the board port returned, checked before it is stored on a block. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

/**
 * How each of Q's own board replies opens: a later "break it into tasks"
 * or "work on those" is about the work before it, never about Q's own
 * confirmation (QA 2026-10-24: the breakdown split "Q's answer: Save that
 * plan to my board").
 */
const BOARD_REPLY_OPENERS = [
  "I've filed that",
  "I filed it as a document",
  "I've put “",
  "I've added “",
  "I've started on “",
  "Here's your board.",
  "Your board is ",
  "I couldn't add",
  "I couldn't read your board",
  "That work is still under way",
] as const;

function isBoardReply(content: string): boolean {
  const said = content.trimStart();
  return BOARD_REPLY_OPENERS.some((opener) => said.startsWith(opener));
}

/**
 * Q's answer that produced nothing to keep: a refusal or failure line
 * ("I couldn't plan this just now… nothing has started"). F-78b (live
 * 18d7884c4): saved anyway, it became a "12-month plan" item from
 * nothing. These are Q's own fixed openings, never the person's words.
 */
function producedNothing(content: string): boolean {
  const said = content.trimStart();
  // An answer that opens with a caveat and then carries the work (a list,
  // or a long body) is still the work.
  if (said.length > 700 || answerSteps(said).length > 0) return false;
  return (
    /^(?:I couldn't|I can't|I wasn't able|Sorry, I couldn't|Something failed)\b/u.test(
      said,
    ) ||
    /^(?:Work like this|Something like this) is already waiting\b/u.test(
      said,
    ) ||
    /^Taking on work like this isn't available\b/u.test(said) ||
    /^I've reached the limit of work\b/u.test(said) ||
    /\bnothing has started\b/u.test(said.slice(0, 240))
  );
}

/** Q's own line when deep work starts (team-job startedLine). */
function startsTeamJob(content: string): boolean {
  return /^On it[.,] [Ss]tarting now\b/u.test(content.trimStart());
}

/** Words in "the first open task" that describe nothing. */
const BOARD_FILLER = new Set([
  "open",
  "next",
  "main",
  "board",
  "todo",
  "to-do",
]);

const ORDINALS: Readonly<Record<string, number>> = {
  first: 0,
  "1st": 0,
  second: 1,
  "2nd": 1,
  third: 2,
  "3rd": 2,
  fourth: 3,
  "4th": 3,
  fifth: 4,
  "5th": 4,
};

/**
 * Which of their board's open items "work on …" means, from the board
 * itself: "the first task" by its place in To do, a title they say, or
 * "those" / "them" / "all of them" for the items Q added last. Empty:
 * not read here; the board tool reads it.
 */
export function boardItemsMeant(
  words: string,
  items: readonly {
    readonly id?: string;
    readonly kind?: string;
    readonly title: string;
    readonly status: string;
    readonly createdBy?: string;
    readonly createdAt?: string;
  }[],
): string[] {
  const said = words.toLowerCase();
  // Live 18d7884c4: "the first task" took the first open item, a saved
  // document, which no plan can work on. A task asked for is a task.
  const wantsTasks = /\btasks?\b|\bto-?dos?\b/u.test(said);
  const open = items.filter(
    (item): item is typeof item & { readonly id: string } =>
      item.id !== undefined &&
      item.status === "TODO" &&
      (!wantsTasks || item.kind === undefined || item.kind === "TASK"),
  );
  if (open.length === 0) return [];
  const ordered =
    /\b(first|1st|second|2nd|third|3rd|fourth|4th|fifth|5th|last)\b((?:\s+[\p{L}\d-]+){0,4}?)\s+(?:task|to-?do|item|one)s?\b/u.exec(
      said,
    ) ??
    /\b(first|1st|second|2nd|third|3rd|fourth|4th|fifth|5th|last)\b/u.exec(
      said,
    );
  const ordinal = ordered?.[1];
  if (ordinal !== undefined) {
    // F-79: "the first logistics task" is the first task about logistics,
    // never simply the first; none about it is not read here.
    const described = (ordered?.[2] ?? "")
      .split(/\s+/u)
      .filter((word) => word.length >= 4 && !BOARD_FILLER.has(word));
    const pool =
      described.length === 0
        ? open
        : open.filter((item) => {
            const title = item.title.toLowerCase();
            return described.every((word) =>
              title.includes(word.slice(0, Math.max(4, word.length - 2))),
            );
          });
    const at = ordinal === "last" ? pool.length - 1 : (ORDINALS[ordinal] ?? -1);
    const item = pool[at];
    return item === undefined ? [] : [item.id];
  }
  const named = open.filter(
    (item) => item.title.length >= 4 && said.includes(item.title.toLowerCase()),
  );
  if (named.length > 0) return named.slice(0, 5).map((item) => item.id);
  if (
    !/\b(those|these|them|all|everything|the tasks|the items)\b/u.test(said)
  ) {
    return [];
  }
  // The batch Q added last: within two minutes of the newest of its items.
  const byQ = open.filter(
    (item) => item.createdBy === "Q" && item.createdAt !== undefined,
  );
  const newest = Math.max(
    ...byQ.map((item) => Date.parse(item.createdAt ?? "")),
  );
  if (!Number.isFinite(newest)) return [];
  return byQ
    .filter((item) => newest - Date.parse(item.createdAt ?? "") <= 120_000)
    .slice(0, 5)
    .map((item) => item.id);
}

/** At most this many tasks from one answer. */
const BOARD_TASKS_MAX = 12;

/**
 * The steps an answer itself lists, in its words: its numbered or bulleted
 * lines, without their markers or emphasis. Nothing is invented: an answer
 * with no list has no steps (owner 2026-10-23, "break it into tasks").
 */
export function answerSteps(answer: string): string[] {
  const steps: string[] = [];
  for (const line of answer.split(/\r?\n/u)) {
    const item = /^\s{0,6}(?:[-*\u2022]|\d{1,2}[.)])\s+(.+)$/u.exec(line);
    const text = (item?.[1] ?? "")
      .replace(/\*\*|__|`/gu, "")
      .replace(/\s+/gu, " ")
      .trim();
    if (text.length < 3) continue;
    steps.push(text.length > 300 ? `${text.slice(0, 297)}...` : text);
    if (steps.length === BOARD_TASKS_MAX) break;
  }
  return steps;
}

/** At most this many items of a column are read out. */
const BOARD_READ_MAX = 8;

const BOARD_COLUMNS = [
  ["TODO", "To do"],
  ["DOING", "Doing"],
  ["DONE", "Done"],
] as const;

/** "What's on my board?", answered from the board itself, by column. */
export function boardReadOut(
  items: readonly { readonly title: string; readonly status: string }[],
): string {
  if (items.length === 0) {
    return "Your board is empty. Ask me to save a plan or an answer to it, or to add a task, and it'll be there.";
  }
  const lines = BOARD_COLUMNS.flatMap(([status, label]) => {
    const column = items.filter((item) => item.status === status);
    if (column.length === 0) return [];
    const shown = column.slice(0, BOARD_READ_MAX).map((item) => item.title);
    const more =
      column.length > shown.length
        ? `; and ${String(column.length - shown.length)} more`
        : "";
    return [
      `**${label}** (${String(column.length)}): ${shown.join("; ")}${more}.`,
    ];
  });
  return `Here's your board.\n\n${lines.join("\n\n")}`;
}

/**
 * A title they dictated ('add "Prep IC memo for Mizan" to my board'): a
 * new item in their words, never Q's last answer.
 */
function dictatesItem(words: string): boolean {
  return /["“”'‘’«»][^"“”'‘’«»]{3,}["“”'‘’«»]/u.test(words);
}

/**
 * The new item's title in their own words (reader v62 boardAsk ADD,
 * F-72): what they put in quotes, else what sits between "add" and "to my
 * board". Null when neither is there: the board tool reads it then.
 */
export function boardItemFromWords(words: string): string | null {
  const quoted = /["“'‘«]([^"“”'‘’«»]{3,300})["”'’»]/u.exec(words)?.[1];
  const said =
    quoted ??
    /^\s*(?:please\s+)?(?:add|put|pin|stick|create)\s+(?:a\s+(?:task|to-?do|card)\s+(?:to\s+|for\s+)?)?(.{3,300}?)\s+(?:to|on|onto|in)\s+(?:my\s+)?(?:work\s+)?(?:board|to-?dos?|to-?do list)\b/iu.exec(
      words,
    )?.[1];
  const title = said
    ?.replace(/\s+/gu, " ")
    .replace(/[.,;:!?]+$/u, "")
    .trim();
  return title === undefined || title.length < 3 ? null : title;
}

/**
 * The proper name an ask is about, as they wrote it: "a call with Savanna
 * Seed Partners" -> "Savanna Seed Partners". Used only beside the one
 * record Q's answer referenced; null when the ask names none.
 */
export function nameInAsk(question: string): string | null {
  const found =
    /\b(?:with|for|about|meet(?:ing)?|call)\s+((?:\p{Lu}[\p{L}\d&'.-]*)(?:\s+(?:\p{Lu}[\p{L}\d&'.-]*|of|and|&))*)/u.exec(
      question,
    )?.[1];
  const name = found?.replace(/\s+(?:of|and|&)$/u, "").trim();
  return name === undefined || (name.match(/\p{L}/gu)?.length ?? 0) < 3
    ? null
    : name;
}

/**
 * F-95 (live 24 Oct 2026, "Write me an IC memo on Ledgerfold"): who a piece
 * of work is about, named right after the kind of work in the ask ("memo
 * on Ledgerfold", "plan for Maji Loop"). Null when the ask names no one.
 */
export function workSubjectInAsk(question: string): string | null {
  const found =
    /\b(?:memo|plan|analysis|brief|summary|prep|report|questions|deck|one-pager)\s+(?:on|about|for|of)\s+((?:\p{Lu}[\p{L}\d&'.-]*)(?:\s+(?:\p{Lu}[\p{L}\d&'.-]*|of|and|&))*)/u.exec(
      question,
    )?.[1];
  // "…on Ledgerfold I can share": the pronoun is not part of the name.
  const name = found?.replace(/(?:\s+(?:of|and|&|I))+$/u, "").trim();
  return name === undefined || name.length < 2 ? null : name;
}

/**
 * Their ask without its "…and save it to my board" clause: the work alone,
 * for the planner. The board keeps the job itself (F11).
 */
export function withoutBoardSave(words: string): string {
  const work = words
    .replace(
      /[\s,;]*(?:\band\s+|\bthen\s+|\band\s+then\s+)*(?:please\s+)?(?:save|keep|pin|put|add|file|store)\s+(?:it|that|this|them|the\s+\w+(?:\s+\w+)?)?\s*(?:to|on|onto|in|into)\s+(?:my|our)\s+(?:work\s+)?(?:board|to-?dos?|to-?do\s+list)\b[.!?]*/giu,
      "",
    )
    .trim();
  return work.length === 0 ? words : work;
}

/**
 * Their own work board, by its words: "my board", "my work board", "my
 * to-dos", "mon tableau", "mi tablero". Offering and a guard only: it
 * names the board tool for a turn the reader left without a board ask
 * (live 91d6361f9: "add 'Prep data room' to my board" read as no board
 * ask, so my_board was never offered), and it never decides alone.
 */
export function mentionsOwnBoard(words: string): boolean {
  return /\b(?:my|our)\s+(?:work\s+)?(?:board|to-?dos?|to-?do\s+list)\b|\bmon\s+tableau\b|\bmi\s+tablero\b|\bmeu\s+quadro\b/iu.test(
    words,
  );
}

/**
 * Only asking what is on their own board ("what's on my board?", "show me
 * my work board"): read from the board by code when the reader carries no
 * LIST (before v63). Never the readiness checklist.
 */
export function asksWhatIsOnBoard(words: string): boolean {
  return /^\s*(?:(?:so\s+)?what(?:'s|\s+is|\s+are|\s+do\s+i\s+have)?\b.{0,20}\b(?:on|in)\s+(?:my|our)\s+(?:work\s+)?(?:board|to-?dos?|to-?do\s+list)\b|(?:show|open|read)\s+(?:me\s+)?(?:my|our)\s+(?:work\s+)?(?:board|to-?dos?)\b)[^.!]*\??\s*$/iu.test(
    words,
  );
}

/**
 * "the top company" in an item they dictated, as the list Q just showed
 * names it (F-72: "Prep IC memo for the top company" is Anchor's).
 */
function resolveTopOne(title: string, shownFirst: string | null): string {
  if (shownFirst === null) return title;
  return title.replace(
    /\bthe (?:top|first|1st) (?:company|one|investor|fund|founder)\b/iu,
    shownFirst,
  );
}

/** A UUID (version 5 layout) for one change Q makes, stable on a retry. */
function boardKeyOf(runId: string, what: string): string {
  const hex = createHash("sha1").update(`${runId}|board|${what}`).digest("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `5${hex.slice(13, 16)}`,
    `${((Number.parseInt(hex.slice(16, 18), 16) & 0x3f) | 0x80).toString(16)}${hex.slice(18, 20)}`,
    hex.slice(20, 32),
  ].join("-");
}

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
function onlyAMove(text: string): boolean {
  return (
    asksToGo(text) ||
    /\bopen(?:ed|ing|s)?\b/iu.test(text) ||
    !/\p{Script=Latin}/u.test(text)
  );
}

/** Their own Q Card, asked about: read and offered by the answer, never a page move (F-34). */
const NAMES_Q_CARD = /\bq[\s-]?card\b/iu;

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
function askedIn(history: readonly QConversationMessage[]): string {
  return [...history].reverse().find((m) => m.role === "USER")?.content ?? "";
}

/**
 * What Q says as it takes somebody somewhere (CQ-QACT-001). The same
 * words voice speaks for the same destinations; the screen follows the
 * UI_INTENT the message carries, through its one route map.
 */
/** Words that ask for the public web, so advice still researches (S7). */
const NAMES_THE_WEB =
  /\b(?:web|online|internet|news|press|google|public(?:ly)?\s+(?:sources?|information|record|reports?)|search(?:\s+for)?|look\s+(?:it|them|this|that)\s+up|in\s+the\s+media)\b/i;

const DESTINATION_LINES: Readonly<Record<QNavigateDestination, string>> = {
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
};

/**
 * A founder's own data room: never where an investor is taken (QO-15). The
 * line said instead is about requests, so only this page is remapped.
 */
const FOUNDER_OWN_PAGES: ReadonlySet<QNavigateDestination> = new Set([
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
 * The extra reading after a failed one is bounded: it goes to the fallback
 * model the gateway has not parked, which reads a turn in about a second;
 * one still unread after this is answered as unread rather than holding
 * the turn for another full gateway budget (production: a failed reading
 * plus its retry stacked past 10 s).
 */
const TURN_REREAD_DEADLINE_MS = 2_500;

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
    delegate: answerPath,
    repositories,
    sql,
    transactions,
    artifacts,
    logger,
    turns,
  } = dependencies;
  let last: CompanyIntelligenceResult | null = null;
  /**
   * U4/F8: a move the words asked for alongside a question, per run; the
   * answer to the question carries it (QAnswerRequest.leadBlocks).
   */
  const movesWithQuestion = new Map<string, readonly QResultBlock[]>();
  const delegate: typeof answerPath = {
    ...answerPath,
    answer: (request) => {
      const moves = movesWithQuestion.get(request.runId);
      movesWithQuestion.delete(request.runId);
      return answerPath.answer(
        moves === undefined
          ? request
          : {
              ...request,
              leadBlocks: [...(request.leadBlocks ?? []), ...moves],
            },
      );
    },
  };

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
  /** Guidance for the answer, never said as the reply (NOT_THIS_ACTION). */
  const isRedirect = (
    said: string | QAppActionPrepared | QAppActionAsks | QAppActionRedirect,
  ): said is QAppActionRedirect =>
    typeof said === "object" && "redirect" in said;
  /** What a declared action said, when it is for the person. */
  const forThePerson = (
    said:
      string | QAppActionPrepared | QAppActionAsks | QAppActionRedirect | null,
  ): string | QAppActionPrepared | QAppActionAsks | null =>
    said === null || isRedirect(said) ? null : said;
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
    about?: QStageAbout,
  ): Promise<void> {
    try {
      await transactions.run((tx) =>
        appendRunEvent(
          repositories,
          tx,
          { id: request.runId, tenantId: request.tenantId },
          {
            type: "q.stage.changed",
            data: about === undefined ? { stage } : { stage, about },
          },
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
  /**
   * F-96: each run's turn, as answerOnce read it, so recordAnswer can put
   * code's lines in its language without another read. Bounded.
   */
  const turnOfRun = new Map<string, string>();
  const rememberTurn = (runId: string, turn: string): void => {
    turnOfRun.set(runId, turn);
    if (turnOfRun.size > 256) {
      const [oldest] = turnOfRun.keys();
      if (oldest !== undefined) turnOfRun.delete(oldest);
    }
  };
  async function recordAnswer(
    request: QAnswerRequest,
    conversationId: QConversationMessage["conversationId"],
    written: string,
    blocks?: readonly QResultBlock[],
  ): Promise<QAnswerOutcome> {
    const turn = turnOfRun.get(request.runId);
    const localise = dependencies.localiseWords;
    const content =
      turn === undefined || localise === undefined
        ? written
        : await inTurnLanguage(written, turn, (texts) =>
            localise(
              {
                tenantId: request.tenantId,
                userId: request.actorUserId,
                runId: request.runId,
                turn,
              },
              texts,
            ),
          );
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

    // Owner 2026-10-23: the document is under way from here, before the
    // research behind it, so the voice line knows it is durable work and
    // never cancels it when the person carries on talking.
    await showStage(request, "PREPARING_DOCUMENT");
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
      showStage: (stage, about) => showStage(request, stage, about),
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
    history?: readonly QConversationMessage[],
    /** XLSX-002: the table the answer showed, written into the document. */
    table?: TabularBlock,
  ): Promise<DocumentReply> {
    const document = composeAnswerDocument({
      answer,
      question,
      subject:
        history === undefined
          ? null
          : await subjectOfAnswer(request, history, question ?? ""),
      ...(table === undefined ? {} : { table }),
    });
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
   * "Save that plan to my board" / "break it into tasks" (owner 2026-10-23,
   * reader v61 boardAsk): Q's previous answer is filed as their private
   * document, exactly as written (the ANSWER_EXPORT path), and kept on
   * their own board as a DOCUMENT item; for BREAKDOWN, each step the
   * answer itself lists becomes a TASK item, in its words, and Q invents
   * none. Their own board, so no card; the answer says what it did.
   * Null: not this seam's to do (no board or documents here).
   */
  async function saveAnswerToBoard(
    request: QAnswerRequest,
    conversationId: QConversationMessage["conversationId"],
    ask: "SAVE" | "BREAKDOWN",
    history: readonly QConversationMessage[],
  ): Promise<QAnswerOutcome | null> {
    const board = dependencies.board;
    if (board === undefined || artifacts === undefined) return null;
    const work = substantiveAnswer(history);
    if (work === null) {
      return recordAnswer(
        request,
        conversationId,
        "I haven't answered anything in this conversation yet, so there's nothing to keep on your board. Ask me for the plan first, then say save it to my board.",
      );
    }
    // F-78b: the last work was a plan that failed or never started (the
    // team job's own outcome line), or another answer of Q's that produced
    // nothing: there is nothing to keep.
    const lastWork = teamJobOutcomeOf(work.answer);
    if (
      (lastWork !== null && lastWork !== "STARTED") ||
      (lastWork === null && producedNothing(work.answer))
    ) {
      return recordAnswer(
        request,
        conversationId,
        "There's nothing to save yet: my last answer didn't produce the work. Ask me for it again, and once it's written I'll put it on your board.",
      );
    }
    // Deep work still under way: its document does not exist yet, so the
    // board keeps the job itself, linked, and it moves to Done with its
    // document when the work finishes. Never its opening line as a file.
    // Batch 8 (I13): the job's own card on that turn says it is still
    // under way (WORK_IN_PROGRESS, its job id) while no document has come;
    // read by structure, with the opening line as the fallback.
    const running = runningWork(work);
    if (running !== null || startsTeamJob(work.answer)) {
      return keepRunningJob(request, conversationId, board, work, running);
    }
    // "Break it into tasks" right after "save that plan": the document is
    // already on their board (Q's own confirmation carries it).
    const confirmed = boardConfirmedDocument(history);
    const made = confirmed ?? documentOn(work.message);
    const filed =
      made === null
        ? await fileAnswer(
            request,
            artifacts,
            work.answer,
            work.question,
            upToAnswer(work),
          )
        : null;
    const document =
      made ??
      (filed?.blocks ?? []).find(
        (block) => block.kind === "ARTIFACT_REFERENCE",
      );
    if (document?.kind !== "ARTIFACT_REFERENCE") {
      return recordAnswer(
        request,
        conversationId,
        filed?.content ?? "I couldn't file that just now.",
      );
    }
    if (confirmed === null) {
      const kept = await board
        .add(
          request.actor,
          {
            kind: "DOCUMENT",
            title: document.title,
            refId: document.artifactId,
          },
          {
            by: "Q",
            idempotencyKey: boardKeyOf(
              request.runId,
              `doc:${document.artifactId}`,
            ),
          },
        )
        .catch(() => ({ outcome: "REFUSED", code: "FAILED" }) as const);
      if (kept.outcome !== "OK") {
        return recordAnswer(
          request,
          conversationId,
          `I filed it as a document, but couldn't put it on your board just now${kept.code === "FULL" ? ": your board is full, so take something off it first" : ""}. The document is here.`,
          [document],
        );
      }
    }
    if (ask === "SAVE") {
      return recordAnswer(
        request,
        conversationId,
        confirmed === null
          ? `I've filed that as a document and put “${document.title}” on your board, in To do.`
          : `I've put “${document.title}” on your board already; it's in To do.`,
        [document],
      );
    }
    const steps = answerSteps(work.answer);
    if (steps.length === 0) {
      return recordAnswer(
        request,
        conversationId,
        `I've put “${document.title}” on your board. That answer doesn't list separate steps, so I kept it as one item rather than make up tasks; tell me the steps you want and I'll add them.`,
        [document],
      );
    }
    let added = 0;
    for (const [at, step] of steps.entries()) {
      const one = await board
        .add(
          request.actor,
          { kind: "TASK", title: step },
          {
            by: "Q",
            idempotencyKey: boardKeyOf(
              request.runId,
              `task:${document.artifactId}:${String(at)}`,
            ),
          },
        )
        .catch(() => ({ outcome: "REFUSED", code: "FAILED" }) as const);
      if (one.outcome === "OK") added += 1;
    }
    const tasks = added === 1 ? "1 task" : `${String(added)} tasks`;
    return recordAnswer(
      request,
      conversationId,
      added === steps.length
        ? `I've put “${document.title}” on your board, with its steps as ${tasks} in To do.`
        : `I've put “${document.title}” on your board, with ${tasks} of its ${String(steps.length)} steps in To do; the rest couldn't be added just now.`,
      [document],
    );
  }

  /**
   * "Write a 12-month growth plan and save it to my board" (F-90): Q's own
   * deep work starts, and the board keeps that job, linked, so it moves to
   * Done with its document. A plan that does not start saves nothing.
   */
  async function startWorkAndKeep(
    request: QAnswerRequest,
    conversationId: QConversationMessage["conversationId"],
    words: string,
    teamJob: QTeamJobPort,
    board: BoardKeeper,
  ): Promise<QAnswerOutcome> {
    // Batch 9 (c8d45c628): the planner saw "and save it to my board" and
    // said saving was not available in the job. The save is the board's
    // part; the planner gets only the work.
    const planned = await teamJob.propose(request, withoutBoardSave(words));
    const line = teamJobLine(planned, teamJobAudienceOf(request));
    const blocks = teamJobBlocks(planned);
    if (planned.status !== "STARTED") {
      return recordAnswer(
        request,
        conversationId,
        `${line} Nothing has gone on your board, since nothing started.`,
        blocks,
      );
    }
    // The started job itself, as the team job reports it (batch 8: the
    // latest-job read can miss a job queued a moment ago).
    const job =
      planned.jobId !== undefined
        ? { jobId: planned.jobId }
        : board.latestRunningJob === undefined
          ? null
          : await board.latestRunningJob(request.actor).catch(() => null);
    if (job === null || board.linkJob === undefined) {
      return recordAnswer(
        request,
        conversationId,
        `${line} When it's ready, ask me and I'll put it on your board.`,
        blocks,
      );
    }
    const title = workTitle({
      heading: null,
      question: words,
      subject: nameInAsk(words),
    });
    const kept = await board
      .add(
        request.actor,
        { kind: "WORK_JOB", title, refId: job.jobId },
        {
          by: "Q",
          idempotencyKey: boardKeyOf(request.runId, `job:${job.jobId}`),
        },
      )
      .catch(() => ({ outcome: "REFUSED", code: "FAILED" }) as const);
    const itemId = kept.outcome === "OK" ? kept.value?.id : undefined;
    if (itemId !== undefined) {
      await board
        .linkJob(request.actor, itemId, job.jobId, {
          idempotencyKey: boardKeyOf(request.runId, `link:${job.jobId}`),
        })
        .catch(() => ({ outcome: "REFUSED" }) as const);
    }
    return recordAnswer(
      request,
      conversationId,
      kept.outcome === "OK"
        ? `${line} I've also put it on your board as “${title}”, in Doing; it moves to Done, with its document, when the work finishes.`
        : `${line} I couldn't put it on your board just now; ask me once it's ready.`,
      blocks,
    );
  }

  /** "Save that plan" while Q's deep work on it is still under way. */
  async function keepRunningJob(
    request: QAnswerRequest,
    conversationId: QConversationMessage["conversationId"],
    board: BoardKeeper,
    work: NonNullable<ReturnType<typeof substantiveAnswer>>,
    known: { readonly jobId: string } | null = null,
  ): Promise<QAnswerOutcome> {
    const job =
      known ??
      (board.latestRunningJob === undefined || board.linkJob === undefined
        ? null
        : await board.latestRunningJob(request.actor).catch(() => null));
    if (job === null || board.linkJob === undefined) {
      return recordAnswer(
        request,
        conversationId,
        "That work is still under way, so there's no document to keep yet. When it's ready it will be in this conversation and in Documents; ask me then and I'll put it on your board.",
      );
    }
    const title = workTitle({
      heading: null,
      question: work.question ?? "",
      subject: await subjectOfAnswer(
        request,
        upToAnswer(work),
        work.question ?? "",
      ),
    });
    const kept = await board
      .add(
        request.actor,
        { kind: "WORK_JOB", title, refId: job.jobId },
        {
          by: "Q",
          idempotencyKey: boardKeyOf(request.runId, `job:${job.jobId}`),
        },
      )
      .catch(() => ({ outcome: "REFUSED", code: "FAILED" }) as const);
    const itemId = kept.outcome === "OK" ? kept.value?.id : undefined;
    if (itemId !== undefined) {
      await board
        .linkJob(request.actor, itemId, job.jobId, {
          idempotencyKey: boardKeyOf(request.runId, `link:${job.jobId}`),
        })
        .catch(() => ({ outcome: "REFUSED" }) as const);
    }
    return recordAnswer(
      request,
      conversationId,
      kept.outcome === "OK"
        ? `I've put “${title}” on your board. I'm still working on it, so it's in Doing; it moves to Done, with its document, when the work finishes.`
        : `I couldn't add “${title}” to your board just now. Ask me again in a moment.`,
    );
  }

  /**
   * The job still under way on the turn that answered their ask: a
   * WORK_IN_PROGRESS card on Q's messages of that turn, and no document
   * delivered on them yet. Null: nothing running there.
   */
  function runningWork(work: {
    readonly message: QConversationMessage;
    readonly all: readonly QConversationMessage[];
  }): { readonly jobId: string } | null {
    const at = work.all.indexOf(work.message);
    const askedAt = work.all
      .slice(0, at)
      .findLastIndex((m) => m.role === "USER");
    const latestUser = work.all.findLastIndex((m) => m.role === "USER");
    const turn = work.all
      .slice(askedAt + 1, latestUser < 0 ? work.all.length : latestUser)
      .filter((m) => m.role === "Q");
    const blocks = turn.flatMap((m) => m.blocks ?? []);
    if (blocks.some((block) => block.kind === "ARTIFACT_REFERENCE"))
      return null;
    const card = blocks.findLast((block) => block.kind === "WORK_IN_PROGRESS");
    return card?.kind === "WORK_IN_PROGRESS" ? { jobId: card.jobId } : null;
  }

  /** The conversation up to one answer, and the ask after it. */
  function upToAnswer(work: {
    readonly message: QConversationMessage;
    readonly all: readonly QConversationMessage[];
  }): readonly QConversationMessage[] {
    return [
      ...work.all.slice(0, work.all.indexOf(work.message) + 1),
      ...work.all.slice(-1),
    ];
  }

  /**
   * Q's last answer that is the work itself, with what it answered: never
   * one of Q's own board replies (QA 2026-10-24).
   */
  function substantiveAnswer(history: readonly QConversationMessage[]): {
    readonly message: QConversationMessage;
    readonly answer: string;
    readonly question?: string;
    readonly all: readonly QConversationMessage[];
  } | null {
    const latestUser = history.findLastIndex((m) => m.role === "USER");
    const before = latestUser < 0 ? history : history.slice(0, latestUser);
    const at = before.findLastIndex(
      (m) =>
        m.role === "Q" &&
        m.content.trim().length > 0 &&
        !isBoardReply(m.content),
    );
    const message = before[at];
    if (at < 0 || message === undefined) return null;
    const asked = before.slice(0, at).findLast((m) => m.role === "USER");
    return {
      message,
      answer: message.content,
      ...(asked === undefined ? {} : { question: asked.content }),
      all: history,
    };
  }

  /** The document Q's own board confirmation just before this turn carries. */
  function boardConfirmedDocument(
    history: readonly QConversationMessage[],
  ): Extract<QResultBlock, { kind: "ARTIFACT_REFERENCE" }> | null {
    const latestUser = history.findLastIndex((m) => m.role === "USER");
    const before = latestUser < 0 ? history : history.slice(0, latestUser);
    const last = before.findLast((m) => m.role === "Q");
    return last !== undefined && isBoardReply(last.content)
      ? documentOn(last)
      : null;
  }

  function documentOn(
    message: QConversationMessage,
  ): Extract<QResultBlock, { kind: "ARTIFACT_REFERENCE" }> | null {
    const block = (message.blocks ?? []).findLast(
      (one) => one.kind === "ARTIFACT_REFERENCE",
    );
    return block?.kind === "ARTIFACT_REFERENCE" ? block : null;
  }

  /**
   * "Work on the first task" (boardAsk WORK; QA 2026-10-24: declined, with
   * filler): the items meant, read from their board, and Q's own work on
   * them started by code. Null: which items is not clear from the board;
   * the board tool reads it.
   */
  async function workOnBoard(
    request: QAnswerRequest,
    conversationId: QConversationMessage["conversationId"],
    words: string,
  ): Promise<QAnswerOutcome | null> {
    const board = dependencies.board;
    if (board?.work === undefined) return null;
    const list = await board.list(request.actor).catch(() => null);
    if (list === null) return null;
    const meant = boardItemsMeant(words, list.items);
    if (meant.length === 0) {
      // A task they described that none on the board fits: ask, naming
      // what is there, rather than start on something else (F-79).
      const open = list.items.filter(
        (item) => item.status === "TODO" && (item.kind ?? "TASK") === "TASK",
      );
      if (!/\b(?:task|to-?do)s?\b/iu.test(words) || open.length === 0) {
        return null;
      }
      const names = open
        .slice(0, 6)
        .map((item) => `“${item.title}”`)
        .join("; ");
      return recordAnswer(
        request,
        conversationId,
        `I couldn't find that task on your board. Which one do you mean? In To do: ${names}.`,
      );
    }
    const outcome = await board.work(request, meant).catch((error: unknown) => {
      logger?.warn(
        { err: error, qRunId: request.runId },
        "q work on board items failed",
      );
      return null;
    });
    logger?.info(
      {
        qRunId: request.runId,
        items: meant.length,
        outcome: outcome?.status ?? "FAILED",
      },
      "q work on board items",
    );
    const titles = (outcome?.working ?? []).map((item) => `“${item.title}”`);
    const named =
      titles.length <= 1
        ? (titles[0] ?? "")
        : `${titles.slice(0, -1).join(", ")} and ${titles.at(-1) ?? ""}`;
    const line = (() => {
      if (outcome === null) {
        return "I couldn't start on that just now. Ask me again in a moment.";
      }
      switch (outcome.status) {
        case "STARTED":
          return titles.length === 0
            ? "I've started on it. It moves to Done on your board when the work finishes."
            : `I've started on ${named}: ${titles.length === 1 ? "it's" : "they're"} in Doing, and move${titles.length === 1 ? "s" : ""} to Done when the work finishes.${outcome.firstRead === null ? "" : ` My first read: ${outcome.firstRead}`}`;
        case "PREPARED":
          return "That work would reach someone outside your account, so it's waiting for your approval first; the items stay where they are until you approve.";
        case "ALREADY_WAITING":
          return `Something like this is already waiting for you${outcome.waiting[0] === undefined ? "" : `: ${outcome.waiting[0]}`}. Say go ahead and I'll start this one too.`;
        // F-108: whose limit it is, plainly; the item stays in To do.
        case "LIMIT_REACHED":
          return "Your monthly limit for Q's work is reached, so I haven't started it and the item stays in To do. You can raise the limit in Settings.";
        case "PLAN_LIMIT":
          return `Your plan's allowance for Q's work this month is used, so I haven't started it and the item stays in To do.${outcome.message == null ? "" : ` ${outcome.message.trim()}`}`;
        case "NOT_PLANNED":
          return "I couldn't turn that item into work I can carry out for you. Tell me what you want at the end of it (a memo, a list of questions, a short plan) and I'll start.";
        case "NOT_FOUND":
          return "That item isn't open on your board any more, so there's nothing to start. Ask me what's on your board to see what is.";
        case "FAILED":
          return "I couldn't plan that task: the planning step failed on my side, so nothing has started and the item stays in To do.";
        default:
          return "I couldn't start on that just now. Ask me again in a moment.";
      }
    })();
    // Owner 2026-10-24: work started from the board is followed by the
    // same live card as work asked for in words (teamJobBlocks), titled in
    // the plan's words, or the item's when there is no plan summary.
    const following =
      outcome?.status === "STARTED" &&
      typeof outcome.jobId === "string" &&
      UUID.test(outcome.jobId)
        ? teamJobBlocks({
            status: "STARTED",
            jobId: outcome.jobId,
            firstRead: null,
            plan: {
              summary:
                outcome.summary?.trim() ||
                outcome.working[0]?.title ||
                "Your document",
              steps: [],
              needsYou: [],
              cannot: [],
            },
          })
        : undefined;
    return recordAnswer(request, conversationId, line, following);
  }

  /** "What's on my board?" (boardAsk LIST): read from the board, by code. */
  async function readBoard(
    request: QAnswerRequest,
    conversationId: QConversationMessage["conversationId"],
  ): Promise<QAnswerOutcome | null> {
    const board = dependencies.board;
    if (board === undefined) return null;
    const list = await board.list(request.actor).catch(() => null);
    if (list === null) {
      return recordAnswer(
        request,
        conversationId,
        "I couldn't read your board just now. Ask me again in a moment.",
      );
    }
    return recordAnswer(request, conversationId, boardReadOut(list.items));
  }

  /**
   * Who Q's last answer is about (F-73), from records, never guessed: the
   * one company or person its cards show, else their own company when the
   * ask names it. Null: unknown, and the title says only what it is.
   */
  async function subjectOfAnswer(
    request: QAnswerRequest,
    history: readonly QConversationMessage[],
    question: string,
  ): Promise<string | null> {
    const latestUser = history.findLastIndex((m) => m.role === "USER");
    const before = latestUser < 0 ? history : history.slice(0, latestUser);
    const answer = before.findLast((m) => m.role === "Q");
    const named = [
      ...new Set(
        (answer === undefined ? [] : shownItems([answer]))
          .filter((item) => item.kind === "NAMED")
          .map((item) => item.name),
      ),
    ];
    if (named.length === 1) return named[0] ?? null;
    // Live 6b05d53a4: "Help me prepare for a call with Savanna Seed
    // Partners" answered with the investor's reference, no card. One
    // record referenced, and its name as they said it in the ask.
    const referenced = new Set(
      (answer?.blocks ?? []).flatMap((block) =>
        block.kind === "COMPANY_REFERENCE"
          ? [block.companyId]
          : block.kind === "INVESTOR_REFERENCE"
            ? [block.investorOrganisationId]
            : [],
      ),
    );
    // Live 9ff4a1118: the call-prep answer carried no blocks at all, so
    // the name they gave in the ask is the subject whenever the answer
    // shows no one else (one record referenced, or none).
    if (referenced.size <= 1 && named.length === 0) {
      const asked = nameInAsk(question);
      if (asked !== null) return asked;
    }
    const own = await dependencies.ownRecords
      ?.read(request)
      .catch(() => NO_OWN_RECORDS);
    const said = question.toLowerCase();
    return (
      own?.company?.names.find(
        (name) => name.length > 1 && said.includes(name.toLowerCase()),
      ) ??
      // F-95 (live 24 Oct, "Write me an IC memo on Ledgerfold"): the answer
      // held no card or reference, and the memo was titled "Memo". The name
      // as they said it in the ask, after the kind of work, is who it is
      // about.
      workSubjectInAsk(question)
    );
  }

  /**
   * "Add 'Prep IC memo for Mizan' to my board" (reader v62 ADD, F-72): a
   * new to-do in their words, on their own board, by code. Null: no title
   * in their words, or no board here; the board tool reads it then.
   */
  async function addItemToBoard(
    request: QAnswerRequest,
    conversationId: QConversationMessage["conversationId"],
    words: string,
    history: readonly QConversationMessage[],
  ): Promise<QAnswerOutcome | null> {
    const board = dependencies.board;
    const said = boardItemFromWords(words);
    if (board === undefined || said === null) return null;
    const first =
      shownItems(history).find((item) => item.kind === "NAMED")?.name ?? null;
    const title = resolveTopOne(said, first);
    const added = await board
      .add(
        request.actor,
        { kind: "TASK", title },
        { by: "Q", idempotencyKey: boardKeyOf(request.runId, `add:${title}`) },
      )
      .catch(() => ({ outcome: "REFUSED", code: "FAILED" }) as const);
    return recordAnswer(
      request,
      conversationId,
      added.outcome === "OK"
        ? `I've added “${title}” to your board, in To do.`
        : added.code === "FULL"
          ? "Your board is full, so I couldn't add that. Take something off it first and ask me again."
          : `I couldn't add “${title}” to your board just now. Ask me again in a moment.`,
    );
  }

  /**
   * The answer Q gave before this turn, and what it answered: the one a
   * "put that in a PDF" means.
   */
  function previousAnswer(history: readonly QConversationMessage[]): {
    readonly answer: string;
    readonly question?: string;
    readonly messageId: string;
    readonly blocks: readonly QResultBlock[];
  } | null {
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
      messageId: answer.id,
      blocks: answer.blocks ?? [],
    };
  }

  /**
   * XLSX-002 (live 2026-10-28: "put that side-by-side thing … into a file I
   * can send to the committee" made a PDF that said the comparison was "on
   * screen"). The reader read an export of Q's earlier answer; when that
   * answer showed a table, a comparison or cards, its file is a
   * spreadsheet (Excel and CSV) first, built by code from the block, and a
   * PDF holding the same table beside it as the alternative. Null: the
   * answer showed nothing tabular, so the PDF alone is the file.
   */
  async function fileTabularAnswer(
    request: QAnswerRequest,
    preparation: ArtifactPreparation,
    previous: NonNullable<ReturnType<typeof previousAnswer>>,
    history: readonly QConversationMessage[],
  ): Promise<DocumentReply | null> {
    const table = tabularBlocks(previous.blocks)[0];
    if (table === undefined) return null;
    const built = buildShownSheet(
      [table],
      {
        messageId: previous.messageId,
        today: new Date().toISOString().slice(0, 10),
      },
      {},
    );
    const pdf = await fileAnswer(
      request,
      preparation,
      previous.answer,
      previous.question,
      history,
      table,
    );
    if (built === null) return pdf;
    await showStage(request, "PREPARING_DOCUMENT");
    try {
      const summary = await preparation.port.prepare({
        actorContext: request.actor,
        permittedContextPlan: request.plan,
        qRunId: request.runId,
        artifactType: SPREADSHEET_ARTIFACT_TYPE,
        content: {
          title: built.title,
          summary: built.summary,
          content: {
            sections: spreadsheetSections(built),
            gaps: [...built.gaps],
            workbook: built.workbook,
          },
        },
      });
      const pdfCards = (pdf.blocks ?? []).filter(
        (block) => block.kind === "ARTIFACT_REFERENCE",
      );
      return {
        content: [
          spreadsheetReceipt(built),
          pdfCards.length > 0
            ? "The second card is a PDF with the same table, if the committee would rather have one."
            : null,
        ]
          .filter((line): line is string => line !== null)
          .join(" "),
        blocks: [
          {
            kind: "ARTIFACT_REFERENCE",
            artifactId: summary.artifactId,
            type: summary.type,
            status: summary.status,
            title: summary.title,
          },
          ...pdfCards,
        ],
      };
    } catch (error: unknown) {
      if (request.signal?.aborted === true) throw error;
      logger?.warn(
        { err: error, qRunId: request.runId },
        "a shown table could not be filed as a spreadsheet",
      );
      // The PDF, which holds the same table, still stands.
      return pdf;
    }
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
      return (
        (await fileTabularAnswer(request, artifacts, previous, history)) ??
        fileAnswer(
          request,
          artifacts,
          previous.answer,
          previous.question,
          history,
        )
      );
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
      // The reader's move is followed only when their words ask for that
      // page (live 2026-10-09: statements and negations moved the screen).
      const words = askedIn(history);
      if (
        (!wordsNamePage(words, { kind: "DESTINATION", destination }) &&
          /\p{Script=Latin}/u.test(words)) ||
        NAMES_Q_CARD.test(words)
      ) {
        logger?.info(
          { qRunId: request.runId, destination },
          "q did not move: the words do not ask for that page",
        );
        return null;
      }
      // U4/F8: a move with a question after it goes with the answer.
      if (questionAfterMove(askedIn(history))) {
        movesWithQuestion.set(request.runId, [
          { kind: "UI_INTENT", intent: { kind: "NAVIGATE", destination } },
        ]);
        logger?.info(
          { qRunId: request.runId, destination },
          "a screen and a question: the move goes with the answer",
        );
        return null;
      }
      logger?.info(
        { qRunId: request.runId, destination },
        "q is taking the person to a screen",
      );
      const placed = forTheirSide(
        request,
        naturalPlaceLine(DESTINATION_LINES[destination], askedIn(history)),
        [{ kind: "UI_INTENT", intent: { kind: "NAVIGATE", destination } }],
      );
      return recordAnswer(
        request,
        conversationId,
        await withDestinationSummary(
          request,
          placed.said,
          placed.blocks,
          placed.requests,
        ),
        placed.blocks,
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
  /**
   * QO-15 (QA 2026-10-23): an investor's "take me to my data room
   * requests" opened a founder's page (a dead end) and Q said "Opened your
   * data room". A founder's own pages are never an investor's: their
   * requests live on each relationship's Diligence tab, so the CRM opens
   * and Q says so, with the requests it can read.
   */
  const forTheirSide = (
    request: QAnswerRequest,
    said: string,
    blocks: readonly QResultBlock[],
  ): {
    readonly said: string;
    readonly blocks: readonly QResultBlock[];
    readonly requests: boolean;
  } => {
    if (ownInvestorOrganisationIn(request.plan) === null) {
      return { said, blocks, requests: false };
    }
    const moved = blocks.find(
      (block) =>
        block.kind === "UI_INTENT" &&
        block.intent.kind === "NAVIGATE" &&
        FOUNDER_OWN_PAGES.has(block.intent.destination),
    );
    if (moved === undefined) return { said, blocks, requests: false };
    return {
      said: "Your data room requests are on each company's Diligence tab in the CRM, so I've opened the CRM.",
      blocks: blocks.map((block) =>
        block === moved
          ? {
              kind: "UI_INTENT" as const,
              intent: {
                kind: "NAVIGATE" as const,
                destination: "RELATIONSHIPS",
              },
            }
          : block,
      ),
      requests: true,
    };
  };

  /** One line of what is there, before the move, when Q has it. */
  const withDestinationSummary = async (
    request: QAnswerRequest,
    said: string,
    blocks: readonly QResultBlock[],
    requests = false,
  ): Promise<string> => {
    if (requests) {
      const listed = await (
        dependencies.diligenceSummary?.(request) ?? Promise.resolve(null)
      ).catch(() => null);
      return listed === null ? said : `${listed} ${said}`;
    }
    const moved = blocks.find(
      (block) => block.kind === "UI_INTENT" && block.intent.kind === "NAVIGATE",
    );
    const destination =
      moved?.kind === "UI_INTENT" && moved.intent.kind === "NAVIGATE"
        ? moved.intent.destination
        : null;
    if (destination === null || dependencies.destinationSummary === undefined)
      return said;
    const summary = await dependencies
      .destinationSummary(request, destination)
      .catch(() => null);
    return summary === null ? said : `${summary} ${said}`;
  };

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
    // "Tell me (more) about the second one" is a question: answered with
    // the record bound, never a move (QA F-41).
    if (position !== null && !asksToGo(text)) return null;
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
  /**
   * W4 ("take me to Shadi Qishta", "rehearse with Shadi Qishta"): a name
   * that is none of their relationships but is a researched entity they
   * can reach (prepared seed or their own research). Opens its identity
   * card in focus, or the rehearsal lobby when "rehearse" is said (through
   * open_page's authorize step). Null: not such a request or no such entity.
   */
  const externalEntityAnswer = async (
    request: QAnswerRequest,
    text: string,
    mode: "REHEARSE" | "OPEN",
  ): Promise<{
    readonly said: string;
    readonly blocks: readonly QResultBlock[];
  } | null> => {
    const finder = dependencies.externalEntities;
    if (finder === undefined) return null;
    const name =
      mode === "REHEARSE"
        ? rehearsalNameOf(text)
        : (namedRecordRequestOf(text)?.name ?? null);
    if (name === null) return null;
    // Their own counterparts keep their own, richer paths.
    const own = await (
      dependencies.counterpartNames?.(request) ?? Promise.resolve([])
    ).catch(() => [] as readonly string[]);
    if (own.some((one) => one.toLowerCase() === name.toLowerCase())) {
      return null;
    }
    const hit = await finder.find(request, name).catch(() => null);
    if (hit === null) return null;
    if (mode === "REHEARSE") {
      const port = dependencies.openRecord;
      if (port === undefined) return null;
      const intent = await port
        .open(request, {
          page: "EXTERNAL_REHEARSAL",
          id: hit.externalPersonId,
          name: hit.displayName,
        })
        .catch(() => null);
      if (intent === null) return null;
      return {
        said: `Opening a rehearsal with ${hit.displayName}. It is an AI rehearsal informed by public sources, not the real person.`,
        blocks: [{ kind: "UI_INTENT", intent }],
      };
    }
    return { said: hit.said, blocks: hit.blocks };
  };

  /**
   * N2: the pitch deck was asked for (or one of its sections): it opens in
   * its viewer and Q speaks what the deck says, composed by code from the
   * sections the person may read (read_company_deck's own authorize step,
   * the Context Firewall's plan). A deck they may not see is a plain
   * refusal: no intent, no summary, nothing of its content.
   */
  const withDeckSpoken = async (
    request: QAnswerRequest,
    intent: OpenRecordIntent,
    name: string | null,
    said: string,
  ): Promise<{
    readonly said: string;
    readonly blocks: readonly QResultBlock[];
    readonly refused: boolean;
  }> => {
    const onDeck = intent.tab === "deck" || intent.page === "COMPANY_DECK";
    const reader = dependencies.openRecord?.deck;
    if (
      !onDeck ||
      (intent.viewer !== "OPEN" && intent.subTab === undefined) ||
      reader === undefined
    ) {
      return {
        said,
        blocks: [{ kind: "UI_INTENT", intent }],
        refused: false,
      };
    }
    const view = await reader(request, intent.id).catch(() => null);
    if (view === null) {
      return {
        said:
          name === null
            ? "There is no pitch deck I can open for you here."
            : `There is no pitch deck of ${name}'s that I can open for you.`,
        blocks: [],
        refused: true,
      };
    }
    return {
      said:
        intent.subTab === undefined
          ? deckSpeech(name, view)
          : deckSectionSpeech(name, intent.subTab, view),
      blocks: [{ kind: "UI_INTENT", intent }],
      refused: false,
    };
  };

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
    if (resolved.kind !== "OPEN") {
      return { said: resolved.said, blocks: [], log: resolved.log };
    }
    const spoken = await withDeckSpoken(
      request,
      resolved.intent,
      resolved.name,
      resolved.said,
    );
    return {
      ...spoken,
      log: spoken.refused
        ? "DECK_NOT_SHARED"
        : `${resolved.own ? "OWN" : "REACHABLE"}_${resolved.page}`,
    };
  };

  /**
   * N2: a tab, sub-tab or the deck asked for without a name ("open their
   * team tab", "go to diligence", "show the deck"): the company or
   * investor on the screen is the one meant. Read by code, opened through
   * open_page's own authorize step; with nothing relevant on screen it is
   * null and the other readers take the words.
   */
  const screenTabAnswer = async (
    request: QAnswerRequest,
    text: string,
    history: readonly QConversationMessage[],
  ): Promise<{
    readonly said: string;
    readonly blocks: readonly QResultBlock[];
    readonly log: string;
  } | null> => {
    const port = dependencies.openRecord;
    const ask = tabAskOf(text);
    if (port === undefined || ask === null || ask.name !== null) return null;
    const target =
      screenTabTarget(request.plan.screen, ask) ??
      screenTabTarget(lastOpenedScreen(history), ask);
    if (target === null) return null;
    const opened = await port
      .open(request, { page: target.page, id: target.id })
      .catch(() => null);
    if (opened === null) return null;
    const intent = withTabs(opened, ask);
    if (intent.tab === undefined) return null;
    const said = movePhaseLine("PENDING", tabPlace(ask));
    const spoken = await withDeckSpoken(request, intent, null, said);
    return {
      said: spoken.said,
      blocks: spoken.blocks,
      log: spoken.refused ? "DECK_NOT_SHARED" : `SCREEN_${ask.tab}`,
    };
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
    if ((ordinalOf(text) === null || !asksToGo(text)) && !ask.correction) {
      return null;
    }
    // Q's own company cards: the existing card path talks about the card.
    if (
      resolved.via === "Q_ANSWER" &&
      resolved.entity.kind === "COMPANY" &&
      !ask.correction
    ) {
      return null;
    }
    // Lane S 2026-10-15 (audit 10-14: "Open the first relationship in this
    // pipeline." answered "Understood."): a relationship, a deal or a row of
    // the pipeline is that relationship's page, not the profile.
    const relationship = /\b(?:relationships?|pipeline|deals?)\b/iu.test(text);
    const page =
      resolved.entity.kind === "COMPANY"
        ? relationship
          ? ("RELATIONSHIP_COMPANY" as const)
          : ("COMPANY" as const)
        : resolved.entity.kind === "INVESTOR_ORGANISATION"
          ? relationship
            ? ("RELATIONSHIP_INVESTOR" as const)
            : ("INVESTOR" as const)
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
      .save(
        scope,
        boundedCoreSnapshot({
          v: 1,
          unclearInARow: unclearInARow.get(id) ?? 0,
          lastAction: lastActed.get(id) ?? null,
          sequence: sequences.get(id) ?? null,
          focus: focuses.get(id) ?? null,
        } as const),
      )
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
  /**
   * The same, by the person (tenant and user): a conversation's first turn
   * has no actions of its own yet, but the person's last plan usually
   * offered exactly the same ones, so its early reading can be made from
   * them. Still taken up only on an exact match with this turn's own plan;
   * the reader is never told an action this person was not last offered.
   */
  const lastActionsByActor = new Map<string, string>();
  const actorKeyOf = (tenantId: string, userId: string): string =>
    `${tenantId}:${userId}`;
  /** Early readings by run, bounded; dropped on refusal or when unused. */
  type EarlyReading = {
    readonly messageId: string;
    readonly actionsKey: string;
    readonly reading: Promise<Awaited<ReturnType<QTurnReader["read"]>> | null>;
  };
  const prereads = new Map<string, Promise<EarlyReading | null>>();
  /** K fast lane: the short first read, begun beside the firewall. */
  const preskims = new Map<
    string,
    {
      readonly messageId: string;
      readonly skim: Promise<QTurnSkim | null>;
    }
  >();
  const skimInput = (
    who: {
      readonly runId: string;
      readonly tenantId: string;
      readonly correlationId: string;
      readonly actor: { readonly userId: string };
      readonly signal?: AbortSignal | undefined;
    },
    history: readonly QConversationMessage[],
    latest: QConversationMessage,
  ) => ({
    utterance: latest.content,
    recentTurns: history
      .filter((message) => message.id !== latest.id)
      .slice(-2)
      .map((message) => ({
        role: message.role === "USER" ? ("USER" as const) : ("Q" as const),
        text: message.content,
      })),
    attribution: {
      tenantId: who.tenantId,
      userId: who.actor.userId,
      qRunId: who.runId,
      correlationId: who.correlationId,
    },
    signal: who.signal,
  });
  const PREREADS_MAX = 64;

  /**
   * Turn latency row 5: the conversation the early read loaded beside the
   * firewall, taken once by the same run's answer instead of read again.
   * Same tenant and run only, and only while fresh; taken means gone, so
   * any later read in the run (a turn heard again) reads anew.
   */
  const preloaded = new Map<
    string,
    {
      readonly at: number;
      readonly tenantId: TenantId;
      readonly history: Promise<readonly QConversationMessage[]>;
    }
  >();
  const PRELOADED_FRESH_MS = 5_000;
  const readHistory = (tenantId: TenantId, runId: QRunId) =>
    repositories.messages.listRecentForConversationOfRun(
      sql,
      tenantId,
      runId,
      64,
    );
  const historyOfRun = (
    tenantId: TenantId,
    runId: QRunId,
  ): Promise<readonly QConversationMessage[]> => {
    const kept = preloaded.get(runId);
    preloaded.delete(runId);
    if (
      kept === undefined ||
      kept.tenantId !== tenantId ||
      Date.now() - kept.at >= PRELOADED_FRESH_MS
    ) {
      return readHistory(tenantId, runId);
    }
    return kept.history.catch(() => readHistory(tenantId, runId));
  };

  /**
   * The turn is about someone across a relationship: a company subject on
   * an investor's run (their own organisation bound in the plan), or a
   * request to act that names one of their relationships' counterparts,
   * matched by the same name matcher every reference uses. Read only for a
   * request to act, and never a reason to show anything: it brings the
   * Relationships area's actions into the offer, which authorize decides.
   */
  /**
   * Their counterparts' names, read once per run: started beside the turn
   * reading (latency) and taken up after it. A read of their own
   * relationships under the run's own actor; it changes nothing.
   */
  const counterpartReads = new Map<string, Promise<readonly string[]>>();
  const counterpartsOf = (
    request: QAnswerRequest,
  ): Promise<readonly string[]> => {
    const port = dependencies.counterpartNames;
    if (port === undefined) return Promise.resolve([]);
    const started = counterpartReads.get(request.runId);
    if (started !== undefined) return started;
    const reading = port(request).catch(() => [] as readonly string[]);
    counterpartReads.set(request.runId, reading);
    while (counterpartReads.size > PREREADS_MAX) {
      const oldest = counterpartReads.keys().next().value;
      if (oldest === undefined) break;
      counterpartReads.delete(oldest);
    }
    return reading;
  };
  /** An investor's run on a company: across a relationship by its plan. */
  const companyAcrossRelationship = (request: QAnswerRequest): boolean =>
    ownInvestorOrganisationIn(request.plan) !== null &&
    request.subjects.some((subject) => subject.kind === "COMPANY");

  const aboutCounterparty = async (
    request: QAnswerRequest,
    utterance: string,
    read: { readonly kind: string } | null,
  ): Promise<boolean> => {
    if (read?.kind !== "TOOL_REQUEST") return false;
    if (companyAcrossRelationship(request)) return true;
    const names = await counterpartsOf(request);
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

  const instantLaneOf = (
    utterance: string,
    history: readonly QConversationMessage[] = [],
  ) =>
    (dependencies.knownEntities === undefined
      ? null
      : knownEntityLaneOf(utterance, dependencies.knownEntities)) ??
    // Owner 2026-10-24 (a word list never decides): which investors to
    // discover -- the place, kind and sector as said -- is the quick first
    // read's understanding (TURN_SKIM v8), never a list of place words,
    // which dropped "family offices" and "fintech" from the ask.
    dailyLaneOf(utterance, lastAnswerShowedCards(history));

  /**
   * The permitted plan binds their own investor mandate to this actor, run
   * and tenant (only an owner receives it). A routing condition only: it
   * grants nothing; the delegate still reads through the same plan.
   */
  const ownMandateInPlan = (request: QAnswerRequest): boolean =>
    request.actor.organisationId !== undefined &&
    request.plan.actor.organisationId === request.actor.organisationId &&
    request.plan.actor.userId === request.actor.userId &&
    request.plan.tenantId === request.tenantId &&
    request.plan.runId === request.runId &&
    request.plan.scopes.some(
      (scope) =>
        scope.kind === "INVESTOR_MANDATE" &&
        scope.subject?.kind === "INVESTOR_ORGANISATION" &&
        scope.subject.investorOrganisationId ===
          scope.filter.investorOrganisationId &&
        scope.filter.tenantId === request.tenantId,
    );

  /** S2: a plain fit ranking, only over their own firewall-bound mandate. */
  const ownFitRankingOf = (request: QAnswerRequest, text: string) => {
    const lane = fitRankingLaneOf(text);
    return lane !== null && ownMandateInPlan(request) ? lane : null;
  };

  /**
   * S2: words that code answers before any reading -- a page by its name,
   * a bare screen command, a cards request, a plain fit ranking. The early
   * skim and turn reading are not begun for them (live 2026-10-15: 64 of
   * 70 runs that only navigated still paid 1-2 classification calls).
   * Words only, so this can never widen what is answered; when a code lane
   * then declines (a page not navigable here), the reading is made later.
   */
  const codeAnswersWords = (text: string): boolean =>
    (pageRequestOf(text) !== null && !takenBack(text)) ||
    screenActOfTurn(text) !== null ||
    cardsLaneOf(text) !== null ||
    fitRankingLaneOf(text) !== null ||
    // Owner 2026-10-20: a tab by its name ("open the data room", "now the
    // pitch deck") is opened by code (screenTabAnswer / namedRecordAnswer);
    // its early skim and reading were two model calls nobody used.
    (tabAskOf(text) !== null && !takenBack(text));

  /**
   * Whether the early skim can still decide anything for this turn. Its
   * fast lane is never taken once Q has shown blocks here (a follow-up is
   * the full reading's, owner live 2026-10-17), so after cards a typed
   * turn's skim was a model call made only to be ignored. A spoken turn
   * keeps it: the skim also gates the voice speculation.
   */
  const skimUsable = (
    history: readonly QConversationMessage[],
    latest: QConversationMessage,
  ): boolean =>
    (latest.utteranceRef !== undefined &&
      dependencies.speculation?.spoken === true) ||
    !conversationContextOf(history, latest.id).turns.some(
      (turn) => turn.blocks.length > 0,
    );

  /** A follow-up about a prepared entity, composed by code; null if none. */
  const preparedFollowUpOf = (
    utterance: string,
    history: Parameters<typeof lastShownEntityId>[0],
  ): string | null =>
    dependencies.preparedFollowUp?.({
      utterance,
      lastShownEntityId: lastShownEntityId(history),
    }) ?? null;

  /**
   * Turns already given a holding line, and whether it named anyone, so a
   * re-read never says it twice: the quick hint's nameless line may give
   * way once to the line naming whom the skim understood, never the other
   * way round.
   */
  const heldRuns = new Map<string, "HINT" | "NAMED">();
  const sayHolding = (
    request: QAnswerRequest,
    name: string | null,
    /** v7 skim: they asked Q to write or send something (QA F-23). */
    writes = false,
  ): void => {
    const deltas = dependencies.deltas;
    if (deltas === undefined) return;
    const held = heldRuns.get(request.runId);
    if (held === "NAMED" || (held === "HINT" && name === null && !writes)) {
      return;
    }
    if (request.writingDocument === true || request.askedAction !== undefined) {
      return;
    }
    if (request.plan.screen?.route === "ONBOARDING") return;
    heldRuns.set(request.runId, name === null && !writes ? "HINT" : "NAMED");
    while (heldRuns.size > PREREADS_MAX) {
      const oldest = heldRuns.keys().next().value;
      if (oldest === undefined) break;
      heldRuns.delete(oldest);
    }
    deltas.publish({
      runId: request.runId,
      tenantId: request.tenantId,
      messageId: QMessageIdSchema.parse(randomUUID()),
      text: writes
        ? name === null
          ? "Drafting that now. "
          : `Drafting that note to ${name.slice(0, 60)} now. `
        : name === null
          ? "Looking into that now. "
          : `Looking into ${name.slice(0, 60)} now. `,
      holding: true,
    });
  };

  const preread = (input: QPrereadInput): void => {
    if (turns === undefined || prereads.has(input.runId)) return;
    const started = (async (): Promise<EarlyReading | null> => {
      // The run's own conversation, read as its owner: the same read the
      // answer makes, under the actor preflight has just checked -- and
      // kept for that answer (row 5), so it is made once per run.
      const loading = readHistory(input.tenantId, input.runId);
      preloaded.set(input.runId, {
        at: Date.now(),
        tenantId: input.tenantId,
        history: loading,
      });
      while (preloaded.size > PREREADS_MAX) {
        const oldest = preloaded.keys().next().value;
        if (oldest === undefined) break;
        preloaded.delete(oldest);
      }
      const history = await loading;
      const conversationId = history[0]?.conversationId;
      const latest = [...history].reverse().find((m) => m.role === "USER");
      if (conversationId === undefined || latest === undefined) return null;
      // B5: a pleasantry is answered by code; its reading would be waste.
      if (pleasantryOf(latest.content) !== null) return null;
      // A plain mandate recall is routed after the firewall supplies its
      // own mandate scope; starting classifiers here would still waste calls.
      if (asksForOwnMandate(latest.content)) return null;
      // An instant known-entity lookup is answered by code: no reading.
      if (instantLaneOf(latest.content, history) !== null) return null;
      if (preparedFollowUpOf(latest.content, history) !== null) return null;
      if (codeAnswersWords(latest.content)) return null;
      // "What was the second one?" after Q's list: its name, by code.
      if (ordinalRecallFromHistory(latest.content, history) !== null) {
        return null;
      }
      // K fast lane: the short first read starts as early as the reading,
      // only where its lane could still be taken (see skimUsable).
      if (
        dependencies.turnSkim !== undefined &&
        !preskims.has(input.runId) &&
        skimUsable(history, latest)
      ) {
        preskims.set(input.runId, {
          messageId: latest.id,
          skim: dependencies.turnSkim
            .skim(skimInput(input, history, latest))
            .catch(() => null),
        });
        while (preskims.size > PREREADS_MAX) {
          const oldest = preskims.keys().next().value;
          if (oldest === undefined) break;
          preskims.delete(oldest);
        }
      }
      const key =
        lastActions.get(conversationId) ??
        lastActionsByActor.get(actorKeyOf(input.tenantId, input.actor.userId));
      // A person this process has not yet read for: read later.
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
              runId: input.runId,
              signal: input.signal,
            },
            referenceNote(
              shownItems(history),
              lastActed.get(conversationId) ?? null,
            ),
            input.screenControls,
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

  /** Asks that make a deck rather than open one. */
  const MAKES_A_DECK =
    /\b(?:draft|make|create|build|write|prepare|generate|improve|rewrite|edit|redo|fix|polish|design|update)\b/iu;
  const DECK_WORD = /\b(?:pitch\s+)?deck\b/iu;

  const openDeckAsked = async (
    request: QAnswerRequest,
    conversationId: QConversationMessage["conversationId"],
    history: readonly QConversationMessage[],
    target: {
      readonly id?: string | undefined;
      readonly name?: string | undefined;
    },
  ): Promise<QAnswerOutcome | null> => {
    const port = dependencies.openRecord;
    const said = [...history].reverse().find((m) => m.role === "USER")?.content;
    if (port === undefined || said === undefined) return null;
    if (MAKES_A_DECK.test(said) || !DECK_WORD.test(said)) return null;
    const ask = tabAskOf(said);
    const name = ask?.name ?? target.name ?? null;
    const screenAsk: TabAsk = ask ?? {
      tab: "deck",
      subTab: null,
      name: null,
      viewer: true,
    };
    if (screenAsk.tab !== "deck") return null;
    const opened =
      target.id !== undefined || name !== null
        ? await port
            .open(request, {
              page: "COMPANY_DECK",
              ...(target.id === undefined
                ? { name: name ?? "" }
                : { id: target.id }),
            })
            .catch(() => null)
        : await (async () => {
            const onScreen = screenTabTarget(request.plan.screen, screenAsk);
            return onScreen === null
              ? null
              : port.open(request, onScreen).catch(() => null);
          })();
    if (opened === null) return null;
    const intent = withTabs(opened, screenAsk);
    const spoken = await withDeckSpoken(
      request,
      intent,
      name === null ? null : spokenRecordName(name),
      movePhaseLine("PENDING", tabPlace(screenAsk)),
    );
    logger?.info(
      { qRunId: request.runId, refused: spoken.refused },
      "q opened a company's pitch deck the turn pointed at",
    );
    return recordAnswer(request, conversationId, spoken.said, spoken.blocks);
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
      // Live 2026-10-11 (investor rehearsal): on Ledgerfold's own page,
      // "What does this company actually do and why does it fit my
      // mandate?" was read as "open it", and Q answered by re-opening the
      // page they were on, with no evidence. Opening the page already on
      // screen never answers a question: the answer path does.
      if (alreadyOnScreen(request, intent) && asksAQuestion(askedIn(history))) {
        logger?.info(
          { qRunId: request.runId, page },
          "the record the turn pointed at is already on screen; answered instead",
        );
        return null;
      }
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
    // N2 (live 2026-10-10: "open <company>'s pitch deck" read as a
    // DOCUMENT, which covers only what Q prepared for them): a company's
    // deck is opened as that company's Pitch deck tab, under its own
    // authorize step, and spoken from what the deck says.
    const deck = await openDeckAsked(request, conversationId, history, target);
    if (deck !== null) return deck;
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
    const said = forThePerson(
      await actions.run(request, action).catch(() => null),
    );
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
    const history = await historyOfRun(request.tenantId, request.runId);
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
    // The existing delegate reads and composes their declared mandate under
    // this same plan. Only skip classifiers for an unambiguous recall with
    // an authorised own mandate; this routing decision grants no access.
    if (
      conversationId !== undefined &&
      latest !== undefined &&
      request.speculation === undefined &&
      request.plan.screen?.route !== "ONBOARDING" &&
      request.writingDocument !== true &&
      request.askedAction === undefined &&
      (request.turnKind === undefined ||
        request.turnKind === "QUESTION_TO_Q") &&
      asksForOwnMandate(latest.content) &&
      ownMandateInPlan(request)
    ) {
      // A sequence may have begun on another instance. Load the existing
      // durable core before deciding this recall can skip its turn reader.
      await hydrate({ tenantId: request.tenantId, conversationId });
      if (!sequences.has(conversationId)) {
        const capabilities = await capabilitiesOf(request);
        logger?.info(
          { qRunId: request.runId, lane: "OWN_MANDATE" },
          "q fast lane",
        );
        return delegate.answer({
          ...request,
          research: Promise.resolve(NO_RESEARCH),
          capabilities: manifestOf(capabilities),
          turnKind: "QUESTION_TO_Q",
          questionKind: "THEIR_OWN_RECORDS",
          preparedSubject: "MANDATE",
          ...(latest.utteranceRef !== undefined ? { spoken: true } : {}),
        });
      }
    }
    // Known-entity instant lane: a plain lookup of a prepared entity is
    // answered from the warm index with zero model calls (live 2026-10-10:
    // three classification calls ran before a code-built card).
    if (
      conversationId !== undefined &&
      latest !== undefined &&
      request.speculation === undefined &&
      request.plan.screen?.route !== "ONBOARDING" &&
      !sequences.has(conversationId)
    ) {
      // v56: once Q has shown company cards here, a fit ranking waits for
      // the reading, which says whether they want the next ones rather
      // than the same ones again (production 2026-10-17, 4f07dae7).
      const instant =
        instantLaneOf(latest.content, history) ??
        (companyCardsShownIn(history)
          ? null
          : ownFitRankingOf(request, latest.content));
      if (instant !== null) {
        const capabilities = await capabilitiesOf(request);
        logger?.info(
          {
            qRunId: request.runId,
            lane:
              instant.questionKind === "DISCOVER_INVESTORS"
                ? "INVESTOR_DISCOVERY"
                : instant.questionKind === "FIT"
                  ? "FIT_BY_CODE"
                  : "KNOWN_ENTITY",
          },
          "q fast lane",
        );
        return delegate.answer({
          ...request,
          research: Promise.resolve(NO_RESEARCH),
          capabilities: manifestOf(capabilities),
          turnKind: "QUESTION_TO_Q",
          ...(latest.utteranceRef !== undefined ? { spoken: true } : {}),
          ...instant,
        });
      }
    }
    // A follow-up about a prepared entity ("tell me more about him", "what
    // has Muhannad said about founders") is composed by code from its
    // stored brief: zero web search, zero analyst call (live 2026-10-11:
    // "tell me more about this person" took long and found little).
    if (
      conversationId !== undefined &&
      latest !== undefined &&
      request.speculation === undefined &&
      request.plan.screen?.route !== "ONBOARDING" &&
      !sequences.has(conversationId)
    ) {
      const followUp = preparedFollowUpOf(latest.content, history);
      if (followUp !== null) {
        logger?.info(
          { qRunId: request.runId, lane: "PREPARED_FOLLOW_UP", modelCalls: 0 },
          "q answered a prepared-entity follow-up by code",
        );
        return recordAnswer(request, conversationId, followUp);
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
      () => pending?.waiting() ?? Promise.resolve(false),
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
    /** K fast lane: whether a change waits on their word; true when unknown. */
    waitingOnThem: () => Promise<boolean> = () => Promise.resolve(false),
  ): Promise<QAnswerOutcome> => {
    rememberTurn(request.runId, latest.content);
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
    // W4: "I want to rehearse with him" right after one person card: the
    // pronoun is that card; the rehearsal opens through open_page's own
    // authorize step (their own researched record or a prepared seed).
    const cardRehearsal = rehearseWithPersonCard(latest.content, history);
    if (cardRehearsal !== null && dependencies.openRecord !== undefined) {
      const intent = await dependencies.openRecord
        .open(request, {
          page: "EXTERNAL_REHEARSAL",
          id: cardRehearsal.externalPersonId,
          name: cardRehearsal.name,
        })
        .catch(() => null);
      if (intent !== null) {
        logger?.info(
          { qRunId: request.runId },
          "q opened a rehearsal with the person card just shown",
        );
        return recordAnswer(
          request,
          conversationId,
          `Opening a rehearsal with ${cardRehearsal.name}. It is an AI rehearsal informed by public sources, not the real person.`,
          [{ kind: "UI_INTENT", intent }],
        );
      }
    }
    // W4: "rehearse with Shadi Qishta" for a researched entity by name.
    const namedRehearsal = await externalEntityAnswer(
      request,
      latest.content,
      "REHEARSE",
    );
    if (namedRehearsal !== null) {
      return recordAnswer(
        request,
        conversationId,
        namedRehearsal.said,
        namedRehearsal.blocks,
      );
    }
    // What Q showed and last did, for "that one" and "try again".
    const shown = shownItems(history);
    // Owner live 2026-10-17: Q's own earlier turns, with what they showed.
    const context = conversationContextOf(history, latest.id);
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
    // "What was the second one?": the name in Q's own list, said by code
    // with no reading and no model call (never an opened page: defect B).
    const recalled =
      pointed === null || sequences.has(conversationId)
        ? null
        : ordinalRecallLine(latest.content, pointed.resolved);
    if (recalled !== null) {
      logger?.info(
        { qRunId: request.runId, lane: "ORDINAL_RECALL", modelCalls: 0 },
        "q named a record from its own list by code",
      );
      return recordAnswer(request, conversationId, recalled);
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
    // Founder P5: "clear all cards", "show me the cards again": a change to
    // what is shown on this device, done in code. Presentation only.
    const cardsLane = cardsLaneOf(latest.content);
    if (cardsLane !== null) {
      logger?.info(
        { qRunId: request.runId, act: cardsLane.intent.action },
        "q is clearing or restoring cards",
      );
      return recordAnswer(request, conversationId, cardsLane.said, [
        { kind: "UI_INTENT", intent: cardsLane.intent },
      ]);
    }
    // A bare screen command ("scroll down", "go back") is done at once in
    // code, like the wake words: it needs no reading, no model and no view
    // of the screen (founder 2026-10-06: Q said it could not scroll
    // because it could not see the page). Anything more than the command
    // goes to the normal path.
    const screenAct = screenActOfTurn(latest.content);
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
    // Owner conversation 2026-10-24 (run 80da02af): "Yes. No, not Halyard.
    // Capital Q", a yes to Q's own question with its subject corrected,
    // opened Halyard Security. A reply to Q's question continues that
    // question (the answer path, with the corrected subject); code opens
    // nothing by name unless the words ask to go somewhere.
    const continuesQ = continuesQsQuestion(history, latest.content);
    if (continuesQ) {
      logger?.info(
        { qRunId: request.runId },
        "a reply to Q's own question: nothing opened by name",
      );
    }
    const onScreenTab = continuesQ
      ? null
      : await screenTabAnswer(request, latest.content, history);
    if (onScreenTab !== null) {
      logger?.info(
        { qRunId: request.runId, outcome: onScreenTab.log },
        "q opened a tab by its name",
      );
      return recordAnswer(
        request,
        conversationId,
        onScreenTab.said,
        onScreenTab.blocks,
      );
    }
    const byName =
      NAMES_Q_CARD.test(latest.content) || continuesQ
        ? null
        : await namedRecordAnswer(request, latest.content);
    // W4: none of their relationships, but a researched entity they can
    // reach by name: its identity card in focus.
    if (!continuesQ && (byName === null || byName.log === "NOT_FOUND")) {
      const external = await externalEntityAnswer(
        request,
        latest.content,
        "OPEN",
      );
      if (external !== null) {
        logger?.info(
          { qRunId: request.runId },
          "q showed a researched entity by its name",
        );
        return recordAnswer(
          request,
          conversationId,
          external.said,
          external.blocks,
        );
      }
    }
    if (byName !== null) {
      logger?.info(
        { qRunId: request.runId, outcome: byName.log },
        "q opened a record by its name",
      );
      return recordAnswer(request, conversationId, byName.said, byName.blocks);
    }
    const paged = continuesQ
      ? null
      : pageAnswer(latest.content, history, capabilities);
    // U4/F8: "open the data room and tell me what's missing" opened the
    // page and lost the question. The move goes with the answer instead.
    if (paged !== null && questionAfterMove(latest.content)) {
      movesWithQuestion.set(request.runId, paged.blocks);
      while (movesWithQuestion.size > PREREADS_MAX) {
        const oldest = movesWithQuestion.keys().next().value;
        if (oldest === undefined) break;
        movesWithQuestion.delete(oldest);
      }
      logger?.info(
        { qRunId: request.runId, page: paged.log },
        "a page and a question: the move goes with the answer",
      );
    } else if (paged !== null) {
      logger?.info(
        { qRunId: request.runId, page: paged.log },
        "q opened a page by name",
      );
      const placed = forTheirSide(request, paged.said, paged.blocks);
      return recordAnswer(
        request,
        conversationId,
        await withDestinationSummary(
          request,
          placed.said,
          placed.blocks,
          placed.requests,
        ),
        placed.blocks,
      );
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
    //
    // Gated on the early skim (production: 118 speculations cancelled in
    // 7 days, each ~44k input tokens): where a skim is composed, the
    // speculative answer starts only once the skim agrees with the default
    // reading (OTHER: not a list, a fit, a person or an arrival), and not
    // at all when the reading lands first. Nothing about what is offered
    // or authorised changes; only whether the call is made early.
    const speculativeResearch = researchDirectiveFor(
      state,
      readingFromTurnReader(SPECULATIVE_READING),
      { available: dependencies.researchAvailable ?? true },
    );
    const speculate =
      dependencies.speculation?.spoken === true &&
      spoken &&
      request.speculation === undefined &&
      request.signal?.aborted !== true &&
      (request.plan.viewing !== undefined ||
        !request.subjects.some((subject) => subject.kind === "COMPANY")) &&
      !namesWebAddress(latest.content) &&
      // F-76: their own board is answered from the board, never guessed.
      !mentionsOwnBoard(latest.content) &&
      request.plan.screen?.route !== "ONBOARDING" &&
      !sequences.has(conversationId);
    const startSpoken = (): void => {
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
          toolFocus: PLAIN_QUESTION_FOCUS,
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
    };
    // No skim composed: nothing to gate on, so it starts at once.
    if (speculate && dependencies.turnSkim === undefined) startSpoken();
    // K6: the full reading is dropped (its provider call aborted) when the
    // fast lane's skim answers the turn first; the run's own abort still
    // reaches it.
    const readerAbort = new AbortController();
    request.signal?.addEventListener("abort", () => readerAbort.abort(), {
      once: true,
    });
    const readTurn = (signal: AbortSignal = readerAbort.signal) =>
      turns.read(
        turnReaderInput(
          history,
          latest,
          actions,
          {
            tenantId: request.tenantId,
            userId: request.actor.userId,
            correlationId: request.correlationId,
            runId: request.runId,
            signal,
          },
          withResolution(referenceNote(shown, lastAction), pointed),
          request.plan.screen?.manifest?.controls,
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
    const actorKey = actorKeyOf(request.tenantId, request.actor.userId);
    lastActionsByActor.delete(actorKey);
    lastActionsByActor.set(actorKey, actionsKey(actions));
    if (lastActionsByActor.size > MAX_CONVERSATIONS) {
      const oldest = lastActionsByActor.keys().next().value;
      if (oldest !== undefined) lastActionsByActor.delete(oldest);
    }
    // Owner 2026-10-23: a cheap signal may start something early for speed
    // but never decide what Q does. Words shaped as a question or a lookup
    // hear, as the turn arrives, a line that names no one and is true of
    // whatever the reading decides; whom Q is looking into is named only
    // from a model's understanding (the skim's, below), which replaces it.
    if (ASKS_SOMETHING.test(latest.content.trim())) sayHolding(request, null);
    const readingFirst = (async () => {
      const ready = early === undefined ? null : await early;
      const earlyRead =
        ready !== null &&
        ready.messageId === latest.id &&
        ready.actionsKey === actionsKey(actions)
          ? await ready.reading
          : null;
      if (ready !== null && earlyRead === null) {
        logger?.info(
          {
            qRunId: request.runId,
            sameActions: ready.actionsKey === actionsKey(actions),
          },
          "q early reading not used",
        );
      }
      return earlyRead ?? (await readTurn().catch(() => null));
    })();
    // Read beside the reading rather than after it: a request to act that
    // names one of their counterparts needs these names once it is read.
    if (!companyAcrossRelationship(request)) void counterpartsOf(request);
    // K fast lane: the short first read, begun beside the firewall when it
    // could be, races the full reading. A HIGH confidence "companies of a
    // kind" or "fit" is answered by the read-only app query at once; any
    // other skim, or the full reading arriving first, takes the path below.
    const preskim = preskims.get(request.runId);
    preskims.delete(request.runId);
    const skimmer = dependencies.turnSkim;
    const skimmable =
      skimmer !== undefined &&
      request.speculation === undefined &&
      request.plan.screen?.route !== "ONBOARDING" &&
      !sequences.has(conversationId);
    const skimming =
      !skimmable || !skimUsable(history, latest)
        ? null
        : preskim !== undefined && preskim.messageId === latest.id
          ? preskim.skim
          : skimmer.skim(skimInput(request, history, latest));
    if (skimming !== null) {
      // Owner 2026-10-23 ("it doesn't need to find every single thing
      // before it starts talking"; live: 4.5 s to the first word, ~3 s of
      // it the turn's reading): when the quick first read (a model, by
      // meaning) understands whom the turn is about (TURN_SKIM v6
      // `subject`, or the one it reads a person search for), they hear that
      // Q is on it before the full reading lands. The name is the skim's
      // understanding, never one guessed from the words' capitals or a list
      // of question words (owner: a word list never decides). A holding
      // line: the answer's own words replace it.
      let readingLanded = false;
      void readingFirst.then(
        () => {
          readingLanded = true;
        },
        () => {
          readingLanded = true;
        },
      );
      void skimming.then(
        (skimmed) => {
          const name =
            skimmed?.subject?.name ??
            (skimmed?.kind === "PERSON_SEARCH" ? skimmed.person?.name : null);
          const writes = skimmed?.writes === true;
          // F-76: "add … to my board" heard "Reading Ledgerfold's
          // profile": their own board is no one's profile.
          if (mentionsOwnBoard(latest.content)) return;
          if (!readingLanded && typeof name === "string") {
            sayHolding(request, name.trim().slice(0, 60), writes);
          } else if (!readingLanded && writes) {
            sayHolding(request, null, true);
          }
        },
        () => undefined,
      );
      const skimStarted = Date.now();
      const skimmed = await Promise.race([
        readingFirst.then(() => null),
        skimming.catch(() => null),
      ]);
      const lane = fastLaneOf(skimmed, latest.content);
      if (speculate && lane === null) {
        if (skimmed?.kind === "OTHER" && !readerAbort.signal.aborted) {
          startSpoken();
        } else {
          logger?.info(
            {
              qRunId: request.runId,
              speculation: "skipped",
              reason: skimmed === null ? "UNSKIMMED" : "SKIM",
              decidedAfterMs: Date.now() - skimStarted,
            },
            "q voice speculation",
          );
        }
      }
      // Never past a change waiting on their word: a yes is not a list.
      // Never before the full reading once Q has shown something here:
      // the skim reads two turns of text, and "what was the second one?"
      // after a list is a follow-up the reading answers from SHOWN, not
      // a new ranking (owner live 2026-10-17).
      // A discovery of investors names its own place, kind or sector in
      // this turn's words (the fast lane checks so): never a follow-up on
      // what was shown, so it is taken here too.
      const discovery = lane?.questionKind === "DISCOVER_INVESTORS";
      if (
        lane !== null &&
        (discovery || !context.turns.some((turn) => turn.blocks.length > 0)) &&
        !(await waitingOnThem())
      ) {
        speculative.current?.cancel("KIND");
        readerAbort.abort();
        logger?.info(
          {
            qRunId: request.runId,
            lane: lane.questionKind,
            waitedMs: Date.now() - skimStarted,
          },
          "q fast lane",
        );
        return delegate.answer({
          ...request,
          research: Promise.resolve(NO_RESEARCH),
          capabilities: manifestOf(capabilities),
          turnKind: "QUESTION_TO_Q",
          ...(spoken ? { spoken: true } : {}),
          ...lane,
        });
      }
    }
    // A reading that failed is tried once more: the gateway has parked the
    // provider that failed, so the second try goes to the fallback model.
    // A request to make something must never be dropped because one model
    // was down (B1, 2026-09-25).
    let read = await readingFirst;
    // Owner's own conversation (2026-10-24): "just find me three Qatari
    // investors" after other talk was answered as a lookup of their own
    // company, and as a search built from earlier chatter. When the full
    // reading says the turn asks which investors, or for public facts or a
    // real-world example, the quick first read is asked what to discover
    // (the place, kind and sector as said) -- already running, or now, even
    // once Q has shown something here, since such an ask names them in its
    // own words. A reading of anything else pays for no skim.
    const discoveryShaped =
      read !== null &&
      read.tool === null &&
      (read.kind === "RESEARCH_REQUEST" ||
        (read.kind === "QUESTION_TO_Q" &&
          (read.question?.kind === "INVESTOR_PROSPECTS" ||
            read.question?.kind === "PUBLIC_FACTS" ||
            read.question?.kind === "REAL_WORLD_EXAMPLE")));
    if (discoveryShaped && skimmable) {
      const late = fastLaneOf(
        await (
          skimming ?? skimmer.skim(skimInput(request, history, latest))
        ).catch(() => null),
        latest.content,
      );
      if (
        late?.questionKind === "DISCOVER_INVESTORS" &&
        !(await waitingOnThem())
      ) {
        speculative.current?.cancel("KIND");
        logger?.info(
          { qRunId: request.runId, lane: late.questionKind, late: true },
          "q fast lane",
        );
        return delegate.answer({
          ...request,
          research: Promise.resolve(NO_RESEARCH),
          capabilities: manifestOf(capabilities),
          turnKind: "QUESTION_TO_Q",
          ...(spoken ? { spoken: true } : {}),
          ...late,
        });
      }
    }
    let turnUnread = false;
    if (read === null && request.signal?.aborted !== true) {
      read = await rereadTurn(
        readTurn,
        readerAbort.signal,
        dependencies.turnRereadDeadlineMs ?? TURN_REREAD_DEADLINE_MS,
      );
      turnUnread = read === null;
      logger?.warn(
        { qRunId: request.runId, recovered: read !== null },
        "a turn to Q was not read on the first try",
      );
    }
    const research: Promise<QResearchDirective> = Promise.resolve(
      read === null ||
        // Lane S: "put those three in a table" re-renders what was shown;
        // whatever the reading, it never reaches the public web.
        reRenderAskOf(
          latest.content,
          history.some((message) => message.role === "Q"),
        )
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
          teamJob: read.teamJob ?? false,
          meetingPrep: read.meetingPrep != null,
          namedOther: read.namedOther != null,
          fromShown: read.fromShown?.turn ?? null,
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
    // F-76 (QA, spoken): their own board, before anything that waits on a
    // card or a page, and before a speculative answer can be spoken. A
    // board ask is never a reply to an outward approval, and nothing
    // outward holds it. Typed and spoken turns take this same path.
    const boardWritesDocument = read?.tool?.kind === "PREPARE_DOCUMENT";
    // Reader v61: "save that plan to my board" / "break it into tasks",
    // about Q's last answer (nobody else named, no item dictated), is done
    // by code, whatever the run's purpose or tool offer.
    const boardAsk: string | null = read?.boardAsk ?? null;
    // Before reader v63 carries LIST and ADD, their words decide only when
    // they are unmistakable: "what's on my board?", or an item they put in
    // quotes (or between "add" and "to my board") for their own board.
    const listsBoard =
      boardAsk === "LIST" ||
      (boardAsk === null && asksWhatIsOnBoard(latest.content));
    const addsItem =
      boardAsk === "ADD" ||
      (boardAsk === "SAVE" && dictatesItem(latest.content)) ||
      (boardAsk === null &&
        mentionsOwnBoard(latest.content) &&
        boardItemFromWords(latest.content) !== null);
    if (listsBoard && !boardWritesDocument) {
      const listed = await readBoard(request, conversationId);
      if (listed !== null) {
        speculative.current?.cancel("ACTED");
        remember(
          conversationId,
          reduceConversation(state, { type: "SUCCEEDED", operation: "TOOL" }),
        );
        return listed;
      }
    }
    // A new item in their words (v62 ADD; or SAVE of a title they put in
    // quotes) is a to-do with that title, never Q's last answer (F-72).
    if (boardAsk === "WORK" && !boardWritesDocument) {
      const working = await workOnBoard(
        request,
        conversationId,
        latest.content,
      );
      if (working !== null) {
        speculative.current?.cancel("ACTED");
        remember(
          conversationId,
          reduceConversation(state, { type: "SUCCEEDED", operation: "TOOL" }),
        );
        return working;
      }
    }
    if (!boardWritesDocument && addsItem) {
      const added = await addItemToBoard(
        request,
        conversationId,
        latest.content,
        history,
      );
      if (added !== null) {
        speculative.current?.cancel("ACTED");
        remember(
          conversationId,
          reduceConversation(state, { type: "SUCCEEDED", operation: "TOOL" }),
        );
        return added;
      }
    }
    // A save in their words the reader left unread ("save that plan to my
    // board"): never a request for new work (live 9ff4a1118, F-78b: it
    // went to the team job and filed a plan from nothing).
    const savesToBoard =
      boardAsk === "SAVE" ||
      boardAsk === "BREAKDOWN" ||
      (boardAsk === null &&
        mentionsOwnBoard(latest.content) &&
        /\b(?:save|keep|pin|file)\b/iu.test(latest.content));
    // F-90 (QA re-score): "Write a 12-month growth plan and save it to my
    // board", one turn. The work starts first; the board then keeps the
    // job itself, linked, never Q's previous answer.
    const asksNewWork =
      read !== null &&
      read.confidence !== "LOW" &&
      read.addressedToQ !== false &&
      read.workFromEarlier !== true &&
      (read.teamJob === true ||
        // The turn itself asks for the work first ("Write … and save it").
        /^\s*(?:please\s+|can you\s+|could you\s+)?(?:write|draft|make|create|prepare|build|put together)\b/iu.test(
          latest.content,
        ));
    // A document asked for in the same breath is the work itself (batch 8
    // F11: "write a plan and save it" read with a document request too).
    if (
      savesToBoard &&
      asksNewWork &&
      dependencies.teamJob !== undefined &&
      dependencies.board !== undefined
    ) {
      const started = await startWorkAndKeep(
        request,
        conversationId,
        latest.content,
        dependencies.teamJob,
        dependencies.board,
      );
      speculative.current?.cancel("ACTED");
      remember(
        conversationId,
        reduceConversation(state, { type: "SUCCEEDED", operation: "TOOL" }),
      );
      return started;
    }
    if (
      savesToBoard &&
      !asksNewWork &&
      !boardWritesDocument &&
      (read?.namedOther ?? null) === null &&
      !dictatesItem(latest.content)
    ) {
      const saved = await saveAnswerToBoard(
        request,
        conversationId,
        boardAsk === "BREAKDOWN" ? "BREAKDOWN" : "SAVE",
        history,
      );
      if (saved !== null) {
        speculative.current?.cancel("ACTED");
        remember(
          conversationId,
          reduceConversation(state, { type: "SUCCEEDED", operation: "TOOL" }),
        );
        return saved;
      }
    }
    // Owner 2026-10-17 ("open the data room" was slow, sometimes did
    // nothing): the reader chose, by meaning, one tab or section the page
    // on screen registered. Worked here by code -- SELECT_TAB / SCROLL_TO
    // on that id, the screen's receipt says whether it happened -- with no
    // further model call. An id the page did not list is never acted on.
    const onPage =
      read === null || read.addressedToQ === false
        ? null
        : pageControlChosen(
            read.control ?? null,
            request.plan.screen?.manifest?.controls,
          );
    if (onPage !== null) {
      speculative.current?.cancel("ACTED");
      logger?.info(
        { qRunId: request.runId, act: onPage.act, target: onPage.target },
        "q is working the control the reader chose on their page",
      );
      return recordAnswer(request, conversationId, controlActLine(onPage), [
        controlActBlock(onPage),
      ]);
    }
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
              // v65: whether it decides a waiting card at all, by meaning.
              replyTo: read.replyTo ?? null,
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
    // Getting ready for a call with one named counterpart (TURN_READER v58
    // meetingPrep, by meaning) is prepared now, in the answer, ahead of
    // any team job (owner 2026-10-23: Q offered to plan it instead) and of
    // an answer from what Q already showed (live 20:31: after a list of
    // investors, the prep was answered as a generic follow-up). When it
    // cannot be prepared, the turn goes on as before.
    // A rehearsal they asked for opens the rehearsal, never the prep again
    // (QA F-98: "Let us rehearse my call with Savanna Seed Partners").
    const prepFor =
      read === null ||
      read.confidence === "LOW" ||
      read.addressedToQ === false ||
      read.reference?.open === "REHEARSAL"
        ? null
        : (read.meetingPrep?.counterpart ?? null);
    if (dependencies.callPrep !== undefined && prepFor !== null) {
      const startedAt = Date.now();
      const prep = await dependencies.callPrep.prepare(request, {
        counterpart: prepFor,
        said: latest.content,
      });
      logger?.info(
        {
          qRunId: request.runId,
          prepared: prep !== null,
          waiting: prep?.waiting.length ?? 0,
          prepMs: Date.now() - startedAt,
        },
        "q prepared a call",
      );
      if (prep !== null) {
        speculative.current?.cancel("ACTED");
        return recordAnswer(request, conversationId, callPrepLine(prep));
      }
    }
    // Owner live 2026-10-17 (conversation 971c5a53): the reader found the
    // turn answered by one of Q's own earlier turns here (v54 fromShown).
    // "Show me the cards again" shows that turn's own blocks -- the same
    // records in the same order, never another list (it had opened the
    // saved companies) -- and "what was the second one?" is answered from
    // that record with no ranking, lookup or tool call. Only what this
    // person was already shown, on their own conversation; a request to
    // act, or a reading the record cannot answer, takes the path below.
    const fromShown = read?.fromShown ?? null;
    const shownTurn =
      fromShown === null ? null : shownTurnOf(context, fromShown.turn);
    if (
      read !== null &&
      fromShown !== null &&
      shownTurn !== null &&
      read.confidence !== "LOW" &&
      !sequences.has(conversationId)
    ) {
      const asksToAct =
        appActionOf(read) !== null ||
        (typeof read.askedAction === "string" && read.askedAction.length > 0) ||
        (read.handOver ?? null) !== null ||
        read.teamJob === true;
      const blocks = reshownBlocks(shownTurn);
      // Replay 2026-10-24 ("Can I see that" after a list of waiting
      // approvals): that turn had only findings and references, so
      // "Here's what I showed you, back on screen." showed nothing. Only
      // something to look at is shown again; else the turn is answered.
      if (
        fromShown.reshow &&
        !asksToAct &&
        blocks.some((block) => !TEXT_ONLY_BLOCKS.has(block.kind))
      ) {
        speculative.current?.cancel("ACTED");
        logger?.info(
          {
            qRunId: request.runId,
            turn: fromShown.turn,
            blocks: blocks.length,
          },
          "q showed an earlier turn's own blocks again",
        );
        return recordAnswer(request, conversationId, RESHOWN_LINE, blocks);
      }
      if (
        !fromShown.reshow &&
        !asksToAct &&
        (read.tool ?? null) === null &&
        dependencies.conversationRecall !== undefined
      ) {
        const said = await dependencies.conversationRecall(request, {
          said: latest.content,
          recent: history
            .filter((m) => m.id !== latest.id)
            .slice(-6)
            .map((m) => ({
              role: m.role === "USER" ? ("USER" as const) : ("Q" as const),
              text: m.content,
            })),
          // With what those turns fetched but did not render (the
          // owner's own, within this run's ceiling): the reader decided
          // from what was shown; the answer may use all Q had in hand.
          shown: conversationContextOf(
            history,
            latest.id,
            request.fetchedInConversation,
          ).text,
          turn: fromShown.turn,
        });
        if (said !== null) {
          speculative.current?.cancel("ACTED");
          logger?.info(
            { qRunId: request.runId, turn: fromShown.turn },
            "q answered a follow-up from what it already said",
          );
          return recordAnswer(request, conversationId, said);
        }
      }
    }
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
    // An explicit edit of a file already on screen/in this conversation must
    // reach its canonical revision tool, even if the reader mistakes the
    // document reference for an instruction to open it. This chooses a path;
    // the tool still resolves owner, firewall scope and the real READY version.
    if (
      request.capability === "ANSWER" &&
      !sequences.has(conversationId) &&
      read?.sequence == null &&
      asksToReviseDocument(latest.content) &&
      (request.plan.screen?.artifactId !== undefined ||
        latestArtifactCardIn(history) !== null)
    ) {
      speculative.current?.cancel("FOCUS");
      return delegate.answer({
        ...request,
        research: Promise.resolve(NO_RESEARCH),
        capabilities: manifestOf(capabilities),
        turnKind: "TOOL_REQUEST",
        toolFocus: {
          areas: ["Documents"],
          tools: [
            "revise_my_document",
            "read_my_document",
            "list_my_documents",
          ],
        },
        ...(spoken ? { spoken: true } : {}),
      });
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
    // A question about a record is answered, never opened (QA F-41, live
    // 2026-10-23: "Tell me more about the second one" opened its page and
    // the conversation moved with it). The reading's own kind decides: a
    // question to Q or a request to look something up is answered with
    // the record bound as a note; the record opens only for a turn that
    // asks Q to do something or answers Q.
    const asksAboutIt =
      read?.kind === "QUESTION_TO_Q" || read?.kind === "RESEARCH_REQUEST";
    // A rehearsal they ask for ("let us rehearse my call with Savanna", "can
    // we practise it?") is the act itself: it opens (QA F-98).
    // v65: a reply that continues Q's question opens nothing unless the
    // words ask to go (coordinator replay 2026-10-24).
    const continuesByReading =
      read?.replyTo?.kind === "Q_QUESTION" && !asksToGo(latest.content);
    if (
      reference !== null &&
      reference.open !== null &&
      !continuesByReading &&
      (reference.open === "REHEARSAL" ||
        (!asksAboutIt && onlyAMove(latest.content)))
    ) {
      const opened = await openReferenced(
        request,
        conversationId,
        reference,
        shown,
        history,
      );
      if (opened !== null) return opened;
    }
    // An action waiting on their reply is continued with it below, never
    // repeated with its old inputs (live 2026-10-16: "Lagos. Set both
    // reminders." re-ran the reminder without the zone, and Q asked for
    // the city again).
    if (
      reference !== null &&
      reference.retryLast &&
      lastAction !== null &&
      lastAction.outcome !== "WAITING" &&
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
    const confident =
      read !== null && read.confidence !== "LOW" && read.addressedToQ !== false;
    // Situation-first planning (S6): their words to work already under way
    // for them (the reader's directsWork) are filed as direction on that
    // work's thread, once per turn; every running step reads it before its
    // next action. Nothing running: the turn is answered as any other.
    if (
      confident &&
      read?.directsWork === true &&
      dependencies.plan?.direct !== undefined
    ) {
      const noted = await dependencies.plan
        .direct(request, latest.content)
        .catch(() => ({ status: "NONE" as const }));
      if (noted.status === "NOTED") {
        speculative.current?.cancel("ACTED");
        return recordAnswer(
          request,
          conversationId,
          "Noted. I'll work that in from the next step, and anything that changes what goes out to someone comes back to you first.",
          [],
        );
      }
    }
    // Situation-first planning (S5): a plan of their own -- read by meaning
    // (TURN_READER v70 planAsk), never by words -- starts the plan job at
    // once: one line saying what Q is doing and the card that follows it.
    // The subject is theirs (their company or mandate), resolved by code.
    if (
      confident &&
      dependencies.plan !== undefined &&
      planAskRoutes(read?.planAsk ?? null)
    ) {
      const planAsk = read?.planAsk ?? null;
      if (planAsk !== null) {
        const started = await dependencies.plan
          .start(request, { ask: latest.content, planAsk })
          .catch(() => ({ status: "FAILED" as const }));
        logger?.info(
          {
            qRunId: request.runId,
            planAsk: planAsk.kind,
            deliverable: planAsk.deliverable,
            research: planAsk.research,
            outcome: started.status,
          },
          "plan asked for: started",
        );
        if (started.status === "STARTED") {
          speculative.current?.cancel("ACTED");
          return recordAnswer(request, conversationId, started.line, [
            {
              kind: "WORK_IN_PROGRESS",
              jobId: started.jobId,
              title: started.title,
            },
          ]);
        }
        if (started.status === "PLAN_LIMIT") {
          speculative.current?.cancel("ACTED");
          return recordAnswer(
            request,
            conversationId,
            started.message ??
              "Your plan's allowance for Q's work this month is used, so I can't start this now.",
            [],
          );
        }
        // NOT_OWN (a company they named) and FAILED fall through: the team
        // job or an ordinary answer, never "nothing has started".
      }
    }
    // Work handed to Q's team -- read from meaning (TURN_READER v49
    // teamJob) -- is planned by the lead and approved as one card: never
    // one in-run brief, never a hand-over (live 2026-10-12). A plan that
    // could not be made is said plainly; it is not covered by an ordinary
    // answer. (The keyword fast path beside it is gone, 2026-10-28.)
    const teamJobBy = confident && read?.teamJob === true ? "READING" : null;
    if (dependencies.teamJob !== undefined && teamJobBy !== null) {
      const startedAt = Date.now();
      // The go-ahead is a reply to Q's question, as the reader read it.
      const goAhead = goAheadGoal(
        history,
        latest.content,
        read?.replyTo?.kind === "Q_QUESTION",
      );
      // QO-07: "yes" to work asked for or offered just before carries the
      // person's own earlier words as the goal, never the reader's.
      const earlier =
        goAhead === null && read?.workFromEarlier === true
          ? earlierRequestGoal(history, latest.content)
          : null;
      // Live 2026-10-28 (run 8b649d10): "make it into a plan and execute
      // that plan" after Q's gap analysis was planned from those words
      // alone. When the reading says this turn takes up what came just
      // before -- work from earlier, or a reply to Q's last question or
      // invitation -- Q's own last answer goes beside the goal as Q's
      // inference; the goal stays the person's words.
      const refersBack =
        goAhead === null &&
        (read?.workFromEarlier === true ||
          read?.replyTo?.kind === "Q_QUESTION");
      const priorAnswer = refersBack ? priorAnswerOf(history) : null;
      const planned = await dependencies.teamJob.propose(
        request,
        goAhead ?? earlier ?? latest.content,
        {
          ...(goAhead === null ? {} : { proceed: true }),
          ...(priorAnswer === null ? {} : { priorAnswer }),
        },
      );
      logger?.info(
        {
          qRunId: request.runId,
          by: teamJobBy,
          goAhead: goAhead !== null,
          workFromEarlier: read?.workFromEarlier === true,
          replyTo: read?.replyTo?.kind ?? null,
          priorAnswerItems: priorAnswer?.items.length ?? null,
          outcome: planned.status,
          planMs: Date.now() - startedAt,
        },
        "q work handed to the team: planned",
      );
      return recordAnswer(
        request,
        conversationId,
        teamJobLine(planned, teamJobAudienceOf(request)),
        teamJobBlocks(planned),
      );
    }
    // A LOW reading is a guess, and a guess never moves anybody's screen or
    // prepares a change: it is answered like any other turn. A document
    // asked for "from what you can find publicly" may be read as a
    // research request as much as a tool request; either way it is a
    // request for the document, and the document is what they get.
    const tool =
      read !== null &&
      read.confidence !== "LOW" &&
      // v65: no screen move for a reply that continues Q's question.
      !(
        read.tool?.kind === "NAVIGATE" &&
        read.replyTo?.kind === "Q_QUESTION" &&
        !asksToGo(latest.content)
      ) &&
      (read.kind === "TOOL_REQUEST" ||
        (read.kind === "RESEARCH_REQUEST" &&
          read.tool?.kind === "PREPARE_DOCUMENT") ||
        // Q Pitch v6 (live 2026-10-17): "Can you pitch Capital Q to me?"
        // is read as a question about Capital Q that carries NAVIGATE to
        // Q_PITCH; the tour is the answer to it. Still gated by the words
        // (wordsNamePage) in actOnTool.
        (read.kind === "QUESTION_TO_Q" &&
          read.tool?.kind === "NAVIGATE" &&
          read.tool.destination === "Q_PITCH"))
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
      const continued = forThePerson(
        await dependencies.appActions.run(request, action).catch(() => null),
      );
      if (continued !== null) {
        return saidByAction(request, conversationId, action, continued);
      }
    }
    // The city they gave to a city question Q asked itself, not through
    // the action's tool (live 2026-10-16: the turn was unread, the answer
    // asked "Which city or time zone should I use…?", and "Lagos." was
    // answered as small talk). The request it was asked about is read
    // again against its declared action's own schema, with the zone.
    if (
      waiting === null &&
      dependencies.appActions !== undefined &&
      dependencies.appActionArguments !== undefined &&
      (read === null || read.kind === "ANSWER" || read.kind === "CLARIFICATION")
    ) {
      const continued = cityForAskedAction(history, latest);
      if (continued !== null && appTools.has(continued.tool)) {
        const args = await dependencies
          .appActionArguments(request, {
            tool: continued.tool,
            utterance: continued.utterance,
          })
          .catch(() => null);
        if (args !== null && args !== undefined && typeof args === "object") {
          const action: TurnAppAction = {
            tool: continued.tool,
            arguments: { ...args, timeZone: continued.zone },
          };
          logger?.info(
            { qRunId: request.runId, tool: action.tool },
            "the city they gave continues the action Q asked it for",
          );
          const said = forThePerson(
            await dependencies.appActions
              .run(request, action)
              .catch(() => null),
          );
          if (said !== null) {
            return saidByAction(request, conversationId, action, said);
          }
        }
      }
    }
    // A bare place answering Q's own city question, with nothing found to
    // continue: acknowledged as what it is, never an unrelated canned
    // reply (live 2026-10-16: "Lagos." got "Your setup is complete…").
    const place = bareCityReply(history, latest);
    if (place !== null) {
      logger?.info(
        { qRunId: request.runId },
        "a bare place after a city question was acknowledged",
      );
      return recordAnswer(
        request,
        conversationId,
        `Got it: ${place.said} time (${place.zone}). What would you like me to set up for you?`,
      );
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
                // Every action this person may take here, by what it does
                // (guard F-106, 2026-10-25: with only declared app actions
                // listed, "draft an update email" had no email to choose and
                // was routed to a chat message). Only those offered: one the
                // registry declares but this run cannot take is never the
                // route (guard F-106-reshown-card, 2026-10-26).
                ...offeredActions,
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
    // Routed to an action that is not a declared app action (an email, a
    // meeting): the full answer does it, with that action as the one asked
    // for -- offered, and held to it (the draft goes on its card).
    const routedAsked =
      routed !== null && routed !== DELEGATION_TOOL && !appTools.has(routed)
        ? routed
        : null;
    const routedApp = routedAsked === null ? routed : null;
    const namedAction =
      readerNamed ??
      (fundVisibility
        ? INVESTOR_VISIBILITY_TOOL
        : (recordAudience ?? routedApp));
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
    /**
     * Guard F-106-reshown-card (2026-10-26, run 8f9221fa): "Savanna Seed
     * asked about … Draft a short reply …" ran answer_investor_question,
     * which found no open question and said, for Q, to prepare the reply
     * with propose_chat_message. That guidance was dropped, the answer ran
     * with no action asked, and nothing was prepared. The action the
     * refusal names, when this run offers it, is the one asked for.
     */
    let redirectedTo: string | null = null;
    if (
      dependencies.appActions !== undefined &&
      appAction !== null &&
      read !== null &&
      read.confidence !== "LOW" &&
      dependencies.appActions.tools.has(appAction.tool) &&
      !writingDocument
    ) {
      const ran = await dependencies.appActions
        .run(request, appAction)
        .catch(() => null);
      const said = forThePerson(ran);
      if (said !== null) {
        return saidByAction(request, conversationId, appAction, said);
      }
      if (ran !== null && isRedirect(ran)) {
        redirectedTo =
          offeredActions
            .map((action) => action.name)
            .find(
              (name) =>
                name !== appAction.tool &&
                new RegExp(`\\b${name}\\b`, "u").test(ran.redirect),
            ) ?? null;
        logger?.info(
          { qRunId: request.runId, tool: appAction.tool, redirectedTo },
          "a declared action refused with guidance for the answer",
        );
        // Named a declared action itself: run by code, as a named one is,
        // with its inputs read from their words (the 8 s path; the full
        // answer took 16 s for the same card).
        if (
          redirectedTo !== null &&
          appTools.has(redirectedTo) &&
          dependencies.appActionArguments !== undefined
        ) {
          const tool = redirectedTo;
          const args = await dependencies
            .appActionArguments(request, { tool, utterance: latest.content })
            .catch(() => null);
          if (args !== null && args !== undefined) {
            const instead = { tool, arguments: args };
            const done = forThePerson(
              await dependencies.appActions
                .run(request, instead)
                .catch(() => null),
            );
            if (done !== null) {
              return saidByAction(request, conversationId, instead, done);
            }
          }
        }
      }
      // The reader's own arguments did not fit the tool (parity eval
      // 2026-10-02: "Change our fund's website to ..." failed
      // INVALID_ARGUMENTS): once, the arguments are read again against the
      // tool's own schema, and the same tool runs with them.
      if (
        redirectedTo === null &&
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
          const retried = forThePerson(
            await dependencies.appActions
              .run(request, { tool: appAction.tool, arguments: again })
              .catch(() => null),
          );
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
    // Live 2026-10-12 (fictional investor): "Research Ledgerfold, assess
    // the opportunity, prepare an investment memo, have it critiqued...
    // and prepare founder diligence questions" was read as a hand-over of
    // Ledgerfold, and a waiting connection request was turned into an
    // "accept and send a message" card. Asking for work products is never
    // a hand-over of a relationship: the answer path plans that work.
    const askedForWork = asksForWorkProducts(latest.content);
    if (askedForWork && read?.handOver != null) {
      logger?.info(
        { qRunId: request.runId },
        "a request for work products is not a hand-over; answered instead",
      );
    }
    if (
      dependencies.handOver !== undefined &&
      read !== null &&
      read.confidence !== "LOW" &&
      read.handOver !== undefined &&
      read.handOver !== null &&
      tool === null &&
      !writingDocument &&
      !askedForWork
    ) {
      const handed = await actOnHandOver(
        dependencies.handOver,
        request,
        {
          ...read.handOver,
          pointed: handOverSubjectPointed(pointed),
          utterance: latest.content,
        },
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
    // Live 2026-10-16 (lane ml): only when the turn asks for next steps
    // or readiness (TURN_READER v52 nextSteps, by meaning); an ADVICE
    // question about anything else, such as what a SAFE is, was answered
    // under the readiness list.
    const readinessLead =
      !writingDocument &&
      read?.question?.kind === "ADVICE" &&
      read.nextSteps === true &&
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
      // What a declared action's refusal named for the answer to take.
      ...(redirectedTo === null ? [] : [redirectedTo]),
      // Reader v61: any board ask (a named item kept, Q's work on items)
      // is the board tool's, on whatever purpose this run has.
      ...((read?.boardAsk ?? null) !== null || mentionsOwnBoard(latest.content)
        ? ["my_board"]
        : []),
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
      ...(read === null
        ? {}
        : {
            turnKind: read.kind,
            aboutNamedOther: read.aboutNamedOther,
            namedOther: read.namedOther ?? null,
          }),
      ...(read?.question?.kind === undefined
        ? {}
        : { questionKind: read.question.kind }),
      // K8: a question about a prepared subject.
      ...(read?.kind === "QUESTION_TO_Q" &&
      read.question?.subject !== undefined &&
      read.question.subject !== null
        ? { preparedSubject: read.question.subject }
        : {}),
      // K1: companies of a kind, with the reader's structure.
      // v65: investors asked for are never a company search.
      ...(read?.kind === "QUESTION_TO_Q" &&
      read.question?.kind === "DISCOVER_COMPANIES" &&
      read.discoverWhom !== "INVESTORS"
        ? {
            discoverCompanies: {
              text: read.question.text,
              sectors: read.question.discover?.sectors ?? [],
              countries: (read.question.discover?.countries ?? []).map((code) =>
                code.toUpperCase(),
              ),
              stages: read.question.discover?.stages ?? [],
              count: read.question.count ?? null,
              ranking: read.question.discover?.ranking ?? "NONE",
              mandateRelevant: read.question.discover?.mandateRelevant ?? false,
              previous: read.question.discover?.previous ?? false,
              // v58: they asked for companies raising now.
              raising: read.question.discover?.raising === true,
              // v66 (QA F-114): Discover's narrowing choices they stated.
              verifiedOnly: read.question.discover?.verifiedOnly === true,
              hasPitch: read.question.discover?.hasPitch === true,
              raiseShared: read.question.discover?.raiseShared === true,
            },
          }
        : {}),
      // v62: a comparison as the reader understood it (never recall: the
      // reader drops fromShown when compare is set), so the answer builds
      // the comparison table whatever words asked for it.
      ...(read?.compare === undefined || read.compare === null
        ? {}
        : {
            compare: {
              count: read.compare.count,
              names: [...read.compare.names],
            },
          }),
      ...(read?.kind === "QUESTION_TO_Q" && read.question?.kind === "FIT"
        ? {
            fitQuestion: {
              text: read.question.text,
              count: read.question.count ?? null,
              previous: read.question.discover?.previous ?? false,
              // v56: past the companies already shown ("three new ones").
              excludeShown: read.question.excludeShown === true,
              // Ranked against their mandate, as the reader understood it.
              mandateRelevant: read.question.discover?.mandateRelevant === true,
            },
          }
        : {}),
      // v58: which investors their own company should approach.
      ...(read?.kind === "QUESTION_TO_Q" &&
      read.question?.kind === "INVESTOR_PROSPECTS"
        ? {
            investorProspects: {
              text: read.question.text,
              count: read.question.count ?? null,
            },
          }
        : {}),
      ...(readinessLead === null ? {} : { leadLines: readinessLead }),
      // Only a name the reader was given counts (ADR 0040 parity).
      ...(redirectedTo !== null
        ? { askedAction: redirectedTo }
        : read?.askedAction === undefined ||
            read.askedAction === null ||
            !actions.some((action) => action.name === read.askedAction)
          ? routedAsked === null
            ? {}
            : { askedAction: routedAsked }
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
      // Row 5: the conversation this turn already read, not read again.
      history,
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

  /**
   * S7 (lane S, live 2026-10-15 runs d3fdbd12 and f72d9994, "What are the
   * main risks here?" on a company page): advice takes research by default
   * (q-core), so every such ask about a company Capital Q holds searched the
   * public web first -- 6.3 s before the synthesis started, first text at
   * 11.3-11.7 s, a paid provider call each time. The specialist reads the
   * web only for a turn that asks for public information: a research
   * request, PUBLIC_FACTS or REAL_WORLD_EXAMPLE, or words that name the web.
   * Advice alone is answered from Capital Q's records. A company known only
   * publicly is still always researched (the specialist's own rule).
   */
  const adviceOnCapitalQRecord = (
    request: QAnswerRequest,
    text: string,
  ): boolean =>
    request.turnKind === "QUESTION_TO_Q" &&
    request.questionKind === "ADVICE" &&
    !NAMES_THE_WEB.test(text) &&
    !namesWebAddress(text);

  /** Lane S: their words name one of their own counterparts other than `focus`. */
  const namesOtherCounterpart = async (
    request: QAnswerRequest,
    text: string,
    focusCompanyId: string,
  ): Promise<boolean> => {
    const port = dependencies.openRecord;
    if (port === undefined) return false;
    const name = ownCounterpartWithin(text, await counterpartsOf(request));
    if (name === null) return false;
    const intent = await port
      .open(request, { page: "COMPANY", name })
      .catch(() => null);
    return (
      intent !== null &&
      intent.id !== undefined &&
      intent.id.toLowerCase() !== focusCompanyId.toLowerCase()
    );
  };

  const answerOnce = async (
    request: QAnswerRequest,
    route: {
      readonly ownRecords?: boolean;
      /** The turn reader's reading; absent when no reader is composed. */
      readonly reading?: QSpecialistTurnReading | null;
      /** The run's conversation as the turn already read it (row 5). */
      readonly history?: readonly QConversationMessage[];
    } = {},
  ): Promise<QAnswerOutcome> => {
    // The conversation, not the run: a voice turn is its own run, and a
    // specialist that sees one sentence cannot follow what is being
    // talked about.
    const history =
      route.history ??
      (await repositories.messages.listRecentForConversationOfRun(
        sql,
        request.tenantId,
        request.runId,
        64,
      ));
    const turn = history.findLast((m) => m.role === "USER")?.content;
    if (turn !== undefined) rememberTurn(request.runId, turn);
    // Row 5: the delegate's own prompt takes the same read, not a third one.
    const delegated = (asked: QAnswerRequest): Promise<QAnswerOutcome> =>
      delegate.answer(
        withReferences(
          route.history === undefined ? asked : { ...asked, history },
        ),
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
      return delegated(request);
    }
    const company = request.subjects.find(
      (subject) => subject.kind === "COMPANY",
    );
    if (company === undefined || company.kind !== "COMPANY") {
      return delegated(request);
    }
    // Lane S 2026-10-15 (audit, run 941eac44: Maji Loop on screen, "What
    // does Spheros actually do?" answered about Maji Loop): the words name
    // one of their own counterparts, and that is not the company in focus.
    // The named one is meant, so the focus company's analysis is not run;
    // the conversational path answers with the turn marked as about someone
    // else, and reads the named company under the plan as always. Settled
    // by code from their counterparts list and open_page's own lookup; no
    // model call, and nothing is widened (the plan's subjects stay as they are).
    if (
      await namesOtherCounterpart(request, latest.content, company.companyId)
    ) {
      logger?.info(
        { qRunId: request.runId },
        "q named counterpart differs from the company in focus",
      );
      return delegated({ ...request, aboutNamedOther: true });
    }

    last = null;
    // The conversation core's decision for this turn (CQ-QX-005): only a
    // turn read as explicitly asking for public information reads the web.
    const directive =
      request.research === undefined ? undefined : await request.research;
    /**
     * S3 (lane S, live 2026-10-15 run 0b763858: first text at 31.6 s): the
     * answer is named before it exists so its streamed sentences and the
     * stored message are one message. A sentence goes out only after the
     * answer's own guards: no invented recommendation, no status or
     * promise talk (the stored answer may replace those; nothing said can
     * be unsaid). The stored message stays the durable form.
     */
    const answerId = QMessageIdSchema.parse(randomUUID());
    const deltas = dependencies.deltas;
    let streamedSentences = 0;
    const onAnswerSentence =
      deltas === undefined
        ? undefined
        : (sentence: string): void => {
            if (withoutStatusTalk(sentence).removed > 0) return;
            // A sentence the guard would touch is not streamed at all: the
            // stored answer decides what replaces it.
            const checked = withoutRecommendationClaims(sentence);
            if (checked.removed > 0) return;
            const guardedSentence = checked.text.trim();
            if (guardedSentence.length === 0) return;
            streamedSentences += 1;
            deltas.publish({
              runId: request.runId,
              tenantId: request.tenantId,
              messageId: answerId,
              text: `${guardedSentence} `,
            });
          };
    const result = await specialist.investigate(
      {
        company,
        question: latest.content,
        conversation: earlierTurns(history, latest.id),
        publicResearch:
          directive?.mode === "EXPLICIT" &&
          !adviceOnCapitalQRecord(request, latest.content),
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
        ...(onAnswerSentence === undefined ? {} : { onAnswerSentence }),
      },
    );
    last = result;
    if (streamedSentences > 0) {
      logger?.info(
        { qRunId: request.runId, streamedSentences },
        "q specialist answer streamed",
      );
    }

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
            showStage: (stage, about) => showStage(request, stage, about),
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
        id: answerId,
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

  /**
   * Owner live 2026-10-17: what earlier turns of this conversation fetched,
   * read once per turn for its owner and kept only at or below this run's
   * sensitivity ceiling, so a follow-up and the answer have everything Q
   * already had in hand. A failed read is no context, never a failed turn.
   */
  const withFetched = async (
    request: QAnswerRequest,
  ): Promise<QAnswerRequest> => {
    const port = dependencies.conversationFetched;
    if (port === undefined || request.fetchedInConversation !== undefined) {
      return request;
    }
    const fetched = await port({
      tenantId: request.tenantId,
      userId: request.actor.userId,
      runId: request.runId,
    }).catch((error: unknown) => {
      logger?.warn(
        { err: error, qRunId: request.runId },
        "what this conversation fetched was not read; answering without it",
      );
      return [] as readonly QConversationFetch[];
    });
    const kept = fetched.filter((fetch) =>
      sensitivityWithin(fetch.sensitivity, request.plan.maxSensitivity),
    );
    return kept.length === 0
      ? request
      : { ...request, fetchedInConversation: kept };
  };

  return {
    lastResult: () => last,
    answer: async (request) => answerTurn(await withFetched(request)),
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

/**
 * Lane 7 (instant nav): the page acts the browser now does by code are
 * done here too when a turn still reaches Q (the duplex line routes the
 * words as well), with the same screen act and words: 0 model calls, and
 * the browser drops a repeat of an act it just did. Only acts with a
 * screen-act equivalent: close, a press by name and the theme need a
 * control resolved or a tool's authorize step, so they keep the normal
 * path (and its early reading).
 */
const INSTANT_SCREEN_ACTS: Readonly<
  Partial<Record<InstantPageAct, NonNullable<ReturnType<typeof screenActOf>>>>
> = {
  BACK: { act: "GO_BACK", said: "Going back." },
  SCROLL_DOWN: { act: "PAGE_DOWN", said: "Scrolling down." },
  SCROLL_UP: { act: "PAGE_UP", said: "Scrolling up." },
  SCROLL_TOP: { act: "SCROLL_TOP", said: "Back to the top." },
  SCROLL_BOTTOM: { act: "SCROLL_BOTTOM", said: "To the bottom." },
};

export function screenActOfTurn(text: string): ReturnType<typeof screenActOf> {
  const direct = screenActOf(text);
  if (direct !== null) return direct;
  const instant = instantRequestOf(text);
  return instant?.kind === "PAGE_ACT"
    ? (INSTANT_SCREEN_ACTS[instant.act] ?? null)
    : null;
}

/** Whether Q's last answer put cards on screen ("the first one" means a card then). */
function lastAnswerShowedCards(
  history: readonly QConversationMessage[],
): boolean {
  const lastQ = [...history].reverse().find((m) => m.role === "Q");
  return (lastQ?.blocks ?? []).some(
    (block) =>
      block.kind === "ANSWER_CARDS" ||
      block.kind === "COMPANY_REFERENCE" ||
      block.kind === "INVESTOR_REFERENCE" ||
      block.kind === "COMPARISON_CARDS",
  );
}

/** The record page this intent opens is the one the person is looking at. */
function alreadyOnScreen(
  request: QAnswerRequest,
  intent: Extract<QUiIntent, { kind: "OPEN_RECORD_PAGE" }>,
): boolean {
  const screen = request.plan.screen;
  if (screen === undefined || intent.tab !== undefined) return false;
  return (
    intent.page === "COMPANY" &&
    (screen.route === "COMPANY" || screen.route === "PITCH") &&
    screen.companyId === intent.id
  );
}

/**
 * U4/F8: the words ask for a move and then a question about it ("open the
 * data room and tell me what's missing", "go to my pipeline, who's
 * waiting?"): a later clause is a question.
 */
export function questionAfterMove(text: string): boolean {
  const clauses = text
    .split(/\s*(?:,|;|\band\b|\bthen\b)\s*/iu)
    .map((clause) => clause.trim())
    .filter((clause) => clause.length > 0);
  return clauses.slice(1).some((clause) => asksAQuestion(clause));
}

/** A question, not a command to go somewhere. */
function asksAQuestion(text: string): boolean {
  const said = text.trim().toLowerCase();
  return (
    said.includes("?") ||
    /^(what|why|how|who|which|when|where|does|do|is|are|can|could|should|would|tell me|explain|describe|walk me|give me|summari[sz]e)\b/u.test(
      said,
    )
  );
}

/**
 * The words ask Q to produce analysis or documents (research, an
 * assessment, a memo or brief, a critique or revision, diligence
 * questions): two or more distinct kinds of work. Handing a relationship
 * over ("handle Kestrel for me") names none of them.
 */
export function asksForWorkProducts(text: string): boolean {
  const said = text.toLowerCase();
  const kinds = [
    /\bresearch/u,
    /\b(assess|assessment|evaluat|analy[sz])/u,
    /\b(memo|brief|report|one-pager|write-?up)\b/u,
    /\b(critique|second opinion|review it|revise|revision)/u,
    /\b(diligence questions|due diligence|questions for the founder|founder questions|diligence)/u,
    /\b(risks?|missing information|red flags)\b/u,
  ];
  return kinds.filter((kind) => kind.test(said)).length >= 2;
}

/** Q's own question for their city or time zone. */
const ASKS_CITY =
  /\b(?:which|what)\s+(?:city|time\s?zone|timezone)\b|\bwhere are you (?:based|located)\b/iu;

/**
 * Their reply names a place, Q's last line asked for their city, and the
 * turn before asked for a reminder or a call: that request, its declared
 * tool and the zone. Null otherwise. Code only: the request is read again
 * against the tool's own schema by the caller.
 */
export function cityForAskedAction(
  history: readonly {
    readonly id: string;
    readonly role: string;
    readonly content: string;
  }[],
  latest: { readonly id: string; readonly content: string },
): {
  readonly tool: string;
  readonly utterance: string;
  readonly zone: string;
} | null {
  const zone = zoneFromWords(latest.content);
  if (zone === null) return null;
  const before = history.filter((message) => message.id !== latest.id);
  const askedAt = before.findLastIndex((message) => message.role !== "USER");
  const asked = before[askedAt];
  if (asked === undefined || !ASKS_CITY.test(asked.content)) return null;
  const request = before
    .slice(0, askedAt)
    .findLast((message) => message.role === "USER");
  if (request === undefined) return null;
  const tool = /\bremind/iu.test(request.content)
    ? "propose_reminder"
    : /\b(?:call|meeting)\b/iu.test(request.content) &&
        /\b(?:book|schedule|set up|arrange)\b/iu.test(request.content)
      ? "propose_meeting"
      : null;
  return tool === null ? null : { tool, utterance: request.content, zone };
}

/**
 * The reply is a place and little else ("Lagos.", "I'm in Abuja"), and
 * Q's last line asked for their city: the place as said and its zone.
 */
export function bareCityReply(
  history: readonly {
    readonly id: string;
    readonly role: string;
    readonly content: string;
  }[],
  latest: { readonly id: string; readonly content: string },
): { readonly said: string; readonly zone: string } | null {
  const zone = zoneFromWords(latest.content);
  if (zone === null) return null;
  const words = latest.content
    .replace(/[^\p{L}\s'-]+/gu, " ")
    .trim()
    .split(/\s+/u)
    .filter((word) => word.length > 0);
  if (words.length === 0 || words.length > 5) return null;
  const asked = history
    .filter((message) => message.id !== latest.id)
    .findLast((message) => message.role !== "USER");
  if (asked === undefined || !ASKS_CITY.test(asked.content)) return null;
  const said = words
    .filter(
      (word) =>
        !/^(?:i'?m|i|am|in|based|from|it's|its|the|city|of|yes|ok|okay)$/iu.test(
          word,
        ),
    )
    .join(" ");
  return { said: said.length > 0 ? said : zone, zone };
}

/**
 * Whose side of the table a team-job line speaks to (live 2026-10-28: a
 * founder was offered "questions for the founder"): an investor when the
 * run is bound to their own investor organisation's mandate -- the
 * firewall's proof, as the record resolver above reads it -- a founder
 * otherwise.
 */
function teamJobAudienceOf(request: QAnswerRequest): TeamJobAudience {
  return ownInvestorOrganisationIn(request.plan) !== null
    ? "INVESTOR"
    : "FOUNDER";
}
