import {
  appActionOf,
  pendingAppActionStore,
  type QAppActionAsks,
  type QAppActionPrepared,
  type QAppActionRedirect,
  type TurnAppAction,
} from "./app-action-turn.js";
import {
  asksNoActionOf,
  executionClassOfTurn,
  followsUpAnswer,
  ownStatementClearOf,
} from "./execution-reading.js";
import {
  namesWebAddress,
  PLAIN_QUESTION_FOCUS,
  toolFocusOf,
} from "./tool-focus.js";
import {
  callPrepLine,
  callPrepUnresolvedLine,
  isCallPrepUnresolved,
  rehearsalOffer,
} from "./call-prep.js";
import {
  offeredPlanAccepted,
  offeredPlanChoice,
  planAskRoutes,
} from "./plan-job-port.js";
import {
  earlierRequestGoal,
  goAheadGoal,
  priorAnswerOf,
  type QTeamJobPort,
  teamJobBlocks,
  teamJobLine,
  teamJobOutcomeOf,
} from "./team-job.js";
import {
  readingMisfit,
  type Speculation,
  speculationMisfit,
  SPECULATIVE_READING,
  startSpeculation,
  TYPED_SPECULATIVE_ANSWER_KIND,
  typedSkimQuick,
} from "./speculation.js";
import { startFirstLineBudget, type FirstLineBudget } from "./first-line.js";
import {
  type QAskSurface,
  QMessageIdSchema,
  type QNavigateDestination,
  type QRecordPage,
  type QResponseMessage,
  type QResultBlock,
  type QRunId,
  type QScreenRoute,
  type QStageAbout,
  type QVisibleStage,
  recordPageHasTab,
  sensitivityWithin,
} from "@capital-q/contracts";
import {
  ANALYST_OFFER_DOCUMENT,
  answerPlanOf,
  type ConversationState,
  coverageFromMandate,
  type DiscoveryCoverage,
  type DiscoveryState,
  discoveryTurn,
  EXECUTION_LANES,
  type FailureOperation,
  INITIAL_CONVERSATION_STATE,
  INITIAL_DISCOVERY_STATE,
  inTurnLanguage,
  isUnclearTurn,
  naturalPlaceLine,
  nextExclusions,
  NO_RESEARCH,
  noteAnswerFailure,
  pleasantryOf,
  pleasantryReply,
  type QuestionSequence,
  quietlyNoted,
  readingFromTurnReader,
  readsAsGo,
  readsAsNoNavigation,
  reduceAll,
  reduceConversation,
  reduceDiscovery,
  researchDirectiveFor,
  spokenFactsOf,
  spokenUnclearReply,
  stepQuestionSequence,
  streamedPiece,
  TurnAnswerKindSchema,
  type TurnToolV14,
  unclearTurnReply,
  withoutRecommendationClaims,
} from "@capital-q/q-core";
import {
  buildShownSheet,
  eligibleCapabilities,
  INVESTOR_SCREENS,
  MANAGER_SCREENS,
  ORGANISATION_SCREENS,
  Q_CAPABILITIES,
  type QCapability,
  SPREADSHEET_ARTIFACT_TYPE,
  spreadsheetReceipt,
  spreadsheetSections,
  type TabularBlock,
  tabularBlocks,
  toolAreaOf,
  zoneFromWords,
} from "@capital-q/q-tools";
import {
  actionClaims,
  askerSideOf,
  asksForOwnMandate,
  canOpenFor,
  checkPromises,
  companyMediaAskOf,
  conversationContextOf,
  pinnedOf,
  priorListings,
  type QPageMoveSubject,
  type QTurnReading,
  reshownBlocks,
  shownTurnOf,
  TURN_READER_RECENT_TURNS_MAX,
  withoutStatusTalk,
} from "@capital-q/model-gateway/q";
import {
  cardsLaneOf,
  dailyLaneOf,
  fastLaneOf,
  knownEntityLaneOf,
  lastShownEntityId,
} from "./fast-lane.js";
import {
  ANSWER_DOCUMENT_ARTIFACT_TYPE,
  composeAnswerDocument,
  workTitle,
} from "./answer-document.js";
import {
  composeOwnMandateDocument,
  OWN_MANDATE_ARTIFACT_TYPE,
} from "./own-mandate-document.js";
import {
  appendRunEvent,
  type QAnswerOutcome,
  type QAnswerRequest,
  type QCapabilityManifest,
  type QConversationFetch,
  type QConversationMessage,
  type QPrereadInput,
  type QResearchDirective,
  type QToolFocus,
  toQMessage,
} from "@capital-q/q-runtime";
import type { ActorContext, TenantId, UserId } from "@capital-q/security";
import { type QConversationState } from "@capital-q/q-runtime";
import {
  personAnchorOf,
  type QTurnSubject,
  renderConversationState,
  turnSubjectOf,
  withFetchedRecords,
  withNamedReferences,
} from "./conversation-ledger.js";
import {
  type QSpecialistProbe,
  type QSpecialistTurnReading,
} from "./contracts.js";
import { actOnHandOver } from "./hand-over.js";
import {
  actOnDelegation,
  DELEGATION_CANDIDATE,
  DELEGATION_TOOL,
} from "./delegation.js";
import {
  asksToReviseDocument,
  type LastAction,
  openingLine,
  openTarget,
  referenceNote,
  rehearsalNameOf,
  rehearseWithPersonCard,
  repeatedAction,
  shownItems,
  spokenRecordName,
} from "./references.js";
import {
  boundedCoreSnapshot,
  type ConversationCoreScope,
  CORE_LOAD_DEADLINE_MS,
  loadWithin,
  readCoreSnapshot,
} from "./conversation-core.js";
import { asksToOperate } from "./conversation-entities.js";
import { orderCheckLine, type ReferenceLead } from "./list-order.js";
import { bindReferences, boundCompanyIds } from "./reference-binding.js";
import { correctsOwnCompany } from "./company/about-company.js";
import { randomUUID } from "node:crypto";
import {
  cannotOpenLine,
  cardAt,
  cardsOnScreen,
  asksToGo,
  ANSWERED_IN_PLACE,
  asksToGoExplicitly,
  offerReplyOf,
  offeredFirst,
  ordinalOf,
  pageRequestOf,
  takenBack,
  wordsNamePage,
} from "./page-request.js";
import {
  pagesForTab,
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
import { movePhaseLine } from "@capital-q/q-core/speech";
import {
  namedRecordRequestOf,
  ownCounterpartWithin,
} from "./named-record-request.js";
import type { TurnReferenceV64 as TurnReference } from "@capital-q/q-core";
import {
  type PendingTurnReading,
  startPendingDecision,
} from "./pending-decision.js";
import {
  NO_OWN_RECORDS,
  resolveOwnRecord,
  type OwnRecordMatch,
} from "./company/own-names.js";
import {
  ReadDeadlineError,
  TURN_READ_DEADLINE_MS,
  withinDeadline,
} from "./bounded-read.js";
import { bindHeardName, nameReadings } from "./name-candidates.js";
import { asksForOnePage } from "./company/document-length.js";
import { fitToOnePage } from "./company/one-page.js";
import { type CompanyIntelligenceResult } from "./company/contracts.js";
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
  asksToOpenAPage,
  type ContextFollowUpOutcome,
  type OpenResolutionItem,
  openResolutionOf,
  provenanceLine,
  type QTurnReader,
  type QTurnSkim,
  resolutionArguments,
  sameCounterparty,
  situationHeader,
  situationSurfaceOf,
  UNCERTAINTY_VEHICLES,
  withOpenResolution,
} from "@capital-q/model-gateway/q";

import {
  answerSteps,
  asksWhatIsOnBoard,
  boardItemFromWords,
  boardItemsMeant,
  boardKeyOf,
  boardReadOut,
  dictatesItem,
  type DocumentReply,
  isBoardReply,
  mentionsOwnBoard,
  nameInAsk,
  producedNothing,
  resolveTopOne,
  startsTeamJob,
  UUID,
  withoutBoardSave,
  workSubjectInAsk,
} from "./answer-board.js";
import {
  ANSWER_LIMIT_CHARS,
  earlierTurns,
  loadConversationState,
  MALFORMED_ANSWER_LINE,
  publicBlockedMessage,
  type RunConversationState,
  type SpecialistQAnswer,
  synthesisFromFindings,
  TURN_REREAD_DEADLINE_MS,
  TURN_UNREACHABLE_REPLY,
  TURN_UNREAD_REPLY,
} from "./answer-conversation.js";
import {
  adviceOnCapitalQRecord,
  askedIn,
  asksToGoRead,
  asksToWatchPitch,
  continuesQsQuestion,
  DESTINATION_LINES,
  FOUNDER_OWN_PAGES,
  inWorkspace,
  moreThanTheMove,
  NAMES_Q_CARD,
  navigationOf,
  navigationOfferOf,
  type NavigationReading,
  notTheirOrganisationScreenLine,
  notTheirSideMove,
  OFFER_NOT_AVAILABLE_LINE,
  OFFER_WORDS,
  onlyAMove,
  openedOfferLine,
  readerToolOf,
  STAY_HERE_LINE,
  unknownScreenLine,
  VISIBILITY_EXPLANATIONS,
  whichRecordLine,
} from "./answer-navigation.js";
import {
  controlActBlock,
  controlActLine,
  coreOfferOf,
  handOverSubjectPointed,
  holdingLine,
  INVESTOR_VISIBILITY_TOOL,
  NAMES_Q,
  OFFERED_PLAN_ASK,
  pageControlChosen,
  planStartWords,
  pointedAt,
  type PointedAt,
  recordAudienceTool,
  type RecordedOffer,
  storedPlanOffer,
  withResolution,
} from "./answer-offers.js";
import {
  type BoardKeeper,
  type QRunRouting,
  type SpecialistQAnswerDependencies,
} from "./answer-ports.js";
import {
  actionsKey,
  ASKS_SOMETHING,
  heardReadingReusable,
  labelOf,
  lastShownCardCompanies,
  namedInWords,
  ordinalRecallFromHistory,
  ordinalRecallLine,
  ownRecordsInvestorQuestion,
  RANKED_LIST_LANES,
  type ReaderAction,
  readingMarksPlace,
  rereadTurn,
  RESHOWN_LINE,
  sameCard,
  shownCardCompanies,
  shownCardCompanyOf,
  shownItemTurn,
  shownListExplanation,
  TEXT_ONLY_BLOCKS,
  turnReaderInput,
} from "./answer-shown-items.js";
import {
  addsMove,
  alreadyOnScreen,
  asksAQuestion,
  asksForAnAnswer,
  asksForWorkProducts,
  bareCityReply,
  cityForAskedAction,
  lastAnswerShowedCards,
  MOVE_MADE_LINE,
  movedButNotAnsweredLine,
  type MoveWithQuestion,
  questionAfterMove,
  recentTurnPairs,
  researchedMemoAsked,
  screenActOfTurn,
  teamJobAudienceOf,
} from "./answer-turn-asks.js";

export {
  answerSteps,
  asksWhatIsOnBoard,
  boardItemFromWords,
  boardItemsMeant,
  boardReadOut,
  mentionsOwnBoard,
  nameInAsk,
  type QVisibilityNotebook,
  withoutBoardSave,
  workSubjectInAsk,
} from "./answer-board.js";
export {
  continuesFrom,
  earlierTurns,
  MALFORMED_ANSWER_LINE,
  type SpecialistQAnswer,
  TURN_REREAD_DEADLINE_MS,
  TURN_UNREACHABLE_REPLY,
  TURN_UNREAD_REPLY,
} from "./answer-conversation.js";
export {
  adviceOnCapitalQRecord,
  continuesQsQuestion,
  notTheirOrganisationScreenLine,
  notTheirSideLine,
  OFFER_NOT_AVAILABLE_LINE,
  unknownScreenLine,
  whichRecordLine,
} from "./answer-navigation.js";
export {
  holdingLine,
  type PageControlChoice,
  pageControlChosen,
  planStartWords,
  recordAudienceTool,
  type RecordedOffer,
  storedPlanOffer,
} from "./answer-offers.js";
export {
  type BoardKeeper,
  type QRunRouting,
  type SpecialistQAnswerDependencies,
} from "./answer-ports.js";
export {
  heardReadingReusable,
  namedInWords,
  ordinalRecallLine,
  ownRecordsInvestorQuestion,
  RESHOWN_LINE,
} from "./answer-shown-items.js";
export {
  asksForAnAnswer,
  asksForWorkProducts,
  bareCityReply,
  cityForAskedAction,
  movedButNotAnsweredLine,
  questionAfterMove,
  researchedMemoAsked,
  screenActOf,
  screenActOfTurn,
} from "./answer-turn-asks.js";

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
  const turnReadDeadlineMs =
    dependencies.turnReadDeadlineMs ?? TURN_READ_DEADLINE_MS;
  let last: CompanyIntelligenceResult | null = null;
  /**
   * U4/F8: a move the words asked for alongside a question, per run; the
   * answer to the question carries it (QAnswerRequest.leadBlocks).
   */
  const movesWithQuestion = new Map<string, MoveWithQuestion>();
  const queueMoveWithAnswer = (runId: string, move: MoveWithQuestion): void => {
    movesWithQuestion.set(runId, move);
    while (movesWithQuestion.size > PREREADS_MAX) {
      const oldest = movesWithQuestion.keys().next().value;
      if (oldest === undefined) break;
      movesWithQuestion.delete(oldest);
    }
  };
  /**
   * Q intelligence step 2: each run's conversation state -- the ledger
   * folded forward from the stored turns and saved (a short transaction,
   * never across a model call), the latest summary revision -- read once
   * per run and shared by the early and the full reading. The rendered
   * text also reaches the answer (QAnswerRequest.conversationState).
   */
  const statesInRun = new Map<string, Promise<RunConversationState | null>>();
  const stateTextInRun = new Map<string, string>();
  const shownStateInRun = new Map<string, QConversationState>();
  /** Step 5: the ledger refs the reader bound this run's words to. */
  const boundRefsInRun = new Map<string, readonly string[]>();
  const conversationStateOf = (
    who: {
      readonly tenantId: TenantId;
      readonly userId: UserId;
      readonly runId: string;
    },
    history: readonly QConversationMessage[],
  ): Promise<RunConversationState | null> => {
    const kept = statesInRun.get(who.runId);
    if (kept !== undefined) return kept;
    // Bounded (16 Nov 2026): a read that never returns leaves the turn
    // read from history alone, as a failed read does.
    const started = withinDeadline(
      loadConversationState(
        { repositories, sql, transactions, logger },
        who,
        history,
      ),
      turnReadDeadlineMs,
    ).then(
      (loaded) => {
        logger?.debug(
          {
            qRunId: who.runId,
            stateMs: loaded?.loadMs ?? null,
            stateCached: loaded?.cached ?? null,
          },
          "q conversation state read",
        );
        return loaded;
      },
      (error: unknown) => {
        logger?.warn(
          {
            err: error,
            qRunId: who.runId,
            timedOut: error instanceof ReadDeadlineError,
          },
          "the conversation state was not read; reading the turn from history alone",
        );
        return null;
      },
    );
    statesInRun.set(who.runId, started);
    while (statesInRun.size > PREREADS_MAX) {
      const oldest = statesInRun.keys().next().value;
      if (oldest === undefined) break;
      statesInRun.delete(oldest);
      stateTextInRun.delete(oldest);
      shownStateInRun.delete(oldest);
      boundRefsInRun.delete(oldest);
    }
    return started;
  };
  const conversationStateTextOf = async (
    who: {
      readonly tenantId: TenantId;
      readonly userId: UserId;
      readonly runId: string;
    },
    history: readonly QConversationMessage[],
    fetched?: readonly QConversationFetch[],
  ): Promise<string | undefined> => {
    const loaded = await conversationStateOf(who, history);
    if (loaded === null) return undefined;
    // Step 3: the very state the reader is shown -- the stored ledger plus
    // only the reads the firewall kept for this run -- is the one its
    // references are checked against.
    const shownState = withFetchedRecords(loaded.state, history, fetched);
    shownStateInRun.set(who.runId, shownState);
    const text = renderConversationState({
      state: shownState,
      summary: loaded.summary,
      olderMessages: Math.max(
        0,
        loaded.state.messagesFolded - 1 - TURN_READER_RECENT_TURNS_MAX,
      ),
    });
    // The answer gets the note only when the conversation has something in
    // it; a first turn's empty ledger is no context, only tokens. The reader
    // always gets the text (its prompt reads an empty state as such).
    const loadedState = loaded.state;
    if (
      loadedState.ledger.entities.length > 0 ||
      loadedState.ledger.lists.length > 0 ||
      loadedState.openThreads.length > 0 ||
      (loaded.summary?.summary.trim().length ?? 0) > 0
    ) {
      stateTextInRun.set(who.runId, text);
    }
    return text;
  };

  /**
   * The one record this turn is about (turnSubjectOf), over the stored
   * ledger this run read for its reader: their own counterparts' kind (a
   * company for an investor, a firm for a founder). Null: nothing to bind.
   */
  const turnSubjectIn = async (
    request: QAnswerRequest,
    readName: string | null,
    utterance: string,
    kind: "COMPANY" | "INVESTOR_ORGANISATION",
  ): Promise<QTurnSubject | null> => {
    const loaded = await (statesInRun.get(request.runId) ??
      Promise.resolve(null));
    return turnSubjectOf({
      state: loaded?.state ?? null,
      kind,
      readName,
      utterance,
    });
  };
  /** Their counterparts' kind: a company for an investor, a firm for a founder. */
  const counterpartKind = (
    request: QAnswerRequest,
  ): "COMPANY" | "INVESTOR_ORGANISATION" =>
    askerSideOf(request) === "FOUNDER" ? "INVESTOR_ORGANISATION" : "COMPANY";
  /**
   * The page-move decision's subject (QPageMoveReading.subject): told only
   * when the reading names a record's tab, or turns CONTEXT to a record it
   * named; the one record the conversation is about, or null when two are
   * (the pane's record is then never used in its stead). Undefined: not
   * told, as before.
   */
  const pageMoveSubject = async (
    request: QAnswerRequest,
    reading: {
      readonly navigation?: NavigationReading["navigation"];
      readonly namedOther?:
        { readonly name: string; readonly kind: string } | null | undefined;
      readonly reference?: { readonly name: string | null } | null | undefined;
    } | null,
    utterance: string,
  ): Promise<QPageMoveSubject | null | undefined> => {
    const navigation = reading?.navigation ?? null;
    if (navigation === null) return undefined;
    const namedOther =
      reading?.namedOther?.kind === "COMPANY" ? reading.namedOther.name : null;
    if (
      navigation.tab == null &&
      !(navigation.mode === "CONTEXT" && namedOther !== null)
    )
      return undefined;
    // A company they named is a company; else their counterparts' kind.
    const kind = namedOther !== null ? "COMPANY" : counterpartKind(request);
    const subject = await turnSubjectIn(
      request,
      namedOther ?? reading?.reference?.name ?? null,
      utterance,
      kind,
    );
    if (subject === null) return undefined;
    if (subject.kind === "TWO") return null;
    return {
      kind: kind === "COMPANY" ? "COMPANY" : "INVESTOR",
      name: subject.name,
      id: subject.id,
      named: subject.named,
    };
  };

  const delegate: typeof answerPath = {
    ...answerPath,
    answer: async (asked) => {
      const stateText = stateTextInRun.get(asked.runId);
      const withState =
        stateText === undefined || asked.conversationState !== undefined
          ? asked
          : { ...asked, conversationState: stateText };
      // Step 5: the same shown ledger and the reader's checked refs, for
      // retrieval's query rewriting. A search hint; it grants nothing.
      const shown = shownStateInRun.get(asked.runId);
      const request =
        shown === undefined || withState.retrievalFocus !== undefined
          ? withState
          : {
              ...withState,
              retrievalFocus: {
                ledger: shown.ledger,
                boundRefs: boundRefsInRun.get(asked.runId) ?? [],
              },
            };
      const moves = movesWithQuestion.get(request.runId);
      movesWithQuestion.delete(request.runId);
      if (moves === undefined) return answerPath.answer(request);
      const outcome = await answerPath.answer({
        ...request,
        leadBlocks: [...(request.leadBlocks ?? []), ...moves.blocks],
      });
      // A3: the move was asked for and authorised; the rest of the ask was
      // not answered. Said plainly, with the move, never left as silence
      // or as a bare "Opening …" that implies the rest was done. A run
      // that was cancelled or expired says nothing (nobody is waiting).
      if (
        outcome.kind !== "FAILED" ||
        moves.conversationId === undefined ||
        outcome.diagnosticCode === "RUN_CANCELLED" ||
        outcome.diagnosticCode === "RUN_EXPIRED"
      ) {
        return outcome;
      }
      logger?.info(
        { qRunId: request.runId, code: outcome.diagnosticCode },
        "the move was made; the rest of the ask was not answered, and Q says so",
      );
      return recordAnswer(
        request,
        moves.conversationId,
        movedButNotAnsweredLine(moves.opened, outcome.diagnosticCode),
        moves.blocks,
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
  /**
   * DECISIONS 104: a spoken turn's context follow-up, started beside the
   * full reading once the skim agrees it is no app query, while evidence
   * is held. Adopted only if the reading classes the turn
   * CONTEXTUAL_FOLLOW_UP for the same words; otherwise aborted. Nothing of
   * it is said or stored before the reading decides.
   */
  const contextEarly = new Map<
    string,
    {
      readonly messageId: string;
      readonly outcome: Promise<ContextFollowUpOutcome>;
      readonly abort: AbortController;
    }
  >();
  const dropContextEarly = (runId: string): void => {
    contextEarly.get(runId)?.abort.abort();
    contextEarly.delete(runId);
  };
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
  /** W4: the answer's blocks with the page pane's move, if one was decided. */
  async function movedBlocks(
    request: QAnswerRequest,
    blocks: readonly QResultBlock[] | undefined,
  ): Promise<QResultBlock[] | undefined> {
    const moved =
      dependencies.pageMoves === undefined
        ? blocks
        : await dependencies.pageMoves
            // Code's answers: their moves are exact commands and stand.
            .settle(request, blocks, { keepAnswerMoves: true })
            .catch(() => blocks);
    return moved === undefined ? undefined : [...moved];
  }

  async function recordAnswer(
    request: QAnswerRequest,
    conversationId: QConversationMessage["conversationId"],
    given: string,
    answerBlocks?: readonly QResultBlock[],
    options?: {
      /**
       * Owner replay batch 7 (#3): a line saying a record could not be
       * opened ("I can't open … from here right now") from code's narrower
       * resolution. When the page pane's move is made this turn, the
       * answer says what actually happened instead.
       */
      readonly yieldsToMove?: boolean | undefined;
    },
  ): Promise<QAnswerOutcome> {
    // Batch-12 latency: the move is its own message. A line that would say
    // the record could not be opened gives way to it: the move's message
    // is the answer, and the false line is never stored.
    if (options?.yieldsToMove === true) {
      const moved = await dependencies.pageMoves
        ?.awaitPublished?.(request)
        .catch(() => null);
      if (moved != null)
        return {
          kind: "ANSWERED",
          messageId: moved,
          modelPolicyVersion: "none",
          promptBundleVersion: "none",
        };
    }
    // W4: the page pane's move joins the answer, outside the transaction.
    const blocks = await movedBlocks(request, answerBlocks);
    const written =
      options?.yieldsToMove === true && addsMove(answerBlocks, blocks)
        ? MOVE_MADE_LINE
        : given;
    return storeQMessage(request, conversationId, written, blocks);
  }

  /** One Q message and its durable completion event, committed together. */
  async function storeQMessage(
    request: QAnswerRequest,
    conversationId: QConversationMessage["conversationId"],
    written: string,
    blocks: readonly QResultBlock[] | undefined,
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
    let record = request.subjects.find(
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
    const latest = [...history].reverse().find((m) => m.role === "USER");
    const said = latest?.content ?? "";
    // Acceptance 2026-11-04 (J3): "a one-page memo" is a one-pager, not a
    // multi-page brief. The length asked for is read from their words.
    const artifactType =
      ask.documentType === "INVESTMENT_BRIEF" && asksForOnePage(said)
        ? ("ONE_PAGER" as const)
        : ask.documentType;
    const noun =
      artifactType === "PITCH_DECK"
        ? "deck"
        : artifactType === "ONE_PAGER"
          ? "one-page memo"
          : "brief";
    // Asked for again: the one already made.
    const existing = existingDocumentCard({
      history,
      documentType: artifactType,
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
    const personsWords = personsRecentWords(history);
    // Acceptance 2026-11-04 (J3): a company they named, with nothing open,
    // is first looked for on Capital Q (the record they may open, planned
    // by the firewall); its own record is the primary source, and public
    // research only adds to it. The record's name must still be the name
    // they said (sameCompanyName below), or it is not used.
    let plan = request.plan;
    if (
      record === undefined &&
      subjectName !== null &&
      mine === null &&
      namedByPerson(subjectName, personsWords)
    ) {
      const named = await dependencies
        .namedCompany?.(request, subjectName)
        .catch(() => null);
      if (named !== null && named !== undefined) {
        record = named.subject;
        plan = named.plan;
      }
    }
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
    const contextUnder = (planned: QAnswerRequest["plan"]) => ({
      actor: request.actor,
      runId: request.runId,
      correlationId: request.correlationId,
      capability: request.capability,
      plan: planned,
      ...(request.signal === undefined ? {} : { signal: request.signal }),
      showStage: (stage: QVisibleStage) => showStage(request, stage),
    });
    // Public research runs under the run's own plan, never one bound to a
    // record that turned out not to be the company named.
    const context = contextUnder(request.plan);
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
        contextUnder(plan),
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
      // A record found by its name is filed under the plan that read it.
      request:
        subject === undefined || plan === request.plan
          ? request
          : { ...request, plan, subjects: [...request.subjects, subject] },
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
          artifactType,
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
      // live6 2026-11-04: a one-page memo, written as Q's answer, printed
      // on two pages. Asked for one page, it is filed on one (one-page.ts).
      const content = asksForOnePage(question ?? "")
        ? await fitToOnePage(
            {
              type: ANSWER_DOCUMENT_ARTIFACT_TYPE,
              title: document.title,
              summary: document.summary,
            },
            document.content,
          )
        : document.content;
      const summary = await preparation.port.prepare({
        actorContext: request.actor,
        permittedContextPlan: request.plan,
        qRunId: request.runId,
        artifactType: ANSWER_DOCUMENT_ARTIFACT_TYPE,
        content: {
          title: document.title,
          summary: document.summary,
          content,
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
  /**
   * C10 v84 (owner correction 13 Nov 2026): GO moves fast. In the Q
   * Workspace, a turn read GO whose reader tool names one of the person's
   * own destinations is code's exact command when code may open it: not a
   * founder asking for an investor's screen, not a founder's own page for
   * an investor, a page the site map and this run's capabilities let them
   * open (canOpenFor), and not one of their counterparts named with a page
   * word (F5). Null: the page-move decision places the page as before.
   */
  const fastGoes = new Map<string, Promise<QNavigateDestination | null>>();
  async function fastGoOf(
    request: QAnswerRequest,
    read: QTurnReading | null,
    words: string,
  ): Promise<QNavigateDestination | null> {
    if (!inWorkspace(request) || read === null) return null;
    if (!readsAsGo(read.navigation)) return null;
    // Pinned workspace: code never moves the page at once; the page-move
    // decision places the destination and offers "unpin and open" (its
    // PINNED hold), so the explicit request is offered, never dropped.
    if (pinnedOf(request)) return null;
    const tool = readerToolOf(read, words, true);
    if (tool?.kind !== "NAVIGATE" || tool.destination === null) return null;
    const destination = tool.destination;
    const side = askerSideOf(request);
    if (
      (destination === "COMPANY_VISIBILITY" &&
        !request.subjects.some((subject) => subject.kind === "COMPANY")) ||
      (INVESTOR_SCREENS.has(destination) && side === "FOUNDER") ||
      (FOUNDER_OWN_PAGES.has(destination) && side !== "FOUNDER") ||
      !canOpenFor(request)(destination)
    ) {
      return null;
    }
    if (ownCounterpartWithin(words, await counterpartsOf(request)) !== null)
      return null;
    return destination;
  }

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
    /** C10: the turn's reading (navigation intent and parts), if read. */
    reading: NavigationReading | null = null,
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
    // The Q Workspace (owner, 7 Nov 2026): the page pane has one
    // authority, Q's page-move decision, which reads the same words with the
    // whole site map, the situation and the pane. The reader names only the
    // person's own destinations, so here it neither moves the pane nor says
    // a page is missing (batch 7 replay: "can i see their elevator" -- a
    // company's tab -- was told Capital Q has no elevator page). The turn is
    // answered and the decision places the page.
    //
    // C10 v84 (owner correction): GO to one of the reader's own
    // destinations that code may open (fastGoOf) is code's exact command
    // and moves at once, never waiting on the decision (which is told and
    // adds nothing).
    if (tool.kind === "NAVIGATE" && inWorkspace(request)) {
      const fast = await (fastGoes.get(request.runId) ?? Promise.resolve(null));
      if (fast === null || fast !== tool.destination) {
        logger?.info(
          { qRunId: request.runId, destination: tool.destination },
          "q workspace: the page-move decision places the page, not the reader",
        );
        return null;
      }
      logger?.info(
        { qRunId: request.runId, destination: fast },
        "q workspace: GO to the reader's destination moves at once",
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
      // The reader may name any destination; one of an investor's own
      // screens is opened only for someone with an investor organisation
      // in this run's plan (the registry's INVESTOR_SCREENS eligibility).
      if (
        INVESTOR_SCREENS.has(destination) &&
        askerSideOf(request) === "FOUNDER"
      ) {
        const other = notTheirSideMove(destination, navigable);
        logger?.info(
          { qRunId: request.runId, destination },
          "q was asked for an investor's screen by someone with no investor organisation",
        );
        return recordAnswer(
          request,
          conversationId,
          other.said,
          other.blocks.length === 0 ? undefined : other.blocks,
        );
      }
      // Q-NAV: an organisation screen this run may not open (the sidebar's
      // rule: no organisation, or the import for a member) is never
      // claimed; Q says whose it is and opens the organisation when it may.
      if (
        (ORGANISATION_SCREENS.has(destination) ||
          MANAGER_SCREENS.has(destination)) &&
        !navigable.includes(destination)
      ) {
        const organisation = navigable.includes("ORGANISATION");
        logger?.info(
          { qRunId: request.runId, destination },
          "q was asked for an organisation screen this person is not offered",
        );
        return recordAnswer(
          request,
          conversationId,
          notTheirOrganisationScreenLine(destination, organisation),
          organisation
            ? [
                {
                  kind: "UI_INTENT",
                  intent: { kind: "NAVIGATE", destination: "ORGANISATION" },
                },
              ]
            : undefined,
        );
      }
      const words = askedIn(history);
      // C10 (TURN_READER v84): whether they asked to go is the reading's
      // navigation intent, by meaning, in any language. Negated ("don't
      // open it, just tell me") moves nothing. NONE beside the reader's
      // own NAVIGATE contradicts itself: a destination their words name
      // is never suppressed, so the word fallback below decides it.
      const readNav = navigationOf(reading, inWorkspace(request));
      const navigation =
        readNav?.mode === "NONE" && !readNav.negated ? null : readNav;
      if (readsAsNoNavigation(navigation)) {
        logger?.info(
          { qRunId: request.runId, destination },
          "q did not move: the reading asks for no move",
        );
        return null;
      }
      // Fallback, no navigation reading only: the reader's move is
      // followed only when their words ask for that page (live
      // 2026-10-09: statements and negations moved the screen).
      if (
        navigation === null &&
        ((!wordsNamePage(words, { kind: "DESTINATION", destination }) &&
          /\p{Script=Latin}/u.test(words)) ||
          NAMES_Q_CARD.test(words))
      ) {
        logger?.info(
          { qRunId: request.runId, destination },
          "q did not move: the words do not ask for that page",
        );
        return null;
      }
      // F5 (owner live test 7 Nov): the reader names only the person's own
      // destinations (validation of that closed list against the names of
      // their own counterparts, kept with or without a reading), so "the profile for Tensorgate" could only be read as
      // their own profile. A sentence naming one of their own counterparts
      // asks about that record's page: never moved to one of their own; the
      // answer (and, in the Q Workspace, the page-move decision) takes it.
      if (ownCounterpartWithin(words, await counterpartsOf(request)) !== null) {
        logger?.info(
          { qRunId: request.runId, destination },
          "q did not move: the words name one of their counterparts, not their own page",
        );
        return null;
      }
      // U4/F8: a move with a question after it goes with the answer
      // (C10: the reading's parts; the clause split only as the fallback).
      if (moreThanTheMove(reading, words, inWorkspace(request))) {
        queueMoveWithAnswer(request.runId, {
          blocks: [
            { kind: "UI_INTENT", intent: { kind: "NAVIGATE", destination } },
          ],
          conversationId,
        });
        logger?.info(
          { qRunId: request.runId, destination },
          "a screen and a question: the move goes with the answer",
        );
        return null;
      }
      // N1: a page asked about but not asked to be gone to ("show me my
      // pipeline", "where's my pipeline?") is answered in place, with the
      // page offered, where Q can say what is there. C10: the reading's
      // OFFER_ONLY says so; asksToGoExplicitly only as the fallback.
      const offerOnly =
        navigation === null
          ? !asksToGoExplicitly(words)
          : navigation.mode === "OFFER_ONLY";
      if (offerOnly) {
        const offered = await offeredInPlace(request, destination);
        if (offered !== null) {
          logger?.info(
            { qRunId: request.runId, destination },
            "q answered in place and offered the page",
          );
          return recordAnswer(
            request,
            conversationId,
            offered.said,
            offered.blocks,
          );
        }
        // Read as OFFER_ONLY with nothing to say in place: never moved;
        // the answer takes the question.
        if (navigation !== null) {
          logger?.info(
            { qRunId: request.runId, destination },
            "q did not move: the reading asks about the page, not to go",
          );
          return null;
        }
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
    const [offeredTools, organisationRole] = await Promise.all([
      dependencies.offeredTools === undefined
        ? []
        : dependencies.offeredTools(request).catch(() => []),
      dependencies.organisationRole === undefined
        ? null
        : dependencies.organisationRole(request.actor).catch(() => null),
    ]);
    return eligibleCapabilities({
      surface: "HOME_Q",
      offeredTools: new Set(offeredTools),
      company: request.subjects.some((subject) => subject.kind === "COMPANY"),
      ownInvestorOrganisation: askerSideOf(request) === "INVESTOR",
      artifacts: artifacts !== undefined,
      ownMandate: dependencies.ownMandate !== undefined,
      visibility: dependencies.visibility !== undefined,
      organisationRole,
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
    if (askerSideOf(request) === "FOUNDER") {
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

  /**
   * N1 (owner 2026-11-04): "Show me my investor pipeline" is answered here,
   * with what is in it from their own authorised reads, and the page is
   * offered (Open pipeline / Stay here) instead of opened. Null when there
   * is nothing to say in place (no summary, or a read that failed): the
   * page then opens as before, so a request is never left with neither.
   */
  const offeredInPlace = async (
    request: QAnswerRequest,
    destination: QNavigateDestination,
  ): Promise<{
    readonly said: string;
    readonly blocks: readonly QResultBlock[];
  } | null> => {
    const words = OFFER_WORDS[destination];
    if (
      words === undefined ||
      !ANSWERED_IN_PLACE.has(destination) ||
      dependencies.destinationSummary === undefined
    ) {
      return null;
    }
    const summary = await dependencies
      .destinationSummary(request, destination)
      .catch(() => null);
    if (summary === null) return null;
    return {
      said: `${summary} ${words.line}`,
      blocks: [
        {
          kind: "NAVIGATION_OFFER",
          intent: { kind: "NAVIGATE", destination },
          place: words.place,
          openLabel: words.openLabel,
        },
      ],
    };
  };

  /**
   * N1: their reply to Q's last offer to open a page. "Yes, open it" makes
   * the offered move (the same registered intent, through the same follow
   * path as any move); "stay here" keeps them where they are. Anything
   * else is not a reply to the offer and goes the normal way. Never an
   * approval: the offer is navigation, which is harmless and reversible.
   */
  const offerReplyAnswer = (
    history: readonly QConversationMessage[],
    text: string,
  ): {
    readonly said: string;
    readonly blocks: readonly QResultBlock[];
    readonly log: "OPEN" | "STAY";
  } | null => {
    const offer = navigationOfferOf(history);
    if (offer === null) return null;
    const reply = offerReplyOf(text);
    if (reply === null) return null;
    if (reply === "STAY")
      return { said: STAY_HERE_LINE, blocks: [], log: reply };
    return {
      said: openedOfferLine(offer),
      blocks: [{ kind: "UI_INTENT", intent: offer.intent }],
      log: reply,
    };
  };

  const pageAnswer = (
    text: string,
    history: readonly QConversationMessage[],
    capabilities: readonly QCapability[],
  ): {
    readonly said: string;
    readonly blocks: readonly QResultBlock[];
    readonly log: string;
    /** N1: answered in place with this page offered, when Q can say it. */
    readonly offer?: QNavigateDestination;
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
    if (!navigable.includes(target.destination)) {
      // Live 2026-10-30 (founder, "take me to my mandate"): Q said
      // "Opening your mandate…" and stayed on Home. A screen that belongs
      // to the other side is never claimed: Q says what it is and opens
      // their own counterpart of it when this run may (a founder's raise).
      if (!INVESTOR_SCREENS.has(target.destination)) return null;
      return {
        ...notTheirSideMove(target.destination, navigable),
        log: `NOT_THEIR_SIDE_${target.destination}`,
      };
    }
    return {
      said: naturalPlaceLine(DESTINATION_LINES[target.destination], text),
      blocks: [
        {
          kind: "UI_INTENT",
          intent: { kind: "NAVIGATE", destination: target.destination },
        },
      ],
      log: target.destination,
      // N1: asked to see (not to go to) a page Q can answer in place.
      ...(offeredFirst(asked) ? { offer: target.destination } : {}),
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
    /** The record opened, as Q says it; absent when nothing opened. */
    readonly name?: string;
  } | null> => {
    const port = dependencies.openRecord;
    if (port === undefined) return null;
    // The same resolver the fast path runs at the end of the utterance
    // (fast-navigation.ts), so the screen and the answer agree on the
    // target; the screen dedupes the second move.
    const resolved = await resolveNamedRecord({
      text,
      side: askerSideOf(request),
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
      name: resolved.name,
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

  /**
   * v87 (owner clarification, 13 Nov 2026): a tab the reading names, read
   * GO, with no record named ("can I see their team?" after Nixo was
   * opened): the record on screen, else the one Q last opened in this
   * conversation (screenTabTarget, as for a tab said by name), opened
   * through open_page's own authorize step. Nothing on screen or in the
   * conversation, a page without that tab, or a record they may not open:
   * null, and the turn is answered. The Q Workspace's pane is the page-move
   * decision's (readingTabPlace), so this is outside it only.
   */
  const readTabAnswer = async (
    request: QAnswerRequest,
    conversationId: QConversationMessage["conversationId"],
    history: readonly QConversationMessage[],
    reading: NavigationReading | null,
  ): Promise<QAnswerOutcome | null> => {
    const port = dependencies.openRecord;
    if (port === undefined || inWorkspace(request) || asksToWatchPitch(reading))
      return null;
    const navigation = navigationOf(reading, false);
    const tab = navigation?.tab ?? null;
    if (navigation === null || tab === null || !readsAsGo(navigation))
      return null;
    const ask: TabAsk = {
      tab,
      subTab: null,
      name: null,
      viewer: tab === "deck",
    };
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
    if (moreThanTheMove(reading, askedIn(history), false)) {
      queueMoveWithAnswer(request.runId, {
        blocks: [{ kind: "UI_INTENT", intent }],
        conversationId,
      });
      logger?.info(
        { qRunId: request.runId, tab },
        "the tab the reading named and more asked: the move goes with the answer",
      );
      return null;
    }
    const spoken = await withDeckSpoken(
      request,
      intent,
      null,
      movePhaseLine("PENDING", tabPlace(ask)),
    );
    logger?.info(
      { qRunId: request.runId, tab, refused: spoken.refused },
      "q opened the tab the reading named on the record in view",
    );
    return recordAnswer(request, conversationId, spoken.said, spoken.blocks);
  };

  /**
   * Live re-check 15 Nov 2026 (RC5 follow-up): runs whose routing is kept,
   * and the code lane that answered a run before any reading, so every run
   * carries its routing (a code lane's run had none). Bounded.
   */
  const routedRuns = new Set<string>();
  const codeLaneOfRun = new Map<string, string>();
  const noteCodeLane = (runId: string, lane: string): void => {
    codeLaneOfRun.set(runId, lane);
    while (codeLaneOfRun.size > PREREADS_MAX) {
      const oldest = codeLaneOfRun.keys().next().value;
      if (oldest === undefined) break;
      codeLaneOfRun.delete(oldest);
    }
  };
  const routeRun = (request: QAnswerRequest, routing: QRunRouting): void => {
    const recordRouting = dependencies.recordRouting;
    if (recordRouting === undefined || routedRuns.has(request.runId)) return;
    routedRuns.add(request.runId);
    while (routedRuns.size > PREREADS_MAX) {
      const [oldest] = routedRuns;
      if (oldest === undefined) break;
      routedRuns.delete(oldest);
    }
    void recordRouting({
      tenantId: request.tenantId,
      runId: request.runId,
      routing,
    }).catch((error: unknown) => {
      logger?.warn(
        { err: error, qRunId: request.runId },
        "q run routing not recorded",
      );
    });
  };
  /** A run no reading routed: kept as the code lane that answered it. */
  const routeUnreadRun = (request: QAnswerRequest): void => {
    const lane = codeLaneOfRun.get(request.runId) ?? "CODE";
    codeLaneOfRun.delete(request.runId);
    routeRun(request, {
      kind: "CODE_LANE",
      confidence: null,
      question: null,
      research: "NEVER",
      researchGuard: null,
      tool: null,
      teamJob: false,
      meetingPrep: false,
      aboutNamedOther: false,
      addressedToQ: true,
      navigation: null,
      navigationDestination: null,
      navigationGuard: null,
      spoken: request.spoken === true,
      lane,
      executionClass: null,
    });
    routedRuns.delete(request.runId);
  };
  /** B6: the reference each run's words were bound to, for its answer. */
  const resolvedInRun = new Map<string, string>();
  /** A2: the companies explicit places bound, in the order said. */
  const placedInRun = new Map<string, readonly string[]>();
  /** RC4: which list a place was counted in, said by the stored answer. */
  const leadInRun = new Map<string, ReferenceLead>();
  /** T3: the one company the reading bound the turn's pointer to. */
  const followUpCompanyInRun = new Map<string, string>();
  const withReferences = (request: QAnswerRequest): QAnswerRequest => {
    const note = resolvedInRun.get(request.runId);
    const placed = placedInRun.get(request.runId);
    const lead = leadInRun.get(request.runId);
    const followUpCompanyId = followUpCompanyInRun.get(request.runId);
    const withLead =
      lead === undefined || request.referenceLead !== undefined
        ? request
        : { ...request, referenceLead: lead };
    const led =
      followUpCompanyId === undefined ||
      withLead.followUpCompanyId !== undefined
        ? withLead
        : { ...withLead, followUpCompanyId };
    return note === undefined || request.references !== undefined
      ? led
      : {
          ...led,
          references: note,
          ...(placed === undefined ? {} : { referencedCompanyIds: placed }),
        };
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
  /** The first reading, reused for those words (heardReadingReusable). */
  const heardReadings = new Map<string, QTurnReading>();

  /**
   * A series of questions the person asked Q to put to them, per
   * conversation (R35). In memory and bounded like the rest of the core's
   * state: a restart forgets where a series was, never a fact.
   */
  const sequences = new Map<string, QuestionSequence>();
  /** The last turn's tool focus per conversation, bounded like the rest. */
  const focuses = new Map<string, QToolFocus>();
  /**
   * Live 2026-10-30: the offer code closed Q's last answer with, per
   * conversation, recorded with the run that made it -- so "yes" binds to
   * that exact offer (TURN_READER v74 acceptsOffer), never to a guess from
   * the words. Kept only while that answer is still Q's last turn; in
   * memory and bounded like the rest (a restart forgets an offer, and a yes
   * to a forgotten offer moves nothing, see offerTakenUnrecorded).
   */
  const offers = new Map<string, RecordedOffer>();
  const recordOffer = (conversationId: string, offer: RecordedOffer): void => {
    offers.delete(conversationId);
    offers.set(conversationId, offer);
    if (offers.size > MAX_CONVERSATIONS) {
      const oldest = offers.keys().next().value;
      if (oldest !== undefined) offers.delete(oldest);
    }
  };
  /**
   * Live 14 Nov 2026 (D12-D14): the conversation's open resolution item --
   * the material uncertainty about a counterparty Q last offered to resolve,
   * with the route the stage allowed. Unlike the offer it outlives the next
   * turn: "request that" or an explicit request for the vehicle later
   * resolves to it, and code fills the request from it. Cleared once a
   * request for it is prepared. Bounded like the rest; durable in the core.
   */
  const resolutions = new Map<string, OpenResolutionItem>();
  const keepResolution = (
    conversationId: string,
    item: OpenResolutionItem | null,
  ): void => {
    resolutions.delete(conversationId);
    if (item === null) return;
    resolutions.set(conversationId, item);
    if (resolutions.size > MAX_CONVERSATIONS) {
      const oldest = resolutions.keys().next().value;
      if (oldest !== undefined) resolutions.delete(oldest);
    }
  };
  /** The offer Q's last turn made, if code recorded one with it. */
  const offerOfLastTurn = (
    conversationId: string,
    history: readonly QConversationMessage[],
  ): RecordedOffer | null => {
    const lastQ = [...history].reverse().find((m) => m.role === "Q");
    if (lastQ === undefined) return null;
    const offer = offers.get(conversationId);
    if (offer !== undefined && lastQ.runId === offer.runId) return offer;
    // Live 2026-10-31 ("Your plan: yes"): memory alone forgets the offer on
    // a restart. Q's stored answer closing with code's own plan offer is
    // the same record, read back durably; the plan is of the question that
    // answer answered (their turn in the same run), never of the yes.
    return storedPlanOffer(history, lastQ);
  };

  /**
   * RECOVERY-2026-10 B3 (audit B-02): the core's state, kept durable when a
   * store is composed. Read once per conversation per process (memory is
   * the first read after that); written after every turn. A failed or slow
   * store leaves the turn on memory, never fails it.
   */
  const coreStore = dependencies.coreState;
  /**
   * HQ-5: discovery's state per conversation (q-core state.ts), kept with
   * the core's snapshot so it holds across instances.
   */
  const discoveries = new Map<string, DiscoveryState>();
  /** VOICE-FIX: what each conversation asked Q to leave out (v96 excludes). */
  const exclusions = new Map<string, readonly string[]>();
  const keepExclusions = (conversationId: string, next: readonly string[]) => {
    exclusions.delete(conversationId);
    if (next.length === 0) return;
    exclusions.set(conversationId, next);
    while (exclusions.size > MAX_CONVERSATIONS) {
      const oldest = exclusions.keys().next().value;
      if (oldest === undefined) break;
      exclusions.delete(oldest);
    }
  };
  const keepDiscovery = (conversationId: string, next: DiscoveryState) => {
    discoveries.delete(conversationId);
    discoveries.set(conversationId, next);
    while (discoveries.size > MAX_CONVERSATIONS) {
      const oldest = discoveries.keys().next().value;
      if (oldest === undefined) break;
      discoveries.delete(oldest);
    }
  };
  /**
   * HQ-5: discovery's decision for this turn, by code. Entered when the
   * answer plan picks DISCOVERY or an ask reads underspecified twice in a
   * row; a clear task ends it. The gap model is read only while it is on.
   */
  const withDiscovery = async (
    request: QAnswerRequest,
    conversationId: string,
    words: string,
  ): Promise<QAnswerRequest> => {
    if (
      request.capability !== "ANSWER" ||
      request.writingDocument === true ||
      request.turnUnread === true ||
      request.questionSequence !== undefined
    ) {
      return request;
    }
    const plan = answerPlanOf({
      answerKinds: [
        request.answerKind,
        ...(request.askParts ?? []).map((part) => part.kind),
      ].flatMap((kind) => {
        const parsed = TurnAnswerKindSchema.safeParse(kind);
        return parsed.success ? [parsed.data] : [];
      }),
      questionKind: request.questionKind,
      turnKind: request.turnKind,
      underspecified: request.underspecified,
      costlyIfWrong: request.costlyIfWrong,
      seeksGuidance: request.seeksGuidance,
    });
    const reading = {
      words,
      discoveryShape: plan?.shape === "DISCOVERY",
      underspecified: request.underspecified === true,
      // A typed question, or work read as analysis or a comparison, is a
      // clear ask; a reply to Q's own question is neither.
      task:
        request.questionKind !== undefined ||
        plan?.shape === "ANALYSIS" ||
        plan?.shape === "COMPARISON",
    };
    const state = {
      ...INITIAL_CONVERSATION_STATE,
      discovery: discoveries.get(conversationId) ?? INITIAL_DISCOVERY_STATE,
    };
    const on = reduceDiscovery(state.discovery, {
      type: "PLANNED",
      discoveryShape: reading.discoveryShape,
      underspecified: reading.underspecified,
      task: reading.task,
    }).active;
    const coverage = on ? await discoveryCoverageFor(request) : null;
    const decided = discoveryTurn(state, { ...reading, coverage });
    keepDiscovery(conversationId, reduceAll(state, decided.events).discovery);
    if (decided.turn !== null) {
      logger?.info(
        {
          qRunId: request.runId,
          discovery: decided.turn.kind,
          ...(decided.turn.kind === "ASK"
            ? { gap: decided.turn.gap, asked: decided.turn.asked }
            : { reason: decided.turn.reason }),
        },
        "q discovery turn",
      );
    }
    return decided.turn === null
      ? request
      : { ...request, discovery: decided.turn };
  };
  /**
   * HQ-5: what is declared, from their setup (the composed port) and their
   * own mandate as it stands now. Each read is bounded; a slow or failed
   * one is no coverage from it, never a guess.
   */
  const discoveryCoverageFor = async (
    request: QAnswerRequest,
  ): Promise<DiscoveryCoverage | null> => {
    const setupPort = dependencies.discoveryCoverage;
    const mandatePort = dependencies.ownMandate;
    const [fromSetup, mandate] = await Promise.all([
      setupPort === undefined
        ? null
        : loadWithin(setupPort.read(request), CORE_LOAD_DEADLINE_MS),
      mandatePort === undefined
        ? null
        : loadWithin(mandatePort.read(request), CORE_LOAD_DEADLINE_MS),
    ]);
    if (fromSetup?.side === "FOUNDER") return fromSetup;
    if (mandate === null || mandate === "NOT_AN_INVESTOR") return fromSetup;
    return {
      side: "INVESTOR",
      known: [
        ...new Set([
          ...(fromSetup?.known ?? []),
          ...mandate.mandates.flatMap((one) => coverageFromMandate(one)),
        ]),
      ],
    };
  };
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
    // C3: an action offer survives a deploy; it binds only while the run
    // that made it is still Q's last turn (offerOfLastTurn).
    const offer = snapshot.offer ?? null;
    if (!offers.has(id) && offer !== null) {
      recordOffer(id, { kind: "ACTION", ...offer });
    }
    const resolution = snapshot.resolution ?? null;
    if (!resolutions.has(id) && resolution !== null) {
      keepResolution(id, resolution);
    }
    const discovery = snapshot.discovery ?? null;
    if (!discoveries.has(id) && discovery !== null) {
      keepDiscovery(id, discovery);
    }
    const excluded = snapshot.excluded ?? [];
    if (!exclusions.has(id) && excluded.length > 0) {
      keepExclusions(id, excluded);
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
          offer: coreOfferOf(offers.get(id)),
          resolution: resolutions.get(id) ?? null,
          discovery: discoveries.get(id) ?? null,
          excluded: exclusions.get(id) ?? [],
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
    askerSideOf(request) === "INVESTOR" &&
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
    // Audit item 1: the Daily lane is instant only right after Q's own
    // Daily line (or before Q has spoken); otherwise the reading decides.
    dailyLaneOf(
      utterance,
      lastAnswerShowedCards(history),
      [...history].reverse().find((m) => m.role === "Q")?.content ?? null,
    );

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

  /**
   * S2: words that code answers before any reading -- a page by its name,
   * a bare screen command, a cards request. (A plain fit ranking was one
   * until the live re-check of 15 Nov 2026, T1: words cannot prove a
   * ranking ask carries no condition, so it now waits for the reading.) The early
   * skim and turn reading are not begun for them (live 2026-10-15: 64 of
   * 70 runs that only navigated still paid 1-2 classification calls).
   * Words only, so this can never widen what is answered; when a code lane
   * then declines (a page not navigable here), the reading is made later.
   */
  const codeAnswersWords = (text: string): boolean =>
    (pageRequestOf(text) !== null && !takenBack(text)) ||
    screenActOfTurn(text) !== null ||
    cardsLaneOf(text) !== null ||
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
  const heldRuns = new Map<string, "HINT" | "WRITE_HINT" | "NAMED">();
  /** HQ-1: each run's first-line budget, until it is said or not needed. */
  const firstLines = new Map<string, FirstLineBudget>();
  const spokenTurn = (message: QConversationMessage): boolean =>
    message.utteranceRef !== undefined;
  const sayHolding = (
    request: QAnswerRequest,
    name: string | null,
    /** v7 skim: they asked Q to write or send something (QA F-23). */
    writes = false,
    /** v10 skim: a document about someone, nothing sent (J3). */
    document = false,
  ): void => {
    const deltas = dependencies.deltas;
    if (deltas === undefined) return;
    const held = heldRuns.get(request.runId);
    if (
      held === "NAMED" ||
      (held === "HINT" && name === null && !writes) ||
      // The nameless writing line said once gives way only to a name.
      (held === "WRITE_HINT" && name === null)
    ) {
      return;
    }
    if (request.writingDocument === true || request.askedAction !== undefined) {
      return;
    }
    if (request.plan.screen?.route === "ONBOARDING") return;
    heldRuns.set(
      request.runId,
      name !== null ? "NAMED" : writes ? "WRITE_HINT" : "HINT",
    );
    while (heldRuns.size > PREREADS_MAX) {
      const oldest = heldRuns.keys().next().value;
      if (oldest === undefined) break;
      heldRuns.delete(oldest);
    }
    deltas.publish({
      runId: request.runId,
      tenantId: request.tenantId,
      messageId: QMessageIdSchema.parse(randomUUID()),
      text: holdingLine(name, writes, document),
      holding: true,
    });
  };

  /**
   * Who is asking, for the header; null (told as unknown) when the read
   * fails or does not finish within the turn's read deadline (16 Nov 2026:
   * a read that never returned hung the turn).
   */
  const situationAskerOf = async (
    actor: ActorContext,
    screen:
      | {
          readonly companyId?: string | undefined;
          readonly investorOrganisationId?: string | undefined;
        }
      | null
      | undefined,
  ) => {
    const read = dependencies.situationOf?.(actor, {
      ...(screen?.companyId === undefined
        ? {}
        : { companyId: screen.companyId }),
      ...(screen?.investorOrganisationId === undefined
        ? {}
        : { investorOrganisationId: screen.investorOrganisationId }),
    });
    if (read === undefined) return null;
    try {
      return (await withinDeadline(read, turnReadDeadlineMs)) ?? null;
    } catch (error: unknown) {
      if (error instanceof ReadDeadlineError) {
        logger?.warn(
          { deadlineMs: error.deadlineMs, actorUserId: actor.userId },
          "the situation was not read in time; reading the turn without it",
        );
      }
      return null;
    }
  };
  /**
   * The situation header for the reader (step 1): the same builder the
   * answer uses, from the person's own records and their screen's route,
   * zone and surface (closed kinds; about no one else).
   */
  const situationFor = async (
    actor: ActorContext,
    screen:
      | {
          readonly route?: QScreenRoute | undefined;
          readonly timeZone?: string | undefined;
          readonly surface?: QAskSurface | undefined;
          readonly companyId?: string | undefined;
          readonly investorOrganisationId?: string | undefined;
        }
      | null
      | undefined,
    spoken: boolean,
  ): Promise<string> =>
    situationHeader({
      now: (dependencies.now ?? (() => new Date()))(),
      // R2 (owner live 7 Nov): the record on their screen, named by the
      // port from the ids the firewall passed on.
      asker: await situationAskerOf(actor, screen),
      deviceTimeZone: screen?.timeZone,
      surface: situationSurfaceOf(spoken, screen?.surface),
      page: screen?.route ?? null,
    });

  /**
   * The reader's situation header, by run: begun by the early read at
   * message receipt and taken by the turn's own reading, so the turn's
   * reading is asked as soon as the turn is (live 16 Nov 2026 on
   * 77187e4aa: the turn's reading waited 0.19-0.41 s for this read after
   * the turn began, when the early reading was absent or dropped). Taken
   * only when the screen it was built from is the plan's own: the early
   * read runs before the firewall, and the reader is told only what the
   * firewall kept.
   */
  const situationsInRun = new Map<
    string,
    { readonly key: string; readonly text: Promise<string> }
  >();
  const situationKeyOf = (
    screen: Parameters<typeof situationFor>[1],
    spoken: boolean,
  ): string =>
    JSON.stringify([
      screen?.route ?? null,
      screen?.timeZone ?? null,
      screen?.surface ?? null,
      screen?.companyId ?? null,
      screen?.investorOrganisationId ?? null,
      spoken,
    ]);
  const situationOfRun = (
    runId: string,
    actor: ActorContext,
    screen: Parameters<typeof situationFor>[1],
    spoken: boolean,
  ): Promise<string> => {
    const key = situationKeyOf(screen, spoken);
    const kept = situationsInRun.get(runId);
    if (kept !== undefined && kept.key === key) return kept.text;
    const text = situationFor(actor, screen, spoken);
    situationsInRun.set(runId, { key, text });
    while (situationsInRun.size > PREREADS_MAX) {
      const oldest = situationsInRun.keys().next().value;
      if (oldest === undefined) break;
      situationsInRun.delete(oldest);
    }
    return text;
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
      // The reading's own inputs, begun now whether or not it is read
      // early: the turn's reading takes them up (situationOfRun, and the
      // run's conversation state, read once per run).
      const situation = situationOfRun(
        input.runId,
        input.actor,
        input.situationScreen,
        latest.utteranceRef !== undefined,
      );
      const who = {
        tenantId: input.tenantId,
        userId: input.actor.userId,
        runId: input.runId,
      };
      void conversationStateOf(who, history);
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
            await situation,
            await conversationStateTextOf(who, history),
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
    /** v87: the turn's reading; its deck tab stands for the words. */
    reading: NavigationReading | null = null,
  ): Promise<QAnswerOutcome | null> => {
    const port = dependencies.openRecord;
    const said = [...history].reverse().find((m) => m.role === "USER")?.content;
    if (port === undefined || said === undefined) return null;
    // The reading names the deck by meaning (any language; "make Nixo a
    // deck" is no navigation at all); the words decide only with no
    // navigation reading, or one from before v87 (no tab field: fallback).
    const readNavigation = navigationOf(reading, inWorkspace(request));
    const readTab = readNavigation?.tab;
    if (readNavigation === null || readTab === undefined) {
      if (MAKES_A_DECK.test(said) || !DECK_WORD.test(said)) return null;
    } else if (readTab !== "deck" || !readsAsGo(readNavigation)) {
      return null;
    }
    const ask = tabAskOf(said);
    const name = ask?.name ?? target.name ?? null;
    const screenAsk: TabAsk =
      ask?.tab === "deck" || readTab === undefined
        ? (ask ?? { tab: "deck", subTab: null, name: null, viewer: true })
        : { tab: "deck", subTab: null, name: null, viewer: true };
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
    /** C10: the turn's reading (navigation intent and parts). */
    reading: NavigationReading | null = null,
  ): Promise<QAnswerOutcome | null> => {
    const port = dependencies.openRecord;
    if (port === undefined) return null;
    // A8: a pitch to watch is played inline by the answer path
    // (COMPANY_MEDIA); opening the record would take the turn from it.
    if (asksToWatchPitch(reading)) return null;
    const side = askerSideOf(request);
    // Live 13 Nov 2026 (d96c63ee1): after two turns about Ledgerline, with
    // Clinicrest's data room in the pane, "Can I see their data room?" was
    // read to Clinicrest and opened it. A name the reading resolved from a
    // pointer ("their"), not said and not a shown card, binds to the record
    // the conversation is about now (turnSubjectOf); two in play: asked.
    const subject =
      reference.name === null ||
      reference.shown !== null ||
      reference.open === "DOCUMENT"
        ? null
        : await turnSubjectIn(
            request,
            reference.name,
            askedIn(history),
            reference.open === "COMPANY" || reference.open === "PITCH"
              ? "COMPANY"
              : reference.open === "INVESTOR"
                ? "INVESTOR_ORGANISATION"
                : counterpartKind(request),
          );
    if (subject?.kind === "TWO" && subject.names.length >= 2) {
      logger?.info(
        { qRunId: request.runId, candidates: subject.names.length },
        "the record the turn pointed at could be two in the conversation; asked",
      );
      return recordAnswer(
        request,
        conversationId,
        whichRecordLine(subject.names),
      );
    }
    const pointedTarget = openTarget(reference, shown, side);
    const rebound =
      pointedTarget !== null &&
      subject?.kind === "ONE" &&
      subject.name?.toLowerCase() !== reference.name?.toLowerCase()
        ? subject
        : null;
    const target =
      rebound === null || pointedTarget === null
        ? pointedTarget
        : {
            pages: pointedTarget.pages,
            ...(rebound.name === null
              ? rebound.id === null
                ? {}
                : { id: rebound.id }
              : { name: rebound.name }),
          };
    if (target === null) return null;
    if (rebound !== null)
      logger?.info(
        { qRunId: request.runId },
        "the record the turn pointed at bound to the conversation's current record",
      );
    // Live 2026-11-13 (a37e844d5): "Can I see Clinicrest's data room?"
    // opened the bare profile: the part of the page they meant was dropped.
    // TURN_READER v87 names it by meaning (navigation.tab, any language);
    // the words decide only when there is no navigation reading at all
    // (fallback, as for the open itself). The tab only selects a view of
    // the page open_page authorised (withTabs keeps the ones the page has);
    // a deck keeps its own spoken path below.
    const readNavigation = navigationOf(reading, inWorkspace(request));
    const asked: TabAsk | null =
      readNavigation === null
        ? tabAskOf(askedIn(history))
        : readNavigation.tab === null || readNavigation.tab === undefined
          ? null
          : {
              tab: readNavigation.tab,
              subTab: null,
              name: null,
              viewer: false,
            };
    const tab = asked !== null && asked.tab !== "deck" ? asked : null;
    // v87: the deck the reading names opens in its own spoken path first.
    if (readNavigation?.tab === "deck") {
      const deck = await openDeckAsked(
        request,
        conversationId,
        history,
        target,
        reading,
      );
      if (deck !== null) return deck;
    }
    // v87: the reading's tab chooses among the record's pages: the ones
    // the turn pointed at that have it, else the pages a tab said by name
    // opens (pagesForTab: "show me Clinicrest's messages" is the
    // relationship's thread, "their deal" the relationship). A document,
    // pitch or rehearsal keeps its own page. Each opens through open_page.
    const readTab =
      tab !== null &&
      readNavigation?.tab != null &&
      !target.pages.includes("DOCUMENT") &&
      reference.open !== "REHEARSAL" &&
      reference.open !== "PITCH"
        ? tab.tab
        : null;
    const hasReadTab = (page: QRecordPage): boolean =>
      readTab !== null &&
      recordPageHasTab(page, readTab) &&
      // A relationship's messages are its thread page; its other tabs are not.
      (readTab === "messages") === page.endsWith("_MESSAGES");
    const pages =
      readTab === null
        ? target.pages
        : target.pages.some(hasReadTab)
          ? target.pages.filter(hasReadTab)
          : pagesForTab(readTab, side);
    for (const page of pages) {
      const opened = await port
        .open(request, { page, id: target.id, name: target.name })
        .catch(() => null);
      if (opened === null) continue;
      const intent = tab === null ? opened : withTabs(opened, tab);
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
      // A3: more asked after the move ("… and show the financials"): the
      // record opens with the answer to the rest, never alone (C10: the
      // reading's parts; the clause split only as the fallback).
      if (
        page !== "EXTERNAL_REHEARSAL" &&
        moreThanTheMove(reading, askedIn(history), inWorkspace(request))
      ) {
        queueMoveWithAnswer(request.runId, {
          blocks: [{ kind: "UI_INTENT", intent }],
          conversationId,
          ...(target.name === undefined ? {} : { opened: target.name }),
        });
        logger?.info(
          { qRunId: request.runId, page },
          "the record the turn pointed at and more asked: the move goes with the answer",
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
      const opening =
        tab !== null && intent.tab !== undefined
          ? movePhaseLine("PENDING", tabPlace(tab))
          : openingLine(page, target.name);
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
    const deck =
      readNavigation?.tab === "deck"
        ? null
        : await openDeckAsked(
            request,
            conversationId,
            history,
            target,
            reading,
          );
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
    // W4: the page pane's move is decided beside everything below (only
    // with the workspace on screen; the port checks).
    if (latest !== undefined)
      dependencies.pageMoves?.start(request, {
        utterance: latest.content,
        recentTurns: recentTurnPairs(history, latest),
        pageText: null,
        // C10: the turn's navigation reading follows (heard below), or the
        // answer is stored unread; either way the decision is told.
        readingFollows: true,
        // Batch-12 latency: the move is its own message the moment the
        // decision lands, while the answer may still be writing.
        ...(conversationId === undefined
          ? {}
          : {
              publish: async (move) => {
                const stored = await storeQMessage(
                  request,
                  conversationId,
                  move.content,
                  move.blocks,
                );
                return stored.kind === "ANSWERED" && stored.messageId !== null
                  ? { messageId: stored.messageId }
                  : undefined;
              },
            }),
      });
    // RECOVERY B5 (audit B-05): "hi Q", "thanks", "how are you?" -- a turn
    // that is nothing but a pleasantry is answered by code: no reader, no
    // prefetch, no analyst. Spoken, only when it names Q or opens the
    // conversation, since words to the room are the reader's to judge.
    // N1: "yes, open it" / "stay here" right after Q offered a page is the
    // reply to that offer, by code, before anything reads "yes" as a reply
    // to something else (a pleasantry, a waiting change).
    if (conversationId !== undefined && latest !== undefined) {
      const replied = offerReplyAnswer(history, latest.content);
      if (replied !== null) {
        logger?.info(
          { qRunId: request.runId, reply: replied.log },
          "a reply to Q's offer to open a page",
        );
        return recordAnswer(
          request,
          conversationId,
          replied.said,
          replied.blocks.length === 0 ? undefined : replied.blocks,
        );
      }
    }
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
        noteCodeLane(request.runId, "OWN_MANDATE");
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
    // Owner 2026-11-04: Q offered the plan it just wrote -- a short summary
    // or the whole plan read out -- and the person picked one (a tap on the
    // choice, or the same words typed or spoken). Read back by code from
    // the stored version, as them, with no model call; nothing approved.
    const readOffered = dependencies.plan?.readOffered;
    if (
      readOffered !== undefined &&
      conversationId !== undefined &&
      latest !== undefined &&
      request.speculation === undefined
    ) {
      const choice = offeredPlanChoice(history, latest);
      if (choice !== null) {
        const read = await readOffered(request, choice).catch(() => null);
        if (read !== null) {
          noteCodeLane(request.runId, "PLAN_READ");
          logger?.info(
            { qRunId: request.runId, lane: "PLAN_READ", modelCalls: 0 },
            "q read the offered plan back by code",
          );
          return recordAnswer(request, conversationId, read);
        }
      }
    }
    // Live 2026-11-04: a plain yes ("okay", "go ahead", "Go ahead and run
    // it") to Q's own plan offer runs exactly the offered version through
    // its waiting execute card, as them, by code (decision 55). Before
    // this, the readings took "okay" as new work and a plan titled "okay"
    // was started while the offered plan's card still waited.
    const runOffered = dependencies.plan?.runOffered;
    if (
      runOffered !== undefined &&
      conversationId !== undefined &&
      latest !== undefined &&
      request.speculation === undefined
    ) {
      const accepted = offeredPlanAccepted(history, latest);
      if (accepted !== null) {
        const ran = await runOffered(request, {
          ...accepted,
          evidenceRef: latest.id,
          channel: latest.utteranceRef === undefined ? "TEXT" : "VOICE",
        }).catch((error: unknown) => {
          logger?.warn(
            { err: error, qRunId: request.runId },
            "the offered plan was not run by their words; answering normally",
          );
          return { status: "NONE" } as const;
        });
        if (ran.status !== "NONE") {
          noteCodeLane(request.runId, "PLAN_RUN");
          logger?.info(
            {
              qRunId: request.runId,
              lane: "PLAN_RUN",
              outcome: ran.status,
              modelCalls: 0,
            },
            "q ran the offered plan on their yes",
          );
          return recordAnswer(request, conversationId, ran.line);
        }
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
      // Live re-check 15 Nov 2026 (T1): no ranking is answered here. A
      // fit ranking ("of my best-fitting companies, which bring in
      // revenue?") waits for the reading, whose list conditions decide
      // what is ranked; the words alone cannot prove there are none.
      const instant = instantLaneOf(latest.content, history);
      if (instant !== null) {
        const capabilities = await capabilitiesOf(request);
        const lane =
          instant.questionKind === "DISCOVER_INVESTORS"
            ? "INVESTOR_DISCOVERY"
            : "KNOWN_ENTITY";
        noteCodeLane(request.runId, lane);
        logger?.info({ qRunId: request.runId, lane }, "q fast lane");
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
        noteCodeLane(request.runId, "PREPARED_FOLLOW_UP");
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
      // Step 2: with no reader composed, the answer still reads (and the
      // conversation still keeps) its state.
      if (conversationId !== undefined) {
        await conversationStateTextOf(
          {
            tenantId: request.tenantId,
            userId: request.actor.userId,
            runId: request.runId,
          },
          history,
          request.fetchedInConversation,
        );
      }
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
            if (decided.kind === "REPLY") {
              // The line's one offer (prepare an ended card again) is
              // recorded with this run, so the next yes binds to exactly
              // it (C3), and is kept durable with the core.
              if (decided.offer !== undefined) {
                recordOffer(conversationId, {
                  kind: "ACTION",
                  runId: request.runId,
                  ...decided.offer,
                });
              }
              return decided.line;
            }
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
      // HQ-1: a first line not yet due is never said after the turn.
      firstLines.get(request.runId)?.cancel();
      firstLines.delete(request.runId);
      // The same for an early context follow-up (DECISIONS 104).
      dropContextEarly(request.runId);
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
      if (pointed.lead !== undefined && pointed.lead !== null) {
        leadInRun.set(request.runId, pointed.lead);
      }
      while (resolvedInRun.size > PREREADS_MAX) {
        const oldest = resolvedInRun.keys().next().value;
        if (oldest === undefined) break;
        resolvedInRun.delete(oldest);
        placedInRun.delete(oldest);
        leadInRun.delete(oldest);
      }
      const placed =
        pointed.ask?.kind === "POSITIONS" && pointed.resolved?.kind === "PAIR"
          ? pointed.resolved.entities
              .filter((entity) => entity.kind === "COMPANY")
              .map((entity) => entity.id)
          : [];
      if (placed.length >= 2) placedInRun.set(request.runId, placed);
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
      noteCodeLane(request.runId, "ORDINAL_RECALL");
      logger?.info(
        { qRunId: request.runId, lane: "ORDINAL_RECALL", modelCalls: 0 },
        "q named a record from its own list by code",
      );
      return recordAnswer(request, conversationId, recalled);
    }
    // RC4 (audit 15 Nov, F7-22): an order they state of records Q listed
    // ("I thought Zino was first and Chidi second") is checked against the
    // lists stored with Q's turns; where it differs, the order as shown is
    // said by code, never an agreement with a wrong guess.
    const orderChecked = sequences.has(conversationId)
      ? null
      : orderCheckLine(latest.content, history);
    if (orderChecked !== null) {
      noteCodeLane(request.runId, "LIST_ORDER_CHECK");
      logger?.info(
        { qRunId: request.runId, lane: "LIST_ORDER_CHECK", modelCalls: 0 },
        "q checked a stated order against the lists it showed",
      );
      return recordAnswer(request, conversationId, orderChecked);
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
    const byNameNow =
      NAMES_Q_CARD.test(latest.content) || continuesQ
        ? null
        : await namedRecordAnswer(request, latest.content);
    // Audit item 1, option (c) (owner live 18 Nov 2026, run 658fd606: "The
    // GateQ um... inbox for Nixo" answered at once "I can't find "GateQ
    // um""): a spoken turn's "I can't find X" waits for the reader's
    // reading, which hears the words cleaned (heardAs) and runs this lane
    // again on them, or answers the turn itself. Only a record found opens
    // before the reading.
    const byName =
      byNameNow !== null &&
      byNameNow.log === "NOT_FOUND" &&
      request.spoken === true &&
      !reheard.has(request.runId)
        ? null
        : byNameNow;
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
    // A3: "open Ledgerline's profile and show the financials" -- the
    // record opens with the answer to the rest, never alone with a line
    // that implies the rest was done.
    const openedByName =
      byName !== null &&
      byName.name !== undefined &&
      byName.blocks.some((block) => block.kind === "UI_INTENT");
    // Pre-reader lane: no reading exists yet, so the clause split is the
    // documented fallback here (audit item 1 moves this lane to the reader).
    if (openedByName && questionAfterMove(latest.content)) {
      queueMoveWithAnswer(request.runId, {
        blocks: byName.blocks,
        conversationId,
        ...(byName.name === undefined ? {} : { opened: byName.name }),
      });
      logger?.info(
        { qRunId: request.runId, outcome: byName.log },
        "a record and more asked: the move goes with the answer",
      );
    } else if (byName !== null) {
      logger?.info(
        { qRunId: request.runId, outcome: byName.log },
        "q opened a record by its name",
      );
      // A record that code could not open, or found nothing by that name:
      // the line yields to the page pane's move, when one is made.
      return recordAnswer(request, conversationId, byName.said, byName.blocks, {
        yieldsToMove:
          byName.log === "PART_UNAVAILABLE" || byName.log === "NOT_FOUND",
      });
    }
    const paged =
      continuesQ || movesWithQuestion.has(request.runId)
        ? null
        : pageAnswer(latest.content, history, capabilities);
    // U4/F8: "open the data room and tell me what's missing" opened the
    // page and lost the question. The move goes with the answer instead.
    // Pre-reader lane, as above: the clause split is the fallback.
    if (paged !== null && questionAfterMove(latest.content)) {
      queueMoveWithAnswer(request.runId, {
        blocks: paged.blocks,
        conversationId,
      });
      logger?.info(
        { qRunId: request.runId, page: paged.log },
        "a page and a question: the move goes with the answer",
      );
    } else if (paged !== null) {
      // N1: "show me my pipeline": what is in it, here, with the page
      // offered; "take me to my pipeline" still moves at once.
      const offered =
        paged.offer === undefined
          ? null
          : await offeredInPlace(request, paged.offer);
      if (offered !== null) {
        logger?.info(
          { qRunId: request.runId, page: paged.log },
          "q answered in place and offered the page",
        );
        return recordAnswer(
          request,
          conversationId,
          offered.said,
          offered.blocks,
        );
      }
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
    // HQ-1: a typed turn speculates only behind the skim, never without
    // one, under the same gates as voice, as the quick lookup it most
    // often is (TYPED_SPECULATIVE_ANSWER_KIND). The full reading must read
    // the same lookup, or it is dropped unseen (speculationMisfit).
    const speculateTyped =
      dependencies.speculation?.typed === true &&
      dependencies.turnSkim !== undefined &&
      !spoken &&
      request.speculation === undefined &&
      request.signal?.aborted !== true &&
      (request.plan.viewing !== undefined ||
        !request.subjects.some((subject) => subject.kind === "COMPANY")) &&
      !namesWebAddress(latest.content) &&
      !mentionsOwnBoard(latest.content) &&
      request.plan.screen?.route !== "ONBOARDING" &&
      !sequences.has(conversationId);
    const startTyped = (): void => {
      speculative.current = startSpeculation({
        request: {
          ...request,
          research: Promise.resolve(speculativeResearch),
          capabilities: manifestOf(capabilities),
          turnKind: SPECULATIVE_READING.kind,
          answerKind: TYPED_SPECULATIVE_ANSWER_KIND,
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
            "q typed speculation",
          );
          dependencies.speculation?.observe?.(event);
        },
      });
    };
    // DECISIONS 104: the context follow-up overlaps the full reading (it
    // takes ~2.6 s live), only for a spoken turn whose skim reads no app
    // query, and only while this conversation's evidence is held. It is a
    // read of their own kept evidence and one tool-free call; the reading
    // still decides whether it is used.
    const startContextEarly = (): void => {
      const follow = dependencies.contextFollowUp;
      if (
        follow === undefined ||
        contextEarly.has(request.runId) ||
        request.capability !== "ANSWER" ||
        !follow.holds(request, conversationId)
      ) {
        return;
      }
      const abort = new AbortController();
      const outcome = follow
        .answer(
          request,
          {
            conversationId,
            history,
            latestId: latest.id,
            said: latest.content,
            spoken: true,
          },
          { signal: abort.signal },
        )
        .catch((): ContextFollowUpOutcome => ({
          kind: "MISS",
          reason: "FAILED",
        }));
      contextEarly.set(request.runId, {
        messageId: latest.id,
        outcome,
        abort,
      });
      while (contextEarly.size > PREREADS_MAX) {
        const oldest = contextEarly.keys().next().value;
        if (oldest === undefined) break;
        dropContextEarly(oldest);
      }
    };
    // K6: the full reading is dropped (its provider call aborted) when the
    // fast lane's skim answers the turn first; the run's own abort still
    // reaches it.
    const readerAbort = new AbortController();
    request.signal?.addEventListener("abort", () => readerAbort.abort(), {
      once: true,
    });
    // Why this turn's latest reading failed: no reasoning route at all, or
    // a model that answered nothing usable (live 2026-10-31).
    const readFailure = { serviceUnavailable: false };
    // Begun at message receipt by the early read when it was built for the
    // plan's own screen; otherwise built now.
    const situationText = situationOfRun(
      request.runId,
      request.actor,
      request.plan.screen,
      latest.utteranceRef !== undefined,
    );
    const stateText = conversationStateTextOf(
      {
        tenantId: request.tenantId,
        userId: request.actor.userId,
        runId: request.runId,
      },
      history,
      request.fetchedInConversation,
    );
    const readTurn = async (signal: AbortSignal = readerAbort.signal) =>
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
            onFailure: (failure) => {
              readFailure.serviceUnavailable = failure.serviceUnavailable;
            },
          },
          withResolution(referenceNote(shown, lastAction), pointed),
          request.plan.screen?.manifest?.controls,
          await situationText,
          await stateText,
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
    // HQ-1: any other typed turn still shows a line within a second
    // (first-line.ts), unless the reading, a fast lane or the answer comes
    // first. The same nameless holding line: it claims nothing.
    else if (
      !spokenTurn(latest) &&
      offerOfLastTurn(conversationId, history) === null
    ) {
      firstLines.set(
        request.runId,
        startFirstLineBudget({ say: () => sayHolding(request, null) }),
      );
    }
    // Live 2026-10-30 ("yes" to Q's plan offer: no Q line in the thread for
    // 6.1 s while the reading ran): a reply to the offer code recorded with
    // Q's last answer is a turn Q acts on whatever it says, so it hears
    // the same nameless line at once. Keyed on code's own record of the
    // offer, never on the reply's words (DECISIONS 40).
    else if (offerOfLastTurn(conversationId, history) !== null) {
      sayHolding(request, null);
    }
    // Owner 2026-10-30 (a conversational answer at 11-13 s): where the
    // time before the answer goes, per stage, on every turn (counts and
    // milliseconds only; nothing they said). See "q turn timing" below.
    const turnStartedAt = Date.now();
    // Turn C (live re-check of 3b7145616): the companies Q showed on cards,
    // and code's place in Q's own list ("the first one"), for a follow-up
    // answered from one of those cards.
    const shownCards = shownCardCompanies(history);
    const lastShown = lastShownCardCompanies(history);
    const listPlace =
      pointed !== null &&
      pointed.ask?.kind === "ORDINAL" &&
      pointed.resolved?.kind === "ONE" &&
      pointed.resolved.via === "Q_ANSWER"
        ? pointed.resolved.entity
        : null;
    /**
     * Live re-check of cb28c00e5 (turn C, decision 98): "Why is it there?"
     * after a one-card list was read navigation CONTEXT to Discover and the
     * page moved. A shown-list explanation (shownListExplanation) moves no
     * page unless their own words ask to open or go somewhere: the
     * reading's navigation is held to NONE here, as it lands, before the
     * page-move decision, the fast GO or the routing read it; recorded as
     * the run's navigationGuard.
     */
    let navigationGuard: string | null = null;
    const heldInPlace = (reading: QTurnReading | null): QTurnReading | null => {
      if (reading === null) return null;
      const explained = shownListExplanation({
        read: reading,
        utterance: latest.content,
        shown: shownCards,
        lastShown,
        bound: null,
        listPlace,
      });
      if (explained === null || asksToOpenAPage(latest.content)) return reading;
      const navigation = reading.navigation ?? null;
      if (
        navigation !== null &&
        navigation.mode === "NONE" &&
        (navigation.destination ?? null) === null
      )
        return reading;
      navigationGuard = "SHOWN_LIST_EXPLANATION";
      logger?.info(
        {
          qRunId: request.runId,
          navigationGuard,
          readerNavigation: navigation?.mode ?? null,
          readerDestination: navigation?.destination ?? null,
        },
        "q held a shown-list explanation in place",
      );
      return {
        ...reading,
        navigation: {
          mode: "NONE",
          negated: navigation?.negated ?? false,
          destination: null,
          tab: null,
        },
      };
    };
    // HQ-1: once the reading lands the answer is near; no budget line.
    const cancelFirstLine = () => firstLines.get(request.runId)?.cancel();
    const readingFirst = (async () => {
      const heard = heardReadings.get(request.runId);
      if (heard !== undefined) {
        heardReadings.delete(request.runId);
        logger?.info(
          { qRunId: request.runId },
          "q likely words answered from the first reading",
        );
        return heldInPlace(heard);
      }
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
      return heldInPlace(earlyRead ?? (await readTurn().catch(() => null)));
    })();
    void readingFirst.then(cancelFirstLine, cancelFirstLine);
    // C10 (TURN_READER v83): the page-move decision moves or offers a page
    // only where this reading asks for navigation; it is told the reading's
    // navigation intent the moment the reading lands (null: not read).
    // C10 v84: fast GO -- the reader's own destination, read GO, that code
    // may open moves at once in actOnTool; the decision is told so that it
    // adds no second move.
    const fastGo = readingFirst
      .then((reading) => fastGoOf(request, reading, latest.content))
      .catch(() => null);
    fastGoes.set(request.runId, fastGo);
    setTimeout(() => fastGoes.delete(request.runId), 120_000).unref?.();
    // A meeting prep (not a rehearsal they asked for): whether a meeting
    // with that counterpart is booked, from the meetings read model.
    const meetingBookedFor = async (
      reading: Awaited<typeof readingFirst>,
    ): Promise<{ readonly meetingBooked?: boolean }> => {
      const counterpart = reading?.meetingPrep?.counterpart ?? null;
      const booked = dependencies.callPrep?.bookedWith;
      if (
        counterpart === null ||
        booked === undefined ||
        reading?.reference?.open === "REHEARSAL"
      ) {
        return {};
      }
      const known = await booked(request, counterpart).catch(() => null);
      return known === null ? {} : { meetingBooked: known };
    };
    dependencies.pageMoves?.heard?.(
      request,
      Promise.all([readingFirst, fastGo]).then(
        async ([reading, go]) => ({
          // Decision 98 (turn C): a "why" about one item of Q's own shown
          // list is answered from its card, where they are.
          fromShownCard:
            shownListExplanation({
              read: reading,
              utterance: latest.content,
              shown: shownCards,
              lastShown,
              bound: null,
              listPlace,
            }) !== null ||
            shownItemTurn({
              read: reading,
              utterance: latest.content,
              company: shownCardCompanyOf({
                read: reading,
                shown: shownCards,
                bound: null,
                listPlace,
                lastShown,
                utterance: latest.content,
              }),
            }).why,
          // A pitch to watch is placed on the Elevator pitch tab, as in
          // placedNavigation (the decision is told the same tab).
          navigation:
            reading?.navigation != null &&
            reading.companyMedia?.pitch === true &&
            reading.navigation.tab === "deck"
              ? { ...reading.navigation, tab: "elevator" as const }
              : (reading?.navigation ?? null),
          codeMoves: go !== null,
          // Decision 98: an evaluative ask about a record it only names is
          // answered in place (the reader's answerKind, never the words).
          evaluative:
            reading?.answerKind === "ANALYSIS" ||
            reading?.answerKind === "COMPARISON",
          // Live rerun on bab915357 (turn 3, "Which documents did you use
          // for that?"): a follow-up on Q's own answer is answered in place;
          // no unasked "the company profile is ready to open".
          followUp: reading?.answerKind === "FOLLOW_UP",
          // Live re-run on cdb2dd74e (runs 48402c75, e7191400): a question
          // Q answers in its reply gets no unasked "is ready to open" above
          // the figures (the reader's kind and answerKind, never the words).
          question:
            reading?.kind === "QUESTION_TO_Q" &&
            reading.answerKind !== "DOCUMENT",
          // Decision 98 (live recheck 651a3bd50 T5): a meeting prep opens
          // the rehearsal only toward a meeting actually booked with them.
          ...(await meetingBookedFor(reading)),
          // Live d96c63ee1: with tab null, the decision's own deck too.
          pitch: reading?.companyMedia?.pitch === true,
          // Live d96c63ee1: the record the turn is about, not the pane's.
          subject: await pageMoveSubject(
            request,
            reading,
            latest.content,
          ).catch(() => undefined),
        }),
        () => null,
      ),
    );
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
          const document = skimmed?.document === true;
          // A document about someone is not a note to them (J3).
          const writes = skimmed?.writes === true || document;
          // F-76: "add … to my board" heard "Reading Ledgerfold's
          // profile": their own board is no one's profile.
          if (mentionsOwnBoard(latest.content)) return;
          if (!readingLanded && typeof name === "string") {
            sayHolding(request, name.trim().slice(0, 60), writes, document);
          } else if (!readingLanded && writes) {
            sayHolding(request, null, true, document);
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
      // DECISIONS 104: a spoken turn the skim reads as no app query starts
      // its context follow-up now, beside the reading (held evidence only).
      if (
        spoken &&
        lane === null &&
        skimmed?.kind === "OTHER" &&
        !readerAbort.signal.aborted
      ) {
        startContextEarly();
      }
      if (speculateTyped && lane === null) {
        if (typedSkimQuick(skimmed) && !readerAbort.signal.aborted) {
          startTyped();
        } else {
          logger?.info(
            {
              qRunId: request.runId,
              speculation: "skipped",
              reason: skimmed === null ? "UNSKIMMED" : "SKIM",
              decidedAfterMs: Date.now() - skimStarted,
            },
            "q typed speculation",
          );
        }
      }
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
      // Live re-check 15 Nov 2026 (T1): a ranked list of companies waits
      // for the full reading, whose list conditions ("which of them have
      // revenue", "outside my sectors") the quick first read does not
      // carry; answered before it, the condition was silently dropped.
      if (
        lane !== null &&
        !RANKED_LIST_LANES.has(lane.questionKind ?? "") &&
        (discovery || !context.turns.some((turn) => turn.blocks.length > 0)) &&
        !(await waitingOnThem())
      ) {
        speculative.current?.cancel("KIND");
        readerAbort.abort();
        noteCodeLane(request.runId, `SKIM_${lane.questionKind}`);
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
    const readMs = Date.now() - turnStartedAt;
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
        noteCodeLane(request.runId, `SKIM_${late.questionKind}`);
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
      read = heldInPlace(
        await rereadTurn(
          readTurn,
          readerAbort.signal,
          dependencies.turnRereadDeadlineMs ?? TURN_REREAD_DEADLINE_MS,
        ),
      );
      turnUnread = read === null;
      logger?.warn(
        { qRunId: request.runId, recovered: read !== null },
        "a turn to Q was not read on the first try",
      );
    }
    // Owner decision 2026-10-31: an investment (IC, deal) memo on a company
    // always includes web research -- the researched memo job, never the
    // quick profile-only document ("Write me an IC memo on Portside" came
    // back in ~37 s from the profile alone). The reader decides it by
    // meaning (v75 investmentMemo); code only refuses it for a document the
    // reader bound to their own company (no subject named), so a founder's
    // own memo keeps the quick path (v62).
    const researchedMemo = read !== null && researchedMemoAsked(read);
    if (read !== null && researchedMemo) {
      read = { ...read, teamJob: true, handOver: null };
    }
    // VOICE-FIX (owner live 20 Nov 2026): a bare yes to Q's question of
    // several options ("rehearse with a different company, review a
    // document, or explore Discover?") opened the Tensorgate rehearsal.
    // Read by meaning (v96 choiceUnclear), it moves nothing, takes up no
    // offer and acts on nothing: the answer asks which (CHOICE_UNCLEAR_NOTE).
    const choiceUnclear = read?.choiceUnclear === true;
    if (read !== null && choiceUnclear) {
      read = {
        ...read,
        navigation: null,
        acceptsOffer: false,
        workFromEarlier: false,
        askedAction: null,
      };
    }
    // VOICE-FIX: what they asked Q to leave out stays left out (v96
    // excludes), held per conversation until they name it again.
    const excludedNow = nextExclusions(exclusions.get(conversationId) ?? [], {
      excludes: read?.excludes ?? [],
      words: latest.content,
    });
    keepExclusions(conversationId, excludedNow);
    let research: Promise<QResearchDirective> = Promise.resolve(
      read === null ||
        // Lane S / C10 (audit item 6): a turn the reader read as answered
        // from what Q already showed ("put those three in a table", v54
        // fromShown), not asking for the web, re-renders those records and
        // never reaches the public web. The reading decides, not the words.
        (read.fromShown !== null &&
          read.fromShown !== undefined &&
          read.asksForWeb !== true)
        ? NO_RESEARCH
        : researchDirectiveFor(state, readingFromTurnReader(read), {
            available: dependencies.researchAvailable ?? true,
            aboutNamedOther: read.aboutNamedOther,
            // Owner replay batch 8 (#10): asking for the web, by meaning.
            asksForWeb: read.asksForWeb ?? false,
            // VOICE-FIX: their own next steps, a wish to be guided, and a
            // spoken correction or own-records question stay off the web.
            nextSteps: read.nextSteps === true,
            seeksGuidance: read.seeksGuidance === true,
            spoken: request.spoken === true,
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
          // C10: the navigation intent, for live checks (no words, no ids).
          navigation: read.navigation?.mode ?? null,
          navigationNegated: read.navigation?.negated ?? null,
          navigationDestination: read.navigation?.destination ?? null,
          // v87: the record tab read (a closed list; no words, no ids).
          navigationTab: read.navigation?.tab ?? null,
          // A8 v86: the company media asked for (booleans only).
          mediaPitch: read.companyMedia?.pitch ?? null,
          mediaPicture: read.companyMedia?.picture ?? null,
        },
        "q turn read",
      );
    }
    /**
     * The reading's routing, kept on the run once the turn's references
     * are bound (turn C: a follow-up on a shown list item changes its
     * research and class), or as the run asks which one they meant.
     */
    const routeReading = async (shownItem: {
      readonly researchGuard: string | null;
      readonly why: boolean;
    }): Promise<void> => {
      if (read === null || dependencies.recordRouting === undefined) return;
      routeRun(request, {
        kind: read.kind,
        confidence:
          typeof read.confidence === "string" ? read.confidence : null,
        question: read.question?.kind ?? null,
        research: (await research).mode,
        // Turn C: code held the research to Capital Q's records (null: it
        // is the reading's own).
        researchGuard: shownItem.researchGuard,
        tool: read.tool?.kind ?? null,
        teamJob: read.teamJob ?? false,
        meetingPrep: read.meetingPrep != null,
        aboutNamedOther: read.aboutNamedOther === true,
        addressedToQ: read.addressedToQ ?? true,
        navigation: read.navigation?.mode ?? null,
        navigationDestination: read.navigation?.destination ?? null,
        navigationGuard,
        spoken,
        lane: "READER",
        // The class the answer path takes (below), kept on the run as
        // well as in the log, for every path the reading routes to
        // (meeting prep included).
        executionClass: shownItem.why
          ? "CONTEXTUAL_FOLLOW_UP"
          : executionClassOfTurn({
              read,
              history,
              latestId: latest.id,
              carriesDocuments:
                (request.plan.screen?.attachedDocumentIds?.length ?? 0) > 0,
            }),
      });
    };
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
      if (read !== null && heardReadingReusable(read)) {
        heardReadings.set(request.runId, { ...read, heardAs: null });
      }
      try {
        return await answerTurn(request);
      } finally {
        reheard.delete(request.runId);
        heardReadings.delete(request.runId);
      }
    }
    // Q intelligence step 3: what their pointing words mean, read by the
    // reader against the conversation's ledger and checked here against
    // the very state it was shown. One reading binds (it replaces code's
    // word-pattern binding for the answer); two ask one short question
    // naming both. None (live 2026-11-06, QIQ-PRO-001: Q asked who "she"
    // was one line after naming her) no longer asks by default: the phrase
    // goes to the answer, which reads it from the recent turns and asks
    // only if they leave it open -- unless code already bound the words to
    // their page (a list or a control on it), which the ledger does not
    // hold. Code's guesses from the conversation itself ("him" as the last
    // company in focus) never outvote the reader's reading. A reply to a waiting card
    // is decided by that card's own exact payload, never here.
    const boundToPage =
      pointed?.control !== undefined ||
      (pointed?.resolved?.kind === "ONE" && pointed.resolved.via === "PAGE");
    /** T8: the records the reading's own references bound (lower-case ids). */
    let readerBoundIds: readonly string[] = [];
    let readerBoundCompanies: readonly string[] = [];
    let readerBoundNote = false;
    if (read !== null && read.addressedToQ !== false) {
      // v79: a name the reader read the words to joins this turn's ledger
      // only when it really is in the conversation's words (no invention,
      // no id made up); the stored turns hold their words this turn too.
      const shown = shownStateInRun.get(request.runId) ?? null;
      const named =
        shown === null || read.references === undefined
          ? null
          : withNamedReferences(
              shown,
              read.references,
              history.map((message) => ({
                text: message.content,
                byQ: message.role === "Q",
              })),
            );
      let binding = bindReferences(
        named?.references ?? read.references,
        named?.state ?? shown,
      );
      const shownState = named?.state ?? shown;
      // A heard name with two readings in their own record (AMB-136):
      // the reader's name for the company the turn is about, and any
      // pointing phrase no ledger entry fit, each checked against the
      // record; two candidates ask, as two readings of a phrase do.
      const nameCandidates = dependencies.nameCandidates;
      if (
        binding.kind !== "CLARIFY" &&
        nameCandidates !== undefined &&
        shownState !== null
      ) {
        const heard = [
          ...(read.namedOther?.kind === "COMPANY"
            ? [read.namedOther.name]
            : []),
          ...(binding.kind === "BOUND" ? binding.open : []),
          // v79: a company bound only by its name as said (no record
          // behind it) is still a name to check (live AMB-136, 61b7a85).
          ...(binding.kind === "BOUND"
            ? binding.bound.flatMap((one) =>
                one.entities.flatMap((entity) =>
                  entity.kind === "COMPANY" &&
                  entity.id === null &&
                  entity.name !== null
                    ? [entity.name]
                    : [],
                ),
              )
            : []),
        ].filter(
          (name, index, all) =>
            all.findIndex(
              (other) => other.toLowerCase() === name.toLowerCase(),
            ) === index &&
            // A name the conversation already holds as a record is that
            // record; a name with no record behind it decides nothing.
            !shownState.ledger.entities.some(
              (entity) =>
                entity.id !== null &&
                entity.name?.toLowerCase() === name.toLowerCase(),
            ),
        );
        for (const name of heard.slice(0, 2)) {
          const readings = nameReadings(
            name,
            await nameCandidates(request, name),
            shownState,
          );
          const asked = bindHeardName(name, readings, shownState);
          if (asked !== null) {
            binding = { ...asked, rejected: binding.rejected };
            break;
          }
        }
      }
      if (binding.rejected.length > 0) {
        logger?.warn(
          { qRunId: request.runId, rejected: binding.rejected.length },
          "the turn reading pointed at refs the conversation's ledger does not hold; refused",
        );
      }
      const askable =
        binding.kind === "CLARIFY" && read.replyTo?.kind !== "WAITING_CARD";
      if (binding.kind === "CLARIFY" && askable) {
        speculative.current?.cancel("ACTED");
        logger?.info(
          {
            qRunId: request.runId,
            lane: "REFERENCE_CLARIFY",
            reason: binding.reason,
          },
          "q asked which one they meant",
        );
        await routeReading({ researchGuard: null, why: false });
        return recordAnswer(request, conversationId, binding.question);
      }
      // Nothing bound and code already bound the words to their page: the
      // page's binding stands (the ledger does not hold the page's lists).
      if (
        binding.kind === "BOUND" &&
        !(binding.bound.length === 0 && boundToPage)
      ) {
        boundRefsInRun.set(
          request.runId,
          binding.bound.flatMap((one) => one.entities.map((e) => e.ref)),
        );
        resolvedInRun.set(request.runId, binding.note);
        while (resolvedInRun.size > PREREADS_MAX) {
          const oldest = resolvedInRun.keys().next().value;
          if (oldest === undefined) break;
          resolvedInRun.delete(oldest);
          placedInRun.delete(oldest);
        }
        const companies = boundCompanyIds(binding);
        if (companies.length >= 2) placedInRun.set(request.runId, companies);
        else placedInRun.delete(request.runId);
        logger?.info(
          {
            qRunId: request.runId,
            phrases: binding.bound.length,
            entities: binding.bound.reduce(
              (sum, one) => sum + one.entities.length,
              0,
            ),
          },
          "q bound a reference by the reader's reading",
        );
        readerBoundIds = binding.bound.flatMap((one) =>
          one.entities.flatMap((entity) =>
            entity.id === null ? [] : [entity.id.toLowerCase()],
          ),
        );
        readerBoundCompanies = [
          ...new Set(
            binding.bound.flatMap((one) =>
              one.entities.flatMap((entity) =>
                entity.kind === "COMPANY" && entity.id !== null
                  ? [entity.id]
                  : [],
              ),
            ),
          ),
        ];
        readerBoundNote = true;
      }
    }
    // Live re-check 15 Nov 2026 (T8): "who should we approach first?"
    // opened with "By the first one I mean Zino Aviation…": the word
    // "first" was read as a place in Q's list. A place in a list is bound
    // only when the reading marks one -- a numbered pointer into what Q
    // showed (reference.shown), an answer from a shown turn (fromShown), or
    // its own reference to the same record -- never from the word alone.
    const placeFromList = listPlace;
    const placeMarked =
      placeFromList !== null &&
      readingMarksPlace(read, placeFromList.id, readerBoundIds);
    // T3: the one company this turn points at, as the reading bound it,
    // for a follow-up answered from the card Q showed of it.
    const followUpCompany =
      readerBoundCompanies.length === 1
        ? (readerBoundCompanies[0] ?? null)
        : readerBoundCompanies.length === 0 &&
            placeMarked &&
            placeFromList?.kind === "COMPANY"
          ? placeFromList.id
          : null;
    if (followUpCompany !== null) {
      followUpCompanyInRun.set(request.runId, followUpCompany);
      while (followUpCompanyInRun.size > PREREADS_MAX) {
        const oldest = followUpCompanyInRun.keys().next().value;
        if (oldest === undefined) break;
        followUpCompanyInRun.delete(oldest);
      }
    }
    if (pointed !== null && placeFromList !== null && !placeMarked) {
      leadInRun.delete(request.runId);
      if (!readerBoundNote) {
        resolvedInRun.delete(request.runId);
        placedInRun.delete(request.runId);
      }
      logger?.info(
        { qRunId: request.runId, ask: "ORDINAL" },
        "a place word the reading did not mark as a list reference; not bound",
      );
    }
    // Live re-check of 3b7145616 (turn C): a follow-up on one company of
    // Q's own shown list (a fit list or a conditioned one) with no web
    // wording keeps to Capital Q's records, recorded in routing; a "why"
    // about it is answered from its card as a contextual follow-up.
    // Live re-check of cb28c00e5 (turns C and D): the principle first --
    // an explanation about any list Q showed here, bound from their words,
    // deixis after a one-card list, the reading's binding or the place.
    const explained = shownListExplanation({
      read,
      utterance: latest.content,
      shown: shownCards,
      lastShown,
      bound: followUpCompany,
      listPlace: placeFromList,
    });
    const shownItemCompany =
      explained ??
      shownCardCompanyOf({
        read,
        shown: shownCards,
        bound: followUpCompany,
        listPlace: placeFromList,
        lastShown,
        utterance: latest.content,
      });
    const shownItem =
      explained !== null
        ? { aboutItem: true, why: true }
        : shownItemTurn({
            read,
            utterance: latest.content,
            company: shownItemCompany,
          });
    let researchGuard: string | null = null;
    if (shownItem.aboutItem && (await research).mode !== "NEVER") {
      research = Promise.resolve(NO_RESEARCH);
      researchGuard = "SHOWN_LIST_ITEM";
    }
    // Scenarios D-E (defect 7): an investor's own-records, figures or
    // diligence question keeps to Capital Q's records unless their words
    // ask about the public world; recorded in routing.
    if (
      researchGuard === null &&
      ownRecordsInvestorQuestion({
        read,
        utterance: latest.content,
        side: askerSideOf(request),
      }) &&
      (await research).mode !== "NEVER"
    ) {
      research = Promise.resolve(NO_RESEARCH);
      researchGuard = "OWN_RECORDS";
      logger?.info(
        { qRunId: request.runId, researchGuard },
        "q kept an own-records question off the public web",
      );
    }
    // Live 17 Nov 2026 (conversation ff20af7e): "Why does that matter for
    // an investor like me?" after Q's answer on Halyard Security was read
    // as advice about a named company, so the named-company rule made its
    // research EXPLICIT and each follow-up paid for a public web search
    // (its raw words as the query) that found nothing. A follow-up on what
    // Q just told them does no outside research unless the reading asks
    // for the web; recorded in routing.
    if (
      researchGuard === null &&
      read !== null &&
      read.asksForWeb !== true &&
      followsUpAnswer({
        read,
        history,
        latestId: latest.id,
        carriesDocuments:
          (request.plan.screen?.attachedDocumentIds?.length ?? 0) > 0,
      }) &&
      (await research).mode !== "NEVER"
    ) {
      research = Promise.resolve(NO_RESEARCH);
      researchGuard = "FOLLOWS_UP_ANSWER";
      logger?.info(
        { qRunId: request.runId, researchGuard },
        "q kept a follow-up on its own answer off the public web",
      );
    }
    if (
      explained !== null &&
      followUpCompanyInRun.get(request.runId)?.toLowerCase() !==
        explained.toLowerCase()
    ) {
      // Their words (or deixis on a one-card list) name the card; any other
      // binding of this run gives way to it.
      followUpCompanyInRun.delete(request.runId);
    }
    if (
      shownItem.why &&
      (followUpCompany === null || explained !== null) &&
      shownItemCompany !== null &&
      !followUpCompanyInRun.has(request.runId)
    ) {
      followUpCompanyInRun.set(request.runId, shownItemCompany);
      while (followUpCompanyInRun.size > PREREADS_MAX) {
        const oldest = followUpCompanyInRun.keys().next().value;
        if (oldest === undefined) break;
        followUpCompanyInRun.delete(oldest);
      }
    }
    if (shownItem.aboutItem) {
      logger?.info(
        {
          qRunId: request.runId,
          researchGuard,
          why: shownItem.why,
          explanation: explained !== null,
        },
        "q follow-up on an item of its own shown list",
      );
    }
    const answeredFromShownCard = shownItem.why;
    await routeReading({ researchGuard, why: answeredFromShownCard });
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
    // A save to their board, as the reader read it (v61 boardAsk). Q
    // intelligence step 4: never a word fallback when the reader left it
    // unread -- an unread save is no save, so it never starts new work
    // either (live 9ff4a1118, F-78b).
    const savesToBoard = boardAsk === "SAVE" || boardAsk === "BREAKDOWN";
    // F-90 (QA re-score): "Write a 12-month growth plan and save it to my
    // board", one turn. The work starts first; the board then keeps the
    // job itself, linked, never Q's previous answer.
    const asksNewWork =
      read !== null &&
      read.confidence !== "LOW" &&
      read.addressedToQ !== false &&
      read.workFromEarlier !== true &&
      (read.teamJob === true ||
        // The turn itself asks for a document first ("Write … and save
        // it"): the reader's DOCUMENT kind (v78), never the verb.
        read.answerKind === "DOCUMENT" ||
        (read.parts ?? []).some((part) => part.kind === "DOCUMENT"));
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
              // Live 17 Nov 2026: which action or hand made it a request,
              // so a follow-up asking for nothing but the card's own action
              // is resolved to the card (followsUpCard).
              askedAction:
                typeof read.askedAction === "string" &&
                read.askedAction.length > 0
                  ? read.askedAction
                  : (appActionOf(read)?.tool ?? null),
              hand:
                (read.tool ?? null) !== null
                  ? (read.tool?.kind ?? null)
                  : (read.handOver ?? null) !== null
                    ? "HAND_OVER"
                    : null,
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
      const unresolved =
        prep !== null && isCallPrepUnresolved(prep) ? prep : null;
      logger?.info(
        {
          qRunId: request.runId,
          prepared: prep !== null && unresolved === null,
          unresolved: unresolved?.kind ?? null,
          waiting:
            prep === null || isCallPrepUnresolved(prep)
              ? 0
              : prep.waiting.length,
          prepMs: Date.now() - startedAt,
        },
        "q prepared a call",
      );
      // RC4: several meetings or relationships it could be: Q asks which.
      if (unresolved?.kind === "WHICH") {
        speculative.current?.cancel("ACTED");
        return recordAnswer(
          request,
          conversationId,
          callPrepUnresolvedLine(unresolved),
        );
      }
      // None on record: the question is answered in general, and the
      // answer opens by saying there is no one meeting to brief them on.
      if (unresolved?.kind === "NONE") {
        leadInRun.set(request.runId, {
          line: callPrepUnresolvedLine(unresolved),
          name: "",
          always: true,
        });
        while (leadInRun.size > PREREADS_MAX) {
          const oldest = leadInRun.keys().next().value;
          if (oldest === undefined) break;
          leadInRun.delete(oldest);
        }
      }
      if (prep !== null && !isCallPrepUnresolved(prep)) {
        speculative.current?.cancel("ACTED");
        const offer = rehearsalOffer(prep);
        return recordAnswer(
          request,
          conversationId,
          callPrepLine(prep),
          offer === null ? undefined : [offer],
        );
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
    // DECISIONS 104 (owner, 2026-11-17): a same-subject follow-up is
    // answered at once from what this conversation already read and
    // showed -- no tools, pre-readers, retrieval or ranking -- when the
    // reading classes it CONTEXTUAL_FOLLOW_UP. Its evidence is reused only
    // for the same person, access context and conversation, fresh and
    // unchanged; its words are held to the claim check; anything its
    // sources do not hold is a miss, and the turn goes the full way below
    // (the record-only recall is then not asked again: it holds less).
    let contextTried = false;
    {
      const early = contextEarly.get(request.runId);
      contextEarly.delete(request.runId);
      const follow = dependencies.contextFollowUp;
      const fastPath =
        follow !== undefined &&
        read !== null &&
        read.confidence !== "LOW" &&
        request.capability === "ANSWER" &&
        (read.tool ?? null) === null &&
        fromShown?.reshow !== true &&
        // v94: their contact with the companies meant is code's answer,
        // from their own relationships, never the kept sources' words.
        read.contactStatus !== true &&
        !leadInRun.has(request.runId) &&
        !sequences.has(conversationId) &&
        // Live 17 Nov 2026 (conversation ff20af7e): also a question that
        // points back at Q's last answer and was read as judgement
        // (COMPLEX_ANALYSIS); a miss still answers it the full way.
        followsUpAnswer({
          read,
          history,
          latestId: latest.id,
          carriesDocuments:
            (request.plan.screen?.attachedDocumentIds?.length ?? 0) > 0,
        });
      const adoptable = early !== undefined && early.messageId === latest.id;
      if (!fastPath || !adoptable) early?.abort.abort();
      if (fastPath) {
        const startedAt = Date.now();
        const outcome = adoptable
          ? await early.outcome
          : await follow.answer(request, {
              conversationId,
              history,
              latestId: latest.id,
              said: latest.content,
              spoken,
            });
        logger?.info(
          {
            qRunId: request.runId,
            outcome: outcome.kind,
            reason: outcome.kind === "MISS" ? outcome.reason : null,
            early: adoptable,
            waitedMs: Date.now() - startedAt,
          },
          "q context follow-up",
        );
        if (outcome.kind === "ANSWERED") {
          speculative.current?.cancel("ACTED");
          return recordAnswer(request, conversationId, outcome.text);
        }
        // The sources could not answer it: the record-only recall holds
        // less, so only a call that never decided (no evidence, a failed
        // call, a revocation) leaves it to try.
        contextTried =
          outcome.reason === "NOT_ANSWERABLE" ||
          outcome.reason === "UNGROUNDED" ||
          outcome.reason === "CLAIMS_WORK";
      }
    }
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
        !contextTried &&
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
      read?.replyTo?.kind === "Q_QUESTION" &&
      !asksToGoRead(read, latest.content, inWorkspace(request));
    if (
      reference !== null &&
      reference.open !== null &&
      !continuesByReading &&
      // A3: the record already goes with this turn's answer (opened by
      // name above, with more asked after it): never opened twice.
      !movesWithQuestion.has(request.runId) &&
      (reference.open === "REHEARSAL" ||
        // C10: the reading's GO opens it at once (with the rest answered
        // when parts asks more); CONTEXT is the page-move decision's to
        // place (workspace); NONE or OFFER_ONLY never opens it. Words
        // decide only with no navigation reading (fallback).
        (navigationOf(read, inWorkspace(request)) === null
          ? !asksAboutIt && onlyAMove(latest.content)
          : readsAsGo(navigationOf(read, inWorkspace(request)))))
    ) {
      const opened = await openReferenced(
        request,
        conversationId,
        reference,
        shown,
        history,
        read,
      );
      if (opened !== null) return opened;
    }
    // v87: a tab read GO with no record named is the record in view.
    if (
      (reference === null || reference.open === null) &&
      !continuesByReading &&
      !movesWithQuestion.has(request.runId)
    ) {
      const onTab = await readTabAnswer(request, conversationId, history, read);
      if (onTab !== null) return onTab;
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
    // Live 2026-10-30: a yes to Q's own offer binds to the offer recorded
    // with Q's turn (TURN_READER v74 acceptsOffer, by meaning). Taking up
    // the plan offer is the plan of what they first asked ("What should I
    // do today?"), never of the word "yes".
    // v61 workFromEarlier ("hands over work offered just before") is the
    // same taking-up, read by meaning: either binds the yes to the offer.
    // Live 2026-10-31 ("Your plan: yes"): the reader read the yes as a
    // plan ask (v73) but not as taking up the offer (v74), so the plan
    // quoted "yes". When Q's last turn offered the plan, a plan asked for
    // now is planned with the question that offer was made for in front
    // of their words, and its title quotes their words only when they
    // took nothing up -- never a bare reply ("Your plan" instead).
    const takesOffer =
      confident &&
      (read?.acceptsOffer === true || read?.workFromEarlier === true);
    const standingOffer = confident
      ? offerOfLastTurn(conversationId, history)
      : null;
    const offerTaken = takesOffer ? standingOffer : null;
    const offeredPlan = offerTaken?.kind === "PLAN" ? offerTaken : null;
    // C3: the action offer Q's last answer closed with, taken up by
    // meaning ("go for it", "sí, hazlo"), never by its words. It runs that
    // exact tool for that exact request, under the tool's own approval.
    const offeredAction = offerTaken?.kind === "ACTION" ? offerTaken : null;
    const offeredTool =
      offeredAction === null
        ? undefined
        : actions.find((action) => action.name === offeredAction.action);
    if (offeredAction !== null && offeredTool?.available === false) {
      // Offered last turn, not offered now (its eligibility changed): said
      // plainly, nothing done, never a different tool in its place.
      logger?.info(
        { qRunId: request.runId, action: offeredAction.action },
        "a yes to Q's offer of something this run cannot do: said so",
      );
      speculative.current?.cancel("ACTED");
      return recordAnswer(request, conversationId, OFFER_NOT_AVAILABLE_LINE);
    }
    // N1 by meaning: a yes to Q's offer of a page that the word rule did
    // not take ("go for it", "sí, ábrela") opens exactly the offered page.
    if (takesOffer && offerTaken === null && conversationId !== undefined) {
      const page = navigationOfferOf(history);
      if (page !== null) {
        logger?.info(
          { qRunId: request.runId, reply: "OPEN", by: "READING" },
          "a reply to Q's offer to open a page",
        );
        speculative.current?.cancel("ACTED");
        return recordAnswer(request, conversationId, openedOfferLine(page), [
          { kind: "UI_INTENT", intent: page.intent },
        ]);
      }
    }
    // Live 14 Nov 2026 (78f8d72d5, D13): the open resolution item is taken
    // up by a yes to the offer that opened it, or by a request for its
    // vehicle toward the same company ("Yes, please request that from
    // Ajopot", read TOOL_REQUEST with askedAction diligence_documents and
    // nothing the argument reader could fill). Code fills the vehicle's
    // inputs from the item -- whom, a suggested title, what it resolves --
    // and prepares it for their approval through the action's own
    // authorize step. The reading's structured outputs only; no words.
    const resolution =
      conversationId === undefined
        ? null
        : (resolutions.get(conversationId) ?? null);
    const askedVehicle =
      read?.kind === "TOOL_REQUEST"
        ? ([read.askedAction ?? null, appActionOf(read)?.tool ?? null].find(
            (name): name is string =>
              name !== null && UNCERTAINTY_VEHICLES.has(name),
          ) ?? null)
        : null;
    const resolutionTaken =
      resolution !== null &&
      confident &&
      dependencies.appActions !== undefined &&
      dependencies.appActions.tools.has(resolution.action) &&
      ((offeredAction !== null &&
        offeredAction.runId === resolution.runId &&
        offeredAction.action === resolution.action) ||
        (askedVehicle === resolution.action &&
          (read?.namedOther == null ||
            sameCounterparty(resolution, read.namedOther.name))));
    const resolutionArgs =
      resolutionTaken && resolution !== null
        ? resolutionArguments(
            resolution,
            appActionOf(read)?.tool === resolution.action
              ? appActionOf(read)?.arguments
              : null,
          )
        : null;
    if (
      resolution !== null &&
      resolutionArgs !== null &&
      conversationId !== undefined &&
      dependencies.appActions !== undefined
    ) {
      const action = { tool: resolution.action, arguments: resolutionArgs };
      const said = forThePerson(
        await dependencies.appActions.run(request, action).catch(() => null),
      );
      logger?.info(
        {
          qRunId: request.runId,
          tool: resolution.action,
          by: offeredAction === null ? "REQUEST" : "OFFER_TAKEN",
          prepared: said !== null && typeof said === "object",
        },
        "the open resolution item was taken up: code filled the request",
      );
      if (said !== null) {
        if (typeof said === "object" && !("asks" in said)) {
          keepResolution(conversationId, null);
        }
        speculative.current?.cancel("ACTED");
        return saidByAction(request, conversationId, action, said);
      }
    }
    /**
     * D14 (live 78f8d72d5, request 77a16cba): an explicit request for a
     * diligence document toward the open item's company, run by code from
     * the reader's arguments, carried no `about`; the founder saw no
     * "since they asked". It carries the item's.
     */
    const withOpenItem = (action: TurnAppAction): TurnAppAction => {
      const args = withOpenResolution(
        { name: action.tool, arguments: action.arguments },
        resolution,
      );
      return args === action.arguments
        ? action
        : { ...action, arguments: args as Record<string, unknown> };
    };
    const planWords = planStartWords({
      latest: latest.content,
      taken: offeredPlan,
      standing: standingOffer?.kind === "PLAN" ? standingOffer : null,
    });
    // RC4 (audit 15 Nov, F5-02): a turn the reader split into two or more
    // questions ("are investors interested in me? how do I get them, and
    // how do I rank better?") is answered, part by part; it never becomes
    // a plan job with no answer. The plan stays offered for a plain yes.
    const asksSeveralQuestions =
      (read?.parts ?? []).filter((part) => part.kind !== "DOCUMENT").length >=
      2;
    if (
      confident &&
      dependencies.plan !== undefined &&
      !asksSeveralQuestions &&
      (offeredPlan !== null || planAskRoutes(read?.planAsk ?? null))
    ) {
      const planAsk =
        offeredPlan === null
          ? (read?.planAsk ?? null)
          : planAskRoutes(read?.planAsk ?? null)
            ? (read?.planAsk ?? null)
            : OFFERED_PLAN_ASK;
      if (planAsk !== null) {
        // Live 2026-10-29: the first specific line ("gathering your
        // situation") came 5.6-6.9 s in, after the job was filed. It is
        // shown the moment the reading says this is their plan, before
        // anything is filed (one event insert; it never fails the turn).
        await showStage(request, "GATHERING_SITUATION");
        const started = await dependencies.plan
          .start(request, { ...planWords, planAsk })
          .catch(() => ({ status: "FAILED" as const }));
        logger?.info(
          {
            qRunId: request.runId,
            offerTaken: offeredPlan !== null,
            // Live 2026-10-31: what the reader said of the yes, so a plan
            // titled from their words after an offer shows why.
            acceptsOffer: read?.acceptsOffer === true,
            workFromEarlier: read?.workFromEarlier === true,
            offerStood: standingOffer !== null,
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
    const teamJobBy =
      confident && read?.teamJob === true && offeredAction === null
        ? "READING"
        : null;
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
        teamJobLine(
          planned,
          teamJobAudienceOf(request),
          researchedMemo ? { researching: true } : undefined,
        ),
        teamJobBlocks(planned),
      );
    }
    // A LOW reading is a guess, and a guess never moves anybody's screen or
    // prepares a change: it is answered like any other turn. A document
    // asked for "from what you can find publicly" may be read as a
    // research request as much as a tool request; either way it is a
    // request for the document, and the document is what they get.
    // Live 14 Nov 2026 (runs b58ece1a, 28635630): a yes to Q's recorded
    // action offer runs that offer's tool and nothing the reader names
    // afresh on the yes turn: no hand, no reader-named or routed action.
    // (A document offer still takes the document path below.)
    const keptToOffer =
      offeredAction !== null && offeredAction.action !== ANALYST_OFFER_DOCUMENT;
    const tool = keptToOffer
      ? null
      : readerToolOf(read, latest.content, inWorkspace(request));
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
    // SET_VISIBILITY read with a deck's or a pitch's own action named by
    // the reader (askedAction): that record's action, when offered.
    const audienceTool =
      tool?.kind === "SET_VISIBILITY"
        ? recordAudienceTool(read?.askedAction)
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
        read,
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
      !keptToOffer &&
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
      if (keptToOffer) return null;
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
      !keptToOffer &&
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
    /** D7: the action's own words, said after the answer instead of it. */
    let limitAfterAnswer: string | null = null;
    if (
      dependencies.appActions !== undefined &&
      appAction !== null &&
      read !== null &&
      read.confidence !== "LOW" &&
      dependencies.appActions.tools.has(appAction.tool) &&
      !writingDocument
    ) {
      const ran = await dependencies.appActions
        .run(request, withOpenItem(appAction))
        .catch(() => null);
      const said = forThePerson(ran);
      if (said !== null && typeof said === "string" && asksForAnAnswer(read)) {
        // D7 (live 14 Nov 2026, run dea2efd9, Kazikit at INTEREST
        // EXPRESSED): the document request was refused at prepare time and
        // its line was the whole reply, though the turn also asked how
        // solid their figures are. The reading asks for an answer too, so
        // the answer comes first, within what they may see, and the
        // action's own words close it.
        limitAfterAnswer = said;
        logger?.info(
          { qRunId: request.runId, tool: appAction.tool },
          "a declared action's words close the answer the turn also asked for",
        );
      } else if (said !== null) {
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
        limitAfterAnswer === null &&
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
              .run(
                request,
                withOpenItem({ tool: appAction.tool, arguments: again }),
              )
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
    const askedForWork = asksForWorkProducts(read?.parts);
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
      !keptToOffer &&
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
    const leadStartedAt = Date.now();
    // Live 2026-10-30 ("What should I do today?" x3): two of three runs
    // read the question as THEIR_OWN_RECORDS, not ADVICE, and lost the
    // priorities and the plan offer. Which source a question draws on is
    // not whether it asks what to do next: that is nextSteps alone, read
    // beside the class (TURN_READER v74), for any question to Q.
    // RC4 (audit 15 Nov, RC9 of the founder findings): the readiness list
    // opened answers to "why no interest?", "match each profile field" and
    // "what would improve your assessment in three months" -- questions
    // that ask for an explanation or a piece of work, not for what to do
    // next. The list opens an answer only when the reading's own answer
    // kind is a plain reply (no analysis, comparison or document asked
    // for) and the turn is one question; otherwise the readiness facts
    // reach the answer as facts and the question is answered as asked.
    const plainNextStepsAsk =
      (read?.answerKind === null ||
        read?.answerKind === undefined ||
        read.answerKind === "CHAT" ||
        read.answerKind === "LOOKUP" ||
        read.answerKind === "FOLLOW_UP") &&
      !asksSeveralQuestions;
    const asksNextSteps =
      !writingDocument &&
      read?.kind === "QUESTION_TO_Q" &&
      read.nextSteps === true &&
      read.aboutNamedOther !== true &&
      plainNextStepsAsk;
    // Owner 2026-10-30: "What should I do today?" is answered in the
    // conversation from what Q already holds (TURN_READER v72: planAsk
    // null, nextSteps true). What Q is doing is said as it starts --
    // reading where things stand for them -- beside the read, never
    // holding it up. A full plan is offered in the answer's closing line,
    // never started: building one is minutes of writing and two reviews,
    // which they choose (a yes is read as the plan ask, TURN_READER v73).
    const [readinessLead, planOffer] =
      asksNextSteps && dependencies.readinessLead !== undefined
        ? await Promise.all([
            dependencies.readinessLead(request).catch(() => null),
            dependencies.plan === undefined ||
            dependencies.planOffer === undefined
              ? null
              : dependencies.planOffer(request).catch(() => null),
            showStage(request, "GATHERING_SITUATION"),
          ])
        : [null, null];
    const readinessLeadMs = Date.now() - leadStartedAt;
    /**
     * Live 2026-10-30 (founder.ledgerbridge, "What should I do today?"):
     * code's priorities were composed 3.3 s after Enter but went out only
     * once the answer's own preparation reached them, about 1 s later, and
     * the model's first words came seconds after that. They are code's,
     * from their records, and open the stored answer whatever the model
     * writes, so they go out the moment they exist, as the answer's own
     * message (the answer stores it under this id and does not say them
     * again). Not on a spoken turn: the voice line says the answer.
     */
    const leadAnswerId =
      readinessLead !== null &&
      dependencies.deltas !== undefined &&
      !spoken &&
      request.plan.screen?.route !== "ONBOARDING"
        ? QMessageIdSchema.parse(randomUUID())
        : null;
    const ownRecords =
      readinessLead !== null ||
      (!writingDocument && read?.question?.kind === "THEIR_OWN_RECORDS") ||
      // A8 (live 14 Nov): a founder's correction about their own company
      // changes what is on record, and only an approval card does that;
      // the tool path holds propose_company_figure, the analysis does not.
      (!writingDocument &&
        correctsOwnCompany(
          read === null
            ? null
            : { kind: read.kind, aboutNamedOther: read.aboutNamedOther },
          request.subjects,
          request.plan,
        ));
    // What the turn is about narrows the tool offer (lead 2026-10-02);
    // "yes" to Q's own offer keeps the previous turn's focus.
    // A yes to a recorded action offer is focused on that offer's tool
    // alone, never on one the reader names afresh (live 28635630).
    const named = [
      ...(keptToOffer ? [offeredAction.action] : []),
      // D7: an action already refused this turn is not offered again;
      // its own words close the answer.
      ...(!keptToOffer &&
      limitAfterAnswer === null &&
      read?.askedAction !== undefined &&
      read.askedAction !== null &&
      actions.some((action) => action.name === read.askedAction)
        ? [read.askedAction]
        : []),
      ...(keptToOffer || limitAfterAnswer !== null || appActionOf(read) === null
        ? []
        : [appActionOf(read)?.tool ?? ""]),
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
              ownRecords:
                read.question?.kind === "THEIR_OWN_RECORDS" ||
                read.saveToOwnProfile === true,
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
    // RC3 (Q voice audit, 15 Nov 2026): the lane this turn takes, from the
    // reading's structure; a short contextual follow-up answers from this
    // conversation's evidence instead of a full investigation.
    // Turn C (live re-check of 3b7145616): a "why" about one item of Q's own
    // shown list is a contextual follow-up answered from that item's card,
    // whatever the reading's question kind made of it.
    const executionClass: ReturnType<typeof executionClassOfTurn> =
      answeredFromShownCard
        ? "CONTEXTUAL_FOLLOW_UP"
        : executionClassOfTurn({
            read,
            history,
            latestId: latest.id,
            carriesDocuments:
              (request.plan.screen?.attachedDocumentIds?.length ?? 0) > 0,
          });
    logger?.info(
      { qRunId: request.runId, executionClass },
      "q turn execution class",
    );
    const plainRequest: QAnswerRequest = {
      ...request,
      executionClass,
      // Live 17 Nov 2026 (run 0f483277): a question that asks for no action
      // and takes up no offer is answered; no approval card is prepared.
      ...(asksNoActionOf(read) ? { asksNoAction: true } : {}),
      // ADR 0081 (owner decision 105): the reading lets their words be
      // taken as their own statement (clear, not low-confidence, not
      // re-heard); otherwise a figure they state still comes as a card.
      ...(ownStatementClearOf(read, latest) ? { ownStatementClear: true } : {}),
      // Live 2026-10-30 (founder.ledgerbridge, "What should I do today?",
      // run 2c8fd21b): code's priorities lead this answer from their own
      // records, yet the reading's EXPLICIT research started the public web
      // beside it, and the model's first round was stopped as it began
      // answering, waited for the web (3.1 s) and was asked again; the web
      // "added nothing useful". Where code's own lead opens the answer, a
      // forced search is not what it waits on: the model holds the research
      // tool (OFFERED) and reaches for it when the question needs it.
      // Decided by the turn's structure (the lead exists), never its words.
      //
      // RC3: likewise a lane that does not go to the public web by itself
      // (a short follow-up, an acknowledgement, a question about what is
      // prepared): the reader did not ask for the web, so code does not
      // force a search; the model still holds the tool (OFFERED) for what
      // the evidence cannot answer.
      research:
        readinessLead === null && EXECUTION_LANES[executionClass].publicWeb
          ? research
          : research.then((directive) =>
              directive.mode === "EXPLICIT" ||
              (directive.mode === "ONLY_IF_EMPTY" &&
                !EXECUTION_LANES[executionClass].publicWeb)
                ? { ...directive, mode: "OFFERED" as const }
                : directive,
            ),
      capabilities: manifestOf(capabilities),
      ...(turnUnread ? { turnUnread: true } : {}),
      // Said aloud: the answer is shaped for the ear (2026-10-07).
      ...(spoken ? { spoken: true } : {}),
      ...(read === null
        ? {}
        : {
            // D7: answered as the question it also was; the refused
            // action is not a request still to be done this turn.
            turnKind: limitAfterAnswer === null ? read.kind : "QUESTION_TO_Q",
            aboutNamedOther: read.aboutNamedOther,
            namedOther: read.namedOther ?? null,
          }),
      // Live 2026-11-06 (6c8d108cf): a person Capital Q holds against a
      // record is searched for only on pages that name that company too.
      ...(() => {
        if (read?.namedOther?.kind !== "PERSON") return {};
        const company = personAnchorOf(
          read.namedOther.name,
          shownStateInRun.get(request.runId),
        );
        return company === null ? {} : { namedOtherAnchor: { company } };
      })(),
      ...(read?.question?.kind === undefined
        ? {}
        : { questionKind: read.question.kind }),
      // Q intelligence step 4: what was asked comes from the reading alone
      // (TURN_READER v78) -- the answer's work and every part of a compound
      // ask. Unread, neither is sent: the answer takes its neutral default.
      ...(read?.answerKind === undefined || read.answerKind === null
        ? {}
        : { answerKind: read.answerKind }),
      // TURN_READER v81: one part is a single elliptical ask ("same
      // question for X") made self-standing; two or more, a compound ask.
      ...(read?.parts === undefined || read.parts.length === 0
        ? {}
        : { askParts: read.parts }),
      ...(read?.remember === undefined || read.remember === null
        ? {}
        : { rememberAsk: read.remember }),
      ...(read?.asksForChart === true ? { asksForChart: true } : {}),
      // v82 (A8, owner directive 13 Nov 2026): what chart, read by meaning.
      // Names as said and a canonical metric; code resolves and validates.
      ...(read?.chart === undefined || read.chart === null
        ? {}
        : {
            chartIntent: {
              companies: read.chart.companies,
              metric: read.chart.metric,
              period: read.chart.period,
              sameAsBefore: read.chart.sameAsBefore,
            },
          }),
      ...(read?.asksForWeb === true ? { asksForWeb: true } : {}),
      // v86 (A8): they ask to watch a company's pitch, or about a company
      // as a whole, by meaning. Code picks the company and checks access.
      ...(() => {
        const companyMediaAsk = companyMediaAskOf(read);
        return companyMediaAsk === undefined ? {} : { companyMediaAsk };
      })(),
      ...(read !== null &&
      read.fromShown !== null &&
      read.fromShown !== undefined &&
      read.asksForWeb !== true
        ? { answersFromShown: true }
        : {}),
      // K8: a question about a prepared subject.
      ...(read?.kind === "QUESTION_TO_Q" &&
      read.question?.subject !== undefined &&
      read.question.subject !== null
        ? { preparedSubject: read.question.subject }
        : {}),
      // Owner 2026-11-06: companies asked for out on the public web, read
      // by meaning (discoverWhom COMPANIES, on a turn that asks for the web
      // or a search: RESEARCH_REQUEST, or a question with asksForWeb), are
      // found by a discovery plan built from the mandate, never one search
      // on the words. Investors asked for keep D1's path.
      // URGENT, live 2026-11-06 on 3547127f2: the reading said
      // DISCOVER_COMPANIES on a research request without discoverWhom
      // (run 01bef0a1), and "more online" after a list was read
      // PUBLIC_FACTS (run f477cbe4); neither was handed over and the early
      // web search answered. A web ask hands over to discovery when the
      // reading asks for companies (discoverWhom COMPANIES, or a
      // DISCOVER_COMPANIES or FIT question), or when Q already listed a
      // discovery in this conversation (code's own record, not words).
      // Investors asked for never do.
      // Batch 14 replay (run b19e26ed): "find paystack for me online now",
      // after a discovery list, was handed over and answered that the
      // pages "didn't name specific companies". A turn about one named
      // company or person (namedOther) asks for that one on the web, not
      // for companies to be found -- unless it asks for companies (like
      // it, or that fit): DISCOVER_COMPANIES or FIT.
      ...(read !== null &&
      read.discoverWhom !== "INVESTORS" &&
      !(
        read.aboutNamedOther === true &&
        read.namedOther !== undefined &&
        read.namedOther !== null &&
        read.question?.kind !== "DISCOVER_COMPANIES" &&
        read.question?.kind !== "FIT"
      ) &&
      (read.kind === "RESEARCH_REQUEST" ||
        (read.kind === "QUESTION_TO_Q" && read.asksForWeb === true)) &&
      (read.discoverWhom === "COMPANIES" ||
        read.question?.kind === "DISCOVER_COMPANIES" ||
        read.question?.kind === "FIT" ||
        priorListings(
          history
            .filter((message) => message.role === "Q")
            .map((message) => message.content),
        ).length > 0)
        ? {
            webDiscovery: {
              text: read.question?.text ?? "",
              sectors: read.question?.discover?.sectors ?? [],
              countries: (read.question?.discover?.countries ?? []).map(
                (code) => code.toUpperCase(),
              ),
              stages: read.question?.discover?.stages ?? [],
              count: read.question?.count ?? null,
              // Owner's account 2026-11-06: "…online that i would be
              // interested in" is fit with their mandate too (the reading).
              alsoOnCapitalQ:
                read.question?.kind === "FIT" ||
                read.question?.discover?.mandateRelevant === true ||
                read.question?.discover?.ranking === "FIT",
            },
          }
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
      // v93 (audit 2026-11-13 item 17): other parties' interest or
      // activity, read by meaning; the answer withholds it.
      ...(read?.othersActivity === true ? { othersActivityAsked: true } : {}),
      // v94 (live 18 Nov 2026, run cce59657): whether they are in contact
      // with the companies meant; answered by code from in-contact.ts.
      ...(read?.kind === "QUESTION_TO_Q" && read.contactStatus === true
        ? { contactStatusAsked: true }
        : {}),
      // v95 (HQ-1): the answer's shape, with the kinds already read.
      ...(read?.underspecified === true ? { underspecified: true } : {}),
      ...(read?.costlyIfWrong === true ? { costlyIfWrong: true } : {}),
      // v96 (HQ-5 follow-up): they want help working out what they want.
      ...(read?.seeksGuidance === true ? { seeksGuidance: true } : {}),
      // VOICE-FIX: a yes to several options asks which; exclusions held.
      ...(choiceUnclear ? { choiceUnclear: true } : {}),
      ...(excludedNow.length === 0 ? {} : { excludedSubjects: excludedNow }),
      // v88 (owner live 14 Nov 2026, D1): companies other than those they
      // are already in contact with, on a FIT or catalog question.
      // v89 (audit 2026-11-15, RC2): a founder's investors too ("which
      // investors fit, leaving out ones I'm already talking to").
      ...(read?.kind === "QUESTION_TO_Q" &&
      (read.question?.kind === "FIT" ||
        read.question?.kind === "DISCOVER_COMPANIES" ||
        read.question?.kind === "INVESTOR_PROSPECTS") &&
      (read.question.excludeRelationships === true ||
        read.question.listConditions?.relationship === "EXCLUDE_IN_CONTACT")
        ? { excludeRelationships: true }
        : {}),
      // v89 (RC2): the conditions they put on the list, applied by code.
      ...(read?.kind === "QUESTION_TO_Q" &&
      (read.question?.kind === "FIT" ||
        read.question?.kind === "DISCOVER_COMPANIES" ||
        read.question?.kind === "INVESTOR_PROSPECTS") &&
      read.question.listConditions !== null &&
      read.question.listConditions !== undefined
        ? { listConditions: { ...read.question.listConditions } }
        : {}),
      // v91 (owner live 17 Nov 2026): whether this list ask refines the
      // list just shown (its conditions carry) or asks for a new one.
      ...(read?.kind === "QUESTION_TO_Q" &&
      (read.question?.kind === "FIT" ||
        read.question?.kind === "DISCOVER_COMPANIES" ||
        read.question?.kind === "INVESTOR_PROSPECTS") &&
      typeof read.question.refinesShownList === "boolean"
        ? { listRefinesShown: read.question.refinesShownList }
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
              // v90: they asked why these fit, not for the list again.
              ...(read.question.fitReasons === true ? { reasons: true } : {}),
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
      ...(leadAnswerId === null
        ? {}
        : { leadLinesSaid: { answerMessageId: leadAnswerId } }),
      // Only beside code's own priorities: the offer closes that answer.
      ...(readinessLead === null || planOffer === null
        ? limitAfterAnswer === null
          ? {}
          : { closingLines: limitAfterAnswer }
        : { closingLines: planOffer }),
      // A yes to an offer code did not record: no screen move is guessed.
      // D6 (live 14 Nov 2026, run c5fbdd3f): "Yes, please prepare that
      // request to Ajopot" names its own action. A request the reader read
      // as one, for an action this run may take, is not a guess at an
      // offer: it is asked for in its own right, and that action's own
      // authorize step and approval card decide it.
      ...(confident &&
      read?.acceptsOffer === true &&
      offerTaken === null &&
      !(
        read.kind === "TOOL_REQUEST" &&
        typeof read.askedAction === "string" &&
        offeredNames.has(read.askedAction)
      )
        ? { offerTakenUnrecorded: true as const }
        : {}),
      // C3: the recorded offer they took up, for the answer to do exactly.
      ...(offeredAction === null
        ? {}
        : {
            offerTaken: {
              action: offeredAction.action,
              request: offeredAction.request,
              said: offeredAction.said,
              ...(offeredAction.about === undefined
                ? {}
                : { about: offeredAction.about }),
            },
          }),
      // Only a name the reader was given counts (ADR 0040 parity). A taken
      // offer's acting tool is the action asked: its own authorize step and
      // approval rules decide what happens, never this turn's words.
      ...(offeredAction !== null && offeredTool !== undefined
        ? { askedAction: offeredAction.action }
        : keptToOffer || limitAfterAnswer !== null
          ? {}
          : redirectedTo !== null
            ? { askedAction: redirectedTo }
            : read?.askedAction === undefined ||
                read.askedAction === null ||
                !actions.some((action) => action.name === read.askedAction)
              ? routedAsked === null
                ? {}
                : { askedAction: routedAsked }
              : { askedAction: read.askedAction }),
      ...(writingDocument ? { writingDocument: true } : {}),
      // D14: a request the answer prepares toward the open item's company
      // carries what it resolves (model-gateway withOpenResolution).
      ...(resolution === null ? {} : { openResolution: resolution }),
      ...(series.step === null ? {} : { questionSequence: series.step }),
      ...(toolFocus === null ? {} : { toolFocus }),
    };
    // HQ-5: discovery's decision, with the reading complete.
    const finalRequest = await withDiscovery(
      plainRequest,
      conversationId,
      latest.content,
    );
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
    // Still unread after the extra try: no answer path is guessed for it
    // (TURN_UNREAD_REPLY). Whatever it asked for is not started and not
    // answered as something else; Q says so and they send it again.
    if (finalRequest.turnUnread === true) {
      // No reasoning route at all is Q's side, said plainly; their message
      // is on the thread either way (live 2026-10-31: credit ran out and
      // every turn was told to send it again, as if the words were at fault).
      const unavailable = readFailure.serviceUnavailable;
      logger?.warn(
        { qRunId: request.runId, serviceUnavailable: unavailable },
        unavailable
          ? "a turn to Q was not read; no reasoning route could be reached, said so"
          : "a turn to Q was not read; nothing started, asked to send it again",
      );
      return recordAnswer(
        request,
        conversationId,
        unavailable ? TURN_UNREACHABLE_REPLY : TURN_UNREAD_REPLY,
      );
    }
    {
      const sentAt = Date.parse(latest.createdAt);
      // Already settled: the reader waited for it.
      const loadedState = await statesInRun
        .get(request.runId)
        ?.catch(() => null);
      logger?.info(
        {
          qRunId: request.runId,
          readMs,
          // Step 11: the conversation state's read and fold, and whether
          // this process's committed copy stood in for the store.
          stateMs: loadedState?.loadMs ?? null,
          stateCached: loadedState?.cached ?? null,
          readinessLeadMs,
          lead: readinessLead !== null,
          // Live 2026-10-30: what the lead keyed on, beside the class.
          questionKind: read?.question?.kind ?? null,
          nextSteps: read?.nextSteps === true,
          offerTaken:
            read?.acceptsOffer === true
              ? offerTaken === null
                ? "UNRECORDED"
                : offerTaken.kind
              : null,
          // The reading through the routing above, before the answer.
          beforeAnswerMs: Date.now() - turnStartedAt,
          sinceMessageMs: Number.isFinite(sentAt) ? Date.now() - sentAt : null,
          speculationAdopted: speculation !== null && misfit === null,
        },
        "q turn timing",
      );
    }
    const adopting = speculation !== null && misfit === null;
    if (!adopting && leadAnswerId !== null && readinessLead !== null) {
      for (const line of readinessLead.split("\n")) {
        const said = line.trim();
        if (said.length === 0) continue;
        dependencies.deltas?.publish({
          runId: request.runId,
          tenantId: request.tenantId,
          messageId: leadAnswerId,
          text: `${said} `,
        });
      }
    }
    const outcome =
      adopting && speculation !== null
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
    // The plan offer that closed this answer is recorded with it, so a yes
    // next turn binds to exactly this offer (TURN_READER v74 acceptsOffer).
    if (
      outcome.kind === "ANSWERED" &&
      finalRequest.closingLines !== undefined &&
      finalRequest.closingLines === planOffer
    ) {
      recordOffer(conversationId, {
        kind: "PLAN",
        runId: request.runId,
        ask: latest.content,
      });
    }
    // C3: the offer the answer closed with, as the gateway bound it to a
    // tool of this run and kept it said, is recorded with this run; the
    // next turn's yes (TURN_READER acceptsOffer) runs exactly that offer.
    // Code's own plan offer closes the answer when it was made; it stands.
    const planOfferedNow =
      offers.get(conversationId)?.kind === "PLAN" &&
      offers.get(conversationId)?.runId === request.runId;
    if (
      outcome.kind === "ANSWERED" &&
      outcome.offer !== undefined &&
      !planOfferedNow
    ) {
      recordOffer(conversationId, {
        kind: "ACTION",
        runId: request.runId,
        action: outcome.offer.action,
        request: outcome.offer.request,
        said: outcome.offer.said,
        ...(outcome.offer.about === undefined
          ? {}
          : { about: outcome.offer.about }),
        ...(outcome.offer.counterparty === undefined
          ? {}
          : { counterparty: outcome.offer.counterparty }),
      });
      // D12: an offer to resolve a material uncertainty about a company,
      // through the route the stage allows, opens the item a later
      // "request that" resolves to. A newer one replaces it.
      const opened = openResolutionOf(request.runId, outcome.offer);
      if (opened !== null) keepResolution(conversationId, opened);
    } else if (
      // Live 14 Nov 2026 (run b58ece1a): a turn that failed (malformed
      // output, a provider fault) answered nothing, stored no Q turn and
      // superseded nothing, so the standing offer stays and the person's
      // repeated yes still binds to it. Only a completed answer that
      // closed without an offer (a decline, another question) ends it.
      outcome.kind === "ANSWERED" &&
      offers.get(conversationId)?.kind === "ACTION"
    ) {
      offers.delete(conversationId);
    }
    if (outcome.kind === "FAILED" && outcome.cause === "MALFORMED_OUTPUT") {
      // The reasoning service answered; its answer was malformed. Not an
      // outage: said as what happened, and not counted toward stopping.
      notices.set(request.runId, MALFORMED_ANSWER_LINE);
    } else if (outcome.kind === "FAILED") {
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
            // A8: nor one claiming Q did something (recorded, corrected,
            // "keeping both"): the stored answer's promise check decides.
            if (actionClaims(sentence).length > 0) return;
            // A sentence the guard would touch is not streamed at all: the
            // stored answer decides what replaces it.
            const checked = withoutRecommendationClaims(sentence);
            if (checked.removed > 0) return;
            const guardedSentence = checked.text.trim();
            if (guardedSentence.length === 0) return;
            const first = streamedSentences === 0;
            streamedSentences += 1;
            deltas.publish({
              runId: request.runId,
              tenantId: request.tenantId,
              messageId: answerId,
              text: streamedPiece(guardedSentence, first),
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
    /*
     * A8 (live 14 Nov, founder.maji-loop on 5f4603b05): this path holds no
     * tools, yet its answer said "I'm keeping both figures visible" after a
     * correction nothing had recorded. The gateway's promise check runs on
     * the tool path only, so the same check runs here over the model's
     * words: what backs a claim is what code did in this run -- a statement
     * recorded through the Write Gate (said by quietlyNoted below) or the
     * document prepared -- and nothing else. Code's own lines are added
     * after, unchecked.
     */
    const promised = checkPromises(guarded.text, {
      actions: [],
      writingDocument: prepared !== null,
      remembering: result.recordedStatements.length > 0,
    });
    if (promised.unbacked.length > 0) {
      logger?.warn(
        { qRunId: request.runId, unbacked: promised.unbacked },
        "unbacked action claims replaced in a specialist answer",
      );
    }
    const content =
      `${promised.text}${provenance}${acknowledgement}${documentNote}`
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

    const answerBlocks: QResultBlock[] | undefined =
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
    // W4: the page pane's move joins the answer, outside the transaction.
    const blocks = await movedBlocks(request, answerBlocks);
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

  /**
   * Batch-8 replay (owner via integration): a page-move decision that was
   * still running when the answer was stored is never dropped. Its move
   * follows the answer as a short second message, before the run
   * completes, so the pane still goes where the conversation points.
   */
  async function followWithLateMove(
    request: QAnswerRequest,
    outcome: QAnswerOutcome,
  ): Promise<void> {
    if (outcome.kind !== "ANSWERED") return;
    const late = await dependencies.pageMoves
      ?.late?.(request)
      .catch(() => null);
    if (late == null) return;
    const history = await historyOfRun(request.tenantId, request.runId).catch(
      () => [] as readonly QConversationMessage[],
    );
    const conversationId = history[0]?.conversationId;
    if (conversationId === undefined) return;
    await recordAnswer(
      request,
      conversationId,
      late.content,
      late.blocks,
    ).catch((error: unknown) => {
      logger?.warn(
        {
          qRunId: request.runId,
          err: error instanceof Error ? error.name : typeof error,
        },
        "q late page move not stored",
      );
    });
  }

  return {
    lastResult: () => last,
    answer: async (request) => {
      try {
        const outcome = await answerTurn(await withFetched(request));
        await followWithLateMove(request, outcome);
        return outcome;
      } finally {
        // Every run keeps its routing: one no reading routed, as the code
        // lane that answered it.
        routeUnreadRun(request);
        // Step 11: the state's save ran beside the turn; a run ends only
        // once it has settled (it never fails the answer).
        await statesInRun
          .get(request.runId)
          ?.then((loaded) => loaded?.saving)
          .catch(() => undefined);
      }
    },
    preread,
    discard: (runId: string) => {
      prereads.delete(runId);
      situationsInRun.delete(runId);
      delegate.discard?.(runId);
    },
    failureNotice: (runId: string) => {
      const notice = notices.get(runId);
      notices.delete(runId);
      return notice;
    },
  };
}
