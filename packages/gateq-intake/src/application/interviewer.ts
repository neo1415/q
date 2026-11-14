import { z } from "zod";
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
  isEnglish,
  languageInfo,
  supportedLanguageOf,
  writtenLanguageNote,
  GATEQ_STATEMENT_QUANTITIES,
  GateQInterviewerResultV2Schema,
  GateQTurnIntentSchema,
  orEmptyCase,
  PROMPT_EMPTY_CASES,
  type GateQInterviewerResultV2,
  type GateQInterviewerVariables,
  type GateQStatementOp,
  type GateQTurnIntent,
  type PromptRegistry,
  type QPersonalityCode,
} from "@capital-q/q-core";

import {
  APPLICATION_DIMENSIONS,
  ApplicationFactProposalShapeSchema,
  ApplicationDimensionSchema,
  NewApplicationFactSchema,
  type ApplicationDimension,
  type ApplicationFact,
  type NewApplicationFact,
} from "../contracts/index.js";
import {
  contradictionsForInterview,
  figureContradictions,
  questionNeedsFor,
  type QuestionNeed,
} from "./question-needs.js";
import { questionAngle } from "./answer-specificity.js";
import { regionIn } from "./cities.js";
import {
  ACCUMULATING_DIMENSIONS,
  addedStatement,
  correctedStatement,
  holdsWords,
  asStatement,
} from "./fact-history.js";
import { normaliseProposedFact } from "./normalise-fact.js";
import { readBackLine, readBacksIn, type NotRecorded } from "./not-recorded.js";
import { affirmsReadBack, amountStatedIn } from "./stated-amount.js";
import {
  asksSince,
  handlesFor,
  legacyCarry,
  planReading,
  renderDisagreements,
  renderKnownStatements,
  replyHeldToReading,
  StatementPlanSchema,
  type AskLog,
  type StatementContext,
  type StatementPlan,
} from "./statement-plan.js";
import { projectView } from "./statement-view.js";
import type { ApplicationId } from "../contracts/index.js";

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
 *     that is not one of the four: dropped, with a count logged. A value
 *     the person stated in another shape ("Nigeria", "Series A", "$2m") is
 *     put into its dimension's canonical shape and saved; one that holds
 *     nothing of that shape never becomes database state.
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

/** A legacy fact proposal as NEW statement(s), linked to nothing. */
function statementsOfFact(
  fact: GateQInterviewerResultV2["facts"][number],
  utterance: string,
): GateQStatementOp[] {
  const words = (text: string) =>
    (text.trim().length > 0 ? text : utterance).slice(0, 600) || "(said)";
  const base = {
    op: "NEW" as const,
    target: null,
    turn: null,
    dimension: fact.dimension,
    quantity: null,
    asOf: null,
    provenance: fact.provenance,
  };
  const value = fact.value;
  switch (value.kind) {
    case "TEXT":
      return [{ ...base, value, words: words(value.text) }];
    case "CODE":
      return [{ ...base, value, words: words(utterance) }];
    case "AMOUNT":
      return [
        {
          ...base,
          value: {
            kind: "MONEY",
            amount: value.amount,
            currency: value.currency,
          },
          words: words(utterance),
        },
      ];
    case "PHRASES":
      return value.phrases.map((phrase) => ({
        ...base,
        value: { kind: "TEXT" as const, text: phrase.slice(0, 2000) },
        words: words(phrase),
      }));
    case "NONE":
      return [
        {
          ...base,
          value: { kind: "UNKNOWN", declined: false },
          provenance: "UNKNOWN",
          words: words(utterance),
        },
      ];
    case "ZERO":
      return [{ ...base, value: { kind: "ZERO" }, words: words(utterance) }];
  }
}

/**
 * The reply around a read-back: without its closing question (the read-back
 * is the question now) and without any sentence already stating a figure
 * being read back, so Q says it once.
 */
function aroundReadBack(reply: string, amounts: readonly string[]): string {
  const trimmed = reply.trim();
  const sentences = trimmed.match(/[^.!?]+[.!?]*/gu) ?? [trimmed];
  const kept = sentences.filter(
    (sentence, index) =>
      !(index === sentences.length - 1 && sentence.trim().endsWith("?")) &&
      !amounts.some((amount) => amountStatedIn(amount, sentence)),
  );
  return kept.join("").trim();
}

/**
 * A contact detail already held: the same address in any case, or a name
 * whose every word is already in the name on record ("Laura" for "Laura
 * Mensah"). A different one is a change, recorded with history kept.
 */
function sameContact(
  proposed: NewApplicationFact,
  onRecord: ApplicationFact | undefined,
): boolean {
  if (
    onRecord === undefined ||
    proposed.value.kind !== "TEXT" ||
    onRecord.value.kind !== "TEXT"
  ) {
    return false;
  }
  const words = (text: string) =>
    text
      .toLowerCase()
      .split(/[^\p{L}\p{N}@._+-]+/u)
      .filter((word) => word.length > 0);
  if (proposed.dimension === "contact.email") {
    return (
      proposed.value.text.trim().toLowerCase() ===
      onRecord.value.text.trim().toLowerCase()
    );
  }
  if (proposed.dimension === "contact.name") {
    const held = new Set(words(onRecord.value.text));
    const said = words(proposed.value.text);
    return said.length > 0 && said.every((word) => held.has(word));
  }
  return false;
}

/**
 * One live turn's budget. A public endpoint is somebody else's spending
 * limit if it does not have one (§43), and a turn that takes 45 seconds
 * has already lost the conversation.
 */
const DIALOGUE_BUDGET = {
  maxAttempts: 3,
  maxEstimatedCostUsd: 0.05,
  maxOutputTokens: 1_024,
  // Onboarding speed 2026-10-20: three 30 s attempts let one turn hold an
  // applicant for a minute and a half. A stalled model now gives way.
  attemptTimeoutMs: 15_000,
} as const;
/**
 * The first model's patience while another can take the turn: a healthy
 * turn writes its reply well inside this, and a stalled one hands over
 * instead of using the whole attempt (the onboarding interview's rule).
 */
const FIRST_ATTEMPT_MS = 8_000;

export type InterviewTurnInput = {
  /** PUBLIC before an application exists; APPLICATION once it does. */
  readonly stage: "PUBLIC" | "APPLICATION";
  readonly channel: InterviewChannel;
  /**
   * Lane ml: the applicant's language (BCP 47) when known, e.g. from the
   * video room they opened. Absent: the language of what they wrote.
   */
  readonly locale?: string | undefined;
  /** What the world may see of this gateway. Never the private policy. */
  readonly publicGateway: PublicGateway;
  /** Absent in PUBLIC stage. */
  readonly application?:
    | {
        readonly policy: GatewayPolicy;
        readonly qualification: QualificationResult;
        readonly facts: readonly ApplicationFact[];
        /** Values a document proposed, awaiting confirmation. */
        readonly documentProposals: readonly {
          readonly dimension: ApplicationDimension;
          readonly summary: string;
        }[];
        /**
         * Atomic statements (design 2026-11-14, slice 2). Present, with
         * prompt v7 or later, the turn is read into statements against
         * this record; absent, it is read into legacy facts as before.
         */
        readonly statements?: StatementTurnContext | undefined;
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
  /** How many Q turns asked about each dimension; parks a repeated one. */
  readonly askedCounts?: ReadonlyMap<ApplicationDimension, number> | undefined;
  /** Dimensions the investor's mandate emphasises (never its values). */
  readonly emphasis?: readonly ApplicationDimension[] | undefined;
  /**
   * Stable per application (its id): picks which of several wordings is
   * suggested for a figure, so founders are not all read one script.
   * Absent: the application id on its facts, else a fixed default.
   */
  readonly variationSeed?: string | undefined;
  /** Who the work is attributed to. A guest carries no user. */
  readonly attribution: {
    readonly tenantId: string;
    readonly correlationId: string;
  };
  readonly signal?: AbortSignal | undefined;
};

/** What the statement reading of a turn is given besides the model's output. */
export type StatementTurnContext = {
  readonly applicationId: ApplicationId;
  readonly context: StatementContext;
  /** The PERSON turn being answered; null where there is no transcript. */
  readonly currentTurnId: string | null;
  /** The PERSON turn was already read (recovered by a later turn). */
  readonly currentRead?: boolean | undefined;
  /** Earlier PERSON turns nobody read (live D8), oldest first. */
  readonly unread: readonly { readonly id: string; readonly text: string }[];
  /** Every Q question about a dimension, by the seq of the Q turn. */
  readonly asks: AskLog["asks"];
  /** `application_turns.id` -> seq, for when a statement was said. */
  readonly turnSeq: ReadonlyMap<string, number>;
};

export type InterviewTurnOutcome = {
  readonly reply: string;
  readonly intent: GateQTurnIntent;
  /** Facts that survived validation. The caller records them. */
  readonly facts: readonly NewApplicationFact[];
  /** Proposals the model made that did not survive. Diagnostics only. */
  readonly rejectedFacts: number;
  /**
   * What the applicant said that was read but not kept, and why (G4). The
   * reply already says so in English; other languages see it in coverage.
   */
  readonly notRecorded?: readonly NotRecorded[] | undefined;
  readonly asking: ApplicationDimension | null;
  readonly questionForQ: string | null;
  /** Advisory. GATE-001 decides whether submission is possible. */
  readonly readyToReview: boolean;
  /**
   * Every statement row this turn writes, with its ids, checkpointed with
   * the reply so a retry writes the same rows (slice 2). Absent on the
   * legacy path.
   */
  readonly statementPlan?: StatementPlan | undefined;
};

/** Persisted output is revalidated before replay, never treated as authority. */
export const InterviewTurnOutcomeSchema = z
  .object({
    reply: z.string().min(1).max(4000),
    intent: GateQTurnIntentSchema,
    facts: z.array(ApplicationFactProposalShapeSchema).max(40),
    rejectedFacts: z.number().int().nonnegative(),
    asking: ApplicationDimensionSchema.nullable(),
    questionForQ: z.string().nullable(),
    readyToReview: z.boolean(),
    statementPlan: StatementPlanSchema.optional(),
  })
  .transform((outcome) => {
    // Reuse the paid reply from an older checkpoint without reinstating a
    // proposal whose shape would erase a usable qualification value.
    const facts: NewApplicationFact[] = [];
    let rejected = 0;
    for (const fact of outcome.facts) {
      const parsed = NewApplicationFactSchema.safeParse(fact);
      if (parsed.success) facts.push(parsed.data);
      else rejected += 1;
    }
    return {
      ...outcome,
      facts,
      rejectedFacts: outcome.rejectedFacts + rejected,
    };
  });

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
  /** When statements are said; a test seam. */
  readonly now?: (() => Date) | undefined;
};

export type GateQInterviewer = {
  readonly turn: (input: InterviewTurnInput) => Promise<InterviewTurnOutcome>;
};

const DIMENSIONS = new Set<string>(APPLICATION_DIMENSIONS);

/** Bounded, readable, and stripped of anything that is not the point. */
function renderFacts(facts: readonly ApplicationFact[]): string {
  const current = facts.filter((fact) => fact.supersededAt === null);
  if (current.length === 0) return "(nothing yet)";
  return current
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
      return `${fact.dimension}: ${value} [${fact.provenance}]`;
    })
    .join("\n");
}

/** The prompt variable's own bound (GateQInterviewerVariablesSchema). */
const NEEDS_MAX_CHARS = 2000;

function renderNeeds(
  needs: readonly QuestionNeed[],
  seed: string,
  askedCounts: ReadonlyMap<ApplicationDimension, number> | undefined,
): string {
  if (needs.length === 0) return "(nothing pressing)";
  // The dimension and why it matters, never the rule behind it (§28). A
  // follow-up names the kind of figure missing, in platform words: the
  // applicant's own text stays in KNOWN FACTS, untrusted, and never enters
  // this trusted list.
  return needs
    .map((need) => {
      const head = `${need.dimension} (${need.reason.toLowerCase()})`;
      const angle = questionAngle(
        need.dimension,
        seed,
        askedCounts?.get(need.dimension) ?? 0,
      );
      const suggestion =
        angle === null ? "" : ` one way in, in your own words: "${angle}"`;
      if (need.reason === "NEEDS_SPECIFICS" && need.missing !== undefined) {
        return `${head}: they answered (see KNOWN FACTS) but not in figures an investor can use. Acknowledge what they said, then ask for ${need.missing};${suggestion}`.slice(
          0,
          400,
        );
      }
      return angle === null
        ? head
        : `${head}: aim for figures;${suggestion}`.slice(0, 400);
    })
    .join("\n")
    .slice(0, NEEDS_MAX_CHARS);
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

/**
 * Scripts an answer is read from when no language is stated: each maps to
 * the language CLDR says it most likely writes (`und-Arab` -> ar, `und-Cyrl`
 * -> ru, `und-Deva` -> hi). Data about scripts, not per-language code;
 * Latin is left out because it cannot tell English from French.
 */
const SCRIPTS = [
  "Arabic",
  "Hebrew",
  "Cyrillic",
  "Greek",
  "Devanagari",
  "Bengali",
  "Tamil",
  "Telugu",
  "Gujarati",
  "Gurmukhi",
  "Kannada",
  "Malayalam",
  "Thai",
  "Hangul",
  "Hiragana",
  "Katakana",
  "Han",
  "Ethiopic",
  "Georgian",
  "Armenian",
  "Khmer",
  "Lao",
  "Myanmar",
  "Sinhala",
] as const;
const SCRIPT_CODES: Readonly<Record<(typeof SCRIPTS)[number], string>> = {
  Arabic: "Arab",
  Hebrew: "Hebr",
  Cyrillic: "Cyrl",
  Greek: "Grek",
  Devanagari: "Deva",
  Bengali: "Beng",
  Tamil: "Taml",
  Telugu: "Telu",
  Gujarati: "Gujr",
  Gurmukhi: "Guru",
  Kannada: "Knda",
  Malayalam: "Mlym",
  Thai: "Thai",
  Hangul: "Kore",
  Hiragana: "Jpan",
  Katakana: "Jpan",
  Han: "Hani",
  Ethiopic: "Ethi",
  Georgian: "Geor",
  Armenian: "Armn",
  Khmer: "Khmr",
  Lao: "Laoo",
  Myanmar: "Mymr",
  Sinhala: "Sinh",
};

/** The language most of an utterance's letters are written in, from its script, or null. */
function languageOfScript(text: string): string | null {
  const letters = text.match(/\p{L}/gu)?.length ?? 0;
  if (letters === 0) return null;
  for (const script of SCRIPTS) {
    const count =
      text.match(new RegExp(`\\p{Script=${script}}`, "gu"))?.length ?? 0;
    if (count / letters > 0.5) {
      try {
        return new Intl.Locale(`und-${SCRIPT_CODES[script]}`).maximize()
          .language;
      } catch {
        return null;
      }
    }
  }
  return null;
}

/**
 * The language Q asks in. The applicant's stated language wins (any the
 * registry offers; English is null); otherwise what they last wrote or
 * said, read from its script by code (an Arabic answer is asked in Arabic,
 * a Russian one in Russian). Fund names, figures and terms stay as
 * recorded in any.
 */
export function interviewLanguageOf(
  input: Pick<InterviewTurnInput, "locale" | "utterance" | "recentTurns">,
): string | null {
  const stated = supportedLanguageOf(input.locale);
  if (stated !== null) return isEnglish(stated) ? null : stated;
  const lastSaid =
    input.utterance.trim().length > 0
      ? input.utterance
      : ([...input.recentTurns].reverse().find((t) => t.role === "person")
          ?.text ?? "");
  const read = languageOfScript(lastSaid);
  return read === null || isEnglish(read) ? null : read;
}

/**
 * Owner 2026-10-21: confirm like a person, never lecture. A figure Q works
 * out is said back for a yes, and a region is asked down to a country, in
 * whatever language the conversation is in. Code holds a worked-out figure
 * either way; this is how Q words the question outside English.
 */
const CONFIRM_NOTE =
  'If a figure is one you worked out (a sum, product or total of what they said) rather than one they said, do not propose it as their fact: end your reply by checking it in one short question, such as "So that\'s USD 360,000 in revenue, right?". Their yes makes it theirs. If they give a region rather than a country for where the company is, ask which country in it.';

function interviewLanguageNote(
  input: Pick<InterviewTurnInput, "locale" | "utterance" | "recentTurns">,
): string {
  const language = interviewLanguageOf(input);
  const note = writtenLanguageNote(language);
  const name = languageInfo(language)?.englishName;
  return note === null || name === undefined
    ? ""
    : ` ${note} Ask every question and say every reply in ${name}; the fund's name, the gateway's criteria as named, amounts and currencies stay exactly as recorded.`;
}

export function createGateQInterviewer(
  dependencies: InterviewerDependencies,
): GateQInterviewer {
  const { gateway, logger } = dependencies;
  const now = dependencies.now ?? (() => new Date());
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
        application === undefined || application.documentProposals.length === 0
          ? "none"
          : `${application.documentProposals.length} values from their documents`
      }`,
      "anything from the public web: no",
    ];
    return lines.join("\n");
  };

  return {
    turn: async (input) => {
      const application = input.application;
      const promptVersion =
        registry.getActive("GATEQ_INTERVIEWER").definition.version;
      // The statement record this turn is read against, with the legacy
      // facts no statement accounts for carried in (not yet written).
      const statementState = (() => {
        const turnContext = application?.statements;
        if (application === undefined || turnContext === undefined) return null;
        if (promptVersion < 7) return null;
        const carried = legacyCarry({
          applicationId: turnContext.applicationId,
          context: turnContext.context,
          legacyFacts: application.facts,
        });
        const all = [...turnContext.context.statements, ...carried];
        const view = projectView(
          all,
          turnContext.context.links,
          turnContext.context.events,
        );
        const sourceOf = new Map(all.map((s) => [s.id, s.sourceTurnId]));
        const log: AskLog = {
          asks: turnContext.asks,
          seqOf: (id) => {
            const turnId = sourceOf.get(id as never) ?? null;
            return turnId === null ? 0 : (turnContext.turnSeq.get(turnId) ?? 0);
          },
        };
        const handles = handlesFor(
          view,
          turnContext.unread.map((turn) => turn.id),
        );
        return { turnContext, carried, view, log, handles };
      })();
      const needs =
        application === undefined
          ? []
          : questionNeedsFor({
              policy: application.policy,
              qualification: application.qualification,
              facts: application.facts,
              askedCounts: input.askedCounts,
              emphasis: input.emphasis,
              ...(statementState === null
                ? {}
                : {
                    view: statementState.view,
                    asksSince: (dimension: ApplicationDimension) => {
                      const entry = statementState.view.dimensions.find(
                        (d) => d.dimension === dimension,
                      );
                      if (entry === undefined || entry.items.length === 0)
                        return 0;
                      // An open disagreement counts from when it opened;
                      // an unknown from the latest thing said.
                      const open = entry.disagreements.filter(
                        (d) => d.active && d.state === "OPEN",
                      );
                      const since =
                        open.length > 0
                          ? Math.max(
                              ...open.map((d) =>
                                statementState.log.seqOf(d.newerStatementId),
                              ),
                            )
                          : Math.max(
                              ...entry.items.map((item) =>
                                statementState.log.seqOf(item.statementId),
                              ),
                            );
                      return asksSince(statementState.log, dimension, since);
                    },
                  }),
            });

      // The renderer supplies the charter-level four; this is the rest.
      const variables: Omit<
        GateQInterviewerVariables & {
          readonly recordableDimensions?: string;
          readonly statementQuantities?: string;
          readonly unreadMessages?: string;
        },
        | "operatingMode"
        | "communicationProfile"
        | "communicationGuidance"
        | "environmentNotes"
      > = {
        personality: personality.manner,
        channel: input.channel,
        stage: input.stage,
        publicGateway: renderPublicGateway(input.publicGateway),
        knownFacts:
          application === undefined
            ? "(no application yet)"
            : statementState !== null
              ? renderKnownStatements(
                  statementState.view,
                  statementState.handles,
                )
              : renderFacts(application.facts),
        questionNeeds: renderNeeds(
          needs,
          input.variationSeed ?? application?.facts[0]?.applicationId ?? "",
          input.askedCounts,
        ),
        // Historical injected registries retain their original variable schema.
        // Only v3 receives the independent server-owned recording inventory.
        ...(promptVersion >= 3
          ? { recordableDimensions: APPLICATION_DIMENSIONS.join("\n") }
          : {}),
        ...(promptVersion >= 7
          ? {
              statementQuantities: GATEQ_STATEMENT_QUANTITIES.join(", "),
              unreadMessages:
                statementState === null ||
                statementState.turnContext.unread.length === 0
                  ? "(none)"
                  : statementState.turnContext.unread
                      .map((turn, index) => `T${index + 1}: ${turn.text}`)
                      .join("\n")
                      .slice(0, 6000),
            }
          : {}),
        documentProposals:
          application === undefined ||
          application.documentProposals.length === 0
            ? "(none)"
            : application.documentProposals
                .map((p) => `${p.dimension}: ${p.summary}`)
                .join("\n"),
        contradictions:
          application === undefined
            ? "(none)"
            : (statementState !== null
                ? [
                    ...renderDisagreements(
                      statementState.handles,
                      statementState.view,
                      statementState.log,
                    ),
                    ...figureContradictions(application.facts),
                  ]
                : contradictionsForInterview(
                    application.facts,
                    input.askedCounts,
                  )
              )
                .join("\n")
                .slice(0, 2000) || "(none)",
        askedAlready:
          input.askedAlready.length === 0
            ? "(nothing yet)"
            : input.askedAlready.join(", "),
        recentTurns:
          input.recentTurns.length === 0
            ? "(this is the first thing said)"
            : input.recentTurns
                .slice(-8)
                .map((t) => `${t.role}: ${t.text}`)
                .join("\n"),
        // The first turn says it is the first turn, as the prompt's rule
        // does ("WHAT THEY JUST SAID is empty on the first turn").
        utterance: orEmptyCase(
          input.utterance.slice(0, 4000),
          PROMPT_EMPTY_CASES.GATEQ_INTERVIEWER.utterance,
        ),
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
        environmentNotes: `You cannot record, decide or send anything yourself; Capital Q validates what you read and its own rules decide whether an application qualifies. ${CONFIRM_NOTE}${interviewLanguageNote(input)}`,
        variables,
      });

      let result: GateQInterviewerResultV2;
      try {
        const response = await gateway.execute<GateQInterviewerResultV2>(
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
            schema: GateQInterviewerResultV2Schema,
            firstAttemptTimeoutMs: FIRST_ATTEMPT_MS,
            ...(input.signal === undefined ? {} : { signal: input.signal }),
          },
        );
        if (response.output.kind !== "STRUCTURED") {
          throw new InterviewUnavailableError(true);
        }
        result = GateQInterviewerResultV2Schema.parse(
          (response.output as { readonly value: unknown }).value,
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
      // Counted, not silently dropped. A model that proposes a country
      // while the applicant is making a joke -- or while they are trying
      // to talk Q into something -- is the signal worth seeing in a log,
      // and a diagnostic that reports zero there is a diagnostic lying.
      let rejected = discardedByIntent ? result.facts.length : 0;
      // Every answer they state is saved (owner principle 2026-10-21): a
      // value in the wrong shape is put into its dimension's shape, and a
      // contact detail they change is recorded over the old one, whose
      // history the store keeps. The one refusal left is the truth guard:
      // an amount they never said. Unknown dimensions are the model's own
      // error, not something they said, and stay counted only.
      const notRecorded: NotRecorded[] = [];
      /** A region given for the country: asked down to a country. */
      let narrowTo: string | null = null;
      const held = (dimension: ApplicationDimension) =>
        input.application?.facts.find(
          (fact) =>
            fact.dimension === dimension &&
            fact.supersededAt === null &&
            fact.value.kind !== "NONE",
        );
      const currencyHeld = held("raise.currency")?.value;
      // Q's last line: a figure it read back there is theirs once they agree.
      const lastQ = [...input.recentTurns]
        .reverse()
        .find((turn) => turn.role === "q")?.text;
      /**
       * Did they agree to the figure Q read back? Q's own reading of the
       * turn says (live 2026-11-13: "Yes, zero revenue so far. Of our
       * roughly 1,500 weekly users…" was a yes, and Q asked again because a
       * word match saw another number). Code still checks the figure is the
       * one Q's own line read back. Only when the reading says nothing (an
       * older prompt, a checkpointed outcome) does the bounded word check
       * in affirmsReadBack stand in for it.
       */
      const agreedTo = (amount: string): boolean => {
        if (lastQ === undefined || !amountStatedIn(amount, lastQ)) return false;
        if (result.readBackConfirmed === true) return true;
        if (result.readBackConfirmed === false) return false;
        return affirmsReadBack(amount, lastQ, input.utterance);
      };
      // Slice 2: the turn is read into atomic statements. Every row it
      // writes is decided here, with its id, and checkpointed with the
      // reply; the legacy facts are re-projected from the statements.
      if (statementState !== null) {
        const { turnContext } = statementState;
        const agreedReadBacks =
          result.intent === "SABOTAGE"
            ? []
            : readBacksIn(lastQ ?? "").filter((back) => agreedTo(back.amount));
        const planned = planReading({
          applicationId: turnContext.applicationId,
          context: turnContext.context,
          carried: statementState.carried,
          legacyFacts: application?.facts ?? [],
          handles: statementState.handles,
          current: { id: turnContext.currentTurnId, text: input.utterance },
          currentRead: turnContext.currentRead === true,
          unread: turnContext.unread,
          // A reading that wrote legacy facts and no statements (an
          // older prompt, a model that ignored v7) still loses nothing:
          // each fact is read as a NEW statement, linked to nothing.
          statements:
            result.statements.length > 0 ||
            result.disagreementActions.length > 0
              ? result.statements
              : result.facts.flatMap((fact) =>
                  statementsOfFact(fact, input.utterance),
                ),
          actions: result.disagreementActions,
          discard: discardedByIntent,
          agreedTo,
          agreedReadBacks,
          now: now(),
        });
        // Legacy readings (facts) from a v7 model are not read: v7 writes
        // statements, and a facts list beside them would be a second truth.
        const englishTurn = interviewLanguageOf(input) === null;
        const readBackLineText = englishTurn
          ? readBackLine(planned.readBacks) ||
            (planned.narrowTo === null
              ? ""
              : `Which country in ${planned.narrowTo} is the company based in?`)
          : "";
        const askingDimension =
          readBackLineText.length > 0
            ? (planned.readBacks[0]?.dimension ?? "company.country")
            : result.asking !== null && DIMENSIONS.has(result.asking)
              ? (result.asking as ApplicationDimension)
              : null;
        const composed =
          readBackLineText.length === 0
            ? result.reply
            : `${aroundReadBack(
                result.reply,
                planned.readBacks.map((item) => item.amount),
              )} ${readBackLineText}`
                .trim()
                .slice(0, 4_000);
        logger?.debug(
          {
            correlationId: input.attribution.correlationId,
            stage: input.stage,
            intent: result.intent,
            statements: planned.recordedCount,
            links: planned.plan.links.length,
            events: planned.plan.events.length,
            unread: turnContext.unread.length,
            rejected: planned.rejected,
            incomplete: planned.incomplete.length,
          },
          "gateq interview turn read into statements",
        );
        return {
          // Invariant 7: "noted" only when the reading recorded something.
          reply: replyHeldToReading(
            composed,
            planned.recordedCount,
            planned.leftOpenCount,
          ),
          intent: result.intent,
          facts: planned.plan.legacyFacts,
          rejectedFacts: planned.rejected,
          ...(planned.readBacks.length === 0
            ? {}
            : { notRecorded: planned.readBacks }),
          asking: askingDimension,
          questionForQ: result.questionForQ,
          readyToReview: result.readyToReview,
          statementPlan: planned.plan,
        };
      }

      // Live D10 (2026-11-14, Routeix): a turn-level conflict on traction
      // paired "600 weekly active" with every later traction line ("6 to 18
      // operators", "willingness to pay not tested"), so one disagreement
      // showed as three. The reading now marks the one statement that
      // disagrees (`disagreesWith`), and only that statement is paired.
      // The turn-level `conflicts` list still tells Q to ask; it never
      // pairs a statement on its own (it cannot say which one disagrees).
      const conflictFor = (
        candidate: (typeof proposed)[number],
      ): { readonly earlier: string } | null =>
        candidate.disagreesWith === undefined ||
        candidate.disagreesWith === null ||
        candidate.disagreesWith.trim().length === 0
          ? null
          : { earlier: candidate.disagreesWith };
      /** What this turn already wrote per dimension: two statements add up. */
      const writtenNow = new Map<ApplicationDimension, number>();
      for (const candidate of proposed) {
        if (!DIMENSIONS.has(candidate.dimension)) {
          rejected += 1;
          continue;
        }
        const dimension = candidate.dimension as ApplicationDimension;
        const normalised = normaliseProposedFact(
          {
            dimension,
            value: candidate.value,
            provenance: candidate.provenance,
          },
          {
            utterance: input.utterance,
            currencyOnRecord:
              currencyHeld?.kind === "CODE" ? currencyHeld.code : null,
          },
        );
        if (
          normalised === null &&
          dimension === "company.country" &&
          candidate.value.kind !== "NONE"
        ) {
          // A region, not a country ("somewhere in Europe"): Q asks which
          // country in it, by name, as the turn's question.
          const region = regionIn(
            candidate.value.kind === "TEXT"
              ? candidate.value.text
              : candidate.value.kind === "CODE"
                ? candidate.value.code
                : candidate.value.kind === "PHRASES"
                  ? candidate.value.phrases.join(", ")
                  : "",
          );
          if (region !== null) narrowTo = region;
        }
        if (normalised === null) {
          // Words with nothing of the shape in them ("somewhere in
          // Europe" for a country): their sentence stays on the transcript
          // and the dimension stays open, so Q asks it. Counted, and never
          // said as a failure.
          rejected += 1;
          continue;
        }
        // An amount must be one the person said, or agreed to when Q said
        // it back. One Q worked out ("two pay $180,000 each" read as revenue
        // 360000) is not recorded as their claim yet: Q says it back as a
        // question and their yes records it next turn.
        // A zero the reading heard stated is no worked-out figure (D9).
        if (
          normalised.value.kind === "AMOUNT" &&
          candidate.value.kind !== "ZERO" &&
          !amountStatedIn(normalised.value.amount, input.utterance) &&
          !agreedTo(normalised.value.amount)
        ) {
          rejected += 1;
          notRecorded.push({
            dimension,
            reason: "AMOUNT_READ_BACK",
            amount: normalised.value.amount,
            currency: normalised.value.currency,
          });
          continue;
        }
        // Unknown never erases what they told us (live D2b, 2026-11-14,
        // application bf389feb): "I'm not sure which is right", "I don't
        // know yet" and "willingness to pay is not tested yet" were each
        // read as traction NONE, and each replaced a fact holding three
        // statements and an unreconciled 600 against 1,500 with nothing.
        // A NONE value states no value, so it is never a correction, even
        // when the turn's reading calls the turn one: the held statements
        // stay, an unreconciled pair stays unreconciled until the founder
        // says which is right, and their words stay on the transcript. Only
        // a correction that states a value replaces (below).
        if (normalised.value.kind === "NONE" && held(dimension) !== undefined)
          continue;
        // The same contact detail again ("I'm Laura" with "Laura Mensah"
        // on record) is already held: nothing to write, nothing refused.
        if (sameContact(normalised, held(dimension))) continue;
        // A new statement about a narrative dimension adds to what they
        // said before unless they said it replaces it (fact-history.ts):
        // "willingness to pay not tested" never erases the user numbers,
        // and two numbers that disagree are both kept and flagged.
        // Two statements about one dimension in one turn add up too (live
        // D10: "6 to 18 operators" was lost to "about 1,500 weekly active",
        // both written over the same held value).
        const sameTurn = writtenNow.get(dimension);
        const before =
          sameTurn === undefined ? held(dimension) : facts[sameTurn];
        const heldText =
          before === undefined ? null : asStatement(before.value);
        const saidText = asStatement(normalised.value);
        if (
          ACCUMULATING_DIMENSIONS.has(dimension) &&
          before !== undefined &&
          heldText !== null &&
          saidText !== null
        ) {
          // Live D11 (2026-11-14, Layerum): "about 1,500 weekly active now"
          // was read as a correction AND as disagreeing with "600 weekly
          // active" (Q asked "which figure should I use?"), and the
          // correction path replaced all of traction with that one line.
          // When the reading is unsure whether it corrects or disagrees
          // (it flags a disagreement on this dimension), both are kept as
          // a pair until the founder settles it. A plain correction
          // replaces only the statement it corrects (fact-history.ts).
          const marked = conflictFor(candidate);
          const turnConflict = result.conflicts.find(
            (conflict) => conflict.dimension === dimension,
          );
          const corrects =
            typeof candidate.corrects === "string" &&
            candidate.corrects.trim().length > 0
              ? candidate.corrects
              : null;
          const unsure =
            candidate.correction &&
            (marked !== null || turnConflict !== undefined);
          if (candidate.correction && !unsure) {
            const corrected = correctedStatement({
              held: { value: heldText, provenance: before.provenance },
              statement: saidText.text,
              provenance: normalised.provenance,
              corrects,
            });
            if (corrected === null) continue;
            const fact = { ...normalised, ...corrected };
            if (sameTurn === undefined) {
              writtenNow.set(dimension, facts.length);
              facts.push(fact);
            } else facts[sameTurn] = fact;
            continue;
          }
          // Unsure: the earlier words are the ones the reading quotes, and
          // only words really on record pair (a pair with the wrong
          // statement is the D10 defect again).
          const unsureEarlier =
            [marked?.earlier ?? null, corrects, turnConflict?.earlier ?? null]
              .filter((quote): quote is string => quote !== null)
              .find((quote) => holdsWords(heldText, quote)) ?? null;
          const added = addedStatement({
            held: { value: heldText, provenance: before.provenance },
            statement: saidText.text,
            provenance: normalised.provenance,
            conflict: unsure
              ? unsureEarlier === null
                ? null
                : { earlier: unsureEarlier }
              : marked,
          });
          if (added === null) continue;
          const fact = { ...normalised, ...added };
          if (sameTurn === undefined) {
            writtenNow.set(dimension, facts.length);
            facts.push(fact);
          } else facts[sameTurn] = fact;
          continue;
        }
        if (ACCUMULATING_DIMENSIONS.has(dimension) && sameTurn === undefined)
          writtenNow.set(dimension, facts.length);
        const current = input.application?.facts.find(
          (fact) =>
            fact.dimension === normalised.dimension &&
            fact.supersededAt === null &&
            fact.provenance === "DOCUMENT_SUPPORTED" &&
            JSON.stringify(fact.value) === JSON.stringify(normalised.value),
        );
        // A model cannot mint evidence support. New document-derived values
        // need the authorized Evidence confirmation path and exact lineage.
        facts.push(
          normalised.provenance === "DOCUMENT_SUPPORTED" &&
            current === undefined
            ? { ...normalised, provenance: "APPLICANT_PROVIDED" }
            : normalised,
        );
      }

      // Their yes to the figures Q read back records them, whether or not
      // the model proposed them again (code reads Q's own read-back line).
      if (result.intent !== "SABOTAGE") {
        for (const back of readBacksIn(lastQ ?? "")) {
          if (
            facts.some((fact) => fact.dimension === back.dimension) ||
            !agreedTo(back.amount)
          ) {
            continue;
          }
          const fact = NewApplicationFactSchema.safeParse({
            dimension: back.dimension,
            value: {
              kind: "AMOUNT",
              amount: back.amount,
              currency: back.currency,
            },
            provenance: "APPLICANT_PROVIDED",
          });
          if (fact.success) facts.push(fact.data);
        }
      }

      // A worked-out figure is asked about, so the read-back is this
      // turn's question.
      const english = interviewLanguageOf(input) === null;
      const readBack = english
        ? readBackLine(notRecorded) ||
          (narrowTo === null
            ? ""
            : `Which country in ${narrowTo} is the company based in?`)
        : "";
      const asking =
        readBack.length > 0
          ? (notRecorded[0]?.dimension ?? "company.country")
          : result.asking !== null && DIMENSIONS.has(result.asking)
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

      // The read-back replaces the reply's own closing question, so the
      // applicant is asked one thing. In another language the model's words
      // stand and the figure shows as still needed in coverage.
      return {
        reply:
          readBack.length === 0
            ? result.reply
            : `${aroundReadBack(
                result.reply,
                notRecorded.map((item) => item.amount),
              )} ${readBack}`
                .trim()
                .slice(0, 4_000),
        intent: result.intent,
        facts,
        rejectedFacts: rejected,
        ...(notRecorded.length === 0 ? {} : { notRecorded }),
        asking,
        questionForQ: result.questionForQ,
        // Advisory only. Whether the application may actually be submitted
        // is GATE-001's answer, and whether it is submitted is a person's.
        readyToReview: result.readyToReview,
      };
    },
  };
}
