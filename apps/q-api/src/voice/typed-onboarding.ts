import { randomUUID } from "node:crypto";

import {
  getOnboardingSession,
  listOnboardingInterviewTurns,
  submitOnboardingResponse,
} from "@capital-q/api-client";
import type { OnboardingSessionView } from "@capital-q/contracts";
import type { ModelGateway } from "@capital-q/model-gateway";
import type { QDelegationReader } from "@capital-q/model-gateway/q";
import type { Logger } from "@capital-q/observability";
import {
  createDefaultPromptRegistry,
  DEFAULT_COMMUNICATION_PROFILE,
  OnboardingTypedReplyResultSchema,
  renderPrompt,
  type OnboardingTypedReplyResult,
  type OnboardingTypedReplyVariables,
  type PromptRegistry,
} from "@capital-q/q-core";
import type {
  FinishOnboardingOutput,
  OnboardingState,
} from "@capital-q/q-tools";

import type { HeldWritesStore } from "./held-writes.js";
import type { InterviewAgentTurnInput } from "./interview-agent.js";
import {
  definitionFor,
  optionsOf,
  toOpenStep,
  type InterviewTurnOutcome,
} from "./interview-steps.js";
import {
  briefOf,
  type ConversationLine,
  type OnboardingConversation,
} from "./onboarding-conversation.js";
import {
  finishingLine,
  pausingLine,
  REVIEW_NOT_SHOWN_REASON,
} from "./onboarding-flow.js";
import {
  coverageProfileFor,
  createOnboardingPort,
  type RecommendationStore,
} from "./onboarding-port.js";
import { SPOKEN_QUESTIONS } from "./step-copy.js";

/**
 * Typed onboarding as the voice line's conversation (owner 2026-10-28,
 * DECISIONS 39; production re-test the same day: "that's all" saved as an
 * answer, "skip that" asked straight back, one failing save holding back a
 * whole mandate). A typed line is kept in the onboarding thread at once and
 * read by meaning in the background (ONBOARDING_TRANSCRIPT_READER), which
 * saves through the checked path, exactly as a spoken one is. Q's reply is
 * ONE model call from the setup's checklist and the thread: it asks the
 * next thing and records nothing. Whether they are pausing or finishing is
 * the delegation reader's, by meaning, read beside the reply; finishing,
 * pausing and "what do you have so far" are answered from the record, by
 * code, once what they said is saved (bounded wait).
 */
export type TypedOnboarding = {
  /** Null: not a typed turn this path takes; the guided interview answers. */
  readonly turn: (
    input: InterviewAgentTurnInput,
  ) => Promise<InterviewTurnOutcome | null>;
};

const REPLY_BUDGET = {
  maxAttempts: 2,
  maxEstimatedCostUsd: 0.03,
  maxOutputTokens: 600,
  attemptTimeoutMs: 20_000,
} as const;

const THREAD_LIMIT = 60;

export function createTypedOnboarding(dependencies: {
  readonly conversation: Pick<OnboardingConversation, "said" | "flush">;
  readonly gateway: ModelGateway;
  readonly delegation?: QDelegationReader | undefined;
  readonly heldWrites?: HeldWritesStore | undefined;
  readonly recommendations?: RecommendationStore | undefined;
  readonly registry?: PromptRegistry | undefined;
  readonly dataPosture?: "REAL_CUSTOMER" | "SYNTHETIC_DEMO" | undefined;
  readonly logger: Logger;
}): TypedOnboarding {
  const { conversation, gateway, logger } = dependencies;
  const registry = dependencies.registry ?? createDefaultPromptRegistry();
  /** Sessions whose whole record code read back for their yes. */
  const readBackShown = new Set<string>();

  return {
    turn: async (input) => {
      const actor = input.actor;
      const utterance = input.utterance.trim().slice(0, 4_000);
      if (
        input.channel !== "text" ||
        actor === undefined ||
        utterance.length === 0 ||
        conversation.said === undefined
      ) {
        return null;
      }
      // A finished setup's follow-ups are the guided interview's.
      const status = await getOnboardingSession(
        input.session,
        input.onboardingSessionId,
      ).then(
        (view) => view.session.status,
        () => null,
      );
      if (status !== "ACTIVE") return null;
      const startedAt = Date.now();
      const line: ConversationLine = {
        voiceSessionId: `typed:${input.onboardingSessionId}`,
        actor,
        accessToken: input.session.accessToken,
        onboarding: {
          sessionId: input.onboardingSessionId,
          journeyType: input.journeyType,
        },
      };
      const portOf = (finishing: boolean) =>
        createOnboardingPort({
          session: input.session,
          onboardingSessionId: input.onboardingSessionId,
          journeyType: input.journeyType,
          ownerUserId: actor.userId,
          personTurns: [utterance],
          // This port writes nothing from words: it reads the record and,
          // on their word as the reading found it, finishes.
          authority: () =>
            Promise.resolve({
              stated: new Set<string>(),
              declined: new Set<string>(),
              handed: new Set<string>(),
              approved: new Set<string>(),
              finishing,
              lookup: null,
            }),
          recommendations: dependencies.recommendations,
          held: dependencies.heldWrites?.bind({
            userId: actor.userId,
            sessionId: input.onboardingSessionId,
          }),
          // A record review is confirmed only once code read the record
          // back in this conversation and they then said yes (production
          // re-test 2026-10-28: the raise confirmation was saved on "that's
          // all" because the journey's cursor stood on it; a cursor is not
          // something the person saw in a typed conversation).
          reviewShown: () => readBackShown.has(input.onboardingSessionId),
        });
      const fields = coverageProfileFor(input.journeyType).fields;
      const labelOf = (stepKey: string) => fields[stepKey]?.label;
      const destination = (completed: boolean) =>
        input.journeyType === "investor"
          ? "DISCOVER"
          : completed
            ? "PROFILE"
            : "HOME";

      // Sweep D1 (2026-10-29): the review's confirm button under Q's
      // read-back. The tap is their yes, so code confirms it as a typed
      // yes is confirmed (no model reads a button): the finish when every
      // essential is in, that one review when the setup is not done yet.
      const tapped = tappedReview(input.journeyType, input.confirmReview);
      if (tapped !== null) {
        // Anything still being read from earlier words lands first.
        await conversation.flush?.(line);
        // The read-back the button sits under is on their screen.
        readBackShown.add(input.onboardingSessionId);
        const done = await confirmTapped({
          tapped,
          journeyType: input.journeyType,
          finishing: portOf(true),
          state: () => portOf(false).state(),
          confirmOne: async () => {
            const view = await getOnboardingSession(
              input.session,
              input.onboardingSessionId,
            );
            await submitOnboardingResponse(
              input.session,
              input.onboardingSessionId,
              {
                stepKey: tapped,
                response: {
                  value: { type: "CONFIRMATION", confirmed: true },
                  channel: "CONVERSATION",
                },
                expectedSessionVersion: view.session.version,
              },
              randomUUID(),
            );
          },
          labelOf,
        });
        // Their words and Q's line join the thread after the write, so a
        // background reading of "That's right" finds it already settled.
        await conversation
          .said(line, "PERSON", utterance)
          .catch(() => undefined);
        return await outcomeOf({
          text: done.text,
          asking: done.asking,
          navigate: done.completed ? destination(true) : null,
          pausing: false,
          path: done.completed ? "FINISHED_BY_TAP" : "CONFIRMED_BY_TAP",
          finishing: true,
        });
      }

      const port = portOf(false);
      // Their words go in the thread first, so leaving now loses nothing;
      // the background reading is scheduled from them.
      const [state] = await Promise.all([
        port.state(),
        conversation.said(line, "PERSON", utterance),
      ]);
      const thread = await listOnboardingInterviewTurns(
        input.session,
        input.onboardingSessionId,
        THREAD_LIMIT,
      ).catch(() => ({ items: [] }));
      const turns = thread.items.map((turn) => ({
        role: turn.role,
        text: turn.text,
      }));
      const last = turns.at(-1);
      if (!(last?.role === "PERSON" && last.text.trim() === utterance)) {
        turns.push({ role: "PERSON", text: utterance });
      }
      const lastQ = turns.findLast((turn) => turn.role === "Q")?.text ?? "";
      const attribution = {
        tenantId: actor.tenantId,
        userId: actor.userId,
        correlationId: input.attribution.correlationId,
      };

      // The record review Q read back, when it did: their yes to it is
      // finishing (sweep D1: "yes" read as the review alone, and Q went on
      // to an optional question after "Say yes and I'll finish").
      const readBackReview = readBackShown.has(input.onboardingSessionId)
        ? (reviewOf(state, input.journeyType, labelOf)?.stepKey ?? null)
        : null;
      // The reply and the reading of whether they pause or finish run side
      // by side: the person waits for one model, not two in a row.
      const [authority, written] = await Promise.all([
        dependencies.delegation === undefined
          ? Promise.resolve(null)
          : dependencies.delegation
              .read({
                utterance,
                lastQ,
                ...(readBackReview === null
                  ? {}
                  : { askedStep: readBackReview }),
                steps: state.steps.map((step) => ({
                  stepKey: step.stepKey,
                  question: step.question,
                  about: step.question,
                  required: step.required,
                })),
                pending: [],
                attribution,
                ...(input.signal === undefined ? {} : { signal: input.signal }),
              })
              .catch(() => null),
        reply(input, state, turns).catch((error: unknown) => {
          logger.warn({ err: error }, "typed onboarding reply unavailable");
          return null;
        }),
      ]);

      const agreedToReadBack =
        readBackReview !== null &&
        authority?.stated.has(readBackReview) === true;

      let text: string;
      let asking: string | null = null;
      let navigate: InterviewTurnOutcome["navigate"] = null;
      let pausing = false;
      let path: string;
      if (authority?.pausing === true) {
        // What they said is saved first; the line says what is saved.
        await conversation.flush?.(line);
        text = pausingLine(
          input.journeyType,
          await portOf(false).state(),
          labelOf,
        );
        navigate = destination(false);
        pausing = true;
        path = "PAUSING";
      } else if (authority?.finishing === true || agreedToReadBack) {
        await conversation.flush?.(line);
        const finishing = portOf(true);
        const finished = await finishing.finish();
        const now = await finishing.state();
        const review =
          finished.reason === REVIEW_NOT_SHOWN_REASON
            ? reviewOf(now, input.journeyType, labelOf)
            : undefined;
        const said = finishingLine(input.journeyType, finished, {
          labelOf,
          questionOf: (stepKey) => SPOKEN_QUESTIONS[stepKey] ?? null,
          ...(review === undefined ? {} : { review }),
        });
        if (review !== undefined && said !== null) {
          readBackShown.add(input.onboardingSessionId);
        }
        text =
          said?.reply ??
          "Before I can finish, a few things are still open. Shall we go through them?";
        asking = said?.asking ?? null;
        if (finished.completed) navigate = destination(true);
        path = finished.completed ? "FINISHED" : "FINISHING";
      } else if (written?.readBack === true) {
        // Read back from Capital Q's own record, once what they said is in.
        await conversation.flush?.(line);
        // The record speaks for itself, from code; the model's one line
        // (a lead-in, or a question asked before the list) is not put
        // around it (sweep D7: the summary came after Q's question).
        text = savedSoFar(
          await portOf(false).state(),
          input.journeyType,
          labelOf,
        );
        path = "READ_BACK";
      } else if (written !== null) {
        text = withoutStepIds(written.reply, input.journeyType).trim();
        asking = written.asking;
        path = "REPLY";
      } else {
        const next = state.next?.[0]?.stepKey ?? null;
        text = `Sorry, I lost my thread for a second; I have what you wrote.${
          next === null
            ? ""
            : ` ${SPOKEN_QUESTIONS[next] ?? state.steps.find((s) => s.stepKey === next)?.question ?? ""}`
        }`.trim();
        asking = next;
        path = "DEGRADED";
      }

      return await outcomeOf({
        text,
        asking,
        navigate,
        pausing,
        path,
        finishing: authority?.finishing === true || agreedToReadBack,
      });

      /** Q's line kept with the step it asks, and the screen's outcome. */
      async function outcomeOf(said: {
        readonly text: string;
        readonly asking: string | null;
        readonly navigate: InterviewTurnOutcome["navigate"];
        readonly pausing: boolean;
        readonly path: string;
        readonly finishing: boolean;
      }): Promise<InterviewTurnOutcome> {
        // Live e11: the step this line asks is kept with it, so a reopening
        // asks the question the conversation had open (the line asked about
        // full-time founders; kept with no step, the resume asked team
        // size). Only a step of this journey; whether it is still open is
        // decided when it is read back.
        void conversation
          .said?.(
            line,
            "Q",
            said.text,
            keptStepOf(input.journeyType, said.asking),
          )
          .catch(() => undefined);
        const viewPort = portOf(false);
        await viewPort.state().catch(() => null);
        const view =
          viewPort.view() ??
          (await getOnboardingSession(
            input.session,
            input.onboardingSessionId,
          ));
        const askingStep = askingFor(view, input.journeyType, said.asking);
        logger.info(
          {
            path: said.path,
            asking: askingStep?.stepKey ?? null,
            pausing: said.pausing,
            finishing: said.finishing,
            ms: Date.now() - startedAt,
          },
          "typed onboarding turn",
        );
        return {
          reply: said.text,
          intent: said.pausing ? "PAUSE" : "ANSWER",
          asking: askingStep,
          recorded: [],
          skipped: [],
          questionForQ: null,
          researching: null,
          navigate: said.navigate,
          handoff: null,
          pronounce: null,
          warnings: 0,
          view,
          degraded: said.path === "DEGRADED",
          reading: null,
          resume: null,
          qualitative: [],
          trace: null,
          askingAbout: askingStep === null ? [] : [askingStep.stepKey],
          ...(said.pausing ? { pausing: true } : {}),
        };
      }
    },
  };

  async function reply(
    input: InterviewAgentTurnInput,
    state: OnboardingState,
    turns: readonly { readonly role: string; readonly text: string }[],
  ): Promise<OnboardingTypedReplyResult | null> {
    const transcript = turns
      .map((turn) => `${turn.role}: ${turn.text.replace(/\s+/g, " ").trim()}`)
      .join("\n")
      .slice(-30_000);
    const rendered = renderPrompt<OnboardingTypedReplyVariables>(registry, {
      task: "ONBOARDING_TYPED_REPLY",
      charter: "Q_SYSTEM",
      operatingMode: "ASSESSMENT",
      communicationProfile: DEFAULT_COMMUNICATION_PROFILE,
      environmentNotes:
        "You write Q's next message in an onboarding chat; Capital Q saves what the person says from the conversation, never from your message.",
      variables: {
        journey: input.journeyType,
        checklist: briefOf(state, { withIds: true }).slice(0, 12_000),
        transcript,
      },
    });
    const response = await gateway.execute<OnboardingTypedReplyResult>(
      {
        taskClass: "NORMAL_DIALOGUE",
        reasoning: "LOW",
        sensitivity: "CONFIDENTIAL",
        budget: REPLY_BUDGET,
        messages: [...rendered.messages],
        output: rendered.output,
        attribution: {
          purpose: "ONBOARDING" as const,
          tenantId: input.attribution.tenantId,
          userId: input.attribution.userId,
          correlationId: input.attribution.correlationId,
        },
        ...(dependencies.dataPosture === undefined
          ? {}
          : { dataPosture: dependencies.dataPosture }),
      },
      {
        schema: OnboardingTypedReplyResultSchema,
        ...(input.signal === undefined ? {} : { signal: input.signal }),
      },
    );
    if (response.output.kind !== "STRUCTURED") return null;
    const parsed = OnboardingTypedReplyResultSchema.safeParse(
      (response.output as { readonly value: unknown }).value,
    );
    return parsed.success ? parsed.data : null;
  }
}

/** The step a line asked, when it is one of this journey's steps. */
/**
 * The checklist shows each topic's id so the reply can name what it asks;
 * an id is never shown to the person, even if the model writes one.
 */
export function withoutStepIds(
  reply: string,
  journeyType: "founder" | "investor",
): string {
  let text = reply;
  for (const step of definitionFor(journeyType).steps) {
    const escaped = step.stepKey.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    text = text.replace(
      new RegExp(`\\s*\\(?(?:id:\\s*)?${escaped}\\)?`, "gu"),
      "",
    );
  }
  return text.replace(/\s{2,}/gu, " ");
}

export function keptStepOf(
  journeyType: "founder" | "investor",
  stepKey: string | null,
): string | null {
  if (stepKey === null) return null;
  return definitionFor(journeyType).steps.some((s) => s.stepKey === stepKey)
    ? stepKey
    : null;
}

/** The step a reply asks, with its options, when it is open on their path. */
function askingFor(
  view: OnboardingSessionView,
  journeyType: "founder" | "investor",
  stepKey: string | null,
): InterviewTurnOutcome["asking"] {
  if (stepKey === null) return null;
  const step = definitionFor(journeyType).steps.find(
    (s) => s.stepKey === stepKey,
  );
  const eligible = view.progress.eligibleSteps.some(
    (e) =>
      e.stepKey === stepKey &&
      e.status !== "COMPLETED" &&
      e.status !== "SKIPPED",
  );
  const open = step === undefined || !eligible ? null : toOpenStep(step, view);
  if (step === undefined || open === null) return null;
  return {
    stepKey,
    kind: open.kind,
    options: [...(open.options ?? optionsOf(step))],
    maxChoices: open.maxChoices,
  };
}

/** "Label: value" for what is saved, the review to ask, for a read-back. */
export function reviewOf(
  state: OnboardingState,
  journey: "founder" | "investor",
  labelOf: (stepKey: string) => string | undefined,
): { readonly saved: readonly string[]; readonly stepKey: string } | undefined {
  const reviewStep = state.steps.find(
    (row) =>
      row.status === "OPEN" &&
      definitionFor(journey).steps.find((step) => step.stepKey === row.stepKey)
        ?.configuration.stepType === "confirmation",
  );
  if (reviewStep === undefined) return undefined;
  return {
    stepKey: reviewStep.stepKey,
    saved: groupedSaved(state, journey, labelOf),
  };
}

/** The most answers one read-back carries: every essential, then the rest. */
const READ_BACK_ITEMS = 40;

/**
 * What is saved, grouped by the setup's own sections ("Raise: Raising now:
 * Yes; Target: $400,000"), every essential always in, optional answers
 * after them up to READ_BACK_ITEMS (production re-test 2026-10-28: a
 * read-back cut at fourteen lines left out the revenue and the raise).
 */
export function groupedSaved(
  state: OnboardingState,
  journey: "founder" | "investor",
  labelOf: (stepKey: string) => string | undefined,
): string[] {
  const definition = definitionFor(journey);
  const manifests = new Map(definition.steps.map((s) => [s.stepKey, s]));
  const rows = state.steps.filter(
    (row) =>
      row.status === "ANSWERED" && row.kind !== "YES_NO" && row.value !== null,
  );
  const essential = rows.filter((row) => row.required);
  const optional = rows.filter((row) => !row.required);
  const kept = new Set(
    [
      ...essential,
      ...optional.slice(0, Math.max(0, READ_BACK_ITEMS - essential.length)),
    ].map((row) => row.stepKey),
  );
  const plain = (value: string) => value.trim().replace(/[.;\s]+$/u, "");
  const groups = new Map<string, string[]>();
  for (const row of rows) {
    if (!kept.has(row.stepKey)) continue;
    // Live 2026-10-29: "Welcome: What brings you to Capital Q: are you
    // raising…?: I'm raising". A step with no plain label is the journey's
    // own move (the intent), not a fact about them; it is not read back.
    const label = labelOf(row.stepKey);
    if (label === undefined) continue;
    const phase = manifests.get(row.stepKey)?.configuration.phaseKey ?? "";
    const items = groups.get(phase) ?? [];
    items.push(`${label}: ${plain(row.value ?? "")}`);
    groups.set(phase, items);
  }
  const titles = new Map(
    definition.schema.phases.map((p) => [p.phaseKey, p.label] as const),
  );
  // One block a group: its section's name on a line, then one line an
  // answer (the screen lists it in body type, never one paragraph).
  return [...groups.entries()].map(([phase, items]) => {
    const title = titles.get(phase);
    return [...(title === undefined ? [] : [title]), ...items].join("\n");
  });
}

/**
 * What is saved, what is still saving, and what is still needed, read back
 * from the record by code (sweep D7, 2026-10-29): the setup's own labels
 * grouped by section, as the finish's read-back is; a step with no plain
 * label (the journey's own "what brings you here") is never read back by
 * its internal question.
 */
export function savedSoFar(
  state: OnboardingState,
  journey: "founder" | "investor",
  labelOf: (stepKey: string) => string | undefined,
): string {
  const saved = groupedSaved(state, journey, labelOf);
  const named = (rows: readonly OnboardingState["steps"][number][]) =>
    rows.flatMap((row) => {
      const label = labelOf(row.stepKey);
      return label === undefined ? [] : [label.toLowerCase()];
    });
  const saving = named(
    state.steps.filter(
      (row) => row.savePending === true && row.status !== "ANSWERED",
    ),
  );
  const needed = named(
    state.steps.filter(
      (row) =>
        row.status === "OPEN" &&
        row.required &&
        row.kind !== "YES_NO" &&
        row.savePending !== true,
    ),
  ).slice(0, 6);
  return [
    saved.length === 0
      ? "Nothing is saved yet."
      : `Here's what I have saved so far:\n\n${saved.join("\n\n")}`,
    saving.length === 0 ? "" : `Still saving: ${saving.join(", ")}.`,
    needed.length === 0 ? "" : `Still to cover: ${needed.join(", ")}.`,
  ]
    .filter((part) => part.length > 0)
    .join("\n\n");
}

/**
 * The confirmation step a tapped confirm button names, when it is one of
 * this journey's confirmation steps; null otherwise (the tap is then an
 * ordinary typed turn).
 */
export function tappedReview(
  journeyType: "founder" | "investor",
  stepKey: string | undefined,
): string | null {
  if (stepKey === undefined) return null;
  const step = definitionFor(journeyType).steps.find(
    (s) => s.stepKey === stepKey,
  );
  return step?.configuration.stepType === "confirmation" ? stepKey : null;
}

/**
 * Their tap on a review's confirm button, as a typed yes (sweep D1): every
 * essential in, it finishes, settling the other reviews and any optional
 * question the journey waits on (never asking one); not yet, it confirms
 * that review alone, as the tap always did, and asks what comes next.
 */
export async function confirmTapped(input: {
  readonly tapped: string;
  readonly journeyType: "founder" | "investor";
  readonly finishing: {
    readonly finish: () => Promise<FinishOnboardingOutput>;
  };
  readonly state: () => Promise<OnboardingState>;
  readonly confirmOne: () => Promise<void>;
  readonly labelOf: (stepKey: string) => string | undefined;
}): Promise<{
  readonly text: string;
  readonly asking: string | null;
  readonly completed: boolean;
}> {
  const finished = await input.finishing.finish();
  if (!finished.completed && finished.missing.length > 0) {
    try {
      await input.confirmOne();
    } catch {
      return {
        text: "I couldn't save that just now. Tap it again in a moment.",
        asking: input.tapped,
        completed: false,
      };
    }
    const now = await input.state();
    const next = now.next?.[0]?.stepKey ?? null;
    const question =
      next === null
        ? ""
        : (SPOKEN_QUESTIONS[next] ??
          now.steps.find((step) => step.stepKey === next)?.question ??
          "");
    return {
      text: `Thank you, that's confirmed.${question.length === 0 ? "" : ` ${question}`}`,
      asking: question.length === 0 ? null : next,
      completed: false,
    };
  }
  const said = finishingLine(input.journeyType, finished, {
    labelOf: input.labelOf,
    questionOf: (stepKey) => SPOKEN_QUESTIONS[stepKey] ?? null,
  });
  return {
    text:
      said?.reply ??
      "Before I can finish, a few things are still open. Shall we go through them?",
    asking: said?.asking ?? null,
    completed: finished.completed,
  };
}
