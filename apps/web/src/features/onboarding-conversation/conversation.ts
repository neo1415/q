import type {
  OnboardingInterviewQuestionView,
  OnboardingResponseValue,
  OnboardingSessionView,
  OnboardingStepType,
  OnboardingStepView,
  OnboardingSuggestionView,
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
          // Journey-neutral: an investor choosing sectors has no company
          // to describe (adversarial round 1, #7).
          placeholder: "Or say it in your own words",
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
  return text.length === 0 ? null : text;
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
export function acknowledgeValue(
  stepKey: string,
  value: OnboardingResponseValue,
  vocabulary: JourneyVocabulary,
  labels?: Readonly<Record<string, string>>,
): string {
  return `${vocabulary.stepTitle(stepKey)}: ${trimSentenceEnd(vocabulary.describe(stepKey, value, labels))}. Noted.`;
}

/**
 * What the thread shows after a look-up Q ran mid-interview, before the
 * live question shows again: transport copy, not a reading of anything
 * the person said. (A pause or a return is the loop's to read, P0-1.)
 */
export const BRIDGE_LINE = "Back to where we were.";

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
