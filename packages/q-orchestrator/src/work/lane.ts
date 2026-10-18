import { considerationReason, considerOutreach } from "@capital-q/q-core";
import {
  Annotation,
  END,
  START,
  StateGraph,
  interrupt,
  type BaseCheckpointSaver,
} from "@langchain/langgraph";

import { GOOGLE_RECONNECT_PATH, isCalendarBlock } from "@capital-q/contracts";

import {
  Q2Q_DAILY_CAP,
  WAIT_NUDGE_AFTER_DAYS,
  WAIT_TELL_OWNER_AFTER_DAYS,
  type DelegationRef,
  type InterviewAnswer,
  type LaneObservation,
  type LaneStage,
  type ObservedMessage,
  type OutreachGrant,
  type QEnvelope,
  type QWorkPorts,
  type ShortlistPick,
} from "./types.js";
import { threadText } from "./thread-text.js";

/**
 * One founder inside an investor's outreach (ADR 0030):
 *
 *   acceptance → chat → [interview → report] → times → decide (book / pass)
 *
 * Every wait is an `interrupt()` resumed with a code-gathered Observation.
 * A node does its effects through ports keyed by step, so a node replayed
 * after a crash repeats nothing. The graph decides only what comes next;
 * whether an effect is allowed is decided again by the port, as the person.
 */

type Phase =
  "ACCEPTANCE" | "CHAT" | "INTERVIEW" | "REPORT" | "TIMES" | "DECIDE" | "END";

type InterviewProgress = {
  readonly index: number;
  readonly askedAt: string | null;
  readonly followUpAsked: boolean;
  readonly nudged: boolean;
  readonly qa: readonly InterviewAnswer[];
};

export type LaneState = {
  ref: DelegationRef;
  laneId: string;
  grant: OutreachGrant;
  counterpartName: string;
  reasons: ShortlistPick["reasons"];
  relationshipId: string | null;
  chatPath: string | null;
  phase: Phase;
  waiting: boolean;
  obs: LaneObservation | null;
  /** Newest other-side message Q has handled. */
  seenUntil: string | null;
  qReplies: number;
  chatTurns: number;
  learned: readonly { topic: string; words: string }[];
  interview: InterviewProgress;
  answersHandled: readonly string[];
  bookings: number;
  /** When Q started waiting for them to accept. */
  waitingSince: string | null;
  /**
   * meetfix-57: the call is parked because the person's Google Calendar is
   * missing or revoked (the typed reason); nothing is attempted until
   * `calendarReady` says it is back.
   */
  calendarBlocked: string | null;
};

const replace = <T>(initial: () => T) =>
  Annotation<T>({ reducer: (_left, right) => right, default: initial });

export const LaneAnnotation = Annotation.Root({
  ref: Annotation<DelegationRef>,
  laneId: Annotation<string>,
  grant: Annotation<OutreachGrant>,
  counterpartName: Annotation<string>,
  reasons: replace<ShortlistPick["reasons"]>(() => []),
  relationshipId: replace<string | null>(() => null),
  chatPath: replace<string | null>(() => null),
  phase: replace<Phase>(() => "ACCEPTANCE"),
  waiting: replace<boolean>(() => false),
  obs: replace<LaneObservation | null>(() => null),
  seenUntil: replace<string | null>(() => null),
  qReplies: replace<number>(() => 0),
  chatTurns: replace<number>(() => 0),
  learned: replace<readonly { topic: string; words: string }[]>(() => []),
  interview: replace<InterviewProgress>(() => ({
    index: 0,
    askedAt: null,
    followUpAsked: false,
    nudged: false,
    qa: [],
  })),
  answersHandled: replace<readonly string[]>(() => []),
  bookings: replace<number>(() => 0),
  waitingSince: replace<string | null>(() => null),
  calendarBlocked: replace<string | null>(() => null),
});

/** Replies Q sends to one founder before handing the thread back. */
const MAX_Q_REPLIES = 12;
/** Founder turns of free chat before Q moves the lane on. */
const MAX_CHAT_TURNS = 6;
const NUDGE_AFTER_MS = 24 * 3_600_000;
const DAY_MS = 24 * 3_600_000;
const GIVE_UP_AFTER_MS = 72 * 3_600_000;

function fresh(
  messages: readonly ObservedMessage[],
  after: string | null,
): ObservedMessage[] {
  const since = after === null ? 0 : Date.parse(after);
  return messages.filter(
    (message) =>
      message.from === "OTHER_SIDE" && Date.parse(message.at) > since,
  );
}

const ENVELOPE = (intent: QEnvelope["intent"]): QEnvelope => ({
  protocol: "cq.q2q/1",
  side: "INVESTOR",
  intent,
});

export function buildLaneGraph(ports: QWorkPorts, saver: BaseCheckpointSaver) {
  type Update = Partial<LaneState>;

  const label = async (
    state: LaneState,
    stage: LaneStage,
    lastStep: string,
    extra: Parameters<QWorkPorts["updateLane"]>[1] = {},
  ) => {
    await ports.updateLane(state.laneId, { ...extra, stage, lastStep });
  };

  const post = (
    state: LaneState,
    key: string,
    body: string,
    intent: QEnvelope["intent"],
  ): Promise<boolean> =>
    state.relationshipId === null
      ? Promise.resolve(false)
      : ports.post(
          state.ref,
          state.relationshipId,
          key,
          body.slice(0, 4_000),
          ENVELOPE(intent),
        );

  const end = async (
    state: LaneState,
    stage: LaneStage,
    words: string,
  ): Promise<Update> => {
    await label(state, stage, words, { needs: null });
    await ports.step(state.ref, state.laneId, `end:${state.laneId}`, words);
    return { phase: "END", waiting: false };
  };

  // --- wait: the only place the thread suspends ---------------------------
  const wait = (): Update => {
    const obs = interrupt<{ waiting: true }, LaneObservation>({
      waiting: true,
    });
    return { obs, waiting: false };
  };

  // --- gate: what every resume checks first ---------------------------------
  const gate = async (state: LaneState): Promise<Update> => {
    const obs = state.obs;
    if (obs === null) return { waiting: true };
    if (obs.status === "STOPPED") {
      return end(state, "STOPPED", "Stopped.");
    }
    if (obs.status === "EXPIRED") {
      await ports.notify(state.ref, {
        key: `expired:${state.laneId}`,
        title: `Q handed ${state.counterpartName} back to you`,
        body: "The time you gave Q for this is up.",
        link: state.chatPath,
        priority: "UPDATE",
      });
      return end(state, "DONE", "Time's up; handed back to you.");
    }
    if (obs.access !== "OK") {
      const words =
        obs.access === "BLOCKED"
          ? "Messaging is blocked on this relationship, so Q stopped."
          : "Your access changed, so Q stopped.";
      await ports.notify(state.ref, {
        key: `access:${state.laneId}`,
        title: `Q stopped with ${state.counterpartName}`,
        body: words,
        link: null,
        priority: "UPDATE",
      });
      return end(state, "STOPPED", words);
    }
    return {
      relationshipId: obs.relationshipId ?? state.relationshipId,
      chatPath: obs.chatPath ?? state.chatPath,
    };
  };

  // --- after the chat: interview, times, or done ----------------------------
  const afterChat = async (state: LaneState): Promise<Update> => {
    if (state.grant.interview !== null) {
      return { phase: "INTERVIEW", waiting: false };
    }
    if (state.grant.call !== null) return { phase: "TIMES", waiting: false };
    await ports.notify(state.ref, {
      key: `chat-done:${state.laneId}`,
      title: `Q finished talking with ${state.counterpartName}`,
      body:
        state.learned.length === 0
          ? null
          : state.learned
              .map((item) => `${item.topic}: ${item.words}`)
              .join("\n")
              .slice(0, 1_000),
      link: state.chatPath,
      priority: "UPDATE",
    });
    return end(state, "DONE", "Done: Q learned what you asked.");
  };

  /**
   * Their new words since Q last read: answered from the brief, topics
   * asked, what was learned kept. Shared by the chat phase and the later
   * phases, where the conversation simply carries on.
   */
  const converse = async (
    state: LaneState,
    obs: LaneObservation,
    asking: boolean,
  ): Promise<Update | null> => {
    const news = fresh(obs.messages, state.seenUntil);
    const latest = news.at(-1);
    if (latest === undefined) return null;
    const otherSideIsQ = latest.envelope !== null;
    // Q-to-Q (cq.q2q/1): a Q answers another Q only when asked, and never
    // past the daily cap, so two Qs cannot talk in circles.
    const mayReply =
      state.qReplies < MAX_Q_REPLIES &&
      (!otherSideIsQ ||
        (latest.envelope?.intent === "ASK" && obs.q2qLastDay < Q2Q_DAILY_CAP));
    const topicsOpen = asking
      ? state.grant.topics.filter(
          (topic) => !state.learned.some((item) => item.topic === topic),
        )
      : [];
    const result = await ports.converse(state.ref, {
      principalName: state.ref.principalName,
      counterpartName: state.counterpartName,
      brief: state.grant.brief,
      topicsOpen,
      thread: threadText(obs.messages, state.ref.principalName),
      otherSideIsQ,
    });
    // No words this time (model unavailable): read again next time.
    if (result === null) return { waiting: true };
    let replies = state.qReplies;
    // ADR 0050, the consider step: a reply to what reads as a no, or to an
    // unhappy message, is the person's to send, never Q's on its own.
    // J7: their words are read by meaning (REPLY_READER), only when there
    // is a reply to hold; unreadable is treated as a possible no.
    const words = latest.text;
    const needsReading =
      !otherSideIsQ && result.reply !== null && mayReply && words !== null;
    const reading = needsReading
      ? await ports
          .readReply(state.ref, {
            counterpartName: state.counterpartName,
            thread: threadText(obs.messages, state.ref.principalName),
            latest: words,
          })
          .catch(() => null)
      : null;
    const considered = considerOutreach({
      now: new Date(obs.now),
      kind: "REPLY",
      asksMeeting: false,
      theyHaveWritten: true,
      lastFromUsAt: null,
      unansweredFromUs: 0,
      declined: needsReading && (reading?.declined ?? true),
      negativeTone: needsReading && reading?.negativeTone === true,
      followUpsAllowed: true,
      alreadyThisSitting: 0,
    });
    let held: string | null = null;
    if (
      result.reply !== null &&
      mayReply &&
      considered.decision !== "PROCEED"
    ) {
      held = considerationReason(considered);
      await ports.notify(state.ref, {
        key: `consider:${latest.id}`,
        title: `${state.counterpartName} may have said no`,
        body: `Q didn't reply: ${held}. Read their message and reply yourself if you want to.`,
        link: state.chatPath,
        priority: "NEEDS_YOU",
      });
    } else if (result.reply !== null && mayReply) {
      const sent = await post(
        state,
        `reply:${latest.id}`,
        result.reply,
        topicsOpen.length > 0 ? "ASK" : "ANSWER",
      );
      if (sent) replies += 1;
    }
    const learned = [...state.learned];
    for (const item of result.learned) {
      if (!state.grant.topics.includes(item.topic)) continue;
      const at = learned.findIndex((known) => known.topic === item.topic);
      if (at === -1) learned.push(item);
      else learned[at] = item;
    }
    if (result.forPerson.length > 0) {
      await ports.notify(state.ref, {
        key: `ask:${latest.id}`,
        title: `${state.counterpartName} asked something only you can answer`,
        body: result.forPerson.join("\n").slice(0, 1_000),
        link: state.chatPath,
        priority: "NEEDS_YOU",
      });
    }
    await ports.updateLane(state.laneId, {
      learned,
      repliesSent: replies,
      lastStep:
        replies > state.qReplies
          ? `Q replied to ${state.counterpartName}.`
          : held !== null
            ? `${state.counterpartName} wrote; Q held its reply: ${held}.`
            : `${state.counterpartName} wrote.`,
    });
    return {
      seenUntil: latest.at,
      qReplies: replies,
      chatTurns: state.chatTurns + 1,
      learned,
      ...(result.ready ? { waiting: false } : {}),
    };
  };

  // --- waiting for them, like a person would ----------------------------------
  const waitForAcceptance = async (
    state: LaneState,
    obs: LaneObservation,
  ): Promise<Update> => {
    const since = state.waitingSince ?? obs.now;
    if (state.waitingSince === null) {
      await ports.updateLane(state.laneId, {
        lastStep: `Waiting for ${state.counterpartName} to accept your interest.`,
      });
    }
    const days = (Date.parse(obs.now) - Date.parse(since)) / DAY_MS;
    if (days >= WAIT_NUDGE_AFTER_DAYS && state.relationshipId !== null) {
      const reminded = await ports.nudgeCounterpart(
        state.ref,
        state.relationshipId,
        `lane:${state.laneId}`,
      );
      if (reminded) {
        await ports.updateLane(state.laneId, {
          lastStep: `Q reminded ${state.counterpartName} gently; still waiting for them to accept.`,
        });
      }
    }
    if (days >= WAIT_TELL_OWNER_AFTER_DAYS) {
      await ports.notify(state.ref, {
        key: `waiting-long:${state.laneId}`,
        title: `${state.counterpartName} hasn't accepted yet`,
        body: `It's been ${String(WAIT_TELL_OWNER_AFTER_DAYS)} days and Q reminded them once. Q keeps waiting and carries on the moment they accept; you can stop this one any time.`,
        link: `/work/${state.ref.delegationId}`,
        priority: "NEEDS_YOU",
      });
    }
    return { waiting: true, waitingSince: since };
  };

  // --- ACCEPTANCE ------------------------------------------------------------
  const acceptance = async (state: LaneState): Promise<Update> => {
    const obs = state.obs;
    if (obs === null) return { waiting: true };
    if (obs.declined) {
      await ports.notify(state.ref, {
        key: `declined:${state.laneId}`,
        title: `${state.counterpartName} declined`,
        body: "Q won't contact them again for this.",
        link: null,
        priority: "UPDATE",
      });
      return end(state, "DECLINED", "They declined.");
    }
    if (!obs.connected || state.relationshipId === null) {
      return waitForAcceptance(state, obs);
    }
    await post(state, "open", state.grant.openingMessage, "INFO");
    await ports.step(
      state.ref,
      state.laneId,
      `accepted:${state.laneId}`,
      `${state.counterpartName} accepted; Q sent your opening message.`,
    );
    await label(state, "CHATTING", "They accepted; Q said hello.");
    await ports.notify(state.ref, {
      key: `accepted:${state.laneId}`,
      title: `${state.counterpartName} accepted your interest`,
      body: "Q sent your opening message and is talking with them.",
      link: state.chatPath,
      priority: "UPDATE",
    });
    const nothingToTalkAbout =
      state.grant.topics.length === 0 && state.grant.brief === null;
    const update: Update = {
      phase: "CHAT",
      seenUntil: obs.now,
      waiting: !nothingToTalkAbout,
    };
    return nothingToTalkAbout
      ? { ...update, ...(await afterChat({ ...state, ...update })) }
      : update;
  };

  // --- CHAT ------------------------------------------------------------------
  const chat = async (state: LaneState): Promise<Update> => {
    const obs = state.obs;
    if (obs === null) return { waiting: true };
    const update = await converse(state, obs, true);
    if (update === null) return { waiting: true };
    const next = { ...state, ...update };
    const covered =
      state.grant.topics.length > 0 &&
      state.grant.topics.every((topic) =>
        next.learned.some((item) => item.topic === topic),
      );
    const ready =
      update.waiting === false || covered || next.chatTurns >= MAX_CHAT_TURNS;
    if (!ready) return { ...update, waiting: true };
    return { ...update, ...(await afterChat(next)) };
  };

  // --- INTERVIEW ---------------------------------------------------------------
  const interview = async (state: LaneState): Promise<Update> => {
    const obs = state.obs;
    const questions = state.grant.interview?.questions ?? [];
    const progress = state.interview;
    const now = obs?.now ?? new Date().toISOString();
    const ask = async (index: number, lead: string) => {
      const question = questions[index] ?? "";
      await post(
        state,
        `interview:${String(index)}`,
        `${lead}Question ${String(index + 1)} of ${String(questions.length)}: ${question}`,
        "ASK",
      );
      await label(
        state,
        "INTERVIEWING",
        `Interview: question ${String(index + 1)} of ${String(questions.length)}.`,
      );
    };
    if (progress.askedAt === null) {
      await ask(
        0,
        `${state.ref.principalName} asked me to run a short first conversation before you speak: ${String(questions.length)} questions. Answer in your own words, whenever suits you.\n\n`,
      );
      await ports.step(
        state.ref,
        state.laneId,
        `interview-start:${state.laneId}`,
        `Q started the first-stage interview with ${state.counterpartName}.`,
      );
      return {
        interview: { ...progress, askedAt: now },
        seenUntil: now,
        waiting: true,
      };
    }
    if (obs === null) return { waiting: true };
    const since = fresh(obs.messages, progress.askedAt);
    const news = fresh(obs.messages, state.seenUntil);
    const question = questions[progress.index] ?? "";
    let answer: string;
    if (news.length === 0) {
      const waited = Date.parse(now) - Date.parse(progress.askedAt);
      if (waited >= GIVE_UP_AFTER_MS) {
        answer = "(No answer.)";
      } else if (waited >= NUDGE_AFTER_MS && !progress.nudged) {
        await post(
          state,
          `nudge:${String(progress.index)}`,
          "Just checking in on the question above, no rush.",
          "INFO",
        );
        return { interview: { ...progress, nudged: true }, waiting: true };
      } else {
        return { waiting: true };
      }
    } else {
      const latest = news.at(-1);
      const result = await ports.interviewTurn(state.ref, {
        principalName: state.ref.principalName,
        counterpartName: state.counterpartName,
        question,
        answerSoFar: since
          .map((message) => message.text ?? "")
          .join("\n")
          .slice(0, 6_000),
        followUpAllowed: !progress.followUpAsked,
      });
      if (result === null) return { waiting: true };
      if (
        result.followUp !== null &&
        !progress.followUpAsked &&
        latest !== undefined
      ) {
        await post(
          state,
          `follow:${String(progress.index)}`,
          result.followUp,
          "ASK",
        );
        return {
          interview: { ...progress, followUpAsked: true },
          seenUntil: latest.at,
          waiting: true,
        };
      }
      if (!result.answered && !progress.followUpAsked) {
        return { seenUntil: latest?.at ?? state.seenUntil, waiting: true };
      }
      answer =
        result.answer ??
        since
          .map((message) => message.text ?? "")
          .join(" ")
          .slice(0, 1_500);
    }
    // Answered (wholly or partly) by the founder's own Q standing in.
    const byQ = since.some((message) => message.viaQ);
    const qa = [...progress.qa, { question, answer, byQ }];
    await ports.updateLane(state.laneId, { interview: qa });
    const next = progress.index + 1;
    const seenUntil = news.at(-1)?.at ?? state.seenUntil;
    if (next < questions.length) {
      await ask(next, "Thank you. ");
      return {
        interview: {
          index: next,
          askedAt: now,
          followUpAsked: false,
          nudged: false,
          qa,
        },
        seenUntil,
        waiting: true,
      };
    }
    await post(
      state,
      "interview:done",
      `Thank you, that's everything. I'll pass this to ${state.ref.principalName}.`,
      "INFO",
    );
    return {
      interview: { ...progress, index: next, qa },
      seenUntil,
      phase: "REPORT",
      waiting: false,
    };
  };

  // --- REPORT ------------------------------------------------------------------
  const report = async (state: LaneState): Promise<Update> => {
    const filed = await ports.report(state.ref, {
      laneId: state.laneId,
      counterpartName: state.counterpartName,
      reasons: state.reasons,
      learned: state.learned,
      interview: state.interview.qa,
      transcript: threadText(
        state.obs?.messages ?? [],
        state.ref.principalName,
      ),
    });
    if (filed === null) return { waiting: true };
    const words = {
      PROCEED: "Q suggests you proceed",
      MAYBE: "Q is unsure",
      PASS: "Q suggests you pass",
    }[filed.recommendation];
    await label(state, "REPORT_READY", `Report ready: ${words}.`);
    await ports.step(
      state.ref,
      state.laneId,
      `report:${state.laneId}`,
      `Q wrote the first-stage report on ${state.counterpartName}: ${words}.`,
    );
    await ports.notify(state.ref, {
      key: `report:${state.laneId}`,
      title: `First-stage report on ${state.counterpartName}: ${words}`,
      body: filed.headline,
      link: filed.path,
      priority: "NEEDS_YOU",
    });
    if (state.grant.call === null) {
      return end(state, "REPORT_READY", `Report ready: ${words}.`);
    }
    return { phase: "TIMES", waiting: false };
  };

  // --- TIMES -------------------------------------------------------------------
  /**
   * meetfix-57: a call can't be booked on a missing or revoked calendar.
   * The lane says why, the person is told once with the reconnect link,
   * and nothing more is attempted until the calendar is back.
   */
  const parkOnCalendar = async (
    state: LaneState,
    code: string,
  ): Promise<Update> => {
    const revoked = code === "CALENDAR_REVOKED";
    await ports.updateLane(state.laneId, {
      lastStep: revoked
        ? "Call on hold: your Google Calendar connection expired. Reconnect Google to book it."
        : "Call on hold: your Google Calendar isn't connected. Connect Google to book it.",
    });
    await ports.notify(state.ref, {
      key: `calendar-blocked:${state.laneId}:${code}`,
      title: `${revoked ? "Reconnect" : "Connect"} Google to book your call with ${state.counterpartName}`,
      body: `${revoked ? "Your Google Calendar connection expired" : "Your Google Calendar isn't connected"}, so Q can't create the Meet link. ${revoked ? "Reconnect" : "Connect"} it in Settings → Connections (one tap) and Q will book it.`,
      link: GOOGLE_RECONNECT_PATH,
      priority: "NEEDS_YOU",
    });
    return { phase: "TIMES", waiting: true, calendarBlocked: code };
  };

  const book = async (
    state: LaneState,
    key: string,
    at: string,
  ): Promise<Update> => {
    const call = state.grant.call;
    if (call === null || state.relationshipId === null) {
      return { waiting: true };
    }
    const booked = await ports.book(state.ref, state.relationshipId, {
      key,
      at,
      purpose: call.purpose,
      durationMinutes: call.durationMinutes,
    });
    if (booked.outcome === "REFUSED" && isCalendarBlock(booked.code)) {
      return parkOnCalendar(state, booked.code);
    }
    if (booked.outcome !== "OK") {
      await ports.notify(state.ref, {
        key: `book-refused:${key}`,
        title: `Q couldn't book the call with ${state.counterpartName}`,
        body:
          booked.code === "CALENDAR_NOT_CONNECTED"
            ? "Connect Google Calendar in Settings, then choose a time again."
            : "That time didn't work. Choose another time.",
        link: workPathOf(state),
        priority: "NEEDS_YOU",
      });
      return { phase: "TIMES", waiting: true };
    }
    await post(
      state,
      `booked:${key}`,
      `${state.ref.principalName} would like to talk: ${booked.when}. A calendar invite${booked.meetLink === null ? " is on its way to you by email; a video link will follow." : ` with a Google Meet link (${booked.meetLink}) is on its way to you.`} If the time doesn't suit, say so here.`,
      "INFO",
    );
    await label(state, "CALL_BOOKED", `Call booked: ${booked.when}.`, {
      meetingId: booked.meetingId,
      needs: null,
    });
    await ports.step(
      state.ref,
      state.laneId,
      `booked:${key}`,
      `Q booked a call with ${state.counterpartName}: ${booked.when}.`,
    );
    await ports.notify(state.ref, {
      key: `booked:${key}`,
      title: `Call with ${state.counterpartName} booked: ${booked.when}`,
      body:
        booked.meetLink === null
          ? "The invite is in your email. Add a video link: connect Google Calendar in Settings, or paste a link in the chat."
          : `Meet link: ${booked.meetLink}`,
      link: state.chatPath,
      priority: "UPDATE",
    });
    return { phase: "DECIDE", waiting: true, bookings: state.bookings + 1 };
  };

  const workPathOf = (state: LaneState) => `/work/${state.ref.delegationId}`;

  const times = async (state: LaneState): Promise<Update> => {
    const call = state.grant.call;
    if (call === null || state.relationshipId === null) {
      return end(state, "DONE", "Done.");
    }
    if (state.calendarBlocked !== null) {
      // Parked: a cheap check of stored state, never a booking attempt.
      const ready =
        (await ports.calendarReady?.(state.ref).catch(() => false)) ?? false;
      if (!ready) return { waiting: true };
      // Reconnected: the hold is over, and the times step runs again now.
      await ports.updateLane(state.laneId, {
        lastStep: "Google reconnected; Q is booking the call.",
      });
      return { calendarBlocked: null, waiting: false };
    }
    const found = await ports.slots(state.ref, state.relationshipId, call);
    if (found.outcome === "REFUSED" && isCalendarBlock(found.code)) {
      return parkOnCalendar(state, found.code);
    }
    if (found.outcome !== "OK") {
      await ports.notify(state.ref, {
        key: `slots-refused:${state.laneId}:${found.code}`,
        title: `Q can't see your calendar to book ${state.counterpartName}`,
        body:
          found.code === "CALENDAR_NOT_CONNECTED"
            ? "Connect Google Calendar in Settings and Q will offer times."
            : "Q will try again shortly.",
        link: "/settings",
        priority: "NEEDS_YOU",
      });
      return { waiting: true };
    }
    const first = found.slots[0];
    if (
      call.mayBookInWindows &&
      state.grant.interview === null &&
      first !== undefined
    ) {
      return book(state, "auto", first.start);
    }
    const offered = found.slots.slice(0, 3);
    await label(
      state,
      "NEEDS_TIMES",
      offered.length === 0
        ? "No free time in your windows; tell Q a time."
        : "Waiting for you to pick a time.",
      { needs: { kind: "TIMES", offered } },
    );
    await ports.notify(state.ref, {
      key: `times:${state.laneId}:${String(state.bookings)}`,
      title: `Which time works for your call with ${state.counterpartName}?`,
      body:
        offered.length === 0
          ? "Nothing is free in your windows. Tell Q a time."
          : offered.map((slot) => slot.label).join("\n"),
      link: workPathOf(state),
      priority: "NEEDS_YOU",
    });
    return { phase: "DECIDE", waiting: true };
  };

  // --- DECIDE: the person's word, and the conversation carrying on ----------
  const decide = async (state: LaneState): Promise<Update> => {
    const obs = state.obs;
    if (obs === null) return { waiting: true };
    const answer = obs.answer;
    if (answer !== null && !state.answersHandled.includes(answer.id)) {
      const handled = [...state.answersHandled, answer.id].slice(-20);
      if (answer.kind === "PASS") {
        const done = await end(state, "DONE", "You passed; Q stopped here.");
        return { ...done, answersHandled: handled };
      }
      const booked = await book(
        { ...state, answersHandled: handled },
        `answer:${answer.id}`,
        answer.at,
      );
      return { ...booked, answersHandled: handled };
    }
    const talk = await converse(state, obs, false);
    return { ...(talk ?? {}), waiting: true };
  };

  const PHASE_NODE = {
    ACCEPTANCE: "acceptance_step",
    CHAT: "chat_step",
    INTERVIEW: "interview_step",
    REPORT: "report_step",
    TIMES: "times_step",
    DECIDE: "decide_step",
  } as const;

  const route = (state: LaneState) => {
    if (state.phase === "END") return END;
    if (state.waiting) return "wait_step";
    return PHASE_NODE[state.phase];
  };
  const afterGate = (state: LaneState) =>
    state.phase === "END" || state.waiting
      ? route(state)
      : PHASE_NODE[state.phase];
  const targets = {
    wait_step: "wait_step",
    acceptance_step: "acceptance_step",
    chat_step: "chat_step",
    interview_step: "interview_step",
    report_step: "report_step",
    times_step: "times_step",
    decide_step: "decide_step",
    [END]: END,
  } as const;

  return new StateGraph(LaneAnnotation)
    .addNode("wait_step", wait)
    .addNode("gate_step", gate)
    .addNode("acceptance_step", acceptance)
    .addNode("chat_step", chat)
    .addNode("interview_step", interview)
    .addNode("report_step", report)
    .addNode("times_step", times)
    .addNode("decide_step", decide)
    .addEdge(START, "wait_step")
    .addEdge("wait_step", "gate_step")
    .addConditionalEdges("gate_step", afterGate, targets)
    .addConditionalEdges("acceptance_step", route, targets)
    .addConditionalEdges("chat_step", route, targets)
    .addConditionalEdges("interview_step", route, targets)
    .addConditionalEdges("report_step", route, targets)
    .addConditionalEdges("times_step", route, targets)
    .addConditionalEdges("decide_step", route, targets)
    .compile({ checkpointer: saver });
}
