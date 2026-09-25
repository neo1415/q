import { randomUUID } from "node:crypto";

import {
  appendOnboardingInterviewTurns,
  listOnboardingInterviewTurns,
} from "@capital-q/api-client";
import {
  CorrelationIdSchema,
  QRunIdSchema,
  type ModelMessage,
} from "@capital-q/contracts";
import {
  acceptStructuredOutput,
  isModelGatewayError,
  type ModelGateway,
} from "@capital-q/model-gateway";
import { toolResultMessage } from "@capital-q/model-gateway/q";
import type { Logger } from "@capital-q/observability";
import {
  createDefaultPromptRegistry,
  DEFAULT_COMMUNICATION_PROFILE,
  InterviewAgentResultSchema,
  renderPrompt,
  type InterviewAgentResult,
  type InterviewAgentVariables,
  type PromptRegistry,
} from "@capital-q/q-core";
import type { ContextFirewallPort } from "@capital-q/q-runtime";
import {
  createOnboardingTools,
  createQToolExecutor,
  createQToolRegistry,
} from "@capital-q/q-tools";
import type { ActorContext } from "@capital-q/security";

import {
  definitionFor,
  optionsOf,
  toOpenStep,
  type InterviewTurnInput,
  type InterviewTurnOutcome,
} from "./interviewer.js";
import { createOnboardingPort } from "./onboarding-port.js";

/**
 * The onboarding interview as a tool-calling Q run (ADR 0016).
 *
 * One turn: the Context Firewall plans the run for this person; the
 * onboarding tools are offered under that plan, bound to their own
 * session; the model reads the whole state and the whole conversation and
 * acts through the tools, a bounded number of rounds; its reply is written
 * after the results, so it can claim only what they say happened. Code
 * chooses no question and composes no line — only transport failure copy.
 */

const MAX_ROUNDS = 4;
const MAX_CALLS = 8;
/** A person is waiting; each call gets this long before the next model. */
const ATTEMPT_MS = 20_000;

const BUDGET = {
  maxAttempts: 3,
  maxEstimatedCostUsd: 0.2,
  maxOutputTokens: 1_200,
  attemptTimeoutMs: 45_000,
} as const;

export type InterviewAgentTurnInput = InterviewTurnInput & {
  /** The person, as the route resolved them. Required for a Q run. */
  readonly actor?: ActorContext | undefined;
};

export type InterviewAgentDependencies = {
  readonly gateway: ModelGateway;
  readonly firewall: ContextFirewallPort;
  readonly logger: Logger;
  readonly registry?: PromptRegistry | undefined;
  readonly dataPosture?: "REAL_CUSTOMER" | "SYNTHETIC_DEMO" | undefined;
};

export type InterviewAgent = {
  readonly turn: (
    input: InterviewAgentTurnInput,
  ) => Promise<InterviewTurnOutcome>;
};

export function createInterviewAgent(
  dependencies: InterviewAgentDependencies,
): InterviewAgent {
  const registry = dependencies.registry ?? createDefaultPromptRegistry();
  const { gateway, firewall, logger } = dependencies;

  const turn = async (
    input: InterviewAgentTurnInput,
  ): Promise<InterviewTurnOutcome> => {
    const actor = input.actor;
    if (actor === undefined) {
      throw new Error("an interview Q run needs the person's actor context");
    }
    const utterance = input.utterance.trim();
    const opening = utterance.length === 0;
    const runId = QRunIdSchema.parse(randomUUID());
    const correlationId = CorrelationIdSchema.safeParse(
      input.attribution.correlationId,
    ).success
      ? CorrelationIdSchema.parse(input.attribution.correlationId)
      : CorrelationIdSchema.parse(`cor_${randomUUID()}`);

    const port = createOnboardingPort({
      session: input.session,
      onboardingSessionId: input.onboardingSessionId,
      journeyType: input.journeyType,
      ownerUserId: actor.userId,
    });

    // The whole conversation, from the kept thread; the browser's recent
    // turns only when the thread cannot be read.
    const kept = await listOnboardingInterviewTurns(
      input.session,
      input.onboardingSessionId,
    ).catch((error: unknown) => {
      logger.warn({ err: error }, "interview thread not read for the Q run");
      return null;
    });
    const conversation: InterviewAgentVariables["conversation"] =
      kept === null
        ? input.recentTurns.map((t) => ({
            role: t.role === "person" ? ("PERSON" as const) : ("Q" as const),
            text: t.text.slice(0, 2_000),
          }))
        : kept.items.slice(-120).map((t) => ({
            role: t.role === "PERSON" ? ("PERSON" as const) : ("Q" as const),
            text: t.text.slice(0, 2_000),
          }));

    const decision = await firewall.plan({
      actor,
      runId,
      correlationId,
      capability: "ANSWER",
      subjects: [],
    });
    if (decision.outcome !== "AUTHORISED") {
      throw new Error(
        "the Context Firewall did not authorise this interview run",
      );
    }
    const tools = createQToolExecutor({
      // Nothing said, nothing to write: an opening offers only reads, so
      // no answer can be recorded that the person did not give.
      registry: createQToolRegistry(
        createOnboardingTools(port).filter(
          (tool) => !opening || tool.classification === "READ_ONLY",
        ),
      ),
      logger,
    });
    const context = {
      actor,
      runId,
      correlationId,
      capability: "ANSWER" as const,
      plan: decision.plan,
      signal: input.signal,
      conversation: { latestUserText: utterance },
    };
    const offered = await tools.offer(context);
    const state = await port.state();

    const rendered = renderPrompt<InterviewAgentVariables>(registry, {
      task: "INTERVIEW_AGENT",
      charter: input.channel === "voice" ? "Q_SYSTEM_VOICE" : "Q_SYSTEM",
      operatingMode: "ASSESSMENT",
      communicationProfile: DEFAULT_COMMUNICATION_PROFILE,
      environmentNotes:
        "You change the person's onboarding only through your tools; a tool result is what happened.",
      variables: {
        journey: input.journeyType,
        channel: input.channel,
        opening,
        state: JSON.stringify(state).slice(0, 24_000),
        conversation,
        utterance,
      },
    });

    const base = {
      taskClass: "NORMAL_DIALOGUE" as const,
      sensitivity: decision.plan.maxSensitivity,
      budget: BUDGET,
      attribution: {
        tenantId: actor.tenantId,
        userId: actor.userId,
        qRunId: runId,
        correlationId,
      },
      ...(dependencies.dataPosture === undefined
        ? {}
        : { dataPosture: dependencies.dataPosture }),
    };

    let messages: ModelMessage[] = [...rendered.messages];
    let result: InterviewAgentResult | undefined;
    let rounds = 0;
    let calls = 0;
    try {
      while (result === undefined && rounds < MAX_ROUNDS && calls < MAX_CALLS) {
        rounds += 1;
        const response = await gateway.execute(
          {
            ...base,
            messages,
            output: { kind: "TEXT" },
            tools: offered.map((tool) => tool.definition),
          },
          {
            firstAttemptTimeoutMs: ATTEMPT_MS,
            ...(input.signal === undefined ? {} : { signal: input.signal }),
          },
        );
        if (response.output.kind === "TEXT") {
          const accepted = acceptStructuredOutput(
            response.output.text,
            InterviewAgentResultSchema,
          );
          if (accepted.ok) result = accepted.value;
          break;
        }
        if (response.output.kind !== "TOOL_CALLS") break;
        const proposals = response.output.calls.slice(0, MAX_CALLS - calls);
        const results: ModelMessage[] = [];
        for (const call of proposals) {
          calls += 1;
          const outcome = await tools.execute(
            { callId: call.callId, name: call.name, arguments: call.arguments },
            context,
          );
          results.push(toolResultMessage(call, outcome));
        }
        messages = [
          ...messages,
          {
            role: "ASSISTANT",
            content: response.output.text,
            toolCalls: [...proposals],
          },
          ...results,
        ];
      }
      if (result === undefined) {
        // The reply, written after every result so far, with no tools left.
        const response = await gateway.execute<InterviewAgentResult>(
          { ...base, messages, output: rendered.output },
          {
            schema: InterviewAgentResultSchema,
            firstAttemptTimeoutMs: ATTEMPT_MS,
            ...(input.signal === undefined ? {} : { signal: input.signal }),
          },
        );
        if (response.output.kind === "STRUCTURED") {
          result = (response.output as { readonly value: InterviewAgentResult })
            .value;
        }
      }
    } catch (error: unknown) {
      if (isModelGatewayError(error) && error.failureClass === "CANCELLED") {
        throw error;
      }
      logger.warn({ err: error, rounds, calls }, "interview Q run failed");
    }

    const view = port.view() ?? (await port.state(), port.view());
    if (view === null) {
      throw new Error("the onboarding session could not be read");
    }
    const recorded = port.recorded();
    const reply =
      result?.reply ??
      (recorded.length > 0
        ? "That's on your record. I lost my train of thought for a second — say that last part again?"
        : "I couldn't reach my reasoning service just then, so I haven't taken that in. Say it again in a moment.");

    // Code checks the step the model says it asked is one still open.
    const steps = new Map(
      definitionFor(input.journeyType).steps.map(
        (s) => [s.stepKey, s] as const,
      ),
    );
    const askedStep =
      result?.asking === null || result?.asking === undefined
        ? undefined
        : steps.get(result.asking);
    const askedOpen =
      askedStep === undefined ? null : toOpenStep(askedStep, view);
    const stillOpen =
      askedOpen !== null &&
      view.progress.eligibleSteps.some(
        (e) =>
          e.stepKey === askedOpen.stepKey &&
          e.status !== "COMPLETED" &&
          e.status !== "SKIPPED",
      );

    // Kept: one exchange per turn, under one reference.
    const turns = [
      ...(opening
        ? []
        : [
            {
              role: "PERSON" as const,
              text: utterance.slice(0, 4_000),
              channel:
                input.channel === "voice"
                  ? ("VOICE" as const)
                  : ("TEXT" as const),
            },
          ]),
      {
        role: "Q" as const,
        text: reply.slice(0, 4_000),
        channel:
          input.channel === "voice" ? ("VOICE" as const) : ("TEXT" as const),
        ...(stillOpen && askedOpen !== null
          ? { stepKey: askedOpen.stepKey }
          : {}),
      },
    ];
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

    logger.info(
      {
        rounds,
        calls,
        recorded,
        asking: stillOpen ? askedOpen?.stepKey : null,
        answered: result !== undefined,
      },
      "interview q run traced",
    );

    return {
      reply,
      intent: opening ? "OPENING" : "ANSWER",
      asking:
        stillOpen && askedOpen !== null && askedStep !== undefined
          ? {
              stepKey: askedOpen.stepKey,
              kind: askedOpen.kind,
              options: [...(askedOpen.options ?? optionsOf(askedStep))],
              maxChoices: askedOpen.maxChoices,
            }
          : null,
      recorded,
      skipped: [],
      questionForQ: null,
      researching: null,
      // A completed journey goes where the screen's own button goes: an
      // investor to the companies they set it up to see, a founder home.
      navigate:
        view.session.status === "COMPLETED"
          ? input.journeyType === "investor"
            ? "DISCOVER"
            : "HOME"
          : null,
      handoff: null,
      pronounce: null,
      warnings: 0,
      view,
      degraded: result === undefined,
      reading: null,
      resume: null,
      qualitative: [],
      trace: null,
    };
  };

  return { turn };
}
