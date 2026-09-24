import type {
  QNavigateDestination,
  QResponseMessage,
  QResultBlock,
  QVisibleStage,
} from "@capital-q/contracts";
import {
  INITIAL_CONVERSATION_STATE,
  NO_RESEARCH,
  noteAnswerFailure,
  readingFromTurnReader,
  reduceConversation,
  researchDirectiveFor,
  withoutRecommendationClaims,
  type ConversationState,
  type FailureOperation,
  type TurnTool,
} from "@capital-q/q-core";
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
  latestArtifactCardIn,
  prepareOrReviseArtifact,
  type ArtifactPreparation,
} from "./company/prepare-artifact.js";
import {
  analystResultBlocks,
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
    tool: TurnTool,
  ): Promise<QAnswerOutcome | null> {
    const company = request.subjects.find(
      (subject) => subject.kind === "COMPANY",
    );
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
    const read = await turns
      .read({
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
      })
      .catch(() => null);
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
    // A LOW reading is a guess, and a guess never moves anybody's screen or
    // prepares a change: it is answered like any other turn.
    const tool =
      read !== null && read.kind === "TOOL_REQUEST" && read.confidence !== "LOW"
        ? read.tool
        : null;
    if (tool !== null) {
      const acted = await actOnTool(request, conversationId, tool);
      if (acted !== null) {
        remember(
          conversationId,
          reduceConversation(state, { type: "SUCCEEDED", operation: "TOOL" }),
        );
        return acted;
      }
    }
    const outcome = await answerOnce({ ...request, research });
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
      subjects: request.subjects,
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
    const content = `${guarded.text}${acknowledgement}${documentNote}`
      .slice(0, ANSWER_LIMIT_CHARS)
      .trim();
    if (content.length === 0) {
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
      subjects: request.subjects,
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
