import {
  type QNavigateDestination,
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
  withoutRecommendationClaims,
  type ConversationState,
  type FailureOperation,
  type QuestionSequence,
  type TurnToolV14,
} from "@capital-q/q-core";
import {
  eligibleCapabilities,
  type GetInvestorMandateOutput,
  type QCapability,
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
} from "@capital-q/q-runtime";

import type {
  QSpecialist,
  QSpecialistProbe,
  QSpecialistTurnReading,
} from "./contracts.js";
import { actOnHandOver, type QHandOverPort } from "./hand-over.js";
import type { QOwnRecordsPort } from "./own-records-port.js";
import { decidePending, type PendingDecisionPort } from "./pending-decision.js";
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

/** The reader's input: the person's own latest words and own recent turns. */
function turnReaderInput(
  history: readonly QConversationMessage[],
  latest: QConversationMessage,
  actions: readonly { readonly name: string; readonly does: string }[],
  context: {
    readonly tenantId: string;
    readonly userId: string;
    readonly correlationId: string;
    readonly signal?: AbortSignal | undefined;
  },
) {
  // Spoken turns carry the recogniser's utterance; typed ones never do.
  // The reader needs to know which: only speech can be overheard.
  const spoken = latest.utteranceRef !== undefined;
  return {
    utterance: latest.content,
    actions,
    recentTurns: history
      .filter((m) => m.id !== latest.id)
      .slice(-6)
      .map((m) => ({
        role: m.role === "USER" ? ("USER" as const) : ("Q" as const),
        text: m.content,
      })),
    modality: spoken ? ("VOICE" as const) : ("TEXT" as const),
    attribution: {
      tenantId: context.tenantId,
      userId: context.userId,
      correlationId: context.correlationId,
    },
    signal: context.signal,
  };
}

const actionsKey = (
  actions: readonly { readonly name: string; readonly does: string }[],
): string =>
  JSON.stringify(actions.map((a) => ({ name: a.name, does: a.does })));

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
  INVESTORS: "Opening Investors.",
  SEARCH: "Opening Search.",
  GATEWAY: "Opening your gateway.",
  MEMORY: "Opening what I remember about you.",
  NEW_PITCH: "Opening a new pitch video.",
  REHEARSALS: "Opening Rehearsals.",
  DOCUMENTS: "Opening your documents.",
  DAILY: "Opening The Q Daily.",
  RESULTS: "Opening Results.",
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
  INVESTORS: "Investors",
  SEARCH: "Search",
  GATEWAY: "your gateway",
  MEMORY: "what Q remembers",
  NEW_PITCH: "a new pitch video",
  REHEARSALS: "Rehearsals",
  DOCUMENTS: "Documents",
  DAILY: "The Q Daily",
  RESULTS: "Results",
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
        DESTINATION_LINES[destination],
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

  /** Unclear turns in a row, per conversation (bounded with the rest). */
  const unclearInARow = new Map<string, number>();

  /**
   * A series of questions the person asked Q to put to them, per
   * conversation (R35). In memory and bounded like the rest of the core's
   * state: a restart forgets where a series was, never a fact.
   */
  const sequences = new Map<string, QuestionSequence>();
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
      const key = lastActions.get(conversationId);
      // A conversation's first turn has no known actions: read later.
      if (key === undefined) return null;
      const actions = JSON.parse(key) as { name: string; does: string }[];
      const reading = turns
        .read(
          turnReaderInput(history, latest, actions, {
            tenantId: input.tenantId,
            userId: input.actor.userId,
            correlationId: input.correlationId,
            signal: input.signal,
          }),
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

  const answerTurn = async (
    request: QAnswerRequest,
  ): Promise<QAnswerOutcome> => {
    // The conversational path's reads (conversation, context, tools, the
    // person's own facts) start now, beside the reading below; the answer
    // takes them up if the turn goes there (speed sweep 2026-10-01: the
    // reading's ~1 s and those reads' ~0.5-1 s ran one after the other).
    delegate.warm?.(request);
    const history = await repositories.messages.listRecentForConversationOfRun(
      sql,
      request.tenantId,
      request.runId,
      64,
    );
    const conversationId = history[0]?.conversationId;
    const latest = [...history].reverse().find((m) => m.role === "USER");
    if (
      turns === undefined ||
      conversationId === undefined ||
      latest === undefined
    ) {
      return answerOnce(request);
    }
    // A change waiting for their decision is decided first, by code, from
    // the reading of their words; never left to the answer's own tools.
    let afterAnswer: string | null = null;
    if (dependencies.pendingDecisions !== undefined) {
      const decided = await decidePending(dependencies.pendingDecisions, {
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
      }).catch((error: unknown) => {
        logger?.warn(
          { err: error, qRunId: request.runId },
          "a decision on a waiting change was not read; answering normally",
        );
        return { kind: "NONE" } as const;
      });
      if (decided.kind === "REPLY") {
        return recordAnswer(request, conversationId, decided.line);
      }
      if (decided.kind === "ANSWER_THEN") {
        if (decided.before !== null) {
          await recordAnswer(request, conversationId, decided.before);
        }
        afterAnswer = decided.after;
      }
    }
    const outcome = await answerTurnRead(
      request,
      history,
      conversationId,
      latest,
    );
    if (afterAnswer !== null && outcome.kind === "ANSWERED") {
      // What the change's real status is, after whatever the answer said
      // about it: from the engine, never from the model's words.
      await recordAnswer(request, conversationId, afterAnswer);
    }
    return outcome;
  };

  const answerTurnRead = async (
    request: QAnswerRequest,
    history: readonly QConversationMessage[],
    conversationId: QConversationMessage["conversationId"],
    latest: QConversationMessage,
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
    const capabilities = await capabilitiesOf(request);
    // R20/R33: every tool that changes something is an action to the
    // reader (a Prepare → Approve change, the app's own action in their
    // browser, a Save or Pass): "reload the page" is not a screen.
    const actions = capabilities.flatMap((capability) =>
      capability.performedBy.kind === "TOOL" && capability.acts
        ? [{ name: capability.performedBy.providerName, does: capability.does }]
        : [],
    );
    // Spoken turns carry the recogniser's utterance; typed ones never do.
    // The reader needs to know which: only speech can be overheard.
    const spoken = latest.utteranceRef !== undefined;
    const readTurn = () =>
      turns.read(
        turnReaderInput(history, latest, actions, {
          tenantId: request.tenantId,
          userId: request.actor.userId,
          correlationId: request.correlationId,
          signal: request.signal,
        }),
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
          research: (await research).mode,
          tool: read.tool?.kind ?? null,
        },
        "q turn read",
      );
    }
    // Spoken words plainly meant for someone else (a call, a colleague,
    // the room) are not a turn to Q: nothing is answered, nothing is
    // recorded as theirs, and Q keeps listening (founder live 2026-09-29:
    // answering the room made Q "talk to itself").
    if (spoken && read !== null && read.addressedToQ === false) {
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
      // Spoken, an unclear turn is almost always the room, not the
      // person: asking "say that again?" to background noise is Q talking
      // to itself. Typed, it is a real message worth one prompt.
      const reply = spoken
        ? ({ kind: "SILENT" } as const)
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
    if (tool !== null && !writingDocument) {
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
        read.handOver,
      ).catch((error: unknown) => {
        logger?.warn(
          { err: error, qRunId: request.runId },
          "a hand-over was not prepared; answering normally",
        );
        return { kind: "NONE" } as const;
      });
      if (handed.kind !== "NONE") {
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
    const ownRecords =
      !writingDocument && read?.question?.kind === "THEIR_OWN_RECORDS";
    const outcome = await answerOnce(
      {
        ...request,
        research,
        capabilities: manifestOf(capabilities),
        ...(turnUnread ? { turnUnread: true } : {}),
        ...(writingDocument ? { writingDocument: true } : {}),
        ...(series.step === null ? {} : { questionSequence: series.step }),
      },
      {
        ownRecords,
        reading:
          read === null
            ? null
            : {
                kind: read.kind,
                questionKind: read.question?.kind ?? null,
                aboutNamedOther: read.aboutNamedOther,
              },
      },
    );
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
      return delegate.answer(request);
    }
    const company = request.subjects.find(
      (subject) => subject.kind === "COMPANY",
    );
    if (company === undefined || company.kind !== "COMPANY") {
      return delegate.answer(request);
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
        : `\n\nNoted as your statement: ${result.recordedStatements
            .map((statement) => `\u201c${statement}\u201d`)
            .join(
              "; ",
            )}. Capital Q records it as what you told me, not as verified fact; say so if it needs correcting.`;
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
