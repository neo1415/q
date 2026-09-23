import { randomUUID } from "node:crypto";

import {
  completeOnboardingSession,
  findTaxonomyCandidates,
  getOnboardingSession,
  resolveOnboardingSuggestion,
  skipOnboardingStep,
  submitOnboardingResponse,
  type ApiSession,
} from "@capital-q/api-client";
import {
  canonicalJsonStringify,
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
  createDefaultPromptRegistry,
  DEFAULT_COMMUNICATION_PROFILE,
  renderPrompt,
  InterviewConductorV4ResultSchema,
  type InterviewConductorResult,
  type InterviewConductorV3Variables,
  type InterviewOpenStep,
  type PromptRegistry,
  personalityOf,
  type InterviewDestination,
  type QPersonalityCode,
} from "@capital-q/q-core";

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
  readonly signal?: AbortSignal | undefined;
};

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
};

/**
 * What Q is sent to find out about a subject it has just learned the name
 * of, and how it should come back with it (QX-004 §1.1, §1.2, §1.4, §1.8).
 *
 * Three things this asks for that a plain research prompt does not:
 *
 * **Only what an investment conversation needs.** A founder's company and
 * an investor's organisation have different relevant facts, and neither
 * includes the person's private life. Person is not Organisation.
 *
 * **A source, named once.** So that "where did you get that?" has a true
 * answer, without every sentence carrying a URL.
 *
 * **A question at the end.** Nobody asked for this, and what comes back
 * is a stranger's web page: it is offered for the person to confirm or
 * correct, never read out as though Capital Q now knows it.
 */
function proactiveLookupQuestion(input: {
  readonly journeyType: "founder" | "investor";
  readonly subject: string;
  readonly website: string | null;
}): string {
  const subject = input.subject.trim().slice(0, 200);
  const where =
    input.website === null
      ? `the company "${subject}"`
      : `the public website ${spokenUrl(input.website).slice(0, 200)}`;
  const wanted =
    input.journeyType === "founder"
      ? "what it does and for whom, its product, how it makes money, where it operates, any funding or milestones it has announced, and any customers or partners it names"
      : "what it invests in — stage, sectors, geography, cheque size where it is published — its stated thesis, and any fund or programme and portfolio companies it names";
  return [
    `Look ${input.website === null ? "up" : "at"} ${where} on the public web.`,
    `Report ${wanted}.`,
    'Say it in two or three spoken sentences as unverified public context for this interview, naming the source once ("their site says", "their Crunchbase page says").',
    "Then ask whether that is the right one, so they can confirm or correct it.",
    "Nothing you find is a fact about them until they confirm it.",
  ].join(" ");
}

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
  const current = view.currentStep?.prompt?.trim() ?? "";
  // Only when the step's prompt is actually a question. Some are bare
  // labels — "Your firm" — and reading one out is the exact thing that
  // made the live transcript unusable. A person who asks where they are
  // is better served by the count alone than by a label read at them.
  const where = /\?$/.test(current)
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
      const label = steps.get(step.stepKey)?.configuration.prompt.trim();
      const value = describeValue(
        steps.get(step.stepKey),
        recorded.value,
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

/** Steps whose values are always read back before they are recorded (A §13). */
const MATERIAL_STEP_PATTERNS = [
  /target_amount|cheque|revenue|mrr|arr|customers|valuation|round_size/i,
  /hard_exclusions|sector_exclusions/i,
];

const MAX_OPEN_STEPS = 40;
/** Open steps beyond the current few carry a shortened options list. */
const FULL_OPTIONS_STEPS = 3;
const SHORT_OPTIONS = 10;
/** Warnings before Q leaves the person with the form. */
const WARNINGS_BEFORE_HANDOFF = 2;
const MAX_RECENT_TURNS = 12;
const RECENT_TURN_MAX_CHARS = 600;

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

/** Where a document actually goes, said once when one is mentioned aloud. */
const UPLOAD_LINE =
  "Whenever you like, add the deck or model on screen from your company page; I'll carry on here.";

/** What Q asks when an answer could not be placed against the step. */
/**
 * The step asked again, and nothing else.
 *
 * Split out from `clarificationFor` so that a caller which has already
 * said why it is asking does not say it twice. Two guards each doing
 * their job produced "Sorry — I didn't catch that well enough to write it
 * down. I didn't quite catch that. Which sectors and product areas?" —
 * one apology per guard, stacked, which reads as a machine having an
 * argument with itself. A recovery message has one reason and one
 * question.
 */
function questionFor(step: OnboardingStepManifest): string {
  const c = step.configuration;
  const prompt = c.prompt.replace(/[.?!]+$/, "");
  switch (c.stepType) {
    case "single_select":
    case "multi_select": {
      const labels = optionsOf(step)
        .map((o) => o.label)
        .slice(0, 7);
      return `${prompt}: ${labels.join(", ")}?`;
    }
    case "range":
      return `${prompt.toLowerCase()}? Just the number is fine.`;
    case "short_text":
    case "long_text":
    case "voice_text":
    case "document_upload":
    case "confirmation":
    case "reference_select":
      return `${prompt}?`;
  }
}

/** The step asked again, with a reason in front of it. */
function clarificationFor(step: OnboardingStepManifest): string {
  const c = step.configuration;
  const lead =
    c.stepType === "single_select" || c.stepType === "multi_select"
      ? "I couldn't place that."
      : c.stepType === "range"
        ? "Sorry, I need a number."
        : "I didn't quite catch that.";
  return `${lead} ${questionFor(step)}`;
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

function describeValue(
  step: OnboardingStepManifest | undefined,
  value: OnboardingResponseValue,
): string {
  const options = step === undefined ? [] : optionsOf(step);
  const label = (key: string) =>
    options.find((option) => option.key === key)?.label ?? key;
  switch (value.type) {
    case "SINGLE_SELECT":
      return label(value.optionKey);
    case "MULTI_SELECT":
      return value.optionKeys.map(label).join(", ");
    case "RANGE":
      return value.value;
    case "TEXT":
      return value.text.slice(0, 300);
    case "CONFIRMATION":
      return value.confirmed ? "confirmed" : "not confirmed";
    case "RESOURCE_REFERENCE":
      return `${String(value.resourceIds.length)} recorded`;
  }
}

/**
 * A question with nothing to tap is a question somebody may need to type.
 *
 * Every question that HAS choices now shows them, so the ones left are the
 * ones where only the person's own words will do: a name, a website, a
 * description, a number. Those are exactly the ones where somebody on a
 * bus or in an open-plan office is stuck, and the stage has always had a
 * Type button they had no reason to look for. So Q mentions it, once, on
 * the questions where it is the answer.
 */
function typeable(note: string | undefined): string {
  return [
    note,
    "There are no choices to tap for this one, so if speaking is awkward, mention once that they can tap Type and write it instead. Once only, and never on a question that has options.",
  ]
    .filter((n): n is string => n !== undefined)
    .join(" ");
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
        note: typeable(base.note),
      };
    case "short_text":
      return { ...base, kind: "SHORT_TEXT", note: typeable(base.note) };
    case "long_text":
    case "voice_text":
      return { ...base, kind: "LONG_TEXT", note: typeable(base.note) };
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

/** A reading as a list of strings, whatever shape the model used. */
function asList(raw: string | readonly string[] | boolean): readonly string[] {
  if (typeof raw === "string") return [raw];
  if (typeof raw === "boolean") return [];
  return raw;
}

function isMaterial(stepKey: string): boolean {
  return MATERIAL_STEP_PATTERNS.some((pattern) => pattern.test(stepKey));
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

export function createInterviewer(dependencies: InterviewerDependencies) {
  const registry = dependencies.registry ?? createDefaultPromptRegistry();
  const { gateway, logger } = dependencies;
  const pendingBySession = new Map<string, Pending[]>();

  const pendingFor = (sessionId: string) =>
    pendingBySession.get(sessionId) ?? [];
  const warningsBySession = new Map<string, number>();
  /**
   * Consecutive turns this session could not reach a model (QX-004 §0.4).
   *
   * Bounded degradation needs to know it is the second time. The first
   * failure is worth an apology; repeating the current question after
   * every failure is the loop that made hosted Q unusable — the person
   * answers, the answer is thrown away, the same words come back.
   */
  const degradedBySession = new Map<string, number>();
  /**
   * Subjects this session has already been sent to look up (QX-004 §1.1,
   * §1.2). One proactive lookup per subject: research is bounded, it costs
   * somebody's budget, and a person who has already heard what the public
   * web says about their company does not need to hear it again.
   */
  const researchedBySession = new Map<string, Set<string>>();
  /**
   * The step Q asked last turn, per session.
   *
   * The session's `currentStepKey` is where the journey is; it is not
   * necessarily what Q just asked. When somebody says "skip the rest, I'd
   * like to finish", Q jumps to the required step at the end — and the
   * session's current step stays on the optional one it skipped past. The
   * next turn's prompt carried only the session's version, so the model
   * read "Balanced" against a question about sectors to avoid, made
   * nothing of it, and walked the person back into the optional chain it
   * had just agreed to leave. Their answer went nowhere (local,
   * 2026-09-22).
   *
   * So what Q asked is remembered and told to the model as a platform
   * note. Runtime state, not transcript inference: the runtime composed
   * that question, so the runtime knows what it was.
   */
  const askedBySession = new Map<string, { step: string; question: string }>();
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
   * What Q asked last turn, as a note the model can act on.
   *
   * Only when it differs from the session's current step: saying it twice
   * where they agree is noise, and the interesting case is exactly where
   * they disagree.
   */
  const askedNote = (
    sessionId: string,
    view: OnboardingSessionView,
  ): readonly string[] => {
    const asked = askedBySession.get(sessionId);
    if (asked === undefined) return [];
    if (asked.step === view.session.currentStepKey) return [];
    if (view.responses.some((r) => r.stepKey === asked.step)) return [];
    return [
      `Last turn you asked them: "${asked.question}" (step ${asked.step}). Unless they have plainly changed the subject, what they just said answers THAT step, not the session's current one.`,
    ];
  };

  return {
    /** Forget conversational state for a session (it ended). */
    forget: (sessionId: string) => {
      pendingBySession.delete(sessionId);
      warningsBySession.delete(sessionId);
      degradedBySession.delete(sessionId);
      researchedBySession.delete(sessionId);
      unrecordedBySession.delete(sessionId);
      askedBySession.delete(sessionId);
      tangentsBySession.delete(sessionId);
    },

    turn: async (input: InterviewTurnInput): Promise<InterviewTurnOutcome> => {
      const steps = stepsByKey(input.journeyType);
      let view = await getOnboardingSession(
        input.session,
        input.onboardingSessionId,
      );
      const statuses = new Map(
        view.progress.eligibleSteps.map((s) => [s.stepKey, s.status]),
      );
      const openSteps: InterviewOpenStep[] = [];
      const compact = (open: InterviewOpenStep): InterviewOpenStep => {
        if (openSteps.length < FULL_OPTIONS_STEPS) return open;
        const { note: _note, ...rest } = open;
        if (
          rest.options === undefined ||
          rest.options.length <= SHORT_OPTIONS
        ) {
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
      const knownAnswers = view.responses.map((r) => {
        const step = steps.get(r.stepKey);
        return {
          stepKey: r.stepKey,
          question: step?.configuration.prompt ?? r.stepKey,
          value: describeValue(step, r.value),
        };
      });
      const pending = pendingFor(input.onboardingSessionId);
      // Proposals lifted from the person's documents, still unconfirmed and
      // not already held by Q: Q reads them back like its own readings.
      const proposals = view.pendingSuggestions.filter(
        (p) =>
          p.status === "PENDING" &&
          !pending.some((held) => held.stepKey === p.stepKey),
      );

      const variables: Omit<
        InterviewConductorV3Variables,
        | "operatingMode"
        | "communicationProfile"
        | "communicationGuidance"
        | "environmentNotes"
      > = {
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
        pendingConfirmations: pending.map((p) => ({
          stepKey: p.stepKey,
          question: p.question,
          value: p.spoken,
        })),
        documentProposals: proposals.map((p) => ({
          stepKey: p.stepKey,
          question: steps.get(p.stepKey)?.configuration.prompt ?? p.stepKey,
          value: describeValue(steps.get(p.stepKey), p.suggestedValue),
        })),
        notes: [
          ...signupNotes(input, view, steps),
          ...askedNote(input.onboardingSessionId, view),
          ...notesFor(input.onboardingSessionId, view),
        ],
        recentTurns: input.recentTurns.slice(-MAX_RECENT_TURNS).map((t) => ({
          role: t.role,
          text: t.text.slice(0, RECENT_TURN_MAX_CHARS),
        })),
        utterance: input.utterance.slice(0, 2_000),
        memory: await recallMemory(input.attribution),
      };
      const rendered = renderPrompt<InterviewConductorV3Variables>(registry, {
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
            schema: InterviewConductorV4ResultSchema,
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
        const failures =
          (degradedBySession.get(input.onboardingSessionId) ?? 0) + 1;
        degradedBySession.set(input.onboardingSessionId, failures);
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
        return {
          reply:
            failures === 1
              ? `I can't reach my reasoning service just now, so I haven't taken that in — it hasn't been saved.${earlier} Say it again in a moment and I'll pick it up.`
              : `Still can't reach it, I'm afraid, so that one hasn't gone in either.${earlier} Give it a minute and try again.`,
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
        };
      }

      degradedBySession.delete(input.onboardingSessionId);

      const recorded: string[] = [];
      const skipped: string[] = [];
      const nextPending: Pending[] = [];
      /** Steps the model meant to record that the runtime would not take. */
      const unsaved: string[] = [];
      /** What the owning service said when it refused, and what it wants first. */
      const refusals: OnboardingRefusal[] = [];
      const commit = async (
        stepKey: string,
        value: OnboardingResponseValue,
      ) => {
        try {
          view = await submitOnboardingResponse(
            input.session,
            input.onboardingSessionId,
            {
              stepKey,
              response: { value },
              expectedSessionVersion: view.session.version,
            },
            randomUUID(),
          );
          recorded.push(stepKey);
          return true;
        } catch (error: unknown) {
          logger.warn(
            { err: error, stepKey },
            "interview answer was not accepted",
          );
          unsaved.push(stepKey);
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

      // 1. Decisions on what Q read back last time, and on document proposals.
      for (const decision of result.confirmations) {
        const held = pending.find((p) => p.stepKey === decision.stepKey);
        if (held === undefined) {
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
          await commit(held.stepKey, held.value);
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
      const decided = new Set(result.confirmations.map((d) => d.stepKey));
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
      for (const answer of result.answers) {
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
        if (
          step === undefined ||
          status === undefined ||
          (status === "COMPLETED" && !correcting)
        )
          continue;
        if (step.configuration.stepType === "document_upload") {
          // Nothing said can be a document. What they have is noted in
          // the reply; the step is settled below so it is not asked again.
          spokenUploads.push(step);
          continue;
        }
        const value = toResponseValue(step, answer.value);
        if (value === null) {
          rejected.push(step);
          continue;
        }
        if (isMaterial(step.stepKey) || answer.confidence === "MEDIUM") {
          nextPending.push({
            stepKey: step.stepKey,
            question: step.configuration.prompt,
            value,
            spoken: describeValue(step, value),
          });
          continue;
        }
        await commit(step.stepKey, value);
      }

      // 3. Categories: phrases → the platform's own candidates, read back.
      for (const item of result.categoryPhrases) {
        const step = steps.get(item.stepKey);
        if (
          step === undefined ||
          step.configuration.stepType !== "reference_select"
        )
          continue;
        const c = step.configuration;
        const ids: string[] = [];
        const labels: string[] = [];
        for (const phrase of item.phrases.slice(0, 6)) {
          try {
            const found = await findTaxonomyCandidates(input.session, {
              text: phrase,
              vocabularyCodes: [...c.vocabularyCodes],
            });
            const best = found.candidates[0];
            if (best !== undefined && !ids.includes(best.nodeId)) {
              ids.push(best.nodeId);
              labels.push(best.displayName);
            }
          } catch {
            // The classifier is optional here; nothing is invented in its place.
          }
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
          nextPending.push({
            stepKey: step.stepKey,
            question: c.prompt,
            value,
            spoken: labels.join(", "),
          });
        }
      }

      // 4. Skips, optional steps only; an upload answered aloud is one.
      let deferredUpload = false;
      const toSkip = [
        ...result.skips,
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
      const unplaced = rejected.find(
        (step) => !recorded.includes(step.stepKey),
      );
      if (unplaced !== undefined) {
        reply = clarificationFor(unplaced);
        result = { ...result, askNext: unplaced.stepKey };
      } else if (
        (result.intent === "ANSWER" || result.intent === "CORRECTION") &&
        recorded.length === 0 &&
        nextPending.length === 0 &&
        skipped.length === 0 &&
        rejected.length === 0 &&
        // A turn whose whole point was to move past the optional run took
        // nothing in on purpose. That is not a missed answer.
        !result.skipRemainingOptional
      ) {
        /**
         * The model answered as though it had taken something in, and the
         * runtime has nothing to show for it (QX-004 core gate §5).
         *
         * Live, 2026-09-22: "Zino Aviation, got it." — and the session
         * recorded no organisation name, because the model's structured
         * answer carried none. Nothing was refused, so the guard above
         * had nothing to catch; the acknowledgement was simply untrue,
         * and the step came round again later as if never asked.
         *
         * Decided from the model's own closed fields and the runtime's
         * own result, never from reading its prose: an ANSWER that
         * produced no commit, no confirmation to read back and no skip
         * did not happen. Q says so, and asks the step again in the
         * step's own terms rather than leaving the person to discover it.
         */
        const current =
          view.currentStep === undefined || view.currentStep === null
            ? undefined
            : steps.get(view.currentStep.stepKey);
        logger.warn(
          {
            journey: input.journeyType,
            stepKey: view.currentStep?.stepKey,
            intent: result.intent,
          },
          "the model acknowledged an answer the runtime did not record",
        );
        reply =
          current === undefined
            ? "Sorry — I didn't catch that well enough to write it down. Could you say it once more?"
            : `Sorry — I didn't catch that well enough to write it down. ${questionFor(current)}`;
        result =
          current === undefined
            ? { ...result, askNext: null }
            : { ...result, askNext: current.stepKey };
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
          navigate = "HOME";
          reply = `${reply} That's everything I need for now. I'm taking you to your home.`;
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
       * The subject this journey is about, once it is named (QX-004 §1.1,
       * §1.2).
       *
       * A founder's company, or an investor's organisation — never the
       * person. Read from what the runtime has actually recorded, so a
       * value the model proposed and nobody confirmed does not send
       * anything out of Capital Q.
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
      const website = (() => {
        if (input.journeyType !== "founder") return null;
        const recordedValue = view.responses.find(
          (r) => r.stepKey === "F1.website",
        );
        if (recordedValue === undefined) return null;
        const step = steps.get("F1.website");
        const described = describeValue(step, recordedValue.value).trim();
        return described.length === 0 ? null : described;
      })();

      /**
       * Look the subject up once, as soon as it is known.
       *
       * Reusing the lookup path the model already has rather than adding a
       * second way out: the same tools, the same egress policy, the same
       * treatment of a page's text as data. What comes back is spoken as
       * unverified public context and confirmed by the person before
       * anything is recorded — a search result is provenance, never truth.
       *
       * It never displaces a question the person actually asked.
       */
      const alreadyResearched =
        researchedBySession.get(input.onboardingSessionId) ?? new Set<string>();
      const proactive =
        subjectName !== null && !alreadyResearched.has(subjectName)
          ? {
              subject: subjectName,
              question: proactiveLookupQuestion({
                journeyType: input.journeyType,
                subject: subjectName,
                website,
              }),
            }
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

      const questionForQ =
        fromState !== null
          ? null
          : result.intent === "QUESTION_FOR_Q"
            ? result.questionForQ
            : lookup !== null
              ? lookupQuestion(lookup.kind, lookup.query)
              : (proactive?.question ?? null);
      const researching =
        proactive !== null && questionForQ === proactive.question
          ? proactive.subject
          : null;
      if (researching !== null && proactive !== null) {
        alreadyResearched.add(proactive.subject);
        researchedBySession.set(input.onboardingSessionId, alreadyResearched);
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
              ? `I'll come back to ${about} — there's something the setup wants first. ${current === undefined ? resume : questionFor(current)}`
              : "I couldn't save that just now — it hasn't gone in. Let's come back to it.";
        result = {
          ...result,
          askNext:
            ask !== undefined && ask !== null
              ? (needed ?? null)
              : (view.currentStep?.stepKey ?? needed ?? null),
        };
      } else if (unsaved.length > 0) {
        reply =
          `${reply.trim()} One thing didn't save — I'll ask about it again in a moment.`.trim();
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
      const heldNow = nextPending.find((item) => {
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
      if (heldNow !== undefined && fromState === null) {
        const heldStep = steps.get(heldNow.stepKey);
        const question =
          heldStep === undefined
            ? `Is ${heldNow.spoken} right?`
            : `${heldStep.configuration.prompt.replace(/\?+$/, "")}: ${heldNow.spoken}. Is that right?`;
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
        reply = acknowledgement.endsWith("?") ? acknowledgement : question;
        result = { ...result, askNext: heldNow.stepKey };
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

      const askStep =
        result.askNext === null ? undefined : steps.get(result.askNext);
      const askOpen = askStep === undefined ? null : toOpenStep(askStep, view);
      if (askOpen !== null) {
        askedBySession.set(input.onboardingSessionId, {
          step: askOpen.stepKey,
          question: askOpen.question,
        });
      } else {
        askedBySession.delete(input.onboardingSessionId);
      }
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
      };
    },
  };
}

export type Interviewer = ReturnType<typeof createInterviewer>;
