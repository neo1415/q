import { type ApiSession } from "@capital-q/api-client";
import {
  type OnboardingResponseValue,
  type OnboardingSessionView,
} from "@capital-q/contracts";
import {
  FOUNDER_DEFINITION_V2,
  FOUNDER_INTERVIEW_CUES,
} from "@capital-q/founder-onboarding";
import {
  INVESTOR_DEFINITION_V1,
  INVESTOR_INTERVIEW_CUES,
} from "@capital-q/investor-onboarding";
import type { OnboardingStepManifest } from "@capital-q/onboarding";
import { type ModelGateway } from "@capital-q/model-gateway";
import {
  ConversationTurnReadingSchema,
  type ConversationTurnReading,
  type SpeechDelivery,
  type InterviewConductorResult,
  type InterviewOpenStep,
  type QualitativeMeaning,
  type ReadingConfidence,
  type TurnTrace,
  type InterviewDestination,
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
  /** The steps the reply asks about, in order (CQ-QX-008). */
  readonly askingAbout?: readonly string[] | undefined;
  /** What waits on the person's decision (CQ-QX-008). */
  readonly pending?:
    | {
        readonly recommendations: readonly {
          readonly stepKey: string;
          readonly value: string;
          readonly rationale: string | null;
        }[];
        readonly held: readonly {
          readonly stepKey: string;
          readonly value: string;
        }[];
      }
    | undefined;
  /**
   * How the reply should sound, as the model asked (CQ-VOICE-010). For the
   * speech layer only. It is never part of `reply`, the thread or memory.
   * Absent on every path where the model did not write the reply.
   */
  readonly delivery?: SpeechDelivery | null | undefined;
};

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

function questionFor(step: OnboardingStepManifest): string {
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

export function definitionFor(journey: "founder" | "investor") {
  return journey === "founder" ? FOUNDER_DEFINITION_V2 : INVESTOR_DEFINITION_V1;
}

export function optionsOf(
  step: OnboardingStepManifest,
): readonly InterviewOption[] {
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
function spokenFigure(value: number): string {
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
function spokenMoney(value: number, currency: string | null): string {
  const symbol =
    currency === null ? "" : (CURRENCY_SYMBOLS[currency.toLowerCase()] ?? "");
  return `${symbol}${spokenFigure(value)}`;
}

export function describeValue(
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
export function recordedCurrency(
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

export function toOpenStep(
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

/** A reading as a list of strings, whatever shape the model used. */
function asList(raw: string | readonly string[] | boolean): readonly string[] {
  if (typeof raw === "string") return [raw];
  if (typeof raw === "boolean") return [];
  return raw;
}

function isChoiceStep(step: OnboardingStepManifest): boolean {
  const type = step.configuration.stepType;
  return (
    type === "single_select" ||
    type === "multi_select" ||
    type === "reference_select"
  );
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
function spokenUrl(text: string): string {
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
export function toResponseValue(
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

/**
 * The journeys' exclusion lists, each paired with its sibling (G, the
 * acceptance directive of 2026-09-24).
 *
 * Declared by the journey itself: an EXCLUSION cue sits on the hard step
 * and names its soft one. Nothing here reads a step key or a word; the
 * pair is the definition's own statement that "never show me" and "I'd
 * rather not see" are two representations of one concept.
 */
type ExclusionSibling = { readonly sibling: string; readonly hard: boolean };
export const EXCLUSION_SIBLINGS: ReadonlyMap<string, ExclusionSibling> =
  new Map<string, ExclusionSibling>(
    Object.entries({ ...FOUNDER_INTERVIEW_CUES, ...INVESTOR_INTERVIEW_CUES })
      .filter(([, cue]) => cue.kind === "EXCLUSION")
      .flatMap(([hardKey, cue]) =>
        cue.kind === "EXCLUSION"
          ? [
              [hardKey, { sibling: cue.softStepKey, hard: true }] as [
                string,
                ExclusionSibling,
              ],
              [cue.softStepKey, { sibling: hardKey, hard: false }] as [
                string,
                ExclusionSibling,
              ],
            ]
          : [],
      ),
  );

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
