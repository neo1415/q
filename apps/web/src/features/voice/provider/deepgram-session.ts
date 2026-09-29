"use client";

import { AgentMicrophone } from "@deepgram/agents";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Q_VOICE_THINKING_BEATS } from "@capital-q/contracts";

import {
  transcriptLineFor,
  type VoiceSessionClient,
  type VoiceSessionEvents,
  type VoiceSessionStart,
  type VoiceState,
  type VoiceTranscriptLine,
} from "../session";
import { announceQSaid } from "../../q-swarm/q-said";
import { AgentSocket } from "./agent-socket";
import { PcmPlayer } from "./pcm-player";

/**
 * The Deepgram Voice Agent as the browser's transport (CQ-Q-VOICE-001
 * rework). The session token and the agent settings come from the Q API;
 * every "think" the agent makes goes back to the Q API's own endpoint, so
 * what the person hears is Q. This adapter owns the microphone, the
 * speaker and the socket, and nothing else: no words are decided here.
 *
 * The microphone is the SDK's; the socket (`AgentSocket`) and the speaker
 * (`PcmPlayer`) are ours, because the SDK's pair is what made Q stutter
 * (R22): its socket delivered each 20 ms frame through a serial Blob
 * read that fell seconds behind on a busy page, and its player started
 * each frame on arrival with nothing held back, so every late frame was a
 * gap in the voice.
 */

const PLAIN_ERRORS = {
  microphone:
    "Q can't hear you: the microphone isn't available. Check the browser's permission and try again.",
  connection:
    "The voice connection dropped. You can keep typing, or try again.",
  generic: "I lost the connection for a moment. Reconnecting.",
  speech:
    "I can't speak out loud right now, but I'm listening. My replies will show here, or you can type.",
} as const;

/**
 * No silent dead starts (voice lane, 2026-09-25).
 *
 * A line can look alive and be dead in two ways: it never listens (the
 * socket opened but the agent never applied its settings, so every audio
 * frame waits in the SDK's queue while the screen says "Listening"), or it
 * never speaks (the greeting or a reply produced no audio — the voice
 * relay's vendor refused, as on Railway with an exhausted key). Each is
 * given a bounded time and then said out loud, in one plain sentence, or
 * handed to the reconnect upstairs. "Connected" is the socket; listening
 * starts when the provider has applied the settings.
 */
const SETTINGS_WITHIN_MS = 10_000;
/** The relay's slowest vendor, its fallback, and a margin. */
const SPEECH_WITHIN_MS = 10_000;
/** A working microphone produces frames continuously, silence included. */
const FRAMES_WITHIN_MS = 4_000;

/**
 * How long an injected message may wait for its echo before it is
 * forgotten. Long enough for a slow provider, short enough that it cannot
 * silence something the person types later in the conversation.
 */
const INJECTED_TTL_MS = 30_000;

const INPUT_SAMPLE_RATE = 16_000;
const OUTPUT_SAMPLE_RATE = 24_000;

/**
 * Barge-in (acceptance J, 2026-09-24).
 *
 * The provider's "user started speaking" is the listening model deciding
 * a turn has begun, and the agent stops Q's reply there and then. The
 * speaker has to stop with it: it used to sample the microphone first and
 * cut only for a loud, sustained sound, but echo cancellation keeps the
 * level low while Q's own voice is in the room, so Q played on to the end
 * of its answer while the person talked over it.
 *
 * A sound that produced no words (a cough) is repaired afterwards: once
 * the microphone has been quiet for longer than the provider waits before
 * ending a turn, and still no words have come, the browser asks Q to carry
 * on with a cue the server treats as "go on" and the transcript never
 * shows. It used to fire 1.6 s after the cut whatever the person was
 * doing — mid-sentence, since words only arrive when the turn ends — and
 * the provider folded the cue into their sentence: "[continue] I'm not
 * saying…", answered as a separate turn each time the sentence grew.
 */
const SPEECH_LEVEL = 0.02;
/** The provider's end-of-turn timeout (4 s, deepgram.ts) plus a margin. */
const REPAIR_AFTER_QUIET_MS = 4_400;
const REPAIR_POLL_MS = 100;
/** A repair not decided by then is dropped; the person can say "go on". */
const REPAIR_GIVE_UP_MS = 20_000;
const CONTINUE_SIGNAL = "[continue]";
/**
 * Audio in flight when the agent stopped arrives within this. True only
 * because frames are read straight off the socket: behind the SDK's Blob
 * hop they reached this code seconds late, after the window had closed,
 * and the answer the person talked over played on.
 */
const STALE_AUDIO_MS = 700;

/** The person's words without the cue, or "" when the line was only the cue. */
function withoutCue(text: string): string {
  return text.split(CONTINUE_SIGNAL).join(" ").replace(/\s+/g, " ").trim();
}

let counter = 0;
const newId = () => `dg-${String(Date.now())}-${String((counter += 1))}`;

type Live = {
  readonly session: AgentSocket;
  readonly microphone: AgentMicrophone;
  readonly player: PcmPlayer;
};

export function useDeepgramVoiceSession(
  events: VoiceSessionEvents = {},
): VoiceSessionClient {
  const [state, setState] = useState<VoiceState>("IDLE");
  const [connected, setConnected] = useState(false);
  const [transcript, setTranscript] = useState<readonly VoiceTranscriptLine[]>(
    [],
  );
  const [muted, setMutedState] = useState(false);
  const eventsRef = useRef(events);
  useEffect(() => {
    eventsRef.current = events;
  }, [events]);
  const liveRef = useRef<Live | null>(null);
  const speakingRef = useRef(false);
  /**
   * Until when audio still arriving for a reply the person talked over is
   * dropped: the person must never hear the rest of an answer they
   * interrupted.
   *
   * Bounded in time as well as ended by the agent's next reply. It used to
   * last until the agent announced a new reply, and a reply the agent went
   * on speaking (a sound it did not take as an interruption), or one it
   * never announced, was dropped whole: Q's words on screen, no sound,
   * for as long as the line lasted (live, 2026-09-25). Audio that was in
   * flight when the agent stopped arrives within a round trip; anything
   * later is the agent speaking, and is played.
   */
  const discardUntilRef = useRef(0);
  const lastUserTextAtRef = useRef(0);
  /** The last line shown, so a re-reported utterance replaces it. */
  const lastLineRef = useRef<VoiceTranscriptLine | null>(null);
  /**
   * Text this browser put into the session itself, waiting for the
   * provider to say it back.
   *
   * A typed message is shown the moment it is sent, because a person who
   * presses enter should see their words immediately rather than after a
   * round trip. The provider then reports the same message as part of the
   * conversation, and both landed in the transcript: every typed turn
   * appeared twice (live, 2026-09-22).
   *
   * Matched on the words rather than on a window of time, because a
   * window cannot tell an echo from somebody genuinely saying "are you
   * there?" twice — and dropping a real second turn is a worse bug than
   * the one it fixes.
   */
  const injectedRef = useRef<{ text: string; at: number }[]>([]);

  const teardown = useCallback(() => {
    const live = liveRef.current;
    liveRef.current = null;
    if (live === null) return;
    try {
      live.microphone.stop();
    } catch {
      // Already stopped.
    }
    try {
      live.player.dispose();
    } catch {
      // Already disposed.
    }
    try {
      live.session.disconnect();
    } catch {
      // Already closed.
    }
  }, []);

  useEffect(() => () => teardown(), [teardown]);

  const addLine = useCallback((role: "user" | "q", text: string) => {
    const trimmed = text.trim();
    if (trimmed.length === 0) return;
    const previous = lastLineRef.current;
    // Same id as the line shown last when it is the same utterance or the
    // same reply, so every consumer that keys lines by id shows it once.
    const line = transcriptLineFor(previous, role, trimmed, newId, Date.now());
    const replacing = line.id === previous?.id ? previous : null;
    lastLineRef.current = line;
    setTranscript((current) =>
      replacing === null
        ? [...current, line]
        : current.map((item) => (item.id === replacing.id ? line : item)),
    );
    eventsRef.current.onLine?.(line);
  }, []);

  const start = useCallback(
    async ({ credential }: VoiceSessionStart) => {
      const settings = credential.deepgram;
      if (credential.provider !== "deepgram" || settings === undefined) {
        setState("ERROR");
        eventsRef.current.onError?.(PLAIN_ERRORS.generic);
        return;
      }
      teardown();
      setTranscript([]);
      lastLineRef.current = null;
      injectedRef.current = [];
      setState("CONNECTING");
      speakingRef.current = false;
      discardUntilRef.current = 0;

      const token = credential.token;
      const session = new AgentSocket({
        token,
        agent: settings.agent,
        input: { encoding: "linear16", sampleRate: INPUT_SAMPLE_RATE },
        output: { encoding: "linear16", sampleRate: OUTPUT_SAMPLE_RATE },
      });
      const player = new PcmPlayer({ sampleRate: OUTPUT_SAMPLE_RATE });
      /**
       * Where the audio stops, if it stops.
       *
       * "Q can't hear me" has three different causes that look identical
       * from the chair: the microphone is not producing frames, the frames
       * are not reaching the provider, or the provider hears them and
       * never decides the person has finished. This counts frames leaving
       * the browser and notes the last thing the provider said back, and
       * prints one line every few seconds in the console. Nothing about
       * the audio itself is logged, only that it moved.
       */
      const heard = {
        frames: 0,
        totalFrames: 0,
        lastEvent: "none",
        lastEventAt: 0,
      };
      const microphone = new AgentMicrophone(
        (data) => {
          heard.frames += 1;
          heard.totalFrames += 1;
          session.sendAudio(data);
        },
        { sampleRate: INPUT_SAMPLE_RATE, echoCancellation: true },
      );
      const heartbeat = window.setInterval(() => {
        if (liveRef.current !== live) {
          window.clearInterval(heartbeat);
          return;
        }
        console.info(
          "[voice] audio frames sent in last 5s:",
          heard.frames,
          "| last provider event:",
          heard.lastEvent,
          heard.lastEventAt === 0
            ? ""
            : `${String(Math.round((Date.now() - heard.lastEventAt) / 1000))}s ago`,
          "| muted:",
          microphone.muted,
          "| input level:",
          microphone.getInputVolume().toFixed(3),
        );
        heard.frames = 0;
      }, 5_000);
      const noteEvent = (name: string) => {
        heard.lastEvent = name;
        heard.lastEventAt = Date.now();
      };
      const live: Live = { session, microphone, player };
      liveRef.current = live;

      const greeting =
        typeof settings.agent.greeting === "string" &&
        settings.agent.greeting.trim().length > 0;
      let settingsWatch: number | null = null;
      let speechWatch: number | null = null;
      let speechWarned = false;
      const stopWatch = (handle: number | null) => {
        if (handle !== null) window.clearTimeout(handle);
        return null;
      };
      /** Q is about to be heard; if nothing comes out, say so once. */
      const expectSpeech = () => {
        if (speechWatch !== null || speechWarned) return;
        speechWatch = window.setTimeout(() => {
          speechWatch = null;
          if (liveRef.current !== live) return;
          speechWarned = true;
          console.warn("[voice] no audio for a reply Q gave");
          setState((current) =>
            current === "Q_SPEAKING" || current === "THINKING"
              ? "LISTENING"
              : current,
          );
          eventsRef.current.onError?.(PLAIN_ERRORS.speech);
        }, SPEECH_WITHIN_MS);
      };
      const speechHeard = () => {
        speechWatch = stopWatch(speechWatch);
      };
      session.on("connected", () => {
        setConnected(true);
        // The socket, not the agent: until the settings are applied every
        // frame waits in the SDK's queue and nobody is listening.
        settingsWatch = stopWatch(settingsWatch);
        settingsWatch = window.setTimeout(() => {
          settingsWatch = null;
          if (liveRef.current !== live) return;
          console.warn("[voice] the agent never applied its settings");
          fail(PLAIN_ERRORS.connection);
        }, SETTINGS_WITHIN_MS);
      });
      session.on("settings-applied", () => {
        noteEvent("settings-applied");
        settingsWatch = stopWatch(settingsWatch);
        setState((current) =>
          current === "CONNECTING" ? "LISTENING" : current,
        );
        // Q speaks first on an explicit start; that greeting has to be heard.
        if (greeting) expectSpeech();
      });
      session.on("warning", (message) => {
        // For the log only; what the person is told comes from the
        // watches, which judge by what was heard rather than by wording.
        noteEvent("warning");
        console.warn("voice agent warning", message.code, message.description);
      });
      session.on("conversation-text", (message) => {
        noteEvent(`conversation-text:${message.role}`);
        // A new line from either side: whatever follows is not the reply
        // that was talked over.
        discardUntilRef.current = 0;
        const role = message.role === "user" ? "user" : "q";
        let content = message.content;
        if (role === "user") {
          lastUserTextAtRef.current = Date.now();
          // The cue is this browser's own signal, never the person's
          // words, even when the provider folds it into them.
          content = withoutCue(content);
          if (content.length === 0) return;
          // Our own injected message coming back. It is already on screen;
          // adding it again is the duplicate turn.
          const waiting = injectedRef.current.findIndex(
            (item) => item.text === content,
          );
          if (waiting !== -1) {
            injectedRef.current.splice(waiting, 1);
            setState("THINKING");
            return;
          }
        }
        // A thinking "hm" is a sound, not a line of the conversation.
        if (role === "q" && Q_VOICE_THINKING_BEATS.has(content.trim())) {
          expectSpeech();
          return;
        }
        addLine(role, content);
        // The swarm and the page pointer follow what Q says, as it says it.
        if (role === "q") announceQSaid(content);
        if (role === "user") setState("THINKING");
        else expectSpeech();
      });
      /** The pending cough repair, if one is waiting. */
      let repair: number | null = null;
      const cancelRepair = () => {
        if (repair !== null) window.clearInterval(repair);
        repair = null;
      };
      const repairFalseInterruption = () => {
        cancelRepair();
        const startedAt = Date.now();
        let lastLoudAt = startedAt;
        repair = window.setInterval(() => {
          const now = Date.now();
          if (
            liveRef.current !== live ||
            lastUserTextAtRef.current >= startedAt ||
            now - startedAt > REPAIR_GIVE_UP_MS
          ) {
            cancelRepair();
            return;
          }
          if (microphone.getInputVolume() >= SPEECH_LEVEL) lastLoudAt = now;
          if (now - lastLoudAt < REPAIR_AFTER_QUIET_MS) return;
          cancelRepair();
          session.injectUserMessage(CONTINUE_SIGNAL);
          setState("THINKING");
        }, REPAIR_POLL_MS);
      };
      session.on("user-started-speaking", () => {
        noteEvent("user-started-speaking");
        // The agent abandons its reply; its audio is not owed any more.
        speechHeard();
        // "Speaking" is what the player is doing, not what the flag says:
        // the flag drops a bounded time after the provider finishes
        // sending, and a long answer is still coming out of the speaker
        // well after that. Live, Q talked over the person to the end of
        // its answer because the flag had already dropped.
        const stillPlaying =
          speakingRef.current || player.getRemainingPlaybackTime() > 0.1;
        if (!stillPlaying) {
          setState("USER_SPEAKING");
          return;
        }
        // Q stops the moment the person starts. The agent has already
        // abandoned this reply; what is queued or still arriving for it is
        // obsolete.
        player.interrupt();
        speakingRef.current = false;
        discardUntilRef.current = Date.now() + STALE_AUDIO_MS;
        setState("INTERRUPTED");
        eventsRef.current.onInterrupted?.();
        repairFalseInterruption();
      });
      /**
       * The provider's own measure of each turn (CQ-VOICE-010): from the
       * end of the person's speech to Q's first audio, and its parts.
       * q-api's "voice turn timed" line starts where this one's think
       * stage starts, so the two together cover the whole turn. Seconds,
       * as the provider reports them; nothing the person said.
       */
      session.on("latency-report", (report) => {
        console.info("[voice] latency (s)", {
          stt: report.stt_latency,
          think: report.ttt_text_latency,
          tts: report.tts_latency,
          total: report.total_latency,
        });
      });
      session.on("agent-thinking", () => {
        noteEvent("agent-thinking");
        discardUntilRef.current = 0;
        setState("THINKING");
      });
      session.on("agent-started-speaking", () => {
        cancelRepair();
        expectSpeech();
        discardUntilRef.current = 0;
        speakingRef.current = true;
        setState("Q_SPEAKING");
      });
      session.on("audio", (chunk) => {
        speechHeard();
        if (Date.now() < discardUntilRef.current) return;
        // Audio after the stale window: the agent is still speaking, so
        // nothing needs repairing.
        cancelRepair();
        player.queue(chunk);
      });
      session.on("agent-audio-done", () => {
        // Nothing more is coming for this reply: play what is held now
        // rather than waiting out the jitter buffer.
        player.flush();
        // How the speaker kept up, for the console only (as the heartbeat):
        // a gap here is a break in Q's voice the person heard.
        console.info("[voice] playback", player.stats);
        const remaining = Math.max(0, player.getRemainingPlaybackTime());
        window.setTimeout(
          () => {
            if (liveRef.current !== live) return;
            speakingRef.current = false;
            setState((current) =>
              current === "Q_SPEAKING" ? "LISTENING" : current,
            );
          },
          Math.min(8_000, remaining * 1000 + 150),
        );
      });
      /**
       * A line that has failed is finished, and the person should be
       * picked back up rather than left reading about it.
       *
       * Both an agent error and an unclean disconnect end the session the
       * same way — teardown, one plain sentence, then `dropped`, which is
       * what the reconnect upstairs listens for. An agent error used to
       * set an error state and stop there, so a failed turn stranded the
       * person behind a banner while a dropped socket healed itself.
       *
       * Called at most once: whichever event arrives first claims the
       * session, and the other finds it already gone.
       */
      const fail = (line: string) => {
        if (liveRef.current !== live) {
          return;
        }
        liveRef.current = null;
        try {
          microphone.stop();
          player.dispose();
          // The socket too. Without this the provider's agent session
          // stayed alive after the microphone had stopped, kept thinking
          // against a binding the reconnect had already replaced, and was
          // refused three times in a second — a dead session still trying
          // to speak. Seen live.
          session.disconnect();
        } catch {
          // Already gone.
        }
        setConnected(false);
        setState("ERROR");
        eventsRef.current.onError?.(line);
        eventsRef.current.onEnded?.("dropped");
      };

      session.on("error", (message) => {
        // The provider's code and wording are for our logs. A person is
        // told what happened to them, in one sentence, with no code in it:
        // "(FAILED_TO_THINK)" told them nothing and read like a crash.
        console.warn("voice agent error", message.code, message.description);
        fail(PLAIN_ERRORS.generic);
      });
      session.on("disconnected", () => {
        // Who closed the line, not how the close was worded. Every close
        // this client asks for (end, fail, a replaced session) lets go of
        // `live` first, so a session that is still `live` here was closed
        // by the other side or gave up reconnecting. That is a dropped
        // line even when its reason reads "normal": treating it as clean
        // ended the stage with no word to the person, and nothing brought
        // it back. Seen live on the welcome screen.
        //
        // A close this client asked for says nothing more: whoever closed
        // it has already stopped the microphone and reported the ending.
        // Reporting it again as "ended" is what used to reset the
        // reconnect budget on every failed line, so a provider that
        // failed on every greeting was retried without end.
        if (liveRef.current === live) {
          fail(PLAIN_ERRORS.connection);
        }
      });

      try {
        await microphone.start();
      } catch {
        liveRef.current = null;
        setState("ERROR");
        eventsRef.current.onError?.(PLAIN_ERRORS.microphone);
        return;
      }
      if (muted) microphone.mute();
      else {
        // A capture that started but never delivers a frame is a
        // microphone Q cannot hear through, whatever the screen says.
        window.setTimeout(() => {
          if (liveRef.current !== live || heard.totalFrames > 0) return;
          if (microphone.muted) return;
          console.warn("[voice] the microphone produced no audio");
          eventsRef.current.onError?.(PLAIN_ERRORS.microphone);
        }, FRAMES_WITHIN_MS);
      }
      try {
        await session.connect();
      } catch {
        teardown();
        setState("ERROR");
        eventsRef.current.onError?.(PLAIN_ERRORS.connection);
      }
    },
    [addLine, muted, teardown],
  );

  const end = useCallback(async () => {
    const live = liveRef.current;
    liveRef.current = null;
    setConnected(false);
    setState("IDLE");
    if (live !== null) {
      try {
        live.microphone.stop();
        live.player.dispose();
        live.session.disconnect();
      } catch {
        // Already closed.
      }
    }
    await Promise.resolve();
  }, []);

  const sendText = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      const live = liveRef.current;
      if (trimmed.length === 0 || live === null) return;
      live.session.injectUserMessage(trimmed);
      // Bounded, and stale entries dropped: an injection the provider
      // never echoes must not sit here waiting to swallow a real turn
      // somebody types later.
      const now = Date.now();
      injectedRef.current = [
        ...injectedRef.current.filter(
          (item) => now - item.at < INJECTED_TTL_MS,
        ),
        { text: trimmed, at: now },
      ].slice(-8);
      addLine("user", trimmed);
      setState("THINKING");
    },
    [addLine],
  );

  const setMuted = useCallback((next: boolean) => {
    setMutedState(next);
    const live = liveRef.current;
    if (live === null) return;
    if (next) live.microphone.mute();
    else live.microphone.unmute();
  }, []);

  const setVolume = useCallback((volume: number) => {
    liveRef.current?.player.setVolume(Math.min(1, Math.max(0, volume)));
  }, []);

  const inputLevel = useCallback(() => {
    const live = liveRef.current;
    return live === null
      ? 0
      : Math.min(1, live.microphone.getInputVolume() * 3);
  }, []);
  const outputLevel = useCallback(() => {
    const live = liveRef.current;
    return live === null ? 0 : Math.min(1, live.player.getOutputVolume() * 3);
  }, []);

  return useMemo(
    () => ({
      state,
      connected,
      muted,
      transcript,
      start,
      end,
      sendText,
      setMuted,
      setVolume,
      inputLevel,
      outputLevel,
    }),
    [
      state,
      connected,
      muted,
      transcript,
      start,
      end,
      sendText,
      setMuted,
      setVolume,
      inputLevel,
      outputLevel,
    ],
  );
}
