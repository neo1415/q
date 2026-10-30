import type {
  OnboardingInterviewQuestionView,
  OnboardingResponseValue,
  OnboardingSessionView,
  OnboardingStepType,
  OnboardingStepView,
  OnboardingSuggestionView,
} from "@capital-q/contracts";
import { SPOKEN_QUESTIONS } from "@capital-q/onboarding/spoken-questions";

/**
 * The Q-led interview, planned from persisted state (CQ-PRE-REC-001
 * §16-§18, §21, §26-§27).
 *
 * Nothing here is remembered between renders that the runtime does not
 * already hold. The next question is the session's own current step; what
 * Q picked up is the session's pending suggestions; what Q still needs is
 * its pending questions; progress is its step states. A refresh, a new
 * device or a return next week therefore shows the same interview, because
 * the interview is a reading of the journey, not a transcript of it.
 *
 * Q asks one runtime step at a time, in the words the definition gives it,
 * with the step's own options as quick controls. Tapping an option submits
 * the value it stands for; typing says whatever was typed; both reach the
 * same validated runtime path (CQ-Q-VOICE-001 B §17-§18).
 */

export type JourneyVocabulary = {
  /** A short name for the step, for progress and review lines. */
  readonly stepTitle: (stepKey: string) => string;
  /** A person-readable rendering of a runtime value on a step; labels name reference ids when known. */
  readonly describe: (
    stepKey: string,
    value: OnboardingResponseValue,
    labels?: Readonly<Record<string, string>>,
  ) => string;
  /** The screen that edits this step directly, when there is one. */
  readonly editorFor: (stepKey: string) => string | undefined;
  /** The definition's own type for a step, so a gap can be answered directly (§16). */
  readonly stepType?:
    ((stepKey: string) => OnboardingStepType | undefined) | undefined;
  /** The definition's own options for a select step, offered as a gap's real choices (§21). */
  readonly optionsFor?:
    | ((
        stepKey: string,
      ) => readonly { readonly optionKey: string; readonly label: string }[])
    | undefined;
  /** Friendly review groups (CQ-PRE-REC-001 §29), in order. */
  readonly reviewGroups: readonly {
    readonly label: string;
    readonly stepKeys: readonly string[];
  }[];
  /** Steps that end the journey (a snapshot, a handoff). */
  readonly finalStepKeys: readonly string[];
  /** What the person is setting up, for the composer cue. */
  readonly subject: "founder" | "investor";
  /**
   * A step whose choices are known here without a lookup (the founder's
   * country: the one canonical country list): the matches for what they
   * typed. Undefined: the step searches the taxonomy as usual.
   */
  readonly searchFor?:
    | ((
        stepKey: string,
        text: string,
      ) =>
        | readonly {
            readonly nodeId: string;
            readonly label: string;
            readonly vocabularyLabel: string;
          }[]
        | undefined)
    | undefined;
};

export type QuickChip = {
  readonly label: string;
  /** What tapping it says to Q, when no structured value is known. */
  readonly say: string;
  /** The option this chip stands for, when it stands for one. */
  readonly optionKey?: string | undefined;
  /** The validated value a tap submits directly (§17). */
  readonly value?: OnboardingResponseValue | undefined;
  /** A multi-select option that stands alone ("None of these"): a tap submits at once. */
  readonly exclusive?: boolean | undefined;
};

export type ControlKind =
  | "chips"
  | "multi_chips"
  | "figure"
  | "text"
  | "confirm"
  | "taxonomy"
  | "editor"
  | "upload"
  | "none";

export type QPrompt = {
  readonly stepKey: string;
  readonly text: string;
  readonly why: string | undefined;
  readonly optional: boolean;
  readonly control: ControlKind;
  readonly chips: readonly QuickChip[];
  /** For editor controls: what the button says. */
  readonly editorLabel: string | undefined;
  readonly placeholder: string | undefined;
  /**
   * When the step has exactly one candidate (an investor's only mandate),
   * Q says so and answers it rather than asking; this is what it says on the
   * person's behalf, and the line that explains it (§38).
   */
  readonly autoSay: string | undefined;
  readonly autoNote: string | undefined;
  /** For multi-select and taxonomy controls: how many may be kept. */
  readonly maxSelections: number | undefined;
};

/** A candidate a reference step's server context offers, whatever it calls it. */
type Candidate = { readonly id: string; readonly name: string };

function candidatesOf(
  context: Readonly<Record<string, unknown>> | undefined,
): readonly Candidate[] {
  const list = context?.["candidates"];
  if (!Array.isArray(list)) {
    return [];
  }
  const out: Candidate[] = [];
  for (const item of list) {
    if (typeof item !== "object" || item === null) {
      continue;
    }
    const record = item as Record<string, unknown>;
    const id = record["mandateId"] ?? record["id"] ?? record["nodeId"];
    const name = record["name"] ?? record["label"] ?? record["displayName"];
    if (typeof id === "string" && typeof name === "string" && name.length > 0) {
      out.push({ id, name });
    }
  }
  return out;
}

const MAX_CHIPS = 12;

/**
 * A strength step asks "How firm is that?" in the definition, which is clear
 * on a form under its list and ambiguous in a thread where two such steps
 * follow each other. Q names the subject instead: "How firm on geography?"
 */
const GENERIC_STRENGTH_PROMPT =
  /^how firm (?:is|are) (?:that|this|those|these)[?]?$/i;

export function questionText(
  step: Pick<OnboardingStepView, "stepKey" | "prompt">,
  vocabulary: Pick<JourneyVocabulary, "stepTitle">,
): string {
  const prompt = step.prompt.trim();
  if (GENERIC_STRENGTH_PROMPT.test(prompt)) {
    return `${vocabulary.stepTitle(step.stepKey)}?`;
  }
  // A form label ("Website") is asked as Q asks it, from the one source the
  // interview reads too (QA 25 Oct: "Website" as the heading after a tap).
  return prompt.includes("?")
    ? step.prompt
    : (SPOKEN_QUESTIONS[step.stepKey] ?? step.prompt);
}

/** "Founders who have sold into banks before." reads once, not "before.. Noted." */
function trimSentenceEnd(summary: string): string {
  return summary.replace(/[.!?]+$/, "");
}

/**
 * The step whose options show under Q's words (owner 2026-10-21: Q asked
 * the stage and no choices showed, because they followed the form cursor).
 * Q's question while it is still open on their path; once it is answered
 * or set aside, the form's own current step.
 */
export function promptStepOf(
  view: Pick<OnboardingSessionView, "currentStep" | "progress">,
  asked: OnboardingStepView | null,
): OnboardingStepView | null {
  const open =
    asked !== null &&
    view.progress.eligibleSteps.some(
      (step) =>
        step.stepKey === asked.stepKey &&
        step.status !== "COMPLETED" &&
        step.status !== "SKIPPED",
    );
  return open ? asked : view.currentStep;
}

/** The question Q asks now, from the session's current step. */
export function promptFor(
  step: OnboardingStepView,
  vocabulary: JourneyVocabulary,
): QPrompt {
  const base = {
    stepKey: step.stepKey,
    text: questionText(step, vocabulary),
    why: step.whyQAsks ?? step.supportingText,
    optional: !step.required,
    editorLabel: undefined,
    placeholder: undefined,
    autoSay: undefined,
    autoNote: undefined,
    maxSelections: undefined,
  };
  const presentation = step.presentation;
  switch (presentation.stepType) {
    case "single_select":
      return {
        ...base,
        control: "chips",
        chips: presentation.options.slice(0, MAX_CHIPS).map((option) => ({
          label: option.label,
          say: option.label,
          optionKey: option.optionKey,
          value: { type: "SINGLE_SELECT", optionKey: option.optionKey },
        })),
      };
    case "multi_select": {
      const exclusive = new Set(presentation.exclusiveOptionKeys);
      return {
        ...base,
        control: "multi_chips",
        maxSelections: presentation.maxSelections,
        chips: presentation.options.slice(0, MAX_CHIPS).map((option) => ({
          label: option.label,
          say: option.label,
          optionKey: option.optionKey,
          value: { type: "MULTI_SELECT", optionKeys: [option.optionKey] },
          exclusive: exclusive.has(option.optionKey),
        })),
      };
    }
    case "range":
      return {
        ...base,
        control: "figure",
        chips: [],
        placeholder:
          presentation.unit === undefined
            ? "A number"
            : `A number, in ${presentation.unit}`,
      };
    case "short_text":
    case "long_text":
    case "voice_text":
      return {
        ...base,
        control: "text",
        chips: [],
        placeholder: presentation.placeholder,
      };
    case "confirmation":
      return {
        ...base,
        control: "confirm",
        chips: [
          {
            label: presentation.confirmLabel,
            say: presentation.confirmLabel,
            value: { type: "CONFIRMATION", confirmed: true },
          },
          ...(presentation.declineLabel === undefined
            ? []
            : [
                {
                  label: presentation.declineLabel,
                  say: presentation.declineLabel,
                  value: { type: "CONFIRMATION" as const, confirmed: false },
                },
              ]),
        ],
      };
    case "document_upload":
      return {
        ...base,
        control: "upload",
        chips: [],
        editorLabel: "Add a document",
      };
    case "reference_select": {
      const candidates = candidatesOf(step.context);
      const only = candidates.length === 1 ? candidates[0] : undefined;
      if (
        candidates.length === 0 &&
        presentation.resourceType === "TAXONOMY_NODE"
      ) {
        // Categories: Q's closest fits as chips to keep or adjust, plus a
        // search over the real taxonomy — never a detour to a form (§19).
        return {
          ...base,
          control: "taxonomy",
          chips: [],
          maxSelections: presentation.maxItems,
          // Journey-neutral: an investor choosing sectors has no company
          // to describe (adversarial round 1, #7).
          placeholder: "Or type your answer",
        };
      }
      if (candidates.length > 0) {
        return {
          ...base,
          control: "chips",
          chips: candidates.slice(0, MAX_CHIPS).map((candidate) => ({
            label: candidate.name,
            say: candidate.name,
            optionKey: candidate.id,
            value: {
              type: "RESOURCE_REFERENCE",
              resourceType: presentation.resourceType,
              resourceIds: [candidate.id],
            },
          })),
          ...(only === undefined
            ? {}
            : {
                autoSay: only.name,
                autoNote: `You have one ${vocabulary.stepTitle(step.stepKey).toLowerCase()}, ${only.name}. That's the one we'll define.`,
              }),
        };
      }
      return {
        ...base,
        control: "editor",
        chips: [],
        editorLabel: `Choose ${vocabulary.stepTitle(step.stepKey).toLowerCase()}`,
      };
    }
  }
}

/**
 * Where Q found a suggestion, when it read it in a public source (BIZ-009):
 * the page, for the person to open on tap. Null for what Q picked up from
 * their own words. Provenance on demand, never a badge (R23).
 */
export function publicSourceOf(
  suggestion: OnboardingSuggestionView,
): { readonly url: string; readonly label: string } | null {
  const labels: Readonly<Record<string, string>> = {
    PUBLIC_WEBSITE: "From your website",
    PUBLIC_PROFILE: "From your profile link",
    PUBLIC_REGISTRY: "From a public registry",
    PUBLIC_WEB: "From a public page",
  };
  for (const ref of suggestion.sourceRefs) {
    const label = labels[ref.sourceType];
    if (label === undefined) continue;
    try {
      const url = new URL(ref.sourceId);
      if (url.protocol !== "https:" && url.protocol !== "http:") continue;
      return { url: url.toString(), label };
    } catch {
      continue;
    }
  }
  return null;
}

/** One thing Q picked up, for the inline confirmation card (§21). */
export type PickedUp = {
  readonly suggestion: OnboardingSuggestionView;
  readonly label: string;
  readonly value: string;
  readonly editorId: string | undefined;
};

/**
 * Q's summary of the person's own words, held for their yes (the server's
 * paraphrase rationale, stored as "Q's summary of your words: …").
 */
export function isSummaryOfTheirWords(
  suggestion: Pick<OnboardingSuggestionView, "rationale">,
): boolean {
  const note = suggestion.rationale ?? "";
  return (
    note.startsWith("Q's summary of your words") ||
    note.startsWith("Q's summary of their words")
  );
}

/**
 * What Q picked up for the card: findings from their documents and public
 * pages. Q's summary of what they said is not here (live 2026-10-30,
 * Granary): it is said back in the conversation, where they said it, and
 * their yes there saves it. A card beside it put the same summary to them
 * twice, and the two raced (one regenerated while the other was tapped).
 */
export function pickedUp(
  view: OnboardingSessionView,
  vocabulary: JourneyVocabulary,
  labels?: Readonly<Record<string, string>>,
): readonly PickedUp[] {
  return view.pendingSuggestions
    .filter((suggestion) => !isSummaryOfTheirWords(suggestion))
    .map((suggestion) => ({
      suggestion,
      label: vocabulary.stepTitle(suggestion.stepKey),
      value: vocabulary.describe(
        suggestion.stepKey,
        suggestion.suggestedValue,
        labels,
      ),
      editorId: vocabulary.editorFor(suggestion.stepKey),
    }));
}

/**
 * How a gap is answered in place (CQ-Q-VOICE-001 B §16, §21): the
 * question's own server-built options when it has them; otherwise the
 * step's real options from the definition; otherwise a figure or a line of
 * text; and only when none of those fit, the form.
 */
export type GapControl =
  | { readonly kind: "options" }
  | {
      readonly kind: "choices";
      readonly multi: boolean;
      readonly options: readonly {
        readonly optionKey: string;
        readonly label: string;
      }[];
    }
  | { readonly kind: "figure" }
  | { readonly kind: "text" }
  | { readonly kind: "editor" };

export type StillNeeded = {
  readonly question: OnboardingInterviewQuestionView;
  readonly editorId: string | undefined;
  readonly control: GapControl;
};

function gapControl(
  question: OnboardingInterviewQuestionView,
  vocabulary: JourneyVocabulary,
): GapControl {
  if (question.options.length > 0) {
    return { kind: "options" };
  }
  const stepType = vocabulary.stepType?.(question.stepKey);
  switch (stepType) {
    case "single_select":
    case "multi_select": {
      const options = vocabulary.optionsFor?.(question.stepKey) ?? [];
      return options.length > 0
        ? { kind: "choices", multi: stepType === "multi_select", options }
        : { kind: "editor" };
    }
    case "range":
      return { kind: "figure" };
    case "short_text":
    case "long_text":
    case "voice_text":
      return { kind: "text" };
    case "confirmation":
    case "document_upload":
    case "reference_select":
    case undefined:
      return { kind: "editor" };
  }
}

export function stillNeeded(
  view: OnboardingSessionView,
  vocabulary: JourneyVocabulary,
): readonly StillNeeded[] {
  return (view.pendingQuestions ?? []).map((question) => ({
    question,
    editorId: vocabulary.editorFor(question.stepKey),
    control: gapControl(question, vocabulary),
  }));
}

/** The value a typed gap answer becomes, for the control that was shown. */
export function gapValue(
  control: GapControl,
  text: string,
): OnboardingResponseValue | null {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return null;
  }
  switch (control.kind) {
    case "figure": {
      const digits = trimmed.replace(/[,\s]/g, "");
      return /^-?\d+(?:\.\d+)?$/.test(digits)
        ? { type: "RANGE", value: digits }
        : null;
    }
    case "text":
      return { type: "TEXT", text: trimmed };
    case "options":
    case "choices":
    case "editor":
      return null;
  }
}

/**
 * Q's closest fits for a category step: the pending taxonomy proposal for
 * it, as words (§19). Null when Q has proposed nothing yet.
 */
export type TaxonomyProposal = {
  readonly suggestion: OnboardingSuggestionView;
  readonly nodes: readonly {
    readonly nodeId: string;
    readonly label: string;
  }[];
};

export function isTaxonomySuggestion(
  suggestion: OnboardingSuggestionView,
  stepKey: string,
): boolean {
  return (
    suggestion.stepKey === stepKey &&
    suggestion.suggestedValue.type === "RESOURCE_REFERENCE" &&
    suggestion.suggestedValue.resourceType === "TAXONOMY_NODE"
  );
}

export function taxonomyProposal(
  view: OnboardingSessionView,
  stepKey: string,
  labels: Readonly<Record<string, string>> | undefined,
): TaxonomyProposal | null {
  const suggestion = [...view.pendingSuggestions]
    .filter((candidate) => isTaxonomySuggestion(candidate, stepKey))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
  if (
    suggestion === undefined ||
    suggestion.suggestedValue.type !== "RESOURCE_REFERENCE"
  ) {
    return null;
  }
  return {
    suggestion,
    nodes: suggestion.suggestedValue.resourceIds.map((nodeId) => ({
      nodeId,
      label: labels?.[nodeId] ?? "A category",
    })),
  };
}

/** How many eligible steps are still open, for the small "N left" entry (§16). */
export function remainingCount(view: OnboardingSessionView): number {
  return view.progress.eligibleSteps.filter(
    (step) => step.status !== "COMPLETED" && step.status !== "SKIPPED",
  ).length;
}

export type ProgressLine = {
  readonly label: string;
  readonly done: number;
  readonly total: number;
  readonly current: boolean;
};

/**
 * Subtle progress (§27): the journey's review groups, how many of their
 * eligible steps are settled, and which one holds the current step.
 */
export function progressLines(
  view: OnboardingSessionView,
  vocabulary: JourneyVocabulary,
): readonly ProgressLine[] {
  const status = new Map(
    view.progress.eligibleSteps.map((step) => [step.stepKey, step.status]),
  );
  const current = view.session.currentStepKey;
  return vocabulary.reviewGroups.flatMap((group) => {
    const eligible = group.stepKeys.filter((key) => status.has(key));
    if (eligible.length === 0) {
      return [];
    }
    const done = eligible.filter((key) => {
      const s = status.get(key);
      return s === "COMPLETED" || s === "SKIPPED";
    }).length;
    return [
      {
        label: group.label,
        done,
        total: eligible.length,
        current: current !== null && eligible.includes(current),
      },
    ];
  });
}

/**
 * A person who last touched the interview this long ago is coming back to
 * it; anyone sooner is still in it, whatever the browser did in between
 * (a refresh, "Use the form" and back, a second tab). CQ-Q-VOICE-001 B §26.
 */
export const RESUME_AFTER_MS = 30 * 60 * 1000;

/**
 * The greeting for a returning person (§26), from persisted state only:
 * what is settled, what documents were shared, what remains. No name is
 * used, because none is known here; nothing is claimed that the session
 * does not record. Said only after a genuine absence, measured from the
 * session's own last activity — never from anything the browser kept.
 */
export function welcomeBack(
  view: OnboardingSessionView,
  vocabulary: JourneyVocabulary,
  now: number = Date.now(),
): string | null {
  const lastActivity = Date.parse(view.session.lastActivityAt);
  if (Number.isNaN(lastActivity) || now - lastActivity < RESUME_AFTER_MS) {
    return null;
  }
  const lines = progressLines(view, vocabulary);
  const settled = lines.filter((line) => line.done === line.total);
  const anyDone = lines.some((line) => line.done > 0);
  if (!anyDone) {
    return null;
  }
  const parts: string[] = [];
  if (settled.length > 0) {
    parts.push(
      `We already covered ${joinNames(settled.map((line) => line.label.toLowerCase()))}.`,
    );
  }
  const documents = view.responses.filter(
    (response) =>
      response.value.type === "RESOURCE_REFERENCE" &&
      response.value.resourceType === "EVIDENCE_DOCUMENT",
  );
  const documentCount = documents.reduce(
    (total, response) =>
      response.value.type === "RESOURCE_REFERENCE"
        ? total + response.value.resourceIds.length
        : total,
    0,
  );
  if (documentCount > 0) {
    parts.push(
      documentCount === 1
        ? "Your document is on file."
        : `Your ${String(documentCount)} documents are on file.`,
    );
  }
  const remaining = view.progress.eligibleSteps.filter(
    (step) => step.status !== "COMPLETED" && step.status !== "SKIPPED",
  ).length;
  const questions = view.pendingQuestions?.length ?? 0;
  const proposals = view.pendingSuggestions.length;
  if (proposals > 0) {
    parts.push(
      proposals === 1
        ? "I picked up one thing I still need you to confirm."
        : `I picked up ${String(proposals)} things I still need you to confirm.`,
    );
  }
  if (questions > 0) {
    parts.push(
      questions === 1
        ? "There is one gap I want to close."
        : `There are ${String(questions)} gaps I want to close.`,
    );
  } else if (remaining > 0) {
    parts.push(
      remaining === 1
        ? "One question left."
        : `${String(remaining)} questions left.`,
    );
  }
  return `Welcome back. ${parts.join(" ")}`.trim();
}

/**
 * Q's last line, when it is still the question on the table (ACC
 * adversarial: "reload mid-onboarding → one coherent resume greeting").
 *
 * The thread the server kept ends on Q, and nothing has moved on the
 * session since Q said it: no answer, no tap, no skip. Q is then still
 * asking exactly that, and opening the interview again would only record
 * a second copy of the same question -- one more per reload, which is how
 * a returning person met a stack of openings. Anything later on the
 * session, or a thread that ends on the person, and Q opens as usual.
 */
export function pendingQuestion(
  turns: readonly {
    readonly role: "Q" | "PERSON";
    readonly text: string;
    readonly createdAt: string;
  }[],
  lastActivityAt: string,
): string | null {
  const last = turns.at(-1);
  if (last === undefined || last.role !== "Q") {
    return null;
  }
  const said = Date.parse(last.createdAt);
  const moved = Date.parse(lastActivityAt);
  if (Number.isNaN(said) || Number.isNaN(moved) || said < moved) {
    return null;
  }
  const text = last.text.trim();
  // "Stage: Seed. Noted.", kept after a tap (QA F-129), acknowledges an
  // answer: nothing is asked, and Q opens afresh.
  return text.length === 0 || isTapAcknowledgement(text) ? null : text;
}

/**
 * Q's last line as the question on the table when the screen opens. As
 * `pendingQuestion`, except a line said before an absence (§26): it is
 * history, shown above the welcome back, and Q opens afresh (live 25 Oct
 * e2e: "Understood, we'll stop here" from hours earlier sat below
 * "Welcome back" as if said now). Measured from the line itself, so the
 * opening Q just said is still the question on the next reload.
 */
export function questionOnReturn(
  turns: readonly {
    readonly role: "Q" | "PERSON";
    readonly text: string;
    readonly createdAt: string;
  }[],
  lastActivityAt: string,
  now: number = Date.now(),
  /**
   * They came back to continue (Home's "Finish setup with Q"): a last line
   * of Q's that asks nothing (the pause line, "Pick this up whenever you
   * like") is history, and Q opens again with the open question
   * (production re-test 2026-10-28: the resumed thread ended on the pause
   * line and asked nothing).
   */
  returned = false,
): string | null {
  const pending = pendingQuestion(turns, lastActivityAt);
  if (returned && pending !== null && !pending.includes("?")) return null;
  const said = Date.parse(turns.at(-1)?.createdAt ?? "");
  return pending !== null && now - said < RESUME_AFTER_MS ? pending : null;
}

/**
 * Whether the step's chips belong under Q's current question: before Q
 * has said what it asks (null) they do; after, only when Q asks that step.
 */
export function chipsBelongTo(
  stepKey: string,
  asking: readonly string[] | null,
): boolean {
  return asking === null || asking.includes(stepKey);
}

/**
 * The thread a reload redraws: what the server kept, less Q's last line
 * when that line is still the question on the table, which the screen
 * shows as the question, as it did before the reload (QA F-50: Q's line
 * twice after a reload).
 */
export function redrawnThread<T extends { readonly role: "Q" | "PERSON" }>(
  turns: readonly T[],
  pending: string | null,
): readonly T[] {
  return pending === null || turns.at(-1)?.role !== "Q"
    ? turns
    : turns.slice(0, -1);
}

/**
 * The composer's hint. Q asked about something other than the form's
 * current step, or about a step this screen cannot name (after a reload,
 * `[]`): the step's own hint ("example.com") would contradict Q's question,
 * so it stays neutral (live 24 Oct: "example.com" under "Are you deploying
 * capital right now?").
 */
export function composerHint(
  prompt: Pick<QPrompt, "stepKey" | "control" | "placeholder"> | null,
  asking: readonly string[] | null,
): string | undefined {
  if (prompt === null) return undefined;
  if (asking !== null && !asking.includes(prompt.stepKey)) {
    return "Type your answer";
  }
  if (
    prompt.control === "chips" ||
    prompt.control === "multi_chips" ||
    prompt.control === "confirm"
  ) {
    return "Or type your answer";
  }
  // A step with no hint of its own is still an answer to Q's question,
  // never the general "Ask Q about companies…" (live 25 Oct, run b9-0746:
  // under "what does the company do?").
  return prompt.placeholder !== undefined && prompt.placeholder.length > 0
    ? prompt.placeholder
    : "Type your answer";
}

function joinNames(names: readonly string[]): string {
  if (names.length <= 1) {
    return names[0] ?? "";
  }
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1) ?? ""}`;
}

/**
 * Q's side of the conversation is written by Q (QX-004 core gate: one Q).
 *
 * A composer lived here: it turned what the runtime understood into
 * "Investor type: Angel investor. Noted." and let the next step's raw
 * label -- "Your firm" -- stand as the next question. That was a second
 * conversational implementation, running in the browser, beside the one
 * interviewer in q-api, and it was the poorer of the two. A turn now
 * carries Q's own words and the screen shows them as written; there is
 * deliberately nothing here to fall back to.
 */

/** Q's short acknowledgement of a tapped option (§17-§18). */
/** The receipt `acknowledgeValue` writes ends so; nothing Q asks does. */
const TAP_ACKNOWLEDGEMENT_END = ". Noted.";

/** Whether a line of Q's is the receipt code wrote for a tapped answer. */
export function isTapAcknowledgement(text: string): boolean {
  return text.trim().endsWith(TAP_ACKNOWLEDGEMENT_END);
}

export function acknowledgeValue(
  stepKey: string,
  value: OnboardingResponseValue,
  vocabulary: JourneyVocabulary,
  labels?: Readonly<Record<string, string>>,
): string {
  return `${vocabulary.stepTitle(stepKey)}: ${trimSentenceEnd(vocabulary.describe(stepKey, value, labels))}${TAP_ACKNOWLEDGEMENT_END}`;
}

/** Q's own sentence on screen, and the step it was said about. */
export type QQuestion = {
  readonly stepKey: string;
  readonly text: string;
  /**
   * Q's opening (live acceptance 2026-10-16): shown whatever step the
   * session settles on while it opens. The opening itself records what
   * registration gave (the company name), which moves the step, and the
   * opener was being discarded for the next step's column heading.
   */
  readonly sticky?: boolean;
};

/**
 * What the screen asks: Q's own sentence while the session is still on
 * the step Q asked about (or Q's opening, while it opens), the step's own
 * question otherwise; nothing at all on a silent step.
 */
export function questionShown(
  prompt: { readonly stepKey: string; readonly text: string } | null,
  qQuestion: QQuestion | null,
  silentStep: boolean,
): string | null {
  if (prompt === null) return null;
  if (
    qQuestion !== null &&
    (qQuestion.stepKey === prompt.stepKey ||
      silentStep ||
      qQuestion.sticky === true)
  ) {
    return qQuestion.text;
  }
  return silentStep ? null : prompt.text;
}

/**
 * Q's sentence once a tap has answered (QA F-131, 25 Oct: after "Seed",
 * "CEO" or "Looks right" Q said "Noted." and its opening stayed on screen
 * as the question; the next one showed only after a reload). A tap is the
 * person's answer: Q's earlier sentence, its opening included, is answered
 * and the step the session moved to asks its own question.
 */
export function questionAfterTap(): QQuestion | null {
  return null;
}

/** The most one message to Q may carry (SayOnboardingRequestSchema). */
export const SAY_MAX_CHARS = 2000;

/**
 * A long message as the messages Q can take, in order, cut at sentence
 * ends where it can be and at a space where it cannot (onboarding speed
 * 2026-10-20). A pasted company description over the limit used to fail
 * validation in the browser's action and vanish; every word now reaches Q.
 */
export function splitForQ(
  text: string,
  max: number = SAY_MAX_CHARS,
): readonly string[] {
  const trimmed = text.trim();
  if (trimmed.length <= max) {
    return trimmed.length === 0 ? [] : [trimmed];
  }
  const parts: string[] = [];
  let rest = trimmed;
  while (rest.length > max) {
    const window = rest.slice(0, max);
    const sentenceEnd = Math.max(
      window.lastIndexOf(". "),
      window.lastIndexOf("? "),
      window.lastIndexOf("! "),
      window.lastIndexOf("\n"),
    );
    const space = window.lastIndexOf(" ");
    const cut =
      sentenceEnd >= max / 2 ? sentenceEnd + 1 : space > 0 ? space : max;
    parts.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest.length > 0) {
    parts.push(rest);
  }
  return parts;
}

/**
 * What the thread shows after a look-up Q ran mid-interview, before the
 * live question shows again: transport copy, not a reading of anything
 * the person said. (A pause or a return is the loop's to read, P0-1.)
 */
export const BRIDGE_LINE = "Back to where we were.";

/**
 * The question Q is asking, as the live line under the thread. Live e11
 * (c7): the person corrected their cheque; Q's question joined the thread
 * with their answer, and the same question then stayed as the live line
 * below it until Q's reply landed, so Q seemed to say the same thing twice.
 * The question just answered is not shown again while its reply is
 * pending: `answered` is the line that joined the thread and the question
 * object it came from; once the reply binds a new question object, it
 * shows (even when Q's words are the same).
 */
export function liveQuestionShown<Q>(
  live: string | null,
  answered: { readonly text: string; readonly question: Q } | null,
  question: Q,
): string | null {
  if (live === null) return null;
  if (
    answered !== null &&
    answered.question === question &&
    answered.text === live
  ) {
    return null;
  }
  return live;
}

/** The value a review line shows, or a plain "not yet" (§29). */
/**
 * Whether what Q understood is on screen (QA F-130, 25 Oct): "Here's what
 * I understood. Does it look right?" was asked with nothing of what Q
 * understood shown, so "That's right" confirmed an empty summary. While Q
 * asks a confirmation, the summary it confirms is always shown with it;
 * otherwise only when they open it.
 */
export function reviewShown(
  opened: boolean,
  prompt: { readonly control: ControlKind } | null,
): boolean {
  return opened || prompt?.control === "confirm";
}

export function reviewLines(
  view: OnboardingSessionView,
  vocabulary: JourneyVocabulary,
  labels?: Readonly<Record<string, string>>,
): readonly {
  readonly label: string;
  readonly items: readonly {
    readonly stepKey: string;
    readonly title: string;
    readonly value: string | null;
    readonly editorId: string | undefined;
  }[];
}[] {
  const byStep = new Map(
    view.responses.map((response) => [response.stepKey, response.value]),
  );
  const notes = new Map(
    view.responses.map((response) => [response.stepKey, response.note]),
  );
  const eligible = new Set(
    view.progress.eligibleSteps.map((step) => step.stepKey),
  );
  /**
   * Sweep D8 (2026-10-29): "Based in · Somewhere else" hid what they said.
   * An answer kept in their words beside the catch-all shows those words.
   */
  const shown = (key: string, value: OnboardingResponseValue): string => {
    const note = notes.get(key) ?? null;
    return value.type === "SINGLE_SELECT" &&
      value.optionKey === "other" &&
      note !== null &&
      note.trim().length > 0
      ? note.trim()
      : vocabulary.describe(key, value, labels);
  };
  return vocabulary.reviewGroups
    .map((group) => ({
      label: group.label,
      items: group.stepKeys
        .filter((key) => eligible.has(key))
        .map((key) => {
          const value = byStep.get(key);
          return {
            stepKey: key,
            title: vocabulary.stepTitle(key),
            value: value === undefined ? null : shown(key, value),
            editorId: vocabulary.editorFor(key),
          };
        }),
    }))
    .filter((group) => group.items.length > 0);
}

/**
 * Whether Q's findings from one uploaded document are in the session yet
 * (QA F-69): a processed file is not a read one, and Q is told to read a
 * document back only once its own suggestions from it have arrived.
 */
export function hasFindingsFrom(
  view: Pick<OnboardingSessionView, "pendingSuggestions"> | undefined,
  documentId: string,
): boolean {
  return (view?.pendingSuggestions ?? []).some((suggestion) =>
    (suggestion.sourceRefs ?? []).some(
      (ref) =>
        ref.sourceType === "EVIDENCE_DOCUMENT" && ref.sourceId === documentId,
    ),
  );
}

/** Whether an offer is still waiting for the person in this session view. */
export function stillWaiting(
  view: Pick<OnboardingSessionView, "pendingSuggestions"> | undefined,
  suggestionId: string,
): boolean {
  return (
    view?.pendingSuggestions.some(
      (suggestion) =>
        suggestion.id === suggestionId && suggestion.status === "PENDING",
    ) ?? false
  );
}

/**
 * What Q says after "Keep all": all kept only when every one went through
 * (live 25 Oct e2e: "All kept. Thank you." beside "That didn't go
 * through"). Nothing kept, nothing said: the failure is already on screen.
 */
export function keptAllLine(outcomes: readonly boolean[]): string | null {
  const kept = outcomes.filter(Boolean).length;
  const failed = outcomes.length - kept;
  if (kept === 0) return null;
  if (failed === 0) return "All kept. Thank you.";
  return failed === 1
    ? `Kept ${String(kept)}; one didn't go through. It's still waiting below.`
    : `Kept ${String(kept)}; ${String(failed)} didn't go through. They're still waiting below.`;
}

/** A reading on screen under "I picked up", by the id it was rendered with. */
export type ListedReading = { readonly id: string; readonly label: string };

/**
 * The confirmation's own label while readings wait beside it (QA F-130,
 * coordinator decision A): it says it keeps them, and how many, so one
 * approval covers exactly what is on screen.
 */
export function confirmChipLabel(label: string, listed: number): string {
  if (listed === 0) return label;
  return listed === 1
    ? `${label}, keep this one`
    : `${label}, keep all ${String(listed)}`;
}

/**
 * "That's right" with readings on screen (QA F-130: the review was
 * confirmed and the deck's five read-back facts stayed PENDING). Keeps
 * exactly the readings listed when the confirmation was shown, by the ids
 * they were rendered with, never one that arrived after; one already
 * settled elsewhere is not kept twice. Only when every listed reading kept
 * is the summary confirmed: a failure leaves it unconfirmed, and says which.
 */
export async function keepListedThenConfirm(input: {
  readonly listed: readonly ListedReading[];
  readonly stillWaiting: (id: string) => boolean;
  readonly keep: (id: string) => Promise<boolean>;
  readonly confirm: () => Promise<void>;
}): Promise<{
  readonly confirmed: boolean;
  readonly failed: readonly string[];
}> {
  const failed: string[] = [];
  for (const reading of input.listed) {
    if (!input.stillWaiting(reading.id)) continue;
    if (!(await input.keep(reading.id))) failed.push(reading.label);
  }
  if (failed.length > 0) return { confirmed: false, failed };
  await input.confirm();
  return { confirmed: true, failed };
}

/**
 * Q's line when one Keep did not go through (live 2026-10-30: a Keep came
 * back refused and the card simply vanished). Said, never silent.
 */
export function keepFailedLine(label: string): string {
  return `${label} didn't go through, so it isn't saved yet. Have another look at what's waiting and keep it again.`;
}

/** Q's line when some listed readings did not keep. */
export function notKeptLine(failed: readonly string[]): string {
  return `${failed.join(", ")} didn't go through, so I haven't confirmed the summary yet. ${failed.length === 1 ? "It's" : "They're"} still waiting below.`;
}

/**
 * Where Q's reading of one uploaded document stands (live e2e 25 Oct):
 * findings from it are waiting; or its review finished with nothing new;
 * or it is still being read.
 */
export function documentReading(
  view:
    | Pick<OnboardingSessionView, "pendingSuggestions" | "reviewedDocumentIds">
    | undefined,
  documentId: string,
): "FOUND" | "NOTHING_NEW" | "READING" {
  if (hasFindingsFrom(view, documentId)) return "FOUND";
  return (view?.reviewedDocumentIds ?? []).includes(documentId)
    ? "NOTHING_NEW"
    : "READING";
}

/**
 * What Q could not read in one document (deck reading 2026-10-28): pages
 * that were pictures nobody could transcribe, and a reading a size limit
 * cut short. Said plainly, never hidden behind "nothing new". Null when
 * the document was read in full.
 */
export function documentReadingNote(
  view: Pick<OnboardingSessionView, "documentNotes"> | undefined,
  documentId: string,
): string | null {
  const note = view?.documentNotes?.find((n) => n.documentId === documentId);
  if (note === undefined) return null;
  const parts: string[] = [];
  if (note.unreadPages > 0) {
    parts.push(
      note.unreadPages === 1
        ? "1 page was an image I couldn't read."
        : `${String(note.unreadPages)} pages were images I couldn't read.`,
    );
  }
  if (note.truncated) {
    parts.push("It was too long to read in full; I read the first part.");
  }
  return parts.length === 0 ? null : parts.join(" ");
}

/**
 * The file they already shared, when this one is the same bytes (live e2e
 * 25 Oct: each re-upload of one deck made a new document, read and
 * reviewed again at a model's cost). Matched by content hash only.
 */
export function sameFileAs<T extends { readonly sha256?: string | undefined }>(
  files: readonly T[],
  sha256: string,
): T | undefined {
  return files.find((file) => file.sha256 === sha256);
}

/** Q's line, said by code, for a file it already has. */
export function alreadyHaveLine(filename: string, existing: string): string {
  return filename === existing
    ? `I already have ${filename}, so there's nothing new to read.`
    : `I already have that file as ${existing}, so there's nothing new to read.`;
}

/** A file's SHA-256 as lowercase hex, as the document store records it. */
export async function contentHashOf(file: Blob): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    await file.arrayBuffer(),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/** Q's line, said by code, for a document that added nothing new. */
export function nothingNewLine(filename: string): string {
  return `I've read ${filename}. It adds nothing new beyond what's already recorded.`;
}

/**
 * What Q picked up from one uploaded document: the pending suggestions
 * that cite it, as the confirmation card labels them.
 */
export function findingsFromDocument(
  items: readonly PickedUp[],
  documentId: string,
): readonly { readonly label: string; readonly value: string }[] {
  return items
    .filter((item) =>
      (item.suggestion.sourceRefs ?? []).some(
        (ref) =>
          ref.sourceType === "EVIDENCE_DOCUMENT" && ref.sourceId === documentId,
      ),
    )
    .map((item) => ({ label: item.label, value: item.value }));
}

/**
 * What Q found about them that no uploaded document gave (their own public
 * pages, read while they talk): the pending suggestions citing no document.
 */
export function findingsNotFromDocuments(items: readonly PickedUp[]): readonly {
  readonly id: string;
  readonly label: string;
  readonly value: string;
}[] {
  return items
    .filter(
      (item) =>
        !(item.suggestion.sourceRefs ?? []).some(
          (ref) => ref.sourceType === "EVIDENCE_DOCUMENT",
        ),
    )
    .map((item) => ({
      id: item.suggestion.id,
      label: item.label,
      value: item.value,
    }));
}

/**
 * The quiet note handed to a live call when research on them lands
 * (owner 2026-10-27: research runs in parallel and Q uses what is solid).
 * Data for Q, unconfirmed: never their answer until they say so.
 */
export function publicFindingsNote(
  found: readonly { readonly label: string; readonly value: string }[],
): string {
  const list = found.map((item) => `${item.label}: ${item.value}`).join("; ");
  return `Capital Q found this about them from public sources (not confirmed yet): ${list}. Don't ask them for these again; when it fits naturally, mention it briefly and ask if it's right.`;
}

/**
 * The quiet note handed to a live call when a document's reading lands
 * (owner 2026-10-27: conversation first). It is data for Q, not the
 * person's words: what was found, unconfirmed, so Q does not ask for it
 * again and checks it when it fits. Quotes in names are flattened so the
 * file name cannot close the quoted span.
 */
export function uploadFindingsNote(
  filename: string,
  reading: "FOUND" | "NOTHING_NEW",
  found: readonly { readonly label: string; readonly value: string }[],
  /** What Q could not read in it (documentReadingNote), if anything. */
  unread: string | null = null,
): string {
  const name = filename.replace(/"/g, "'");
  const limits =
    unread === null
      ? ""
      : ` Q could not read all of it: ${unread} Tell them so plainly, and ask for a text version if it matters.`;
  if (reading === "NOTHING_NEW" || found.length === 0) {
    return `The person just uploaded "${name}"; Q read it and found nothing new for their setup.${limits}`;
  }
  const list = found.map((item) => `${item.label}: ${item.value}`).join("; ");
  return `The person just uploaded "${name}". Q read it and found: ${list} (not confirmed yet). Don't ask them for these again; when it fits, say briefly what you found and ask if it's right.${limits}`;
}

/**
 * The thread after a reload, in the order things were said: what was said
 * before the absence, then the welcome back said now, then what they sent
 * and Q never confirmed (live 25 Oct e2e: the welcome back sat above the
 * whole restored thread).
 */
export function resumedThread<T>(
  history: readonly T[],
  welcome: readonly T[],
  unsent: readonly T[],
): T[] {
  return [...history, ...welcome, ...unsent];
}

/**
 * Whether the Finish control is offered (production re-test 2026-10-28:
 * nine mandate answers were still saving, coverage said it could not
 * complete, and the button never showed). An answer still being saved
 * counts as answered here, provisionally; the runtime still decides, on
 * Finish, whether the session completes (it waits for the saves).
 */
export function canOfferFinish(coverage: {
  readonly summary: {
    readonly canComplete: boolean;
    readonly contradictory: number;
  };
  readonly fields: readonly {
    readonly applicable: boolean;
    readonly required: boolean;
    readonly state: string;
    readonly savePending: boolean;
  }[];
}): boolean {
  if (coverage.summary.canComplete) return true;
  if (coverage.summary.contradictory > 0) return false;
  // The journey's review checkpoints are not coverage fields, and they are
  // confirmed on Finish itself (read back, then their yes): every essential
  // fact in is enough to offer it (production re-test 2026-10-28: no
  // Finish on either side, because canComplete waits for those reviews).
  const required = coverage.fields.filter((f) => f.applicable && f.required);
  return (
    required.length > 0 &&
    required.every(
      (f) =>
        f.savePending ||
        f.state === "KNOWN" ||
        f.state === "CONFIRMED_SAVED" ||
        f.state === "EVIDENCE_NEEDED",
    )
  );
}

/**
 * Q's read-back as the blocks it was written in (live 2026-10-29: one
 * run-on paragraph in heading type, two screens tall at 390): blank lines
 * part the blocks, each block's lines are its lines. Structure only; the
 * words are never read for meaning.
 */
export function readBackBlocks(text: string): string[][] {
  return text
    .split(/\n{2,}/u)
    .map((block) => block.split("\n").filter((line) => line.trim() !== ""))
    .filter((lines) => lines.length > 0);
}

/** The most documents one upload step holds (the definition's maxItems). */
export const UPLOAD_STEP_MAX = 6;

/**
 * A document uploaded in the conversation, as the answer of the journey's
 * own upload step (sweep D5, 2026-10-29: a deck uploaded while talking to
 * Q was read, but the review still said "Documents · Not yet", because only
 * the form's upload answered that step). It adds to what the step holds;
 * null when the journey has no open upload step or already holds it.
 */
export function uploadAnswer(
  view: Pick<OnboardingSessionView, "progress" | "responses"> | undefined,
  stepTypeOf: ((stepKey: string) => string | undefined) | undefined,
  documentId: string,
): {
  readonly stepKey: string;
  readonly value: OnboardingResponseValue;
} | null {
  if (view === undefined || stepTypeOf === undefined) return null;
  const step = view.progress.eligibleSteps.find(
    (eligible) => stepTypeOf(eligible.stepKey) === "document_upload",
  );
  if (step === undefined) return null;
  const held = view.responses.find((r) => r.stepKey === step.stepKey)?.value;
  const ids =
    held?.type === "RESOURCE_REFERENCE" &&
    held.resourceType === "EVIDENCE_DOCUMENT"
      ? held.resourceIds
      : [];
  if (ids.includes(documentId)) return null;
  return {
    stepKey: step.stepKey,
    value: {
      type: "RESOURCE_REFERENCE",
      resourceType: "EVIDENCE_DOCUMENT",
      resourceIds: [...ids, documentId].slice(-UPLOAD_STEP_MAX),
    },
  };
}
