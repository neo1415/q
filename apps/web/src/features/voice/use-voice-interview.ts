"use client";

import { createContext, useCallback, useEffect, useRef, useState } from "react";

import type {
  CreateQVoiceSessionRequest,
  CreateQVoiceSessionResponse,
  QVoiceChoice,
  QVoiceTurnState,
} from "@capital-q/contracts";

import {
  readVoiceTurnAction,
  sendVoiceScreenAction,
  startVoiceSessionAction,
} from "./actions";
import { currentScreen, currentViewing } from "../q/screen";
import { announceQGestures } from "../q-swarm/q-gestures";
import { storeVoicePreference, useVoicePreference } from "./voice-preference";
import { deviceLocale } from "./device-locale";
import { useVoiceSession } from "./use-voice-session";
import {
  dropVoiceLine,
  endVoiceLine,
  openVoiceLine,
  type VoiceLineHolder,
} from "./voice-line";
import { IGNORED_NOTICE } from "./provider/duplex-notices";
import { LINE_LOST_NOTICE, RECONNECTING_NOTICE } from "./provider/line-health";
import type {
  VoiceSessionClient,
  VoiceSessionEvents,
  VoiceTranscriptLine,
  VoiceTurnOutcome,
} from "./session";

/**
 * Voice inside the interview (CQ-Q-VOICE-001 D §44, §51; E §67-§74).
 *
 * The session is Capital Q's: the credential is bound on the server to
 * the person and to the thread they are already in, so what they say
 * reaches the same onboarding session and the same Q conversation their
 * typing does. Switching voice ends the provider session and starts a
 * new one with the other voice; nothing about Q, the context or the
 * interview restarts, because none of it lived in the provider session.
 */

/** Ten-minute lines renewed in one conversation: an hour on one voice. */
const MAX_DUPLEX_RENEWALS = 6;

export type VoiceInterviewThread = {
  /** Q's first minute with a new person: no onboarding session yet. */
  readonly welcome?: true | undefined;
  readonly onboarding?: CreateQVoiceSessionRequest["onboarding"];
  readonly subjects?: CreateQVoiceSessionRequest["subjects"];
  readonly conversationId?: CreateQVoiceSessionRequest["conversationId"];
  readonly organisationHint?: CreateQVoiceSessionRequest["organisationHint"];
};

export type VoiceInterview = {
  readonly client: VoiceSessionClient;
  readonly active: boolean;
  readonly voice: QVoiceChoice;
  readonly notice: string | null;
  /**
   * The line is being repaired: "Reconnecting…" or "Weak connection:
   * switching to standard voice." Shown in `notice` too, so every surface
   * that shows a notice says it instead of going silent.
   */
  readonly linkStatus?: string | null | undefined;
  /** Start (or restart with a different voice). */
  readonly talk: (input: {
    readonly thread: VoiceInterviewThread;
    readonly firstMessage?: string | undefined;
    readonly voice?: QVoiceChoice | undefined;
    /**
     * The thread is already open: Q composes no opening of its own and
     * says `firstMessage` (a line already on screen), or nothing.
     */
    readonly resume?: boolean | undefined;
    /** DUPLEX: the standard line, even where full duplex is offered. */
    readonly duplex?: false | undefined;
    /**
     * The question Q is asking now, read each time a line (re)opens with
     * nothing of its own to say -- a fallback, a renewal, a reconnect -- so
     * Q speaks first instead of waiting for the person (founder live
     * 2026-10-05). Never a greeting: a reopened line does not welcome.
     */
    readonly lead?: (() => string | null | undefined) | undefined;
  }) => Promise<void>;
  readonly end: () => Promise<void>;
  readonly chooseVoice: (voice: QVoiceChoice) => Promise<void>;
  readonly clearNotice: () => void;
  /**
   * What Q is asking, and where it is taking the person, after its latest
   * turn; read from the server while talking. Nothing here is authority.
   */
  readonly turn: QVoiceTurnState | null;
};

/** How often the stage asks what Q is asking, while talking. */
const TURN_POLL_MS = 1_500;

/**
 * Coming back after a dropped line.
 *
 * Three tries, spaced further apart each time, then a plain sentence and
 * a stop. The previous rule was one attempt per thirty seconds with no
 * limit: a line that failed twice in a row left the person reading an
 * error for half a minute, and a line that failed forever retried
 * forever. Attempts reset the moment a session comes up, so an hour of
 * talking with one blip in it is not two blips away from giving up.
 */
const RECONNECT_DELAYS_MS = [1_200, 3_000, 8_000] as const;
/**
 * How long a line has to hold before a drop counts as a fresh blip.
 *
 * Not "the server issued a session": issuance succeeds even when the
 * provider fails on its first word, and resetting there retried such a
 * line forever — a new session, and a model call for its greeting, every
 * few seconds (seen live, 2026-09-24).
 */
const STABLE_LINE_MS = 20_000;
/** How long "switching to standard voice" stays once that voice is up. */
const LINK_STATUS_LINGER_MS = 4_000;
/** How long a turn's "not answered" sentence stays on screen (A4). */
const TURN_NOTICE_MS = 8_000;
/** A board outcome this recent already accounts for the watchdog's turn. */
const WATCHDOG_COVERED_MS = 16_000;
const GAVE_UP =
  "I couldn't get the line back. You can keep typing, or start voice again when you're ready.";

/** What the provider accepts as a first line. */
const GREETING_MAX = 700;

/**
 * The credential with the browser's own first line as the Deepgram
 * greeting, or with none. Only for a resumed thread: the server composed
 * no opening, and the line on screen is the one Q is already asking.
 */
function hasGreeting(credential: CreateQVoiceSessionResponse): boolean {
  const greeting: unknown = credential.deepgram?.agent.greeting;
  return typeof greeting === "string" && greeting.trim().length > 0;
}

function said(line: string | null | undefined): string | undefined {
  const trimmed = line?.trim() ?? "";
  return trimmed.length === 0 ? undefined : trimmed;
}

export function withGreeting(
  credential: CreateQVoiceSessionResponse,
  line: string | undefined,
): CreateQVoiceSessionResponse {
  const settings = credential.deepgram;
  if (settings === undefined) return credential;
  const agent = Object.fromEntries(
    Object.entries(settings.agent).filter(([key]) => key !== "greeting"),
  );
  const said = line?.trim().slice(0, GREETING_MAX) ?? "";
  return {
    ...credential,
    deepgram: {
      ...settings,
      agent: said.length === 0 ? agent : { ...agent, greeting: said },
    },
  };
}

export function useVoiceInterview(
  events: VoiceSessionEvents = {},
): VoiceInterview {
  const [active, setActive] = useState(false);
  // The remembered choice (R28), unless this session has settled on
  // another: the server's answer, or a switch made mid-conversation.
  const preferred = useVoicePreference();
  const [settled, setVoice] = useState<QVoiceChoice | null>(null);
  const voice = settled ?? preferred;
  const [notice, setNotice] = useState<string | null>(null);
  const [linkStatus, setLinkStatus] = useState<string | null>(null);
  /**
   * I1: the duplex line's own status while it carries on (weak,
   * reconnecting). Separate from `linkStatus`, which the line coming up
   * clears: a rejoining line never stops being "up".
   */
  const [lineStatus, setLineStatus] = useState<string | null>(null);
  const [turn, setTurn] = useState<QVoiceTurnState | null>(null);
  const [voiceSessionId, setVoiceSessionId] = useState<string | null>(null);
  /**
   * The line's sealed session, presented with every poll and screen move so
   * a deploy or a restart of the Q API does not lose the line (HARDEN P0).
   */
  const sessionToken = useRef<string | undefined>(undefined);
  const lastStart = useRef<{
    thread: VoiceInterviewThread;
    firstMessage: string | undefined;
  } | null>(null);

  // A session that drops on its own comes back on the same thread before
  // the person has to do anything.
  const reconnectAttempts = useRef(0);
  /** When the current line came up; null while there is none. */
  const upSince = useRef<number | null>(null);
  const talkRef = useRef<VoiceInterview["talk"] | null>(null);
  /**
   * Which line is current. Bumped by every open and every end, so anything
   * that belongs to an older line -- a reconnect timer, a fallback from a
   * duplex line already replaced, a poll answer, an open still waiting on
   * the server -- sees it is stale and does nothing.
   */
  const generation = useRef(0);
  /** The generation whose line is up; null while none is. */
  const liveGeneration = useRef<number | null>(null);
  /** Whether the live line is a duplex one: only those fall back. */
  const liveDuplex = useRef(false);
  /** The generation that already fell back: one standard line per drop. */
  const fellBack = useRef<number | null>(null);
  const reconnectTimer = useRef<number | null>(null);
  const clearReconnect = () => {
    if (reconnectTimer.current !== null) {
      window.clearTimeout(reconnectTimer.current);
      reconnectTimer.current = null;
    }
  };
  const mounted = useRef(true);
  /** Q's latest spoken line, to time its gestures by sentence. */
  const lastQLine = useRef("");
  /** What Q is asking now, from the surface (see `talk`'s `lead`). */
  const leadRef = useRef<(() => string | null | undefined) | null>(null);
  /**
   * What Q says first on a line that reopens: the surface's current
   * question, else Q's last words. Never the opening's greeting.
   */
  const reopening = (): string | undefined =>
    said(leadRef.current?.()) ?? said(lastQLine.current);
  /**
   * One handler for a line ending, reachable from the transport's own
   * "ended" and from the poll that notices the server has let a session
   * go. Both are the same event to the person: the line is gone, and it
   * should come back without them doing anything.
   */
  const ended = (reason: "ended" | "dropped" | "error"): void => {
    // A line that is no longer the current one ending says nothing.
    if (liveGeneration.current !== generation.current) return;
    liveGeneration.current = null;
    const last = lastStart.current;
    const again = talkRef.current;
    const heldFor = upSince.current === null ? 0 : Date.now() - upSince.current;
    upSince.current = null;
    if (heldFor >= STABLE_LINE_MS) {
      // A line that worked for a while and then dropped gets the full
      // three tries again.
      reconnectAttempts.current = 0;
    }
    if (reason === "ended" || last === null || again === null) {
      reconnectAttempts.current = 0;
      setLinkStatus(null);
      setActive(false);
      events.onEnded?.(reason);
      return;
    }
    const delay = RECONNECT_DELAYS_MS[reconnectAttempts.current];
    if (delay === undefined) {
      // Out of tries. Say so once, in Q's own words, and stop.
      reconnectAttempts.current = 0;
      setLinkStatus(null);
      setActive(false);
      setNotice(GAVE_UP);
      events.onEnded?.(reason);
      return;
    }
    reconnectAttempts.current += 1;
    // A calm word instead of silence while the line comes back.
    setLinkStatus(RECONNECTING_NOTICE);
    // Silent: a deploy of the Q API or a network blip is picked back up
    // before the person needs to know; only giving up is said (HARDEN P0).
    // `talk` clears the notice as it starts and sets its own on failure.
    // The same line coming back, not a new arrival: no greeting, and no
    // second opening recorded (the fixture's repeated "Welcome back").
    // Q re-asks what it is asking, so the person is not left waiting.
    // One timer at a time, and none survives an end or a newer line.
    clearReconnect();
    const scheduledFor = generation.current;
    reconnectTimer.current = window.setTimeout(() => {
      reconnectTimer.current = null;
      if (!mounted.current || generation.current !== scheduledFor) return;
      void again({
        thread: last.thread,
        firstMessage: reopening(),
        resume: true,
      });
    }, delay);
  };
  // The poll below needs the latest of these without re-subscribing on
  // every render; a ref written in an effect, never during render.
  const endedRef = useRef(ended);
  useEffect(() => {
    endedRef.current = ended;
  });
  /**
   * DUPLEX: a full-duplex line ended into the standard voice. Until the
   * person ends voice, every line (a reconnect too) is the standard one.
   */
  const showTurnOutcome = (outcome: VoiceTurnOutcome): void => {
    events.onTurnOutcome?.(outcome);
    const shown = outcome.notice;
    if (shown === undefined) return;
    setNotice(shown);
    if (turnNoticeTimer.current !== null) {
      window.clearTimeout(turnNoticeTimer.current);
    }
    turnNoticeTimer.current = window.setTimeout(() => {
      turnNoticeTimer.current = null;
      setNotice((current) => (current === shown ? null : current));
    }, TURN_NOTICE_MS);
  };
  const showTurnOutcomeRef = useRef(showTurnOutcome);
  useEffect(() => {
    showTurnOutcomeRef.current = showTurnOutcome;
  });
  const duplexOff = useRef(false);
  const renewals = useRef(0);
  const turnNoticeTimer = useRef<number | null>(null);
  /** The board's last turn outcome shown (standard line), and when. */
  const lastOutcomeSeq = useRef(0);
  const boardOutcomeAt = useRef(0);
  useEffect(
    () => () => {
      if (turnNoticeTimer.current !== null) {
        window.clearTimeout(turnNoticeTimer.current);
      }
    },
    [],
  );
  const client = useVoiceSession({
    ...events,
    onLine: (line) => {
      if (line.role === "q") lastQLine.current = line.text;
      events.onLine?.(line);
    },
    onEnded: (reason) => {
      setLineStatus(null);
      ended(reason);
    },
    onLinkStatus: setLineStatus,
    // DUPLEX: the same thread carries on, on the standard voice, at once.
    // Resumed: Q does not greet again. The cap's one sentence, if any, is
    // shown once the standard line is up (talk clears the notice first).
    onFallback: (notice, cause) => {
      // Exactly one standard line per duplex line that fails: a second
      // report from the same line, or one from a line already replaced or
      // ended, opens nothing (live 2026-10-05: a second standard line came
      // up beside the first, both listening).
      const current = generation.current;
      if (
        liveGeneration.current !== current ||
        !liveDuplex.current ||
        fellBack.current === current
      ) {
        return;
      }
      fellBack.current = current;
      setLineStatus(null);
      // A line that reached its length is renewed on the same voice
      // (founder 2026-10-05: "the voice changed" at exactly 10 minutes):
      // the person hears no switch. Bounded, so a line that cannot stay up
      // still lands on the standard voice. The server still decides: past
      // the daily cap the new session is issued as the standard one.
      // Any line that drops (a network blip, a server restart that forgot
      // the line, the length limit) is renewed as a fresh fast line too
      // (founder 2026-10-06: "the voice dropped to the slow one" during a
      // deploy). Only the daily cap, or a line that keeps failing, lands on
      // the standard voice.
      // A line that never connected is not retried here: on a network
      // that blocks the fast line the standard voice must come quickly.
      const renew =
        cause !== undefined &&
        cause !== "CAP" &&
        cause !== "CONNECT" &&
        (cause === "MAX_LENGTH" ? notice === null : true) &&
        renewals.current < MAX_DUPLEX_RENEWALS;
      if (renew) renewals.current += 1;
      else duplexOff.current = true;
      // A lost line is said at once when the standard voice is on its way.
      const weak = !renew && notice === LINE_LOST_NOTICE;
      if (weak) setLinkStatus(LINE_LOST_NOTICE);
      const last = lastStart.current;
      const again = talkRef.current;
      if (last === null || again === null) {
        ended("dropped");
        return;
      }
      // Q carries on speaking first on the standard line: the question it
      // is asking, never a second welcome.
      void again({
        thread: last.thread,
        firstMessage: reopening(),
        resume: true,
        ...(renew ? {} : { duplex: false }),
      }).then(() => {
        if (notice !== null && !weak) setNotice(notice);
      });
    },
    onError: (message) => {
      setNotice(message);
      events.onError?.(message);
    },
    // RECOVERY A4: a turn that ended without an answer is never silent on
    // screen: its sentence shows for a while, then goes.
    onTurnOutcome: (outcome) => {
      // The standard line's watchdog only speaks for a turn the server
      // has not already accounted for on the board.
      if (
        outcome.failure === "TIMEOUT" &&
        Date.now() - boardOutcomeAt.current < WATCHDOG_COVERED_MS
      ) {
        return;
      }
      showTurnOutcome(outcome);
    },
  });
  const clientRef = useRef(client);
  useEffect(() => {
    clientRef.current = client;
  });

  // The line is back: "Reconnecting…" goes at once; the switch to the
  // standard voice stays a moment longer so it can be read.
  const lineUp = client.connected;
  useEffect(() => {
    if (!lineUp || linkStatus === null) return;
    const timer = setTimeout(
      () => {
        setLinkStatus(null);
      },
      linkStatus === RECONNECTING_NOTICE ? 0 : LINK_STATUS_LINGER_MS,
    );
    return () => {
      clearTimeout(timer);
    };
  }, [lineUp, linkStatus]);

  /**
   * This hook's place in the tab's one voice line (`voice-line.ts`). When
   * another surface opens a line, this one's is ended first, awaited.
   */
  const releaseRef = useRef<(reopening: boolean) => Promise<void>>(() =>
    Promise.resolve(),
  );
  const [holder] = useState<VoiceLineHolder>(() => ({
    release: (reopening) => releaseRef.current(reopening),
  }));

  /** The transport and the polling stop; the thread is kept. */
  const closeTransport = useCallback(async () => {
    liveGeneration.current = null;
    clearReconnect();
    setVoiceSessionId(null);
    sessionToken.current = undefined;
    upSince.current = null;
    await clientRef.current.end();
  }, []);

  /** Everything about this line is let go: the person, or another surface, ended it. */
  const reset = useCallback(() => {
    generation.current += 1;
    liveGeneration.current = null;
    clearReconnect();
    setActive(false);
    setVoiceSessionId(null);
    sessionToken.current = undefined;
    // Back to the remembered choice, so a change made in Settings while
    // the line was closed is the voice of the next session.
    setVoice(null);
    setTurn(null);
    lastStart.current = null;
    reconnectAttempts.current = 0;
    upSince.current = null;
    duplexOff.current = false;
    renewals.current = 0;
    fellBack.current = null;
    setLinkStatus(null);
    setLineStatus(null);
  }, []);

  useEffect(() => {
    releaseRef.current = async (reopening) => {
      if (!reopening) reset();
      await closeTransport();
    };
  }, [reset, closeTransport]);

  const talk = useCallback<VoiceInterview["talk"]>(
    async ({
      thread,
      firstMessage,
      voice: requested,
      resume = false,
      duplex,
      lead,
    }) => {
      // This call is now the line the person wants; anything older still
      // on its way (a reconnect timer, an open waiting on the server)
      // stands down when it sees the generation has moved on.
      generation.current += 1;
      const mine = generation.current;
      clearReconnect();
      if (lead !== undefined) leadRef.current = lead;
      const chosen = requested ?? voice;
      // The previous line -- this surface's own or another's -- is ended
      // and awaited before the server is asked for the next one.
      await openVoiceLine(holder, async () => {
        if (!mounted.current || generation.current !== mine) return;
        setNotice(null);
        lastStart.current = { thread, firstMessage };
        const started = await startVoiceSessionAction({
          ...(resume ? { resume: true } : {}),
          ...(duplex === false || duplexOff.current ? { duplex: false } : {}),
          ...(thread.welcome === true ? { welcome: true } : {}),
          ...(thread.onboarding === undefined
            ? {}
            : { onboarding: thread.onboarding }),
          ...(thread.subjects === undefined
            ? {}
            : { subjects: thread.subjects }),
          ...(thread.conversationId === undefined
            ? {}
            : { conversationId: thread.conversationId }),
          ...(thread.organisationHint === undefined
            ? {}
            : { organisationHint: thread.organisationHint }),
          // R21: the screen the line opens on; moves follow below.
          screen: currentScreen(),
          // Heard and spoken in the person's own language.
          ...deviceLocale(),
          voice: chosen,
        });
        // Ended, superseded or unmounted while the server answered: this
        // line is never brought up.
        if (!mounted.current || generation.current !== mine) return;
        if (!started.ok) {
          setNotice(started.message);
          return;
        }
        setVoice(started.value.voice);
        sessionToken.current = started.value.sessionToken;
        setVoiceSessionId(started.value.voiceSessionId);
        setTurn(null);
        setActive(true);
        upSince.current = Date.now();
        liveGeneration.current = mine;
        liveDuplex.current = started.value.duplex !== undefined;
        /**
         * Q speaks first (founder live 2026-10-05: "I listen and it waits
         * for me to talk"). The server's opening when it composed one; on a
         * resumed thread it composes none, and Q says the caller's line --
         * the question already on screen -- or, failing that, the question
         * the surface says it is asking now. Never nothing when there is a
         * question to ask.
         */
        const opening =
          said(started.value.firstMessage) ??
          said(firstMessage) ??
          said(leadRef.current?.());
        await clientRef.current.start({
          credential:
            resume || !hasGreeting(started.value)
              ? withGreeting(started.value, opening)
              : started.value,
          firstMessage: opening,
        });
      });
    },
    [holder, voice],
  );

  useEffect(() => {
    talkRef.current = talk;
  }, [talk]);

  // A surface that goes away takes its line with it, and nothing it
  // scheduled (a reconnect) may open another afterwards.
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      generation.current += 1;
      liveGeneration.current = null;
      clearReconnect();
      dropVoiceLine(holder);
    };
  }, [holder]);

  const end = useCallback(async () => {
    reset();
    // After any open still in progress, so an End pressed while connecting
    // is never followed by the line coming up.
    await endVoiceLine(holder, () => clientRef.current.end());
  }, [holder, reset]);

  // While talking, follow what Q is asking; a stale read is dropped.
  useEffect(() => {
    if (!active || voiceSessionId === null) {
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // R21: the screen the server has for this line; sent again only when
    // the person has moved (a route, or the document open in the viewer).
    // R18: with the pitch moment on it, so a spoken "what is this about?"
    // is about the card and the moment on screen. The position is sent in
    // five-second steps: enough to find the passage, not a post a second.
    let sentScreen = JSON.stringify(currentScreen());
    const tick = async () => {
      const screen = currentScreen();
      const viewing = currentViewing();
      const screenKey = JSON.stringify([
        screen,
        viewing === undefined
          ? null
          : [viewing.mediaAssetId, Math.floor(viewing.positionSeconds / 5)],
      ]);
      if (screenKey !== sentScreen) {
        sentScreen = screenKey;
        void sendVoiceScreenAction(
          voiceSessionId,
          viewing === undefined ? screen : { ...screen, viewing },
          sessionToken.current,
        );
      }
      const read = await readVoiceTurnAction(
        voiceSessionId,
        sessionToken.current,
      );
      if (cancelled) {
        return;
      }
      if (read.ok) {
        // PRESENCE: the spoken answer's gestures, played against Q's voice
        // (announced once per answer, however often the board is read).
        const presence = read.value.presence;
        if (presence !== undefined) {
          announceQGestures({
            answerId: presence.answerId,
            gestures: presence.gestures,
            spoken: true,
            text: lastQLine.current,
          });
        }
        setTurn((current) =>
          current !== null && current.sequence >= read.value.sequence
            ? current
            : read.value,
        );
        // RECOVERY A4 (standard line): a turn Q chose not to answer is
        // shown, once, rather than left as a silent "Thinking".
        const outcome = read.value.outcome;
        if (outcome !== undefined && outcome.seq > lastOutcomeSeq.current) {
          const first = lastOutcomeSeq.current === 0 && outcome.seq > 1;
          lastOutcomeSeq.current = outcome.seq;
          // A line that reconnected reads the board as it was: older
          // outcomes are not shown again.
          if (!first) {
            boardOutcomeAt.current = Date.now();
            showTurnOutcomeRef.current({
              disposition: outcome.disposition,
              failure: outcome.failure,
              notice:
                outcome.disposition === "IGNORED" ? IGNORED_NOTICE : undefined,
            });
          }
        }
      } else if (read.gone === true) {
        // The server has let this session go while the socket is still
        // open here. Nothing said into it will ever be answered, so the
        // line is ended as dropped, which is what brings it back.
        cancelled = true;
        const gone = generation.current;
        void clientRef.current.end().then(() => {
          // Only if this is still the current line: a newer one is not
          // ended because an older session was let go.
          if (generation.current === gone) endedRef.current("dropped");
        });
        return;
      }
      timer = setTimeout(() => void tick(), TURN_POLL_MS);
    };
    void tick();
    return () => {
      cancelled = true;
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    };
  }, [active, voiceSessionId]);

  const chooseVoice = useCallback(
    async (next: QVoiceChoice) => {
      if (next === voice) {
        return;
      }
      storeVoicePreference(next);
      setVoice(next);
      const last = lastStart.current;
      if (!active || last === null) {
        return;
      }
      // A new provider session with the other voice; the interview and
      // the Q conversation are where they were, on the server. `talk` ends
      // the current line first; Q picks up with the question it is asking.
      await talk({
        thread: last.thread,
        firstMessage: reopening(),
        voice: next,
        resume: true,
      });
    },
    [voice, active, talk],
  );

  return {
    client,
    active,
    voice,
    notice: linkStatus ?? lineStatus ?? notice,
    linkStatus: linkStatus ?? lineStatus,
    talk,
    end,
    chooseVoice,
    clearNotice: () => {
      setNotice(null);
      setLinkStatus(null);
      setLineStatus(null);
    },
    turn,
  };
}

/**
 * Which voice the Q session uses: the real one everywhere in the product.
 * Only a development harness provides another (a scripted line, so the
 * browser suite can hold a line open across navigation without a
 * provider). The value is a hook and never changes within a tree.
 */
export const VoiceInterviewSource =
  createContext<typeof useVoiceInterview>(useVoiceInterview);

export type { VoiceTranscriptLine };
