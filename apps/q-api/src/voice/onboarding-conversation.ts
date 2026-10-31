import { randomUUID } from "node:crypto";

import {
  appendOnboardingInterviewTurns,
  getOnboardingSession,
  listOnboardingInterviewTurns,
  listOnboardingInterviewTurnSteps,
  type ApiSession,
} from "@capital-q/api-client";
import type {
  OnboardingTranscriptReader,
  QDelegationReader,
  TaxonomyChooser,
} from "@capital-q/model-gateway/q";
import type { Logger } from "@capital-q/observability";
import type { OnboardingState, OnboardingStepState } from "@capital-q/q-tools";
import type { ActorContext } from "@capital-q/security";

import type { HeldWritesStore } from "./held-writes.js";
import type { InvestorResearch } from "./investor-research.js";
import { definitionFor, toResponseValue } from "./interview-steps.js";
import {
  coverageProfileFor,
  createOnboardingPort,
  isLongAnswerStep,
  sameValue,
  type RecommendationStore,
} from "./onboarding-port.js";
import { plainStepLabel, SPOKEN_QUESTIONS } from "./step-copy.js";

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
  /**
   * Typed onboarding (production re-test 2026-10-28): one whole typed line,
   * kept in the thread now (channel TEXT), then read by meaning in the
   * background exactly as a spoken one is.
   */
  readonly said?: (
    line: ConversationLine,
    role: "PERSON" | "Q",
    text: string,
    /**
     * Q's line: the step it asked, kept with it (live e11: a typed reply
     * asked whether the founders are full-time, was kept with no step,
     * and the reopening asked the team size instead).
     */
    stepKey?: string | null,
  ) => Promise<void>;
  /**
   * Everything said is read and saved now, waited for (bounded). False
   * when the wait ran out with a reading still under way.
   */
  readonly flush?: (line: ConversationLine) => Promise<boolean | void>;
  /**
   * What their words gave is on the record (answers, held summaries, a
   * needed step not known), waited for (bounded); what they declined is
   * set aside after, in the background (live check 2026-10-31: "skip the
   * rest" waited 22.9 s, most of it setting aside twelve optional steps
   * one by one before the read-back). `through` EARLIER: only words said
   * before their latest line (its own reading goes on in the background).
   * False when the wait ran out.
   */
  readonly answered?: (
    line: ConversationLine,
    through: "LATEST" | "EARLIER",
  ) => Promise<boolean>;
};

/** Quiet after something they said before it is read (coalesced). */
const READ_AFTER_MS = 2_500;
/** A settle waits this long for saving before it answers from the record. */
const SETTLE_WAIT_MS = 15_000;
const THREAD_LIMIT = 100;
/**
 * Readings again of the same words once an answer opened steps the reading
 * could not see (live final re-check 2026-10-31: "raising 1.5 million
 * euros" saved only "raising"; the amount and currency steps open only
 * once it is, and Q then asked the currency).
 */
const OPENED_REREADS_MAX = 2;

type Buffer = { role: "PERSON" | "Q"; parts: string[] };

type Reading = {
  timer: ReturnType<typeof setTimeout> | null;
  running: Promise<void> | null;
  again: boolean;
  line: ConversationLine;
  /** Things they said, counted; a new line starts at 1 (unread backlog). */
  heard: number;
  /** The count the last finished reading started from: read up to there. */
  readThrough: number;
  /** The count whose words' answers are on the record (before set-asides). */
  answeredThrough: number;
  /** Waiting for answeredThrough to move. */
  waiters: Set<() => void>;
};

export function createOnboardingConversation(dependencies: {
  readonly apiBaseUrl: string;
  readonly reader: OnboardingTranscriptReader;
  readonly delegation?: QDelegationReader | undefined;
  /** An ambiguous category word, chosen among the lookup's candidates by meaning. */
  readonly categories?: TaxonomyChooser | undefined;
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
    addsTo: ReadonlySet<string> = new Set(),
    place?: ReturnType<typeof placeOfQuote>,
    affirmed: ReadonlySet<string> = new Set(),
  ) =>
    createOnboardingPort({
      addsTo,
      affirmed,
      logger,
      // Owner 2026-10-17, re-agreed 2026-10-30: a narrative answer is
      // saved as Q's summary they agreed to in the conversation, never
      // as their raw words; a summary not yet agreed is held for it.
      narrativeFromReadBackOnly: true,
      ...(place === undefined
        ? {}
        : { qLineBefore: place.qLineBefore, saidAt: place.saidAt }),
      chooseCategories:
        dependencies.categories === undefined
          ? undefined
          : (choice) =>
              (dependencies.categories ?? (() => Promise.resolve(null)))({
                who: {
                  tenantId: line.actor.tenantId,
                  userId: line.actor.userId,
                },
                ...choice,
              }),
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

  const keep = (
    line: ConversationLine,
    role: "PERSON" | "Q",
    text: string,
    channel: "VOICE" | "TEXT" = "VOICE",
    stepKey: string | null = null,
  ) => {
    const words = text.replace(/\s+/g, " ").trim();
    if (words.length === 0) return;
    const before = writes.get(line.voiceSessionId) ?? Promise.resolve();
    // One ref for the line: made again once after a failure, it is the
    // same line (unique per session, ref and role), never a second one.
    // Their words are what the reading saves from; a line lost here is an
    // answer lost (live recheck 2026-10-30).
    const turnRef = randomUUID();
    const append = () =>
      appendOnboardingInterviewTurns(
        sessionOf(line),
        line.onboarding.sessionId,
        {
          turnRef,
          turns: [
            {
              role,
              text: words.slice(0, 4_000),
              channel,
              ...(role === "Q" && stepKey !== null ? { stepKey } : {}),
            },
          ],
        },
      );
    const next = before
      .then(() =>
        append().catch((error: unknown) => {
          logger.info(
            { err: error, qVoiceSessionId: line.voiceSessionId },
            "onboarding conversation line made again",
          );
          return append();
        }),
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

  const readAndSave = async (
    line: ConversationLine,
    rereads = 0,
    /** Called once what this reading gives is recorded, before set-asides. */
    answeredNow: () => void = () => undefined,
  ): Promise<void> => {
    // Everything heard so far is in the thread before it is read.
    await (writes.get(line.voiceSessionId) ?? Promise.resolve());
    const session = sessionOf(line);
    // With the step each of Q's lines asked: what their words answered.
    // The plain thread when that form cannot be read (no step is known
    // then, and only the reading's own attribution counts).
    const thread: {
      readonly items: readonly {
        readonly role: "PERSON" | "Q";
        readonly text: string;
        readonly createdAt: string;
        readonly stepKey?: string | undefined;
      }[];
    } = await listOnboardingInterviewTurnSteps(
      session,
      line.onboarding.sessionId,
      THREAD_LIMIT,
    ).catch((error: unknown) => {
      logger.info(
        { err: error, onboardingSessionId: line.onboarding.sessionId },
        "onboarding thread read without its steps",
      );
      return listOnboardingInterviewTurns(
        session,
        line.onboarding.sessionId,
        THREAD_LIMIT,
      );
    });
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
    const optionIds = optionIdsOf(state);
    const read = await dependencies.reader.read({
      journey: line.onboarding.journeyType,
      steps: readableSteps(state, optionIds),
      turns,
      attribution: {
        tenantId: line.actor.tenantId,
        userId: line.actor.userId,
        correlationId: randomUUID(),
      },
    });
    if (read === null) return;
    // The reader named options by their ids; back to the journey's keys.
    const reading = {
      ...read,
      answers: read.answers.map((answer) => ({
        ...answer,
        value: keysFromIds(answer.value, optionIds.get(answer.stepKey)),
      })),
    };
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
    // A settled answer changes only on something they said after it was
    // saved (live 2026-10-29: "mostly follow" saved as follow, then the
    // finishing reading re-read the same words and wrote "follow, lead").
    // The reader is a model; re-reading old words is not new information.
    const personSaid = thread.items.flatMap((turn, index) => {
      if (turn.role !== "PERSON") return [];
      const askedAt = thread.items
        .slice(0, index)
        .findLastIndex((before) => before.role === "Q");
      return [
        {
          index,
          at: Date.parse(turn.createdAt),
          text: turn.text,
          // The step Q's line just before asked, when it named one.
          asked: askedAt < 0 ? undefined : thread.items[askedAt]?.stepKey,
          askedAt,
        },
      ];
    });
    // Live 2026-10-30 (Hydrolume): they skipped "team strengths"; a later
    // reading of the whole conversation took their "Yes, that looks right"
    // (to a different question) as agreeing to the examples Q's question
    // had listed, and wrote them over the skip. A skip is their answer.
    // A step they set aside changes only on their own words said after
    // the skip: to a line of Q's, after the skip, that asked it again, or
    // about it unprompted (not in answer to another question). The skip
    // is their line kept with the step (the Skip button keeps it so);
    // without one, only those two kinds of words count, from anywhere.
    const reopensSkip = (answer: {
      readonly stepKey: string;
      readonly quote: string;
      readonly aboutStep?: boolean | undefined;
    }): boolean => {
      const skippedAt = thread.items.findLastIndex(
        (item) => item.role === "PERSON" && item.stepKey === answer.stepKey,
      );
      return personSaid.some(
        (turn) =>
          turn.index > skippedAt &&
          quotedFrom(answer.quote, [turn.text]) &&
          ((turn.asked === answer.stepKey && turn.askedAt > skippedAt) ||
            (turn.asked === undefined && answer.aboutStep === true)),
      );
    };
    // Live recheck 2026-10-30: the founder kept their deck's description,
    // Q asked how they would describe their industry, and that answer
    // replaced the description. What is on record changes only on words
    // said since it was saved that are about that step: said to Q's
    // question for it (the step Q's line asked), or read as about it by
    // meaning (the reader's `aboutStep`: named, or a correction of it).
    // Never on words said to another question.
    const changesRecord = (answer: {
      readonly stepKey: string;
      readonly quote: string;
      readonly aboutStep?: boolean | undefined;
    }): "NEW" | "CHANGE" | "OLD_WORDS" | "OTHER_QUESTION" | "SKIPPED" => {
      const current = onRecord.find((r) => r.stepKey === answer.stepKey);
      if (current === undefined) {
        if (stepOf(state, answer.stepKey)?.status !== "SET_ASIDE") {
          return "NEW";
        }
        return reopensSkip(answer) ? "CHANGE" : "SKIPPED";
      }
      const savedAt = Date.parse(current.createdAt);
      const since = personSaid.filter(
        (turn) => turn.at >= savedAt && quotedFrom(answer.quote, [turn.text]),
      );
      if (since.length === 0) return "OLD_WORDS";
      if (answer.aboutStep === true) return "CHANGE";
      return since.some((turn) => turn.asked === answer.stepKey)
        ? "CHANGE"
        : "OTHER_QUESTION";
    };
    // Live re-check 2026-10-31: "I don't know honestly, the partners
    // haven't decided" left an inferred value on record, then was saved as
    // the step's text. Not knowing is never a value: an optional step is
    // set aside, a needed one recorded as not known (the port), whatever
    // the same reading also gave for it.
    // Live final re-check 2026-10-31: Q asked about pilots and the
    // currency together; they gave the currency, and pilots was set aside
    // as if they had skipped it. A decline or "do not know" is acted on
    // only when the reading found their own words say so.
    const saidSo = (item: { readonly saidSo?: boolean | undefined }) =>
      item.saidSo !== false;
    const notSaid = [...reading.declined, ...(reading.notKnown ?? [])].filter(
      (item) => !saidSo(item),
    );
    const notKnownNow = (reading.notKnown ?? [])
      .filter(saidSo)
      .filter((item) => {
        const status = stepOf(state, item.stepKey)?.status;
        if (status === "OPEN") return true;
        if (status !== "ANSWERED") return false;
        return changesRecord({ ...item, aboutStep: false }) === "CHANGE";
      });
    const notKnownSteps = new Set(notKnownNow.map((item) => item.stepKey));
    /** What the reading gave that is not saved, by reason: step keys only. */
    const dropped: string[] = notSaid.map(
      (item) => `${item.stepKey}:not_said_so`,
    );
    const answers = reading.answers
      .flatMap((read) => {
        const answer = withoutAgreeingWords(read, (stepKey, value) =>
          (stepOf(state, stepKey)?.options ?? []).some(
            (option) => option.key === value,
          ),
        );
        if (answer === null) {
          dropped.push(`${read.stepKey}:agreement_as_words`);
          return [];
        }
        return [answer];
      })
      .filter((answer) => {
        if (notKnownSteps.has(answer.stepKey)) {
          dropped.push(`${answer.stepKey}:not_known`);
          return false;
        }
        const why = !isAnswerable(state, answer.stepKey)
          ? "not_answerable"
          : unchanged(answer.stepKey, answer.value)
            ? null
            : changesRecord(answer);
        if (why === "NEW" || why === "CHANGE") return true;
        if (why !== null) dropped.push(`${answer.stepKey}:${why}`);
        return false;
      });
    // Live recheck 2026-10-30: a reading that saved nothing left no trace
    // of what it read. Step keys and reasons only, never their words.
    if (dropped.length > 0 || reading.answers.length === 0) {
      logger.info(
        {
          qVoiceSessionId: line.voiceSessionId,
          onboardingSessionId: line.onboarding.sessionId,
          readAnswers: reading.answers.length,
          dropped: dropped.slice(0, 20),
        },
        "onboarding conversation reading kept back",
      );
    }
    // Live acceptance 2026-10-30: "I don't know" to a step already on
    // record left what was there. Not knowing is an answer: a decline of
    // an answered step takes it back when said, since it was saved, to
    // Q's question for it (the port withdraws it; a required step is
    // refused there and stays).
    const declined = [
      ...reading.declined
        .filter(saidSo)
        .filter((item) => !notKnownSteps.has(item.stepKey)),
      ...notKnownNow.filter(
        (item) => stepOf(state, item.stepKey)?.required !== true,
      ),
    ].filter((item) => {
      const status = stepOf(state, item.stepKey)?.status;
      if (status === "OPEN") return true;
      if (status !== "ANSWERED") return false;
      return changesRecord({ ...item, aboutStep: false }) === "CHANGE";
    });
    const notKnownNeeded = notKnownNow.filter(
      (item) => stepOf(state, item.stepKey)?.required === true,
    );
    // Live re-check 2026-10-31: a value the reading says Q worked out from
    // other words (source INFERRED) is held for their yes, never saved as
    // theirs; only what they stated goes the checked way to the record.
    // Live final re-check 2026-10-31: "we write cheques of EUR 750k to 3
    // million" was saved as "actively investing", labelled STATED by the
    // reading, never asked. A step whose value is a judgement about their
    // current state (the journey marks it askOnly) is theirs only from
    // words said to Q's own question about it (Q's line just before asked
    // it); from anything else it is held for their yes, whatever the
    // reading calls its source. Code decides; the label is not the guard.
    const askOnly = coverageProfileFor(line.onboarding.journeyType).fields;
    const fromQuestion = (answer: {
      readonly stepKey: string;
      readonly quote: string;
    }): boolean =>
      askOnly[answer.stepKey]?.askOnly !== true ||
      personSaid.some(
        (turn) =>
          turn.asked === answer.stepKey &&
          quotedFrom(answer.quote, [turn.text]),
      );
    const unasked = answers.filter(
      (answer) => answer.source !== "INFERRED" && !fromQuestion(answer),
    );
    if (unasked.length > 0) {
      logger.info(
        {
          qVoiceSessionId: line.voiceSessionId,
          onboardingSessionId: line.onboarding.sessionId,
          heldUnasked: unasked.map((answer) => answer.stepKey),
        },
        "onboarding conversation reading held an unasked judgement",
      );
    }
    const stated = answers.filter(
      (answer) => answer.source !== "INFERRED" && fromQuestion(answer),
    );
    const inferred = answers.filter(
      (answer) => answer.source === "INFERRED" || !fromQuestion(answer),
    );
    if (
      answers.length === 0 &&
      declined.length === 0 &&
      notKnownNeeded.length === 0
    ) {
      return;
    }
    // A list they add to keeps what is on record, unless the reading found
    // they meant this as the whole list (owner 2026-10-28).
    const addsTo = new Set(
      stated
        .filter(
          (answer) =>
            answer.replaces !== true && isList(stepOf(state, answer.stepKey)),
        )
        .map((answer) => answer.stepKey),
    );
    const port = portFor(
      line,
      personTurns,
      new Set(stated.map((answer) => answer.stepKey)),
      new Set([
        ...declined.map((item) => item.stepKey),
        ...notKnownNeeded.map((item) => item.stepKey),
      ]),
      false,
      addsTo,
      placeOfQuote(thread.items),
      new Set(
        answers
          .filter((answer) => answer.affirms === true)
          .map((answer) => answer.stepKey),
      ),
    );
    const recorded =
      stated.length === 0
        ? []
        : await port.record(
            stated.map((answer) => ({
              stepKey: answer.stepKey,
              value: answer.value,
              quote: answer.quote,
              basis: "STATED" as const,
              ownWords: answer.ownWords,
            })),
          );
    const held =
      inferred.length === 0
        ? []
        : await port.holdInferred(
            inferred.map((answer) => ({
              stepKey: answer.stepKey,
              value: answer.value,
              quote: answer.quote,
              ownWords: answer.ownWords,
            })),
          );
    const notKnownSaved =
      notKnownNeeded.length === 0
        ? []
        : await port.recordNotKnown(
            notKnownNeeded
              .slice(0, 12)
              .map((item) => ({ stepKey: item.stepKey, quote: item.quote })),
          );
    // What was just saved opened steps this reading could not see (a raise
    // opens its amount and currency): the same words are read once more
    // against them, so what they said is saved now, never asked again.
    const answeredState = await port.state();
    const opened = answeredState.steps.some(
      (step) =>
        isConversational(step) &&
        step.status === "OPEN" &&
        !state.steps.some((before) => before.stepKey === step.stepKey),
    );
    const savedNow = recorded.some(
      (r) => r.outcome === "COMMITTED" && r.alreadyRecorded !== true,
    );
    const rereading = opened && savedNow && rereads < OPENED_REREADS_MAX;
    // Their answers are in (a reading again carries this on).
    if (!rereading) answeredNow();
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
        heldForYes: held.map((r) => r.stepKey),
        notKnown: notKnownSaved
          .filter((r) => r.outcome === "COMMITTED")
          .map((r) => r.stepKey),
      },
      "onboarding conversation read and saved",
    );
    const after = setAside.length === 0 ? answeredState : await port.state();
    considerResearch(line, identityOf(after));
    if (rereading) await readAndSave(line, rereads + 1, answeredNow);
    await researchFor(line.onboarding.journeyType)
      ?.offerReady(line.onboarding.sessionId, port)
      .catch((error: unknown) => {
        logger.warn(
          { err: error, onboardingSessionId: line.onboarding.sessionId },
          "research findings not offered",
        );
        return 0;
      });
  };

  const readingFor = (line: ConversationLine): Reading => {
    const key = line.onboarding.sessionId;
    const existing = readings.get(key);
    if (existing !== undefined) {
      existing.line = line;
      return existing;
    }
    const created: Reading = {
      timer: null,
      running: null,
      again: false,
      line,
      heard: 1,
      readThrough: 0,
      answeredThrough: 0,
      waiters: new Set(),
    };
    readings.set(key, created);
    return created;
  };

  const run = (reading: Reading): Promise<void> => {
    if (reading.running !== null) {
      reading.again = true;
      return reading.running;
    }
    // Everything heard by now is in the thread before it is read.
    const upTo = reading.heard;
    const answeredNow = () => {
      if (reading.answeredThrough >= upTo) return;
      reading.answeredThrough = upTo;
      for (const wake of [...reading.waiters]) wake();
    };
    reading.running = readAndSave(reading.line, 0, answeredNow)
      .then(() => {
        reading.readThrough = Math.max(reading.readThrough, upTo);
      })
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
        // Done or failed: nothing more of these words is coming.
        answeredNow();
        if (reading.again) {
          reading.again = false;
          void run(reading);
        }
      });
    return reading.running;
  };

  const schedule = (line: ConversationLine) => {
    const reading = readingFor(line);
    reading.heard += 1;
    if (reading.timer !== null) clearTimeout(reading.timer);
    reading.timer = setTimeout(() => {
      reading.timer = null;
      void run(reading);
    }, readAfterMs);
    reading.timer.unref?.();
  };

  /** Save everything heard now and wait for it (bounded). */
  const flush = async (line: ConversationLine): Promise<boolean> => {
    finishUtterance(line);
    const reading = readingFor(line);
    if (reading.timer !== null) {
      clearTimeout(reading.timer);
      reading.timer = null;
    }
    /** Every reading under way, and any it queued, finished. */
    const quiet = async (): Promise<void> => {
      for (;;) {
        const running: Promise<void> | null = reading.running;
        if (running === null) return;
        await running;
      }
    };
    const done = (async () => {
      await quiet();
      // Read again only when they said something after the last reading
      // began (live re-check 2026-10-31: every flush read the whole thread
      // a second time, the finish waited out its bound, and Q asked for a
      // currency saved two seconds later).
      if (reading.readThrough < reading.heard) await run(reading);
      await quiet();
      return true;
    })();
    return Promise.race([
      done,
      new Promise<boolean>((resolve) => {
        setTimeout(() => resolve(false), SETTLE_WAIT_MS).unref?.();
      }),
    ]);
  };

  /** Their answers are on the record, waited for (bounded); see the type. */
  const answered = async (
    line: ConversationLine,
    through: "LATEST" | "EARLIER",
  ): Promise<boolean> => {
    finishUtterance(line);
    const reading = readingFor(line);
    const wanted =
      through === "LATEST" ? reading.heard : Math.max(0, reading.heard - 1);
    if (reading.answeredThrough >= wanted) return true;
    // Words not being read yet are read now (as flush would).
    if (
      reading.running === null ||
      (through === "LATEST" && reading.timer !== null)
    ) {
      if (reading.timer !== null) {
        clearTimeout(reading.timer);
        reading.timer = null;
      }
      void run(reading);
    }
    return new Promise<boolean>((resolve) => {
      const timeout = setTimeout(() => {
        reading.waiters.delete(wake);
        resolve(false);
      }, SETTLE_WAIT_MS);
      timeout.unref?.();
      function wake() {
        if (reading.answeredThrough < wanted) return;
        clearTimeout(timeout);
        reading.waiters.delete(wake);
        resolve(true);
      }
      reading.waiters.add(wake);
    });
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

    said: async (line, role, text, stepKey = null) => {
      finishUtterance(line);
      keep(line, role, text, "TEXT", stepKey);
      if (role === "PERSON") schedule(line);
      await (writes.get(line.voiceSessionId) ?? Promise.resolve());
    },

    flush: (line) => flush(line),

    answered: (line, through) => answered(line, through),

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
      ).catch((error: unknown) => {
        logger.warn(
          { err: error, onboardingSessionId: line.onboarding.sessionId },
          "onboarding thread not read",
        );
        return { items: [] };
      });
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
      // Setup is done: whatever they ask now, the call ends and they go
      // into Capital Q (owner 2026-10-28: "take me to my Discover page"
      // after finishing was answered "coming up" and nothing moved).
      if (state.completed) {
        return {
          commentary: completedNote(line.onboarding.journeyType, true),
          leave: true,
        };
      }
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
          return {
            commentary: completedNote(line.onboarding.journeyType),
            leave: true,
          };
        }
        return { commentary: readBack(await port.state()) };
      }
      return { commentary: readBack(state) };
    },
  };
}

const plain = (text: string): string[] =>
  text
    .toLowerCase()
    .normalize("NFKC")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length > 0);

/**
 * Whether the reader's quote comes from one of these turns: verbatim, or
 * (the reader trims and joins) most of its words in one turn. Any
 * language: words are letters and digits, not an English list.
 */
export function quotedFrom(quote: string, turns: readonly string[]): boolean {
  const words = plain(quote);
  if (words.length === 0) return false;
  const joined = words.join(" ");
  return turns.some((turn) => {
    const said = plain(turn);
    if (said.join(" ").includes(joined)) return true;
    const bag = new Set(said);
    const shared = words.filter((word) => bag.has(word)).length;
    return shared / words.length >= 0.6;
  });
}

/**
 * Where in the conversation a reader's quote was said: the person's line
 * it comes from (their latest such line, verbatim before loosely), when
 * they said it, and the Q line they were answering then. Live 2026-10-30
 * (Granary): Q's summary was agreed to a line or two before the reading
 * caught up, so the read-back is found by the line the agreement is in,
 * never only by Q's latest line.
 */
export function placeOfQuote(
  items: readonly {
    readonly role: "PERSON" | "Q";
    readonly text: string;
    readonly createdAt?: string | undefined;
  }[],
): {
  readonly qLineBefore: (quote: string) => string | undefined;
  readonly saidAt: (quote: string) => string | undefined;
} {
  const lineOf = (quote: string): number => {
    const joined = plain(quote).join(" ");
    if (joined.length === 0) return -1;
    const verbatim = items.findLastIndex(
      (item) =>
        item.role === "PERSON" && plain(item.text).join(" ").includes(joined),
    );
    if (verbatim >= 0) return verbatim;
    return items.findLastIndex(
      (item) => item.role === "PERSON" && quotedFrom(quote, [item.text]),
    );
  };
  return {
    qLineBefore: (quote) => {
      const at = lineOf(quote);
      if (at < 0) return undefined;
      return items.slice(0, at).findLast((item) => item.role === "Q")?.text;
    },
    saidAt: (quote) => {
      const at = lineOf(quote);
      return at < 0 ? undefined : items[at]?.createdAt;
    },
  };
}

/**
 * An answer that only agrees to what Q offered (the reading's `affirms`)
 * carries Q's value; any of it that is the person's own agreeing words is
 * no value (live final re-check 2026-10-31: "Yes, please." kept as the
 * deployment status, "yes" joined a category note). Words, compared with
 * their quote; an option of the step is always a value. Null: nothing of
 * it is a value.
 */
export function withoutAgreeingWords<
  T extends {
    readonly stepKey: string;
    readonly value: string | readonly string[] | number | boolean;
    readonly quote: string;
    readonly affirms?: boolean | undefined;
  },
>(answer: T, isOption: (stepKey: string, value: string) => boolean): T | null {
  if (answer.affirms !== true) return answer;
  const theirs = (text: string) =>
    !isOption(answer.stepKey, text) && quotedFrom(text, [answer.quote]);
  if (typeof answer.value === "string") {
    return theirs(answer.value) ? null : answer;
  }
  if (isWords(answer.value)) {
    const kept = answer.value.filter((item) => !theirs(item));
    if (kept.length === 0) return null;
    return kept.length === answer.value.length
      ? answer
      : { ...answer, value: kept };
  }
  return answer;
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

/** A step that holds a list: several options, or categories. */
function isList(step: OnboardingStepState | undefined): boolean {
  return step?.kind === "MANY_OF" || step?.kind === "CATEGORIES";
}

function isAnswerable(state: OnboardingState, stepKey: string): boolean {
  const step = stepOf(state, stepKey);
  return step !== undefined && isConversational(step);
}

/** Open, a spoken answer can fill it, and no other answer settled it. */
function isAskable(step: OnboardingStepState): boolean {
  return (
    isConversational(step) &&
    step.status === "OPEN" &&
    step.coveredBy === undefined
  );
}

/** A strength step qualifies the step before it; never asked on its own. */
function isFollowOn(step: OnboardingStepState): boolean {
  return step.stepKey.endsWith("_strength");
}

/**
 * The optional topics not yet asked or declined, grouped by the setup's
 * own phases in its order (the voice prompt groups related questions).
 */
export function optionalGroups(state: OnboardingState): string[][] {
  const topics = topicsOf(state.steps);
  const phaseOf = new Map(
    definitionFor(state.journey).steps.map(
      (step) => [step.stepKey, step.configuration.phaseKey] as const,
    ),
  );
  const groups: { phase: string; topics: string[] }[] = [];
  for (const step of state.steps) {
    if (step.required || !isAskable(step)) continue;
    const phase = phaseOf.get(step.stepKey) ?? step.stepKey;
    const topic = topics.get(step.stepKey) ?? step.question;
    const last = groups.at(-1);
    if (last !== undefined && last.phase === phase) last.topics.push(topic);
    else groups.push({ phase, topics: [topic] });
  }
  return groups.slice(0, 12).map((group) => group.topics.slice(0, 8));
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

/**
 * Each choice step's options as ids a model sees in place of their keys
 * (o1, o2, ...), by step: id to key. Live recheck 2026-10-30: "We prefer
 * to follow a lead" was saved as `follow` ("Follow in later rounds"), not
 * co_invest ("Co-invest alongside a lead"): a key that is a word they used
 * pulled the reading to it, whatever the prompt said. A model reads only
 * the labels; code maps its ids back to the keys.
 */
export function optionIdsOf(
  state: Pick<OnboardingState, "steps">,
): ReadonlyMap<string, ReadonlyMap<string, string>> {
  return new Map(
    state.steps.map(
      (step) =>
        [
          step.stepKey,
          new Map(
            (step.options ?? []).map(
              (option, index) => [`o${String(index + 1)}`, option.key] as const,
            ),
          ),
        ] as const,
    ),
  );
}

/** A reading's value with each option id it names put back as its key. */
export function keysFromIds<T>(
  value: T,
  ids: ReadonlyMap<string, string> | undefined,
): T {
  if (ids === undefined || ids.size === 0) return value;
  const keyOf = (word: string): string =>
    ids.get(word.trim().toLowerCase()) ?? word;
  if (typeof value === "string") return keyOf(value) as T;
  if (Array.isArray(value)) {
    return value.map((item: unknown) =>
      typeof item === "string" ? keyOf(item) : item,
    ) as T;
  }
  return value;
}

function readableSteps(
  state: OnboardingState,
  optionIds: ReadonlyMap<string, ReadonlyMap<string, string>>,
) {
  const topics = topicsOf(state.steps);
  return state.steps.filter(isConversational).map((step) => ({
    stepKey: step.stepKey,
    question: topics.get(step.stepKey) ?? step.question,
    // A step told at length is saved only as Q's summary they agreed to
    // (ONBOARDING_TRANSCRIPT_READER v7 reads LONG_TEXT so).
    kind: isLongAnswerStep(state.journey, step.stepKey)
      ? "LONG_TEXT"
      : step.kind,
    required: step.required,
    // Labels only, each with its opaque id: never a key as a word.
    options: [...(optionIds.get(step.stepKey) ?? new Map<string, string>())]
      .map(
        ([id, key]) =>
          `${id}: ${step.options?.find((option) => option.key === key)?.label ?? id}`,
      )
      .join("; "),
    onRecord:
      step.status === "ANSWERED"
        ? (step.value ?? "answered")
        : step.status === "SET_ASIDE"
          ? "they chose to skip it"
          : "nothing",
  }));
}

/**
 * The checklist the live voice holds for the whole call. `withIds` (typed
 * only): each topic carries its step id, so the reply can say which topic
 * its question asks (live 2026-10-29: the checklist had no ids, every
 * typed reply said asking=null, and a reopened setup asked the wrong
 * question). Voice speaks its lines, so it never sees ids.
 */
export function briefOf(
  state: OnboardingState,
  options: { readonly withIds?: boolean } = {},
): string {
  const topics = topicsOf(state.steps);
  const lines = state.steps.filter(isConversational).map((step) => {
    const topic = topics.get(step.stepKey) ?? step.question;
    const choices = optionLabels(step);
    const status =
      step.status === "ANSWERED"
        ? `already saved: ${step.value ?? "answered"}`
        : step.status === "SET_ASIDE"
          ? "they chose to skip this"
          : // Production re-test 2026-10-28: "Are those US dollars?" after
            // "dollars" was typed, and "currency unspecified" while USD was
            // being saved: an answer still saving is theirs already.
            step.savePending === true
            ? "they already told you this and it is being saved: never ask it again or call it unknown"
            : (step.pendingRecommendation ?? step.offered) !== undefined
              ? `not confirmed yet; Q found: ${step.pendingRecommendation ?? step.offered ?? ""}`
              : "not covered yet";
    const sayBack =
      step.status === "OPEN" && isLongAnswerStep(state.journey, step.stepKey)
        ? " (say back)"
        : "";
    return `- ${step.required ? "Needed" : "Optional"}: ${topic}${
      choices.length === 0 ? "" : ` (choices: ${choices})`
    }${sayBack} [${status}]${options.withIds === true ? ` (id: ${step.stepKey})` : ""}`;
  });
  const sayingBack = state.steps.some(
    (step) =>
      isConversational(step) &&
      step.status === "OPEN" &&
      isLongAnswerStep(state.journey, step.stepKey),
  );
  const documents = state.steps.some((step) => step.kind === "DOCUMENT");
  const minutes = state.minutesLeft ?? null;
  const groups = optionalGroups(state);
  return [
    `What this setup needs (${state.journey}), in the setup's order. These are topics, not a script: ask in your own plain words, one thing at a time, and group things that belong together.`,
    ...lines,
    // Owner 2026-10-17, re-agreed 2026-10-30 (live, Granary): a long
    // answer is said back in Q's words at once and saved as what they
    // agree to; a summary card beside the conversation raced it.
    ...(sayingBack
      ? [
          // Live check 2026-10-31 (Grannskap): one ramble told four of
          // them and only the description was said back; the rest came one
          // yes at a time, and the lead-ins Q used were saved with them.
          "Topics marked (say back) are told at length. As soon as they have told you about any of them, needed or optional, say back what you understood for every one of those topics they told you, all in one say-back, one short line a topic (its name, then its content as it should read on their profile, never framed as you telling them), and ask once if that's right, before you ask anything else. One yes then settles them all: never say one back now and the others later. What they agree to is what is saved, so never move on to a new question in that same message. Summaries waiting for their yes (not confirmed yet) are said back the same way, all together.",
        ]
      : []),
    ...(groups.length === 0
      ? []
      : [
          "Optional topics, grouped (every one is asked; they may skip any):",
          ...groups.map(
            (group, index) =>
              `- Group ${String(index + 1)}: ${group.join("; ")}`,
          ),
          "After the needed topics, offer these a group at a time, in plain words, saying they can skip. Finish only when every topic has been asked or they declined it, or they ask to finish.",
        ]),
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
  // The setup's own order, optional steps included (owner 2026-10-28:
  // every question is asked; a resumed call skipped an optional question
  // asked just before the line dropped, for good). A question asked and
  // never answered is still open, so it is asked again.
  const next =
    asked ??
    state.steps.find(
      (step) => isAskable(step) && (step.required || !isFollowOn(step)),
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

/** The step's plain label ("Typical cheque"), for a read-back; never its question. */
function labelOf(step: OnboardingStepState): string {
  return plainStepLabel(step.stepKey);
}

function savedLines(state: OnboardingState): string[] {
  return state.steps
    .filter((step) => isConversational(step) && step.status === "ANSWERED")
    .map((step) => `${labelOf(step)}: ${step.value ?? "answered"}`);
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
  const groups = optionalGroups(state);
  const optionalLeft = groups.reduce((sum, group) => sum + group.length, 0);
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
      ? optionalLeft === 0
        ? "Everything needed is in, and every optional topic is covered or declined."
        : `The essentials are in. ${String(optionalLeft)} optional ${optionalLeft === 1 ? "topic" : "topics"} left, not asked or declined yet.`
      : `Still needed: ${needed.join("; ")}.`,
    groups.length === 0
      ? ""
      : `Optional, grouped: ${groups
          .map((group, index) => `(${String(index + 1)}) ${group.join("; ")}`)
          .join(" ")}`,
    found.length === 0
      ? ""
      : `Found in their documents or public sources, not confirmed yet (put these to them in one go and ask if they're right): ${found.join("; ")}.`,
    needed.length > 0
      ? "Carry on naturally with what is still needed. Then offer the optional topics a group at a time, saying they can skip any."
      : optionalLeft > 0
        ? "Do not wrap up yet: offer the next optional group now, in plain words, one group at a time, saying they can skip it. If they'd rather finish now, that is their choice: pass their words on."
        : "Read back the essentials in a few plain sentences (never the list word for word), ask if anything is wrong or missing, and whether they'd like to finish. If they want to finish, pass their words on.",
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

function completedNote(
  journey: "investor" | "founder",
  already = false,
): string {
  // The browser takes them there when the call ends (leave), so this says
  // where they are going, never that the page is open.
  if (already) {
    return journey === "investor"
      ? "Their setup is already finished. In one short sentence, say you're taking them into Capital Q now, to Discover. Then stop talking: the call ends after it."
      : "Their setup is already finished. In one short sentence, say you're taking them into Capital Q now, to their home page. Then stop talking: the call ends after it.";
  }
  return journey === "investor"
    ? "Their mandate is saved and live: Capital Q now matches companies to it. Tell them warmly, in one or two sentences, that it's done and that you're taking them to Discover now, where they'll see companies matched to it. Then stop talking: the call ends after your goodbye."
    : "Their company profile is saved. Tell them warmly, in one or two sentences, that it's done, that investors who fit will now be matched to it, and that you're taking them to their home page now. Then stop talking: the call ends after your goodbye.";
}
