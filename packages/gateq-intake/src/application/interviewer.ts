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
  GateQInterviewerResultSchema,
  GateQTurnIntentSchema,
  orEmptyCase,
  PROMPT_EMPTY_CASES,
  type GateQInterviewerResult,
  type GateQInterviewerVariables,
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
  contradictionsIn,
  questionNeedsFor,
  type QuestionNeed,
} from "./question-needs.js";
import { questionAngle } from "./answer-specificity.js";
import { regionIn } from "./cities.js";
import { normaliseProposedFact } from "./normalise-fact.js";
import { readBackLine, readBacksIn, type NotRecorded } from "./not-recorded.js";
import { affirmsReadBack, amountStatedIn } from "./stated-amount.js";

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
      const needs =
        application === undefined
          ? []
          : questionNeedsFor({
              policy: application.policy,
              qualification: application.qualification,
              facts: application.facts,
              askedCounts: input.askedCounts,
              emphasis: input.emphasis,
            });

      // The renderer supplies the charter-level four; this is the rest.
      const variables: Omit<
        GateQInterviewerVariables & { readonly recordableDimensions?: string },
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
            : renderFacts(application.facts),
        questionNeeds: renderNeeds(
          needs,
          input.variationSeed ?? application?.facts[0]?.applicationId ?? "",
          input.askedCounts,
        ),
        // Historical injected registries retain their original variable schema.
        // Only v3 receives the independent server-owned recording inventory.
        ...(registry.getActive("GATEQ_INTERVIEWER").definition.version >= 3
          ? { recordableDimensions: APPLICATION_DIMENSIONS.join("\n") }
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
            : contradictionsIn(application.facts).join("\n") || "(none)",
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
            firstAttemptTimeoutMs: FIRST_ATTEMPT_MS,
            ...(input.signal === undefined ? {} : { signal: input.signal }),
          },
        );
        if (response.output.kind !== "STRUCTURED") {
          throw new InterviewUnavailableError(true);
        }
        result = GateQInterviewerResultSchema.parse(
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
        if (
          normalised.value.kind === "AMOUNT" &&
          !amountStatedIn(normalised.value.amount, input.utterance) &&
          !affirmsReadBack(normalised.value.amount, lastQ, input.utterance)
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
        // The same contact detail again ("I'm Laura" with "Laura Mensah"
        // on record) is already held: nothing to write, nothing refused.
        if (sameContact(normalised, held(dimension))) continue;
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
            !affirmsReadBack(back.amount, lastQ, input.utterance)
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
