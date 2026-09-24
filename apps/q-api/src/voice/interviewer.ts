import { randomUUID } from "node:crypto";

import {
  appendOnboardingInterviewTurns,
  completeOnboardingSession,
  findTaxonomyCandidates,
  getTaxonomyNode,
  getOnboardingSession,
  resolveOnboardingSuggestion,
  skipOnboardingStep,
  submitOnboardingResponse,
  type ApiSession,
} from "@capital-q/api-client";
import {
  canonicalJsonStringify,
  ONBOARDING_TEXT_MAX_LENGTH,
  type ModelDataPosture,
  type OnboardingResponseValue,
  type OnboardingSessionView,
} from "@capital-q/contracts";
import { FOUNDER_DEFINITION_V2 } from "@capital-q/founder-onboarding";
import { INVESTOR_DEFINITION_V1 } from "@capital-q/investor-onboarding";
import type { OnboardingStepManifest } from "@capital-q/onboarding";
import {
  isModelGatewayError,
  type ModelGateway,
} from "@capital-q/model-gateway";
import type { Logger } from "@capital-q/observability";
import {
  composeRepair,
  ConversationTurnReadingSchema,
  createDefaultPromptRegistry,
  decideResearch,
  DEFAULT_COMMUNICATION_PROFILE,
  disposeTurn,
  INITIAL_CONVERSATION_STATE,
  isExhausted,
  labelsOf,
  loggableTrace,
  nextRepair,
  reduceConversation,
  renderPrompt,
  resolveOptionReference,
  InterviewConductorV7ResultSchema,
  deliveryFromCue,
  shouldNotify,
  subsystemNotice,
  traceVerdict,
  type ConversationEvent,
  type ConversationState,
  type ConversationTurnReading,
  type SpeechDelivery,
  type InterviewConductorResult,
  type InterviewConductorV8Variables,
  type InterviewOpenStep,
  type PromptRegistry,
  type QualitativeMeaning,
  type ReadingConfidence,
  type RepairStrategy,
  type ResearchDecision,
  type ShownOption,
  type TurnTrace,
  personalityOf,
  type InterviewDestination,
  type QPersonalityCode,
} from "@capital-q/q-core";

import { SPOKEN_QUESTIONS, stepNoun } from "./step-copy.js";
/**
 * Q conducting the interview (CQ-Q-VOICE-001 rework).
 *
 * One turn: read the session as Capital Q's records hold it, hand the model
 * the open steps with their real options, what is known, what is pending,
 * and what the person said; get back what Q says next and a structured
 * reading of the words. Then the deterministic part: every proposed
 * answer is checked against the step's own kind and options, material
 * values are held for the person's confirmation instead of recorded,
 * categories are mapped through the platform's classifier and read back,
 * and everything that survives is committed through the onboarding
 * runtime's normal validated submit under the person's own token.
 *
 * The model never records anything. It proposes; the runtime disposes.
 */

/** The gateway seam, narrowed to what this needs: one dialogue task, structured output. */
export type InterviewGateway = Pick<ModelGateway, "execute">;

export type InterviewerDependencies = {
  readonly gateway: InterviewGateway;
  readonly registry?: PromptRegistry | undefined;
  readonly logger: Logger;
  /** The manner Q carries itself in; UPBEAT when unset. */
  readonly personality?: QPersonalityCode | undefined;
  /** True when the speech model renders inline audio tags ([laughs]). */
  readonly expressive?: boolean | undefined;
  /**
   * What the deployment attests about this material (doc 15 §62).
   *
   * Absent means REAL_CUSTOMER, which is the safe default. Where the
   * deployment has attested its material is invented, the free route is
   * eligible — and without that, a staging interview at CONFIDENTIAL had
   * no eligible model at all once one provider was spent, which is what
   * produced the scripted loop QX-004 §0 exists to end.
   */
  readonly dataPosture?: ModelDataPosture | undefined;
  /**
   * What Capital Q remembers about the person (ADR 0012), as bounded
   * text for the prompt. Absent means the interview starts from nothing,
   * as it did before.
   */
  readonly memory?:
    | {
        readonly recallText: (attribution: {
          readonly tenantId: string;
          readonly userId: string;
        }) => Promise<string>;
      }
    | undefined;
  /**
   * Whether this deployment can run public research at all (CQ-QX-005
   * §11, §13). Absent means it can. Both transports carry a question
   * away: a spoken turn's caller runs the Q run itself, and the typed
   * surface starts the same run from the turn's `researching`.
   */
  readonly research?: { readonly available: () => boolean } | undefined;
};

export type InterviewTurnInput = {
  readonly session: ApiSession;
  readonly onboardingSessionId: string;
  readonly journeyType: "founder" | "investor";
  readonly channel: "voice" | "text";
  readonly attribution: {
    readonly tenantId: string;
    readonly userId: string;
    readonly correlationId: string;
  };
  /** Empty for the opening line. */
  readonly utterance: string;
  /**
   * What they typed when they created the account (QX-004 core gate §2).
   *
   * Captured at sign-up and then, until now, never used: Q asked "what is
   * the name of your firm?" of somebody who had just written it into the
   * registration form. That is the single most obvious way for a product
   * to look like it is not paying attention.
   *
   * It is a CANDIDATE and nothing more. Text a person typed into a form
   * is not an authoritative organisation, it is not a membership, and it
   * is certainly not proof that this is the entity they are setting up —
   * somebody may register with their employer's name and invest through
   * a separate vehicle. So it is offered for confirmation and recorded
   * only once they say yes, which is the ordinary path every other answer
   * takes.
   */
  readonly signup?:
    | {
        readonly displayName: string | null;
        readonly organisationName: string | null;
      }
    | undefined;
  readonly recentTurns: readonly {
    readonly role: "person" | "q";
    readonly text: string;
  }[];
  /**
   * What Capital Q found on the public web about this subject, and what
   * it looked for and could not find (Workstream C's presence reader).
   *
   * Structural rather than imported, so that the transport can be wired
   * in the route without this module taking a dependency on the research
   * packages. The caller maps the presence reader's own types onto it.
   *
   * Two rules, both enforced below rather than asked for politely:
   *
   * **It is never an answer.** These become platform NOTES — prose for
   * the model to speak from — and never `answers`, never a candidate,
   * never a commit. A page on the internet is provenance; only the
   * person is authority. An absence is not evidence of anything either:
   * "no public investment profile" says something about the web, not
   * about them.
   *
   * **It never reaches an investor's mandate.** Declared Mandate is not
   * Observed Behaviour and is not Q Inference. A finding about an
   * investor may be spoken as context — "I couldn't find a public
   * investment profile, and you said you have just started, so that
   * makes sense" — and may never be offered for a mandate step.
   */
  readonly research?:
    | {
        readonly findings: readonly {
          readonly statement: string;
          readonly domains: readonly string[];
          readonly stepKey: string | null;
        }[];
        readonly absences: readonly {
          readonly code: string;
          readonly stepKey: string | null;
        }[];
      }
    | undefined;
  readonly signal?: AbortSignal | undefined;
};

/**
 * Steps whose values are the investor's declared mandate.
 *
 * Nothing found on the public web may be offered for one of these, at
 * any confidence, however plausible. An investor's mandate is a
 * declaration they make; inferring it from a website and then ranking
 * founders against the inference is the failure this exists to prevent.
 */
const MANDATE_PHASE = /^I[1-3]\./;

export type InterviewOption = {
  readonly key: string;
  readonly label: string;
  readonly description?: string | undefined;
};

export type InterviewTurnOutcome = {
  /** What Q says. */
  readonly reply: string;
  readonly intent: InterviewConductorResult["intent"];
  /** The step Q is asking, and its options when they should be shown. */
  readonly asking: {
    readonly stepKey: string;
    readonly kind: InterviewOpenStep["kind"];
    readonly options: readonly InterviewOption[];
    readonly maxChoices: number | undefined;
  } | null;
  /** Steps recorded this turn. */
  readonly recorded: readonly string[];
  /** Steps set aside this turn. */
  readonly skipped: readonly string[];
  /** A question for Q, when the person asked one (a lookup becomes one). */
  readonly questionForQ: string | null;
  /**
   * The subject Q is going to look up unprompted, when this turn started
   * one (QX-004 §1.1, §1.2). Nobody asked for it, so what it does not
   * find is not announced — the caller reads this to treat the run as a
   * look-up rather than an answer.
   */
  readonly researching: string | null;
  /** Where the person asked to be taken, validated against the fixed list. */
  readonly navigate: InterviewDestination | null;
  /** Set when Q has stopped conducting and leaves the person with the form. */
  readonly handoff: "FORM" | null;
  /** A name or term the person corrected the pronunciation of. */
  readonly pronounce: { readonly term: string; readonly sayAs: string } | null;
  /** Warnings issued so far in this session about derailing the interview. */
  readonly warnings: number;
  /** The session after this turn. */
  readonly view: OnboardingSessionView;
  /** True when the model could not be reached and Q spoke a fallback line. */
  readonly degraded: boolean;
  /**
   * What the turn was, in the conversation core's closed vocabulary
   * (CQ-QX-005). Null only when no model answered.
   */
  readonly reading: ConversationTurnReading | null;
  /**
   * The question to return to once an interruption — a question of
   * theirs, a research run — is over, said the way Q would ask it. A
   * caller that carried the interruption speaks this after it.
   */
  readonly resume: {
    readonly stepKey: string;
    readonly question: string;
  } | null;
  /** Meaning kept beside a field this session, in the person's words. */
  readonly qualitative: readonly QualitativeMeaning[];
  /** raw STT → normalised → classification → extracted → persisted. */
  readonly trace: TurnTrace | null;
  /**
   * How the reply should sound, as the model asked (CQ-VOICE-010). For the
   * speech layer only. It is never part of `reply`, the thread or memory.
   * Absent on every path where the model did not write the reply.
   */
  readonly delivery?: SpeechDelivery | null | undefined;
};

/**
 * The choices on the step somebody is standing on, in a sentence
 * (QX-004 core gate §8).
 *
 * Written from the step's own options, which is where they already are.
 * Asked "what sectors and product areas are there?", the interview was
 * sending the question away to be researched — thirty seconds of silence,
 * and then the same field asked again. It was holding the answer the
 * whole time.
 */
function optionsSentence(view: OnboardingSessionView): string | null {
  // Read from the step the session is actually on, not from the journey
  // catalogue: what this person can choose right now is a property of
  // their session, and it is the thing they asked about.
  const presentation = view.currentStep?.presentation;
  const options =
    presentation !== undefined &&
    presentation !== null &&
    "options" in presentation
      ? presentation.options
      : [];
  if (options.length === 0) return null;
  const labels = options.map((option) => option.label.trim()).filter(Boolean);
  if (labels.length === 0) return null;
  const shown = labels.slice(0, 12);
  const list =
    shown.length === 1
      ? shown[0]
      : `${shown.slice(0, -1).join(", ")} and ${shown[shown.length - 1]}`;
  const more =
    labels.length > shown.length
      ? `, and ${String(labels.length - shown.length)} more on screen`
      : "";
  return `${String(list)}${more}.`;
}

/**
 * How far along the interview is, in a sentence.
 *
 * Counted from the session's own progress. "Where are we so far?" is an
 * ordinary thing to ask halfway through a form, and the honest answer is
 * arithmetic — not something to look up, and not a reason to re-ask the
 * field they were on.
 */
function progressSentence(
  view: OnboardingSessionView,
  steps: ReadonlyMap<string, OnboardingStepManifest>,
): string {
  const eligible = view.progress.eligibleSteps;
  const done = eligible.filter((step) => step.status === "COMPLETED");
  const left = Math.max(0, eligible.length - done.length);
  /**
   * Where they are, said the way Q would ask it.
   *
   * Through `askLabel` rather than the step's raw prompt, because the
   * raw prompt is sometimes the platform's own vocabulary — live, this
   * sentence ended "We are on this one: Which mandate are we defining",
   * which is the exact internal term Q is not allowed to say. One place
   * decides how a step is named to a person, and this is a caller of
   * it, not an exception to it.
   */
  const currentStepManifest =
    view.currentStep === null || view.currentStep === undefined
      ? undefined
      : steps.get(view.currentStep.stepKey);
  const current = (
    currentStepManifest === undefined
      ? (view.currentStep?.prompt ?? "")
      : askLabel(currentStepManifest)
  ).trim();
  // Only when the step's own prompt is actually a question. Some are
  // bare labels — "Your firm" — and reading one out is the exact thing
  // that made the live transcript unusable. A person who asks where they
  // are is better served by the count alone than by a label read at them.
  const asksSomething = /\?$/.test(view.currentStep?.prompt?.trim() ?? "");
  const where =
    asksSomething && current.length > 0
      ? ` We are on this one: ${current.replace(/\?+$/, "")}.`
      : "";
  if (done.length === 0) {
    return `Nothing is on your record yet — there are ${String(left)} to go.${where}`;
  }

  /**
   * What is covered, named from the recorded answers themselves.
   *
   * Read from `view.responses`, which is the owning service's answer to
   * "what do you hold", and never from anything the person said in
   * conversation. The two came apart live: every provider was down, three
   * answers went nowhere, and Q still reported "we have your type, which
   * is Angel, and your firm, Zino Aviation" — from its own memory of the
   * turns, against a session holding nothing at all.
   */
  const named = done
    .map((step) => {
      const recorded = view.responses.find((r) => r.stepKey === step.stepKey);
      if (recorded === undefined) return null;
      /**
       * A reference the platform resolved is not something they
       * answered.
       *
       * Live, this line read "Are we setting up your main investment
       * strategy, or a different one: 1 recorded" — a count of rows,
       * offered to a person as an account of their own progress, for a
       * choice the platform made on their behalf because there was only
       * one. Nothing about it belongs in an answer to "where are we?".
       */
      if (
        recorded.value.type === "RESOURCE_REFERENCE" &&
        recorded.value.resourceType !== "TAXONOMY_NODE"
      ) {
        return null;
      }
      const manifest = steps.get(step.stepKey);
      const label = manifest === undefined ? undefined : askLabel(manifest);
      const value = describeValue(
        steps.get(step.stepKey),
        recorded.value,
        recordedCurrency(view, steps),
      ).trim();
      if (value.length === 0) return null;
      return label === undefined || label.length === 0
        ? value
        : `${label.replace(/\?+$/, "")}: ${value}`;
    })
    .filter((line): line is string => line !== null)
    .slice(0, 6);

  const list =
    named.length === 0 ? "" : ` On your record so far: ${named.join("; ")}.`;
  return `${String(done.length)} of ${String(eligible.length)} answered, ${String(left)} to go.${list}${where}`;
}

/**
 * Put the name Capital Q holds where the model left a placeholder
 * (QX-004 core gate §7).
 *
 * Live, an investor whose firm is Zino Aviation was greeted about the
 * "Zinoevation mandate". The prompt had asked the model to open by the
 * firm's name, and a model writing prose will occasionally write a name
 * that is nearly right — which, for a name, is wrong. It is the first
 * thing somebody reads, and getting it wrong says Capital Q does not
 * know who they are.
 *
 * The model now writes `<them>`; the authoritative value is substituted
 * here. When nothing is recorded there is nothing to substitute, and the
 * placeholder is removed along with the article in front of it, so the
 * sentence reads as a shade less warm rather than as a gap. Less warm
 * and true beats warm and wrong.
 */
export function withKnownName(
  reply: string,
  organisation: string | null,
): string {
  if (!reply.includes("<them>")) return reply;
  if (organisation !== null && organisation.length > 0) {
    return reply.replaceAll("<them>", organisation);
  }
  return reply
    .replace(/\b(?:the|your|their)\s+<them>\b/g, "your organisation")
    .replaceAll("<them>", "your organisation")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export type OnboardingRefusal = {
  /**
   * The service's own sentence, kept for the log and for the rare refusal
   * that names no step.
   *
   * NOT the thing a person hears when the refusal is a prerequisite: a
   * backend validation message is a diagnostic, it is written for whoever
   * is reading the logs, and making it the words Q speaks would turn it
   * into a UX contract that nobody meant to sign. What Q says is composed
   * from `needs` and the step's own question.
   */
  readonly because: string | null;
  /**
   * The step the service says must be answered first, when it named one.
   *
   * The journey has prerequisites, and it reports a missed one as a
   * validation code shaped `<step>_required` — "mandate_context_required",
   * "investor_type_required". That is the authoritative answer to "what
   * should Q ask next", so it is the one used: no guessing at an order, no
   * list of steps kept in step with the definition by hand.
   */
  readonly needs: string | null;
};

/**
 * What an owning service said when it refused an answer.
 *
 * Its own sentence and the step it named, and nothing else: a status code
 * is not something to read out, a stack is not either, and a message
 * Capital Q did not compose has no business being spoken. Both are null
 * whenever the refusal carries neither, and Q falls back to saying plainly
 * that it did not go in.
 */
export function readRefusal(error: unknown): OnboardingRefusal {
  const nothing: OnboardingRefusal = { because: null, needs: null };
  if (typeof error !== "object" || error === null) return nothing;
  const problem = (error as { readonly problem?: unknown }).problem;
  if (typeof problem !== "object" || problem === null) return nothing;

  const sentence = (value: unknown): string | null => {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    if (trimmed.length === 0 || trimmed.length > 200) return null;
    return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
  };

  const errors = (problem as { readonly errors?: unknown }).errors;
  const first: unknown = Array.isArray(errors) ? errors[0] : undefined;
  const violation =
    typeof first === "object" && first !== null
      ? (first as { readonly code?: unknown; readonly message?: unknown })
      : undefined;

  const code = typeof violation?.code === "string" ? violation.code : "";
  const required = /^(.+)_required$/.exec(code);
  return {
    because:
      sentence(violation?.message) ??
      sentence((problem as { readonly detail?: unknown }).detail),
    needs: required?.[1] ?? null,
  };
}

/**
 * What somebody typed when they created the account, read from their own
 * access token (QX-004 core gate §2).
 *
 * Supabase carries `user_metadata` in the JWT, which is where the sign-up
 * form's name and organisation land. Reading it here rather than asking
 * the browser to send it keeps the browser out of it entirely: the token
 * is already the person's proof of who they are, and a field a client
 * could set would be a field a client could lie about.
 *
 * It is bounded and treated as text a person typed. Never authority.
 */
export function signupContextFromToken(accessToken: string): {
  readonly displayName: string | null;
  readonly organisationName: string | null;
} {
  const nothing = { displayName: null, organisationName: null };
  try {
    const payload = accessToken.split(".")[1];
    if (payload === undefined) return nothing;
    const decoded: unknown = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    );
    const metadata =
      typeof decoded === "object" && decoded !== null
        ? (decoded as { readonly user_metadata?: unknown }).user_metadata
        : undefined;
    if (typeof metadata !== "object" || metadata === null) return nothing;
    const read = (key: string, max: number): string | null => {
      const value = (metadata as Record<string, unknown>)[key];
      if (typeof value !== "string") return null;
      const trimmed = value.trim();
      return trimmed.length === 0 || trimmed.length > max ? null : trimmed;
    };
    return {
      displayName: read("display_name", 80),
      organisationName: read("organisation_name", 120),
    };
  } catch {
    // A token we cannot read is a person we greet without their details.
    return nothing;
  }
}

/** Pending confirmations per onboarding session; conversational, in memory. */
type Pending = {
  readonly stepKey: string;
  readonly question: string;
  readonly value: OnboardingResponseValue;
  readonly spoken: string;
};

/**
 * A step-shaped value the person gave that the journey has not recorded.
 *
 * Validated against the step the same way a recorded answer is — it went
 * through `toResponseValue` — and then held, because the owning service
 * is not ready for it. It carries what it is, not a promise that it will
 * be kept: the ledger re-offers it every turn and drops it as soon as the
 * session shows the step settled.
 *
 * Everything here has either been said plainly or been said yes to. A
 * material value still awaiting its yes is not a candidate — it stays a
 * pending confirmation, which is a different thing and already
 * survives between turns.
 */
type Candidate = {
  readonly stepKey: string;
  readonly value: OnboardingResponseValue;
  readonly spoken: string;
  /** Commit attempts so far; a value the journey keeps refusing is let go. */
  readonly attempts: number;
};

/**
 * How many turns a candidate is re-offered before the platform stops.
 *
 * Generous, because the usual reason for a refusal is a prerequisite the
 * interview is about to satisfy anyway; bounded, because a value the
 * journey will never take should not be retried until the session ends,
 * and should not be reported to the person as held.
 */
const MAX_CANDIDATE_ATTEMPTS = 12;
/** Candidates held at once. Conversational state, not a queue. */
const MAX_CARRIED = 16;

/**
 * What one spoken interview turn may spend.
 *
 * The timings are set by the route above this one, not by the model: the
 * think endpoint ends a turn at twenty seconds so that the person hears a
 * sentence from Q rather than the speech provider's own line dying. An
 * attempt allowed forty-five seconds could therefore never pay off — it
 * was simply cancelled, and hosted that is what happened to every turn a
 * slow generation landed on (2026-09-22): Gemini answered in about a
 * second most of the time and in sixteen sometimes, and the sixteens took
 * the whole turn with them.
 *
 * The attempt timeout is what keeps a slow generation from eating the
 * turn; the attempt COUNT is what lets the turn reach a second provider.
 * Cutting the count to two conflated them, and the local harness caught
 * it in seconds: with Gemini's two models answering 503, both attempts
 * were spent inside Google and Groq — configured, healthy, a second away
 * — was never asked. A budget must be able to walk the route it was
 * given.
 *
 * So: four attempts, twelve seconds each. Four is the length of the
 * fallback chain. Twelve because Gemini refuses a request deadline under
 * ten seconds outright, and a budget below that turns every Gemini call
 * into an HTTP 400 — which it did, for a while, silently, behind a
 * genuine outage. The adapter floors what it sends the vendor now, but a
 * caller budget that aborts before the vendor's own minimum is still a
 * caller asking for something it cannot have.
 *
 * A turn that outlasts the route's twenty-second deadline is one the
 * deadline speaks to, which it now does.
 */
const DIALOGUE_BUDGET = {
  maxAttempts: 4,
  maxEstimatedCostUsd: 0.1,
  maxOutputTokens: 2_048,
  attemptTimeoutMs: 12_000,
} as const;

/**
 * The preferred dialogue model's patience when another model can take the
 * turn (CQ-VOICE-010).
 *
 * gpt-5.6-luna is now preferred (migrations 20261008120000/130000), with
 * gemini-3.5-flash-lite behind it. On the real rendered conductor request
 * at effort "none", 17 luna calls measured p50 3.2 to 3.8 s and p95 4.0 to
 * 4.3 s, and none ran longer than 4.5 s. 6 s leaves room above every call
 * seen. A luna that has not answered by then hands the turn to
 * flash-lite (healthy p95 3.4 s), which still lands inside the voice
 * route's 20 s deadline even if flash-lite takes its whole 12 s budget.
 * Before this cap, a hung first model cost the entire attempt budget and
 * then a retry of the same model.
 */
const FIRST_DIALOGUE_ATTEMPT_MS = 6_000;

/**
 * Steps whose values are always read back before they are recorded (A §13).
 *
 * Figures: an amount heard wrong is the costliest mistake a voice can make,
 * so a stated figure is read back. Only a figure, though — the key pattern
 * matched "revenue" and so held I4.revenue_state, a choice between "pre-
 * revenue is fine" and "revenue required", for a yes it did not need; the
 * person said yes, the model restated rather than decided, and Q asked the
 * same question three times (acceptance walkthrough, 2026-09-24). Hard
 * exclusions are held whatever their shape: they remove companies outright.
 */
const MATERIAL_FIGURE_PATTERN =
  /target_amount|cheque|revenue|mrr|arr|customers|valuation|round_size/i;
const MATERIAL_ANY_PATTERN = /hard_exclusions|sector_exclusions/i;

const MAX_OPEN_STEPS = 40;
/** Open steps beyond the current few carry a shortened options list. */
const FULL_OPTIONS_STEPS = 3;
const SHORT_OPTIONS = 6;
/**
 * Beyond this many open steps, a step is rendered as its question and its
 * key alone -- no options, no note.
 *
 * Every step stays listed, because hearing the whole sentence means the
 * model must be able to place a volunteered answer against a step it was
 * not asked about. But an investor journey has thirty-odd open steps, and
 * listing each with ten labelled options rendered ~30,000 characters
 * (~8,300 tokens) a turn: over the 8,000-token per-request limit of the
 * free-tier fallback model, which refused every turn with 413, so that
 * when the primary provider timed out there was no route left at all.
 * A far step's question is enough to recognise a candidate; the value is
 * validated by the owning service whatever the model saw.
 */
const OPTIONS_STEPS = 5;
/** Warnings before Q leaves the person with the form. */
const WARNINGS_BEFORE_HANDOFF = 2;
const MAX_RECENT_TURNS = 12;
const RECENT_TURN_MAX_CHARS = 600;
/**
 * All the recent turns together (CQ-QX-005). Twelve turns of six hundred
 * characters is 7,200 characters — near two thousand tokens on top of a
 * v8 prompt that is already most of a small model's request limit. The
 * conversation core now carries what the transcript used to be read
 * for (the open question, the resume target, what is on screen), so the
 * newest turns are kept whole and older ones are dropped once this is
 * spent, rather than the request being refused outright.
 */
const RECENT_TURNS_TOTAL_CHARS = 2_400;

/** The newest turns that fit the budget, oldest first. */
function recentWithinBudget(
  turns: readonly { readonly role: "person" | "q"; readonly text: string }[],
): { role: "person" | "q"; text: string }[] {
  const kept: { role: "person" | "q"; text: string }[] = [];
  let spent = 0;
  for (const turn of [...turns.slice(-MAX_RECENT_TURNS)].reverse()) {
    const text = turn.text.slice(0, RECENT_TURN_MAX_CHARS);
    if (spent + text.length > RECENT_TURNS_TOTAL_CHARS && kept.length > 0) {
      break;
    }
    kept.push({ role: turn.role, text });
    spent += text.length;
  }
  return kept.reverse();
}

/** The currency a person named while saying an amount, as the step's option key. */
function currencyFromUtterance(utterance: string): string | null {
  const said = utterance.toLowerCase();
  if (/\bsingapore dollars?\b|\bsgd\b/.test(said)) return "sgd";
  if (/\bdollars?\b|\busd\b|\bbucks\b/.test(said)) return "usd";
  if (/\bnaira\b|\bngn\b/.test(said)) return "ngn";
  if (/\bpounds?\b|\bsterling\b|\bgbp\b/.test(said)) return "gbp";
  if (/\beuros?\b|\beur\b/.test(said)) return "eur";
  if (/\bshillings?\b|\bkes\b/.test(said)) return "kes";
  if (/\brand\b|\bzar\b/.test(said)) return "zar";
  if (/\bdirhams?\b|\baed\b/.test(said)) return "aed";
  if (/\brupees?\b|\binr\b/.test(said)) return "inr";
  return null;
}

/**
 * Where a document goes when they mention one (founder walkthrough F2):
 * right here in the conversation — the typed thread and the voice stage
 * both carry an uploader now — never a detour to the company page.
 */
const UPLOAD_LINE =
  "Whenever you like, upload the deck or model right here and I'll read it; I'll carry on meanwhile.";

/**
 * Questions whose own prompt is written in the platform's vocabulary
 * rather than the person's (Workstream A).
 *
 * "Which mandate are we defining?" is a perfectly good label on a screen
 * where the drafts are listed beside it, and it is nonsense said aloud
 * to somebody who came to describe how they invest — they have never
 * heard the word used that way and there is nothing on screen to explain
 * it. Keyed by step key, so this is a presentation override for named
 * steps and not an attempt to rewrite copy by matching words in it.
 *
 * It is a fallback: the mandate step is normally resolved by the
 * platform without ever being asked (see `resolveSingleReference`), and
 * this is what Q says in the rarer case where there is a genuine choice.
 */
const PLAIN_QUESTIONS: Readonly<Record<string, string>> = {
  "I1.mandate_context":
    "Are we setting up your main investment strategy, or a different one?",
};

/**
 * What to call a step when reading a value back, rather than asking it.
 *
 * `questionFor` composes a question — "minimum cheque? Just the number
 * is fine." — which is right when Q is asking and wrong when it already
 * has the answer in hand. Here the step is a noun.
 */
function askLabel(step: OnboardingStepManifest): string {
  return (PLAIN_QUESTIONS[step.stepKey] ?? step.configuration.prompt).replace(
    /\?+$/,
    "",
  );
}

/**
 * The question Q asks when a runtime-composed line has to ask a step
 * again (a refusal, an unclear turn).
 *
 * `questionFor` reads the step's own prompt, and for the organisation
 * step that prompt is a label -- "Your firm" -- which is the cold ask this
 * whole gate exists to remove. When the person told us their organisation
 * at registration, the runtime asks the way Q would, offering that name as
 * a candidate; otherwise the step's question stands.
 */
/**
 * The thing a repair line says it is missing, as a noun phrase.
 *
 * A prompt written as a question ("Which stages do you invest at?") does
 * not read as a noun — "I'm still missing which stages do you invest at"
 * — so it is quoted as the question it is; a label ("Founding-team
 * capabilities that matter to you") is used as the noun it already is.
 */
function repairLabel(step: OnboardingStepManifest): string {
  return `your ${noun(step)}`;
}

function joinWithAnd(items: readonly string[]): string {
  return items.length <= 1
    ? (items[0] ?? "")
    : `${items.slice(0, -1).join(", ")} and ${items.at(-1) ?? ""}`;
}

/** The step as a noun, from the platform's own copy (step-copy.ts). */
function noun(step: OnboardingStepManifest): string {
  return stepNoun(step.stepKey, step.configuration.prompt);
}

function askAgain(
  step: OnboardingStepManifest,
  input: {
    readonly signup?: { readonly organisationName: string | null } | undefined;
  },
): string {
  const registered = input.signup?.organisationName ?? null;
  if (
    registered !== null &&
    /\.(organisation_name|company_name)$/.test(step.stepKey)
  ) {
    return `Are we setting things up as ${registered}, or do you go by another name?`;
  }
  return questionFor(step);
}

/**
 * The question asked again with what it can take (ACC b).
 *
 * Several steps ask in plain words ("What's your appetite for regulated
 * sectors?") rather than reading the list out, which is right the first
 * time and wrong the second: a person who did not know what to say, or
 * asked for "some options", was answered with the same words in a
 * different order and no choices. A repeated question carries its
 * choices whenever it has them and did not already say them.
 */
/**
 * Where a finished setup goes (adversarial round 2, #8): one place per
 * journey, the same one the screen's own button uses — an investor to the
 * companies they set it up to see, a founder home.
 */
function finishedDestination(journeyType: "founder" | "investor"): {
  readonly navigate: InterviewDestination;
  readonly line: string;
} {
  return journeyType === "investor"
    ? {
        navigate: "DISCOVER",
        line: "That's everything I need for now. I'm taking you to Discover.",
      }
    : {
        navigate: "HOME",
        line: "That's everything I need for now. I'm taking you to your home.",
      };
}

function askWithChoices(
  step: OnboardingStepManifest,
  input: {
    readonly signup?: { readonly organisationName: string | null } | undefined;
  },
): string {
  const question = askAgain(step, input);
  const labels = optionsOf(step)
    .map((option) => option.label)
    .slice(0, 7);
  const first = labels[0];
  if (first === undefined || question.includes(first)) return question;
  const listed =
    labels.length === 1
      ? first
      : `${labels.slice(0, -1).join(", ")} or ${labels.at(-1) ?? ""}`;
  return `${question} The choices are ${listed}.`;
}

export function questionFor(step: OnboardingStepManifest): string {
  const c = step.configuration;
  /**
   * Always a whole question (ACC round 3 #3, #4). A step whose prompt is a
   * form label ("Typical cheque") is asked in the platform's own words
   * (step-copy.ts); one whose prompt is already a question is asked as
   * written. Never "Website?" or "typical cheque? Just the number…".
   */
  const spoken =
    SPOKEN_QUESTIONS[step.stepKey] ??
    (/\?\s*$/.test(c.prompt) ? c.prompt.trim() : `What's your ${noun(step)}?`);
  const stem = spoken.replace(/[.?!]+$/, "");
  switch (c.stepType) {
    case "single_select":
    case "multi_select": {
      const labels = optionsOf(step)
        .map((o) => o.label)
        .slice(0, 7);
      return `${stem}: ${labels.join(", ")}?`;
    }
    case "range":
      return `${spoken} Just the number is fine.`;
    case "short_text":
    case "long_text":
    case "voice_text":
    case "document_upload":
    case "confirmation":
    case "reference_select":
      return spoken;
  }
}

/**
 * What Q asks its own research tools when the person names a website,
 * company or person. The query is the person's words, bounded; the tools
 * decide what may leave the platform (CQ-Q-RESEARCH-001).
 */

function lookupQuestion(
  kind: "WEBSITE" | "COMPANY" | "PERSON",
  query: string,
): string {
  // A website said aloud ("salvage bridge dot com") becomes the address
  // it names before it is looked up; the words themselves find nothing.
  const subject =
    kind === "WEBSITE"
      ? spokenUrl(query).slice(0, 200)
      : query.trim().slice(0, 200);
  if (/linkedin\.com\/(in|company)\//i.test(subject)) {
    return `Look up this public LinkedIn page with the profile lookup: ${subject}. Summarise in a few spoken sentences what it says about them (name, role or what the company does, where, size) as unverified public context for this interview, said as "their LinkedIn page says".`;
  }
  switch (kind) {
    case "WEBSITE":
      return `Look at the public website ${subject}: what the company does, who it serves, its products and anything recent. Summarise it in a few spoken sentences as unverified public context for this interview.`;
    case "COMPANY":
      return `Research the company "${subject}" on the public web: what it does, who it serves, stage, funding and anything recent. Summarise in a few spoken sentences as unverified public context for this interview.`;
    case "PERSON":
      return `Research the person "${subject}" on the public web: role, company, public posts and interests. Summarise in a few spoken sentences as unverified public context for this interview.`;
  }
}

function definitionFor(journey: "founder" | "investor") {
  return journey === "founder" ? FOUNDER_DEFINITION_V2 : INVESTOR_DEFINITION_V1;
}

function stepsByKey(journey: "founder" | "investor") {
  return new Map(
    definitionFor(journey).steps.map((step) => [step.stepKey, step]),
  );
}

function optionsOf(step: OnboardingStepManifest): readonly InterviewOption[] {
  const configuration = step.configuration;
  if (
    configuration.stepType === "single_select" ||
    configuration.stepType === "multi_select"
  ) {
    return configuration.options.map((option) => ({
      key: option.optionKey,
      label: option.label,
      description: option.description,
    }));
  }
  return [];
}

/**
 * Steps whose numbers are money.
 *
 * Read off the step key rather than off a unit, because the journey's
 * range steps carry no currency of their own — the currency is a
 * separate step, which is exactly why "50000" could be spoken as a bare
 * integer for as long as it was.
 */
const MONEY_STEP = /cheque|target_amount|valuation|round_size|revenue|mrr|arr/i;

/** The symbol for each currency the journey offers. Domain reference data. */
const CURRENCY_SYMBOLS: Readonly<Record<string, string>> = {
  usd: "$",
  eur: "€",
  gbp: "£",
  ngn: "₦",
  kes: "KSh",
  zar: "R",
  aed: "AED ",
  inr: "₹",
  sgd: "S$",
};

/**
 * A stored figure as a person would say it (Workstream A).
 *
 * Capital Q keeps the canonical number — 50000 is what goes to the
 * owning service, and nothing here changes that. This is only how the
 * same number is rendered when Q speaks or writes it, because live Q
 * said "Minimum cheque: 50000. Is that right?" at somebody, and a
 * machine reading its own database out loud is the least institutional
 * thing a product can do.
 *
 * Millions and billions are named; everything else is grouped. A figure
 * that is not a round million keeps one decimal ("1.5 million") rather
 * than becoming a seven-digit string again.
 */
export function spokenFigure(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  const say = (n: number, scale: string): string => {
    const rounded = Math.round(n * 10) / 10;
    return `${Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)} ${scale}`;
  };
  const magnitude = Math.abs(value);
  if (magnitude >= 1e9) return say(value / 1e9, "billion");
  if (magnitude >= 1e6) return say(value / 1e6, "million");
  return new Intl.NumberFormat("en-GB").format(value);
}

/** A figure with its currency in front of it, when the step is money. */
export function spokenMoney(value: number, currency: string | null): string {
  const symbol =
    currency === null ? "" : (CURRENCY_SYMBOLS[currency.toLowerCase()] ?? "");
  return `${symbol}${spokenFigure(value)}`;
}

function describeValue(
  step: OnboardingStepManifest | undefined,
  value: OnboardingResponseValue,
  /** The currency the session has recorded, for money steps. */
  currency?: string | null,
): string {
  const options = step === undefined ? [] : optionsOf(step);
  const label = (key: string) =>
    options.find((option) => option.key === key)?.label ?? key;
  switch (value.type) {
    case "SINGLE_SELECT":
      return label(value.optionKey);
    case "MULTI_SELECT":
      return value.optionKeys.map(label).join(", ");
    case "RANGE": {
      const number = Number.parseFloat(value.value);
      if (!Number.isFinite(number)) return value.value;
      return step !== undefined && MONEY_STEP.test(step.stepKey)
        ? spokenMoney(number, currency ?? null)
        : spokenFigure(number);
    }
    case "TEXT":
      return value.text.slice(0, 300);
    case "CONFIRMATION":
      return value.confirmed ? "confirmed" : "not confirmed";
    case "RESOURCE_REFERENCE":
      return `${String(value.resourceIds.length)} recorded`;
  }
}

/**
 * The currency the session holds, as the cheque steps' option key.
 *
 * Null until the currency step is answered, which is a real state and
 * not a reason to invent dollars: an unlabelled "50,000" is honest,
 * and "$50,000" against a naira mandate is not.
 */
function recordedCurrency(
  view: OnboardingSessionView,
  steps: ReadonlyMap<string, OnboardingStepManifest>,
): string | null {
  for (const response of view.responses) {
    if (!/\.currency$/.test(response.stepKey)) continue;
    if (response.value.type !== "SINGLE_SELECT") continue;
    if (steps.get(response.stepKey) === undefined) continue;
    return response.value.optionKey;
  }
  return null;
}

/**
 * A question with nothing to tap is a question somebody may need to type.
 *
 * Every question that HAS choices shows them, so the ones left are the
 * ones where only the person's own words will do: a name, a website, a
 * description, a number. Somebody on a bus is stuck there, and the stage
 * has a Type button they had no reason to look for.
 *
 * This used to be an instruction written into the step's note for the
 * model to act on ("…mention once that they can tap Type…"), and the model
 * read it out word for word (founder walkthrough F3). An instruction is
 * never speakable content: the platform says the line itself, once per
 * session, over voice, on the first such question.
 */
const TYPE_HINT = "If it's easier, you can tap Type and write it instead.";

function isTypeable(kind: InterviewOpenStep["kind"]): boolean {
  return kind === "NUMBER" || kind === "SHORT_TEXT" || kind === "LONG_TEXT";
}

function toOpenStep(
  step: OnboardingStepManifest,
  view: OnboardingSessionView,
): InterviewOpenStep | null {
  const c = step.configuration;
  const base = {
    stepKey: step.stepKey,
    question: c.prompt,
    required: step.required,
    ...(c.whyQAsks === undefined ? {} : { note: c.whyQAsks }),
  };
  switch (c.stepType) {
    case "single_select":
      return { ...base, kind: "ONE_OF", options: [...optionsOf(step)] };
    case "multi_select":
      return {
        ...base,
        kind: "MANY_OF",
        options: [...optionsOf(step)],
        maxChoices: c.maxSelections,
      };
    case "range":
      return {
        ...base,
        kind: "NUMBER",
        min: c.min,
        max: c.max,
        ...(c.unit === undefined ? {} : { unit: c.unit }),
      };
    case "short_text":
      return { ...base, kind: "SHORT_TEXT" };
    case "long_text":
    case "voice_text":
      return { ...base, kind: "LONG_TEXT" };
    case "confirmation":
      // A review of what has been gathered: Q reads it back in speech
      // before it asks, rather than asking for a "confirmation".
      return {
        ...base,
        kind: "YES_NO",
        // Yes and no, as two things a person can tap.
        //
        // A step whose whole content is "is that right?" had nothing on
        // screen to answer it with, so somebody in a noisy room, or who
        // would rather not talk, was stuck on the one question that only
        // needs a nod. The labels are what they would have said.
        options: [
          { key: "yes", label: "Yes, that's right" },
          { key: "no", label: "No, something's off" },
        ],
        note: [
          base.note,
          "This is a review of what has been gathered so far: before asking, read the key KNOWN ANSWERS back in one or two natural spoken sentences (name, what the company does, stage, where it is based, the round), then ask whether that is right.",
        ]
          .filter((n): n is string => n !== undefined)
          .join(" "),
      };
    case "document_upload":
      return {
        ...base,
        kind: "DOCUMENT",
        note: [
          base.note,
          "An upload, not a question to press: ask once what they already have (a deck, a financial model, accounts) and put whatever they say in answers for this step, whether it is a document or 'nothing yet'. Never ask this step a second time.",
        ]
          .filter((n): n is string => n !== undefined)
          .join(" "),
      };
    case "reference_select": {
      if (c.resourceType === "TAXONOMY_NODE") {
        return { ...base, kind: "CATEGORIES", maxChoices: c.maxItems };
      }
      // A reference step with server-listed candidates (an investor's
      // mandates) is a choice among them when the view carries them.
      const current = view.currentStep;
      const context =
        current !== null && current.stepKey === step.stepKey
          ? current.context
          : undefined;
      const list = context?.["candidates"];
      if (Array.isArray(list)) {
        const options: InterviewOption[] = [];
        for (const item of list) {
          if (typeof item !== "object" || item === null) continue;
          const record = item as Record<string, unknown>;
          const id = record["mandateId"] ?? record["id"];
          const name = record["name"] ?? record["label"];
          if (typeof id === "string" && typeof name === "string") {
            options.push({ key: id, label: name });
          }
        }
        if (options.length > 0) {
          return { ...base, kind: "ONE_OF", options };
        }
      }
      return null;
    }
  }
}

/**
 * A reading for a result that carries none (CQ-QX-005).
 *
 * A run recorded against an older conductor, or a test double written for
 * one, says what it took from the words in `intent` and nothing about what
 * the turn was. The conservative translation: a legacy UNCLEAR is a
 * reading the model could not place — reasoning, not hearing, because a
 * model that answered at all had words to read — and a legacy question
 * that needed looking up is a request for public facts, so that it meets
 * the research policy rather than bypassing it.
 */
export function readingFrom(
  result: InterviewConductorResult,
): ConversationTurnReading {
  // Parsed again here: a double that skips the gateway's schema carries no
  // field, or a reading without its defaults, and either would be read as
  // a turn that failed. What does not parse is treated as no reading.
  if (result.reading !== null && result.reading !== undefined) {
    const parsed = ConversationTurnReadingSchema.safeParse(result.reading);
    if (parsed.success) return parsed.data;
  }
  // A legacy per-answer MEDIUM meant "inferred", and v7 recorded those
  // outright; the reading-level confidence that holds a value for a yes
  // is a v8 judgement the old shape never made.
  const confidence: ReadingConfidence = "HIGH";
  const base = {
    confidence,
    transcript: "CLEAR" as const,
    references: [],
    qualitative: [],
    question: null,
    suggestions: [],
    tensions: [],
    clears: [],
  };
  switch (result.intent) {
    case "ANSWER":
      return { ...base, kind: "ANSWER" };
    case "OPENING":
      // Q speaking first: nothing was said, so nothing was read.
      return { ...base, kind: "CONTROL" };
    case "CORRECTION":
      return { ...base, kind: "CORRECTION" };
    case "QUESTION_FOR_Q":
      return {
        ...base,
        kind: "QUESTION_TO_Q",
        question:
          result.answerFromState === "OPTIONS"
            ? {
                kind: "OPTIONS",
                text: result.questionForQ ?? "options",
                about: [],
              }
            : result.answerFromState === "PROGRESS"
              ? {
                  kind: "PROGRESS",
                  text: result.questionForQ ?? "progress",
                  about: [],
                }
              : result.questionForQ === null
                ? {
                    kind: "ADVICE",
                    text: result.reply.slice(0, 1_000),
                    about: [],
                  }
                : {
                    kind: "PUBLIC_FACTS",
                    text: result.questionForQ,
                    about: [],
                  },
      };
    case "LOOKUP":
      return {
        ...base,
        kind: "RESEARCH_REQUEST",
        question: {
          kind: "PUBLIC_FACTS",
          text: result.lookup?.query.slice(0, 1_000) ?? "lookup",
          about: [],
        },
      };
    case "UNCLEAR":
      return { ...base, kind: "ANSWER", confidence: "LOW" };
    case "SMALL_TALK":
      return { ...base, kind: "SMALL_TALK" };
    case "OFF_TOPIC":
    case "SABOTAGE":
      return { ...base, kind: "OFF_TOPIC" };
    case "NAVIGATE":
      return { ...base, kind: "TOOL_REQUEST" };
    case "PAUSE":
    case "RESUME":
    case "THINKING":
    case "PRONOUNCE":
      return { ...base, kind: "CONTROL" };
  }
}

/** A reading as a list of strings, whatever shape the model used. */
function asList(raw: string | readonly string[] | boolean): readonly string[] {
  if (typeof raw === "string") return [raw];
  if (typeof raw === "boolean") return [];
  return raw;
}

function isMaterial(step: OnboardingStepManifest): boolean {
  if (MATERIAL_ANY_PATTERN.test(step.stepKey)) return true;
  const type = step.configuration.stepType;
  const choice =
    type === "single_select" ||
    type === "multi_select" ||
    type === "reference_select";
  return !choice && MATERIAL_FIGURE_PATTERN.test(step.stepKey);
}

const NUMBER_WORDS: Readonly<Record<string, number>> = {
  zero: 0,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  thirteen: 13,
  fourteen: 14,
  fifteen: 15,
  sixteen: 16,
  seventeen: 17,
  eighteen: 18,
  nineteen: 19,
  twenty: 20,
  thirty: 30,
  forty: 40,
  fifty: 50,
  sixty: 60,
  seventy: 70,
  eighty: 80,
  ninety: 90,
};
const SCALE_WORDS: Readonly<Record<string, number>> = {
  hundred: 100,
  thousand: 1e3,
  k: 1e3,
  million: 1e6,
  m: 1e6,
  billion: 1e9,
  b: 1e9,
};

/**
 * A number as a person says it: "four", "twenty five", "three hundred
 * million", "1.5 million", "300m". The recogniser writes small numbers
 * as words as often as not, and "four" read as no number at all was a
 * team-size question asked twice (2026-09-17). Digits and words may mix;
 * a word that is none of these ends the reading.
 */
function spokenNumber(text: string): number | null {
  const tokens = text
    .toLowerCase()
    .replace(/[,$€£₦]/g, "")
    .replace(/-/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 0);
  let total = 0;
  let current = 0;
  let sawNumber = false;
  for (const token of tokens) {
    if (/^\d+(?:\.\d+)?$/.test(token)) {
      current += Number.parseFloat(token);
      sawNumber = true;
      continue;
    }
    const digitsWithScale = /^(\d+(?:\.\d+)?)([kmb])$/.exec(token);
    if (digitsWithScale !== null) {
      current += Number.parseFloat(digitsWithScale[1] ?? "0");
      const scale = SCALE_WORDS[digitsWithScale[2] ?? ""] ?? 1;
      total += current * scale;
      current = 0;
      sawNumber = true;
      continue;
    }
    const word = NUMBER_WORDS[token];
    if (word !== undefined) {
      current += word;
      sawNumber = true;
      continue;
    }
    const scale = SCALE_WORDS[token];
    if (scale !== undefined && sawNumber) {
      if (scale === 100) {
        current = (current === 0 ? 1 : current) * 100;
      } else {
        total += (current === 0 ? 1 : current) * scale;
        current = 0;
      }
      continue;
    }
    if (
      token === "and" ||
      token === "a" ||
      token === "about" ||
      token === "just" ||
      token === "around"
    ) {
      continue;
    }
    if (sawNumber) {
      break;
    }
  }
  if (!sawNumber) return null;
  const value = total + current;
  return Number.isFinite(value) ? value : null;
}

function asNumberString(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value !== "string") {
    return null;
  }
  const number = spokenNumber(value);
  return number === null ? null : String(number);
}

/**
 * A web address as a person says it: "savage bridge dot com", "www dot
 * vaultlyne dot com", "https://x.io". Spoken words become the host, and a
 * bare host gets the scheme the profile expects. Live, "Savage Bridge dot
 * com" was recorded as the company's website, letter for letter.
 */
export function spokenUrl(text: string): string {
  let host = text
    .trim()
    .toLowerCase()
    .replace(/[.!?,;:]+$/g, "")
    .replace(/\s*\b(?:dot|d0t)\b\s*/g, ".")
    .replace(/\s+(?:slash)\s+/g, "/")
    .replace(/^(?:https?:\/\/)?(?:www\.)?/, "")
    .replace(/\s+/g, "");
  host = host.replace(/\.{2,}/g, ".").replace(/^\.|\.$/g, "");
  return host.length === 0 ? text.trim() : `https://${host}`;
}

/** A model reading → the step's own value, or null when it does not fit. */
function toResponseValue(
  step: OnboardingStepManifest,
  raw: string | readonly string[] | boolean,
): OnboardingResponseValue | null {
  const c = step.configuration;
  const options = optionsOf(step);
  /**
   * The option a phrase names. Exact key or label first; then a label
   * whose words are all in the phrase ("pitch deck" in "the pitch deck we
   * have"); then a phrase that is plainly one of the catch-alls. Live, a
   * model wrote "demo" for a step whose options are deck, model, accounts,
   * profile, other and nothing yet, and the answer was dropped without a
   * word, so the question came round again twice.
   */
  const keyOf = (text: string): string | null => {
    const wanted = text.trim().toLowerCase();
    if (wanted.length === 0) return null;
    const exact = options.find(
      (option) =>
        option.key.toLowerCase() === wanted ||
        option.label.toLowerCase() === wanted,
    );
    if (exact !== undefined) return exact.key;
    const words = (s: string) =>
      s
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((w) => w.length > 0);
    const phrase = new Set(words(wanted));
    const byLabel = options.find((option) => {
      const label = words(option.label);
      return label.length > 0 && label.every((w) => phrase.has(w));
    });
    if (byLabel !== undefined) return byLabel.key;
    if (
      /\b(?:nothing|none|no|not yet|don't have|dont have|haven't)\b/.test(
        wanted,
      )
    ) {
      const none = options.find((o) => /^(?:nothing|none)/i.test(o.key));
      if (none !== undefined) return none.key;
    }
    const other = options.find((o) => /^other$/i.test(o.key));
    return other?.key ?? null;
  };
  switch (c.stepType) {
    case "single_select": {
      const key = typeof raw === "string" ? keyOf(raw) : null;
      return key === null ? null : { type: "SINGLE_SELECT", optionKey: key };
    }
    case "multi_select": {
      const list = asList(raw);
      const keys = [
        ...new Set(list.map(keyOf).filter((k): k is string => k !== null)),
      ];
      if (keys.length === 0) return null;
      const exclusive = new Set(c.exclusiveOptionKeys);
      const chosen = keys.some((k) => exclusive.has(k))
        ? keys.filter((k) => exclusive.has(k)).slice(0, 1)
        : keys.slice(0, c.maxSelections);
      return { type: "MULTI_SELECT", optionKeys: chosen };
    }
    case "range": {
      const number = asNumberString(raw);
      if (number === null) return null;
      const n = Number.parseFloat(number);
      if (n < Number.parseFloat(c.min) || n > Number.parseFloat(c.max)) {
        return null;
      }
      return { type: "RANGE", value: number };
    }
    case "short_text":
    case "long_text":
    case "voice_text": {
      const spoken =
        typeof raw === "string"
          ? raw.trim()
          : Array.isArray(raw)
            ? raw.join(", ")
            : "";
      // A website said aloud is words; the profile wants an address.
      const text = /\.website$/.test(step.stepKey) ? spokenUrl(spoken) : spoken;
      const max = c.stepType === "short_text" ? c.maxLength : c.maxLength;
      if (text.length === 0 || text.length > max) return null;
      return { type: "TEXT", text };
    }
    case "confirmation":
      if (typeof raw === "boolean") {
        return { type: "CONFIRMATION", confirmed: raw };
      }
      if (
        typeof raw === "string" &&
        /^(?:yes|true|confirmed?|right)$/i.test(raw.trim())
      ) {
        return { type: "CONFIRMATION", confirmed: true };
      }
      return null;
    case "reference_select": {
      if (c.resourceType === "TAXONOMY_NODE") return null;
      const list = asList(raw);
      const ids = list
        .filter((id) => /^[0-9a-f-]{36}$/i.test(id))
        .slice(0, c.maxItems);
      return ids.length === 0
        ? null
        : {
            type: "RESOURCE_REFERENCE",
            resourceType: c.resourceType,
            resourceIds: ids,
          };
    }
    case "document_upload":
      return null;
  }
}

/**
 * What "no restriction" means for one step (Workstream A).
 *
 * The model reads that somebody placed no restriction on something —
 * "everywhere on the planet", "it can be anyone", "we don't mind". What
 * that IS depends entirely on the step, and the step is the platform's
 * to read, not the model's:
 *
 * - A multi-select whose options are the whole range of an answer
 *   (lead, co-invest, follow) records no preference as all of them.
 *   "It can be anyone" is a real, recordable answer there.
 * - A single-select whose vocabulary already contains a no-preference
 *   code records that code. `any` is a canonical option key in the
 *   Investor constraint registry, not a word matched in prose.
 * - A taxonomy step records no restriction as no entries: the journey
 *   itself says "leave empty for anywhere". There is no node for
 *   everywhere, so a list is the wrong shape and SET_ASIDE is the
 *   journey's own way of saying it.
 *
 * Anything else — a required free-text answer, a number — genuinely
 * cannot represent it, and the honest outcome is to ask.
 */
type UnrestrictedOutcome =
  | { readonly kind: "VALUE"; readonly value: OnboardingResponseValue }
  | { readonly kind: "SET_ASIDE" }
  | { readonly kind: "CANNOT" };

export function unrestrictedOutcome(
  step: OnboardingStepManifest,
): UnrestrictedOutcome {
  const c = step.configuration;
  switch (c.stepType) {
    case "multi_select": {
      const keys = c.options
        .map((option) => option.optionKey)
        .filter((key) => !c.exclusiveOptionKeys.includes(key))
        .slice(0, c.maxSelections);
      return keys.length === 0
        ? { kind: "CANNOT" }
        : { kind: "VALUE", value: { type: "MULTI_SELECT", optionKeys: keys } };
    }
    case "single_select": {
      const none = c.options.find((option) => option.optionKey === "any");
      return none === undefined
        ? { kind: "CANNOT" }
        : {
            kind: "VALUE",
            value: { type: "SINGLE_SELECT", optionKey: none.optionKey },
          };
    }
    case "reference_select":
      // Every reference step in the journey is optional and means
      // "anything" when empty. A required one would be a different
      // decision, and the journey does not have one.
      return step.required ? { kind: "CANNOT" } : { kind: "SET_ASIDE" };
    case "range":
    case "short_text":
    case "long_text":
    case "voice_text":
    case "document_upload":
      // "No website yet", "we don't have a deck": for an optional step
      // that is an honest answer and the journey's skip records it; asking
      // again would be asking for something they said does not exist
      // (founder round 2, c). A required one still has to be asked.
      return step.required ? { kind: "CANNOT" } : { kind: "SET_ASIDE" };
    case "confirmation":
      return { kind: "CANNOT" };
  }
}

/**
 * A cheque figure that contradicts one already on the record
 * (Workstream A).
 *
 * "Maximum cheque is one hundred" against a minimum of fifty thousand is
 * not a maximum, it is a scale that was never said. The model is asked
 * to mark that as SCALE_UNCLEAR, and usually does; this is the
 * deterministic half, because a guessed magnitude is one of the few
 * mistakes here that silently changes who an investor is shown.
 *
 * The domain invariant is the check — minimum ≤ typical ≤ maximum —
 * rather than any threshold anybody invented. It never guesses the
 * intended value; it only says the pair cannot both be right.
 */
const CHEQUE_ORDER = ["cheque_min", "cheque_typical", "cheque_max"] as const;

/** The recorded cheque a figure contradicts, if any (see below). */
export function chequeConflict(
  stepKey: string,
  value: OnboardingResponseValue,
  recorded: ReadonlyMap<string, number>,
): { readonly stepKey: string; readonly amount: number } | null {
  if (value.type !== "RANGE") return null;
  const suffix = stepKey.split(".").at(-1);
  const position = CHEQUE_ORDER.indexOf(
    suffix as (typeof CHEQUE_ORDER)[number],
  );
  if (position < 0) return null;
  const proposed = Number.parseFloat(value.value);
  if (!Number.isFinite(proposed)) return null;
  const prefix = stepKey.slice(0, stepKey.length - (suffix?.length ?? 0));
  for (const [index, name] of CHEQUE_ORDER.entries()) {
    if (index === position) continue;
    const other = recorded.get(`${prefix}${name}`);
    if (other === undefined) continue;
    if (
      (index < position && proposed < other) ||
      (index > position && proposed > other)
    ) {
      return { stepKey: `${prefix}${name}`, amount: other };
    }
  }
  return null;
}

export function chequeContradiction(
  stepKey: string,
  value: OnboardingResponseValue,
  recorded: ReadonlyMap<string, number>,
): boolean {
  if (value.type !== "RANGE") return false;
  const suffix = stepKey.split(".").at(-1);
  const position = CHEQUE_ORDER.indexOf(
    suffix as (typeof CHEQUE_ORDER)[number],
  );
  if (position < 0) return false;
  const proposed = Number.parseFloat(value.value);
  if (!Number.isFinite(proposed)) return false;
  const prefix = stepKey.slice(0, stepKey.length - (suffix?.length ?? 0));
  for (const [index, name] of CHEQUE_ORDER.entries()) {
    if (index === position) continue;
    const other = recorded.get(`${prefix}${name}`);
    if (other === undefined) continue;
    if (index < position && proposed < other) return true;
    if (index > position && proposed > other) return true;
  }
  return false;
}

export function createInterviewer(dependencies: InterviewerDependencies) {
  const registry = dependencies.registry ?? createDefaultPromptRegistry();
  const { gateway, logger } = dependencies;
  const pendingBySession = new Map<string, Pending[]>();

  const pendingFor = (sessionId: string) =>
    pendingBySession.get(sessionId) ?? [];
  const warningsBySession = new Map<string, number>();
  /**
   * The conversation itself, per session (CQ-QX-005 §16).
   *
   * What Q asked and the options it showed, a question of theirs being
   * answered, where to resume, Q's own suggestions awaiting a yes, the
   * research task in flight, which subsystem has failed and how often,
   * and which repair rungs have been used on the topic in hand. One
   * value, reduced by the conversation core; the six unrelated maps it
   * replaces were each right and together could not tell a question
   * from a failed answer.
   *
   * The session's `currentStepKey` is where the journey is; `asked` is
   * what Q actually put in front of the person, which is what "the
   * second one" refers to and what a volunteered sentence answers.
   */
  const conversationBySession = new Map<string, ConversationState>();
  /** Sessions that have heard the Type hint (once each, voice only). */
  const typeHintGiven = new Set<string>();
  /**
   * The values Q's own last reply put forward, per step (v10 `offered`),
   * so "the second number you said" and "go with what you said" resolve
   * against what Q actually said (CQ-QX-005 round 2, #9 and #3).
   */
  const offeredBySession = new Map<
    string,
    readonly {
      readonly target: string;
      readonly values: readonly (string | readonly string[] | boolean)[];
    }[]
  >();
  /**
   * Category phrases heard before they could be placed (adversarial
   * round 2, #1): "I only do Côte d'Ivoire and Senegal" in the very first
   * sentence, before the organisation existed, when the platform's own
   * lookup could not yet run for this person. The words are kept and put
   * through the lookup again on every later turn until they land.
   */
  const phrasesBySession = new Map<
    string,
    { readonly stepKey: string; readonly phrases: readonly string[] }[]
  >();
  /**
   * Meaning kept beside a field, per session (CQ-QX-005 §3).
   *
   * "As long as they've got the grit" sets no option and is not no
   * preference. What it meant is held here in the person's words, rendered
   * to the model every turn so Q never reduces them to the list, and
   * written as the response's own `note` the moment a value for that step
   * goes on the record.
   */
  const qualitativeBySession = new Map<string, QualitativeMeaning[]>();
  /**
   * What the person said that the runtime did NOT record, per session
   * (QX-004 core gate: state authority).
   *
   * The conversation is not the record, and the two came apart live:
   * every provider was down, three answers went nowhere, and on the next
   * turn Q reported "we have your type, which is Angel, and your firm,
   * Zino Aviation" — read out of its own memory of the turns, against a
   * session holding nothing at all.
   *
   * The model needs the transcript to reason with, so taking it away is
   * the wrong fix. Telling it the truth is the right one: these go into
   * the prompt's `notes`, which say what was said and not kept, and the
   * charter says what that means. An entry is dropped as soon as the
   * session shows the step recorded, because by then it is no longer
   * true.
   */
  const unrecordedBySession = new Map<
    string,
    { readonly stepKey: string | null; readonly said: string }[]
  >();
  // Asides since the last recorded answer: the first two are answered in
  // full, later ones steer back (the prompt reads the count).
  const tangentsBySession = new Map<string, number>();
  /**
   * What the person has told Q that the journey has not taken yet
   * (Workstream A — the carry-forward ledger).
   *
   * This is the fix for the behaviour that made the interview feel like
   * a form. A sentence answers four things; the journey will accept one
   * of them today, because the rest have prerequisites or are not yet
   * eligible; and every version until now simply dropped the other
   * three. So the same questions came round later, and the person had
   * to say it all again, and Q looked like it had not been listening.
   *
   * A candidate is a validated, step-shaped value that has not been
   * recorded. It is NOT a record and Q may never say it is saved — the
   * whole point of the separation is that KNOWN ANSWERS stays the only
   * proof of what is held. Every turn, the ledger is offered to the
   * owning service again through the ordinary validated submit; whatever
   * it accepts becomes a real answer and leaves the ledger, and whatever
   * it still refuses waits for the next turn.
   */
  const carriedBySession = new Map<string, Candidate[]>();
  const personality = personalityOf(dependencies.personality);
  /**
   * What is remembered, for this turn. A failed recall is an empty
   * memory; the interview goes on without its past rather than not at
   * all.
   */
  const recallMemory = async (attribution: {
    readonly tenantId: string;
    readonly userId: string;
  }): Promise<string> => {
    const port = dependencies.memory;
    if (port === undefined) return "";
    try {
      return (await port.recallText(attribution)).slice(0, 4_000);
    } catch (error: unknown) {
      logger.warn({ err: error }, "memory was not recalled for the interview");
      return "";
    }
  };
  const expressive = dependencies.expressive ?? false;

  /** Remember that something was said and not kept. Bounded. */
  const noteUnrecorded = (
    sessionId: string,
    stepKey: string | null,
    said: string,
  ): void => {
    const held = unrecordedBySession.get(sessionId) ?? [];
    unrecordedBySession.set(
      sessionId,
      [...held, { stepKey, said: said.trim().slice(0, 200) }].slice(-4),
    );
  };

  /**
   * The notes for this turn: what was said and not kept, minus anything
   * the session has since recorded. Stated plainly, because the whole
   * point is that the model reads it as fact rather than inferring the
   * opposite from the transcript.
   */
  const notesFor = (
    sessionId: string,
    view: OnboardingSessionView,
  ): readonly string[] => {
    const held = unrecordedBySession.get(sessionId) ?? [];
    const kept = held.filter(
      (item) =>
        item.stepKey === null ||
        !view.responses.some((r) => r.stepKey === item.stepKey),
    );
    unrecordedBySession.set(sessionId, kept);
    return kept.map(
      (item) =>
        `They said "${item.said}" and it was NOT recorded; it is not on the session.`,
    );
  };

  /**
   * The sign-up details, as notes, while they are still unanswered.
   *
   * Dropped the moment the step they would answer is on the record: a
   * candidate for something already settled is noise, and worse, an
   * invitation to ask again.
   */
  const signupNotes = (
    input: InterviewTurnInput,
    view: OnboardingSessionView,
    steps: ReadonlyMap<string, OnboardingStepManifest>,
  ): readonly string[] => {
    const signup = input.signup;
    if (signup === undefined) return [];
    const answered = new Set(view.responses.map((r) => r.stepKey));
    const notes: string[] = [];

    const organisationKey = [...steps.keys()].find((key) =>
      /\.(organisation_name|company_name)$/.test(key),
    );
    if (
      signup.organisationName !== null &&
      organisationKey !== undefined &&
      !answered.has(organisationKey)
    ) {
      notes.push(
        `They registered with "${signup.organisationName}". Offer it for ${organisationKey} rather than asking cold — ask whether that is the organisation being set up here, or whether they act through another one. It is a candidate, not an answer: record it only once they confirm.`,
      );
    }
    if (signup.displayName !== null) {
      notes.push(
        `They registered as "${signup.displayName}". Use that name; confirm it only if something suggests it is wrong.`,
      );
    }
    return notes;
  };

  /**
   * What the public web said, as something Q found rather than
   * something Capital Q knows (Workstream C interface).
   *
   * Rendered as notes and nothing else. The model cannot turn a note
   * into a record — only `answers` reach the submit path, and every
   * answer is still validated against its step — so this is prose to
   * speak from, offered and confirmable, never asserted.
   *
   * A finding pointed at an investor's mandate step is dropped here
   * rather than rewritten: Declared Mandate is not Q Inference, and the
   * safe rendering of a mandate finding is no rendering at all. What is
   * left is the honest analyst's version — what the site presents, and
   * what was looked for and not found — which the person then tells Q
   * the truth about.
   */
  const researchNotes = (
    input: InterviewTurnInput,
    view: OnboardingSessionView,
  ): readonly string[] => {
    const research = input.research;
    if (research === undefined) return [];
    const answered = new Set(view.responses.map((r) => r.stepKey));
    const notes: string[] = [];
    for (const finding of research.findings.slice(0, 3)) {
      if (finding.stepKey !== null && answered.has(finding.stepKey)) continue;
      if (finding.stepKey !== null && MANDATE_PHASE.test(finding.stepKey)) {
        continue;
      }
      const where = finding.domains[0];
      notes.push(
        `Found on the public web${where === undefined ? "" : ` (${where})`}: "${finding.statement.slice(0, 200)}". It is unverified and it is NOT on their record. Offer it in your own words as something you found and ask whether it is right; never state it as fact.`,
      );
    }
    for (const absence of research.absences.slice(0, 2)) {
      notes.push(
        `Looked for ${absence.code} on the public web and found nothing. That says something about the web, not about them: it is not a gap, not a doubt and not a criterion. Mention it only if it makes the conversation more natural, and never as a shortcoming.`,
      );
    }
    return notes.slice(0, 3);
  };

  /**
   * What Q asked last turn, as a note the model can act on.
   *
   * Only when it differs from the session's current step: saying it twice
   * where they agree is noise, and the interesting case is exactly where
   * they disagree.
   */
  const askedNote = (
    state: ConversationState,
    view: OnboardingSessionView,
  ): readonly string[] => {
    const asked = state.asked;
    if (asked === null) return [];
    if (asked.topic === view.session.currentStepKey) return [];
    if (view.responses.some((r) => r.stepKey === asked.topic)) return [];
    return [
      `Last turn you asked them: "${asked.question}" (step ${asked.topic}). Unless they have plainly changed the subject, what they just said answers THAT step, not the session's current one.`,
    ];
  };

  /**
   * What is on their screen, numbered, for the model to point at
   * (CQ-QX-005 §5). Positions are one-based because that is how a person
   * counts ("the second one"), and the platform resolves them back.
   */
  const askedBlock = (state: ConversationState): string => {
    const asked = state.asked;
    if (asked === null) return "(nothing is on screen)";
    const lines = asked.options
      .slice(0, 24)
      .map((option, index) => `${String(index + 1)}. ${option.label}`);
    return [`${asked.topic}: ${asked.question}`, ...lines].join("\n");
  };

  /**
   * The platform's own account of the exchange, as trusted text
   * (CQ-QX-005 §16). Everything here is runtime state the model cannot
   * infer from a transcript: which question of theirs is being answered
   * and where to return to, what Q has suggested and is waiting on, what
   * meaning is kept beside a field, and which subsystem is down — so
   * that Q neither promises a look-up nothing will run nor blames the
   * person for a failure that was Q's.
   */
  const conversationBlock = (
    state: ConversationState,
    sessionId: string,
    steps: ReadonlyMap<string, OnboardingStepManifest>,
    researchAvailable: boolean,
  ): string => {
    const lines: string[] = [];
    const resume = state.research?.resumeTopic ?? state.resumeTopic;
    if (resume !== null && resume !== undefined) {
      const step = steps.get(resume);
      if (step !== undefined) {
        lines.push(
          `OPEN QUESTION TO RETURN TO after answering them: ${askLabel(step)} (${resume}).`,
        );
      }
    }
    if (state.answering !== null) {
      lines.push(
        `You are answering their question (${state.answering.kind}): "${state.answering.text.slice(0, 200)}".`,
      );
    }
    for (const proposal of state.proposals.slice(0, 4)) {
      const step = steps.get(proposal.target);
      lines.push(
        `YOUR SUGGESTION, awaiting their yes, not theirs and not recorded: ${step === undefined ? proposal.target : askLabel(step)} — ${describeSuggested(step, proposal.value)} (because ${proposal.because.slice(0, 120)}). Decide it in confirmations under ${proposal.target} only if they say so.`,
      );
    }
    for (const kept of (qualitativeBySession.get(sessionId) ?? []).slice(-4)) {
      const step = steps.get(kept.target);
      lines.push(
        `MEANING KEPT beside ${step === undefined ? kept.target : askLabel(step)}, in their words: "${kept.meaning.slice(0, 200)}". Honour it; do not reduce it to the list or ask for it again.`,
      );
    }
    if (!researchAvailable || isExhausted(state.failures, "RESEARCH")) {
      lines.push(
        "Live public research is NOT reachable right now: put nothing in questionForQ and never promise to look something up. Answer the question now from what you know — as your general knowledge, not verified current fact — say in a few words that live sources are out of reach, then return to the open question.",
      );
    } else if (state.research !== null) {
      lines.push("A research run is already in flight; do not start another.");
    }
    if (state.repair !== null && state.repair.used.length > 0) {
      const step = steps.get(state.repair.topic);
      lines.push(
        `You have already asked ${step === undefined ? state.repair.topic : askLabel(step)} ${String(state.repair.used.length)} time(s) without placing an answer; if they answer it again, read it generously and say what you would take it to mean.`,
      );
    }
    return lines.length === 0 ? "(nothing to note)" : lines.join("\n");
  };

  /** A suggested value in the step's own labels, for reading it back. */
  const describeSuggested = (
    step: OnboardingStepManifest | undefined,
    value: string | readonly string[] | boolean,
  ): string => {
    if (typeof value === "boolean") return value ? "yes" : "no";
    const options = step === undefined ? [] : optionsOf(step);
    const label = (key: string) =>
      options.find((o) => o.key === key || o.label === key)?.label ?? key;
    return (typeof value === "string" ? [value] : value)
      .map(label)
      .join(", ")
      .slice(0, 200);
  };

  /**
   * Record the one candidate a reference step offers, if it offers one.
   *
   * Returns the session as it stands afterwards. A refusal is not an
   * error worth surfacing — the step simply stays open and Q asks it in
   * plain words — so the original view is returned and the interview
   * carries on.
   */
  const resolveSingleReference = async (
    input: InterviewTurnInput,
    view: OnboardingSessionView,
  ): Promise<OnboardingSessionView> => {
    const current = view.currentStep;
    if (current === null || current === undefined) return view;
    if (current.presentation.stepType !== "reference_select") return view;
    const context = current.context;
    if (context === undefined) return view;
    const suggested = context["suggestedMandateId"];
    if (typeof suggested !== "string" || suggested.length === 0) return view;
    const resourceType = current.presentation.resourceType;
    if (resourceType === "TAXONOMY_NODE") return view;
    try {
      return await submitOnboardingResponse(
        input.session,
        input.onboardingSessionId,
        {
          stepKey: current.stepKey,
          response: {
            value: {
              type: "RESOURCE_REFERENCE",
              resourceType,
              resourceIds: [suggested],
            },
          },
          expectedSessionVersion: view.session.version,
        },
        randomUUID(),
      );
    } catch (error: unknown) {
      logger.warn(
        { err: error, stepKey: current.stepKey },
        "the single reference candidate was not accepted; Q will ask instead",
      );
      return view;
    }
  };

  /** Put a validated value in the ledger, or refresh the one already there. */
  const carry = (sessionId: string, candidate: Candidate): void => {
    const held = carriedBySession.get(sessionId) ?? [];
    const without = held.filter((item) => item.stepKey !== candidate.stepKey);
    carriedBySession.set(
      sessionId,
      [...without, candidate].slice(-MAX_CARRIED),
    );
  };

  /** Drop a step from the ledger: it is settled, one way or another. */
  const stopCarrying = (sessionId: string, stepKey: string): void => {
    const held = carriedBySession.get(sessionId);
    if (held === undefined) return;
    carriedBySession.set(
      sessionId,
      held.filter((item) => item.stepKey !== stepKey),
    );
  };

  /**
   * Everything still worth carrying, with what the session has settled
   * taken out.
   *
   * A candidate whose step is now COMPLETED or SKIPPED is not carried:
   * it is answered, and telling the model otherwise would invite Q to
   * raise something the person has finished with. This is the same
   * discipline as `notesFor` — the platform's own state decides, every
   * turn, and nothing accumulates because it was once true.
   */
  const carriedFor = (
    sessionId: string,
    view: OnboardingSessionView,
  ): readonly Candidate[] => {
    const held = carriedBySession.get(sessionId) ?? [];
    const settled = new Set(
      view.progress.eligibleSteps
        .filter((s) => s.status === "COMPLETED" || s.status === "SKIPPED")
        .map((s) => s.stepKey),
    );
    for (const response of view.responses) settled.add(response.stepKey);
    const kept = held.filter(
      (item) =>
        !settled.has(item.stepKey) && item.attempts < MAX_CANDIDATE_ATTEMPTS,
    );
    carriedBySession.set(sessionId, kept);
    return kept;
  };

  return {
    /** Forget conversational state for a session (it ended). */
    forget: (sessionId: string) => {
      pendingBySession.delete(sessionId);
      warningsBySession.delete(sessionId);
      unrecordedBySession.delete(sessionId);
      tangentsBySession.delete(sessionId);
      carriedBySession.delete(sessionId);
      conversationBySession.delete(sessionId);
      qualitativeBySession.delete(sessionId);
      typeHintGiven.delete(sessionId);
      phrasesBySession.delete(sessionId);
      offeredBySession.delete(sessionId);
    },

    /**
     * How a research run the caller carried away ended (CQ-QX-005 §7,
     * §13). The interviewer started it through its outcome and cannot
     * see it finish; the caller says, so that the failure ledger counts
     * a research route that is down and the policy stops sending people
     * to it.
     */
    researchEnded: (sessionId: string, ok: boolean) => {
      const state = conversationBySession.get(sessionId);
      if (state === undefined) return;
      conversationBySession.set(
        sessionId,
        reduceConversation(
          reduceConversation(
            reduceConversation(state, { type: "RESEARCH_FINISHED" }),
            { type: "QUESTION_ANSWERED" },
          ),
          ok
            ? { type: "SUCCEEDED", operation: "RESEARCH" }
            : { type: "FAILED", operation: "RESEARCH" },
        ),
      );
    },

    /** The conversation as the core holds it, for tests and traces. */
    conversation: (sessionId: string): ConversationState =>
      conversationBySession.get(sessionId) ?? INITIAL_CONVERSATION_STATE,

    turn: async (input: InterviewTurnInput): Promise<InterviewTurnOutcome> => {
      const steps = stepsByKey(input.journeyType);
      const sessionId = input.onboardingSessionId;
      /**
       * The conversation, reduced as the turn goes (CQ-QX-005 §16).
       *
       * Every change of state is an event through the core's reducer, so
       * what the turn did to the conversation is the list of events it
       * raised — inspectable, and impossible to advance by accident.
       */
      let conversation = reduceConversation(
        conversationBySession.get(sessionId) ?? INITIAL_CONVERSATION_STATE,
        { type: "TURN_STARTED" },
      );
      const dispatch = (event: ConversationEvent): void => {
        conversation = reduceConversation(conversation, event);
        conversationBySession.set(sessionId, conversation);
      };
      conversationBySession.set(sessionId, conversation);
      /**
       * Research needs a transport that can carry a question away and
       * bring an answer back; both have one (see `research` above). The
       * policy is told whether the deployment can research at all.
       */
      const researchAvailable = dependencies.research?.available() ?? true;
      /**
       * The interview thread, kept server-side so a reload redraws it
       * (CQ-QX-006; adversarial round 1, #7). One exchange per turn — what
       * the person said and what Q said back — under one reference, so a
       * retry writes nothing twice. Best effort and never awaited by the
       * turn: a thread that failed to save is a worse reload, never a
       * lost answer. Q's words are stored as written; delivery cues for
       * speech are not part of them.
       */
      const keepThread = (
        said: string,
        stepAsked: string | null,
        stepNext: string | null,
      ): void => {
        const channel: "VOICE" | "TEXT" =
          input.channel === "voice" ? "VOICE" : "TEXT";
        const person = input.utterance
          .trim()
          .slice(0, ONBOARDING_TEXT_MAX_LENGTH);
        const q = said.trim().slice(0, ONBOARDING_TEXT_MAX_LENGTH);
        const turns = [
          ...(person.length === 0
            ? []
            : [
                {
                  role: "PERSON" as const,
                  text: person,
                  channel,
                  ...(stepAsked === null ? {} : { stepKey: stepAsked }),
                },
              ]),
          ...(q.length === 0
            ? []
            : [
                {
                  role: "Q" as const,
                  text: q,
                  channel,
                  ...(stepNext === null ? {} : { stepKey: stepNext }),
                },
              ]),
        ];
        if (turns.length === 0) return;
        void appendOnboardingInterviewTurns(
          input.session,
          input.onboardingSessionId,
          { turnRef: randomUUID(), turns },
        ).catch((error: unknown) => {
          logger.warn(
            { err: error },
            "the interview thread did not keep this exchange",
          );
        });
      };
      /**
       * A typed research run is carried by the surface, which answers it
       * before the person can type again and never reports back here. So
       * the next typed turn is proof it ended: without this the run would
       * look in flight forever and no second question could be looked up.
       */
      if (input.channel === "text" && conversation.research !== null) {
        dispatch({ type: "RESEARCH_FINISHED" });
        dispatch({ type: "QUESTION_ANSWERED" });
      }
      // Independent of the view and authorised by the same attribution, so
      // it is read while the view is fetched rather than after it (CQ-VOICE-010:
      // a spoken turn waits on every sequential read before Q can speak).
      // Never rejects: a failed recall is an empty memory.
      const memory = recallMemory(input.attribution);
      let view = await getOnboardingSession(
        input.session,
        input.onboardingSessionId,
      );
      /**
       * The question in front of the person when they spoke: what Q asked
       * last, or — before Q has asked anything this session — the step the
       * screen is showing. Only this can be "asked differently".
       */
      const inFrontAtStart =
        conversation.asked?.topic ?? view.currentStep?.stepKey ?? null;
      /** The journey's own current step when they spoke. */
      const currentAtStart = view.currentStep?.stepKey ?? null;

      /**
       * A choice with exactly one candidate is not a question
       * (Workstream A).
       *
       * The investor journey requires a mandate to be selected before
       * anything in I2 can be written, and it is a reference step whose
       * candidates only exist on the view while it is the current step.
       * So the model cannot answer it — it has no identifier to give —
       * and the conversation stalls there while every cheque, stage and
       * geography behind it is refused for wanting it. That is the
       * prerequisite cascade behind most of the lost answers in the
       * QX-004 transcripts.
       *
       * The journey itself says when there is nothing to choose:
       * `suggestedMandateId` is its own field, documented as set when
       * exactly one draft exists and can be preselected. That is the
       * platform's authority, not a guess made here, so the platform
       * acts on it, records it through the ordinary submit under the
       * person's own token, and the person is never asked a question
       * about an internal concept they have no way to answer.
       */
      view = await resolveSingleReference(input, view);

      const statuses = new Map(
        view.progress.eligibleSteps.map((s) => [s.stepKey, s.status]),
      );
      const openSteps: InterviewOpenStep[] = [];
      const compact = (open: InterviewOpenStep): InterviewOpenStep => {
        if (openSteps.length < FULL_OPTIONS_STEPS) return open;
        const { note: _note, ...rest } = open;
        if (rest.options === undefined) {
          return rest;
        }
        if (openSteps.length >= OPTIONS_STEPS) {
          const { options, ...bare } = rest;
          return { ...bare, moreOptions: options.length };
        }
        if (rest.options.length <= SHORT_OPTIONS) {
          return rest;
        }
        return {
          ...rest,
          options: rest.options
            .slice(0, SHORT_OPTIONS)
            .map(({ key, label }) => ({ key, label })),
          moreOptions: rest.options.length - SHORT_OPTIONS,
        };
      };
      for (const step of definitionFor(input.journeyType).steps) {
        const status = statuses.get(step.stepKey);
        if (
          status === undefined ||
          status === "COMPLETED" ||
          status === "SKIPPED"
        ) {
          continue;
        }
        const open = toOpenStep(step, view);
        if (open !== null) openSteps.push(compact(open));
        if (openSteps.length >= MAX_OPEN_STEPS) break;
      }
      const currency = recordedCurrency(view, steps);
      const knownAnswers = view.responses.map((r) => {
        const step = steps.get(r.stepKey);
        return {
          stepKey: r.stepKey,
          question: step?.configuration.prompt ?? r.stepKey,
          // Rendered the way Q would say it, so that a model echoing a
          // held figure echoes "£50,000" and never "50000". Canonical
          // numbers stay canonical where they matter — in the value that
          // goes to the owning service.
          value: describeValue(step, r.value, currency),
        };
      });
      const carried = carriedFor(input.onboardingSessionId, view);
      const pending = pendingFor(input.onboardingSessionId);
      // Proposals lifted from the person's documents, still unconfirmed and
      // not already held by Q: Q reads them back like its own readings.
      const proposals = view.pendingSuggestions.filter(
        (p) =>
          p.status === "PENDING" &&
          !pending.some((held) => held.stepKey === p.stepKey),
      );

      const variables: Omit<
        InterviewConductorV8Variables,
        | "operatingMode"
        | "communicationProfile"
        | "communicationGuidance"
        | "environmentNotes"
      > = {
        asked: askedBlock(conversation),
        conversation: conversationBlock(
          conversation,
          sessionId,
          steps,
          researchAvailable,
        ),
        journey: input.journeyType,
        channel: input.channel,
        personality: personality.manner,
        expressive,
        opening: input.utterance.trim().length === 0,
        warnings: warningsBySession.get(input.onboardingSessionId) ?? 0,
        tangents: tangentsBySession.get(input.onboardingSessionId) ?? 0,
        knownAnswers,
        openSteps,
        currentStepKey: view.currentStep?.stepKey ?? null,
        carried: carried.map((item) => ({
          stepKey: item.stepKey,
          question:
            steps.get(item.stepKey)?.configuration.prompt ?? item.stepKey,
          value: item.spoken,
        })),
        pendingConfirmations: [
          ...pending.map((p) => ({
            stepKey: p.stepKey,
            question: p.question,
            value: p.spoken,
          })),
          // Q's own suggestions wait here too, marked as Q's: a yes
          // decides them in `confirmations`, and nothing else does.
          ...conversation.proposals.map((p) => ({
            stepKey: p.target,
            question: `${steps.get(p.target)?.configuration.prompt ?? p.target} (Q's suggestion, not theirs)`,
            value: describeSuggested(steps.get(p.target), p.value).slice(
              0,
              400,
            ),
          })),
        ].slice(0, 8),
        documentProposals: proposals.map((p) => ({
          stepKey: p.stepKey,
          question: steps.get(p.stepKey)?.configuration.prompt ?? p.stepKey,
          value: describeValue(
            steps.get(p.stepKey),
            p.suggestedValue,
            currency,
          ),
        })),
        notes: [
          ...signupNotes(input, view, steps),
          ...researchNotes(input, view),
          ...askedNote(conversation, view),
          ...notesFor(input.onboardingSessionId, view),
        ].slice(0, 6),
        recentTurns: recentWithinBudget(input.recentTurns),
        utterance: input.utterance.slice(0, 2_000),
        memory: await memory,
      };
      const rendered = renderPrompt<InterviewConductorV8Variables>(registry, {
        task: "INTERVIEW_CONDUCTOR",
        charter: "Q_SYSTEM_VOICE",
        operatingMode: "ASSESSMENT",
        communicationProfile: DEFAULT_COMMUNICATION_PROFILE,
        environmentNotes:
          "You cannot record, verify or send anything yourself; Capital Q validates and records what you read, and holds material values until the person confirms them.",
        variables,
      });

      logger.debug(
        {
          promptChars: rendered.messages.reduce(
            (n, m) => n + m.content.length,
            0,
          ),
          openSteps: openSteps.length,
          knownAnswers: knownAnswers.length,
        },
        "interview prompt rendered",
      );

      let result: InterviewConductorResult | undefined;
      try {
        const response = await gateway.execute<InterviewConductorResult>(
          {
            taskClass: "NORMAL_DIALOGUE",
            // The declared sensitivity is untouched: an interview turn is
            // CONFIDENTIAL whoever it is about. Only the posture beside it
            // says whether there is a customer here at all.
            sensitivity: "CONFIDENTIAL",
            budget: DIALOGUE_BUDGET,
            messages: [...rendered.messages],
            output: rendered.output,
            attribution: input.attribution,
            ...(dependencies.dataPosture === undefined
              ? {}
              : { dataPosture: dependencies.dataPosture }),
          },
          {
            schema: InterviewConductorV7ResultSchema,
            // A person is waiting (CQ-VOICE-010). The first model gets
            // FIRST_DIALOGUE_ATTEMPT_MS when another stands behind it.
            firstAttemptTimeoutMs: FIRST_DIALOGUE_ATTEMPT_MS,
            ...(input.signal === undefined ? {} : { signal: input.signal }),
          },
        );
        if (response.output.kind === "STRUCTURED") {
          result = (
            response.output as { readonly value: InterviewConductorResult }
          ).value;
        }
      } catch (error: unknown) {
        if (isModelGatewayError(error) && error.failureClass === "CANCELLED") {
          return {
            reply: "",
            intent: "UNCLEAR",
            asking: null,
            recorded: [],
            skipped: [],
            questionForQ: null,
            researching: null,
            navigate: null,
            handoff: null,
            pronounce: null,
            warnings: warningsBySession.get(input.onboardingSessionId) ?? 0,
            view,
            degraded: false,
            reading: null,
            resume: null,
            qualitative: qualitativeBySession.get(sessionId) ?? [],
            trace: null,
          };
        }
        logger.warn(
          { err: error, journey: input.journeyType },
          "interview conductor model call failed",
        );
      }
      if (result === undefined) {
        /**
         * No model route, or the provider refused (QX-004 §0.4).
         *
         * What this used to do was repeat the current step's prompt, which
         * is a bare field label rather than a question — "Your firm" — and
         * it did so after every failure. The person answered, the answer
         * went nowhere because nothing had read it, and the same label came
         * back. Hosted Q spent a whole conversation doing that.
         *
         * So: say it once, plainly, and stop pretending the interview is
         * advancing. Nothing is recorded, nothing is asked, and the step
         * they were on is still the step they are on when it recovers.
         *
         * And it does not reassure them about their answer, because their
         * answer was not saved — that is what a failed turn means. The
         * first version of this line said "nothing you've told me is
         * lost", which is a claim about persistence that the runtime had
         * not made, and the browser said "Capital Q couldn't save that"
         * two lines later (live, 2026-09-22). Q may say a thing was kept
         * only where the runtime says so. Here it says the opposite, so
         * the words do too: what they just said did not go in, and what
         * they answered earlier is still on the record, which this turn
         * has read and can stand behind.
         */
        dispatch({ type: "FAILED", operation: "MODEL" });
        const failures = conversation.failures.MODEL;
        if (input.utterance.trim().length > 0) {
          noteUnrecorded(input.onboardingSessionId, null, input.utterance);
        }
        const kept = view.responses.length;
        const earlier =
          kept === 0
            ? ""
            : kept === 1
              ? " The one answer you have given me is on the record."
              : ` The ${String(kept)} answers you have given me are on the record.`;
        /**
         * The ledger's notices for the first failure and for the one
         * that stops the retries; past that, two short lines that
         * alternate, so that an outage is never the same sentence twice
         * in a row and never nags (CQ-QX-005 §7).
         */
        const reply = shouldNotify(conversation.failures, "MODEL")
          ? `${subsystemNotice("MODEL", isExhausted(conversation.failures, "MODEL"))}${earlier}`
          : failures % 2 === 1
            ? `Still no reasoning service on my side, so that one hasn't gone in.${earlier} I'm here when it comes back.`
            : `My reasoning service is still down, I'm afraid.${earlier} Try again in a minute, or tap Type if you'd rather keep going that way.`;
        keepThread(reply, view.currentStep?.stepKey ?? null, null);
        return {
          reply,
          intent: "UNCLEAR",
          asking: null,
          recorded: [],
          skipped: [],
          questionForQ: null,
          researching: null,
          navigate: null,
          handoff: null,
          pronounce: null,
          warnings: warningsBySession.get(input.onboardingSessionId) ?? 0,
          view,
          degraded: true,
          reading: null,
          resume: null,
          qualitative: qualitativeBySession.get(sessionId) ?? [],
          trace: null,
        };
      }

      dispatch({ type: "SUCCEEDED", operation: "MODEL" });
      /** The result, narrowed once for the closures below. */
      const read: InterviewConductorResult = result;
      /**
       * What the turn WAS, before anything is done with it (CQ-QX-005
       * §2). The reading's kind and confidence decide what may be
       * written; a question to Q is answered; a fragment is a transcript
       * matter; an aside moves nothing. Decided here, once, and logged
       * beside the trace.
       */
      // An opening turn is Q asking itself what to ask: there are no words
      // to read, so whatever the model wrote in the reading, the turn is a
      // control turn — never an answer that failed to land.
      const reading: ConversationTurnReading =
        input.utterance.trim().length === 0
          ? { ...readingFrom(result), kind: "CONTROL" }
          : readingFrom(result);
      const disposition = disposeTurn(reading);
      if (
        reading.transcript === "FRAGMENT" ||
        reading.kind === "UNCLEAR_TRANSCRIPT"
      ) {
        dispatch({ type: "FAILED", operation: "TRANSCRIPT" });
      } else {
        dispatch({ type: "SUCCEEDED", operation: "TRANSCRIPT" });
      }
      if (reading.question !== null && disposition.answer) {
        dispatch({
          type: "QUESTION_RECEIVED",
          kind: reading.question.kind,
          text: reading.question.text,
        });
      }
      if (reading.suggestions.length > 0) {
        dispatch({ type: "PROPOSED", suggestions: reading.suggestions });
      }
      for (const kept of reading.qualitative) {
        if (!steps.has(kept.target)) continue;
        const held = qualitativeBySession.get(sessionId) ?? [];
        qualitativeBySession.set(
          sessionId,
          [...held.filter((item) => item.target !== kept.target), kept].slice(
            -8,
          ),
        );
      }
      /** The meaning kept for a step, for the response's own `note`. */
      const noteFor = (stepKey: string): string | undefined =>
        (qualitativeBySession.get(sessionId) ?? []).find(
          (item) => item.target === stepKey,
        )?.meaning;

      const recorded: string[] = [];
      const skipped: string[] = [];
      const nextPending: Pending[] = [];
      /** Steps the model meant to record that the runtime would not take. */
      const unsaved: string[] = [];
      /** What the owning service said when it refused, and what it wants first. */
      const refusals: OnboardingRefusal[] = [];
      /**
       * A stored value as the person would say it; category ids are named
       * by the platform's own taxonomy, best effort (a lookup that fails
       * leaves the count rather than inventing a name).
       */
      const describeStored = async (
        step: OnboardingStepManifest,
        value: OnboardingResponseValue,
      ): Promise<string> => {
        if (value.type !== "RESOURCE_REFERENCE") {
          return describeValue(step, value, currency).trim();
        }
        const names: string[] = [];
        for (const id of value.resourceIds.slice(0, 6)) {
          try {
            names.push((await getTaxonomyNode(input.session, id)).displayName);
          } catch {
            return describeValue(step, value, currency).trim();
          }
        }
        return joinWithAnd(names);
      };
      /** Steps whose value this turn the service refused as invalid. */
      const invalidValues = new Set<string>();
      const commit = async (
        stepKey: string,
        value: OnboardingResponseValue,
        /**
         * True for the ledger's background re-offers (Workstream A).
         *
         * A carried value being refused again is the expected case — its
         * prerequisite is simply not met yet — and it is not something
         * to interrupt the person about. Counting it as `unsaved` would
         * put "that one didn't go in" in front of every reply for as
         * long as the ledger held anything, which is the loop this whole
         * change exists to end. It is still logged.
         */
        quietly = false,
      ) => {
        try {
          // Meaning kept beside the field rides with the value as the
          // response's own note: prose for people, never a filter.
          const note = noteFor(stepKey);
          view = await submitOnboardingResponse(
            input.session,
            input.onboardingSessionId,
            {
              stepKey,
              response: {
                value,
                ...(note === undefined ? {} : { note: note.slice(0, 500) }),
              },
              expectedSessionVersion: view.session.version,
            },
            randomUUID(),
          );
          recorded.push(stepKey);
          dispatch({ type: "SUCCEEDED", operation: "WRITE" });
          return true;
        } catch (error: unknown) {
          logger.warn(
            { err: error, stepKey, quietly },
            "interview answer was not accepted",
          );
          /**
           * Refused as a value the service will never take (founder round
           * 2, #1: "https://instagrampage" for a website), not as one it
           * cannot take YET. Such a value is never carried, never read back
           * as something Q holds, and the step is asked again.
           */
          const status = (error as { readonly status?: unknown }).status;
          if (
            (status === 400 || status === 422) &&
            readRefusal(error).needs === null
          ) {
            invalidValues.add(stepKey);
            return false;
          }
          if (quietly) return false;
          unsaved.push(stepKey);
          dispatch({ type: "FAILED", operation: "WRITE" });
          /**
           * Why the owning service said no, in its own words.
           *
           * The journey has prerequisites — "Choose how you invest first"
           * — and somebody who answers ahead of them gets their answer
           * refused. Q used to report that as "I couldn't save that just
           * now", which is true and useless: it names no reason and asks
           * for the same thing again, and the person says the same thing
           * again. The service already composed a sentence a person can
           * act on, so that is the sentence they hear.
           */
          refusals.push(readRefusal(error));
          return false;
        }
      };

      /**
       * What the model decided this turn, in step keys.
       *
       * A turn that records nothing is the hardest thing to diagnose from
       * a transcript alone: the reply reads fine and the session is empty,
       * and there is no way to tell a model that answered nothing from a
       * runtime that refused everything. Keys and decisions only -- the
       * values themselves are the person's, and a log is not where they
       * belong.
       */
      logger.debug(
        {
          intent: result.intent,
          kind: reading.kind,
          confidence: reading.confidence,
          transcript: reading.transcript,
          // Debug only, and truncated: a turn read as UNCLEAR is
          // indistinguishable in a log from a turn that never arrived,
          // and over a microphone the difference is usually the first few
          // words. Production runs at info and never reaches this.
          heard: input.utterance.slice(0, 80),
          answering: result.answers.map((a) => a.stepKey),
          confirming: result.confirmations.map(
            (c) => `${c.stepKey}:${c.decision}`,
          ),
          holding: pending.map((p) => p.stepKey),
          skipping: result.skips ?? [],
        },
        "interview conductor read the turn",
      );

      /**
       * Only a turn that commits to something may decide what is held
       * (CQ-QX-005 §2). A question to Q, an aside, or noise cannot say
       * yes to a cheque figure by accident.
       */
      const mayDecide =
        reading.kind === "ANSWER" ||
        reading.kind === "CLARIFICATION" ||
        reading.kind === "CORRECTION" ||
        reading.kind === "CONTROL";

      /**
       * A yes covers the value that was read back (adversarial round 1, #1).
       *
       * Q read back one held value ("Minimum cheque: $25,000. Is that
       * right?"). The person said "yep — and the 200k top end stands"; the
       * model confirmed the top end they mentioned and left the one on
       * screen undecided, so the minimum stayed held and was asked again.
       * The yes was to the question they could see. When the model
       * confirmed anything this turn, the held value Q actually read back
       * is confirmed with it — unless this turn rejects or changes it.
       */
      const readBack =
        conversation.asked === null
          ? undefined
          : pending.find((held) => held.stepKey === conversation.asked?.topic);
      const confirmations =
        mayDecide &&
        readBack !== undefined &&
        result.confirmations.some((d) => d.decision === "CONFIRMED") &&
        !result.confirmations.some((d) => d.stepKey === readBack.stepKey) &&
        !result.answers.some((a) => a.stepKey === readBack.stepKey)
          ? [
              ...result.confirmations,
              { stepKey: readBack.stepKey, decision: "CONFIRMED" as const },
            ]
          : result.confirmations;

      // 1. Decisions on what Q read back last time, on document proposals,
      //    and on Q's own suggestions.
      for (const decision of mayDecide ? confirmations : []) {
        const held = pending.find((p) => p.stepKey === decision.stepKey);
        if (held === undefined) {
          /**
           * A suggestion of Q's, decided (CQ-QX-005 §10).
           *
           * Declared Mandate ≠ Q Inference: nothing Q inferred reaches
           * the record until the person says so, and then it reaches it
           * through the same validated submit as their own words, as
           * their own answer. A no drops it; anything else leaves it
           * waiting.
           */
          const suggested = conversation.proposals.find(
            (p) => p.target === decision.stepKey,
          );
          if (suggested !== undefined) {
            const step = steps.get(suggested.target);
            if (decision.decision === "REJECTED") {
              dispatch({ type: "PROPOSAL_DECIDED", target: suggested.target });
              continue;
            }
            if (decision.decision === "CONFIRMED" && step !== undefined) {
              const value = toResponseValue(step, suggested.value);
              dispatch({ type: "PROPOSAL_DECIDED", target: suggested.target });
              if (value !== null && !(await commit(step.stepKey, value))) {
                carry(input.onboardingSessionId, {
                  stepKey: step.stepKey,
                  value,
                  spoken: describeValue(step, value, currency),
                  attempts: 1,
                });
              }
            }
            continue;
          }
          const proposal = proposals.find(
            (p) => p.stepKey === decision.stepKey,
          );
          if (proposal === undefined) continue;
          const step = steps.get(proposal.stepKey);
          const revised =
            decision.decision === "REVISED" &&
            decision.value !== undefined &&
            step !== undefined
              ? toResponseValue(step, decision.value)
              : null;
          try {
            view = await resolveOnboardingSuggestion(
              input.session,
              input.onboardingSessionId,
              proposal.id,
              revised !== null
                ? {
                    resolution: "EDIT",
                    response: { value: revised },
                    expectedSessionVersion: view.session.version,
                  }
                : {
                    resolution:
                      decision.decision === "CONFIRMED" ? "ACCEPT" : "REJECT",
                    expectedSessionVersion: view.session.version,
                  },
              randomUUID(),
            );
            if (decision.decision !== "REJECTED")
              recorded.push(proposal.stepKey);
          } catch (error: unknown) {
            logger.warn(
              { err: error, stepKey: proposal.stepKey },
              "document proposal was not resolved",
            );
          }
          continue;
        }
        if (decision.decision === "CONFIRMED") {
          /**
           * They said yes and the journey said not yet (Workstream A).
           *
           * The worst possible place to lose a value: the person has
           * read it back, agreed to it, and been told it is theirs.
           * Before this it was dropped and asked for again from scratch.
           * It is now carried with the yes attached — it is no longer a
           * proposal, it is a confirmed value waiting for a
           * prerequisite — so the ledger records it as soon as it can.
           */
          if (!(await commit(held.stepKey, held.value))) {
            carry(input.onboardingSessionId, {
              stepKey: held.stepKey,
              value: held.value,
              spoken: held.spoken,
              attempts: 1,
            });
          }
        } else if (
          decision.decision === "REVISED" &&
          decision.value !== undefined
        ) {
          const step = steps.get(held.stepKey);
          const value =
            step === undefined ? null : toResponseValue(step, decision.value);
          if (value !== null) {
            nextPending.push({
              ...held,
              value,
              spoken: describeValue(step, value),
            });
          }
        }
        // REJECTED: dropped; Q asks again in its own words.
      }
      const decided = new Set(
        (mayDecide ? confirmations : []).map((d) => d.stepKey),
      );
      for (const held of pending) {
        if (!decided.has(held.stepKey)) nextPending.push(held);
      }

      // 2. Answers in the person's words, validated against the step.
      /** Answers the step refused: Q asks again plainly rather than "got it". */
      const rejected: OnboardingStepManifest[] = [];
      /**
       * Upload steps answered in words. A voice cannot attach a file, and
       * live the same "what do you already have?" was asked three times
       * because each spoken answer went nowhere. The step is set aside
       * here, and the person is told where the upload lives.
       */
      const spokenUploads: OnboardingStepManifest[] = [];
      /**
       * Figures the platform will not guess the scale of (Workstream A).
       *
       * Collected here and asked about below, in the step's own terms.
       * Nothing is recorded for one of these: a value whose magnitude was
       * never said is not a value, and both of the available guesses are
       * wrong in a way that quietly changes who this investor is shown.
       */
      const unscaled: {
        step: OnboardingStepManifest;
        said: string;
        /** The recorded cheque it contradicts, when that is the problem. */
        conflict: { readonly stepKey: string; readonly amount: number } | null;
      }[] = [];
      /** Money already on the record, for the ordering check below. */
      const recordedAmounts = new Map<string, number>(
        view.responses.flatMap((r) =>
          r.value.type === "RANGE" && Number.isFinite(Number(r.value.value))
            ? [[r.stepKey, Number(r.value.value)] as const]
            : [],
        ),
      );
      /**
       * Steps a tension names (CQ-QX-005 §15). The model has asked which
       * the person means; a value for one of these is held for the yes
       * rather than written under it, so the record never carries the
       * contradiction silently.
       */
      const tense = new Set(reading.tensions.flatMap((t) => t.targets));
      /**
       * Nothing is written unless the turn was an answer or a correction
       * (CQ-QX-005 §2). A question to Q, an aside, a fragment: the
       * model's `answers` for those are read as what it would take the
       * words to mean — an interpretation the repair ladder may offer —
       * and never as values.
       */
      /**
       * Values carried by a turn read as a question (ACC round 3 #1).
       *
       * "Bet on it being mostly co-investing, we rarely lead. Oh, and did
       * gambling go in as a hard no?" was read as a question alone, so the
       * co-investing the model put in `answers` was thrown away while its
       * reply said "I'll take that as co-investing". A value the model
       * extracted from the person's words is never dropped for the turn's
       * shape: it is held and read back for a yes, which is the honest
       * middle between writing a question's content blind and ignoring it.
       */
      const proposedValues =
        result.answers.length > 0 ||
        result.categoryPhrases.length > 0 ||
        reading.references.length > 0 ||
        (result.unrestricted ?? []).length > 0;
      const questionCarriedValues =
        !disposition.write &&
        !disposition.confirm &&
        !disposition.transcription &&
        disposition.answer &&
        proposedValues;
      const confirmOnly = disposition.confirm || questionCarriedValues;
      const takingAnswers =
        disposition.write || disposition.confirm || questionCarriedValues;
      /**
       * Answers that only restate what is already on the record. Not
       * written, and not a failure either: "right, angel, and we're at
       * seed" is a person carrying on, and a turn made only of such
       * answers must not fall into the repair ladder (live, 2026-09-24).
       */
      let restated = 0;
      /**
       * Category phrases the model put in `answers` rather than in
       * `categoryPhrases`. The value of a CATEGORIES step is a taxonomy
       * node the platform resolves, so words placed there are phrases for
       * the classifier — routed to it, not refused for being words (live,
       * 2026-09-24: "marketplaces and SaaS" against business models).
       */
      const phrasesFromAnswers: {
        readonly stepKey: string;
        readonly phrases: readonly string[];
      }[] = [];
      for (const answer of takingAnswers ? result.answers : []) {
        const step = steps.get(answer.stepKey);
        const status = statuses.get(answer.stepKey);
        /**
         * A step already answered is not re-answered by accident — except
         * when the person is correcting it, which is the whole point of a
         * correction.
         *
         * Dropping those was silent and total: "actually, scrap that —
         * we're not an angel, we're a family office" produced a
         * CORRECTION the runtime threw away, the record kept saying
         * angel, and Q went on truthfully reporting angel (local,
         * 2026-09-22). Truthful about the record and wrong about the
         * person.
         *
         * The model says this is a correction; the runtime does the
         * writing, and the owning service keeps whatever history it keeps
         * — a correction supersedes, it does not erase.
         */
        const correcting = result.intent === "CORRECTION";
        if (step === undefined) continue;
        if (
          (status === "COMPLETED" ||
            view.responses.some((r) => r.stepKey === answer.stepKey)) &&
          !correcting
        ) {
          // Already answered and not being corrected: nothing to do, and
          // nothing to carry either.
          stopCarrying(input.onboardingSessionId, answer.stepKey);
          restated += 1;
          continue;
        }
        if (
          step.configuration.stepType === "reference_select" &&
          step.configuration.resourceType === "TAXONOMY_NODE" &&
          typeof answer.value !== "boolean"
        ) {
          const phrases = asList(answer.value)
            .map((phrase) => phrase.trim())
            .filter((phrase) => phrase.length > 0)
            .slice(0, 8);
          if (phrases.length > 0) {
            phrasesFromAnswers.push({ stepKey: step.stepKey, phrases });
          }
          continue;
        }
        if (step.configuration.stepType === "document_upload") {
          // Nothing said can be a document. What they have is noted in
          // the reply; the step is settled below so it is not asked again.
          spokenUploads.push(step);
          continue;
        }
        const value = toResponseValue(step, answer.value);
        if (value === null) {
          /**
           * A reading the step will not take.
           *
           * Only worth saying so when it is the question in hand. A
           * volunteered aside that did not map to some step five phases
           * away is not something to interrupt the conversation about —
           * Q asks that step properly when it gets there, which is what
           * it would have done anyway.
           */
          if (
            answer.stepKey === view.currentStep?.stepKey ||
            answer.stepKey === conversation.asked?.topic
          ) {
            rejected.push(step);
          }
          continue;
        }
        /**
         * A figure whose scale was never said, or which contradicts one
         * already on the record. Neither is recorded and neither is
         * guessed; Q asks, in the step's own terms.
         */
        if (
          // A reading with no clarity at all is SETTLED: the gateway's
          // schema defaults it, and a caller that stubs the gateway is
          // not making a claim about scale.
          // A figure the reading already carries in thousands or more has
          // its scale: "20k" read as 20000 is not a scale question
          // (live, round 3: "you said $20,000. Is that thousands…?").
          (answer.clarity !== undefined &&
            answer.clarity !== "SETTLED" &&
            !(value.type === "RANGE" && Number(value.value) >= 1_000)) ||
          chequeContradiction(step.stepKey, value, recordedAmounts)
        ) {
          unscaled.push({
            step,
            said: describeValue(step, value, currency),
            // A bare "100" against a 50k minimum is a missing scale; a
            // figure already in thousands that crosses the record is a
            // genuine contradiction, and is asked about as one.
            conflict:
              value.type === "RANGE" && Number(value.value) >= 1_000
                ? chequeConflict(step.stepKey, value, recordedAmounts)
                : null,
          });
          continue;
        }
        /**
         * Where this answer goes (Workstream A).
         *
         * Three destinations, and the choice is the platform's:
         *
         * **Read back first** for the values the domain will not take on
         * one person's say-so — money and exclusions. Those are what an
         * investor is judged on, and a wrong one is expensive. They said
         * it this turn, so Q reads it back this turn (A §13); what is
         * new is that a yes the journey then refuses no longer loses it.
         *
         * **Recorded** otherwise — and that is now most answers. Q used
         * to read back anything the model marked MEDIUM, which is
         * anything it inferred rather than heard verbatim, which is most
         * of a natural conversation: "I'm the founder" came back as "so
         * your role is Founder, is that right?". Asking somebody to
         * confirm what they have just plainly said is not diligence, it
         * is a form with a voice. Unambiguous meaning, a domain that can
         * hold it, and no material-risk rule over it: record it.
         */
        /**
         * Read back before it is written: a material value, a value the
         * model only inferred (MEDIUM), or one a tension names
         * (CQ-QX-005 §4, §15). The same held-for-a-yes path in every
         * case, so a yes writes it and a no drops it.
         */
        /**
         * The answer lands on the journey's current step while Q had asked
         * a different one (adversarial round 1, c): "strong" to a question
         * about sectors was recorded as geography strength. The step Q
         * declared as asked governs; when the reading puts the answer on
         * the other one instead, and the asked step would take the same
         * answer, the two cannot be told apart from the words — so it is
         * held and read back under its step's name, never written blind.
         */
        const askedTopic = conversation.asked?.topic ?? null;
        const askedStep =
          askedTopic === null ? undefined : steps.get(askedTopic);
        const misplaced =
          askedStep !== undefined &&
          askedStep.stepKey !== step.stepKey &&
          step.stepKey === currentAtStart &&
          statuses.get(askedStep.stepKey) !== "COMPLETED" &&
          !result.answers.some((a) => a.stepKey === askedStep.stepKey) &&
          toResponseValue(askedStep, answer.value) !== null;
        if (
          misplaced ||
          isMaterial(step) ||
          confirmOnly ||
          tense.has(step.stepKey)
        ) {
          nextPending.push({
            stepKey: step.stepKey,
            question: step.configuration.prompt,
            value,
            spoken: describeValue(step, value, currency),
          });
          continue;
        }
        if (!(await commit(step.stepKey, value))) {
          /**
           * The journey would not take it YET.
           *
           * Before this, that was the end of it: the answer was dropped,
           * a note said so for a turn or two, and the step came round
           * later as though it had never been mentioned. Now the
           * validated value is held and offered again every turn, so a
           * thing said early is recorded the moment its prerequisites
           * are met and is never asked for twice.
           */
          carry(input.onboardingSessionId, {
            stepKey: step.stepKey,
            value,
            spoken: describeValue(step, value, currency),
            attempts: 1,
          });
        }
      }

      /**
       * 2b. No restriction, which is an answer and not a silence.
       *
       * "Everywhere on the planet" was reaching the taxonomy classifier,
       * matching nothing, recording nothing, and leaving the geography
       * question to be asked again — three times in the live transcript,
       * with the person saying the same thing more emphatically each
       * time. The model now names the step; the step says what no
       * restriction means for it, because that is domain knowledge and
       * not something to be read out of somebody's phrasing.
       */
      for (const item of takingAnswers && !questionCarriedValues
        ? (result.unrestricted ?? [])
        : []) {
        const step = steps.get(item.stepKey);
        if (step === undefined) continue;
        const status = statuses.get(item.stepKey);
        const onRecord =
          view.responses.some((r) => r.stepKey === item.stepKey) ||
          status === "COMPLETED";
        // "There's nothing I'd avoid" said as a CORRECTION of a step that
        // holds something is the one case no restriction reaches a step
        // already answered: a value supersedes, a set-aside is attempted
        // and honestly reported if the journey refuses it.
        if (onRecord && reading.kind !== "CORRECTION") continue;
        if (status === "SKIPPED") continue;
        const outcome = unrestrictedOutcome(step);
        if (outcome.kind === "VALUE") {
          if (!(await commit(step.stepKey, outcome.value))) {
            carry(input.onboardingSessionId, {
              stepKey: step.stepKey,
              value: outcome.value,
              spoken: describeValue(step, outcome.value, currency),
              attempts: 1,
            });
          }
          continue;
        }
        if (outcome.kind === "SET_ASIDE") {
          // The journey's own way of recording "anywhere": nothing
          // listed. Not a skip in the sense of declining to answer —
          // they answered, and this is what the answer looks like here.
          try {
            view = await skipOnboardingStep(
              input.session,
              input.onboardingSessionId,
              step.stepKey,
              { expectedSessionVersion: view.session.version },
              randomUUID(),
            );
            skipped.push(step.stepKey);
            stopCarrying(input.onboardingSessionId, step.stepKey);
          } catch (error: unknown) {
            logger.warn(
              { err: error, stepKey: step.stepKey },
              "an unrestricted step was not set aside",
            );
          }
        }
        // CANNOT: the step genuinely has no way to say it. Q asks it.
      }

      /**
       * 2b'. An earlier answer taken back entirely (CQ-QX-005 §1, §2).
       *
       * A correction may name steps to clear. Optional steps are set
       * aside through the journey's own skip; a required step cannot be
       * emptied — the journey says it cannot do without it — so it is
       * noted as not done and Q asks for its replacement instead. Never
       * from any kind but CORRECTION: a question or an aside clears
       * nothing. Clearing is a write, so it takes the same HIGH
       * confidence a value does. A clear the journey refuses is said
       * plainly below, never folded into a repair of another question.
       */
      const notCleared: OnboardingStepManifest[] = [];
      for (const key of reading.kind === "CORRECTION" && disposition.write
        ? reading.clears
        : []) {
        const step = steps.get(key);
        if (step === undefined) continue;
        const onRecord =
          view.responses.some((r) => r.stepKey === key) ||
          statuses.get(key) === "COMPLETED";
        if (!onRecord || skipped.includes(key)) continue;
        if (step.required) {
          noteUnrecorded(input.onboardingSessionId, key, input.utterance);
          notCleared.push(step);
          continue;
        }
        try {
          view = await skipOnboardingStep(
            input.session,
            input.onboardingSessionId,
            key,
            { expectedSessionVersion: view.session.version },
            randomUUID(),
          );
          skipped.push(key);
          stopCarrying(input.onboardingSessionId, key);
        } catch (error: unknown) {
          logger.warn(
            { err: error, stepKey: key },
            "a withdrawn answer was not set aside",
          );
          noteUnrecorded(input.onboardingSessionId, key, input.utterance);
          notCleared.push(step);
        }
      }

      /**
       * 2c. A choice made by pointing at the screen (CQ-QX-005 §5).
       *
       * "The last four", "both", "the second one": the model says how
       * they pointed and the platform resolves it against the options Q
       * actually showed — the person's screen, not the catalogue. A
       * reference that cannot be resolved (nothing shown, a position off
       * the end) is asked about through the ladder, never guessed.
       */
      const unresolved: {
        readonly step: OnboardingStepManifest;
        readonly because: string;
      }[] = [];
      const selectionsThisTurn: Record<string, readonly string[]> = {};
      for (const reference of takingAnswers ? reading.references : []) {
        const step = steps.get(reference.target);
        if (step === undefined) continue;
        if (recorded.includes(step.stepKey)) continue;
        /**
         * A step already on the record is amended by pointing only when
         * the pointing says so — "and the second one too" (ADD), "not that
         * one" (EXCLUDE) — or the turn is a correction. A plain "the
         * second one" against a settled step would otherwise replace a
         * whole selection with one item.
         */
        const settled =
          statuses.get(step.stepKey) === "COMPLETED" ||
          view.responses.some((r) => r.stepKey === step.stepKey);
        if (
          settled &&
          reading.kind !== "CORRECTION" &&
          reference.select !== "ADD" &&
          reference.select !== "EXCLUDE"
        ) {
          continue;
        }
        /**
         * Pointing at Q's own words, or at another step's answer (v10).
         *
         * "The second number you said" is the second value Q itself put
         * forward for this step last turn; "go with what you said" is the
         * only one, or Q's own suggestion for the step. "Both full time"
         * after "two founders" takes the value the record holds for the
         * step named in `from`. Resolved from what the platform holds —
         * never a figure the model composed — and then written or held
         * exactly like any other answer.
         */
        if (reference.select === "OFFERED" || reference.select === "VALUE_OF") {
          const raw = ((): string | readonly string[] | boolean | undefined => {
            if (reference.select === "VALUE_OF") {
              const source = view.responses.find(
                (r) => r.stepKey === reference.from,
              )?.value;
              if (source === undefined) return undefined;
              switch (source.type) {
                case "RANGE":
                  return String(source.value);
                case "TEXT":
                  return source.text;
                case "SINGLE_SELECT":
                  return source.optionKey;
                case "MULTI_SELECT":
                  return source.optionKeys;
                case "RESOURCE_REFERENCE":
                case "CONFIRMATION":
                  return undefined;
              }
            }
            const offered = (offeredBySession.get(sessionId) ?? []).find(
              (item) => item.target === step.stepKey,
            );
            const position = reference.ordinals?.[0];
            if (offered !== undefined) {
              if (position !== undefined) return offered.values[position - 1];
              return offered.values.length === 1
                ? offered.values[0]
                : undefined;
            }
            // "Go with what you said" about Q's own suggestion.
            return conversation.proposals.find(
              (proposal) => proposal.target === step.stepKey,
            )?.value;
          })();
          const value = raw === undefined ? null : toResponseValue(step, raw);
          if (value === null) {
            unresolved.push({ step, because: "EMPTY" });
            continue;
          }
          const spoken = describeValue(step, value, currency);
          dispatch({ type: "PROPOSAL_DECIDED", target: step.stepKey });
          if (isMaterial(step) || confirmOnly) {
            nextPending.push({
              stepKey: step.stepKey,
              question: step.configuration.prompt,
              value,
              spoken,
            });
          } else if (!(await commit(step.stepKey, value))) {
            carry(input.onboardingSessionId, {
              stepKey: step.stepKey,
              value,
              spoken,
              attempts: 1,
            });
          }
          continue;
        }
        const shownOptions: readonly ShownOption[] =
          conversation.asked !== null &&
          conversation.asked.topic === reference.target
            ? conversation.asked.options
            : optionsOf(step);
        const resolved = resolveOptionReference(
          reference,
          shownOptions,
          conversation.selections[reference.target] ??
            (() => {
              const previous = view.responses.find(
                (r) => r.stepKey === reference.target,
              )?.value;
              return previous?.type === "MULTI_SELECT"
                ? previous.optionKeys
                : previous?.type === "SINGLE_SELECT"
                  ? [previous.optionKey]
                  : null;
            })(),
        );
        if (resolved.kind === "UNRESOLVED") {
          unresolved.push({ step, because: resolved.because });
          continue;
        }
        const value = toResponseValue(
          step,
          step.configuration.stepType === "single_select"
            ? (resolved.keys[0] ?? "")
            : resolved.keys,
        );
        if (value === null) {
          unresolved.push({ step, because: "EMPTY" });
          continue;
        }
        selectionsThisTurn[step.stepKey] = resolved.keys;
        const spoken = labelsOf(resolved.keys, shownOptions).join(", ");
        if (isMaterial(step) || confirmOnly || tense.has(step.stepKey)) {
          nextPending.push({
            stepKey: step.stepKey,
            question: step.configuration.prompt,
            value,
            spoken,
          });
        } else if (!(await commit(step.stepKey, value))) {
          carry(input.onboardingSessionId, {
            stepKey: step.stepKey,
            value,
            spoken,
            attempts: 1,
          });
        }
      }

      // 3. Categories: phrases → the platform's own candidates, read back.
      /**
       * Phrases that matched nothing Capital Q can record, per step, when
       * others in the same list did (adversarial round 1, #5: "just Ghana
       * and Côte d'Ivoire" stored Ghana and said both). Said below from
       * this, never left to the model's read-back.
       */
      const partlyPlaced: {
        readonly step: OnboardingStepManifest;
        readonly placed: readonly string[];
        readonly unplaced: readonly string[];
      }[] = [];
      const carriedPhrases = (phrasesBySession.get(sessionId) ?? []).filter(
        (item) => statuses.get(item.stepKey) !== "COMPLETED",
      );
      phrasesBySession.delete(sessionId);
      /** Steps whose phrases are held for a later lookup this turn. */
      const phrasesHeld: string[] = [];
      const categoryPhrasesThisTurn = takingAnswers
        ? [
            ...read.categoryPhrases,
            ...phrasesFromAnswers.filter(
              (item) =>
                !read.categoryPhrases.some((c) => c.stepKey === item.stepKey),
            ),
          ]
        : [];
      const categoryPhrases = [
        ...categoryPhrasesThisTurn,
        ...carriedPhrases.filter(
          (item) =>
            !categoryPhrasesThisTurn.some((c) => c.stepKey === item.stepKey),
        ),
      ];
      for (const item of categoryPhrases) {
        const step = steps.get(item.stepKey);
        if (
          step === undefined ||
          step.configuration.stepType !== "reference_select"
        )
          continue;
        const c = step.configuration;
        const ids: string[] = [];
        const labels: string[] = [];
        const unplacedPhrases: string[] = [];
        let lookupFailed = false;
        for (const phrase of item.phrases.slice(0, 6)) {
          try {
            const found = await findTaxonomyCandidates(input.session, {
              text: phrase,
              vocabularyCodes: [...c.vocabularyCodes],
            });
            const best = found.candidates[0];
            if (best === undefined) {
              unplacedPhrases.push(phrase.trim().slice(0, 80));
            } else if (!ids.includes(best.nodeId)) {
              ids.push(best.nodeId);
              labels.push(best.displayName);
            }
          } catch {
            // The classifier could not run for this person yet (commonly:
            // no organisation so far). Nothing is invented in its place,
            // and nothing is dropped either: the words are kept below.
            lookupFailed = true;
            unplacedPhrases.push(phrase.trim().slice(0, 80));
          }
        }
        if (ids.length === 0 && lookupFailed) {
          const kept = phrasesBySession.get(sessionId) ?? [];
          phrasesBySession.set(sessionId, [
            ...kept.filter((k) => k.stepKey !== step.stepKey),
            { stepKey: step.stepKey, phrases: item.phrases.slice(0, 6) },
          ]);
          phrasesHeld.push(step.stepKey);
          continue;
        }
        if (ids.length > 0 && unplacedPhrases.length > 0) {
          partlyPlaced.push({
            step,
            placed: [...labels],
            unplaced: unplacedPhrases,
          });
        }
        if (ids.length > 0) {
          const existing = view.pendingSuggestions.find(
            (s) =>
              s.stepKey === step.stepKey &&
              s.suggestedValue.type === "RESOURCE_REFERENCE",
          );
          const value: OnboardingResponseValue = {
            type: "RESOURCE_REFERENCE",
            resourceType: "TAXONOMY_NODE",
            resourceIds: ids.slice(0, c.maxItems),
          };
          if (existing !== undefined) {
            // The runtime's own proposal path already holds a set: accept it if it is the same.
            try {
              view = await resolveOnboardingSuggestion(
                input.session,
                input.onboardingSessionId,
                existing.id,
                {
                  resolution: "EDIT",
                  response: { value },
                  expectedSessionVersion: view.session.version,
                },
                randomUUID(),
              );
              recorded.push(step.stepKey);
              continue;
            } catch {
              // Fall through to holding it for confirmation.
            }
          }
          /**
           * Categories take the same three roads as any other answer
           * (Workstream A).
           *
           * Before this they were always read back, which is where
           * "fintech and software" turned into a confirmation question
           * instead of an answer. The classifier has already done the
           * only part that needed checking — these are the platform's
           * own nodes, not the model's words — so a sector list is
           * recorded like anything else, and only the exclusion steps,
           * which the domain treats as material, are read back.
           *
           * And when the journey will not take it yet, it is carried
           * rather than dropped. The taxonomy lookup that produced it
           * cost a round trip; doing it again next turn would cost
           * another, and doing it never is how the answer disappeared.
           */
          const spoken = labels.join(", ");
          if (isMaterial(step) || confirmOnly) {
            nextPending.push({
              stepKey: step.stepKey,
              question: c.prompt,
              value,
              spoken,
            });
          } else if (!(await commit(step.stepKey, value))) {
            carry(input.onboardingSessionId, {
              stepKey: step.stepKey,
              value,
              spoken,
              attempts: 1,
            });
          }
        }
      }

      /**
       * 3b. Offer everything still in the ledger (Workstream A).
       *
       * This is where a thing said early actually lands. Its
       * prerequisites are commonly satisfied by something recorded
       * earlier in this same turn — a role and a deployment status given
       * in one breath, where the second needed the first — so the ledger
       * is worked after the turn's own answers rather than before.
       *
       * Nothing here needs anybody's permission: a value only reaches
       * the ledger once it has been said plainly or said yes to. A
       * material value still waiting for its yes stays a pending
       * confirmation, which already survives between turns.
       */
      for (const candidate of carriedFor(input.onboardingSessionId, view)) {
        if (recorded.includes(candidate.stepKey)) continue;
        if (nextPending.some((p) => p.stepKey === candidate.stepKey)) continue;
        if (await commit(candidate.stepKey, candidate.value, true)) {
          stopCarrying(input.onboardingSessionId, candidate.stepKey);
        } else {
          carry(input.onboardingSessionId, {
            ...candidate,
            attempts: candidate.attempts + 1,
          });
        }
      }
      /**
       * Refused first, landed on the retry above (adversarial round 2,
       * #2): "the minimum is 20k… put the firm down as Coastline" wrote the
       * cheques before the organisation existed, the ledger landed them
       * once it did, and Q still said one thing had not saved. A value on
       * the record is not unsaved.
       */
      for (let index = unsaved.length - 1; index >= 0; index -= 1) {
        const key = unsaved[index];
        if (key !== undefined && recorded.includes(key)) {
          unsaved.splice(index, 1);
        }
      }
      for (const key of invalidValues) {
        stopCarrying(input.onboardingSessionId, key);
        const step = steps.get(key);
        if (
          step !== undefined &&
          !recorded.includes(key) &&
          !rejected.some((r) => r.stepKey === key)
        ) {
          rejected.push(step);
        }
      }

      // 4. Skips, optional steps only; an upload answered aloud is one.
      //    A skip is a commitment too: only a turn that could answer
      //    may set a question aside.
      let deferredUpload = false;
      const toSkip = [
        ...(takingAnswers && !questionCarriedValues ? result.skips : []),
        ...spokenUploads.map((step) => step.stepKey),
      ];
      for (const stepKey of toSkip) {
        const step = steps.get(stepKey);
        const status = statuses.get(stepKey);
        if (
          step === undefined ||
          step.required ||
          status === undefined ||
          status === "COMPLETED" ||
          status === "SKIPPED" ||
          skipped.includes(stepKey)
        )
          continue;
        if (step.configuration.stepType === "document_upload") {
          deferredUpload = true;
        }
        try {
          view = await skipOnboardingStep(
            input.session,
            input.onboardingSessionId,
            stepKey,
            { expectedSessionVersion: view.session.version },
            randomUUID(),
          );
          skipped.push(stepKey);
        } catch (error: unknown) {
          logger.warn(
            { err: error, stepKey },
            "interview skip was not accepted",
          );
        }
      }

      pendingBySession.set(input.onboardingSessionId, nextPending.slice(-8));

      // 5. Conduct: a warning is counted here, never by the model; the
      // third strike hands the person to the form and ends Q's part.
      let warnings = warningsBySession.get(input.onboardingSessionId) ?? 0;
      if (result.intent === "SMALL_TALK" || result.intent === "OFF_TOPIC") {
        tangentsBySession.set(
          input.onboardingSessionId,
          Math.min(
            9,
            (tangentsBySession.get(input.onboardingSessionId) ?? 0) + 1,
          ),
        );
      } else if (recorded.length > 0) {
        tangentsBySession.delete(input.onboardingSessionId);
      }
      let handoff: "FORM" | null = null;
      if (result.intent === "SABOTAGE") {
        warnings += 1;
        warningsBySession.set(input.onboardingSessionId, warnings);
        if (warnings > WARNINGS_BEFORE_HANDOFF) handoff = "FORM";
      }
      let navigate: InterviewDestination | null =
        result.intent === "NAVIGATE" ? result.navigate : null;
      if (navigate === "FORM") handoff = "FORM";
      let reply = result.reply;
      /**
       * The model says "got it" in the same breath as it hands over an
       * answer, and it cannot know the step refused it. When one did, the
       * acknowledgement is a lie and the question would come round again
       * later as if never asked (live: "what do you already have" three
       * times). So Q says what it could not place, and asks the one thing
       * that settles it, in the step's own terms.
       */
      /**
       * A figure with no scale is asked about before anything else
       * (Workstream A).
       *
       * Ahead of the guards below, because it is the one case where
       * carrying on would record a number nobody meant. The question
       * names the step and offers the two magnitudes rather than
       * choosing one: "maximum cheque — a hundred thousand, or a hundred
       * million?" is answerable in one word, where "how much?" starts
       * the whole exchange again.
       */
      const needsScale = unscaled[0];
      if (needsScale !== undefined) {
        const label = needsScale.step.configuration.prompt
          .replace(/\?+$/, "")
          .toLowerCase();
        // A figure whose scale was clear but which contradicts a cheque on
        // the record is asked about as the contradiction it is (round 3,
        // live: "20k typical" against a 25k minimum was asked "is that
        // thousands, millions…").
        const conflictStep =
          needsScale.conflict === null
            ? undefined
            : steps.get(needsScale.conflict.stepKey);
        reply =
          needsScale.conflict !== null && conflictStep !== undefined
            ? `You said ${needsScale.said} for your ${noun(needsScale.step)}, but your ${noun(conflictStep)} is ${spokenMoney(needsScale.conflict.amount, currency)}. Which should I change?`
            : `I want to get the scale right on the ${label} — you said ${needsScale.said}. Is that thousands, millions, or exactly that?`;
        result = { ...result, askNext: needsScale.step.stepKey };
      }
      /**
       * Conversational repair (CQ-QX-005 §6, §7, §8).
       *
       * Every failure to place what was said used to produce a fixed
       * line — "I couldn't place that.", "Sorry — I didn't catch that
       * well enough to write it down." — and the same line came back on
       * every failure, which is the loop that made the interview
       * unusable and which blamed hearing for reasoning. Repair is now a
       * rung on the core's ladder, chosen from how many times this topic
       * has already failed, composed from state, and never the rung used
       * last. Transcript trouble takes a different path entirely: a
       * fragment is asked for again as a transcription matter, and never
       * as Q failing to understand.
       */
      /**
       * "Ok let's stop here, I'll do the rest tomorrow" (founder round 2,
       * #3): a pause ends the turn gracefully. No repair, no read-back, no
       * question — and so no failed repair line left as the heading.
       */
      const pausing = result.intent === "PAUSE";
      let repairUsed: RepairStrategy | null = null;
      let repairAsk: string | null = null;
      const repairOn = (
        step: OnboardingStepManifest,
        interpretation: string | undefined,
      ): string => {
        /**
         * "Let me ask that differently" about a question never asked
         * (adversarial round 1, #1: "Your role there?" after a turn about
         * cheques). A step that was not the question in hand is asked, not
         * repaired: no rung is spent and nothing claims a second attempt.
         */
        if (
          inFrontAtStart !== step.stepKey &&
          conversation.repair?.topic !== step.stepKey
        ) {
          repairAsk = step.stepKey;
          return askWithChoices(step, input);
        }
        const strategy = nextRepair(conversation.repair, step.stepKey, {
          hasInterpretation: interpretation !== undefined,
        });
        dispatch({ type: "REPAIRED", topic: step.stepKey, strategy });
        dispatch({ type: "FAILED", operation: "PARSE" });
        repairUsed = strategy;
        repairAsk = step.stepKey;
        return composeRepair(strategy, {
          label: repairLabel(step),
          question: askWithChoices(step, input),
          interpretation,
          options: optionsOf(step).map((o) => o.label),
          held: carriedFor(input.onboardingSessionId, view).map(
            (item) => item.spoken,
          ),
          optional: !step.required,
        });
      };
      /** What the model would take the words to mean, for "do you mean…?". */
      const interpretationOf = (step: OnboardingStepManifest) => {
        const candidate = read.answers.find((a) => a.stepKey === step.stepKey);
        if (candidate === undefined) return undefined;
        // Only a reading the step would actually take is worth offering:
        // "do you mean unicorn?" for a stage is a question about a word,
        // not a way through.
        const value = toResponseValue(step, candidate.value);
        if (value === null) return undefined;
        const said = describeValue(step, value, currency).trim();
        return said.length === 0 ? undefined : said;
      };
      const stepInHand = (): OnboardingStepManifest | undefined => {
        const key =
          conversation.asked?.topic ?? view.currentStep?.stepKey ?? null;
        return key === null ? undefined : steps.get(key);
      };
      const unplaced = rejected.find(
        (step) => !recorded.includes(step.stepKey),
      );
      const unresolvedReference = unresolved[0];
      // A write the owning service refused is not a reading that failed:
      // the refusal path below says what the setup wants first, and the
      // ladder must not count it as a rung.
      const nothingHappened =
        recorded.length === 0 &&
        nextPending.length === 0 &&
        skipped.length === 0 &&
        rejected.length === 0 &&
        unresolved.length === 0 &&
        unsaved.length === 0 &&
        notCleared.length === 0 &&
        phrasesHeld.length === 0 &&
        restated === 0 &&
        !result.skipRemainingOptional;
      if (needsScale !== undefined) {
        // Already answered above; the guards below are about a different
        // failure and saying both at once is two apologies in a row.
      } else if (disposition.transcription) {
        /**
         * The words were noise. This is the one place speech recognition
         * is named, and it is named as itself: the person is asked to say
         * it once more, not told Q could not understand them.
         */
        if (shouldNotify(conversation.failures, "TRANSCRIPT")) {
          reply = subsystemNotice(
            "TRANSCRIPT",
            isExhausted(conversation.failures, "TRANSCRIPT"),
          );
        } else {
          const step = stepInHand();
          reply =
            step === undefined
              ? "Still breaking up on my side. One more time?"
              : `Still breaking up on my side. ${askAgain(step, input)}`;
        }
        const step = stepInHand();
        result = { ...result, askNext: step?.stepKey ?? null };
      } else if (
        result.frustrated === true &&
        !pausing &&
        recorded.length === 0 &&
        stepInHand() !== undefined
      ) {
        /**
         * They have told Q it is not listening, and they are usually
         * right — something they said did not go in (CQ-QX-005 §6).
         * The worst available response is the question that already
         * failed, so the ladder goes straight to naming the gap: what
         * the platform is still holding for them, and the one thing it
         * does not have. Recorded as a rung, so the next failure moves
         * on rather than saying it again.
         */
        const wanted = stepInHand();
        if (wanted !== undefined && wanted.stepKey !== inFrontAtStart) {
          /**
           * "You already asked that" about a step Q never put to them
           * (adversarial round 2, #5): Q must not say "you did tell me, and
           * I didn't get it down" about a question that was not asked. It
           * asks the step, plainly, with its choices.
           */
          repairAsk = wanted.stepKey;
          reply = askWithChoices(wanted, input);
        } else if (wanted !== undefined) {
          dispatch({
            type: "REPAIRED",
            topic: wanted.stepKey,
            strategy: "NAME_THE_GAP",
          });
          dispatch({ type: "FAILED", operation: "PARSE" });
          repairUsed = "NAME_THE_GAP";
          repairAsk = wanted.stepKey;
          reply = `You did tell me, and I didn't get it down. ${composeRepair(
            "NAME_THE_GAP",
            {
              label: repairLabel(wanted),
              question: askAgain(wanted, input),
              options: optionsOf(wanted).map((o) => o.label),
              held: carriedFor(input.onboardingSessionId, view).map(
                (item) => item.spoken,
              ),
              optional: !wanted.required,
            },
          )}`;
        }
      } else if (
        notCleared[0] !== undefined &&
        recorded.length === 0 &&
        skipped.length === 0
      ) {
        /**
         * They took an answer back and the journey would not let it go
         * (a required step, or one it will not set aside from here). The
         * earlier answer stands, and Q says so rather than claiming a
         * change or repairing some other question.
         */
        const kept = notCleared[0];
        reply = kept.required
          ? `I can't leave ${repairLabel(kept)} empty — the setup needs something there, so your earlier answer stands for now. Tell me what to put instead and I'll change it.`
          : `I couldn't take back your answer on ${repairLabel(kept)} from here, so it still stands. You can clear it on the form, or tell me what to put instead.`;
      } else if (unresolvedReference !== undefined) {
        // "The second one" with nothing on screen, or a position past
        // the end: asked about, in the step's own labels, never guessed.
        reply = repairOn(unresolvedReference.step, undefined);
      } else if (unplaced !== undefined) {
        reply = repairOn(unplaced, interpretationOf(unplaced));
      } else if (
        disposition.clarify &&
        reading.kind !== "CLARIFICATION" &&
        nothingHappened
      ) {
        /**
         * The model was guessing (LOW confidence): a targeted question,
         * offering its own best reading as the thing to say yes to, so
         * that the person answers in one word rather than starting the
         * whole exchange again.
         */
        const step = stepInHand();
        if (step !== undefined) {
          reply = repairOn(step, interpretationOf(step));
        }
      } else if (
        (reading.kind === "ANSWER" || reading.kind === "CORRECTION") &&
        takingAnswers &&
        nothingHappened &&
        reading.qualitative.length === 0 &&
        reading.tensions.length === 0
      ) {
        /**
         * The model answered as though it had taken something in, and the
         * runtime has nothing to show for it (QX-004 core gate §5).
         *
         * Live, 2026-09-22: "Zino Aviation, got it." — and the session
         * recorded no organisation name, because the model's structured
         * answer carried none. Decided from the model's own closed fields
         * and the runtime's own result, never from reading its prose: an
         * ANSWER that produced no commit, no confirmation to read back
         * and no skip did not happen. Q says what it is still missing,
         * through the ladder, rather than blaming its hearing.
         */
        const current = stepInHand();
        logger.warn(
          {
            journey: input.journeyType,
            stepKey: current?.stepKey,
            intent: result.intent,
          },
          "the model acknowledged an answer the runtime did not record",
        );
        if (current !== undefined) {
          reply = repairOn(current, interpretationOf(current));
        }
      }
      if (repairAsk !== null) {
        result = { ...result, askNext: repairAsk };
      }
      /**
       * What the model said it took in, against what the platform actually
       * did with it (ACC d).
       *
       * "Gambling and tobacco avoided, got it" — and nothing was recorded:
       * the phrases matched nothing in the taxonomy, the step stayed open,
       * and the reply said otherwise. The model cannot know whether a
       * write landed; the runtime does. So every step the model put a
       * value against this turn must have gone somewhere the runtime can
       * account for — recorded, held for a yes, carried, set aside,
       * refused and said so, or already on the record. Anything else is
       * said plainly, from the runtime's result and in the step's own
       * terms, and never left to the model's acknowledgement.
       */
      const partly = partlyPlaced.find(
        (item) =>
          recorded.includes(item.step.stepKey) ||
          nextPending.some((held) => held.stepKey === item.step.stepKey),
      );
      if (partly !== undefined && repairAsk === null) {
        const list = (items: readonly string[]) =>
          items.length <= 1
            ? (items[0] ?? "")
            : `${items.slice(0, -1).join(", ")} and ${items.at(-1) ?? ""}`;
        const onRecord = recorded.includes(partly.step.stepKey);
        const next =
          result.askNext === null ? undefined : steps.get(result.askNext);
        reply = [
          onRecord
            ? `I've put down ${list(partly.placed)}.`
            : `I have ${list(partly.placed)} ready to put down.`,
          `I couldn't find ${list(partly.unplaced)} in the list I can record, so ${partly.unplaced.length === 1 ? "it isn't" : "they aren't"} on your record — tell me another way to say ${partly.unplaced.length === 1 ? "it" : "them"}, or pick the nearest from the list.`,
          next === undefined || next.stepKey === partly.step.stepKey
            ? ""
            : askAgain(next, input),
        ]
          .filter((part) => part.length > 0)
          .join(" ");
      }
      const heldNowPhrases = categoryPhrasesThisTurn.filter((item) =>
        phrasesHeld.includes(item.stepKey),
      );
      const firstHeld = heldNowPhrases[0];
      if (firstHeld !== undefined && repairAsk === null) {
        // Heard this turn and kept for later (round 2, #1): said as held,
        // never as recorded, whatever the model's reply called it.
        const heldStep = steps.get(firstHeld.stepKey);
        const next =
          result.askNext === null ? undefined : steps.get(result.askNext);
        reply = [
          `I've got ${firstHeld.phrases.join(" and ")}${heldStep === undefined ? "" : ` for ${noun(heldStep)}`} — I can't put it on your record until the rest of the setup is in place, so I'm holding it and it goes in as soon as it can.`,
          next === undefined || next.stepKey === firstHeld.stepKey
            ? ""
            : askAgain(next, input),
        ]
          .filter((part) => part.length > 0)
          .join(" ");
      }
      if (takingAnswers && repairAsk === null && needsScale === undefined) {
        const carriedNow = new Set(
          carriedFor(input.onboardingSessionId, view).map((c) => c.stepKey),
        );
        const accounted = new Set<string>([
          ...recorded,
          ...skipped,
          ...unsaved,
          ...nextPending.map((held) => held.stepKey),
          ...rejected.map((step) => step.stepKey),
          ...unresolved.map((item) => item.step.stepKey),
          ...unscaled.map((item) => item.step.stepKey),
          ...spokenUploads.map((step) => step.stepKey),
          ...carriedNow,
          ...phrasesHeld,
          ...view.responses.map((response) => response.stepKey),
        ]);
        const claimed = [
          ...result.answers.map((answer) => answer.stepKey),
          ...categoryPhrases.map((item) => item.stepKey),
        ];
        const missed = [...new Set(claimed)]
          .filter((key) => !accounted.has(key))
          .map((key) => steps.get(key))
          .filter((step): step is OnboardingStepManifest => step !== undefined);
        const first = missed[0];
        if (first !== undefined) {
          for (const step of missed) {
            noteUnrecorded(
              input.onboardingSessionId,
              step.stepKey,
              input.utterance,
            );
          }
          // The model's reply is not kept in front of this: it is the
          // sentence that claimed the value, and which of its sentences
          // are true only the runtime knows. What did land is on screen;
          // what did not is said, and asked now, while it is fresh.
          // Never a step label quoted at the person (founder round 2, a).
          reply = `That didn't fit anything I can record for this one yet, so it isn't down. ${askWithChoices(first, input)}`;
          result = { ...result, askNext: first.stepKey };
        }
      }
      if (deferredUpload) {
        reply = `${reply.trim()} ${UPLOAD_LINE}`.trim();
        if (
          result.askNext !== null &&
          steps.get(result.askNext)?.configuration.stepType ===
            "document_upload"
        ) {
          result = { ...result, askNext: null };
        }
      }
      /**
       * A raise amount said with its currency answers the currency step
       * too: "three hundred million dollars" was recorded as an amount and
       * then asked what currency it was in.
       */
      const amountStep =
        recorded.find((key) => /\.target_amount$/.test(key)) ??
        nextPending.find((p) => /\.target_amount$/.test(p.stepKey))?.stepKey;
      if (amountStep !== undefined) {
        const currencyKey = amountStep.replace(/\.target_amount$/, ".currency");
        const currencyStep = steps.get(currencyKey);
        const spokenCurrency = currencyFromUtterance(input.utterance);
        if (
          currencyStep !== undefined &&
          statuses.get(currencyKey) !== "COMPLETED" &&
          spokenCurrency !== null &&
          optionsOf(currencyStep).some((o) => o.key === spokenCurrency)
        ) {
          await commit(currencyKey, {
            type: "SINGLE_SELECT",
            optionKey: spokenCurrency,
          });
          if (result.askNext === currencyKey) {
            result = { ...result, askNext: null };
          }
        }
      }
      // 6. Nothing left to ask: the setup completes through the runtime's
      // own path and Q takes the person home.
      const stillRequired = view.progress.eligibleSteps.filter(
        (step) =>
          step.required &&
          step.status !== "COMPLETED" &&
          step.status !== "SKIPPED",
      );
      if (
        (recorded.length > 0 || skipped.length > 0) &&
        view.session.status === "ACTIVE" &&
        view.progress.canComplete &&
        stillRequired.length === 0
      ) {
        try {
          view = await completeOnboardingSession(
            input.session,
            input.onboardingSessionId,
            { expectedSessionVersion: view.session.version },
          );
          const finished = finishedDestination(input.journeyType);
          navigate = finished.navigate;
          reply = `${reply} ${finished.line}`;
        } catch (error: unknown) {
          logger.warn({ err: error }, "interview completion was not accepted");
        }
      }
      // A lookup is a question for Q: the research tools, under the
      // person's own authority, with the answer spoken back.
      const lookup =
        result.intent === "LOOKUP" && result.lookup !== null
          ? result.lookup
          : null;
      /**
       * The subject this journey is about, once it is named. A founder's
       * company, or an investor's organisation — never the person. Read
       * from what the runtime has actually recorded, so a value the model
       * proposed and nobody confirmed is not spoken as the name.
       *
       * It is no longer a reason to research. The interview used to look
       * the subject up on the first turn after the name landed, whatever
       * that turn was — which is how "what else should I look for?" sent
       * Q to the public web about Zino Aviation (CQ-QX-005 §11). The
       * public presence of a named subject is read detached, off the
       * committed response, by the presence path; in the conversation,
       * research runs only when the person asks for something real.
       */
      const subjectName = (() => {
        const key =
          input.journeyType === "founder"
            ? "F1.company_name"
            : "I0.organisation_name";
        const recordedValue = view.responses.find((r) => r.stepKey === key);
        if (recordedValue === undefined) return null;
        const step = steps.get(key);
        const described = describeValue(step, recordedValue.value).trim();
        return described.length === 0 ? null : described;
      })();

      /**
       * Whether this turn goes to the public web at all (CQ-QX-005 §11,
       * §13): the core's policy, over the reading and the state. Only an
       * explicit request for something real, named and current runs; an
       * answer turn never does; a route that is down is not offered.
       */
      const research: ResearchDecision | null = disposition.answer
        ? decideResearch(conversation, reading, {
            available: researchAvailable,
          })
        : null;

      /**
       * A question the interview can answer itself (QX-004 core gate §8).
       *
       * The model said which of the two they meant; the sentence is
       * written here, from the step and the session. It never becomes a
       * question for Q, so it costs no run and arrives even when every
       * provider is down — which is exactly when somebody is most likely
       * to be asking where they have got to.
       */
      const fromState =
        result.answerFromState === "OPTIONS"
          ? optionsSentence(view)
          : result.answerFromState === "PROGRESS"
            ? progressSentence(view, steps)
            : null;
      if (fromState !== null) {
        /**
         * The runtime's account REPLACES the model's, it does not follow
         * it (QX-004 core gate §1).
         *
         * Appending left both on screen, and the model's came first. Live:
         * "we have your type, which is Angel, and your firm, Zino
         * Aviation" — read out of its memory of the conversation, against
         * a session that held nothing, because every provider had been
         * down while those answers were given. A person reading that has
         * been told their onboarding is further along than it is, which is
         * the one thing a progress answer must never do.
         *
         * Describing what is held is the runtime's job, because only the
         * runtime has read it. The model's part is saying WHICH question
         * was asked; it keeps that, and it does not keep the answer.
         */
        reply =
          result.answerFromState === "OPTIONS"
            ? `${reply.trim()} ${fromState}`.trim()
            : fromState;
      }

      /**
       * Where the conversation returns to once an interruption is over:
       * the question Q had open when they asked, else the one in hand.
       * Said the way Q asks it, for the caller to speak after a research
       * result, and returned as `asking` so the screen keeps the choices.
       */
      const resumeKey =
        conversation.research?.resumeTopic ??
        conversation.resumeTopic ??
        conversation.asked?.topic ??
        view.currentStep?.stepKey ??
        null;
      const resumeStep = resumeKey === null ? undefined : steps.get(resumeKey);
      const resume =
        resumeStep === undefined
          ? null
          : {
              stepKey: resumeStep.stepKey,
              question: askAgain(resumeStep, input),
            };

      let questionForQ: string | null = null;
      let researching: string | null = null;
      if (fromState !== null) {
        dispatch({ type: "QUESTION_ANSWERED" });
      } else if (research !== null && research.run) {
        // The model's own phrasing of what to look up, where it gave one;
        // the person's question otherwise. Either way bounded words.
        questionForQ =
          lookup !== null
            ? lookupQuestion(lookup.kind, lookup.query)
            : (result.questionForQ ?? research.question);
        researching = (reading.question?.text ?? questionForQ).slice(0, 200);
        dispatch({
          type: "RESEARCH_STARTED",
          question: questionForQ,
          resumeTopic: research.resumeTopic,
        });
        if (research.announceSourceChange) {
          reply =
            `${reply.trim()} What I know from you isn't enough for that, so I'm going to the public web for it.`.trim();
        }
      } else if (research !== null && !research.run) {
        /**
         * A question, answered here rather than sent away (CQ-QX-005 §9,
         * §13). ADVICE and the like the model answered in its reply. A
         * request for something real that cannot be looked up right now
         * is told so, narrowly, and the open question is returned to —
         * never "I'll look at that" for a look-up nothing will run.
         */
        const promisedLookup =
          result.questionForQ !== null || result.intent === "LOOKUP";
        if (
          promisedLookup &&
          (research.because === "UNAVAILABLE" ||
            research.because === "EXHAUSTED" ||
            research.because === "ALREADY_RUNNING")
        ) {
          const notice =
            research.because === "ALREADY_RUNNING"
              ? "I'm still on the last look-up; I'll bring that back as soon as it lands."
              : subsystemNotice("RESEARCH", research.because === "EXHAUSTED");
          reply =
            resume === null ? notice : `${notice} ${resume.question}`.trim();
        }
        dispatch({ type: "QUESTION_ANSWERED" });
        if (result.askNext === null && resume !== null) {
          result = { ...result, askNext: resume.stepKey };
        }
      }

      /**
       * Q may not say it saved something the runtime refused (QX-004 §0.5).
       *
       * The reply is the model's prose and the commits are the runtime's
       * result; nothing connected them, so a rejected answer could still
       * be read back as "got it". The model's words are not evidence that
       * anything happened. Where a commit was refused the person is told
       * so plainly, in place of whatever the model believed.
       */
      for (const stepKey of unsaved) {
        noteUnrecorded(
          input.onboardingSessionId,
          stepKey,
          input.utterance.length > 0 ? input.utterance : stepKey,
        );
      }
      if (unsaved.length > 0 && recorded.length === 0) {
        /**
         * An answer the journey would not take yet.
         *
         * It has prerequisites, and a person who answers ahead of one gets
         * their answer refused. Q used to report that as "I couldn't save
         * that just now" and ask for the same thing again, so the person
         * said the same thing again and it was refused again — a loop
         * built out of two components each behaving correctly.
         *
         * The service says why and says which step it wants first. Both
         * are used: its sentence is what the person hears, and the step it
         * named is what Q asks, rather than Q guessing at an order it does
         * not own.
         */
        const refusal = refusals.find(
          (item) => item.because !== null || item.needs !== null,
        );
        const needed =
          refusal?.needs === undefined || refusal.needs === null
            ? undefined
            : [...steps.keys()].find(
                (key) => key.split(".").at(-1) === refusal.needs,
              );
        const neededStep = needed === undefined ? undefined : steps.get(needed);
        const ask =
          neededStep === undefined ? undefined : toOpenStep(neededStep, view);
        /**
         * What the person hears is composed here, from the step the
         * service named and that step's own question.
         *
         * The service's validation message is a diagnostic written for
         * whoever reads the logs; speaking it would make a backend string
         * the UX contract, and it would drift. The structured half — the
         * prerequisite code — decides the behaviour, and Q says it in its
         * own words, naming the thing it could not save so the person can
         * see why one follows the other.
         */
        const held = unsaved
          .map((stepKey) => steps.get(stepKey)?.configuration.prompt)
          .find((prompt) => prompt !== undefined);
        const about =
          held === undefined
            ? "that"
            : `that (${held.replace(/\?+$/, "").toLowerCase()})`;
        /**
         * A prerequisite Q cannot put on screen yet.
         *
         * The investor journey refuses anything in I2 until a mandate is
         * chosen, and the mandate step is a choice among drafts the view
         * only carries while that step is the current one — so `ask` is
         * empty even though the service named the step perfectly well.
         * Before this, that fell through to "That one didn't go in" plus
         * the refused step's own question, which is the loop the comment
         * above warns about: the person answers it again, the same
         * prerequisite refuses it again (local, 2026-09-23: a cheque
         * range and then the stages behind it, both lost this way).
         *
         * So the prerequisite is named from the step's own prompt, and
         * what Q asks next is the question it was already on. The refused
         * step is never what Q returns to: asking for a thing that cannot
         * be saved yet is asking to be told it twice.
         */
        const neededQuestion =
          ask?.question ??
          (neededStep === undefined ? undefined : questionFor(neededStep));
        /**
         * Where Q goes when it cannot ask for the prerequisite.
         *
         * Not every refusal names a step. The founder journey answers "an
         * active organisation context is required" — true, and there is no
         * step key in it, because the organisation is made by an earlier
         * step's write target rather than being a step of its own. Falling
         * back to the refused step's own question is the worst available
         * move: it is the one question guaranteed to be refused again, and
         * local on 2026-09-23 it was, four turns running, with "That one
         * didn't go in" in front of it each time.
         *
         * The session already knows what comes next, and the journey owns
         * that order. So Q goes back to the question it was on and never
         * to the step that was just refused.
         */
        const current =
          view.currentStep === null
            ? undefined
            : steps.get(view.currentStep.stepKey);
        const resume = neededQuestion ?? (current && questionFor(current));
        reply =
          ask !== undefined && ask !== null
            ? `Before I can save ${about}, I need one thing first. ${neededQuestion ?? ask.question}`
            : resume !== undefined
              ? `I'll come back to ${about} — there's something the setup wants first. ${current === undefined ? resume : askAgain(current, input)}`
              : "I couldn't save that just now — it hasn't gone in. Let's come back to it.";
        result = {
          ...result,
          askNext:
            ask !== undefined && ask !== null
              ? (needed ?? null)
              : (view.currentStep?.stepKey ?? needed ?? null),
        };
      } else if (unsaved.length > 0) {
        /**
         * Some of the turn landed and some did not (round 2, #2). The
         * model's words may call it all "noted"; the runtime knows better,
         * so the account is its own: what went down, what is being held
         * for the moment the setup can take it, and then the question.
         */
        const heldLabels = unsaved
          .map((key) => steps.get(key))
          .filter((step): step is OnboardingStepManifest => step !== undefined)
          .map((step) => noun(step));
        const downLabels = recorded
          .map((key) => steps.get(key))
          .filter((step): step is OnboardingStepManifest => step !== undefined)
          .map((step) => noun(step));
        const list = (items: readonly string[]) =>
          items.length <= 1
            ? (items[0] ?? "")
            : `${items.slice(0, -1).join(", ")} and ${items.at(-1) ?? ""}`;
        const next =
          result.askNext === null ? undefined : steps.get(result.askNext);
        reply = [
          downLabels.length > 0
            ? `I've put down your ${list(downLabels)}.`
            : "",
          `Your ${list(heldLabels)} ${heldLabels.length === 1 ? "isn't" : "aren't"} on the record yet — the setup needs something else first — so I'm holding ${heldLabels.length === 1 ? "it" : "them"} and will add ${heldLabels.length === 1 ? "it" : "them"} the moment it can.`,
          next === undefined ? "" : askAgain(next, input),
        ]
          .filter((part) => part.length > 0)
          .join(" ");
      }

      // Last, so that a runtime-composed line is held to the same rule as
      // the model's own: nothing leaves here carrying a name Capital Q
      // does not hold.
      // The recorded name first; failing that, the one they registered
      // with. Both are things Capital Q actually holds — one confirmed,
      // one they typed — and naming the registered one back is the whole
      // point of having it. Only when there is neither does the sentence
      // fall back to "your organisation".
      reply = withKnownName(
        reply,
        subjectName ?? input.signup?.organisationName ?? null,
      );

      /**
       * A value the runtime is holding must be the thing Q asks about
       * (QX-004 core gate §4A).
       *
       * Money and exclusions are read back before they are recorded, which
       * is deliberate: they are the answers an investor is judged on. But
       * the holding is the runtime's and the asking was the model's, and
       * the two came apart. Live: asked for a minimum cheque, the person
       * said "around seventy-five thousand"; Q replied "Got it — minimum
       * cheque is around seventy-five thousand dollars" and asked for the
       * typical cheque instead. The value sat pending, nobody ever
       * confirmed it, every later answer was refused for wanting it, and
       * the journey stopped there with Q having said "got it".
       *
       * So when this turn put something in the runtime's hands, the
       * runtime asks for it, in the step's own terms. The model's
       * acknowledgement is kept — it read the value correctly — and the
       * question after it is replaced, because a question about the next
       * step is what loses the one in hand.
       */
      /**
       * An opening with something already held (E3): a reload, or coming
       * back to the interview. The first thing Q says is the confirmation
       * it is actually waiting on — not whatever the model would open
       * with — so that the person's "yep" answers the question they can
       * see, and never confirms one they cannot.
       */
      const opening = input.utterance.trim().length === 0;
      const heldNow = nextPending.find((item) => {
        if (opening) return true;
        const before = pending.find((was) => was.stepKey === item.stepKey);
        // New to the runtime's hands, or the same step holding a different
        // value than it was. A correction during confirmation ("no, seven
        // hundred and fifty") replaces the candidate rather than adding
        // one, and it needs reading back exactly as the first value did —
        // it is the one that would otherwise be written unseen.
        //
        // By value, not by the sentence describing it. A model asked about
        // a held cheque will sometimes restate it rather than decide it,
        // and "50000" one turn and "£50,000" the next is the same money.
        // Comparing the prose made every restatement look like a
        // correction, so Q read the same figure back turn after turn,
        // never committed it, and dropped whatever else was said in the
        // meantime (local, 2026-09-23: "pre-seed and seed, mostly in the
        // UK" went nowhere twice).
        return (
          before === undefined ||
          canonicalJsonStringify(before.value) !==
            canonicalJsonStringify(item.value)
        );
      });
      if (
        heldNow !== undefined &&
        fromState === null &&
        needsScale === undefined &&
        // A value held because a tension names it is asked about in the
        // model's own words — the analyst's challenge — not read back
        // flat as "is that right?" (CQ-QX-005 §15).
        !tense.has(heldNow.stepKey)
      ) {
        const heldStep = steps.get(heldNow.stepKey);
        // Said the way a person says it, not the way it is stored: this
        // sentence is the single most common place a raw figure reached
        // somebody. "Minimum cheque: 50000. Is that right?" was a real
        // line Q said out loud.
        const question =
          heldStep === undefined
            ? `Is ${heldNow.spoken} right?`
            : `${askLabel(heldStep)}: ${heldNow.spoken}. Is that right?`;
        // Keep the model's first sentence, which is its reading of what
        // they said, and drop whatever it asked after it.
        //
        // Unless that sentence is itself a question, in which case the
        // model has already read the value back and asking again produces
        // "About fifty thousand dollars, is that right? Minimum cheque:
        // 50000. Is that right?" — two guards, one thought, said twice.
        //
        // And when it is NOT a question, it is dropped rather than kept in
        // front: the model's lead can disagree with the value the runtime
        // is holding — "I didn't quite catch that. Where do you invest:
        // West Africa, Nigeria, Ghana. Is that right?" — and of the two,
        // the one that read the value out of the runtime's own hands is
        // the one worth saying.
        const acknowledgement = /^[^.!?]*[.!?]/.exec(reply.trim())?.[0] ?? "";
        // Except when they also asked something (v9, E1): the model's
        // reply is then the answer to their question, and dropping it
        // would lose the question the way v8 did. The read-back follows it.
        reply = opening
          ? question
          : disposition.answer && reading.question !== null
            ? `${reply.trim()} ${question}`.trim()
            : acknowledgement.endsWith("?")
              ? acknowledgement
              : question;
        result = { ...result, askNext: heldNow.stepKey };
      }
      /**
       * A returning person is never met as new (ACC mobile pass).
       *
       * The screen already says "Welcome back. We already covered …" from
       * the session's own state; Q's opener then said "Good to meet you,
       * Ama." — two openings, one of them wrong. When anything is already
       * on the record, the opening is the next question and nothing
       * before it: the returning line is the platform's, derived from
       * state, and on a call (where there is no such line on screen) it is
       * said in front of the question.
       */
      if (
        opening &&
        heldNow === undefined &&
        view.responses.length > 0 &&
        fromState === null
      ) {
        // The question that was on screen before the reload, when it is
        // still open; then the journey's own current step; the model's
        // choice last (ACC round 3 #4: a reload opened on a different step).
        const stillOpen = (key: string | null | undefined): key is string =>
          key !== null &&
          key !== undefined &&
          view.progress.eligibleSteps.some(
            (e) =>
              e.stepKey === key &&
              e.status !== "COMPLETED" &&
              e.status !== "SKIPPED",
          );
        const nextKey = stillOpen(conversation.asked?.topic)
          ? conversation.asked.topic
          : stillOpen(view.currentStep?.stepKey)
            ? view.currentStep.stepKey
            : result.askNext;
        const next = nextKey === null ? undefined : steps.get(nextKey);
        if (next !== undefined && toOpenStep(next, view) !== null) {
          const question = askWithChoices(next, input);
          reply =
            input.channel === "voice" ? `Welcome back. ${question}` : question;
          result = { ...result, askNext: next.stepKey };
        }
      }

      /**
       * Moving forward means moving past what is in between.
       *
       * Somebody who says "skip the optional detail, I'd like to finish"
       * is asking to leave a run of steps, not the next one. Q would jump
       * to the required step at the end, set aside exactly one on the way,
       * and be back in the optional chain a turn later asking about
       * customer types — the person agreeing to skip, and then being
       * walked through the thing they skipped, fifteen times (local,
       * 2026-09-22).
       *
       * So when Q asks for a step further along than where the journey is,
       * every OPTIONAL step in between is set aside in the same turn.
       * Required steps are never skipped — they are the journey's own
       * decision about what it cannot do without, and a person cannot
       * talk their way past one. The ordering comes from the definition
       * rather than from a list kept here.
       */
      if (result.skipRemainingOptional) {
        const answered = new Set(view.responses.map((r) => r.stepKey));
        const skippedAlready = new Set(skipped);
        // Every optional step still open, in the definition's own order.
        // The next required one is where Q goes; the platform decides how
        // far "the rest" reaches, and it never reaches a required step.
        const ordered = [...steps.values()].sort(
          (a, b) => a.sequenceOrder - b.sequenceOrder,
        );
        const nextRequired = ordered.find(
          (step) => step.required && !answered.has(step.stepKey),
        );
        {
          for (const step of ordered) {
            if (step.required) continue;
            if (
              nextRequired !== undefined &&
              step.sequenceOrder >= nextRequired.sequenceOrder
            )
              continue;
            if (answered.has(step.stepKey)) continue;
            if (skippedAlready.has(step.stepKey)) continue;
            try {
              view = await skipOnboardingStep(
                input.session,
                input.onboardingSessionId,
                step.stepKey,
                { expectedSessionVersion: view.session.version },
                randomUUID(),
              );
              skipped.push(step.stepKey);
            } catch (error: unknown) {
              // One step the journey will not set aside is not a reason
              // to stop setting aside the others.
              logger.warn(
                { err: error, stepKey: step.stepKey },
                "interview skip of an intervening step was not accepted",
              );
              continue;
            }
          }
          if (nextRequired !== undefined) {
            result = { ...result, askNext: nextRequired.stepKey };
          }
        }
      }

      /**
       * What Q asks next, never the thing it has just written.
       *
       * Repeated asking is the repair ladder's business now (above): it
       * counts per topic and changes strategy every time. What is left
       * here is one structural guard. A correction that landed ("no — I'm
       * an angel, not a fund") was recorded, and the model then asked the
       * same step again in its own words, which reads as Q not having
       * heard the correction it just made (live, 2026-09-24). A step
       * recorded this turn and not held for a yes is settled; the journey
       * knows what comes next, so that is what is asked.
       */
      /**
       * Never a raw step label as Q's line (adversarial round 1, #8).
       *
       * "Your firm" and "Typical cheque" reached the person as the whole of
       * what Q said: a model that echoes a label, or a turn whose reply is
       * the step's own prompt. A reply that IS a step's label — compared
       * against the platform's own labels, nothing else — is replaced by
       * that step asked properly.
       */
      const bareLabel = (() => {
        const said = reply
          .trim()
          .replace(/[.?!:]+$/, "")
          .toLowerCase();
        if (said.length === 0 || said.length > 80) return undefined;
        return [...steps.values()].find(
          (step) =>
            said ===
              step.configuration.prompt.replace(/[.?!:]+$/, "").toLowerCase() ||
            said ===
              askLabel(step)
                .replace(/[.?!:]+$/, "")
                .toLowerCase(),
        );
      })();
      if (bareLabel !== undefined) {
        reply = askWithChoices(bareLabel, input);
        result = { ...result, askNext: bareLabel.stepKey };
      }
      const settledKey = result.askNext;
      /**
       * Settled before this turn too (adversarial round 1, #7): after a
       * reload the opener re-asked "sectors to avoid", which had been set
       * aside as "nothing to avoid" the turn before. A step the journey
       * already holds as answered or set aside is not asked again unless
       * something about it is being held for a yes.
       */
      const settledBefore =
        settledKey !== null &&
        view.progress.eligibleSteps.some(
          (step) =>
            step.stepKey === settledKey &&
            (step.status === "COMPLETED" || step.status === "SKIPPED"),
        );
      if (
        settledKey !== null &&
        (recorded.includes(settledKey) ||
          skipped.includes(settledKey) ||
          settledBefore) &&
        !nextPending.some((held) => held.stepKey === settledKey) &&
        repairAsk === null
      ) {
        const following = view.currentStep?.stepKey ?? null;
        const next =
          following === null || following === settledKey
            ? undefined
            : steps.get(following);
        // The model's words were a question about the settled step, so
        // they cannot stand beside a different question on screen: Q says
        // what changed (a correction is the one acknowledgement that adds
        // confidence) and asks what the journey wants next.
        const settledStep = steps.get(settledKey);
        const settledValue = view.responses.find(
          (r) => r.stepKey === settledKey,
        )?.value;
        const changed =
          reading.kind === "CORRECTION" &&
          settledStep !== undefined &&
          settledValue !== undefined
            ? describeValue(settledStep, settledValue, currency).trim()
            : "";
        // What changed, named by the step and not by echoing its option
        // label back ("I've changed that to I'm preparing to raise.") —
        // and anything they said that no step holds, acknowledged as kept
        // beside the nearest one (founder round 2, b: "we're in Abuja now").
        const kept = reading.qualitative
          .map((item) => {
            const step = steps.get(item.target);
            return step === undefined
              ? null
              : `I've kept "${item.meaning.slice(0, 120)}" as a note on your ${noun(step)}.`;
          })
          .filter((line): line is string => line !== null);
        const lead = [
          changed.length > 0 && settledStep !== undefined
            ? `I've updated your ${noun(settledStep)}.`
            : "",
          ...kept,
        ]
          .filter((part) => part.length > 0)
          .join(" ");
        reply =
          next === undefined
            ? lead.length > 0
              ? lead
              : reply
            : `${lead} ${askAgain(next, input)}`.trim();
        result = { ...result, askNext: next?.stepKey ?? null };
      }
      /**
       * "I'm done, show me companies now" (adversarial round 2, #3).
       *
       * Asked to leave while something required is still open, Q must not
       * send them away with the setup unfinished — the screen stayed on the
       * required step while Q said "let's head over to your matches". It
       * says what is left and asks it; the optional rest is already
       * skippable through the ordinary skip-the-rest path.
       */
      const leaving =
        navigate === "HOME" || navigate === "DISCOVER" || handoff === "FORM";
      if (
        leaving &&
        handoff === null &&
        view.session.status === "ACTIVE" &&
        !view.progress.canComplete
      ) {
        const stillOpen = view.progress.eligibleSteps
          .filter(
            (step) =>
              step.required &&
              step.status !== "COMPLETED" &&
              step.status !== "SKIPPED",
          )
          .map((step) => steps.get(step.stepKey))
          .find(
            (step): step is OnboardingStepManifest =>
              step !== undefined &&
              step.configuration.stepType !== "document_upload" &&
              toOpenStep(step, view) !== null,
          );
        if (stillOpen !== undefined) {
          navigate = null;
          reply = `Before I take you there, there's one thing the setup still needs. ${askAgain(stillOpen, input)}`;
          result = { ...result, askNext: stillOpen.stepKey };
        }
      }
      /**
       * Q may only offer to finish when the journey can finish (ACC e).
       *
       * "Shall we wrap up and head to your discovery feed?" with a
       * required step still open: the person said "yes, let's go", there
       * was nothing to complete, and they were left where they were. A
       * turn that asks nothing specific — the shape a wrap-up offer takes —
       * while something required is still open names what is left and
       * asks it, from the journey's own state; and when nothing required
       * is left, the journey is completed rather than offered.
       */
      if (
        result.askNext === null &&
        navigate === null &&
        handoff === null &&
        fromState === null &&
        questionForQ === null &&
        !disposition.answer &&
        repairAsk === null &&
        nextPending.length === 0 &&
        view.session.status === "ACTIVE" &&
        input.utterance.trim().length > 0 &&
        // Only a turn that moved the job: a pause, an aside or small talk
        // asks nothing because nothing is being asked, not to finish.
        (reading.kind === "ANSWER" ||
          reading.kind === "CORRECTION" ||
          reading.kind === "CLARIFICATION")
      ) {
        const openRequired = view.progress.eligibleSteps.filter(
          (step) =>
            step.required &&
            step.status !== "COMPLETED" &&
            step.status !== "SKIPPED",
        );
        const nextRequired = openRequired
          .map((step) => steps.get(step.stepKey))
          .find(
            (step): step is OnboardingStepManifest =>
              step !== undefined &&
              step.configuration.stepType !== "document_upload" &&
              // Only a step the screen can put in front of them: the
              // mandate choice exists only while it is the current step.
              toOpenStep(step, view) !== null,
          );
        if (nextRequired !== undefined) {
          const lead = /^[^.!?]*[.!]/.exec(reply.trim())?.[0] ?? "";
          reply =
            `${lead} Before we finish, one more thing. ${askAgain(nextRequired, input)}`.trim();
          result = { ...result, askNext: nextRequired.stepKey };
        } else if (view.progress.canComplete) {
          try {
            view = await completeOnboardingSession(
              input.session,
              input.onboardingSessionId,
              { expectedSessionVersion: view.session.version },
            );
            const finished = finishedDestination(input.journeyType);
            navigate = finished.navigate;
            reply = `${reply.trim()} ${finished.line}`.trim();
          } catch (error: unknown) {
            logger.warn(
              { err: error },
              "interview completion was not accepted",
            );
          }
        }
      }
      if (pausing) {
        result = { ...result, askNext: null };
        reply = result.reply.trim().length > 0 ? result.reply : reply;
      }
      /**
       * A held value is never dropped from the conversation without a yes
       * (ACC round 3 #1: a typical cheque held, then a turn about
       * something else, and it was never asked again). When nothing new
       * was read back this turn and Q is about to ask something other than
       * what it is holding, the oldest held value is asked instead.
       */
      // Not the very turn after it was read back: that would be the same
      // question twice running (a restatement is not a decision either).
      const staleHeld =
        heldNow === undefined && fromState === null && !pausing
          ? nextPending.find(
              (held) =>
                held.stepKey !== inFrontAtStart &&
                pending.some((was) => was.stepKey === held.stepKey),
            )
          : undefined;
      if (
        staleHeld !== undefined &&
        result.askNext !== staleHeld.stepKey &&
        navigate === null &&
        handoff === null
      ) {
        const heldStep = steps.get(staleHeld.stepKey);
        const readBack =
          heldStep === undefined
            ? `Is ${staleHeld.spoken} right?`
            : `${askLabel(heldStep)}: ${staleHeld.spoken}. Is that right?`;
        const answerPart =
          disposition.answer && reading.question !== null ? reply.trim() : "";
        reply = `${answerPart} ${readBack}`.trim();
        result = { ...result, askNext: staleHeld.stepKey };
      }

      /**
       * A question about their own answers, answered from what is stored
       * (ACC round 3 #1, #2). "Did gambling go in as a hard no?" was
       * answered "yes" with nothing stored; "did you save the 25k minimum?"
       * was not answered at all. The model names the steps (v11
       * reading.question.about); the platform says what is on the record,
       * held, carried or missing — then what this turn put down, then the
       * next question. The model's own words about those steps are not used.
       */
      const aboutSteps = (reading.question?.about ?? [])
        .map((key) => steps.get(key))
        .filter((step): step is OnboardingStepManifest => step !== undefined);
      if (aboutSteps.length > 0) {
        const carriedNow = carriedFor(input.onboardingSessionId, view);
        const lines: string[] = [];
        for (const step of aboutSteps) {
          const stored = view.responses.find((r) => r.stepKey === step.stepKey);
          const held = nextPending.find((h) => h.stepKey === step.stepKey);
          const carried = carriedNow.find((c) => c.stepKey === step.stepKey);
          const status = view.progress.eligibleSteps.find(
            (e) => e.stepKey === step.stepKey,
          )?.status;
          if (stored !== undefined) {
            const said = await describeStored(step, stored.value);
            lines.push(
              said.length > 0
                ? `Yes, your ${noun(step)} is on your record: ${said}.`
                : `Yes, your ${noun(step)} is on your record.`,
            );
          } else if (held !== undefined) {
            lines.push(
              `Not yet: your ${noun(step)} (${held.spoken}) is waiting for your yes.`,
            );
          } else if (carried !== undefined) {
            lines.push(
              `Not yet: I have your ${noun(step)} (${carried.spoken}) and it goes in as soon as the setup can take it.`,
            );
          } else if (status === "SKIPPED") {
            lines.push(`Your ${noun(step)} is set aside for now.`);
          } else {
            lines.push(
              `Not yet: nothing is on your record for your ${noun(step)}. Want me to add it?`,
            );
          }
        }
        const aboutKeys = new Set(aboutSteps.map((step) => step.stepKey));
        const putDown = recorded
          .filter((key) => !aboutKeys.has(key))
          .map((key) => steps.get(key))
          .filter((step): step is OnboardingStepManifest => step !== undefined)
          .map((step) => noun(step));
        if (putDown.length > 0) {
          // What went down first, the offer to add last, so the turn ends
          // on the one question it asks.
          const offerAt = lines.findIndex((line) => line.endsWith("add it?"));
          const put = `I've also put down your ${joinWithAnd(putDown)}.`;
          if (offerAt === -1) lines.push(put);
          else lines.splice(offerAt, 0, put);
        }
        const nextKey = result.askNext;
        const nextHeld =
          nextKey === null
            ? undefined
            : nextPending.find((h) => h.stepKey === nextKey);
        const nextStep = nextKey === null ? undefined : steps.get(nextKey);
        const offersToAdd = lines.some((line) => line.endsWith("add it?"));
        if (!offersToAdd && nextHeld !== undefined && nextStep !== undefined) {
          lines.push(
            `${askLabel(nextStep)}: ${nextHeld.spoken}. Is that right?`,
          );
        } else if (
          !offersToAdd &&
          nextStep !== undefined &&
          !aboutKeys.has(nextStep.stepKey)
        ) {
          lines.push(askWithChoices(nextStep, input));
        }
        reply = lines.join(" ");
        if (offersToAdd) {
          result = { ...result, askNext: aboutSteps[0]?.stepKey ?? null };
        }
      } else if (
        disposition.answer &&
        reading.question !== null &&
        reading.question.kind !== "OPTIONS" &&
        reading.question.kind !== "PROGRESS" &&
        fromState === null &&
        read.reply.trim().length > 0 &&
        !reply.includes(read.reply.trim().slice(0, 40))
      ) {
        /**
         * A question inside an answer turn is always answered (ACC round 3
         * #2). Runtime lines — a read-back, a repair, what did not land —
         * replace the model's reply, and with it went the answer to the
         * person's question. The model's answer is put back in front.
         */
        reply = `${read.reply.trim()} ${reply.trim()}`.trim();
      }
      const askStep =
        result.askNext === null ? undefined : steps.get(result.askNext);
      const askOpen = askStep === undefined ? null : toOpenStep(askStep, view);
      /**
       * Nothing the platform told the model is ever said to the person
       * (founder walkthrough F3). The notes, the conversation block and
       * the steps' own notes are instructions and context; a sentence of
       * theirs that comes back verbatim in the reply is removed. Compared
       * against the platform's own words only — nothing of the person's.
       */
      const instructionSentences = [
        ...variables.notes,
        ...variables.conversation.split("\n"),
        ...variables.openSteps.map((step) => step.note ?? ""),
      ]
        .flatMap((text) => text.split(/(?<=[.!?])\s+/))
        .map((sentence) => sentence.trim())
        .filter((sentence) => sentence.length >= 30);
      for (const sentence of instructionSentences) {
        if (reply.includes(sentence)) {
          reply = reply
            .replace(sentence, "")
            .replace(/\s{2,}/g, " ")
            .trim();
        }
      }
      if (
        input.channel === "voice" &&
        askOpen !== null &&
        isTypeable(askOpen.kind) &&
        !typeHintGiven.has(sessionId) &&
        reply.length > 0
      ) {
        typeHintGiven.add(sessionId);
        reply = `${reply} ${TYPE_HINT}`;
      }

      // What the conversation now knows: what was recorded and chosen,
      // what is on screen, and whether the turn moved the job along.
      const settledNow = [...recorded, ...skipped];
      if (settledNow.length > 0) {
        dispatch({
          type: "RECORDED",
          topics: settledNow,
          selections: selectionsThisTurn,
        });
        dispatch({ type: "PROGRESSED" });
      } else if (nextPending.length > 0 || fromState !== null) {
        dispatch({ type: "PROGRESSED" });
      } else {
        dispatch({ type: "STALLED" });
      }
      if (askOpen !== null) {
        dispatch({
          type: "ASKED",
          asked: {
            topic: askOpen.stepKey,
            question: askOpen.question,
            options: (askOpen.options ?? []).map(({ key, label }) => ({
              key,
              label,
            })),
          },
        });
      } else {
        dispatch({ type: "NOTHING_ASKED" });
      }
      // An interruption that is over — the question answered here, no
      // research in flight — has been returned from: the next turn starts
      // on the question just asked, not on a stale resume target.
      if (conversation.research === null && conversation.answering === null) {
        dispatch({ type: "RESUMED" });
      }

      /**
       * The turn, inspectable end to end (CQ-QX-005 §8): raw words →
       * normalised → what the turn was → what was extracted → what was
       * persisted. Logged without the person's values; the verdict says
       * where, if anywhere, it went wrong, and it keeps transcript
       * trouble apart from reasoning trouble.
       */
      const trace: TurnTrace = {
        raw: input.utterance,
        normalised: input.utterance.trim().replace(/\s+/g, " "),
        transcript: reading.transcript,
        classification: {
          kind: reading.kind,
          confidence: reading.confidence,
          question: reading.question?.kind ?? null,
        },
        extracted: {
          targets: result.answers.map((a) => a.stepKey),
          references: reading.references.map((r) => `${r.target}:${r.select}`),
          qualitative: reading.qualitative.map((q) => q.target),
          suggestions: reading.suggestions.map((s) => s.target),
          tensions: reading.tensions.length,
        },
        persisted: {
          recorded,
          held: nextPending.map((p) => p.stepKey),
          skipped,
          refused: unsaved,
          carried: carriedFor(input.onboardingSessionId, view).map(
            (c) => c.stepKey,
          ),
        },
        repair: repairUsed,
        research,
        failures: conversation.failures,
      };
      logger.info(
        {
          verdict: traceVerdict(trace),
          kind: trace.classification.kind,
          confidence: trace.classification.confidence,
          transcript: trace.transcript,
          recorded: trace.persisted.recorded,
          held: trace.persisted.held,
          refused: trace.persisted.refused,
          // Targets only, never the person's words.
          qualitative: trace.extracted.qualitative,
          suggestions: trace.extracted.suggestions,
          tensions: trace.extracted.tensions,
          repair: trace.repair,
          research:
            research === null ? null : research.run ? "RUN" : research.because,
          asking: askOpen?.stepKey ?? null,
        },
        "interview turn traced",
      );
      logger.debug({ trace: loggableTrace(trace) }, "interview turn trace");
      keepThread(reply, inFrontAtStart, askOpen?.stepKey ?? null);
      // Parsed again: a double written for an older shape carries none.
      const offeredNow =
        InterviewConductorV7ResultSchema.shape.offered.safeParse(read.offered);
      offeredBySession.set(
        sessionId,
        offeredNow.success
          ? offeredNow.data.filter((item) => steps.has(item.target))
          : [],
      );

      return {
        reply,
        intent: result.intent,
        asking:
          askOpen === null
            ? null
            : {
                stepKey: askOpen.stepKey,
                kind: askOpen.kind,
                options: askOpen.options ?? [],
                maxChoices: askOpen.maxChoices,
              },
        recorded,
        skipped,
        questionForQ,
        researching,
        navigate,
        handoff,
        pronounce:
          result.intent === "PRONOUNCE" && result.pronounce !== null
            ? result.pronounce
            : null,
        warnings,
        view,
        degraded: false,
        reading,
        resume:
          questionForQ !== null || conversation.answering !== null
            ? resume
            : null,
        qualitative: qualitativeBySession.get(sessionId) ?? [],
        trace,
        // Only for the words the model wrote. A reply the runtime replaced
        // (a repair, a held read-back) must not get a laugh that was meant
        // for other words. Words the runtime only appended leave the
        // model's sentence positions where they were.
        delivery: reply.trim().startsWith(result.reply.trim())
          ? deliveryFromCue(result.delivery)
          : null,
      };
    },
  };
}

export type Interviewer = ReturnType<typeof createInterviewer>;
