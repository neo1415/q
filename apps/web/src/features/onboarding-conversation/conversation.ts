import type {
  OnboardingInterviewQuestionView,
  OnboardingResponseValue,
  OnboardingSessionView,
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
 * with the step's own options as quick controls. Tapping an option says its
 * label; typing says whatever was typed; both reach the same runtime path.
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
  /** What tapping it says to Q. */
  readonly say: string;
  /** The option this chip stands for, when it stands for one. */
  readonly optionKey?: string | undefined;
};

export type ControlKind =
  | "chips"
  | "multi_chips"
  | "figure"
  | "text"
  | "confirm"
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
        })),
      };
    case "multi_select":
      return {
        ...base,
        control: "multi_chips",
        chips: presentation.options.slice(0, MAX_CHIPS).map((option) => ({
          label: option.label,
          say: option.label,
          optionKey: option.optionKey,
        })),
      };
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
          { label: presentation.confirmLabel, say: presentation.confirmLabel },
          ...(presentation.declineLabel === undefined
            ? []
            : [
                {
                  label: presentation.declineLabel,
                  say: presentation.declineLabel,
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
      if (candidates.length > 0) {
        return {
          ...base,
          control: "chips",
          chips: candidates.slice(0, MAX_CHIPS).map((candidate) => ({
            label: candidate.name,
            say: candidate.name,
            optionKey: candidate.id,
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

export type StillNeeded = {
  readonly question: OnboardingInterviewQuestionView;
  readonly editorId: string | undefined;
};

export function stillNeeded(
  view: OnboardingSessionView,
  vocabulary: JourneyVocabulary,
): readonly StillNeeded[] {
  return (view.pendingQuestions ?? []).map((question) => ({
    question,
    editorId: vocabulary.editorFor(question.stepKey),
  }));
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
 * The greeting for a returning person (§26), from persisted state only:
 * what is settled, what documents were shared, what remains. No name is
 * used, because none is known here; nothing is claimed that the session
 * does not record.
 */
export function welcomeBack(
  view: OnboardingSessionView,
  vocabulary: JourneyVocabulary,
): string | null {
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
export function acknowledge(
  understood: OnboardingUnderstanding,
  vocabulary: JourneyVocabulary,
): string {
  switch (understood.kind) {
    case "ANSWERED":
      return understood.utteranceId === undefined
        ? `${vocabulary.stepTitle(understood.stepKey)}: ${trimSentenceEnd(understood.summary)}. Noted.`
        : `${vocabulary.stepTitle(understood.stepKey)}: ${trimSentenceEnd(understood.summary)}. Noted. I'm reading the rest of that too; anything else I pick up will appear for you to confirm.`;
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
      return "I can see more than one that fits. Which do you mean?";
    case "DECLINED":
      return "What should change? Pick the item below and I'll open it.";
    case "READING":
      return "Thanks. I'm reading that now; I'll show you what I picked up in a moment so you can confirm it.";
    case "UNCLEAR":
      return "I didn't catch that. Pick one below, or tell me a little more.";
  }
}

/**
 * "Why do you need this?" is the interview's own move (the runtime answers
 * it from the step's own reason); any other question is for Q (§28).
 */
const INTERVIEW_WHY =
  /^(?:why|why (?:do you (?:need|ask|want)|does (?:this|that|it) matter|is (?:this|that) (?:needed|important|relevant))(?: (?:this|that|it))?|what(?:'s| is) (?:this|that) for)\??[.!]?$/i;

/** True when what was typed reads as a question for Q rather than an answer (§28). */
export function looksLikeQuestionForQ(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed.endsWith("?")) {
    return false;
  }
  return !INTERVIEW_WHY.test(trimmed);
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
