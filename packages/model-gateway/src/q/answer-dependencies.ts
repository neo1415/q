// Moved verbatim from ./index.ts (W3-A, audit finding 4: the god-file split).

import type {
  ArrivalSnapshot,
  CompanyEditableField,
  CorrelationId,
  ModelDataPosture,
  PermittedContextPlan,
  QArtifactSummary,
  QResultBlock,
  QSubjectRef,
  TenantModelPolicy,
} from "@capital-q/contracts";
import type { DatabaseExecutor, TransactionManager } from "@capital-q/database";
import type { Logger } from "@capital-q/observability";
import {
  NOTHING_REMEMBERED,
  type CompanyAnalystV30Result,
  type EtiquetteGuides,
  type PromptRegistry,
} from "@capital-q/q-core";
import type {
  QAnswerPort,
  QAnswerRequest,
  QLiveDeltaBus,
  QRuntimeRepositories,
  QToolCallOutcome,
  QToolPort,
} from "@capital-q/q-runtime";
import type { ActorContext } from "@capital-q/security";
import type { ModelGateway } from "../gateway.js";
import type { QAccountDigestPort } from "./account-digest.js";
import { claimCorpus, recheckCounts, statedNumbers } from "./claim-check.js";
import type { QCompanyMediaPort } from "./company-media.js";
import type { ConversationEvidence } from "./conversation-evidence.js";
import type { QReceiptPort } from "./conversation-receipts.js";
import type { QMemoryCallbackCandidate } from "./memory-callback.js";
import type { QPageMovePort } from "./navigation-decision.js";
import type { QOnboardingNudgePort } from "./onboarding-nudge.js";
import type { OwnRehearsal } from "./own-day.js";
import type { QOwnOnboardingPort } from "./own-onboarding.js";
import type { QOwnIndex } from "./own-standing.js";
import type { ReadCache } from "./read-cache.js";
import type { QPicturePort, QPublicPicturePort } from "./result-blocks.js";
import type { QSituationPort } from "./situation-header.js";
import type { QTurnSkimmer } from "./turn-skim.js";
import type { WebDiscoveryReader } from "./web-discovery-reader.js";
import type { ClearCheck } from "./held-and-offers.js";
import type {
  QAnswerSensitivityPolicy,
  QAuthorisedContextPort,
  QCommunicationProfilePort,
} from "./answer-plan.js";

/**
 * Records a statement the person made about their own company, verified
 * against their own words (CQ-Q-RESEARCH-001 §21). Optional: without it a
 * proposed statement is simply not recorded. Implemented by q-knowledge.
 */
/** One requested change to a declared profile field, quoted from the person. */
export type QProfileUpdateReading = {
  readonly field: CompanyEditableField;
  readonly value: string | null;
  readonly quote: string;
};

/**
 * Changing a document Q already prepared (QX-003F; ADR 0013).
 *
 * A port, because this seam composes prose and must not hold a
 * repository: the composition root supplies an adapter over the artifact
 * application service, which re-derives authority from the run's own
 * plan. Absent on a build with no artifact context, and then a request to
 * change a document is answered without one.
 *
 * It lives here as well as on the specialist seam because a revision is
 * not a company investigation. "Make the executive summary shorter" is a
 * question about wording, so it routes to the conversational path — and
 * the person should not have to phrase it as an analysis request to be
 * understood.
 */
export type QArtifactReviser = {
  readonly reviseFromConversation: (input: {
    readonly actor: ActorContext;
    readonly plan: PermittedContextPlan;
    readonly runId: string;
    /** The person's own words for what should change. */
    readonly instruction: string;
    /** Their own recent turns, for resolving which document they mean. */
    readonly history: readonly {
      readonly blocks?: readonly QResultBlock[] | undefined;
    }[];
    readonly signal?: AbortSignal | undefined;
  }) => Promise<QArtifactSummary | null>;
};

export type QProfileUpdateNotebook = {
  readonly note: (entry: {
    readonly runId: string;
    readonly tenantId: string;
    readonly companyId: string;
    readonly updates: readonly QProfileUpdateReading[];
  }) => void;
  /**
   * The person asked to be called something else (ADR 0011). Their own
   * record, proposed for their own approval; absent means the reading is
   * dropped and the answer says nothing about it.
   */
  readonly noteDisplayName?:
    | ((entry: {
        readonly runId: string;
        readonly tenantId: string;
        readonly userId: string;
        readonly displayName: string;
        readonly quote: string;
      }) => void)
    | undefined;
};

/**
 * What Capital Q remembers about the person, for the prompt (ADR 0012).
 *
 * Text, already rendered and bounded, because the gateway has no business
 * knowing how memory is shaped; the memory service owns retrieval, scope
 * and rendering, and the prompt marks whatever arrives as untrusted. A
 * failure to recall is an empty memory, never a failed answer.
 */
export type QMemoryRecall = {
  readonly recall: (input: {
    readonly actor: ActorContext;
    readonly runId: string;
    /** The conversation the run belongs to, when the caller knows it. */
    readonly conversationId?: string | undefined;
    readonly subjects: readonly QSubjectRef[];
    /**
     * The person's latest message, so memory can find earlier
     * conversations about what it names. The memory service reads names
     * from it by code; no model is asked.
     */
    readonly utterance?: string | undefined;
    /**
     * Step 9: their own earlier words in this conversation, newest first,
     * searched with the utterance so a follow-up still finds its topic.
     */
    readonly earlierWords?: readonly string[] | undefined;
    /**
     * Step 9: the run's Context Firewall plan. Recall searches the person's
     * own past turns only when it admits their own conversations, so
     * authorisation is resolved before that retrieval.
     */
    readonly plan?: PermittedContextPlan | undefined;
    readonly signal?: AbortSignal | undefined;
  }) => Promise<string | QMemoryRecalled>;
  /**
   * Supersede earlier conversations' summaries whose counts this run's
   * documents contradict, each with a new revision holding the counts put
   * right (append-only; the stale revision stays as history). Called
   * detached after the answer; a failure costs the correction, never the
   * answer. Absent: nothing is superseded.
   */
  readonly supersedeSummaries?: (input: {
    readonly actor: ActorContext;
    readonly runId: string;
    readonly corrections: readonly QSummaryCorrection[];
  }) => Promise<void>;
};

/**
 * One recalled summary of another conversation, its counts held to this
 * run's documents: `from` is the summary as recalled (so a summary that
 * moved on since is left alone), `summary` the same text with the
 * contradicted counts put right or their sentences left out, and
 * `grounds` the run's source lines that state the counts it now carries
 * (for the summary gate).
 */
export type QSummaryCorrection = {
  readonly conversationId: string;
  readonly from: string;
  readonly summary: string;
  readonly corrected: number;
  readonly dropped: number;
  readonly grounds: readonly string[];
};

/**
 * Recall as text, plus the person's OWN past words it found (step 9),
 * verbatim: a figure they told Q last week grounds "you said your cheque is
 * $750,000" in the claim check. Never Q's past words, which ground nothing.
 */
export type QMemoryRecalled = {
  readonly text: string;
  readonly ownWords: readonly string[];
  /** Recalled summaries of other conversations: Q's own words, an echo. */
  readonly earlierSummaries?:
    | readonly { readonly conversationId: string; readonly summary: string }[]
    | undefined;
  /**
   * HQ-7: what the person said that Q may call back to, already scoped to
   * them, this tenant and this run (q-knowledge callbacks.ts).
   */
  readonly callbacks?: readonly QMemoryCallbackCandidate[] | undefined;
};

/** A stated summary with nothing left once its contradicted counts go. */
const SUMMARY_COUNTS_WITHDRAWN =
  "Q's earlier summary of this conversation stated counts the document contradicts; they were withdrawn.";

/**
 * Recalled summaries of other conversations whose counts this run's
 * sources contradict, put right (claim-check `recheckCounts`). Only a
 * count a document row or table contradicts moves anything; a count no
 * row names is left as written.
 */
export function summaryCorrections(
  summaries: readonly {
    readonly conversationId: string;
    readonly summary: string;
  }[],
  sources: readonly string[],
  echoes: readonly string[],
  today: Date = new Date(),
): readonly QSummaryCorrection[] {
  if (summaries.length === 0) return [];
  // Each summary is an echo too: its own words never bind its counts.
  // Only a count a source row contradicts moves anything here: one only
  // the echoes name is left as written (echoOnlyWithheld off).
  const corpus = claimCorpus(
    sources,
    today,
    [...echoes, ...summaries.map((s) => s.summary)],
    { echoOnlyWithheld: false },
  );
  return summaries.flatMap((recalled) => {
    const checked = recheckCounts(recalled.summary, corpus);
    if (checked.corrected === 0 && checked.dropped === 0) return [];
    const summary =
      checked.text.length === 0 ? SUMMARY_COUNTS_WITHDRAWN : checked.text;
    const stated = statedNumbers(summary).flat();
    return [
      {
        conversationId: recalled.conversationId,
        from: recalled.summary,
        summary,
        corrected: checked.corrected,
        dropped: checked.dropped,
        grounds: sources
          .filter((source) => stated.some((n) => source.includes(n)))
          .slice(0, 20)
          .map((source) => source.slice(0, 4_000)),
      },
    ];
  });
}

/** The recall's text, whichever shape the port returned. */
export function recalledText(recalled: string | QMemoryRecalled): string {
  return typeof recalled === "string" ? recalled : recalled.text;
}

export const NOTHING_RECALLED: QMemoryRecalled = {
  text: NOTHING_REMEMBERED,
  ownWords: [],
};

/** Step 9: their own words earlier in this conversation, newest first. */
export function earlierWordsOf(
  earlier: readonly { readonly role: string; readonly content: string }[],
): readonly string[] {
  return earlier
    .filter((message) => message.role === "USER")
    .map((message) => message.content)
    .reverse()
    .slice(0, 2);
}

export type QUserStatementRecorder = {
  readonly record: (command: {
    readonly actor: ActorContext;
    readonly companyId: string;
    readonly runId: string;
    readonly userText: string;
    readonly statement: {
      readonly quote: string;
      readonly statement: string;
      readonly knowledgeKey: string;
      readonly validFrom: string | null;
    };
    readonly correlationId: CorrelationId;
  }) => Promise<{ readonly recorded: boolean }>;
};

export type ModelGatewayQAnswerDependencies = {
  readonly gateway: ModelGateway;
  readonly repositories: QRuntimeRepositories;
  readonly sql: DatabaseExecutor;
  readonly transactions: TransactionManager;
  /** Persists a person's own statements about their own company (CQ-Q-RESEARCH-001). */
  readonly statements?: QUserStatementRecorder | undefined;
  /**
   * Where a request to change the person's own profile is noted for the
   * action proposer (ADR 0011). Nothing is applied here: the reading is
   * kept for this run, the Approval Engine proposes it, the person
   * approves, the owning context writes.
   */
  readonly profileUpdates?: QProfileUpdateNotebook | undefined;
  /** J7: whether a quote asks to clear a field, read by meaning. */
  readonly clearCheck?: ClearCheck | undefined;
  /** Changing a document Q already prepared (ADR 0013). */
  readonly artifacts?: QArtifactReviser | undefined;
  /**
   * The owning records of what this conversation produced (documents,
   * action proposals), read back as the person, current status included
   * (CQ-QX-008). Absent: no receipts are claimed.
   */
  readonly receipts?: QReceiptPort | undefined;
  /** What Capital Q remembers about the person (ADR 0012). Absent: nothing is. */
  readonly memory?: QMemoryRecall | undefined;
  /**
   * Their own finished rehearsals and saved time zone, for the own-day
   * read (founder demo 2026-10-02). Their own records only, keyed by the
   * actor; absent: those lines are left out.
   */
  readonly ownDay?:
    | ((actor: ActorContext) => Promise<{
        readonly timeZone: string | null;
        readonly rehearsals: readonly OwnRehearsal[];
      }>)
    | undefined;
  /**
   * The person's own onboarding (CQ-QX-007): read only when the plan holds
   * the actor-wide OWN_ONBOARDING scope. Absent: not read.
   */
  readonly ownOnboarding?: QOwnOnboardingPort | undefined;
  /**
   * Setup reminders (founder directive 2026-09-27): asked under the same
   * OWN_ONBOARDING scope, only on a turn that is a natural pause. Absent:
   * Q never mentions an unfinished setup of its own accord.
   */
  readonly onboardingNudge?: QOnboardingNudgePort | undefined;
  /**
   * Where the answer goes as it is written. Absent means it goes out only
   * when it is finished, which is what happened before and is still what
   * happens for every caller that does not want it sooner.
   */
  readonly deltas?: QLiveDeltaBus | undefined;
  readonly registry?: PromptRegistry | undefined;
  /**
   * Reads this person already made under the same authority (read-cache.ts).
   * Absent: one per seam. A test passes its own to control the clock.
   */
  readonly readCache?: ReadCache | undefined;
  /**
   * RC3 (Q voice audit, 15 Nov 2026): this conversation's evidence (the
   * account digest and the wide reads), kept per tenant, actor,
   * conversation and access context, for a short follow-up to answer from
   * (conversation-evidence.ts). Absent: one per seam with no watermark.
   */
  readonly conversationEvidence?: ConversationEvidence | undefined;
  /**
   * Owner 2026-10-22: on typed turns a second call writes the findings and
   * cards while the first writes the answer (parallel-extras.ts). It reads
   * the whole context again, so input spend per turn roughly doubles.
   * Absent: one call writes both.
   */
  readonly parallelExtras?: boolean | undefined;
  readonly context?: QAuthorisedContextPort | undefined;
  /** The Tool Registry's port (CQ-Q-007). Absent: no tool is offered. */
  readonly tools?: QToolPort | undefined;
  /**
   * L-13: a credited picture when the analyst asks for one. Its search
   * words are composed from the person's own (egress allowlist) inside
   * the port. Absent: answers go without pictures.
   */
  readonly pictures?: QPicturePort | undefined;
  /**
   * Owner 2026-10-23: pictures of the company or person a turn names, from
   * public pages, found beside the turn's web search. Absent: none.
   */
  readonly publicPictures?: QPublicPicturePort | undefined;
  /**
   * A8 (owner 13 Nov 2026): the company's own picture and its playable
   * pitch, as the media context lets this reader see them, for an answer
   * the turn reader read as about a company (v86). Absent: none.
   */
  readonly companyMedia?: QCompanyMediaPort | undefined;
  /** How long an answer waits for the turn's web search (default 9 s). */
  readonly webLaneBudgetMs?: number | undefined;
  /**
   * RECOVERY-2026-10 (C's request): what came of Q's recent screen acts,
   * from the receipts the person's browser reported (C's `receiptFacts`:
   * code's words over control ids and closed statuses). Absent: none.
   */
  readonly uiActReceipts?:
    ((actor: QAnswerRequest["actor"]) => readonly string[]) | undefined;
  /**
   * The screen acts and moves that did not land since `sinceMs` (Q's
   * previous reply), oldest first: what the "didn't go through" line is
   * said from, once, on the turn after the miss. Absent: the receipts.
   */
  readonly screenMisses?:
    | ((
        actor: QAnswerRequest["actor"],
        sinceMs: number | null,
      ) => readonly string[])
    | undefined;
  /**
   * Owner 2026-11-06: reads public pages into the companies and founders
   * they name, for web discovery. Absent: one over this gateway.
   */
  readonly webDiscoveryReader?: WebDiscoveryReader | undefined;
  /**
   * K Part 4 (Tier A): their own mandate read, as `get_investor_mandate`
   * returned it, kept per actor under the context-cache scope and served
   * only while the mandate's version is current. Used only where this
   * run may read the mandate at all; a miss reads the tool, as before.
   */
  readonly ownMandateReads?:
    | {
        readonly get: (actor: QAnswerRequest["actor"]) => Promise<unknown>;
        readonly remember: (
          actor: QAnswerRequest["actor"],
          data: unknown,
        ) => Promise<void>;
      }
    | undefined;
  /**
   * K Part 4 (Tier A): a founder's own company, from their working
   * snapshot (their own organisation's canonical record, kept per actor
   * under the context-cache scope while its version is current). Used only
   * when this run's plan holds that company's profile scope.
   */
  readonly ownCompanySnapshot?:
    | ((actor: QAnswerRequest["actor"]) => Promise<{
        readonly companyId: string;
        readonly name: string;
        readonly shortDescription: string | null;
        readonly stageCode: string | null;
        readonly countryCode: string | null;
      } | null>)
    | undefined;
  /**
   * W1: what Q told them on arrival, prepared for the model so a follow-up
   * ("what's the request?") is answered from it with no tool read. Built
   * server-side for this actor only and kept while its sources are
   * unchanged (zero database round trips on a follow-up). Absent: none.
   */
  readonly arrivalSnapshot?:
    | ((actor: QAnswerRequest["actor"]) => Promise<ArrivalSnapshot | null>)
    | undefined;
  /**
   * W1: the semantic fallback for an arrival follow-up in words the quick
   * patterns do not know (TURN_SKIM's ARRIVAL_FOLLOWUP). Read-only; acts
   * only on a HIGH confidence reading of an item the snapshot holds.
   */
  readonly arrivalSkim?: QTurnSkimmer | undefined;
  /**
   * How long the answer waits, once it is otherwise ready, for the
   * arrival skim above (ARRIVAL_SKIM_GRACE_MS when absent).
   */
  readonly arrivalSkimGraceMs?: number | undefined;
  readonly sensitivity?: QAnswerSensitivityPolicy | undefined;
  /**
   * What KIND of material this composition handles (doc 15 §62). Omitted
   * means REAL_CUSTOMER. A composition sets SYNTHETIC_DEMO only where it
   * can vouch that every founder, investor and company it will ever see
   * was invented for a demonstration; the gateway then honours it only
   * against its own attestation, so setting it alone widens nothing.
   * Distinct from `sensitivity`, which stays truthful either way.
   */
  readonly dataPosture?: ModelDataPosture | undefined;
  readonly communication?: QCommunicationProfilePort | undefined;
  /**
   * The personality this person chose for Q (founder direction
   * 2026-09-30), as the words Q is told. Null: Q's own default.
   */
  readonly personalityOf?:
    | ((request: {
        readonly tenantId: string;
        readonly userId: string;
      }) => Promise<string | null>)
    | undefined;
  /**
   * Multilingual Q (2026-10-16): the language note for this person (their
   * choice in Settings), or null when they chose none. Read beside the
   * personality; a failed read is no note, never a failed answer.
   */
  readonly languageOf?:
    | ((request: {
        readonly tenantId: string;
        readonly userId: string;
      }) => Promise<string | null>)
    | undefined;
  /**
   * Multilingual Q, any language (owner directive 2026-10-16): the words
   * Q writes by code (attention, person search, fit, mandate, investors
   * who could fit...) in the person's chosen language, through the shared
   * translation layer with names and figures lifted out. Each entry is the
   * text in their language, or null to keep the English. Absent, or a
   * failure: the English stands.
   */
  readonly localiseWords?:
    | ((
        request: {
          readonly tenantId: string;
          readonly userId: string;
          readonly runId: string;
          /**
           * F-96: the turn's own words; with no language chosen, a script
           * that names its language (Arabic, Hebrew, …) is theirs.
           */
          readonly turn?: string | undefined;
        },
        texts: readonly string[],
      ) => Promise<readonly (string | null)[]>)
    | undefined;
  /**
   * ADR 0050: the business etiquette guides in force for this person (the
   * house guide and their own), rendered as fenced reference text that
   * shapes Q's manner with them and the drafts it writes for them. Null or
   * absent: none. A failure never stops the answer.
   */
  readonly etiquetteOf?:
    | ((request: {
        readonly tenantId: string;
        readonly userId: string;
      }) => Promise<EtiquetteGuides | null>)
    | undefined;
  /**
   * Who is asking, in their own record's words: their own company and its
   * site (founder live 2026-09-30: Q asked a founder whether "the Nixo
   * founded by Priya Khandelwal" was the company she meant, and for a
   * website it had). Trusted server text. Null: nothing known.
   */
  /**
   * Q intelligence step 1: who is asking (name, FOUNDER or INVESTOR from
   * their membership, organisation) and their saved zone, read by the
   * server for the actor. Absent: the situation says they are unknown.
   */
  readonly situationOf?: QSituationPort | undefined;
  /**
   * Owner 14 Nov 2026 (audit P0 #2): the person's account digest --
   * relationships and what is owed, approvals, calls, Q's work, requests,
   * GateQ, recent events -- read by code as them, once per turn, typed or
   * spoken, and told to the answer beside the situation. Absent: none.
   */
  readonly accountDigestOf?: QAccountDigestPort | undefined;
  /** The clock for the situation and the own-day read; tests fix it. */
  readonly now?: (() => Date) | undefined;
  readonly askerOf?:
    | ((request: {
        readonly tenantId: string;
        readonly userId: string;
        /**
         * Q has not answered in this conversation yet: the one turn where a
         * standing offer (make a deck) may be made (live 2026-10-02: it was
         * repeated on every turn).
         */
        readonly firstAnswer?: boolean | undefined;
      }) => Promise<string | null>)
    | undefined;
  /**
   * What exists on the person's own account, by kind (HARDEN, ADR 0040 with
   * QA's read registry): counts and a few titles, read for them each turn.
   * Absent: no index (Q still reads with its tools).
   */
  readonly ownIndex?:
    | ((request: {
        readonly actor: QAnswerRequest["actor"];
        readonly runId: string;
        readonly plan: QAnswerRequest["plan"];
      }) => Promise<QOwnIndex | null>)
    | undefined;
  /** Narrows provider eligibility for this composition; never widens it. */
  readonly tenantPolicy?: TenantModelPolicy | undefined;
  /**
   * W4: the page pane's move for a turn on the Q Workspace, started by the
   * answer's caller and settled here before the message is stored.
   */
  readonly pageMoves?: QPageMovePort | undefined;
  readonly logger?: Logger | undefined;
};

/** Safe operational record of one tool call, for dev tooling and tests. Never arguments or data. */
export type QToolCallObservation = {
  readonly toolName: string | null;
  readonly providerName: string;
  readonly status: QToolCallOutcome["status"];
  readonly failureCode: string | null;
  readonly latencyMs: number;
};

export type QAnswerObservation = {
  readonly result: CompanyAnalystV30Result;
  readonly providerCode: string;
  readonly modelCode: string;
  readonly promptBundleVersion: string;
  readonly routingPolicyCode: string;
  readonly latencyMs: number;
  readonly usage: {
    readonly inputTokens: number;
    readonly outputTokens: number;
  };
  readonly costUsd: number;
  readonly promptCharacters: number;
  /** Tools offered to the model for this run, by provider name. */
  readonly toolsOffered: readonly string[];
  readonly toolCalls: readonly QToolCallObservation[];
  /** Gateway executions made for this answer (1 when no tool was used). */
  readonly modelCalls: number;
};

export type ModelGatewayQAnswer = QAnswerPort & {
  /** Safe operational observation of the last answer, for dev tooling and tests. */
  readonly lastObservation: () => QAnswerObservation | undefined;
};
