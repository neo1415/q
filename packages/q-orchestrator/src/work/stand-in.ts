import {
  Annotation,
  END,
  START,
  StateGraph,
  interrupt,
  type BaseCheckpointSaver,
} from "@langchain/langgraph";

import {
  Q2Q_DAILY_CAP,
  type DelegationRef,
  type QEnvelope,
  type QWorkPorts,
  type StandInGrant,
  type StandInObservation,
} from "./types.js";
import { threadText } from "./thread-text.js";

/**
 * A founder's stand-in (ADR 0030): while they are away, Q answers
 * investors' new messages from the brief they approved and nothing else,
 * marked as Q; what the brief does not answer waits for them. When they
 * come back, Q hands every thread back and tells them what happened.
 *
 *   wait ⇄ stand-in step   (until stopped or expired)
 */

type Answered = {
  readonly counterpartName: string;
  readonly chatPath: string;
  readonly laneId: string;
  readonly count: number;
  readonly deferred: number;
};

export type StandInState = {
  ref: DelegationRef;
  grant: StandInGrant;
  obs: StandInObservation | null;
  away: boolean;
  awaySince: string | null;
  /** Per relationship: newest other-side message Q has handled. */
  cursors: Readonly<Record<string, string>>;
  answered: Readonly<Record<string, Answered>>;
  repliesThisAway: number;
  done: boolean;
};

const replace = <T>(initial: () => T) =>
  Annotation<T>({ reducer: (_left, right) => right, default: initial });

export const StandInAnnotation = Annotation.Root({
  ref: Annotation<DelegationRef>,
  grant: Annotation<StandInGrant>,
  obs: replace<StandInObservation | null>(() => null),
  away: replace<boolean>(() => false),
  awaySince: replace<string | null>(() => null),
  cursors: replace<Readonly<Record<string, string>>>(() => ({})),
  answered: replace<Readonly<Record<string, Answered>>>(() => ({})),
  repliesThisAway: replace<number>(() => 0),
  done: replace<boolean>(() => false),
});

/** Replies in one absence before Q stops and waits for the founder. */
export const MAX_STAND_IN_REPLIES = 20;

const ENVELOPE = (intent: QEnvelope["intent"]): QEnvelope => ({
  protocol: "cq.q2q/1",
  side: "COMPANY",
  intent,
});

export function buildStandInGraph(
  ports: QWorkPorts,
  saver: BaseCheckpointSaver,
) {
  type Update = Partial<StandInState>;

  const wait = (): Update => {
    const obs = interrupt<{ waiting: true }, StandInObservation>({
      waiting: true,
    });
    return { obs };
  };

  const handBack = async (state: StandInState): Promise<void> => {
    const threads = Object.entries(state.answered);
    if (threads.length === 0) return;
    const total = threads.reduce((sum, [, item]) => sum + item.count, 0);
    const deferred = threads.reduce((sum, [, item]) => sum + item.deferred, 0);
    const stamp = state.awaySince ?? "";
    for (const [relationshipId, item] of threads) {
      await ports.post(
        state.ref,
        relationshipId,
        `handback:${stamp}`,
        `${state.ref.principalName} is back, so I'm handing this conversation back to them.`,
        ENVELOPE("HANDBACK"),
      );
      await ports.updateLane(item.laneId, {
        lastStep: `Handed back to you after ${String(item.count)} ${item.count === 1 ? "reply" : "replies"}.`,
      });
    }
    await ports.step(
      state.ref,
      null,
      `handback:${stamp}`,
      `You came back; Q handed ${String(threads.length)} ${threads.length === 1 ? "conversation" : "conversations"} back.`,
    );
    await ports.notify(state.ref, {
      key: `handback:${stamp}`,
      title: `While you were away, Q answered ${String(total)} ${total === 1 ? "message" : "messages"}`,
      body: `${threads.map(([, item]) => item.counterpartName).join(", ")}.${deferred > 0 ? ` ${String(deferred)} ${deferred === 1 ? "question is" : "questions are"} waiting for you.` : ""}`.slice(
        0,
        1_000,
      ),
      link: threads[0]?.[1].chatPath ?? null,
      priority: deferred > 0 ? "NEEDS_YOU" : "UPDATE",
    });
  };

  const step = async (state: StandInState): Promise<Update> => {
    const obs = state.obs;
    if (obs === null) return {};
    if (obs.status !== "ACTIVE" || obs.access !== "OK") {
      if (state.away) await handBack(state);
      const words =
        obs.status === "STOPPED"
          ? "You stopped Q standing in."
          : obs.status === "EXPIRED"
            ? "The stand-in period you approved is over."
            : "Your access changed, so Q stopped standing in.";
      if (obs.status !== "STOPPED") {
        await ports.notify(state.ref, {
          key: `standin-end:${obs.status}`,
          title: "Q stopped standing in for you",
          body: words,
          link: "/work",
          priority: "UPDATE",
        });
      }
      await ports.finishDelegation(
        state.ref,
        obs.status === "ACTIVE" ? "STOPPED" : obs.status,
        words,
      );
      return { done: true };
    }

    if (!obs.away) {
      if (!state.away) return {};
      await handBack(state);
      await ports.summarise(state.ref, "You're here; Q is ready to step in.");
      return {
        away: false,
        awaySince: null,
        answered: {},
        repliesThisAway: 0,
      };
    }

    const awaySince = state.awaySince ?? obs.now;
    const defaultSince = new Date(
      Date.parse(awaySince) - state.grant.awayAfterMinutes * 60_000,
    ).toISOString();
    const cursors: Record<string, string> = { ...state.cursors };
    const answered: Record<string, Answered> = { ...state.answered };
    let replies = state.repliesThisAway;

    for (const thread of obs.threads) {
      const since = Date.parse(cursors[thread.relationshipId] ?? defaultSince);
      const last = thread.messages.at(-1);
      // The founder (or their side) wrote last: nothing is waiting.
      if (last === undefined || last.from !== "OTHER_SIDE") continue;
      if (Date.parse(last.at) <= since) continue;
      const previousCursor = cursors[thread.relationshipId];
      cursors[thread.relationshipId] = last.at;
      const otherSideIsQ = last.envelope !== null;
      // Q-to-Q: answer another Q only when it asks, within the daily cap.
      if (otherSideIsQ && last.envelope?.intent !== "ASK") continue;
      if (otherSideIsQ && thread.q2qLastDay >= Q2Q_DAILY_CAP) continue;
      if (replies >= MAX_STAND_IN_REPLIES) continue;
      const result = await ports.standInReply(state.ref, {
        principalName: state.ref.principalName,
        counterpartName: thread.counterpartName,
        brief: state.grant.brief,
        thread: threadText(thread.messages, state.ref.principalName),
        otherSideIsQ,
      });
      if (result === null) {
        // No words this time: read it again next time.
        if (previousCursor === undefined) {
          delete cursors[thread.relationshipId];
        } else {
          cursors[thread.relationshipId] = previousCursor;
        }
        continue;
      }
      const laneId =
        answered[thread.relationshipId]?.laneId ??
        (await ports.standInLane(
          state.ref,
          thread.relationshipId,
          thread.counterpartName,
        ));
      let sent = false;
      if (result.reply !== null) {
        sent = await ports.post(
          state.ref,
          thread.relationshipId,
          `standin:${last.id}`,
          result.reply,
          ENVELOPE(result.deferred ? "DEFER" : "ANSWER"),
        );
      }
      if (sent) replies += 1;
      const previous = answered[thread.relationshipId];
      const item: Answered = {
        counterpartName: thread.counterpartName,
        chatPath: thread.chatPath,
        laneId,
        count: (previous?.count ?? 0) + (sent ? 1 : 0),
        deferred:
          (previous?.deferred ?? 0) + (result.forPerson.length > 0 ? 1 : 0),
      };
      answered[thread.relationshipId] = item;
      await ports.updateLane(laneId, {
        stage: "STANDING_IN",
        repliesSent: item.count,
        lastStep: `Q answered ${thread.counterpartName} while you were away.`,
      });
      if (result.forPerson.length > 0) {
        await ports.notify(state.ref, {
          key: `standin-ask:${last.id}`,
          title: `${thread.counterpartName} asked something only you can answer`,
          body: result.forPerson.join("\n").slice(0, 1_000),
          link: thread.chatPath,
          priority: "NEEDS_YOU",
        });
      }
    }
    if (!state.away) {
      await ports.step(
        state.ref,
        null,
        `away:${awaySince}`,
        "You're away; Q is answering investors from your brief.",
      );
      await ports.summarise(
        state.ref,
        "You're away; Q is answering from your brief.",
      );
    }
    return {
      away: true,
      awaySince,
      cursors,
      answered,
      repliesThisAway: replies,
    };
  };

  const route = (state: StandInState) => (state.done ? END : "wait_step");

  return new StateGraph(StandInAnnotation)
    .addNode("wait_step", wait)
    .addNode("standin_step", step)
    .addEdge(START, "wait_step")
    .addEdge("wait_step", "standin_step")
    .addConditionalEdges("standin_step", route, {
      wait_step: "wait_step",
      [END]: END,
    })
    .compile({ checkpointer: saver });
}
