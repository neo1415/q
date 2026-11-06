"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";

import { microphoneHeld, watchMicrophoneHolds } from "../voice/mic-hold";
import { useQSessionOptional } from "../q/q-session";
import { showQVoiceView } from "../q/stage-view";
import { playSound } from "../q-sound/sound-engine";
import { readSoundPreference } from "../q-sound/sound-preference";
import { voiceAudioOwner, watchVoiceAudio } from "../voice/voice-audio";
import { voiceLineHolder, watchVoiceLine } from "../voice/voice-line";
import type { EngineFailure, WakeEngine } from "./engine";
import { useOnDeviceStatus } from "./on-device";
import { WAKE_GREETING } from "./phrases";
import { wakeSupported } from "./support";
import { useWakePreference } from "./wake-preference";
import {
  setWakeProcessing,
  setWakeStatus,
  useWakePausedByYou,
  type WakePauseReason,
} from "./wake-status";

/**
 * "Hey Q" (D1/D2, ADR 0058), mounted once in the global Q provider.
 *
 * Off (the default) it renders nothing and loads nothing: the engine is a
 * separate chunk imported only once the toggle is on. On, it listens only
 * while the page is on screen, Q is not already on a call, the battery is
 * not low and the person has not paused it from the indicator.
 *
 * A wake opens Q at once: the wake sound plays, the panel opens (the Q
 * page is already Q), and the live line starts with Q's greeting as its
 * first spoken line, so no model composes an opening first.
 */

/**
 * After a wake the listener closes the microphone for the call. If no line
 * shows up by then (no Q session, the line failed to open, the person
 * dismissed it at once), it listens again after this. Before, it stayed
 * stopped for good while the indicator still said "Listening": the main
 * "works sometimes" (owner, 5 Nov 2026).
 */
export const WAKE_REARM_MS = 3000;
/** First retry after the microphone was busy or went away; doubles to a cap. */
export const WAKE_RETRY_MS = 2000;
const WAKE_RETRY_MAX_MS = 30_000;
const Q_PAGE = "/home";
const LOW_BATTERY = 0.2;

export type WakeConditions = {
  readonly enabled: boolean;
  readonly supported: boolean;
  readonly visible: boolean;
  readonly inCall: boolean;
  readonly lowBattery: boolean;
  readonly pausedByYou: boolean;
};

/** Listen now, or the reason not to. Pure, for tests. */
export function wakeDecision(
  conditions: WakeConditions,
): "LISTEN" | "OFF" | "UNAVAILABLE" | WakePauseReason {
  if (!conditions.enabled) return "OFF";
  if (!conditions.supported) return "UNAVAILABLE";
  if (conditions.pausedByYou) return "BY_YOU";
  if (conditions.inCall) return "IN_CALL";
  if (!conditions.visible) return "HIDDEN";
  if (conditions.lowBattery) return "BATTERY";
  return "LISTEN";
}

function subscribeVisibility(onChange: () => void): () => void {
  document.addEventListener("visibilitychange", onChange);
  return () => document.removeEventListener("visibilitychange", onChange);
}

function usePageVisible(): boolean {
  return useSyncExternalStore(
    subscribeVisibility,
    () => document.visibilityState === "visible",
    () => false,
  );
}

/**
 * Whether the tab already has a voice line: one a surface holds (the
 * voice-line holder), any line playing audio, or Q's own session on a
 * call. Read at the moment of a wake, not from a render.
 */
export function voiceLineOpen(sessionVoiceActive = false): boolean {
  return (
    sessionVoiceActive ||
    voiceLineHolder() !== null ||
    voiceAudioOwner() !== null
  );
}

/**
 * What a heard wake phrase does. One line per tab: if a line is already
 * open (a race with a surface that just opened one), the wake does
 * nothing at all -- no sound, no panel, no second session -- and the
 * listener is stopped by the line it now sees. Otherwise Q's existing
 * session talks (`talk` reuses the tab's line owner, voice-line.ts).
 * Returns whether it acted.
 */
export function respondToWake(input: {
  readonly lineOpen: boolean;
  readonly onQPage: boolean;
  readonly sound: () => void;
  readonly openQ: () => void;
  readonly talk: () => void;
}): boolean {
  if (input.lineOpen) return false;
  input.sound();
  if (!input.onQPage) input.openQ();
  input.talk();
  return true;
}

function watchAnyLine(watcher: () => void): () => void {
  const lines = watchVoiceLine(watcher);
  const audio = watchVoiceAudio(watcher);
  const holds = watchMicrophoneHolds(watcher);
  return () => {
    lines();
    audio();
    holds();
  };
}

/**
 * Any line is up: one a surface holds, any line playing audio (V), or a
 * recorder holding the microphone (a voice note).
 */
function useLineHeld(): boolean {
  return useSyncExternalStore(
    watchAnyLine,
    () =>
      voiceLineHolder() !== null ||
      voiceAudioOwner() !== null ||
      microphoneHeld(),
    () => false,
  );
}

type BatteryLike = EventTarget & {
  readonly charging: boolean;
  readonly level: number;
};

function isBattery(value: unknown): value is BatteryLike {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof Reflect.get(value, "level") === "number" &&
    typeof Reflect.get(value, "charging") === "boolean"
  );
}

/**
 * Low and not charging, where the Battery Status API exists (Chromium).
 * The closest the web gets to "battery saver"; elsewhere this is false.
 */
function useLowBattery(): boolean {
  const [low, setLow] = useState(false);
  useEffect(() => {
    const getBattery: unknown = Reflect.get(navigator, "getBattery");
    if (typeof getBattery !== "function") return;
    let battery: BatteryLike | null = null;
    let cancelled = false;
    const update = () => {
      if (battery !== null) {
        setLow(!battery.charging && battery.level <= LOW_BATTERY);
      }
    };
    void Promise.resolve(Reflect.apply(getBattery, navigator, []))
      .then((value: unknown) => {
        if (cancelled || !isBattery(value)) return;
        battery = value;
        update();
        value.addEventListener("levelchange", update);
        value.addEventListener("chargingchange", update);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      battery?.removeEventListener("levelchange", update);
      battery?.removeEventListener("chargingchange", update);
    };
  }, []);
  return low;
}

export function WakeWord({
  openQ,
}: {
  /** Open Q beside the page (the global panel). */
  readonly openQ: () => void;
}) {
  const enabled = useWakePreference();
  useEffect(() => {
    if (!enabled) setWakeStatus({ kind: "OFF" });
  }, [enabled]);
  if (!enabled) return null;
  return <WakeListener openQ={openQ} />;
}

function WakeListener({ openQ }: { readonly openQ: () => void }) {
  const session = useQSessionOptional();
  const pathname = usePathname();
  const visible = usePageVisible();
  const lineHeld = useLineHeld();
  const lowBattery = useLowBattery();
  const pausedByYou = useWakePausedByYou();
  const [failed, setFailed] = useState<EngineFailure | null>(null);
  // Bumped to start the engine again with nothing else changed: after a
  // wake that opened no line, and to retry an interrupted microphone.
  const [generation, setGeneration] = useState(0);
  const retries = useRef(0);
  // Checked before the microphone opens, so the first window already
  // runs where Settings says it does.
  const onDevice = useOnDeviceStatus();
  const decision = wakeDecision({
    enabled: true,
    supported: wakeSupported() && failed !== "unavailable",
    visible,
    inCall: lineHeld || session?.voice.active === true,
    lowBattery,
    pausedByYou,
  });

  // The wake's work reads the latest Q without restarting the engine.
  const latest = useRef({ session, pathname, openQ });
  useEffect(() => {
    latest.current = { session, pathname, openQ };
  });

  // A refusal stands until the person does something: the tab goes away
  // and comes back, a call ends, they pause and resume. Before, one refusal
  // (or a busy microphone right after a call) stopped "Hey Q" until reload.
  const paused =
    decision !== "LISTEN" && decision !== "OFF" && decision !== "UNAVAILABLE";
  const [wasPaused, setWasPaused] = useState(paused);
  if (wasPaused !== paused) {
    // Adjusted while rendering (not in an effect): one render, no cascade.
    setWasPaused(paused);
    if (paused && failed !== null && failed !== "unavailable") setFailed(null);
  }

  const listen = decision === "LISTEN" && failed === null && onDevice !== null;
  const processLocally = onDevice === "available";
  useEffect(() => {
    if (decision === "LISTEN") {
      if (failed === "blocked" || failed === "microphone") {
        setWakeStatus({ kind: "BLOCKED" });
      }
    } else if (decision === "UNAVAILABLE") {
      setWakeStatus({ kind: "UNAVAILABLE" });
    } else if (decision !== "OFF") {
      setWakeStatus({ kind: "PAUSED", reason: decision });
    }
  }, [decision, failed]);

  useEffect(() => {
    if (!listen) return;
    let engine: WakeEngine | null = null;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const again = (delayMs: number) => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (!cancelled) setGeneration((g) => g + 1);
      }, delayMs);
    };
    void import("./engine").then(async ({ startWakeEngine }) => {
      if (cancelled) return;
      const started = await startWakeEngine({
        processLocally,
        onProcessing: (where) => {
          if (!cancelled) setWakeProcessing(where);
        },
        onWake: () => {
          const { session: q, pathname: path, openQ: open } = latest.current;
          const acted = respondToWake({
            lineOpen: voiceLineOpen(q?.voice.active === true),
            onQPage: path === Q_PAGE,
            // The person asked for Q by name: the acknowledgement plays
            // unless they turned Q's sounds off.
            sound: () => {
              if (readSoundPreference() !== "OFF") playSound("wake");
            },
            openQ: open,
            talk: () => {
              // Voice means the Q view (owner 2026-11-06): Chat would end
              // the line, so the wake chooses Q's voice view first, on the
              // Q page or the one it is about to open.
              showQVoiceView();
              void q?.talk({ greeting: WAKE_GREETING });
            },
          });
          if (!acted) return;
          // The microphone is the call's now. A line that opens pauses
          // this listener (IN_CALL); one that never opens must not leave
          // it stopped for good.
          void engine?.stop();
          setWakeStatus({ kind: "PAUSED", reason: "IN_CALL" });
          again(WAKE_REARM_MS);
        },
        onFailure: (failure) => {
          if (cancelled) return;
          if (failure === "interrupted") {
            void engine?.stop();
            setWakeProcessing(null);
            setWakeStatus({ kind: "PAUSED", reason: "RETRYING" });
            const delay = Math.min(
              WAKE_RETRY_MS * 2 ** retries.current,
              WAKE_RETRY_MAX_MS,
            );
            retries.current += 1;
            again(delay);
            return;
          }
          setFailed(failure);
        },
        onWindow: (open) => {
          if (!cancelled) {
            setWakeStatus({ kind: open ? "HEARING" : "LISTENING" });
          }
        },
      });
      if (cancelled) {
        await started.stop();
        return;
      }
      engine = started;
      setWakeStatus({ kind: "LISTENING" });
    });
    return () => {
      cancelled = true;
      clearTimeout(timer);
      setWakeProcessing(null);
      void engine?.stop();
    };
  }, [listen, processLocally, generation]);

  // A pause by the person, a call or a hidden tab is a fresh start: the
  // next interruption retries quickly again.
  useEffect(() => {
    if (paused) retries.current = 0;
  }, [paused]);

  useEffect(() => () => setWakeStatus({ kind: "OFF" }), []);
  return null;
}
