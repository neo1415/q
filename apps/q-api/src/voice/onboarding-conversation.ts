import { randomUUID } from "node:crypto";

import {
  appendOnboardingInterviewTurns,
  getOnboardingSession,
  listOnboardingInterviewTurns,
  type ApiSession,
} from "@capital-q/api-client";
import type {
  OnboardingTranscriptReader,
  QDelegationReader,
} from "@capital-q/model-gateway/q";
import type { Logger } from "@capital-q/observability";
import type { OnboardingState, OnboardingStepState } from "@capital-q/q-tools";
import type { ActorContext } from "@capital-q/security";

import type { HeldWritesStore } from "./held-writes.js";
import type { InvestorResearch } from "./investor-research.js";
import { definitionFor, toResponseValue } from "./interview-steps.js";
import {
  createOnboardingPort,
  sameValue,
  type RecommendationStore,
} from "./onboarding-port.js";
import { SPOKEN_QUESTIONS } from "./step-copy.js";

/**
 * Voice onboarding as a conversation first (owner 2026-10-27).
 *
 * Q talks with the person on the live line from a checklist of what the
 * setup needs; nothing is decided per turn. What is said is kept in the
 * onboarding thread as it is said, and the whole thread is read by meaning
 * (ONBOARDING_TRANSCRIPT_READER) shortly after each thing they say, and
 * again when they stop or leave. What the reading finds is saved through
 * the same checked path a typed answer takes (their quote must be in their
 * own lines; a changed answer is a new version, the old one kept). Saving
 * runs on the server, so closing the tab loses nothing already heard.
 *
 * The person's own access token carries every read and write, so a spoken
 * answer has exactly the authority a typed one has.
 */
export type ConversationLine = {
  readonly voiceSessionId: string;
  readonly actor: ActorContext;
  readonly accessToken: string;
  readonly onboarding: {
    readonly sessionId: string;
    readonly journeyType: "investor" | "founder";
  };
};

export type HeardSegment = {
  readonly role: "USER" | "Q";
  readonly text: string;
};

export type OnboardingConversation = {
  /** Transcript segments as the line reports them, in order. */
  readonly heard: (
    line: ConversationLine,
    segments: readonly HeardSegment[],
  ) => void;
  /** The line ended: keep what is buffered and read the whole thread once more. */
  readonly ended: (line: ConversationLine) => Promise<void>;
  /** What the live voice is told about the setup: the checklist and record. */
  readonly brief: (line: ConversationLine) => Promise<string | null>;
  /** Q's first words on a new or resumed call, built by code (no model). */
  readonly opening: (input: {
    readonly actor: ActorContext;
    readonly accessToken: string;
    readonly onboarding: ConversationLine["onboarding"];
    readonly firstName: string | null;
    /** Their name and organisation as given at sign-up: research starts on them. */
    readonly displayName?: string | null | undefined;
    readonly organisationName?: string | null | undefined;
    /** The step the opening's question asks (the journey's own next step). */
    readonly askStepKey?: string | null | undefined;
  }) => Promise<string | null>;
  /**
   * The voice asked the backend (they want to know what is saved, to stop
   * for now, or to finish): everything heard is saved first, then the
   * record is read back from Capital Q's own data.
   */
  readonly settle: (
    line: ConversationLine,
    request: string,
  ) => Promise<{ readonly commentary: string; readonly leave?: true }>;
};

/** Quiet after something they said before it is read (coalesced). */
const READ_AFTER_MS = 2_500;
/** A settle waits this long for saving before it answers from the record. */
const SETTLE_WAIT_MS = 15_000;
const THREAD_LIMIT = 100;

type Buffer = { role: "PERSON" | "Q"; parts: string[] };

type Reading = {
  timer: ReturnType<typeof setTimeout> | null;
  running: Promise<void> | null;
  again: boolean;
  line: ConversationLine;
};

export function createOnboardingConversation(dependencies: {
  readonly apiBaseUrl: string;
  readonly reader: OnboardingTranscriptReader;
  readonly delegation?: QDelegationReader | undefined;
  readonly heldWrites?: HeldWritesStore | undefined;
  readonly recommendations?: RecommendationStore | undefined;
  /**
   * Research first (BIZ-009): public sources on their firm or company,
   * started at the opening and whenever its name or website is saved;
   * what it finds is offered for their yes, never saved as an answer.
   */
  readonly research?:
    | {
        readonly investor?: InvestorResearch | undefined;
        readonly founder?: InvestorResearch | undefined;
      }
    | undefined;
  readonly logger: Logger;
  readonly readAfterMs?: number | undefined;
  readonly fetch?: typeof fetch | undefined;
}): OnboardingConversation {
  const { logger } = dependencies;
  const readAfterMs = dependencies.readAfterMs ?? READ_AFTER_MS;
  const buffers = new Map<string, Buffer>();
  /** Thread writes per line, in order: an utterance never overtakes another. */
  const writes = new Map<string, Promise<void>>();
  const readings = new Map<string, Reading>();

  const sessionOf = (line: { readonly accessToken: string }): ApiSession => ({
    baseUrl: dependencies.apiBaseUrl,
    accessToken: line.accessToken,
    ...(dependencies.fetch === undefined ? {} : { fetch: dependencies.fetch }),
  });

  const portFor = (
    line: Pick<ConversationLine, "actor" | "accessToken" | "onboarding">,
    personTurns: readonly string[],
    stated: ReadonlySet<string> = new Set(),
    declined: ReadonlySet<string> = new Set(),
    finishing = false,
  ) =>
    createOnboardingPort({
      session: sessionOf(line),
      onboardingSessionId: line.onboarding.sessionId,
      journeyType: line.onboarding.journeyType,
      ownerUserId: line.actor.userId,
      personTurns,
      // The reading of the whole conversation is the authority for what
      // they stated: read by meaning, never by a phrase.
      authority: () =>
        Promise.resolve({
          stated,
          declined,
          handed: new Set<string>(),
          approved: new Set<string>(),
          finishing,
          lookup: null,
        }),
      recommendations: dependencies.recommendations,
      held: dependencies.heldWrites?.bind({
        userId: line.actor.userId,
        sessionId: line.onboarding.sessionId,
      }),
    });

  const researchFor = (journey: "investor" | "founder") =>
    journey === "investor"
      ? dependencies.research?.investor
      : dependencies.research?.founder;

  /** Start a read of their firm or company once its name is known. */
  const considerResearch = (
    line: Pick<ConversationLine, "actor" | "accessToken" | "onboarding">,
    identity: {
      readonly firmName: string;
      readonly websiteUrl: string | null;
      readonly personName: string | null;
    },
  ) => {
    if (identity.firmName.trim().length === 0) return;
    researchFor(line.onboarding.journeyType)?.consider({
      actor: line.actor,
      session: sessionOf(line),
      onboardingSessionId: line.onboarding.sessionId,
      identity: {
        firmName: identity.firmName.trim().slice(0, 160),
        websiteUrl: identity.websiteUrl,
        profileUrls: [],
        personName: identity.personName,
      },
    });
  };

  const keep = (line: ConversationLine, role: "PERSON" | "Q", text: string) => {
    const words = text.replace(/\s+/g, " ").trim();
    if (words.length === 0) return;
    const before = writes.get(line.voiceSessionId) ?? Promise.resolve();
    const next = before
      .then(() =>
        appendOnboardingInterviewTurns(
          sessionOf(line),
          line.onboarding.sessionId,
          {
            turnRef: randomUUID(),
            turns: [{ role, text: words.slice(0, 4_000), channel: "VOICE" }],
          },
        ),
      )
      .then(
        () => undefined,
        (error: unknown) => {
          logger.warn(
            { err: error, qVoiceSessionId: line.voiceSessionId },
            "onboarding conversation line could not be kept",
          );
        },
      );
    writes.set(line.voiceSessionId, next);
  };

  const finishUtterance = (line: ConversationLine) => {
    const buffer = buffers.get(line.voiceSessionId);
    if (buffer === undefined) return;
    buffers.delete(line.voiceSessionId);
    keep(line, buffer.role, buffer.parts.join(" "));
    if (buffer.role === "PERSON") schedule(line);
  };

  const readAndSave = async (line: ConversationLine): Promise<void> => {
    // Everything heard so far is in the thread before it is read.
    await (writes.get(line.voiceSessionId) ?? Promise.resolve());
    const session = sessionOf(line);
    const thread = await listOnboardingInterviewTurns(
      session,
      line.onboarding.sessionId,
      THREAD_LIMIT,
    );
    const turns = thread.items.map((turn) => ({
      role: turn.role,
      text: turn.text,
    }));
    const personTurns = turns
      .filter((turn) => turn.role === "PERSON")
      .map((turn) => turn.text)
      .reverse();
    if (personTurns.length === 0) return;
    const state = await portFor(line, personTurns).state();
    if (state.completed) return;
    const reading = await dependencies.reader.read({
      journey: line.onboarding.journeyType,
      steps: readableSteps(state),
      turns,
      attribution: {
        tenantId: line.actor.tenantId,
        userId: line.actor.userId,
        correlationId: randomUUID(),
      },
    });
    if (reading === null) return;
    // What is already on record, unchanged, is never written again: every
    // reading sees the whole conversation (live 2026-10-28: one answer
    // rewritten on each reading, a new version each time).
    const onRecord = await getOnboardingSession(
      session,
      line.onboarding.sessionId,
    ).then(
      (view) => view.responses,
      () => [],
    );
    const manifests = new Map(
      definitionFor(line.onboarding.journeyType).steps.map(
        (step) => [step.stepKey, step] as const,
      ),
    );
    const unchanged = (stepKey: string, raw: unknown): boolean => {
      const manifest = manifests.get(stepKey);
      const current = onRecord.find((r) => r.stepKey === stepKey);
      if (manifest === undefined || current === undefined) return false;
      const value =
        typeof raw === "string" || typeof raw === "boolean" || isWords(raw)
          ? toResponseValue(manifest, raw)
          : typeof raw === "number"
            ? toResponseValue(manifest, String(raw))
            : null;
      return value !== null && sameValue(current.value, value);
    };
    const answers = reading.answers.filter(
      (answer) =>
        isAnswerable(state, answer.stepKey) &&
        !unchanged(answer.stepKey, answer.value),
    );
    const declined = reading.declined.filter(
      (item) => stepOf(state, item.stepKey)?.status === "OPEN",
    );
    if (answers.length === 0 && declined.length === 0) return;
    const port = portFor(
      line,
      personTurns,
      new Set(answers.map((answer) => answer.stepKey)),
      new Set(declined.map((item) => item.stepKey)),
    );
    const recorded =
      answers.length === 0
        ? []
        : await port.record(
            answers.map((answer) => ({
              stepKey: answer.stepKey,
              value: answer.value,
              quote: answer.quote,
              basis: "STATED" as const,
              ownWords: answer.ownWords,
            })),
          );
    const setAside =
      declined.length === 0
        ? []
        : await port.setAside(
            declined
              .slice(0, 12)
              .map((item) => ({ stepKey: item.stepKey, quote: item.quote })),
          );
    logger.info(
      {
        qVoiceSessionId: line.voiceSessionId,
        onboardingSessionId: line.onboarding.sessionId,
        read: answers.length,
        saved: recorded
          .filter(
            (r) => r.outcome === "COMMITTED" && r.alreadyRecorded !== true,
          )
          .map((r) => r.stepKey),
        kept: recorded
          .filter((r) => r.outcome === "HELD_FOR_RETRY")
          .map((r) => r.stepKey),
        notSaved: recorded
          .filter(
            (r) => r.outcome !== "COMMITTED" && r.outcome !== "HELD_FOR_RETRY",
          )
          .map((r) => `${r.stepKey}:${r.outcome}`),
        setAside: setAside.map((r) => r.stepKey),
      },
      "onboarding conversation read and saved",
    );
    const after = await port.state();
    considerResearch(line, identityOf(after));
    await researchFor(line.onboarding.journeyType)
      ?.offerReady(line.onboarding.sessionId, port)
      .catch(() => 0);
  };

  const readingFor = (line: ConversationLine): Reading => {
    const key = line.onboarding.sessionId;
    const existing = readings.get(key);
    if (existing !== undefined) {
      existing.line = line;
      return existing;
    }
    const created: Reading = { timer: null, running: null, again: false, line };
    readings.set(key, created);
    return created;
  };

  const run = (reading: Reading): Promise<void> => {
    if (reading.running !== null) {
      reading.again = true;
      return reading.running;
    }
    reading.running = readAndSave(reading.line)
      .catch((error: unknown) => {
        logger.warn(
          {
            err: error,
            onboardingSessionId: reading.line.onboarding.sessionId,
          },
          "onboarding conversation could not be read and saved",
        );
      })
      .finally(() => {
        reading.running = null;
        if (reading.again) {
          reading.again = false;
          void run(reading);
        }
      });
    return reading.running;
  };

  const schedule = (line: ConversationLine) => {
    const reading = readingFor(line);
    if (reading.timer !== null) clearTimeout(reading.timer);
    reading.timer = setTimeout(() => {
      reading.timer = null;
      void run(reading);
    }, readAfterMs);
    reading.timer.unref?.();
  };

  /** Save everything heard now and wait for it (bounded). */
  const flush = async (line: ConversationLine): Promise<void> => {
    finishUtterance(line);
    const reading = readingFor(line);
    if (reading.timer !== null) {
      clearTimeout(reading.timer);
      reading.timer = null;
    }
    const done = (async () => {
      // A reading already under way may predate the last words: read again.
      if (reading.running !== null) await reading.running;
      await run(reading);
      while (reading.running !== null) await reading.running;
    })();
    await Promise.race([
      done,
      new Promise<void>((resolve) => {
        setTimeout(resolve, SETTLE_WAIT_MS).unref?.();
      }),
    ]);
  };

  return {
    heard: (line, segments) => {
      for (const segment of segments) {
        const role = segment.role === "USER" ? "PERSON" : "Q";
        const text = segment.text.trim();
        if (text.length === 0) continue;
        const buffer = buffers.get(line.voiceSessionId);
        if (buffer !== undefined && buffer.role === role) {
          buffer.parts.push(text);
          continue;
        }
        finishUtterance(line);
        buffers.set(line.voiceSessionId, { role, parts: [text] });
      }
    },

    ended: async (line) => {
      await flush(line);
      writes.delete(line.voiceSessionId);
      // The person's access token is held no longer than their line: once
      // the last reading is done, nothing of this session is kept here
      // (a new line, or more words since, keeps it).
      const reading = readings.get(line.onboarding.sessionId);
      if (
        reading !== undefined &&
        reading.line.voiceSessionId === line.voiceSessionId &&
        reading.timer === null &&
        reading.running === null &&
        !buffers.has(line.voiceSessionId)
      ) {
        readings.delete(line.onboarding.sessionId);
      }
    },

    brief: async (line) => {
      try {
        const state = await portFor(line, []).state();
        return briefOf(state);
      } catch (error: unknown) {
        logger.warn(
          { err: error },
          "onboarding conversation brief unavailable",
        );
        return null;
      }
    },

    opening: async (input) => {
      try {
        const session = sessionOf(input);
        const [state, thread] = await Promise.all([
          portFor(input, []).state(),
          listOnboardingInterviewTurns(session, input.onboarding.sessionId, 4),
        ]);
        const fromRecord = identityOf(state);
        considerResearch(input, {
          firmName:
            fromRecord.firmName.length > 0
              ? fromRecord.firmName
              : (input.organisationName ?? ""),
          websiteUrl: fromRecord.websiteUrl,
          personName: input.displayName ?? null,
        });
        return openingOf({
          state,
          firstName: input.firstName,
          resumed: thread.items.some((turn) => turn.role === "PERSON"),
          askStepKey: input.askStepKey ?? null,
        });
      } catch (error: unknown) {
        logger.warn(
          { err: error },
          "onboarding conversation opening unavailable",
        );
        return null;
      }
    },

    settle: async (line, request) => {
      await flush(line);
      const session = sessionOf(line);
      const thread = await listOnboardingInterviewTurns(
        session,
        line.onboarding.sessionId,
        THREAD_LIMIT,
      ).catch(() => ({ items: [] }));
      // The words the voice passed on are their latest, even when their
      // transcript has not reached the thread yet.
      const personTurns = [
        ...(request.trim().length === 0 ? [] : [request.trim()]),
        ...thread.items
          .filter((turn) => turn.role === "PERSON")
          .map((turn) => turn.text)
          .reverse(),
      ];
      const lastQ =
        [...thread.items].reverse().find((turn) => turn.role === "Q")?.text ??
        "";
      const port = portFor(line, personTurns);
      const state = await port.state();
      const authority =
        dependencies.delegation === undefined || request.trim().length === 0
          ? null
          : await dependencies.delegation.read({
              utterance: request,
              lastQ,
              steps: state.steps.map((step) => ({
                stepKey: step.stepKey,
                question: step.question,
                about: step.question,
                required: step.required,
              })),
              pending: [],
              attribution: {
                tenantId: line.actor.tenantId,
                userId: line.actor.userId,
                correlationId: randomUUID(),
              },
            });
      if (authority?.pausing === true) {
        return {
          commentary: pausingNote(state, line.onboarding.journeyType),
          leave: true,
        };
      }
      // Finish decides, not a precheck: it confirms the journey's own review
      // steps on their word, which no spoken answer fills, and says exactly
      // what is still missing when it cannot complete.
      if (authority?.finishing === true) {
        // Finishing on their word, as the reading of it found.
        const finished = await portFor(
          line,
          personTurns,
          new Set(),
          new Set(),
          true,
        ).finish();
        if (finished.completed) {
          return { commentary: completedNote(line.onboarding.journeyType) };
        }
        return { commentary: readBack(await port.state()) };
      }
      return { commentary: readBack(state) };
    },
  };
}

function isWords(value: unknown): value is readonly string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string")
  );
}

/* ------------------------------------------------------------------ */
/* What the steps mean, in words a person uses (pure; tested).         */
/* ------------------------------------------------------------------ */

function stepOf(
  state: OnboardingState,
  stepKey: string,
): OnboardingStepState | undefined {
  return state.steps.find((step) => step.stepKey === stepKey);
}

/** A step a spoken answer can fill: not a document, not a review. */
function isConversational(step: OnboardingStepState): boolean {
  return (
    step.kind !== "DOCUMENT" &&
    step.kind !== "YES_NO" &&
    step.kind !== "CHOICE_OF_RECORD" &&
    step.coverage !== "INAPPLICABLE"
  );
}

function isAnswerable(state: OnboardingState, stepKey: string): boolean {
  const step = stepOf(state, stepKey);
  return step !== undefined && isConversational(step);
}

/** "How firm is that?" means nothing on its own: it is about the step before. */
export function topicsOf(
  steps: readonly OnboardingStepState[],
): ReadonlyMap<string, string> {
  const topics = new Map<string, string>();
  let previous: string | null = null;
  for (const step of steps) {
    const asked = (SPOKEN_QUESTIONS[step.stepKey] ?? step.question).trim();
    // The journey's own strength steps qualify the step before them.
    const followsOn = step.stepKey.endsWith("_strength");
    topics.set(
      step.stepKey,
      followsOn && previous !== null
        ? `How firm is that preference (about: ${previous})?`
        : asked,
    );
    if (!followsOn) previous = asked;
  }
  return topics;
}

function optionLabels(step: OnboardingStepState): string {
  return (step.options ?? []).map((option) => option.label).join(", ");
}

function readableSteps(state: OnboardingState) {
  const topics = topicsOf(state.steps);
  return state.steps.filter(isConversational).map((step) => ({
    stepKey: step.stepKey,
    question: topics.get(step.stepKey) ?? step.question,
    kind: step.kind,
    required: step.required,
    options: (step.options ?? [])
      .map((option) => `${option.key}: ${option.label}`)
      .join("; "),
    onRecord:
      step.status === "ANSWERED"
        ? (step.value ?? "answered")
        : step.status === "SET_ASIDE"
          ? "they chose to skip it"
          : "nothing",
  }));
}

/** The checklist the live voice holds for the whole call. */
export function briefOf(state: OnboardingState): string {
  const topics = topicsOf(state.steps);
  const lines = state.steps.filter(isConversational).map((step) => {
    const topic = topics.get(step.stepKey) ?? step.question;
    const options = optionLabels(step);
    const status =
      step.status === "ANSWERED"
        ? `already saved: ${step.value ?? "answered"}`
        : step.status === "SET_ASIDE"
          ? "they chose to skip this"
          : (step.pendingRecommendation ?? step.offered) !== undefined
            ? `not confirmed yet; Q found: ${step.pendingRecommendation ?? step.offered ?? ""}`
            : "not covered yet";
    return `- ${step.required ? "Needed" : "Optional"}: ${topic}${
      options.length === 0 ? "" : ` (choices: ${options})`
    } [${status}]`;
  });
  const documents = state.steps.some((step) => step.kind === "DOCUMENT");
  const minutes = state.minutesLeft ?? null;
  return [
    `What this setup needs (${state.journey}), in the setup's order. These are topics, not a script: ask in your own plain words, one thing at a time, and group things that belong together.`,
    ...lines,
    ...(documents
      ? [
          "They can upload what they already have (a deck, a one-pager, a financial model) on screen while you talk; Capital Q reads it and you will be told what it found.",
        ]
      : []),
    ...(minutes === null
      ? []
      : [`Roughly ${String(minutes)} minutes of essentials are left.`]),
  ].join("\n");
}

/**
 * Q's first words, built by code (no model, no wait): who Q is, what this
 * is and why, how long, that they can stop or type instead, then the first
 * question in plain words. Spoken as written on lines that say text
 * verbatim, and in Q's own words on the live line.
 */
export function openingOf(input: {
  readonly state: OnboardingState;
  readonly firstName: string | null;
  readonly resumed: boolean;
  /** The journey's own next step, when the caller knows it. */
  readonly askStepKey?: string | null | undefined;
}): string {
  const { state } = input;
  const investor = state.journey === "investor";
  const topics = topicsOf(state.steps);
  const asked =
    input.askStepKey === null || input.askStepKey === undefined
      ? undefined
      : state.steps.find(
          (step) => step.stepKey === input.askStepKey && step.status === "OPEN",
        );
  const next =
    asked ??
    state.steps.find(
      (step) =>
        isConversational(step) && step.status === "OPEN" && step.required,
    ) ??
    state.steps.find(
      (step) => isConversational(step) && step.status === "OPEN",
    );
  const question =
    next === undefined ? null : (topics.get(next.stepKey) ?? next.question);
  const name = input.firstName === null ? "" : `, ${input.firstName}`;
  if (input.resumed) {
    const saved = state.steps.filter(
      (step) => isConversational(step) && step.status === "ANSWERED",
    ).length;
    return [
      `Welcome back${name}.`,
      saved === 0
        ? "Let's pick up where we left off."
        : `I've kept everything from last time, so let's pick up where we left off.`,
      question ?? "Is there anything you'd like to add or change?",
    ].join(" ");
  }
  const minutes = Math.max(3, state.minutesLeft ?? 5);
  return [
    `Hi${input.firstName === null ? "" : ` ${input.firstName}`}, I'm Q, your analyst here at Capital Q.`,
    investor
      ? `I'll set up your investment mandate with you in a quick chat, about ${String(minutes)} minutes, so I can show you companies that really fit how you invest.`
      : `I'll set up your company profile with you in a quick chat, about ${String(minutes)} minutes, so I can match you with the investors who fit your raise.`,
    "You can stop any time and pick up later, anything you're not sure of can wait, and if you'd rather click and type, the form's right there.",
    investor
      ? "If you have anything useful to share, like a fund overview, upload it while we talk."
      : "If you have a pitch deck or anything else, upload it while we talk and I'll read it.",
    question === null
      ? "Where would you like to start?"
      : `To start: ${question}`,
  ].join(" ");
}

/** Their firm or company as the record holds it, for research. */
function identityOf(state: OnboardingState): {
  readonly firmName: string;
  readonly websiteUrl: string | null;
  readonly personName: string | null;
} {
  const investor = state.journey === "investor";
  const saved = (stepKey: string): string => {
    const step = stepOf(state, stepKey);
    return step?.status === "ANSWERED" ? (step.value ?? "").trim() : "";
  };
  const website = saved(investor ? "I0.website" : "F1.website");
  return {
    firmName: saved(investor ? "I0.organisation_name" : "F1.company_name"),
    websiteUrl: website.length === 0 ? null : website,
    personName: null,
  };
}

/** The journey's own short label for a step ("Typical cheque"), for a read-back. */
function labelOf(state: OnboardingState, step: OnboardingStepState): string {
  const manifest = definitionFor(state.journey).steps.find(
    (candidate) => candidate.stepKey === step.stepKey,
  );
  return (manifest?.configuration.prompt ?? step.question).replace(
    /[?.]$/u,
    "",
  );
}

function savedLines(state: OnboardingState): string[] {
  return state.steps
    .filter((step) => isConversational(step) && step.status === "ANSWERED")
    .map((step) => `${labelOf(state, step)}: ${step.value ?? "answered"}`);
}

export function readBack(state: OnboardingState): string {
  const topics = topicsOf(state.steps);
  const saved = savedLines(state);
  const needed = state.steps
    .filter(
      (step) =>
        isConversational(step) && step.required && step.status === "OPEN",
    )
    .map((step) => topics.get(step.stepKey) ?? step.question);
  const optional = state.steps
    .filter(
      (step) =>
        isConversational(step) &&
        !step.required &&
        step.status === "OPEN" &&
        step.coveredBy === undefined,
    )
    .map((step) => topics.get(step.stepKey) ?? step.question)
    .slice(0, 6);
  const found = state.steps
    .filter((step) => isConversational(step) && step.status === "OPEN")
    .flatMap((step) => {
      const offer = step.pendingRecommendation ?? step.offered;
      return offer === undefined
        ? []
        : [`${topics.get(step.stepKey) ?? step.question} ${offer}`];
    })
    .slice(0, 6);
  return [
    "From Capital Q's own records (this is what is actually saved; use only this):",
    saved.length === 0
      ? "Nothing is saved yet."
      : `Saved: ${saved.join("; ")}.`,
    needed.length === 0
      ? "Everything needed is in."
      : `Still needed: ${needed.join("; ")}.`,
    optional.length === 0
      ? ""
      : `Optional, not covered yet: ${optional.join("; ")}.`,
    found.length === 0
      ? ""
      : `Found in their documents or public sources, not confirmed yet (put these to them in one go and ask if they're right): ${found.join("; ")}.`,
    needed.length === 0
      ? "Read back the essentials in a few plain sentences (never the list word for word), ask if anything is wrong or missing, and whether they'd like to finish. If they want to finish, pass their words on."
      : "Carry on naturally with what is still needed; mention optional ones lightly, as fine to skip or come back to.",
  ]
    .filter((line) => line.length > 0)
    .join("\n");
}

function pausingNote(
  state: OnboardingState,
  journey: "investor" | "founder",
): string {
  const saved = savedLines(state).length;
  const into =
    journey === "investor"
      ? "you're taking them into Capital Q now, to Discover, where they can already look at companies"
      : "you're taking them into Capital Q now, to their home page";
  return `They want to stop for now. ${String(saved)} things they told you are saved, and everything else they said is kept. In one or two warm sentences: say it's all kept, that they can pick up any time and you'll carry on where you left off, and that ${into}. Then stop talking: the call ends after your goodbye.`;
}

function completedNote(journey: "investor" | "founder"): string {
  // Nothing here claims what their screen shows: only what is saved.
  return journey === "investor"
    ? "Their mandate is saved and live: Capital Q now matches companies to it. Tell them warmly, in one or two sentences, that it's done and that Discover will show them companies matched to it."
    : "Their company profile is saved. Tell them warmly, in one or two sentences, that it's done and that investors who fit will now be matched to it.";
}
