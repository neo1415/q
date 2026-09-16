import type { Logger } from "@capital-q/observability";
import {
  createDefaultPromptRegistry,
  DEFAULT_COMMUNICATION_PROFILE,
  personalityOf,
  renderPrompt,
  WelcomeConductorResultSchema,
  type PromptRegistry,
  type QPersonalityCode,
  type WelcomeConductorResult,
  type WelcomeConductorVariables,
} from "@capital-q/q-core";

import type { InterviewGateway } from "./interviewer.js";

/**
 * Q's first minute with a new person (CQ-Q-VOICE-001 rework, "arrival").
 *
 * One model-driven turn per utterance: Q introduces itself, learns what to
 * call the person, and reads from anything they say whether they are here
 * to raise or to invest. The model proposes; the caller records the name
 * under the person's own token and starts the setup the model inferred.
 * Nothing here has authority of its own.
 */

export type WelcomeHostDependencies = {
  readonly gateway: InterviewGateway;
  readonly registry?: PromptRegistry | undefined;
  readonly logger: Logger;
  readonly personality?: QPersonalityCode | undefined;
  readonly expressive?: boolean | undefined;
};

export type WelcomeTurnInput = {
  readonly attribution: {
    readonly tenantId: string;
    readonly userId: string;
    readonly correlationId: string;
  };
  readonly channel?: "voice" | "text" | undefined;
  readonly knownName: string | null;
  /** Text the person typed at sign-up: a hint for the greeting, never a claim. */
  readonly knownOrganisation?: string | null | undefined;
  /** Empty for Q's opening line. */
  readonly utterance: string;
  readonly recentTurns: readonly {
    readonly role: "person" | "q";
    readonly text: string;
  }[];
  readonly signal?: AbortSignal | undefined;
};

export type WelcomeTurnOutcome = {
  readonly reply: string;
  readonly intent: WelcomeConductorResult["intent"];
  /** A name the person gave to be called by; the caller records it. */
  readonly name: string | null;
  /** The setup to start, once the person's words made it clear. */
  readonly journey: "FOUNDER" | "INVESTOR" | null;
  readonly questionForQ: string | null;
  readonly degraded: boolean;
};

const WELCOME_BUDGET = {
  maxAttempts: 4,
  maxEstimatedCostUsd: 0.05,
  maxOutputTokens: 512,
  attemptTimeoutMs: 30_000,
} as const;

const FALLBACK_OPENING =
  "Hello, I'm Q. I work with founders and investors here. Are you raising for a company, or investing?";
const FALLBACK_REPLY =
  "I'm having trouble thinking just now. Are you here to raise for a company, or to invest?";

export function createWelcomeHost(dependencies: WelcomeHostDependencies) {
  const { gateway, logger } = dependencies;
  const registry = dependencies.registry ?? createDefaultPromptRegistry();
  const personality = personalityOf(dependencies.personality);
  const expressive = dependencies.expressive ?? false;

  return {
    turn: async (input: WelcomeTurnInput): Promise<WelcomeTurnOutcome> => {
      const opening = input.utterance.trim().length === 0;
      const variables: Omit<
        WelcomeConductorVariables,
        | "operatingMode"
        | "communicationProfile"
        | "communicationGuidance"
        | "environmentNotes"
      > = {
        channel: input.channel ?? "voice",
        personality: personality.manner,
        expressive,
        opening,
        knownName: input.knownName,
        knownOrganisation: input.knownOrganisation ?? null,
        recentTurns: input.recentTurns.slice(-12).map((t) => ({
          role: t.role,
          text: t.text.slice(0, 600),
        })),
        utterance: input.utterance.slice(0, 2_000),
      };
      const rendered = renderPrompt<WelcomeConductorVariables>(registry, {
        task: "WELCOME_CONDUCTOR",
        charter: "Q_SYSTEM_VOICE",
        operatingMode: "ASSESSMENT",
        communicationProfile: DEFAULT_COMMUNICATION_PROFILE,
        environmentNotes:
          "You cannot save or verify anything yourself; Capital Q records a name the person gives and starts the setup you infer, under their own authority.",
        variables,
      });

      let result: WelcomeConductorResult | undefined;
      try {
        const response = await gateway.execute<WelcomeConductorResult>(
          {
            taskClass: "NORMAL_DIALOGUE",
            sensitivity: "CONFIDENTIAL",
            budget: WELCOME_BUDGET,
            messages: [...rendered.messages],
            output: rendered.output,
            attribution: input.attribution,
          },
          {
            schema: WelcomeConductorResultSchema,
            ...(input.signal === undefined ? {} : { signal: input.signal }),
          },
        );
        if (response.output.kind === "STRUCTURED") {
          result = (
            response.output as { readonly value: WelcomeConductorResult }
          ).value;
        }
      } catch (error: unknown) {
        logger.warn({ err: error }, "welcome conductor model call failed");
      }
      if (result === undefined) {
        return {
          reply: opening ? FALLBACK_OPENING : FALLBACK_REPLY,
          intent: opening ? "OPENING" : "UNCLEAR",
          name: null,
          journey: null,
          questionForQ: null,
          degraded: true,
        };
      }
      const name =
        result.name === null ? null : result.name.trim().slice(0, 80) || null;
      return {
        reply: result.reply,
        intent: result.intent,
        name,
        journey:
          result.intent === "FOUNDER" || result.journey === "FOUNDER"
            ? "FOUNDER"
            : result.intent === "INVESTOR" || result.journey === "INVESTOR"
              ? "INVESTOR"
              : null,
        questionForQ:
          result.intent === "QUESTION_FOR_Q" ? result.questionForQ : null,
        degraded: false,
      };
    },
  };
}

export type WelcomeHost = ReturnType<typeof createWelcomeHost>;
