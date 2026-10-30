import type { ModelSensitivity } from "@capital-q/contracts";
import type { Logger } from "@capital-q/observability";
import {
  createDefaultPromptRegistry,
  DEFAULT_COMMUNICATION_PROFILE,
  OnboardingTranscriptReaderV3ResultSchema,
  renderPrompt,
  type OnboardingTranscriptReaderV3Result,
  type OnboardingTranscriptReaderVariables,
  type PromptRegistry,
} from "@capital-q/q-core";

import { isModelGatewayError } from "../errors.js";
import type { ModelGateway } from "../gateway.js";

/**
 * The whole onboarding conversation, read by meaning into each step's
 * answer (owner 2026-10-27: voice onboarding is a conversation first).
 * It reads; it writes nothing. A conversation that cannot be read is
 * `null`, and nothing is saved from it until the next reading.
 */
export type OnboardingTranscriptReading = {
  readonly answers: readonly (Omit<
    OnboardingTranscriptReaderV3Result["answers"][number],
    "replaces" | "aboutStep"
  > & {
    /**
     * A list step: true when they meant it as the whole list (read by
     * meaning). Absent or false: it adds to what is on record.
     */
    readonly replaces?: boolean | undefined;
    /**
     * Their words are about this step itself: Q asked it, they named it,
     * or they corrected what they said for it (read by meaning). Absent or
     * false: not.
     */
    readonly aboutStep?: boolean | undefined;
  })[];
  readonly declined: OnboardingTranscriptReaderV3Result["declined"];
};

export type OnboardingTranscriptReader = {
  readonly read: (input: {
    readonly journey: "investor" | "founder";
    readonly steps: readonly {
      readonly stepKey: string;
      readonly question: string;
      readonly kind: string;
      readonly required: boolean;
      /** "key: label" pairs, or empty. */
      readonly options: string;
      /** What is on record now, as a person would say it, or "nothing". */
      readonly onRecord: string;
    }[];
    /** Oldest first. */
    readonly turns: readonly {
      readonly role: "PERSON" | "Q";
      readonly text: string;
    }[];
    readonly attribution: {
      readonly tenantId: string;
      readonly userId: string;
      readonly correlationId: string;
    };
    readonly signal?: AbortSignal | undefined;
  }) => Promise<OnboardingTranscriptReading | null>;
};

/** Off the speaking path; a long conversation still reads in one call. */
const TRANSCRIPT_READER_BUDGET = {
  maxAttempts: 2,
  maxEstimatedCostUsd: 0.05,
  maxOutputTokens: 3_000,
  attemptTimeoutMs: 25_000,
} as const;

/** The most of the conversation one reading carries (the newest is kept). */
const TRANSCRIPT_CHARS_MAX = 58_000;

/** The conversation as lines, oldest first, cut from the front to fit. */
export function transcriptText(
  turns: readonly { readonly role: "PERSON" | "Q"; readonly text: string }[],
): string {
  const lines = turns
    .map((turn) => ({
      role: turn.role,
      text: turn.text.replace(/\s+/g, " ").trim(),
    }))
    .filter((turn) => turn.text.length > 0)
    .map((turn) => `${turn.role}: ${turn.text}`);
  let total = 0;
  const kept: string[] = [];
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index] ?? "";
    if (total + line.length + 1 > TRANSCRIPT_CHARS_MAX) break;
    kept.unshift(line);
    total += line.length + 1;
  }
  return kept.join("\n");
}

export function createOnboardingTranscriptReader(dependencies: {
  readonly gateway: ModelGateway;
  readonly logger: Logger;
  readonly registry?: PromptRegistry | undefined;
  readonly sensitivity?: ModelSensitivity | undefined;
  readonly dataPosture?: "REAL_CUSTOMER" | "SYNTHETIC_DEMO" | undefined;
  /** Today, for times they name ("close in Q1"); the clock by default. */
  readonly now?: (() => Date) | undefined;
}): OnboardingTranscriptReader {
  const registry = dependencies.registry ?? createDefaultPromptRegistry();
  const { gateway, logger } = dependencies;
  const sensitivity = dependencies.sensitivity ?? "CONFIDENTIAL";
  return {
    read: async (input) => {
      const transcript = transcriptText(input.turns);
      if (!input.turns.some((turn) => turn.role === "PERSON")) {
        return { answers: [], declined: [] };
      }
      const steps = input.steps.slice(0, 80).map((step) => ({
        stepKey: step.stepKey.slice(0, 80),
        question: step.question.slice(0, 400),
        kind: step.kind.slice(0, 40),
        required: step.required,
        options: step.options.slice(0, 2_000),
        onRecord: step.onRecord.slice(0, 600),
      }));
      const known = new Set(steps.map((step) => step.stepKey));
      const optional = new Set(
        steps.filter((step) => !step.required).map((step) => step.stepKey),
      );
      try {
        const rendered = renderPrompt<OnboardingTranscriptReaderVariables>(
          registry,
          {
            task: "ONBOARDING_TRANSCRIPT_READER",
            charter: "Q_SYSTEM",
            operatingMode: "ASSESSMENT",
            communicationProfile: DEFAULT_COMMUNICATION_PROFILE,
            // Sweep D5 (2026-10-29): "hoping to close in Q1" needs today to
            // name the option whose span holds it.
            environmentNotes: `You read one conversation and nothing else; Capital Q checks and saves what you find. Today's date is ${(dependencies.now ?? (() => new Date()))().toISOString().slice(0, 10)}.`,
            variables: { journey: input.journey, steps, transcript },
          },
        );
        const response = await gateway.execute<OnboardingTranscriptReading>(
          {
            taskClass: "STRUCTURED_EXTRACTION",
            reasoning: "LOW",
            sensitivity,
            budget: TRANSCRIPT_READER_BUDGET,
            messages: [...rendered.messages],
            output: rendered.output,
            attribution: input.attribution,
            ...(dependencies.dataPosture === undefined
              ? {}
              : { dataPosture: dependencies.dataPosture }),
          },
          {
            schema: OnboardingTranscriptReaderV3ResultSchema,
            ...(input.signal === undefined ? {} : { signal: input.signal }),
          },
        );
        if (response.output.kind !== "STRUCTURED") return null;
        const parsed = OnboardingTranscriptReaderV3ResultSchema.safeParse(
          (response.output as { readonly value: unknown }).value,
        );
        if (!parsed.success) {
          // Paths only, never what the model wrote (live recheck
          // 2026-10-30: a reading that saved nothing left no trace).
          logger.warn(
            {
              task: "ONBOARDING_TRANSCRIPT_READER",
              issues: parsed.error.issues
                .slice(0, 8)
                .map((issue) => issue.path.join(".").slice(0, 80)),
            },
            "onboarding transcript reading did not fit its schema",
          );
          return null;
        }
        const unknown = parsed.data.answers.filter(
          (a) => !known.has(a.stepKey),
        );
        if (unknown.length > 0) {
          logger.info(
            {
              task: "ONBOARDING_TRANSCRIPT_READER",
              unknownSteps: unknown.length,
            },
            "onboarding transcript reading named steps the setup does not have",
          );
        }
        return {
          // Only the setup's own steps; a required step is never declined.
          answers: parsed.data.answers.filter((a) => known.has(a.stepKey)),
          declined: parsed.data.declined.filter((d) => optional.has(d.stepKey)),
        };
      } catch (error: unknown) {
        if (!(
          isModelGatewayError(error) && error.failureClass === "CANCELLED"
        )) {
          logger.warn({ err: error }, "onboarding transcript was not read");
        }
        return null;
      }
    },
  };
}
