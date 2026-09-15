import type {
  OnboardingInterviewQuestionView,
  OnboardingResponseValue,
  OnboardingSessionView,
  OnboardingStepType,
  OnboardingStepView,
  OnboardingSuggestionView,
  OnboardingUnderstanding,
} from "@capital-q/contracts";

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

function questionText(
  step: OnboardingStepView,
  vocabulary: JourneyVocabulary,
): string {
  return GENERIC_STRENGTH_PROMPT.test(step.prompt.trim())
    ? `${vocabulary.stepTitle(step.stepKey)}?`
    : step.prompt;
}

/** "Founders who have sold into banks before." reads once, not "before.. Noted." */
function trimSentenceEnd(summary: string): string {
  return summary.replace(/[.!?]+$/, "");
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
          placeholder: "Or describe the company in your own words",
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

/** One thing Q picked up, for the inline confirmation card (§21). */
export type PickedUp = {
  readonly suggestion: OnboardingSuggestionView;
  readonly label: string;
  readonly value: string;
  readonly editorId: string | undefined;
};

export function pickedUp(
  view: OnboardingSessionView,
  vocabulary: JourneyVocabulary,
  labels?: Readonly<Record<string, string>>,
): readonly PickedUp[] {
  return view.pendingSuggestions.map((suggestion) => ({
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

function joinNames(names: readonly string[]): string {
  if (names.length <= 1) {
    return names[0] ?? "";
  }
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1) ?? ""}`;
}

/** Q's short acknowledgement of what the runtime understood (§18). */
/** "…and I picked up N other things" when a sentence answered more than it was asked (CQ-Q-VOICE-001 A §8). */
function withProposals(text: string, proposed: number | undefined): string {
  if (proposed === undefined || proposed === 0) {
    return text;
  }
  return proposed === 1
    ? `${text} I also picked up one more thing from that; it's below for you to confirm.`
    : `${text} I also picked up ${String(proposed)} other things from that; they're below for you to confirm.`;
}

export function acknowledge(
  understood: OnboardingUnderstanding,
  vocabulary: JourneyVocabulary,
): string {
  switch (understood.kind) {
    case "ANSWERED":
      return withProposals(
        understood.utteranceId === undefined
          ? `${vocabulary.stepTitle(understood.stepKey)}: ${trimSentenceEnd(understood.summary)}. Noted.`
          : `${vocabulary.stepTitle(understood.stepKey)}: ${trimSentenceEnd(understood.summary)}. Noted. I'm reading the rest of that too; anything else I pick up will appear for you to confirm.`,
        understood.proposed,
      );
    case "CORRECTED":
      return withProposals(
        `Updated — ${vocabulary.stepTitle(understood.stepKey)}: ${trimSentenceEnd(understood.summary)}.`,
        understood.proposed,
      );
    case "SKIPPED":
      return "Noted. I'll leave that open; you can come back to it any time.";
    case "REQUIRED":
      return understood.why === null
        ? "I do need this one to finish setting things up. If a document already covers it, you can share that instead."
        : `I do need this one to finish setting things up: ${understood.why} If a document already covers it, you can share that instead.`;
    case "WHY":
      return understood.why === null
        ? "It helps me describe you accurately to the right people. You can skip it if you'd rather."
        : understood.why;
    case "UPLOAD":
      return "Go ahead. Whatever the document covers, I won't ask again.";
    case "AMBIGUOUS":
      return withProposals(
        "I can see more than one that fits. Which do you mean?",
        understood.proposed,
      );
    case "DECLINED":
      return "What should change? Pick the item below and I'll open it.";
    case "READING":
      return withProposals(
        "Thanks. I'm reading that now; I'll show you what I picked up in a moment so you can confirm it.",
        understood.proposed,
      );
    case "UNCLEAR":
      return withProposals(
        "I didn't catch that. Pick one below, or tell me a little more.",
        understood.proposed,
      );
  }
}

/** Q's short acknowledgement of a tapped option (§17-§18). */
export function acknowledgeValue(
  stepKey: string,
  value: OnboardingResponseValue,
  vocabulary: JourneyVocabulary,
  labels?: Readonly<Record<string, string>>,
): string {
  return `${vocabulary.stepTitle(stepKey)}: ${trimSentenceEnd(vocabulary.describe(stepKey, value, labels))}. Noted.`;
}

/**
 * "Let's continue." / "Where were we?" / "Back to onboarding." — the person
 * is returning from a tangent (CQ-Q-VOICE-001 B §24). Q picks the interview
 * up where the session says it is; nothing is sent to the runtime.
 */
const RESUME =
  /^(?:(?:ok(?:ay)?|right|so|anyway)[,.\s]+)?(?:let'?s (?:continue|carry on|finish (?:this|it|up)|get back(?: to it)?|go on|pick (?:it|this) up|resume)|continue(?: (?:the|with the|our) (?:interview|onboarding|setup|questions))?|carry on|where were we|where did we (?:leave off|stop)|back to (?:it|onboarding|the (?:interview|questions|setup))|resume(?: the interview)?|go on|next question|what(?:'s| is) next)[.!?]*$/i;

export function resumeIntent(text: string): boolean {
  return RESUME.test(text.trim());
}

/**
 * "Let's stop here." / "I'll finish this later." / "Pause the interview." —
 * the person is leaving for now (§25). Everything is already persisted; the
 * session stays open, never completed on their behalf.
 */
const PAUSE =
  /^(?:(?:ok(?:ay)?|right|so)[,.\s]+)?(?:let'?s (?:stop|pause|leave it|stop here|pause here|pick this up later|do this later)(?: (?:here|for now|there|for today))?|(?:i'?ll|let'?s|we'?ll|i can|we can) (?:finish|do|continue|complete|pick up) (?:this|it|the rest|this up) (?:later|another time|tomorrow|another day)|pause(?: the (?:interview|onboarding|setup))?|stop(?: the (?:interview|onboarding|setup))?(?: for now| here)?|(?:that'?s (?:enough|all) for (?:now|today))|i (?:need|have) to go|(?:can we|let'?s) (?:stop|pause|finish) (?:here|later|for now))[.!?]*$/i;

export function pauseIntent(text: string): boolean {
  return PAUSE.test(text.trim());
}

/** What Q says when the person pauses (§25). */
export const PAUSED_LINE =
  "Of course. Everything so far is saved. Come back whenever suits you and we'll pick up exactly here.";

/** What Q says when the person asks to continue (§24). */
export function resumeLine(prompt: QPrompt | null): string {
  return prompt === null
    ? "We're all caught up. There's nothing left for me to ask right now."
    : `Right, back to it. ${prompt.text}`;
}

/** What Q says after a tangent, before the live question shows again (§23). */
export const BRIDGE_LINE = "Back to where we were.";

/**
 * "Why do you need this?" is the interview's own move (the runtime answers
 * it from the step's own reason); any other question is for Q (§28).
 */
const INTERVIEW_WHY =
  /^(?:why|why (?:do you (?:need|ask|want)|does (?:this|that|it) matter|is (?:this|that) (?:needed|important|relevant))(?: (?:this|that|it))?|what(?:'s| is) (?:this|that) for)\??[.!]?$/i;

/**
 * A request for Q that does not end in a question mark ("Tell me about
 * Series A rounds in Nigeria", "Can you check what Paystack raised",
 * "Look up Flutterwave") — the shape of a request, not of an answer (§23).
 */
const REQUEST_FOR_Q =
  /^(?:(?:can|could|would|will) you\b|tell me (?:about|what|how|more)\b|(?:please )?(?:look up|search(?: for)?|check|find out|research|compare|explain|summari[sz]e|help me (?:understand|with))\b|what (?:do you know|can you tell me|have you found)\b|how (?:do|does|would|should) (?:i|we|one|a founder|an investor)\b)/i;

/** True when what was typed reads as a question for Q rather than an answer (§28, §23). */
export function looksLikeQuestionForQ(text: string): boolean {
  const trimmed = text.trim();
  if (INTERVIEW_WHY.test(trimmed)) {
    return false;
  }
  return trimmed.endsWith("?") || REQUEST_FOR_Q.test(trimmed);
}

/** The value a review line shows, or a plain "not yet" (§29). */
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
  const eligible = new Set(
    view.progress.eligibleSteps.map((step) => step.stepKey),
  );
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
            value:
              value === undefined
                ? null
                : vocabulary.describe(key, value, labels),
            editorId: vocabulary.editorFor(key),
          };
        }),
    }))
    .filter((group) => group.items.length > 0);
}
