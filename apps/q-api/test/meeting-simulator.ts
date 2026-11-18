import { vi } from "vitest";

import {
  buildMeetingSnapshot,
  type HostParty,
  type MeetingContextSnapshot,
  type MeetingEvent,
  type RosterEntry,
  type SnapshotFact,
} from "@capital-q/communication";
import type { TavusClient } from "@capital-q/integrations";
import type { MeetingHostResultV3 as MeetingHostResult } from "@capital-q/q-core";

import type { MeetingEventStore } from "../src/composition/meeting-events.js";
import {
  createMeetingFace,
  type MeetingBridgeResult,
  type MeetingFaceMode,
  type MeetingFaceStore,
} from "../src/composition/meeting-face.js";
import {
  createMeetingHostRuntime,
  type MeetingHostComposer,
  type MeetingHostStore,
} from "../src/composition/meeting-host-runtime.js";
import { createSpokenLineReader } from "../src/composition/meeting-host-speech.js";
import { createMeetingScreenVision } from "../src/composition/meeting-screen-vision.js";
import type { MeetingSnapshotContext } from "../src/composition/meeting-snapshot.js";
import { botRequest, endOf, stateOf } from "../src/composition/recall-bots.js";

/**
 * Meeting simulator (2026-11-18, docs/specs/meetings/2026-11-18-meetings-design.md).
 *
 * Replays a scripted meeting through the REAL meeting pipeline -- the host
 * runtime, the host's turn policy, the meeting memory, the context
 * snapshot, the face service (bridge included), screen vision and the
 * Recall bot request/status readers -- with every provider faked at its
 * boundary:
 *
 *   - Recall: the create-bot body is built by the real `botRequest` and
 *     captured; admission is a scripted lobby (status codes read by the
 *     real `stateOf`/`endOf`); realtime events are Recall's own payload
 *     shapes, delivered only once the bot is in the call, as Recall does.
 *   - The model: a scripted composer (answers keyed by the question) that
 *     streams its JSON like the gateway, first token and full reply on
 *     fixed delays.
 *   - Tavus: a fake client (no network); the face's turns are driven like
 *     Tavus' own turn detector, calling the real bridge after each person's
 *     turn ends, with what Tavus' speech-to-text heard.
 *   - ElevenLabs/Recall output audio: captured lines.
 *
 * One fake clock drives everything; nothing reaches a network, a database
 * or a model. No real people, no paid calls.
 */

export const SIM_SECRET = "recall-key-for-tests-0000000000000000";
const STEP_MS = 50;
const WORD_MS = 330;
const PARTIAL_EVERY_MS = 300;
const PARTIAL_LAG_MS = 300;
const FLAG_OFF_MS = 300;
const FINAL_CAPTION_MS = 1_000;
/** Tavus' turn detector ends a person's turn about this long after their last word. */
const TAVUS_TURN_MS = 700;
const FIRST_TOKEN_MS = 600;
const MODEL_DONE_MS = 1_800;
/** In MEET mode the face is a second Meet participant; it knocks this long. */
const FACE_KNOCK_MS = 4_000;
const BOT_NAME = "Q (Capital Q notes)";
/** What Meet showed for the Tavus face (live 2026-10-21). */
const FACE_CALL_NAME = "PAL AI";

export type SimFace = "NONE" | MeetingFaceMode;

export type SimStep =
  | { readonly at: number; readonly kind: "JOIN"; readonly who: string }
  | { readonly at: number; readonly kind: "LEAVE"; readonly who: string }
  | {
      readonly at: number;
      readonly kind: "SAY";
      readonly who: string;
      readonly text: string;
      /** What Tavus' own speech-to-text heard, when it differs (e.g. "Cue" for "Q"). */
      readonly tavusHears?: string;
      /** Meet's speaking flag never drops (an open microphone). */
      readonly openMic?: boolean;
    }
  | {
      readonly at: number;
      readonly kind: "SCREEN";
      readonly who: string;
      /** One frame per entry, 1 s apart (Recall streams 2 fps; the watch dedupes). */
      readonly frames: readonly string[];
    };

export type SimScenario = {
  readonly name: string;
  readonly meetingId: string;
  readonly purpose: string;
  readonly startsAt: string;
  readonly minutes: number;
  /** Who organised it; must be one of the parties' user ids. */
  readonly organiserUserId: string;
  readonly parties: readonly HostParty[];
  /** Earlier held meetings in this relationship (the history both sides see). */
  readonly priorMeetings: number;
  readonly snapshot: {
    readonly shared: readonly SnapshotFact[];
    readonly disclosed: readonly SnapshotFact[];
    readonly founderPrivate: readonly SnapshotFact[];
    readonly investorPrivate: readonly SnapshotFact[];
  };
  readonly face: SimFace;
  readonly screens: boolean;
  /** When the organiser lets Q in from the lobby (ms from the start); null: nobody does. */
  readonly admittedAt: number | null;
  /** Recall's waiting-room timeout for this bot. */
  readonly lobbyTimeoutMs: number;
  /** The model's scripted answers: the first whose pattern matches the question. */
  readonly answers: readonly { readonly when: RegExp; readonly line: string }[];
  readonly steps: readonly SimStep[];
  /** How long after the last step to keep the clock running. */
  readonly tailMs?: number;
};

export type SpokenLine = {
  readonly at: number;
  readonly channel: "VOICE" | "FACE";
  readonly text: string;
  /** HOST: decided by Q's host; PROVIDER_GREETING: Tavus' own join greeting. */
  readonly source: "HOST" | "PROVIDER_GREETING";
};

export type BridgeTurn = {
  readonly at: number;
  readonly heard: string;
  readonly result: MeetingBridgeResult["kind"];
  readonly said: string;
  readonly resolvedAt: number;
};

export type SimResult = {
  readonly scenario: SimScenario;
  /** The create-bot body Recall would receive. */
  readonly botRequest: Record<string, unknown>;
  readonly admission: {
    readonly state: string;
    readonly end: string | null;
    readonly admittedAt: number | null;
  };
  /** Every Capital Q identity that became a call participant, in order. */
  readonly qParticipants: readonly string[];
  /** Lines Q's host handed to the bot's voice or to the face. */
  readonly spoken: readonly SpokenLine[];
  /**
   * What the people in the call actually heard from Q: the bot's voice,
   * the face's provider greeting, and what the face said on its turns (a
   * line handed to the face is heard only when Tavus takes a turn).
   */
  readonly audible: readonly { readonly at: number; readonly text: string }[];
  readonly bridgeTurns: readonly BridgeTurn[];
  readonly modelCalls: readonly {
    readonly at: number;
    readonly utterance: string;
    readonly prepared: string;
    readonly memory: string;
  }[];
  readonly events: readonly MeetingEvent[];
  readonly roster: readonly RosterEntry[];
  readonly notes: readonly {
    readonly kind: string;
    readonly body: string | null;
  }[];
  readonly screenNotes: readonly string[];
  readonly faceCalls: readonly string[];
  readonly logs: readonly string[];
  /** Per SAY step: when its last word was said (ms from the start). */
  readonly lastWordAt: ReadonlyMap<SimStep, number>;
  /** Q's first spoken words after a step's last word that come from `answer`. */
  readonly answerLatency: (step: SimStep, answer: string) => number | null;
};

function words(text: string): string[] {
  return text.split(/\s+/u).filter((w) => w.length > 0);
}

/** Runs one scenario on a fake clock and returns everything it produced. */
export async function simulateMeeting(
  scenario: SimScenario,
): Promise<SimResult> {
  const start = Date.parse(scenario.startsAt);
  const clock = { at: start - 5 * 60_000 };
  const ids = new Map<string, number>();
  const idOf = (name: string) => {
    let id = ids.get(name);
    if (id === undefined) {
      id = 100 + ids.size;
      ids.set(name, id);
    }
    return id;
  };
  const BOT = `bot-${scenario.meetingId.slice(0, 8)}`;

  const spoken: SpokenLine[] = [];
  const bridgeTurns: BridgeTurn[] = [];
  const modelCalls: {
    at: number;
    utterance: string;
    prepared: string;
    memory: string;
  }[] = [];
  const events: MeetingEvent[] = [];
  const roster: RosterEntry[] = [];
  const notes: { kind: string; body: string | null }[] = [];
  const screenNotes: string[] = [];
  const faceCalls: string[] = [];
  const logs: string[] = [];
  const qParticipants: string[] = [];
  const logger = {
    info: (fields: Record<string, unknown>, message: string) => {
      logs.push(`${message} ${JSON.stringify(fields)}`);
    },
    warn: (fields: Record<string, unknown>, message: string) => {
      logs.push(`WARN ${message} ${JSON.stringify(fields)}`);
    },
  };

  // --- Recall: the create-bot body, built by the real code. ---------------
  const request = botRequest({
    meetingUrl: "https://meet.google.com/sim-ulat-ion",
    joinAt: new Date(start),
    botName: BOT_NAME,
    hosting: {
      realtimeUrl:
        "https://q-api.example/v1/integrations/recall/meeting-host?sim",
      aloneLeaveMs: scenario.lobbyTimeoutMs,
      maxCallMs: scenario.minutes * 60_000 * 2,
      metadata: { meeting_id: scenario.meetingId },
      ...(scenario.screens ? { visionUrl: "wss://q-api.example/ws?sim" } : {}),
    },
  });

  // --- The model: scripted, streamed like the gateway. --------------------
  const pending: {
    readonly startedAt: number;
    readonly fragments: string[];
    readonly result: MeetingHostResult;
    sent: number;
    readonly feed: ((fragment: string) => void) | undefined;
    readonly resolve: (result: MeetingHostResult) => void;
  }[] = [];
  const composer: MeetingHostComposer = {
    turn: (_who, variables, _images, stream) => {
      const result: MeetingHostResult =
        variables.mode === "GUEST"
          ? {
              kind: "GUEST",
              line: "",
              proposal: null,
              guest: { name: null, role: null, organisation: null },
            }
          : {
              kind: "ANSWER",
              line:
                scenario.answers.find((a) => a.when.test(variables.utterance))
                  ?.line ??
                "I don't have that from what this meeting has shared.",
              proposal: null,
              guest: null,
            };
      if (variables.mode !== "GUEST") {
        modelCalls.push({
          at: clock.at - start,
          utterance: variables.utterance,
          prepared: variables.prepared ?? "",
          memory: variables.memory ?? "",
        });
      }
      const raw = JSON.stringify(result);
      const fragments: string[] = [];
      for (let i = 0; i < raw.length; i += 7)
        fragments.push(raw.slice(i, i + 7));
      const reader =
        stream === undefined
          ? undefined
          : createSpokenLineReader(stream.onFirstPiece);
      return new Promise((resolve) => {
        pending.push({
          startedAt: clock.at,
          fragments,
          result,
          sent: 0,
          feed: reader?.feed,
          resolve,
        });
      });
    },
  };

  // --- Snapshot sources: the scenario's facts through the real builder. ---
  const snapshotContext: MeetingSnapshotContext = {
    meetingId: scenario.meetingId,
    purpose: scenario.purpose,
    startsAt: new Date(start),
    endsAt: new Date(start + scenario.minutes * 60_000),
    parties: scenario.parties,
    companyId: "c-sim",
    organisationIdOf: () => null,
  };
  const snapshots = (): Promise<MeetingContextSnapshot> =>
    buildMeetingSnapshot({
      meetingId: scenario.meetingId,
      now: () => new Date(clock.at),
      sources: {
        shared: () =>
          Promise.resolve({
            agenda: scenario.purpose,
            participants: scenario.parties.map((p) => ({
              userId: p.userId,
              name: p.name,
              role: null,
              side: p.side,
              organisation: p.organisation,
            })),
            facts: scenario.snapshot.shared,
          }),
        disclosed: () => Promise.resolve(scenario.snapshot.disclosed),
        founderPrivate: () => Promise.resolve(scenario.snapshot.founderPrivate),
        investorPrivate: () =>
          Promise.resolve(scenario.snapshot.investorPrivate),
      },
    });

  const store: MeetingHostStore = {
    context: () =>
      Promise.resolve({
        meetingId: scenario.meetingId,
        purpose: scenario.purpose,
        startsAt: new Date(start),
        endsAt: new Date(start + scenario.minutes * 60_000),
        parties: scenario.parties,
        seesScreens: scenario.screens,
        botId: BOT,
        tenantId: "t-sim",
        organiserUserId: scenario.organiserUserId,
        declined: false,
      }),
    snapshotContext: () => Promise.resolve(snapshotContext),
    roster: (_m, _t, entry) => {
      roster.push(entry);
      return Promise.resolve();
    },
    removedBy: () => Promise.resolve(),
    note: (_m, _t, note) => {
      notes.push({ kind: note.kind, body: note.body });
      return Promise.resolve();
    },
  };
  const eventStore: MeetingEventStore = {
    append: (_tenant, event) => {
      events.push(event);
      return Promise.resolve();
    },
    nextSeq: () => Promise.resolve(1),
  };

  // --- Tavus: the real face service over a fake client. -------------------
  const deliveries: [number, unknown][] = [];
  /** Adds a delivery in time order (a provider's own events arrive mid-run). */
  const deliver = (at: number, body: unknown) => {
    let i = deliveries.length;
    while (i > 0 && (deliveries[i - 1]?.[0] ?? 0) > at) i -= 1;
    deliveries.splice(i, 0, [at, body]);
  };
  let bridgeSession: { id: string; token: string } | null = null;
  const fakeTavus: TavusClient = {
    createPal: (input) => {
      faceCalls.push("createPal");
      const match = /\/([^/]+)$/u.exec(input.layers.llm.base_url);
      bridgeSession = {
        id: match?.[1] ?? "",
        token: input.layers.llm.api_key,
      };
      return Promise.resolve({ palId: "pal-sim" });
    },
    deletePal: () => {
      faceCalls.push("deletePal");
      return Promise.resolve();
    },
    createConversation: () => Promise.reject(new Error("not in a meeting")),
    joinMeeting: (input) => {
      faceCalls.push("joinMeeting");
      // A second Meet participant: it knocks, is admitted, then greets.
      const at = clock.at - start + FACE_KNOCK_MS;
      deliver(at, recall("participant_events.join", FACE_CALL_NAME));
      deliver(at, { kind: "FACE_GREETING", text: input.greeting ?? "" });
      return Promise.resolve({
        conversationId: "conv-sim",
        conversationUrl: null,
        status: "active",
      });
    },
    createMeetingRoom: (input) => {
      faceCalls.push("createMeetingRoom");
      deliver(clock.at - start + 1_000, {
        kind: "FACE_GREETING",
        text: input.greeting ?? "",
      });
      return Promise.resolve({
        conversationId: "conv-sim",
        conversationUrl: "https://tavus.daily.co/sim",
        status: "active",
        meetingToken: "room-token-sim",
      });
    },
    findConversationsForPal: () => Promise.resolve([]),
    endConversation: () => {
      faceCalls.push("endConversation");
      return Promise.resolve();
    },
    getConversation: () => Promise.reject(new Error("not used")),
    listVoices: () => Promise.resolve([]),
    listStockFaces: () => Promise.resolve([]),
  };
  const organiser = scenario.parties.find(
    (p) => p.userId === scenario.organiserUserId,
  );
  const faceStore: MeetingFaceStore = {
    meeting: () =>
      Promise.resolve({
        tenantId: "t-sim",
        organiserUserId: scenario.organiserUserId,
        meetLink: "https://meet.google.com/sim-ulat-ion",
        organiserName: organiser?.name ?? null,
        purpose: scenario.purpose,
        startsAt: new Date(start),
      }),
    claim: () => Promise.resolve(true),
    requested: () => Promise.resolve(),
    live: () => Promise.resolve(),
    finish: () => Promise.resolve(),
    open: () => Promise.resolve([]),
  };
  const face =
    scenario.face === "NONE"
      ? undefined
      : createMeetingFace({
          enabled: true,
          client: fakeTavus,
          faceId: "r4f5b5ef55c8",
          maxSeconds: 600,
          publicBaseUrl: "https://q-api.example",
          bridgePath: (id) => `/v1/q/meetings/face/bridge/${id}`,
          store: faceStore,
          now: () => clock.at,
          mode: scenario.face,
          logger,
        });

  // --- Screen vision: the real watch over a fake noter. -------------------
  const vision = createMeetingScreenVision({
    enabled: scenario.screens,
    publicBase: "https://q-api.example",
    secret: SIM_SECRET,
    store: {
      context: () =>
        Promise.resolve({
          tenantId: "t-sim",
          ownerUserId: scenario.organiserUserId,
          meetingText: `Purpose: ${scenario.purpose}`,
          declined: false,
        }),
      observe: (input) => {
        screenNotes.push(`${input.sharedByName}: ${input.body}`);
        return Promise.resolve();
      },
    },
    noter: {
      note: (_who, _variables, png) =>
        Promise.resolve({
          worthNoting: true,
          shows: `Shared screen showing ${png}`,
          take: "Unverified figures; ask for the source.",
        }),
    },
    now: () => clock.at,
  });

  const runtime = createMeetingHostRuntime({
    enabled: true,
    publicBase: "https://q-api.example",
    secret: SIM_SECRET,
    store,
    composer,
    snapshots,
    events: eventStore,
    voice: {
      speak: (text) => {
        spoken.push({
          at: clock.at - start,
          channel: "VOICE",
          text,
          source: "HOST",
        });
        return Promise.resolve(new Uint8Array([1, 2, 3]));
      },
      play: () => Promise.resolve(),
      leave: () => Promise.resolve(),
      stop: () => Promise.resolve(),
    },
    ...(face === undefined
      ? {}
      : {
          face: {
            ...face,
            // Captured as well as passed on: what the host handed the face.
            say: (meetingId: string, text: string, more?: boolean) => {
              spoken.push({
                at: clock.at - start,
                channel: "FACE",
                text,
                source: "HOST",
              });
              face.say(meetingId, text, more);
            },
          },
        }),
    seesScreens: scenario.screens,
    sight: { seen: vision.seen, frames: vision.frames },
    now: () => clock.at,
    tickEveryMs: null,
    wakeTimers: true,
    leaveDelayMs: 0,
    logger,
  });

  function recall(kind: string, who: string, text?: string) {
    return {
      event: kind,
      data: {
        data: {
          participant: { id: idOf(who), name: who, email: null },
          ...(text === undefined
            ? {}
            : { words: words(text).map((w) => ({ text: w })) }),
        },
        bot: { id: BOT },
      },
    };
  }

  // --- The script, as Recall would deliver it. ----------------------------
  const lastWordAt = new Map<SimStep, number>();
  const tavusTurns: { at: number; heard: string }[] = [];
  const present = new Set<string>();
  const admitted = scenario.admittedAt;
  const lobbyEnds = scenario.lobbyTimeoutMs;
  const statusCodes: string[] = ["joining_call", "in_waiting_room"];
  const subCodes: (string | null)[] = [null, null];
  for (const step of scenario.steps) {
    switch (step.kind) {
      case "JOIN":
        deliveries.push([step.at, recall("participant_events.join", step.who)]);
        break;
      case "LEAVE":
        deliveries.push([
          step.at,
          recall("participant_events.leave", step.who),
        ]);
        break;
      case "SCREEN":
        step.frames.forEach((buffer, i) => {
          deliveries.push([
            step.at + i * 1_000,
            {
              kind: "FRAME",
              text: JSON.stringify({
                event: "video_separate_png.data",
                data: {
                  data: {
                    buffer,
                    type: "screenshare",
                    participant: { id: idOf(step.who), name: step.who },
                  },
                },
              }),
            },
          ]);
        });
        break;
      case "SAY": {
        const said = words(step.text);
        const last = step.at + (said.length - 1) * WORD_MS;
        lastWordAt.set(step, last);
        deliveries.push([
          step.at,
          recall("participant_events.speech_on", step.who),
        ]);
        for (let t = step.at; t <= last; t += PARTIAL_EVERY_MS) {
          const count = Math.min(
            said.length,
            1 + Math.floor((t - step.at) / WORD_MS),
          );
          deliveries.push([
            t + PARTIAL_LAG_MS,
            recall(
              "transcript.partial_data",
              step.who,
              said.slice(0, count).join(" "),
            ),
          ]);
        }
        deliveries.push([
          last + PARTIAL_LAG_MS,
          recall("transcript.partial_data", step.who, step.text),
        ]);
        if (step.openMic !== true) {
          deliveries.push([
            last + FLAG_OFF_MS,
            recall("participant_events.speech_off", step.who),
          ]);
        }
        deliveries.push([
          last + FINAL_CAPTION_MS,
          recall("transcript.data", step.who, step.text),
        ]);
        tavusTurns.push({
          at: last + TAVUS_TURN_MS,
          heard: step.tavusHears ?? step.text,
        });
        break;
      }
    }
  }
  deliveries.sort((a, b) => a[0] - b[0]);

  const lastStep = Math.max(
    ...scenario.steps.map((s) => lastWordAt.get(s) ?? s.at),
  );
  const until = lastStep + (scenario.tailMs ?? 15_000);
  const tavusHeard: string[] = [];
  let inCall = false;
  let gaveUp = false;
  const held: [number, unknown][] = [];

  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  try {
    // The bot is created ahead of the call; the snapshot is prepared then.
    void runtime.prepare(scenario.meetingId);
    for (let t = -60_000; t <= until; t += STEP_MS) {
      clock.at = start + t;
      vi.advanceTimersByTime(STEP_MS);
      // Admission: Recall streams nothing until the bot is in the call.
      if (!inCall && !gaveUp) {
        if (admitted !== null && t >= admitted) {
          inCall = true;
          statusCodes.push("in_call_not_recording", "in_call_recording");
          subCodes.push(null, null);
          qParticipants.push(BOT_NAME);
          // Recall reports Q itself, then everyone already present.
          void runtime.receive(
            scenario.meetingId,
            recall("participant_events.join", BOT_NAME),
          );
          for (const [, body] of held.splice(0)) {
            void runtime.receive(scenario.meetingId, body);
          }
        } else if (t >= lobbyEnds) {
          gaveUp = true;
          statusCodes.push("call_ended");
          subCodes.push("timeout_exceeded_waiting_room");
        }
      }
      while (deliveries.length > 0 && (deliveries[0]?.[0] ?? Infinity) <= t) {
        const next = deliveries.shift();
        if (next === undefined) break;
        const body = next[1] as {
          kind?: string;
          text?: string;
          event?: string;
        };
        if (body.kind === "FACE_GREETING") {
          spoken.push({
            at: t,
            channel: "FACE",
            text: body.text ?? "",
            source: "PROVIDER_GREETING",
          });
          continue;
        }
        if (body.kind === "FRAME") {
          if (inCall) vision.receive(scenario.meetingId, body.text ?? "");
          continue;
        }
        if (body.event === "participant_events.join") {
          const name = (next[1] as ReturnType<typeof recall>).data.data
            .participant.name;
          if (name === FACE_CALL_NAME) qParticipants.push(name);
          present.add(name);
        }
        if (!inCall) {
          // Joins and leaves before Q is in are reported when it arrives.
          if (
            body.event?.startsWith("participant_events.") === true &&
            !body.event.startsWith("participant_events.speech")
          ) {
            held.push(next);
          }
          continue;
        }
        void runtime.receive(scenario.meetingId, next[1]);
      }
      // Tavus' own turn detector: it asks the bridge after each turn.
      while (tavusTurns.length > 0 && (tavusTurns[0]?.at ?? Infinity) <= t) {
        const turn = tavusTurns.shift();
        if (turn === undefined) break;
        tavusHeard.push(turn.heard);
        const session = bridgeSession as { id: string; token: string } | null;
        if (face === undefined || session === null || !inCall) continue;
        const at = t;
        const controller = new AbortController();
        void face
          .bridge(
            session.id,
            session.token,
            tavusHeard.map((text) => ({ role: "user", text })),
            controller.signal,
          )
          .then(async (result) => {
            // The face starts speaking when the bridge first answers.
            const resolvedAt = clock.at - start;
            let said = "";
            if (result.kind === "LINE") said = result.text;
            if (result.kind === "STREAM") {
              said = result.first;
              for await (const part of result.rest) said += ` ${part}`;
            }
            bridgeTurns.push({
              at,
              heard: turn.heard,
              result: result.kind,
              said,
              resolvedAt,
            });
          });
      }
      // The model's stream.
      for (const call of [...pending]) {
        const elapsed = clock.at - call.startedAt;
        if (elapsed >= FIRST_TOKEN_MS && call.feed !== undefined) {
          const share = Math.min(
            1,
            (elapsed - FIRST_TOKEN_MS) / (MODEL_DONE_MS - FIRST_TOKEN_MS),
          );
          const due = Math.max(1, Math.ceil(share * call.fragments.length));
          while (call.sent < due) {
            call.feed(call.fragments[call.sent] ?? "");
            call.sent += 1;
          }
        }
        if (elapsed >= MODEL_DONE_MS) {
          pending.splice(pending.indexOf(call), 1);
          call.resolve(call.result);
        }
      }
      for (let i = 0; i < 5; i += 1) {
        await new Promise((done) => setImmediate(done));
      }
    }
    await vision.idle(scenario.meetingId);
  } finally {
    vi.useRealTimers();
  }

  const answerLatency = (step: SimStep, answer: string): number | null => {
    const heard = lastWordAt.get(step);
    if (heard === undefined) return null;
    const head = answer.slice(0, 20);
    const first = [
      ...spoken.filter(
        (l) =>
          l.channel === "VOICE" &&
          l.at >= heard &&
          answer.includes(l.text.slice(0, 20)),
      ),
      ...bridgeTurns
        .filter((b) => b.at >= heard && b.said.includes(head))
        .map((b) => ({ at: b.resolvedAt })),
    ].sort((a, b) => a.at - b.at)[0];
    return first === undefined ? null : first.at - heard;
  };

  return {
    scenario,
    botRequest: request,
    admission: {
      state: stateOf(statusCodes),
      end: gaveUp ? endOf(subCodes) : null,
      admittedAt: inCall ? admitted : null,
    },
    qParticipants,
    spoken,
    audible: [
      ...spoken
        .filter(
          (l) => l.channel === "VOICE" || l.source === "PROVIDER_GREETING",
        )
        .map((l) => ({ at: l.at, text: l.text })),
      ...bridgeTurns
        .filter((b) => b.said.length > 0)
        .map((b) => ({ at: b.resolvedAt, text: b.said })),
    ].sort((a, b) => a.at - b.at),
    bridgeTurns,
    modelCalls,
    events,
    roster,
    notes,
    screenNotes,
    faceCalls,
    logs,
    lastWordAt,
    answerLatency,
  };
}
