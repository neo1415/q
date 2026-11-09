import type { ActorContext } from "@capital-q/security";
import {
  getOnboardingSession,
  listOnboardingInterviewTurns,
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
  figuresOf,
  heldOfferedIn,
  isPlainYes,
  restatedHeld,
} from "./held-accept.js";
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
import { writeSession } from "./session-writes.js";
import { plainStepLabel, SPOKEN_QUESTIONS } from "./step-copy.js";
import {
  heldFromTheirWords,
  isPlaybackLine,
  NO_DEPTH,
  playbackLine,
  topicOf,
  type ConversationalDepth,
} from "./conversational-depth.js";

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
  /**
   * One closed question about their words, by meaning (P1-2): whether
   * their reply agrees to what Q just read back. Absent: no reply counts
   * as agreement (fail closed).
   */
  readonly wordsCheck?:
    | ((
        actor: ActorContext,
        question: string,
        words: string,
      ) => Promise<"YES" | "NO" | "UNSURE" | null>)
    | undefined;
  readonly conversation: Pick<
    OnboardingConversation,
    "said" | "flush" | "answered"
  >;
  readonly gateway: ModelGateway;
  readonly delegation?: QDelegationReader | undefined;
  readonly heldWrites?: HeldWritesStore | undefined;
  readonly recommendations?: RecommendationStore | undefined;
  readonly registry?: PromptRegistry | undefined;
  readonly dataPosture?: "REAL_CUSTOMER" | "SYNTHETIC_DEMO" | undefined;
  /** DECISIONS 81's switches; absent: NO_DEPTH (before D81). */
  readonly depth?: ConversationalDepth | undefined;
  readonly logger: Logger;
}): TypedOnboarding {
  const { conversation, gateway, logger } = dependencies;
  const depth = dependencies.depth ?? NO_DEPTH;
  /** D81 #2: the topics whose why Q asked, by session (one each). */
  const probed = new Map<string, Set<string>>();
  /** D81 #2, owner Q3: the topic whose why Q's last line asked, by session. */
  const probing = new Map<string, string>();
  /** Their why for a topic still held for their yes: kept once it is saved. */
  const whyWaiting = new Map<string, Map<string, string>>();
  /** D81 #4: replays of a topic's playback after a correction, by session. */
  const replays = new Map<string, Map<string, number>>();
  /** D82: topics already played back, by session (once each). */
  const playedTopics = new Map<string, Set<string>>();

  const bounded = <V>(map: Map<string, V>, key: string, value: V) => {
    map.delete(key);
    map.set(key, value);
    if (map.size > 2_000) {
      const oldest = map.keys().next().value;
      if (oldest !== undefined) map.delete(oldest);
    }
  };
  const registry = dependencies.registry ?? createDefaultPromptRegistry();
  /** Sessions whose whole record code read back for their yes. */
  const readBackShown = new Set<string>();
  /**
   * Sessions whose read-back listed suggestions waiting on their yes: that
   * yes is read before finishing, since the reading saves them.
   */
  const readBackWaiting = new Set<string>();
  /**
   * Sessions whose person asked to finish while essentials were still
   * open (sweep D1, 2026-10-29: "please finish", Q asked the last
   * essential, they answered, and Q went on to an optional question).
   * Their next answers go on toward finishing until the read-back.
   */
  const finishAsked = new Set<string>();
  /**
   * The step Q's last line asked, per session (live 2026-10-30, Granary):
   * "yes that's right" to Q's summary was read with no question in view
   * and taken as finishing. The reading is told what was asked.
   */
  const lastAsked = new Map<string, string>();
  /**
   * How many times the finishing line has asked each step that is still
   * open, by session (e2e run 6: one strength question asked 13 times
   * word for word). Bounded like the others.
   */
  const finishRepeats = new Map<string, Map<string, number>>();
  /**
   * How many times Q's own replies asked each needed step that is still
   * open, by session, whatever the wording (e2e run 8: the founder's
   * finances asked seven times, reworded each time). Bounded.
   */
  const replyAsks = new Map<string, Map<string, number>>();
  const parkRepeated = (input: {
    readonly sessionId: string;
    readonly journey: "founder" | "investor";
    readonly state: OnboardingState;
    readonly text: string;
    readonly asking: string | null;
    readonly labelOf: (stepKey: string) => string | undefined;
  }): { readonly text: string; readonly asking: string | null } => {
    const asks = replyAsks.get(input.sessionId) ?? new Map<string, number>();
    replyAsks.delete(input.sessionId);
    replyAsks.set(input.sessionId, asks);
    if (replyAsks.size > 2_000) {
      const oldest = replyAsks.keys().next().value;
      if (oldest !== undefined) replyAsks.delete(oldest);
    }
    const asked = input.asking;
    const step =
      asked === null
        ? undefined
        : input.state.steps.find((one) => one.stepKey === asked);
    if (asked === null || step === undefined || !neededOpen(step)) {
      return { text: input.text, asking: input.asking };
    }
    // e2e run 10 (integration): every ask of a still-open needed step
    // counts, interleaved or not (the deployment question came back four
    // times with others between); a playback is no ask. The third time:
    // its reason and its choices, once; the fourth: left for now.
    const times = asks.get(asked) ?? 0;
    asks.set(asked, times + 1);
    if (times < 2) return { text: input.text, asking: input.asking };
    if (times === 2) {
      const choices = (step.options ?? []).map((option) => option.label);
      const question = (SPOKEN_QUESTIONS[asked] ?? step.question)
        .trim()
        .replace(/\?$/u, "");
      const why =
        input.journey === "investor"
          ? "Just so I can match you well"
          : "Just so investors see your company right";
      return {
        text: `${withoutLastQuestion(input.text)} ${why}, I need this one: ${question}${
          choices.length >= 2
            ? `: ${choices.slice(0, -1).join(", ")} or ${choices.at(-1) ?? ""}?`
            : "?"
        }`.trim(),
        asking: asked,
      };
    }
    // The next needed one, never one left for now.
    const next =
      [
        ...(input.state.next ?? []).map((item) => item.stepKey),
        ...input.state.steps.map((one) => one.stepKey),
      ]
        .map((key) => input.state.steps.find((one) => one.stepKey === key))
        .find(
          (one) =>
            one !== undefined &&
            one.stepKey !== asked &&
            neededOpen(one) &&
            (asks.get(one.stepKey) ?? 0) < 3,
        ) ?? null;
    const nextQuestion =
      next === null
        ? ""
        : ` ${(SPOKEN_QUESTIONS[next.stepKey] ?? next.question).trim()}`;
    const before = withoutLastQuestion(input.text);
    if (times > 3) {
      // Left already: asked again anyway, the next one is asked instead.
      return {
        text: `${before}${nextQuestion}`.trim(),
        asking: next?.stepKey ?? null,
      };
    }
    const label = (input.labelOf(asked) ?? plainStepLabel(asked)).toLowerCase();
    const why =
      input.journey === "investor"
        ? "it helps me match you well"
        : "investors look for it on your profile";
    return {
      text: `${before} No problem: ${label} matters because ${why}, but let's leave it for now; you can add it here or on your profile any time.${nextQuestion}`.trim(),
      asking: next?.stepKey ?? null,
    };
  };
  /**
   * Turns taken, per session: a follow-up to a reply is written only while
   * that reply is still Q's last line (nothing said since).
   */
  const turnsTaken = new Map<string, number>();

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
      /** What Q is doing, shown at once on a turn that takes a while. */
      const stage = (label: string): void => {
        try {
          input.onStage?.({ stage: "SAVING", label });
        } catch {
          // Display only.
        }
      };
      const turnNumber = (turnsTaken.get(input.onboardingSessionId) ?? 0) + 1;
      turnsTaken.delete(input.onboardingSessionId);
      turnsTaken.set(input.onboardingSessionId, turnNumber);
      // Bounded: the oldest session's count goes first.
      if (turnsTaken.size > 2_000) {
        const oldest = turnsTaken.keys().next().value;
        if (oldest !== undefined) turnsTaken.delete(oldest);
      }
      const line: ConversationLine = {
        voiceSessionId: `typed:${input.onboardingSessionId}`,
        actor,
        accessToken: input.session.accessToken,
        onboarding: {
          sessionId: input.onboardingSessionId,
          journeyType: input.journeyType,
        },
      };
      const portOf = (
        finishing: boolean,
        approved: ReadonlySet<string> = new Set<string>(),
        /** Q's line they answered: a held category is accepted only when it named it. */
        lastQTurn?: string,
      ) =>
        createOnboardingPort({
          logger,
          ...(dependencies.wordsCheck === undefined
            ? {}
            : {
                wordsCheck: (question: string, words: string) =>
                  dependencies.wordsCheck?.(actor, question, words) ??
                  Promise.resolve(null),
              }),
          session: input.session,
          onboardingSessionId: input.onboardingSessionId,
          journeyType: input.journeyType,
          ownerUserId: actor.userId,
          personTurns: [utterance],
          ...(lastQTurn === undefined ? {} : { lastQTurn }),
          // This port writes nothing from words: it reads the record and,
          // on their word as the reading found it, finishes.
          authority: () =>
            Promise.resolve({
              stated: new Set<string>(),
              declined: new Set<string>(),
              handed: new Set<string>(),
              // A suggestion of Q's they approved, as the reading of their
              // latest words beside the reply found (never a phrase).
              approved,
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
            await writeSession(
              {
                session: input.session,
                onboardingSessionId: input.onboardingSessionId,
                logger,
              },
              {
                kind: "SUBMIT",
                request: {
                  stepKey: tapped,
                  response: {
                    value: { type: "CONFIRMATION", confirmed: true },
                    channel: "CONVERSATION",
                  },
                },
              },
            );
          },
          labelOf,
        });
        // Their words and Q's line join the thread after the write, so a
        // background reading of "That's right" finds it already settled.
        await conversation
          .said(line, "PERSON", utterance)
          .catch((error: unknown) => {
            logger.warn({ err: error }, "typed onboarding words not kept");
          });
        return await outcomeOf({
          text: done.text,
          asking: done.asking,
          navigate: done.completed ? destination(true) : null,
          pausing: false,
          path: done.completed ? "FINISHED_BY_TAP" : "CONFIRMED_BY_TAP",
          finishing: true,
          readBack: false,
        });
      }

      const port = portOf(false);
      // Their words go in the thread first, so leaving now loses nothing;
      // the background reading is scheduled from them.
      const [state, heldBefore] = await Promise.all([
        port.state(),
        // D81 #4: what their own words gave that waits for the topic's
        // playback; the checklist marks it, so Q never asks it again.
        depth.playbackBeforeSave
          ? port.pendingRecommendations().catch(() => [])
          : Promise.resolve([]),
        conversation.said(line, "PERSON", utterance),
      ]);
      const playedBack = new Set(
        heldBefore
          .filter((item) => heldFromTheirWords(item.rationale))
          .map((item) => item.stepKey),
      );
      // Read now, beside the reply. Only finishing waits for it (what is
      // missing is decided from the record); Q's ordinary reply never does
      // (live final re-check 2026-10-31: waiting made typed turns 12 s at
      // the median). If the reading lands after a reply that asked what the
      // same words answered, Q follows up (followUpIfAnswered).
      const reading: Promise<boolean | void> =
        conversation.flush?.(line).catch((error: unknown) => {
          logger.warn({ err: error }, "typed onboarding words not read");
          return false;
        }) ?? Promise.resolve(true);
      const thread = await listOnboardingInterviewTurns(
        input.session,
        input.onboardingSessionId,
        THREAD_LIMIT,
      ).catch((error: unknown) => {
        logger.warn({ err: error }, "typed onboarding thread not read");
        return { items: [] };
      });
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
      // Only while the read-back is Q's last line: a reply binds to the one
      // thing Q just asked (live re-check 2026-10-31: after the read-back
      // Q put a summary to them, their "yes" to it was also read as the
      // read-back's yes, and the setup finished with four suggestions
      // never said). readBackShown is cleared by any other line of Q's.
      const readBackReview = readBackShown.has(input.onboardingSessionId)
        ? (reviewOf(state, input.journeyType, labelOf)?.stepKey ?? null)
        : null;
      // Live check 2026-10-31 ("Nordlicht"): "only well-matched inbound"
      // was held for their yes (a judgement, said unasked); Q then asked
      // the inbound question from scratch, and their answer waited 23 s on
      // readings. Q's last line put that held suggestion to them: whether
      // they approve it is read with their words, and it is accepted at
      // once, as it was put to them.
      const heldAsked = heldAskedOf(
        state,
        lastAsked.get(input.onboardingSessionId),
      );
      const heldOffer =
        heldAsked === null
          ? []
          : (
              await port.pendingRecommendations().catch((error: unknown) => {
                logger.warn(
                  { err: error },
                  "typed onboarding suggestions not read",
                );
                return [];
              })
            )
              // The held step asked, and every other held value Q's line
              // read back with it (e2e run 5: the cheque is read back as
              // one set, so one yes accepts the set).
              .filter((item, _index, all) =>
                heldOfferedIn(all, heldAsked, lastQ).includes(item),
              );
      // The reply and the reading of whether they pause or finish run side
      // by side: the person waits for one model, not two in a row. A turn
      // that pauses or finishes never uses the reply, so it is not waited
      // for there (live 2026-10-31: "skip the rest" 15.8-19.5 s, the final
      // yes 16.8 s, against ~4 s for a normal turn): it is stopped.
      const replyStop = new AbortController();
      const stopReply = () => replyStop.abort();
      if (input.signal?.aborted === true) stopReply();
      input.signal?.addEventListener("abort", stopReply, { once: true });
      const replying = reply(input, state, turns, replyStop.signal, playedBack)
        .catch((error: unknown) => {
          if (!replyStop.signal.aborted)
            logger.warn({ err: error }, "typed onboarding reply unavailable");
          return null;
        })
        .finally(() => input.signal?.removeEventListener("abort", stopReply));
      const authority = await (dependencies.delegation === undefined
        ? Promise.resolve(null)
        : dependencies.delegation
            .read({
              utterance,
              lastQ,
              ...(readBackReview === null
                ? lastAsked.has(input.onboardingSessionId)
                  ? { askedStep: lastAsked.get(input.onboardingSessionId) }
                  : {}
                : { askedStep: readBackReview }),
              steps: state.steps.map((step) => ({
                stepKey: step.stepKey,
                question: step.question,
                about: step.question,
                required: step.required,
              })),
              pending: heldOffer.map((item) => ({
                stepKey: item.stepKey,
                recommended: item.value,
              })),
              attribution,
              ...(input.signal === undefined ? {} : { signal: input.signal }),
            })
            .catch((error: unknown) => {
              logger.warn({ err: error }, "typed onboarding intent not read");
              return null;
            }));
      const endsHere =
        authority?.pausing === true ||
        authority?.finishing === true ||
        finishAsked.has(input.onboardingSessionId) ||
        (readBackReview !== null &&
          authority?.stated.has(readBackReview) === true);
      if (endsHere) replyStop.abort();
      const written = endsHere ? null : await replying;
      // The held suggestion Q put to them, approved: accepted now, exactly
      // as it was put to them (the port checks it is still pending and
      // was said), so nothing waits on a reading of "yes" for it.
      const acceptedNow = new Set<string>();
      // Restating the very values Q read back is a yes to them too (e2e run
      // 5: every reply to the cheque read-back restated the range, and none
      // counted). Code decides, from the figures and words themselves.
      const restated = new Set(restatedHeld(heldOffer, utterance));
      // A plain yes to code's own read-back ("… Shall I keep these?") is a
      // yes to exactly what that line read back (e2e run 6: "Yes." left the
      // cheque held). Code decides; the values were said in that line.
      const yesToReadBack =
        isPlainYes(utterance) &&
        (isReadBackLine(lastQ) || isPlaybackLine(lastQ));
      const approvedOffer = heldOffer.filter(
        (item) =>
          yesToReadBack ||
          authority?.approved.has(item.stepKey) === true ||
          restated.has(item.stepKey),
      );
      if (approvedOffer.length > 0) {
        const accepted = await portOf(
          false,
          new Set(approvedOffer.map((item) => item.stepKey)),
          lastQ,
        )
          .accept(approvedOffer.map((item) => item.stepKey))
          .catch((error: unknown) => {
            logger.warn(
              { err: error },
              "typed onboarding suggestion not accepted",
            );
            return [];
          });
        for (const result of accepted) {
          if (result.outcome === "COMMITTED") acceptedNow.add(result.stepKey);
        }
      }
      // D81 #2, owner Q3: their answer to Q's why is kept as that topic's
      // private note, once its answer is on the record.
      if (depth.whyAsNote) {
        await keepWhy(utterance).catch((error: unknown) => {
          logger.warn({ err: error }, "their why was not kept");
        });
      }
      const agreedToReadBack =
        readBackReview !== null &&
        authority?.stated.has(readBackReview) === true;
      const stillFinishing = finishAsked.has(input.onboardingSessionId);

      // e2e run 8: the investor's last answer was taken, Q wrote "That's
      // all set …" and asked nothing, and nothing finished. A reply that
      // asks nothing, once what they said is in, goes on to the finish when
      // nothing needed is open: the read-back for their yes, or done.
      const asksNothing =
        written !== null &&
        written.readBack !== true &&
        written.asking === null &&
        !/[?؟]/u.test(written.reply) &&
        authority?.pausing !== true;
      let allAnswered = false;
      if (asksNothing && authority?.finishing !== true && !stillFinishing) {
        await (conversation.answered === undefined
          ? reading
          : conversation.answered(line, "LATEST"));
        allAnswered = !(await portOf(false).state()).steps.some(neededOpen);
      }
      const finishingNow =
        authority?.finishing === true ||
        agreedToReadBack ||
        stillFinishing ||
        allAnswered;

      let text: string;
      let asking: string | null = null;
      let navigate: InterviewTurnOutcome["navigate"] = null;
      let pausing = false;
      let showedReadBack = false;
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
      } else if (finishingNow) {
        // Said at once (live check 2026-10-31: "skip the rest" and the
        // final yes left the person looking at nothing for 12-23 s): the
        // stage, and on a streamed turn Q's first line, go out the moment
        // the reading of their words decided this, before any wait on
        // what is saved; the read-back follows as soon as it is ready.
        stage(
          agreedToReadBack
            ? "Finishing your setup"
            : "Checking what I have saved for you",
        );
        // Said once, on the turn they ask to finish or agree to the
        // read-back; never again on the answers that follow while open
        // essentials are asked (e2e run 2, 7 Nov: every later turn began
        // "I'll check what I have saved and read it back to you", and no
        // read-back came). It promises nothing it may not do.
        const askedNow = authority?.finishing === true || agreedToReadBack;
        const firstLine =
          input.onSentence === undefined || !askedNow
            ? null
            : agreedToReadBack
              ? "Thank you, finishing your setup now."
              : "Understood. Let me check what I have.";
        if (firstLine !== null) {
          try {
            input.onSentence?.(firstLine);
          } catch {
            // Display only.
          }
        }
        // What they said is in before anything is called missing. Their
        // latest words are waited for only when the reading of them beside
        // the reply found they state something to save (or a yes to a
        // read-back that listed suggestions, which the reading saves);
        // otherwise only earlier words are, and the latest line's reading
        // (declines, a "not sure") goes on in the background. Either way
        // only their answers are waited for: setting aside what they
        // declined is never waited on (it was twelve writes one by one).
        const through =
          statesMore(
            withoutAccepted(authority, acceptedNow),
            input.journeyType,
          ) ||
          (agreedToReadBack && readBackWaiting.has(input.onboardingSessionId))
            ? "LATEST"
            : "EARLIER";
        const answeredIn =
          conversation.answered === undefined
            ? await reading
            : await conversation.answered(line, through);
        if (answeredIn === false) await conversation.flush?.(line);
        const finishing = portOf(true);
        const finished = await finishing.finish();
        // Read side by side: the record and Q's suggestions on it.
        const [now, pendingNow] = await Promise.all([
          finishing.state(),
          finished.completed
            ? Promise.resolve([])
            : finishing.pendingRecommendations().catch((error: unknown) => {
                logger.warn(
                  { err: error },
                  "typed onboarding suggestions not read",
                );
                return [];
              }),
        ]);
        const shown =
          finished.reason === REVIEW_NOT_SHOWN_REASON
            ? reviewOf(now, input.journeyType, labelOf)
            : undefined;
        // Q's suggestions waiting on their yes: listed in a read-back, and
        // a needed step still missing that has one is put to them as that
        // suggestion, never asked from scratch (live 2026-10-31).
        const suggestions =
          shown !== undefined || finished.missing.length > 0 ? pendingNow : [];
        const review =
          shown === undefined
            ? undefined
            : {
                ...shown,
                pending: waitingOnYes(now, suggestions, labelOf),
              };
        // Already finishing, Q's last line asked a needed step, and they
        // said they would rather not answer it: it is let go for now, not
        // put again word for word. A reply that only missed the question
        // (e2e run 2: "Yes, actively raising." to "Which currency…") is not
        // a decline, so the question is asked again.
        const lastAskedKey = stillFinishing
          ? lastAsked.get(input.onboardingSessionId)
          : undefined;
        const unsettled =
          lastAskedKey !== undefined &&
          authority?.declined.has(lastAskedKey) === true
            ? lastAskedKey
            : undefined;
        // Counts only while finishing: a fresh finish starts afresh.
        if (!stillFinishing) finishRepeats.delete(input.onboardingSessionId);
        const asks =
          finishRepeats.get(input.onboardingSessionId) ??
          new Map<string, number>();
        const said = finishingLine(input.journeyType, finished, {
          labelOf,
          questionOf: (stepKey) => SPOKEN_QUESTIONS[stepKey] ?? null,
          repeats: (stepKey) => asks.get(stepKey) ?? 0,
          choicesOf: (stepKey) => {
            const step = definitionFor(input.journeyType).steps.find(
              (candidate) => candidate.stepKey === stepKey,
            );
            return step === undefined
              ? []
              : optionsOf(step).map((option) => option.label);
          },
          heldFor: (stepKey) =>
            suggestions.find((item) => item.stepKey === stepKey)?.value ?? null,
          ...(review === undefined ? {} : { review }),
          ...(unsettled === undefined ? {} : { unsettled }),
        });
        const counted = said?.asking ?? said?.leaving ?? null;
        if (counted !== null) {
          asks.set(counted, (asks.get(counted) ?? 0) + 1);
          finishRepeats.delete(input.onboardingSessionId);
          finishRepeats.set(input.onboardingSessionId, asks);
          if (finishRepeats.size > 2_000) {
            const oldest = finishRepeats.keys().next().value;
            if (oldest !== undefined) finishRepeats.delete(oldest);
          }
        }
        if (review !== undefined && said !== null) {
          readBackShown.add(input.onboardingSessionId);
          if (review.pending.length > 0) {
            readBackWaiting.add(input.onboardingSessionId);
          } else {
            readBackWaiting.delete(input.onboardingSessionId);
          }
          showedReadBack = true;
        }
        // Still open essentials: their next answer goes on toward the
        // finish. Finished, or read back for their yes: that yes decides.
        // After the one short close for a step left for now, finishing
        // stops here: their next words are the conversation again, never
        // the same close once more (e2e run 7).
        const closed =
          said?.leaving !== undefined && (asks.get(said.leaving) ?? 0) > 3;
        if (!finished.completed && finished.missing.length > 0 && !closed) {
          finishAsked.add(input.onboardingSessionId);
        } else {
          finishAsked.delete(input.onboardingSessionId);
        }
        const rest =
          said?.reply ??
          "Before I can finish, a few things are still open. Shall we go through them?";
        // The streamed first line stays part of the whole reply.
        // "Let me check what I have." leads a check, never a close that
        // leaves a step for now (e2e run 7).
        // Reached because everything is answered: Q's own line leads it.
        const lead =
          allAnswered && written !== null ? written.reply.trim() : null;
        text =
          lead !== null && lead.length > 0
            ? `${lead} ${rest}`
            : firstLine === null || said?.leaving !== undefined
              ? rest
              : `${firstLine} ${rest}`;
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
        // Q's reply now, never after the reading (ONBOARDING_TYPED_REPLY v5
        // reads their latest message itself and does not ask what it
        // answered; the follow-up below covers a reply that still did).
        // Never a claim of what is saved that the record does not hold.
        text = withoutUnsavedRecordClaims(
          withoutStepIds(written.reply, input.journeyType),
          state,
          utterance,
        ).trim();
        asking = written.asking;
        // D81 #2: one why per topic. A second probe of the same topic is
        // taken out and the next needed question asked instead.
        if (written.probing !== null) {
          const seen = probed.get(input.onboardingSessionId) ?? new Set();
          bounded(probed, input.onboardingSessionId, seen);
          if (seen.has(written.probing)) {
            const next = state.steps.find(
              (one) => one.stepKey !== written.probing && neededOpen(one),
            );
            text = `${withoutLastQuestion(text)}${
              next === undefined
                ? ""
                : ` ${(SPOKEN_QUESTIONS[next.stepKey] ?? next.question).trim()}`
            }`.trim();
            asking = next?.stepKey ?? null;
            logger.info(
              { probing: written.probing },
              "a second why for one topic was taken out",
            );
          } else {
            seen.add(written.probing);
            bounded(probing, input.onboardingSessionId, written.probing);
          }
        }
        // D81 #4: moving on from a topic, or after their correction of its
        // playback, code plays the topic back for their yes.
        const played = depth.playbackBeforeSave
          ? await topicPlayback({
              text,
              asking,
              lastQ,
              acceptedNow,
            })
          : null;
        if (played !== null) {
          text = played.text;
          asking = played.asking;
        }
        // DECISIONS 77, whoever words the question: a needed step asked
        // twice with no answer it could take is, the third time, given its
        // reason once and left for now; Q moves to the next one.
        const parked =
          played === null
            ? parkRepeated({
                sessionId: input.onboardingSessionId,
                journey: input.journeyType,
                state,
                text,
                asking,
                labelOf,
              })
            : { text, asking };
        text = parked.text;
        asking = parked.asking;
        path = played === null ? "REPLY" : "PLAYBACK";
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

      const outcome = await outcomeOf({
        text,
        asking,
        navigate,
        pausing,
        path,
        finishing: finishingNow,
        readBack: showedReadBack,
      });
      // The step the reply asked, as written: when the reading landed
      // before the screen's view was read, the outcome no longer names it,
      // and the line still asks it.
      const askedOpen = keptStepOf(input.journeyType, asking) ?? undefined;
      if (
        path === "REPLY" &&
        askedOpen !== undefined &&
        state.steps.some(
          (step) =>
            step.stepKey === askedOpen &&
            step.status === "OPEN" &&
            step.savePending !== true,
        )
      ) {
        // In the background: the person already has Q's reply.
        void reading
          .then(() =>
            followUpIfAnswered({
              asked: askedOpen,
              stillLast: () =>
                turnsTaken.get(input.onboardingSessionId) === turnNumber,
              state: () => portOf(false).state(),
              say: async (said) => {
                await conversation.said?.(
                  line,
                  "Q",
                  said.text,
                  keptStepOf(input.journeyType, said.asking),
                );
                lastAsked.delete(input.onboardingSessionId);
                if (said.asking !== null) {
                  lastAsked.set(input.onboardingSessionId, said.asking);
                }
              },
            }),
          )
          .then((followed) => {
            if (followed) {
              logger.info(
                { asked: askedOpen, ms: Date.now() - startedAt },
                "typed onboarding followed up a question their words had answered",
              );
            }
          })
          .catch((error: unknown) => {
            logger.warn({ err: error }, "typed onboarding follow-up failed");
          });
      }
      return outcome;

      /**
       * D81 #4: the topic's playback, when Q's reply moves on from a topic
       * whose answers wait for their yes, or replays it after their
       * correction (until they confirm; at most three replays, after which
       * the finish's read-back has it). Null: nothing to play back.
       */
      async function topicPlayback(at: {
        readonly text: string;
        readonly asking: string | null;
        readonly lastQ: string;
        readonly acceptedNow: ReadonlySet<string>;
      }): Promise<{ text: string; asking: string | null } | null> {
        const before = lastAsked.get(input.onboardingSessionId);
        const topic = topicOf(input.journeyType, before);
        if (topic === null) return null;
        const replay = isPlaybackLine(at.lastQ) && at.acceptedNow.size === 0;
        const moving = topicOf(input.journeyType, at.asking) !== topic;
        if (!replay && !moving) return null;
        // What this very line said is in the playback too.
        await (conversation.answered === undefined
          ? reading
          : conversation.answered(line, "LATEST"));
        const after = portOf(false);
        const [held, now] = await Promise.all([
          after.pendingRecommendations().catch(() => []),
          after.state(),
        ]);
        const items = held.filter(
          (item) =>
            heldFromTheirWords(item.rationale) &&
            topicOf(input.journeyType, item.stepKey) === topic,
        );
        // e2e run 10: the topic's full set, what is saved beside what
        // waits (the cheque's minimum and typical saved, its maximum
        // waiting, are one picture). D82: once per topic, never one value
        // alone.
        const saved = now.steps.filter(
          (step) =>
            step.status === "ANSWERED" &&
            step.value !== null &&
            step.value.trim().length > 0 &&
            step.value.trim().toLowerCase() !== "none" &&
            topicOf(input.journeyType, step.stepKey) === topic &&
            !items.some((item) => item.stepKey === step.stepKey),
        );
        const played =
          playedTopics.get(input.onboardingSessionId) ?? new Set<string>();
        bounded(playedTopics, input.onboardingSessionId, played);
        if (!replay && (items.length + saved.length < 2 || played.has(topic))) {
          return null;
        }
        if (
          items.some((item) => item.value.trim().length === 0) ||
          items.length === 0
        ) {
          return null;
        }
        played.add(topic);
        const counts =
          replays.get(input.onboardingSessionId) ?? new Map<string, number>();
        bounded(replays, input.onboardingSessionId, counts);
        const times = counts.get(topic) ?? 0;
        if (replay && times >= 3) return null;
        counts.set(topic, replay ? times + 1 : 0);
        const labelled = (stepKey: string) =>
          labelOf(stepKey) ?? plainStepLabel(stepKey);
        // Owner Q1: an explicit none saved at once is named with its topic.
        const nones = depth.nonesImmediate
          ? now.steps.filter(
              (step) =>
                step.status === "ANSWERED" &&
                step.value?.trim().toLowerCase() === "none" &&
                topicOf(input.journeyType, step.stepKey) === topic,
            )
          : [];
        // In the journey's order, so the set reads as one picture.
        const order = (stepKey: string) =>
          now.steps.findIndex((step) => step.stepKey === stepKey);
        const lines = [
          ...[
            ...items.map((item) => ({
              stepKey: item.stepKey,
              value: item.value,
            })),
            ...saved.map((step) => ({
              stepKey: step.stepKey,
              value: step.value ?? "",
            })),
          ]
            .sort((a, b) => order(a.stepKey) - order(b.stepKey))
            .map((one) => `${labelled(one.stepKey)}: ${one.value}`),
          ...nones.map((step) => `${labelled(step.stepKey)}: none`),
        ];
        const lead = replay ? "" : withoutLastQuestion(at.text);
        return {
          text: `${lead} ${playbackLine(lines, replay)}`.trim(),
          asking: items[0]?.stepKey ?? null,
        };
      }

      /** Owner Q3: their why, kept as the asked topic's private note. */
      async function keepWhy(words: string): Promise<void> {
        const waiting =
          whyWaiting.get(input.onboardingSessionId) ??
          new Map<string, string>();
        const asked = probing.get(input.onboardingSessionId);
        probing.delete(input.onboardingSessionId);
        if (asked !== undefined && words.trim().length > 0) {
          waiting.set(asked, words.trim().slice(0, 500));
        }
        if (waiting.size === 0) return;
        bounded(whyWaiting, input.onboardingSessionId, waiting);
        const notes = portOf(false);
        for (const [stepKey, why] of [...waiting]) {
          // Kept once the topic's answer is on the record (after their yes
          // to its playback); until then it waits here.
          if (await notes.annotate(stepKey, why)) waiting.delete(stepKey);
        }
      }

      /** Q's line kept with the step it asks, and the screen's outcome. */
      async function outcomeOf(said: {
        readonly text: string;
        readonly asking: string | null;
        readonly navigate: InterviewTurnOutcome["navigate"];
        readonly pausing: boolean;
        readonly path: string;
        readonly finishing: boolean;
        /** This line is the record's read-back, put to them for their yes. */
        readonly readBack: boolean;
      }): Promise<InterviewTurnOutcome> {
        // The read-back is "what Q just asked" only while it is Q's last
        // line; any other line of Q's asks something else.
        if (!said.readBack) readBackShown.delete(input.onboardingSessionId);
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
          .catch((error: unknown) => {
            logger.warn({ err: error }, "typed onboarding reply not kept");
          });
        const viewPort = portOf(false);
        await viewPort.state().catch((error: unknown) => {
          logger.warn({ err: error }, "typed onboarding state not read");
          return null;
        });
        const view =
          viewPort.view() ??
          (await getOnboardingSession(
            input.session,
            input.onboardingSessionId,
          ));
        const askingStep = askingFor(view, input.journeyType, said.asking);
        if (askingStep === null) {
          lastAsked.delete(input.onboardingSessionId);
        } else {
          lastAsked.delete(input.onboardingSessionId);
          lastAsked.set(input.onboardingSessionId, askingStep.stepKey);
          // Bounded: the oldest session's note goes first.
          if (lastAsked.size > 2_000) {
            const oldest = lastAsked.keys().next().value;
            if (oldest !== undefined) lastAsked.delete(oldest);
          }
        }
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
    /** The turn's own signal, and stopped when the turn ends without it. */
    signal: AbortSignal,
    /** Held from their words for the topic's playback (D81 #4). */
    playedBack: ReadonlySet<string> = new Set(),
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
        checklist: briefOf(state, { withIds: true, playedBack }).slice(
          0,
          12_000,
        ),
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
        signal,
      },
    );
    if (response.output.kind !== "STRUCTURED") return null;
    const parsed = OnboardingTypedReplyResultSchema.safeParse(
      (response.output as { readonly value: unknown }).value,
    );
    return parsed.success ? parsed.data : null;
  }
}

/**
 * The step Q's last line asked, when what is waiting on it is a suggestion
 * of Q's held for their yes (an open step with one pending): their reply
 * may approve it. Null otherwise.
 */

/** A needed step still open for an answer in conversation. */
function neededOpen(step: OnboardingState["steps"][number]): boolean {
  return (
    step.required &&
    step.status === "OPEN" &&
    step.savePending !== true &&
    step.kind !== "DOCUMENT" &&
    step.kind !== "YES_NO" &&
    step.kind !== "CHOICE_OF_RECORD" &&
    step.coverage !== "INAPPLICABLE"
  );
}

/** The text without its last question sentence (what it asked). */
export function withoutLastQuestion(text: string): string {
  const sentences = text.match(/[^.?!؟]+[.?!؟]*/gu) ?? [text];
  const last = sentences.findLastIndex((sentence) => /[?؟]/u.test(sentence));
  if (last < 0) return text.trim();
  return sentences
    .filter((_, index) => index !== last)
    .join("")
    .replace(/\s{2,}/gu, " ")
    .trim();
}

/** Code's read-back of held values for their yes (finishingLine). */
export function isReadBackLine(line: string): boolean {
  return (
    /\bFrom what you said:/u.test(line) &&
    /\bShall I keep (these|that)\?/u.test(line)
  );
}

export function heldAskedOf(
  state: OnboardingState,
  asked: string | undefined,
): string | null {
  if (asked === undefined) return null;
  const row = state.steps.find((step) => step.stepKey === asked);
  return row !== undefined &&
    row.status === "OPEN" &&
    row.pendingRecommendation !== undefined
    ? asked
    : null;
}

/** The reading of their words, less what code already accepted from it. */
export function withoutAccepted<
  T extends {
    readonly stated: ReadonlySet<string>;
    readonly handed: ReadonlySet<string>;
    readonly approved: ReadonlySet<string>;
  },
>(authority: T | null, accepted: ReadonlySet<string>): T | null {
  if (authority === null || accepted.size === 0) return authority;
  const less = (keys: ReadonlySet<string>) =>
    new Set([...keys].filter((key) => !accepted.has(key)));
  return {
    ...authority,
    stated: less(authority.stated),
    approved: less(authority.approved),
  };
}

/**
 * Whether the reading of their latest words beside the reply found they
 * state something to save, beyond agreeing to a review: an answer, a
 * choice handed to Q or a suggestion approved. No reading: assume so.
 */
export function statesMore(
  authority: {
    readonly stated: ReadonlySet<string>;
    readonly handed: ReadonlySet<string>;
    readonly approved: ReadonlySet<string>;
  } | null,
  journeyType: "founder" | "investor",
): boolean {
  if (authority === null) return true;
  if (authority.handed.size > 0 || authority.approved.size > 0) return true;
  const steps = definitionFor(journeyType).steps;
  return [...authority.stated].some(
    (stepKey) =>
      steps.find((step) => step.stepKey === stepKey)?.configuration.stepType !==
      "confirmation",
  );
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

/** A sentence of Q's saying what their profile, mandate or record holds. */
const RECORD_CLAIM =
  /\b(?:saved|recorded|on (?:your|the) record|noted|captured|logged|stored|(?:profile|mandate|record|setup)\s+(?:now\s+)?(?:reflects|shows|has|holds|includes|lists|contains|says))\b/iu;

/**
 * Q's sentences claiming the record holds a figure that is neither on the
 * record nor in their latest words are taken out (live 2026-10-31,
 * "Kivisild": after "Skip the rest." Q said "Your profile reflects … 40
 * lockers across 12 towns", which was never saved). What the record holds
 * is said from the record (the read-back); a figure of their latest words
 * is being saved by the reading of them, so an acknowledgement of it is
 * kept. A question is kept.
 */
export function withoutUnsavedRecordClaims(
  reply: string,
  state: Pick<OnboardingState, "steps">,
  latestWords: string,
): string {
  const record = state.steps
    .filter((step) => step.status === "ANSWERED" && step.savePending !== true)
    .map((step) => step.value ?? "")
    .join(" \n ");
  const backed = new Set([...figuresOf(record), ...figuresOf(latestWords)]);
  const sentences = reply.match(/[^.?!]+[.?!]*/gu) ?? [reply];
  const kept = sentences.filter((sentence) => {
    if (sentence.trim().endsWith("?")) return true;
    if (!RECORD_CLAIM.test(sentence)) return true;
    return [...figuresOf(sentence)].every((figure) => backed.has(figure));
  });
  if (kept.length === sentences.length) return reply;
  const rest = kept
    .join("")
    .replace(/\s{2,}/gu, " ")
    .trim();
  return rest.length === 0 ? "Understood." : rest;
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
  // Final check 2026-10-30: two answers on the record that disagree are
  // said in the read-back, both kept, until they settle it (the question
  // itself is raised once by the conversation, from the same checks).
  const toSettle = state.checks.map((check) => check.fact);
  return [
    saved.length === 0
      ? "Nothing is saved yet."
      : `Here's what I have saved so far:\n\n${saved.join("\n\n")}`,
    toSettle.length === 0
      ? ""
      : `To settle, both kept until you say which is right: ${toSettle.join(" ")}`,
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

/**
 * Q's suggestions still waiting on the person's yes, "Label: value" each,
 * for the read-back (live re-check 2026-10-31): never the ones the record
 * already holds as they are, and only steps with a plain label.
 */
export function waitingOnYes(
  state: OnboardingState,
  pending: readonly { readonly stepKey: string; readonly value: string }[],
  labelOf: (stepKey: string) => string | undefined,
): string[] {
  const plain = (value: string) =>
    value.trim().replace(/\s+/gu, " ").toLocaleLowerCase();
  const seen = new Set<string>();
  return pending.flatMap((item) => {
    const label = labelOf(item.stepKey);
    if (label === undefined || seen.has(item.stepKey)) return [];
    const row = state.steps.find((step) => step.stepKey === item.stepKey);
    if (
      row?.status === "ANSWERED" &&
      row.value !== null &&
      row.value !== undefined &&
      plain(row.value) === plain(item.value)
    ) {
      return [];
    }
    seen.add(item.stepKey);
    return [`${label}: ${item.value}`];
  });
}

/** What Q says when a question it just asked turns out to be answered. */
export const ALREADY_ANSWERED_LINE =
  "No need to answer that one: your last message already covered it.";

/**
 * Q's reply went out before the reading of their words landed (the reply
 * never waits for it: live final re-check 2026-10-31). When that reading
 * shows the step the reply asked was answered by those same words, and
 * the reply is still Q's last line, Q follows up at once: it says so and
 * asks what is actually next, kept in the thread with that step, so the
 * screen (which re-reads the session as the reading lands) and a reopened
 * setup show the follow-up, never the stale question. Code-written; no
 * model call. True when a follow-up was said.
 */
export async function followUpIfAnswered(input: {
  readonly asked: string;
  /** False once they said anything after the reply. */
  readonly stillLast: () => boolean;
  readonly state: () => Promise<OnboardingState>;
  readonly say: (said: {
    readonly text: string;
    readonly asking: string | null;
  }) => Promise<void>;
}): Promise<boolean> {
  if (!input.stillLast()) return false;
  const now = await input.state();
  const row = now.steps.find((step) => step.stepKey === input.asked);
  if (row === undefined) return false;
  if (row.status === "OPEN" && row.savePending !== true) return false;
  if (!input.stillLast()) return false;
  const next =
    now.next?.find(
      (item) =>
        item.stepKey !== input.asked &&
        now.steps.some(
          (step) =>
            step.stepKey === item.stepKey &&
            step.status === "OPEN" &&
            step.savePending !== true,
        ),
    )?.stepKey ?? null;
  const question =
    next === null
      ? ""
      : (SPOKEN_QUESTIONS[next] ??
        now.steps.find((step) => step.stepKey === next)?.question ??
        "");
  await input.say({
    text: `${ALREADY_ANSWERED_LINE}${question.length === 0 ? "" : ` ${question}`}`,
    asking: question.length === 0 ? null : next,
  });
  return true;
}

export { figuresOf, heldOfferedIn, isPlainYes, restatedHeld };
