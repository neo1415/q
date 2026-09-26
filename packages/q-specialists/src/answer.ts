import type {
  QNavigateDestination,
  QResponseMessage,
  QResultBlock,
  QVisibleStage,
} from "@capital-q/contracts";
import {
  INITIAL_CONVERSATION_STATE,
  isUnclearTurn,
  NO_RESEARCH,
  noteAnswerFailure,
  readingFromTurnReader,
  reduceConversation,
  researchDirectiveFor,
  unclearTurnReply,
  withoutRecommendationClaims,
  type ConversationState,
  type FailureOperation,
  type TurnToolV5,
} from "@capital-q/q-core";
import type { GetInvestorMandateOutput } from "@capital-q/q-tools";

import {
  composeOwnMandateDocument,
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
  type QConversationMessage,
  type QResearchDirective,
  type QRuntimeRepositories,
} from "@capital-q/q-runtime";

import type { QSpecialist, QSpecialistProbe } from "./contracts.js";
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
  /** Whether public research exists in this composition at all. */
  readonly researchAvailable?: boolean | undefined;
  /**
   * Where a turn read as "show / hide my company" is handed to the action
   * proposer (CQ-QACT-001). Absent: such a turn is answered like any other.
   */
  readonly visibility?: QVisibilityNotebook | undefined;
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
      }
    | undefined;
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
};

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
    // Asked for again: the one already made.
    const existing = existingDocumentCard({
      history,
      documentType: ask.documentType,
      subjectName: ask.subjectName,
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
    const record = request.subjects.find(
      (subject): subject is Extract<typeof subject, { kind: "COMPANY" }> =>
        subject.kind === "COMPANY",
    );
    if (ask.subjectName === null && record === undefined) {
      return { content: `Which company should the ${noun} be about?` };
    }
    if (
      ask.subjectName !== null &&
      !namedByPerson(ask.subjectName, personsWords)
    ) {
      // The reader named a company the person never did.
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
          // from, and what the findings are read against.
          question: personsWords,
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
        ask.subjectName === null ||
        (onRecord.companyName !== null &&
          onRecord.companyName !== undefined &&
          sameCompanyName(onRecord.companyName, ask.subjectName));
      if (theirs) {
        result = onRecord;
        subject = record;
      } else {
        result = await investigatePublic(ask.subjectName);
        subject = undefined;
      }
    } else {
      result = await investigatePublic(ask.subjectName ?? "");
      subject = undefined;
    }
    last = result;
    if (result.blocked === "CANCELLED") {
      return { content: `I stopped before the ${noun} was ready.` };
    }
    if (result.blocked !== null) {
      return { content: publicBlockedMessage(result.blocked) };
    }

    const name = result.companyName ?? ask.subjectName ?? "your company";
    const preparation = await prepareOrReviseArtifact({
      artifacts: artifacts as ArtifactPreparation,
      request,
      company: subject,
      companyName: name,
      saidVerbatim: said,
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
    conversationId: QConversationMessage["conversationId"],
    preparation: ArtifactPreparation,
  ): Promise<QAnswerOutcome> {
    const port = dependencies.ownMandate;
    const record = port === undefined ? null : await port.read(request);
    if (record === "NOT_AN_INVESTOR") {
      return recordAnswer(
        request,
        conversationId,
        "A mandate document is for an investor's own mandate, and there isn't one set up for you here.",
      );
    }
    const document = record === null ? null : composeOwnMandateDocument(record);
    if (document === null) {
      return recordAnswer(
        request,
        conversationId,
        "There's no mandate on your record yet, so there's nothing to put in a document. Set it up with me and I'll make it.",
      );
    }
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
      return recordAnswer(
        request,
        conversationId,
        document.draft
          ? "Here's your mandate as it stands. It's marked as a draft because it isn't confirmed yet. Download the PDF from the card."
          : "Here's your mandate. Download the PDF from the card.",
        [
          {
            kind: "ARTIFACT_REFERENCE",
            artifactId: summary.artifactId,
            type: summary.type,
            status: summary.status,
            title: summary.title,
          },
        ],
      );
    } catch (error: unknown) {
      if (request.signal?.aborted === true) throw error;
      logger?.warn(
        { err: error, qRunId: request.runId },
        "the mandate document could not be filed",
      );
      return recordAnswer(
        request,
        conversationId,
        "I couldn't prepare your mandate document just now. Ask me again in a moment and I'll make it.",
      );
    }
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
    tool: TurnToolV5,
    history: readonly QConversationMessage[],
  ): Promise<QAnswerOutcome | null> {
    const company = request.subjects.find(
      (subject) => subject.kind === "COMPANY",
    );
    if (
      tool.kind === "PREPARE_DOCUMENT" &&
      tool.documentType === "OWN_MANDATE"
    ) {
      if (artifacts === undefined || dependencies.ownMandate === undefined) {
        return null;
      }
      return prepareOwnMandate(request, conversationId, artifacts);
    }
    const companyDocument =
      tool.documentType === "PITCH_DECK" ||
      tool.documentType === "INVESTMENT_BRIEF"
        ? tool.documentType
        : null;
    if (tool.kind === "PREPARE_DOCUMENT" && companyDocument !== null) {
      if (artifacts === undefined) return null;
      const noun = companyDocument === "PITCH_DECK" ? "deck" : "brief";
      let done: Awaited<ReturnType<typeof prepareDocument>>;
      try {
        done = await prepareDocument(request, history, {
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
        return recordAnswer(
          request,
          conversationId,
          `I couldn't prepare the ${noun} just now. Ask me again in a moment and I'll make it.`,
        );
      }
      return recordAnswer(request, conversationId, done.content, done.blocks);
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
  /** Unclear turns in a row, per conversation (bounded with the rest). */
  const unclearInARow = new Map<string, number>();

  const answerTurn = async (
    request: QAnswerRequest,
  ): Promise<QAnswerOutcome> => {
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
    const readTurn = () =>
      turns.read({
        utterance: latest.content,
        recentTurns: history
          .filter((m) => m.id !== latest.id)
          .slice(-6)
          .map((m) => ({
            role: m.role === "USER" ? ("USER" as const) : ("Q" as const),
            text: m.content,
          })),
        modality: "TEXT",
        attribution: {
          tenantId: request.tenantId,
          userId: request.actor.userId,
          correlationId: request.correlationId,
        },
        signal: request.signal,
      });
    // A reading that failed is tried once more: the gateway has parked the
    // provider that failed, so the second try goes to the fallback model.
    // A request to make something must never be dropped because one model
    // was down (B1, 2026-09-25).
    let read = await readTurn().catch(() => null);
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
    // Words that could not be made out are a transcription matter, not a
    // question: no model is asked (it answered with a meta-statement).
    // One brief prompt; a second unclear turn in a row gets silence, so
    // the prompt is never repeated. A clear turn resets the count.
    if (read !== null && isUnclearTurn(read)) {
      const before = unclearInARow.get(conversationId) ?? 0;
      unclearInARow.set(conversationId, before + 1);
      const reply = unclearTurnReply(read, before);
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
    if (tool !== null) {
      const acted = await actOnTool(request, conversationId, tool, history);
      if (acted !== null) {
        remember(
          conversationId,
          reduceConversation(state, { type: "SUCCEEDED", operation: "TOOL" }),
        );
        return acted;
      }
    }
    const outcome = await answerOnce({
      ...request,
      research,
      ...(turnUnread ? { turnUnread: true } : {}),
    });
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
    };
    if (!specialist.supports(probe)) {
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
    failureNotice: (runId: string) => {
      const notice = notices.get(runId);
      notices.delete(runId);
      return notice;
    },
  };
}
