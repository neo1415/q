"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";

import { useQSessionOptional } from "../q/q-session";
import { playSound } from "../q-sound/sound-engine";
import { readSoundPreference } from "../q-sound/sound-preference";
import { voiceLineHolder, watchVoiceLine } from "../voice/voice-line";
import type { EngineFailure, WakeEngine } from "./engine";
import { WAKE_GREETING } from "./phrases";
import { wakeSupported } from "./support";
import { useWakePreference } from "./wake-preference";
import {
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

function useLineHeld(): boolean {
  return useSyncExternalStore(
    watchVoiceLine,
    () => voiceLineHolder() !== null,
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

  const listen = decision === "LISTEN" && failed === null;
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
    void import("./engine").then(async ({ startWakeEngine }) => {
      if (cancelled) return;
      const started = await startWakeEngine({
        onWake: () => {
          void engine?.stop();
          const { session: q, pathname: path, openQ: open } = latest.current;
          // The person asked for Q by name: the acknowledgement plays
          // unless they turned Q's sounds off.
          if (readSoundPreference() !== "OFF") playSound("wake");
          if (path !== Q_PAGE) open();
          void q?.talk({ greeting: WAKE_GREETING });
        },
        onFailure: (failure) => {
          if (!cancelled) setFailed(failure);
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
      void engine?.stop();
    };
  }, [listen]);

  useEffect(() => () => setWakeStatus({ kind: "OFF" }), []);
  return null;
}
