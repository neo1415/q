// W3-B (audit finding 4): moved unchanged out of answer.ts, which
// re-exports what it exported. Here: the answer seam's dependencies (its ports and routing).
import {
  type QNavigateDestination,
  type QResultBlock,
} from "@capital-q/contracts";
import {
  type DatabaseExecutor,
  type TransactionManager,
} from "@capital-q/database";
import {
  type ContextFollowUp,
  type QPageMovePort,
  type QSituationPort,
  type QTurnReader,
  type QTurnSkimmer,
} from "@capital-q/model-gateway/q";
import { type Logger } from "@capital-q/observability";
import { type DiscoveryCoverage } from "@capital-q/q-core";
import {
  type QAnswerPort,
  type QAnswerRequest,
  type QConversationFetch,
  type QLiveDeltaBus,
  type QRuntimeRepositories,
} from "@capital-q/q-runtime";
import { type GetInvestorMandateOutput } from "@capital-q/q-tools";
import { type ActorContext } from "@capital-q/security";

import { type QVisibilityNotebook } from "./answer-board.js";
import {
  type PendingAppActionStore,
  type QAppActionPort,
} from "./app-action-turn.js";
import { type QCallPrepPort } from "./call-prep.js";
import {
  type CompanyIntelligenceRequest,
  type CompanyIntelligenceResult,
} from "./company/contracts.js";
import { type ArtifactPreparation } from "./company/prepare-artifact.js";
import { type QSpecialist } from "./contracts.js";
import { type ConversationCoreStore } from "./conversation-core.js";
import { type QDelegationPort } from "./delegation.js";
import {
  type KnownEntityMatcher,
  type PreparedFollowUpPort,
} from "./fast-lane.js";
import { type QHandOverPort } from "./hand-over.js";
import { type QNameCandidatesPort } from "./name-candidates.js";
import { type QNamedCompanyPort } from "./named-company.js";
import { type MandateLabels } from "./own-mandate-document.js";
import { type QOwnRecordsPort } from "./own-records-port.js";
import { type PendingDecisionPort } from "./pending-decision.js";
import { type QPlanJobPort } from "./plan-job-port.js";
import { type QProfileGapsPort } from "./profile-gaps.js";
import { type QOpenRecordPort } from "./references.js";
import { type QSpeculationEvent } from "./speculation.js";
import { type QTeamJobPort } from "./team-job.js";

/** The reader's routing decision for one run: closed codes, no words or ids. */
export type QRunRouting = {
  readonly kind: string;
  readonly confidence: string | null;
  readonly question: string | null;
  readonly research: string;
  /**
   * Live re-check of 3b7145616 (turn C): why code changed the reading's
   * research ("SHOWN_LIST_ITEM": a follow-up on an item of Q's own shown
   * list, no web wording, held to Capital Q's records); null: unchanged.
   */
  readonly researchGuard: string | null;
  readonly tool: string | null;
  readonly teamJob: boolean;
  readonly meetingPrep: boolean;
  readonly aboutNamedOther: boolean;
  readonly addressedToQ: boolean;
  readonly navigation: string | null;
  readonly navigationDestination: string | null;
  /**
   * Live re-check of cb28c00e5 (decision 98): why code changed the
   * reading's navigation ("SHOWN_LIST_EXPLANATION": an explanation about
   * Q's own shown list, held in place); null: the reading's own.
   */
  readonly navigationGuard: string | null;
  readonly spoken: boolean;
  /**
   * Live re-check 15 Nov 2026: the code lane that answered a run the
   * reader never read ("READER" when the reading routed it), so every run
   * carries its routing, not only the read ones.
   */
  readonly lane: string;
  /** RC3: the turn's execution class, from the reading (null: unread). */
  readonly executionClass: string | null;
};

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
   * Q intelligence step 1: who is asking, read by the server for the
   * actor, for the reader's situation header. Absent: told as unknown.
   */
  readonly situationOf?: QSituationPort | undefined;
  /** The situation's clock; tests fix it. */
  readonly now?: (() => Date) | undefined;
  /**
   * How long the turn waits for its situation header and conversation
   * state before it reads the turn without them (bounded-read.ts).
   * Default TURN_READ_DEADLINE_MS; tests shorten it.
   */
  readonly turnReadDeadlineMs?: number | undefined;
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
  /**
   * DECISIONS 104 (owner, 2026-11-17): a turn the reader classes
   * CONTEXTUAL_FOLLOW_UP, answered from what the previous full answer of
   * this conversation was given (kept conversation evidence: same person,
   * access context and conversation, inside its TTL and unchanged) and
   * what Q showed, in one tool-free call held to the claim check
   * (model-gateway createContextFollowUp). A MISS: the full path answers.
   * Absent: the full path, as before.
   */
  readonly contextFollowUp?: ContextFollowUp | undefined;
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
   * Owner 2026-10-30: the line closing that answer, offering a full plan
   * (readiness-lead.ts createPlanOfferLine). Used only when the plan job is
   * composed, so Q never offers what it cannot start.
   */
  readonly planOffer?:
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
   * Q Workspace W4 (DECISIONS 71): the page pane's move, decided beside
   * the turn when the screen carries the workspace and added to the
   * answer's blocks just before it is stored. The delegate (the
   * conversational answer) settles it on the same port.
   */
  readonly pageMoves?: QPageMovePort | undefined;
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
   * Audit 15 Nov 2026 (RC5): the reader's routing decision is kept on the
   * run itself, not only in logs that rotate with each deployment. Closed
   * codes only; best effort (a failed write never fails the turn).
   */
  readonly recordRouting?:
    | ((input: {
        readonly tenantId: string;
        readonly runId: string;
        readonly routing: QRunRouting;
      }) => Promise<void>)
    | undefined;
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
   * Q-NAV: the role their own membership holds in the organisation they
   * act for, read on the server. It decides which organisation screens the
   * run may open (the sidebar's rule). Absent or failed: none of them.
   */
  readonly organisationRole?:
    | ((actor: ActorContext) => Promise<"OWNER" | "ADMIN" | "MEMBER" | null>)
    | undefined;
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
   * HQ-5: what Q already holds for this person against the discovery gap
   * model (their onboarding answers, mandate, company record), read as
   * them. Read only while the conversation is in discovery. Absent or
   * null: no gap model, so discovery asks nothing and moves to a next step.
   */
  readonly discoveryCoverage?:
    | {
        readonly read: (
          request: QAnswerRequest,
        ) => Promise<DiscoveryCoverage | null>;
      }
    | undefined;
  /**
   * Acceptance 2026-11-04 (J3): a company named in a document request,
   * resolved to the Capital Q record the person may open and planned by
   * the Context Firewall (named-company.ts). Absent or null: the document
   * is built from public sources, as before.
   */
  readonly namedCompany?: QNamedCompanyPort | undefined;
  /**
   * Live Q-IQ 2026-11-06 (AMB-136): the companies a name the reader heard
   * could mean, from the person's own authorised record
   * (name-candidates.ts). Absent: a heard name is never checked for a
   * second reading.
   */
  readonly nameCandidates?: QNameCandidatesPort | undefined;
  /**
   * Voice speculation (latency2): a spoken turn's answer starts at once
   * under a conservative default reading, beside the turn reader, and is
   * adopted only where the turn's own path arrives at the same answer
   * (see speculation.ts). Absent or `spoken: false`: never.
   */
  readonly speculation?:
    | {
        readonly spoken: boolean;
        /**
         * HQ-1 (conversation audit §2.2): a typed quick question starts too,
         * gated on the skim as voice is, and is adopted only where the full
         * reading reads the same quick lookup (speculationMisfit). Absent
         * or false: typed turns never speculate.
         */
        readonly typed?: boolean | undefined;
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
