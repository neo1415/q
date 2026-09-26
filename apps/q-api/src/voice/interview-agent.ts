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
  type ModelGateway,
} from "@capital-q/model-gateway";
import {
  NO_TURN_AUTHORITY,
  toolResultMessage,
  type QDelegationReader,
  type QTurnAuthority,
} from "@capital-q/model-gateway/q";
import type { Logger } from "@capital-q/observability";
import {
  createDefaultPromptRegistry,
  DEFAULT_COMMUNICATION_PROFILE,
  type InterviewAgentV9Variables,
  INITIAL_CONVERSATION_STATE,
  isExhausted,
  reduceConversation,
  type ConversationState,
  InterviewAgentResultSchema,
  renderPrompt,
  type InterviewAgentResult,
  type InterviewAgentVariables,
  type PromptRegistry,
} from "@capital-q/q-core";
import {
  compactThread,
  createLoopMemoryReader,
  createPreferenceNotebook,
  type MemoryService,
} from "@capital-q/q-knowledge";
import type { ContextFirewallPort } from "@capital-q/q-runtime";
import {
  createNotePreferenceTool,
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
import {
  createOnboardingPort,
  type RecommendationStore,
} from "./onboarding-port.js";
import { createReplySentenceStream } from "./reply-stream.js";
import { SPOKEN_QUESTIONS } from "./step-copy.js";
import { textStatedIn } from "./value-support.js";

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

/**
 * A person is waiting (ACC 2026-09-25: one luna attempt ran 5.5 minutes
 * and the person got an HTTP 503). The whole turn ends by this deadline,
 * inside the voice route's own; every model call in it is cut off by it.
 */
const TURN_DEADLINE_MS = 25_000;
/** Tool rounds stop while this much is left, so the reply can be written. */
const REPLY_RESERVE_MS = 7_000;
/** Below this, no reply call is started; the turn degrades honestly. */
const MIN_REPLY_MS = 2_000;
/**
 * The first model's patience when another waits behind it. The loop's own
 * luna calls measured p95 5.1 s and never above 6.7 s locally; 8 s leaves
 * room above every call seen, and then the next model takes the round.
 */
const FIRST_ATTEMPT_MS = 8_000;

const BUDGET = {
  maxAttempts: 2,
  maxEstimatedCostUsd: 0.2,
  maxOutputTokens: 1_200,
  attemptTimeoutMs: 12_000,
} as const;

const THIS_TURN_MAX = 12_000;

/** A tool result's content, as data: parsed JSON where it is JSON. */
function resultOf(message: ModelMessage): unknown {
  const content = message.content;
  try {
    return JSON.parse(content) as unknown;
  } catch {
    return content.slice(0, 2_000);
  }
}

/** Step, basis and outcome of each write this turn, for the trace. */
function decisionsOf(
  actions: readonly { tool: string; input: unknown; result: unknown }[],
): readonly string[] {
  const out: string[] = [];
  for (const action of actions) {
    const items =
      typeof action.input === "object" && action.input !== null
        ? Object.values(action.input).find(Array.isArray)
        : undefined;
    const data =
      typeof action.result === "object" &&
      action.result !== null &&
      "data" in action.result
        ? action.result.data
        : undefined;
    const results =
      typeof data === "object" &&
      data !== null &&
      "results" in data &&
      Array.isArray(data.results)
        ? (data.results as unknown[])
        : [];
    for (const [index, result] of results.entries()) {
      const item: unknown = Array.isArray(items) ? items[index] : undefined;
      const field = (from: unknown, key: string): string =>
        typeof from === "object" &&
        from !== null &&
        key in from &&
        typeof (from as Record<string, unknown>)[key] === "string"
          ? String((from as Record<string, unknown>)[key]).slice(0, 80)
          : "-";
      out.push(
        `${action.tool}:${field(result, "stepKey")}:${field(item, "basis")}:${field(result, "outcome")}`,
      );
    }
  }
  return out.slice(0, 40);
}

/**
 * What Q has done this turn, for the next round's prompt. Oldest actions
 * give way first when it is long: the newest results decide what is left.
 */
export function thisTurnText(
  actions: readonly { tool: string; input: unknown; result: unknown }[],
): string {
  if (actions.length === 0) return "";
  for (let from = 0; from < actions.length; from += 1) {
    const text = JSON.stringify(actions.slice(from));
    if (text.length <= THIS_TURN_MAX) return text;
  }
  return JSON.stringify(actions.slice(-1)).slice(0, THIS_TURN_MAX);
}

export type InterviewAgentTurnInput = InterviewTurnInput & {
  /** The person, as the route resolved them. Required for a Q run. */
  readonly actor?: ActorContext | undefined;
  /**
   * Each complete sentence of the final reply, once, in order, as the
   * model writes it (P0-3): what a voice speaks before the turn ends.
   * The returned outcome still carries the whole reply.
   */
  readonly onSentence?: ((sentence: string) => void) | undefined;
};

export type InterviewAgentDependencies = {
  readonly gateway: ModelGateway;
  readonly firewall: ContextFirewallPort;
  readonly logger: Logger;
  readonly registry?: PromptRegistry | undefined;
  readonly dataPosture?: "REAL_CUSTOMER" | "SYNTHETIC_DEMO" | undefined;
  /**
   * The person's memory (ADR 0012, P0-5): recall and communication profile
   * in, stated preferences out through the Write Gate. Absent: the default
   * profile, nothing recalled, no note_preference tool.
   */
  readonly memory?: Pick<MemoryService, "recall" | "remember"> | undefined;
  /**
   * Where Q's recommendations are kept: the onboarding service's
   * suggestions (P0-2). Absent: recommend is refused honestly.
   */
  readonly recommendations?: RecommendationStore | undefined;
  /**
   * Which choices the person handed to Q this turn, read independently
   * of the acting model. Absent: nothing is ever handed over, and Q
   * recommends instead of recording on anyone's behalf.
   */
  readonly delegation?: QDelegationReader | undefined;
  /**
   * Which consistency checks have been put to the person, per onboarding
   * session, so each is raised once. Default: kept in this process.
   */
  readonly raisedChecks?: RaisedChecks | undefined;
  /**
   * Whether a question needing a look-up can be handed to Q's research
   * (the caller runs it and reports back through researchEnded). Default:
   * available.
   */
  readonly researchAvailable?: boolean | undefined;
  /** Milliseconds now; injectable so a test can run out the clock. */
  readonly now?: (() => number) | undefined;
  /** The whole turn's deadline; tests shorten it. */
  readonly turnDeadlineMs?: number | undefined;
};

export type RaisedChecks = {
  readonly get: (onboardingSessionId: string) => ReadonlySet<string>;
  readonly add: (onboardingSessionId: string, ids: readonly string[]) => void;
};

/**
 * Raised checks kept in this process (bounded). A restart forgets them and
 * a check may be put once more; the settlement itself is durable, on the
 * record (confirm_as_stated's note).
 */
export function createInMemoryRaisedChecks(maxSessions = 2_000): RaisedChecks {
  const bySession = new Map<string, Set<string>>();
  return {
    get: (id) => bySession.get(id) ?? new Set(),
    add: (id, ids) => {
      const set = bySession.get(id) ?? new Set<string>();
      for (const check of ids) set.add(check);
      bySession.delete(id);
      bySession.set(id, set);
      while (bySession.size > maxSessions) {
        const oldest = bySession.keys().next().value;
        if (oldest === undefined) break;
        bySession.delete(oldest);
      }
    },
  };
}

export type InterviewAgent = {
  readonly turn: (
    input: InterviewAgentTurnInput,
  ) => Promise<InterviewTurnOutcome>;
  /**
   * How a look-up this loop handed over ended (the caller ran it as a Q
   * run): a route that keeps failing stops being offered, and the next
   * look-up may start (CQ-QX-005's failure ledger).
   */
  readonly researchEnded: (onboardingSessionId: string, ok: boolean) => void;
};

/**
 * The trusted notes on what else a turn asks, from the independent
 * reading and the research ledger. Code composes the facts; the loop says
 * them in its own words.
 */
export function turnNotesFor(input: {
  readonly pausing: boolean;
  readonly lookup:
    | { readonly kind: "RUN"; readonly question: string }
    | { readonly kind: "RUNNING" }
    | { readonly kind: "UNAVAILABLE" }
    | null;
  readonly pronounce: { readonly term: string; readonly sayAs: string } | null;
}): string {
  const notes: string[] = [];
  if (input.pausing) {
    notes.push(
      "They want to pause and come back later: acknowledge it in one short sentence, say their answers are kept, and ask nothing.",
    );
  }
  switch (input.lookup?.kind) {
    case "RUN":
      notes.push(
        `A look-up will run right after your reply for their question: "${input.lookup.question.slice(0, 300)}". Say in a few words that you will look it up; do not answer it yourself, and ask nothing now: the conversation returns to the open question afterwards.`,
      );
      break;
    case "RUNNING":
      notes.push(
        "They asked something that needs looking up, and the last look-up is still running: say you will bring it back when it lands, then carry on.",
      );
      break;
    case "UNAVAILABLE":
      notes.push(
        "They asked something that needs looking up, and looking things up is not available right now: say so in one short sentence, then carry on.",
      );
      break;
    case undefined:
      break;
  }
  if (input.pronounce !== null) {
    notes.push(
      `They corrected how to say "${input.pronounce.term.slice(0, 80)}": say it as "${input.pronounce.sayAs.slice(0, 120)}" from now on, and acknowledge it in a few words.`,
    );
  }
  return notes.length === 0 ? "none" : notes.join("\n");
}

export function createInterviewAgent(
  dependencies: InterviewAgentDependencies,
): InterviewAgent {
  const registry = dependencies.registry ?? createDefaultPromptRegistry();
  const { gateway, firewall, logger } = dependencies;
  const now = dependencies.now ?? Date.now;
  const deadlineMs = dependencies.turnDeadlineMs ?? TURN_DEADLINE_MS;
  const raisedChecks =
    dependencies.raisedChecks ?? createInMemoryRaisedChecks();
  const researchAvailable = dependencies.researchAvailable ?? true;
  /** The conversation core's state per session: the research ledger. */
  const conversations = new Map<string, ConversationState>();
  const conversationOf = (id: string) =>
    conversations.get(id) ?? INITIAL_CONVERSATION_STATE;
  const remember = (id: string, state: ConversationState) => {
    conversations.delete(id);
    conversations.set(id, state);
    while (conversations.size > 2_000) {
      const oldest = conversations.keys().next().value;
      if (oldest === undefined) break;
      conversations.delete(oldest);
    }
  };

  const turn = async (
    input: InterviewAgentTurnInput,
  ): Promise<InterviewTurnOutcome> => {
    const actor = input.actor;
    if (actor === undefined) {
      throw new Error("an interview Q run needs the person's actor context");
    }
    // The person is waiting from the moment they spoke: the deadline
    // counts the reading, the state and the tools, not only the model.
    const startedAt = now();
    const utterance = input.utterance.trim();
    const opening = utterance.length === 0;
    const runId = QRunIdSchema.parse(randomUUID());
    const correlationId = CorrelationIdSchema.safeParse(
      input.attribution.correlationId,
    ).success
      ? CorrelationIdSchema.parse(input.attribution.correlationId)
      : CorrelationIdSchema.parse(`cor_${randomUUID()}`);

    // The whole conversation, from the kept thread; the browser's recent
    // turns only when the thread cannot be read.
    const kept = await listOnboardingInterviewTurns(
      input.session,
      input.onboardingSessionId,
    ).catch((error: unknown) => {
      logger.warn({ err: error }, "interview thread not read for the Q run");
      return null;
    });
    const thread =
      kept === null
        ? input.recentTurns.map((t) => ({
            role: t.role === "person" ? ("PERSON" as const) : ("Q" as const),
            text: t.text.slice(0, 2_000),
          }))
        : kept.items.map((t) => ({
            role: t.role === "PERSON" ? ("PERSON" as const) : ("Q" as const),
            text: t.text.slice(0, 2_000),
          }));
    const lastQTurn = thread.findLast((t) => t.role === "Q")?.text;
    const journeySteps = definitionFor(input.journeyType).steps;
    // Read once the plan authorises the run; nothing handed over until then.
    let delegationRead: Promise<QTurnAuthority | null> =
      Promise.resolve(NO_TURN_AUTHORITY);
    const port = createOnboardingPort({
      session: input.session,
      onboardingSessionId: input.onboardingSessionId,
      journeyType: input.journeyType,
      ownerUserId: actor.userId,
      // Only the person's own words can carry a write (P0-2): what they
      // just said, then what they said earlier in this conversation.
      personTurns: [
        ...(utterance.length === 0 ? [] : [utterance]),
        ...thread
          .filter((t) => t.role === "PERSON")
          .map((t) => t.text)
          .reverse(),
      ],
      lastQTurn,
      authority:
        dependencies.delegation === undefined
          ? undefined
          : () => delegationRead,
      recommendations: dependencies.recommendations,
      raisedChecks: raisedChecks.get(input.onboardingSessionId),
      runId,
    });
    // The newest turns verbatim, the older ones as a bounded summary
    // (P0-5): the whole conversation, within a fixed budget.
    const compacted = compactThread(thread);
    const conversation: InterviewAgentVariables["conversation"] = [
      ...compacted.recent,
    ];

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
    const reader = dependencies.delegation;
    if (!opening && reader !== undefined) {
      const pending = await port.pendingRecommendations().catch(() => []);
      delegationRead = reader.read({
        utterance,
        lastQ: lastQTurn ?? "",
        steps: journeySteps.map((step) => ({
          stepKey: step.stepKey,
          question: SPOKEN_QUESTIONS[step.stepKey] ?? step.configuration.prompt,
          about: step.configuration.supportingText ?? "",
          required: step.required,
        })),
        pending: pending.map((item) => ({
          stepKey: item.stepKey,
          recommended: item.value,
        })),
        attribution: {
          tenantId: actor.tenantId,
          userId: actor.userId,
          qRunId: runId,
          correlationId,
        },
        signal: input.signal,
      });
    }
    const memory = dependencies.memory;
    const loop =
      memory === undefined
        ? { memory: "", profile: DEFAULT_COMMUNICATION_PROFILE }
        : await createLoopMemoryReader({ memory }).read({
            actor,
            plan: decision.plan,
            sessionKey: input.onboardingSessionId,
          });
    // A stated preference is kept through the Write Gate, quote-checked
    // against the person's own words in this conversation.
    const noteTool =
      memory === undefined
        ? []
        : [
            createNotePreferenceTool(
              createPreferenceNotebook({
                memory,
                actor,
                sessionKey: input.onboardingSessionId,
                priorUserTurns: thread
                  .filter((t) => t.role === "PERSON")
                  .map((t) => t.text),
              }),
            ),
          ];
    const tools = createQToolExecutor({
      // Nothing said, nothing to write: an opening offers only reads, so
      // no answer can be recorded that the person did not give.
      registry: createQToolRegistry(
        [...createOnboardingTools(port), ...noteTool].filter(
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
    let state = await port.state();
    const authority = (await delegationRead) ?? NO_TURN_AUTHORITY;
    const listed = (keys: ReadonlySet<string>): string =>
      keys.size === 0
        ? "none"
        : JSON.stringify(
            journeySteps
              .filter((step) => keys.has(step.stepKey))
              .map((step) => ({
                stepKey: step.stepKey,
                question: (
                  SPOKEN_QUESTIONS[step.stepKey] ?? step.configuration.prompt
                ).slice(0, 300),
              })),
          ).slice(0, 2_000);
    const delegated = listed(authority.handed);
    const approved = listed(authority.approved);
    const declined = listed(authority.declined);

    // What else the turn asks, from the independent reading. A look-up
    // question goes on in the person's own words, never a model's; the
    // research ledger decides whether it may run.
    const ledger = conversationOf(input.onboardingSessionId);
    const lookupWords =
      authority.lookup === null
        ? null
        : textStatedIn(authority.lookup, utterance)
          ? authority.lookup
          : utterance.slice(0, 400);
    const lookup =
      lookupWords === null || opening
        ? null
        : !researchAvailable || isExhausted(ledger.failures, "RESEARCH")
          ? ({ kind: "UNAVAILABLE" } as const)
          : ledger.research !== null
            ? ({ kind: "RUNNING" } as const)
            : ({ kind: "RUN", question: lookupWords } as const);
    // A corrected pronunciation must come from what they said; the term
    // may be one Q just said.
    const pronounce =
      authority.pronounce !== null &&
      textStatedIn(authority.pronounce.sayAs, utterance) &&
      (textStatedIn(authority.pronounce.term, utterance) ||
        textStatedIn(authority.pronounce.term, lastQTurn ?? ""))
        ? authority.pronounce
        : null;
    const pausing = authority.pausing && !opening;
    const turnNotes = turnNotesFor({ pausing, lookup, pronounce });

    // Every round is rendered afresh from the onboarding state and what Q
    // has already done this turn, never from a provider's native tool
    // history: a fallback model cannot continue another provider's
    // function-call history (Gemini refuses one it did not sign), and a
    // turn must survive its first model failing half way.
    const actions: { tool: string; input: unknown; result: unknown }[] = [];
    const render = () =>
      renderPrompt<InterviewAgentV9Variables>(registry, {
        task: "INTERVIEW_AGENT",
        charter: input.channel === "voice" ? "Q_SYSTEM_VOICE" : "Q_SYSTEM",
        operatingMode: "ASSESSMENT",
        communicationProfile: loop.profile,
        // Capital Q's authority statement for this loop (lead decision,
        // 2026-09-25): a reversible write to the person's own onboarding, at
        // their explicit delegation, is scoped delegation, not an action on
        // Q's own account. Trusted text in the charter's frame.
        environmentNotes:
          "You change the person's onboarding only through your tools; a tool result is what happened. Capital Q grants scoped delegation here: when the person explicitly hands you a choice about their own onboarding and asks you to go ahead, recording your choice is acting on their instruction, reversible and theirs to change, and is permitted without a further approval step.",
        variables: {
          journey: input.journeyType,
          channel: input.channel,
          opening,
          state: JSON.stringify(state).slice(0, 24_000),
          conversation,
          utterance,
          memory: loop.memory.slice(0, 4_000),
          earlier: (compacted.summary ?? "").slice(0, 2_200),
          thisTurn: thisTurnText(actions),
          delegated,
          approved,
          declined,
          turnNotes,
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

    // A person is waiting: the whole turn has a deadline, and every model
    // call inside it is cut off by it. Only the person leaving (the
    // caller's own signal) is a cancellation; the deadline is a degraded
    // turn, answered honestly.
    const remaining = () => deadlineMs - (now() - startedAt);
    const deadline = new AbortController();
    const timer = setTimeout(
      () => {
        deadline.abort();
      },
      Math.max(0, remaining()),
    );
    const signal =
      input.signal === undefined
        ? deadline.signal
        : AbortSignal.any([input.signal, deadline.signal]);

    const stream =
      input.onSentence === undefined
        ? undefined
        : createReplySentenceStream(input.onSentence);
    let result: InterviewAgentResult | undefined;
    let rounds = 0;
    let calls = 0;
    let timedOut = false;
    try {
      while (
        result === undefined &&
        rounds < MAX_ROUNDS &&
        calls < MAX_CALLS &&
        remaining() > REPLY_RESERVE_MS
      ) {
        rounds += 1;
        const response = await gateway.execute(
          {
            ...base,
            messages: [...render().messages],
            output: { kind: "TEXT" },
            tools: offered.map((tool) => tool.definition),
          },
          {
            firstAttemptTimeoutMs: FIRST_ATTEMPT_MS,
            signal,
            ...(stream === undefined ? {} : { onTextDelta: stream.push }),
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
        for (const call of proposals) {
          calls += 1;
          const outcome = await tools.execute(
            { callId: call.callId, name: call.name, arguments: call.arguments },
            context,
          );
          actions.push({
            tool: call.name,
            input: call.arguments,
            result: resultOf(toolResultMessage(call, outcome)),
          });
        }
        state = await port.state();
      }
      if (result === undefined && remaining() > MIN_REPLY_MS) {
        // The reply, written after every result so far, with no tools left.
        const rendered = render();
        const response = await gateway.execute<InterviewAgentResult>(
          {
            ...base,
            messages: [...rendered.messages],
            output: rendered.output,
          },
          {
            schema: InterviewAgentResultSchema,
            firstAttemptTimeoutMs: FIRST_ATTEMPT_MS,
            signal,
          },
        );
        if (response.output.kind === "STRUCTURED") {
          result = (response.output as { readonly value: InterviewAgentResult })
            .value;
        }
      }
    } catch (error: unknown) {
      if (input.signal?.aborted === true) throw error;
      timedOut = deadline.signal.aborted;
      logger.warn(
        { err: error, rounds, calls, timedOut },
        "interview Q run failed",
      );
    } finally {
      clearTimeout(timer);
    }

    const view = port.view() ?? (await port.state(), port.view());
    if (view === null) {
      throw new Error("the onboarding session could not be read");
    }
    if (stream !== undefined && result !== undefined) {
      const { diverged } = stream.finish(result.reply);
      if (diverged) {
        logger.warn(
          { rounds },
          "the streamed reply and the settled reply differ; the rest was not streamed",
        );
      }
    }
    if (result !== undefined && result.raised.length > 0) {
      const open = new Set(state.checks.map((check) => check.checkId));
      raisedChecks.add(
        input.onboardingSessionId,
        result.raised.filter((id) => open.has(id)),
      );
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
    // A step whose concept is settled is never offered as the question,
    // whatever the reply asked (one concept, one answer).
    const covered = new Set(
      (await port.state().catch(() => null))?.steps
        .filter((row) => row.coveredBy !== undefined)
        .map((row) => row.stepKey) ?? [],
    );
    const handingOver = lookup?.kind === "RUN";
    const askedOpen =
      askedStep === undefined ||
      covered.has(askedStep.stepKey) ||
      handingOver ||
      pausing
        ? null
        : toOpenStep(askedStep, view);
    // Where the conversation returns once the look-up is done: the open
    // question the journey would ask next, required first.
    const resumeStep = handingOver
      ? (view.progress.eligibleSteps
          .filter(
            (e) =>
              e.status !== "COMPLETED" &&
              e.status !== "SKIPPED" &&
              !covered.has(e.stepKey),
          )
          .sort((a, b) => Number(b.required) - Number(a.required))
          .map((e) => steps.get(e.stepKey))
          .find((step) => step !== undefined) ?? null)
      : null;
    if (handingOver) {
      remember(
        input.onboardingSessionId,
        reduceConversation(ledger, {
          type: "RESEARCH_STARTED",
          question: lookup.question,
          resumeTopic: resumeStep?.stepKey ?? null,
        }),
      );
    }
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
        // What each write decided, by step and basis: never a value or a
        // quote, which are the person's words.
        decisions: decisionsOf(actions),
        stated: [...authority.stated],
        declined: [...authority.declined],
        handed: [...authority.handed],
        approved: [...authority.approved],
        finishing: authority.finishing,
        timedOut,
        ms: now() - startedAt,
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
      questionForQ: handingOver ? lookup.question : null,
      researching: handingOver ? lookup.question.slice(0, 200) : null,
      // A completed journey goes where the screen's own button goes: an
      // investor to the companies they set it up to see, a founder home.
      navigate:
        view.session.status === "COMPLETED"
          ? input.journeyType === "investor"
            ? "DISCOVER"
            : "HOME"
          : null,
      handoff: null,
      pronounce,
      warnings: 0,
      view,
      degraded: result === undefined,
      reading: null,
      resume:
        resumeStep === null
          ? null
          : {
              stepKey: resumeStep.stepKey,
              question: (
                SPOKEN_QUESTIONS[resumeStep.stepKey] ??
                resumeStep.configuration.prompt
              ).slice(0, 400),
            },
      qualitative: [],
      trace: null,
      askingAbout: stillOpen && askedOpen !== null ? [askedOpen.stepKey] : [],
      pending: {
        recommendations: await port.pendingRecommendations().catch(() => []),
        held: [],
      },
    };
  };

  const researchEnded = (onboardingSessionId: string, ok: boolean): void => {
    const finished = reduceConversation(conversationOf(onboardingSessionId), {
      type: "RESEARCH_FINISHED",
    });
    remember(
      onboardingSessionId,
      reduceConversation(finished, {
        type: ok ? "SUCCEEDED" : "FAILED",
        operation: "RESEARCH",
      }),
    );
  };

  return { turn, researchEnded };
}
