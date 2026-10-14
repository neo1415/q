import type {
  GatewayPolicy,
  PublicGateway,
  QualificationResult,
} from "@capital-q/gateq";
import {
  isModelGatewayError,
  type ModelGateway,
} from "@capital-q/model-gateway";
import type { Logger } from "@capital-q/observability";
import {
  createDefaultPromptRegistry,
  DEFAULT_COMMUNICATION_PROFILE,
  personalityOf,
  renderPrompt,
  GateQInterviewerResultSchema,
  type GateQInterviewerResult,
  type GateQInterviewerVariables,
  type GateQTurnIntent,
  type PromptRegistry,
  type QPersonalityCode,
} from "@capital-q/q-core";

import {
  APPLICATION_DIMENSIONS,
  NewApplicationFactSchema,
  type ApplicationDimension,
  type ApplicationFact,
  type FactValue,
  type NewApplicationFact,
} from "../contracts/index.js";
import {
  contradictionsIn,
  questionNeedsFor,
  type QuestionNeed,
} from "./question-needs.js";

/**
 * Q interviewing a GateQ applicant (CQ-GATE-002 §4, §5, §36, §39).
 *
 * One brain, one turn, either modality. A typed message and a voice
 * transcript enter here identically and differ only in the `channel` the
 * prompt is told about, because maintaining a scripted text interview
 * beside a smart spoken one is maintaining two products that will disagree
 * with each other.
 *
 * The model writes what Q says and proposes a reading of what the person
 * said. Everything after that is deterministic:
 *
 *   - Every proposed fact is parsed against the closed intake contract. A
 *     dimension nobody defined, a value of the wrong shape, a provenance
 *     that is not one of the four: dropped, with a count logged. Invalid
 *     model output never becomes database state.
 *   - Nothing the model says about qualification is read at all. There is
 *     no field for it in the result schema, and the caller gets GATE-001's
 *     answer instead.
 *   - Small talk and off-topic turns record nothing, by construction: a
 *     turn whose intent is SMALL_TALK has its facts discarded, so a joke
 *     cannot become an application answer however the model read it.
 *
 * What the model receives is equally deliberate. It gets the gateway as
 * the world may see it, what the application already holds, and what is
 * worth asking about — never a private threshold, never another
 * application, never an unpublished draft. A model that never receives a
 * secret cannot be talked into revealing one.
 */

export type InterviewChannel = "voice" | "text";

/**
 * One live turn's budget. A public endpoint is somebody else's spending
 * limit if it does not have one (§43), and a turn that takes 45 seconds
 * has already lost the conversation.
 */
const DIALOGUE_BUDGET = {
  maxAttempts: 3,
  maxEstimatedCostUsd: 0.05,
  maxOutputTokens: 1_024,
  attemptTimeoutMs: 30_000,
} as const;

export type InterviewTurnInput = {
  /** PUBLIC before an application exists; APPLICATION once it does. */
  readonly stage: "PUBLIC" | "APPLICATION";
  readonly channel: InterviewChannel;
  /** What the world may see of this gateway. Never the private policy. */
  readonly publicGateway: PublicGateway;
  /** Absent in PUBLIC stage. */
  readonly application?:
    | {
        readonly policy: GatewayPolicy;
        readonly qualification: QualificationResult;
        readonly facts: readonly ApplicationFact[];
        /** Current extracted evidence authorised for THIS application only.
         * Supplied by the Evidence boundary, never accepted from a browser.
         * Excerpts are untrusted data and do not become recorded facts.
         */
        readonly documentEvidence?:
          | readonly {
              readonly documentId: string;
              readonly title: string;
              readonly documentVersionId: string;
              readonly extractionVersionId: string;
              readonly excerpt: string;
              readonly page?: number | undefined;
              readonly section?: string | undefined;
              readonly evidenceStatus: "DOCUMENT_SUPPORTED";
            }[]
          | undefined;
        /** Values a document proposed, awaiting confirmation. */
        readonly documentProposals: readonly {
          readonly dimension: ApplicationDimension;
          readonly summary: string;
          /** Optional authenticated Evidence binding, not a model assertion. */
          readonly documentId?: string | undefined;
          readonly documentVersionId?: string | undefined;
          readonly extractionVersionId?: string | undefined;
          readonly value?: FactValue | undefined;
        }[];
      }
    | undefined;
  /** What the person just said. Empty for the opening line. */
  readonly utterance: string;
  readonly recentTurns: readonly {
    readonly role: "person" | "q";
    readonly text: string;
  }[];
  /** Consecutive turns that were not about the application. */
  readonly tangents: number;
  /** Dimensions Q has already asked about this session. */
  readonly askedAlready: readonly ApplicationDimension[];
  /** Who the work is attributed to. A guest carries no user. */
  readonly attribution: {
    readonly tenantId: string;
    readonly correlationId: string;
  };
  readonly signal?: AbortSignal | undefined;
};

export type InterviewTurnOutcome = {
  readonly reply: string;
  readonly intent: GateQTurnIntent;
  /** Facts that survived validation. The caller records them. */
  readonly facts: readonly NewApplicationFact[];
  /** Proposals the model made that did not survive. Diagnostics only. */
  readonly rejectedFacts: number;
  /** Server-owned source bindings aligned to the accepted facts array.
   * Other accepted facts bind to the canonical PERSON turn at persistence.
   */
  readonly factSources?:
    | readonly {
        readonly factIndex: number;
        readonly documentId: string;
        readonly documentVersionId: string;
        readonly extractionId: string;
        readonly page?: number | undefined;
        readonly section?: string | undefined;
      }[]
    | undefined;
  readonly asking: ApplicationDimension | null;
  readonly questionForQ: string | null;
  /** Advisory. GATE-001 decides whether submission is possible. */
  readonly readyToReview: boolean;
};

/**
 * What the applicant gets when the model is unavailable (§38).
 *
 * Not a fabricated interview turn and not a provider error. The
 * application is untouched, the deterministic answer is still computable
 * from what is already known, and the person is told plainly that Q could
 * not answer right now.
 */
export class InterviewUnavailableError extends Error {
  readonly retryable: boolean;
  constructor(retryable: boolean) {
    super("Q could not answer just now.");
    this.name = "InterviewUnavailableError";
    this.retryable = retryable;
  }
}

export type InterviewerDependencies = {
  readonly gateway: Pick<ModelGateway, "execute">;
  readonly registry?: PromptRegistry | undefined;
  readonly personality?: QPersonalityCode | undefined;
  readonly logger?: Logger | undefined;
};

export type GateQInterviewer = {
  readonly turn: (input: InterviewTurnInput) => Promise<InterviewTurnOutcome>;
};

const DIMENSIONS = new Set<string>(APPLICATION_DIMENSIONS);

/** Bounded, readable, and stripped of anything that is not the point. */
function renderFacts(facts: readonly ApplicationFact[]): string {
  const current = facts.filter((fact) => fact.supersededAt === null);
  if (current.length === 0) return "(nothing yet)";
  const displayed = current.slice(-24);
  const overhead = displayed.reduce(
    (total, fact) =>
      total +
      fact.dimension.length +
      fact.provenance.length +
      fact.id.length +
      15,
    0,
  );
  const valueLimit = Math.min(
    2000,
    Math.floor((7900 - overhead) / displayed.length),
  );
  const lines = displayed
    .map((fact) => {
      const value =
        fact.value.kind === "TEXT"
          ? fact.value.text
          : fact.value.kind === "CODE"
            ? fact.value.code
            : fact.value.kind === "AMOUNT"
              ? `${fact.value.amount} ${fact.value.currency}`
              : fact.value.kind === "PHRASES"
                ? fact.value.phrases.join(", ")
                : fact.value.declined === true
                  ? "(they preferred not to say)"
                  : "(they do not know)";
      return `${fact.dimension}: ${excerpt(value, valueLimit)} [${fact.provenance}; fact ${fact.id}]`;
    })
    .join("\n");
  return current.length > displayed.length
    ? `${lines}\n(${current.length - displayed.length} earlier records omitted; current topics shown as excerpts)`
    : lines;
}

/** Explicitly labelled excerpts keep legitimate long records within the
 * existing prompt schema. No model call or extra retrieval is needed. */
function excerpt(value: string, limit: number): string {
  return value.length <= limit
    ? value
    : `${value.slice(0, limit - 12)} [excerpt]`;
}

function renderHistory(turns: InterviewTurnInput["recentTurns"]): string {
  if (turns.length === 0) return "(this is the first thing said)";
  return turns
    .slice(-8)
    .map(
      (turn) =>
        `${turn.role}: ${excerpt(turn.text, Math.min(4000, Math.floor(7900 / Math.min(8, turns.length)) - 10))}`,
    )
    .join("\n");
}

function renderDocuments(
  application: InterviewTurnInput["application"],
): string {
  if (application === undefined) return "(none)";
  const proposals = application.documentProposals
    .slice(0, 8)
    .map(
      (proposal) =>
        `${proposal.dimension}: ${excerpt(proposal.summary, 120)} [unconfirmed proposal]`,
    );
  const sources = (application.documentEvidence ?? [])
    .slice(0, 6)
    .map(
      (source) =>
        `[document ${excerpt(source.documentId, 40)}; version ${excerpt(source.documentVersionId, 40)}; extraction ${excerpt(source.extractionVersionId, 40)}${source.page === undefined ? "" : `; page ${source.page}`}${source.section === undefined ? "" : `; section ${excerpt(source.section, 40)}`}; DOCUMENT_SUPPORTED] ${excerpt(source.title, 60)}: ${excerpt(source.excerpt, 100)}`,
    );
  return excerpt([...proposals, ...sources].join("\n"), 4000) || "(none)";
}

function renderNeeds(needs: readonly QuestionNeed[]): string {
  if (needs.length === 0) return "(nothing pressing)";
  // The dimension and why it matters, never the rule behind it (§28).
  return needs
    .map((need) => `${need.dimension} (${need.reason.toLowerCase()})`)
    .join("\n");
}

function renderPublicGateway(gateway: PublicGateway): string {
  const criteria =
    gateway.criteria.length === 0
      ? "(none published)"
      : gateway.criteria
          .map((c) => `${c.label} (${c.requiredness.toLowerCase()})`)
          .join("; ");
  return [
    `${gateway.organisationDisplayName} — ${gateway.title}`,
    gateway.description ?? "",
    `inbound: ${gateway.inboundMode}`,
    `accepting applications: ${gateway.acceptingApplications ? "yes" : "no"}`,
    `what they ask about: ${criteria}`,
  ]
    .filter((line) => line.length > 0)
    .join("\n");
}

export function createGateQInterviewer(
  dependencies: InterviewerDependencies,
): GateQInterviewer {
  const { gateway, logger } = dependencies;
  const registry = dependencies.registry ?? createDefaultPromptRegistry();
  const personality = personalityOf(dependencies.personality ?? "UPBEAT");

  /**
   * What was actually put in front of Q for this turn (CQ-GATE-002S §9).
   *
   * Derived from the input rather than declared beside it, so it cannot
   * drift from what was really supplied: if the list says a deck was
   * provided, a deck was provided. A live model claimed to have read an
   * application on a turn where none had been supplied, and a prompt rule
   * alone could not have stopped it — the model had no way to tell what
   * it was handed from what it was not.
   */
  const contextAvailableFor = (input: InterviewTurnInput): string => {
    const application = input.application;
    const lines = [
      "the gateway's public description: yes",
      `this conversation so far: ${input.recentTurns.length === 0 ? "nothing before this turn" : "yes"}`,
      `the application's own record: ${application === undefined ? "no" : "yes"}`,
      `what they have told us, by topic: ${
        application === undefined || application.facts.length === 0
          ? "nothing yet"
          : `${application.facts.filter((f) => f.supersededAt === null).length} items`
      }`,
      `documents of theirs that were read for you: ${
        application === undefined
          ? "none"
          : `${Math.min(8, application.documentProposals.length)} unconfirmed values; ${Math.min(6, application.documentEvidence?.length ?? 0)} authorised extracted excerpts (not the full documents)`
      }`,
      "anything from the public web: no",
    ];
    return lines.join("\n");
  };

  return {
    turn: async (input) => {
      const startedAt = performance.now();
      const application = input.application;
      const needs =
        application === undefined
          ? []
          : questionNeedsFor({
              policy: application.policy,
              qualification: application.qualification,
              facts: application.facts,
            });

      // The renderer supplies the charter-level four; this is the rest.
      const variables: Omit<
        GateQInterviewerVariables,
        | "operatingMode"
        | "communicationProfile"
        | "communicationGuidance"
        | "environmentNotes"
      > = {
        personality: personality.manner,
        channel: input.channel,
        stage: input.stage,
        publicGateway: excerpt(renderPublicGateway(input.publicGateway), 4000),
        knownFacts:
          application === undefined
            ? "(no application yet)"
            : renderFacts(application.facts),
        questionNeeds: renderNeeds(needs),
        documentProposals: renderDocuments(application),
        contradictions:
          application === undefined
            ? "(none)"
            : excerpt(contradictionsIn(application.facts).join("\n"), 2000) ||
              "(none)",
        askedAlready:
          input.askedAlready.length === 0
            ? "(nothing yet)"
            : input.askedAlready.join(", "),
        recentTurns: renderHistory(input.recentTurns),
        utterance: input.utterance.slice(0, 4000),
        tangents: Math.min(99, Math.max(0, input.tangents)),
        contextAvailable: contextAvailableFor(input),
      };
      const rendered = renderPrompt(registry, {
        task: "GATEQ_INTERVIEWER",
        // The voice charter: sized for a live turn either way, because a
        // typed applicant is waiting on the same latency a spoken one is.
        charter: "Q_SYSTEM_VOICE",
        operatingMode: "ASSESSMENT",
        communicationProfile: DEFAULT_COMMUNICATION_PROFILE,
        environmentNotes:
          "You cannot record, decide or send anything yourself; Capital Q validates what you read and its own rules decide whether an application qualifies.",
        variables,
      });

      let result: GateQInterviewerResult;
      try {
        const response = await gateway.execute<GateQInterviewerResult>(
          {
            taskClass: "NORMAL_DIALOGUE",
            // A stranger's application is their own commercial material,
            // whoever they turn out to be.
            sensitivity: "CONFIDENTIAL",
            budget: DIALOGUE_BUDGET,
            messages: [...rendered.messages],
            output: rendered.output,
            attribution: { ...input.attribution, purpose: "ONBOARDING" },
          },
          {
            schema: GateQInterviewerResultSchema,
            ...(input.signal === undefined ? {} : { signal: input.signal }),
          },
        );
        if (response.output.kind !== "STRUCTURED") {
          throw new InterviewUnavailableError(true);
        }
        result = GateQInterviewerResultSchema.parse(
          (response.output as { readonly value: unknown }).value,
        );
        logger?.info(
          {
            correlationId: input.attribution.correlationId,
            stage: input.stage,
            channel: input.channel,
            promptVersion: rendered.bundle.task,
            promptCharacters: rendered.characters,
            gatewayCalls: 1,
            providerAttempts: response.attempts?.length,
            inputTokens: response.usage?.inputTokens,
            cachedInputTokens: response.usage?.cachedInputTokens,
            outputTokens: response.usage?.outputTokens,
            gatewayLatencyMs: response.latencyMs,
            interviewerDurationMs: Math.round(performance.now() - startedAt),
          },
          "gateq interview performance",
        );
      } catch (error: unknown) {
        // A provider failure is not something the applicant needs the
        // detail of, and it must never become an invented answer.
        logger?.warn(
          { correlationId: input.attribution.correlationId, err: error },
          "gateq interview turn unavailable",
        );
        if (error instanceof InterviewUnavailableError) throw error;
        throw new InterviewUnavailableError(
          isModelGatewayError(error) && error.failureClass !== "CANCELLED",
        );
      }

      // A turn that was not about the application records nothing. Doing
      // this by intent rather than by asking the model to be careful means
      // a joke cannot become an answer even if the model read one into it.
      const conversational: readonly GateQTurnIntent[] = [
        "SMALL_TALK",
        "OFF_TOPIC",
        "SABOTAGE",
        "QUESTION_FOR_Q",
      ];
      const discardedByIntent = conversational.includes(result.intent);
      const proposed = discardedByIntent ? [] : result.facts;

      const facts: NewApplicationFact[] = [];
      const factSources: NonNullable<
        InterviewTurnOutcome["factSources"]
      >[number][] = [];
      // Counted, not silently dropped. A model that proposes a country
      // while the applicant is making a joke -- or while they are trying
      // to talk Q into something -- is the signal worth seeing in a log,
      // and a diagnostic that reports zero there is a diagnostic lying.
      let rejected = discardedByIntent ? result.facts.length : 0;
      for (const candidate of proposed) {
        if (!DIMENSIONS.has(candidate.dimension)) {
          rejected += 1;
          continue;
        }
        const parsed = NewApplicationFactSchema.safeParse({
          dimension: candidate.dimension,
          value: candidate.value,
          provenance: candidate.provenance,
        });
        if (!parsed.success) {
          rejected += 1;
          continue;
        }
        const proposedFact = parsed.data;
        if (proposedFact.provenance === "DOCUMENT_SUPPORTED") {
          const proposal = application?.documentProposals.find(
            (candidate) =>
              candidate.dimension === proposedFact.dimension &&
              candidate.value !== undefined &&
              candidate.documentId !== undefined &&
              candidate.documentVersionId !== undefined &&
              candidate.extractionVersionId !== undefined &&
              JSON.stringify(candidate.value) ===
                JSON.stringify(proposedFact.value),
          );
          const source =
            proposal === undefined
              ? undefined
              : application?.documentEvidence?.find(
                  (document) =>
                    document.documentId === proposal.documentId &&
                    document.documentVersionId === proposal.documentVersionId &&
                    document.extractionVersionId ===
                      proposal.extractionVersionId &&
                    document.evidenceStatus === "DOCUMENT_SUPPORTED",
                );
          if (source === undefined) {
            // A missing source binding is not an applicant claim: the model
            // may have invented this value while interpreting a document.
            // Summary-only legacy proposals cannot prove document lineage.
            rejected += 1;
            logger?.debug(
              {
                correlationId: input.attribution.correlationId,
                dimension: proposedFact.dimension,
              },
              "gateq unsupported document provenance rejected",
            );
            continue;
          }
          factSources.push({
            factIndex: facts.length,
            documentId: source.documentId,
            documentVersionId: source.documentVersionId,
            extractionId: source.extractionVersionId,
            ...(source.page === undefined ? {} : { page: source.page }),
            ...(source.section === undefined
              ? {}
              : { section: source.section }),
          });
        }
        facts.push(proposedFact);
      }

      const asking =
        result.asking !== null && DIMENSIONS.has(result.asking)
          ? (result.asking as ApplicationDimension)
          : null;

      logger?.debug(
        {
          correlationId: input.attribution.correlationId,
          stage: input.stage,
          intent: result.intent,
          facts: facts.length,
          rejected,
        },
        "gateq interview turn",
      );

      return {
        reply: result.reply,
        intent: result.intent,
        facts,
        rejectedFacts: rejected,
        factSources,
        asking,
        questionForQ: result.questionForQ,
        // Advisory only. Whether the application may actually be submitted
        // is GATE-001's answer, and whether it is submitted is a person's.
        readyToReview: result.readyToReview,
      };
    },
  };
}
