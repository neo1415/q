"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useSyncExternalStore } from "react";

import { classifyStoryTrigger, type StoryEditionId } from "@capital-q/q-pitch";
import { buttonClassName } from "@capital-q/ui/button";

import { useQSessionOptional } from "@/features/q/q-session";
import { setTypedInterceptor } from "@/features/q/typed-intercept";
import { setHeardInterceptor } from "@/features/voice/heard-intercept";

/**
 * "What is Capital Q?" asked alone (plan §4): Q answers briefly (turn
 * reader v57) and, under that answer, offers the story as one tap. Never
 * started unasked; ignoring the chip is declining it.
 *
 * Shown only where Q Pitch is on: the Q Pitch entry, which the server
 * mounts only when CQ_Q_PITCH_TOUR is set, marks the story available.
 */
let available = false;
const listeners = new Set<() => void>();

export function markStoryAvailable(on: boolean): void {
  if (available === on) return;
  available = on;
  for (const listener of listeners) listener();
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** The story's start, as Q's Q_PITCH destination opens it for an investor. */
export const STORY_START_HREF = "/home?qpitch=story&new=1";

/**
 * The story asked for in words (a tap, "Hey Q, pitch yourself"): it starts
 * on arrival, no second press. Each ask is a new address, so asking again
 * after the story ended starts it again.
 */
export function storyAskedHref(edition: StoryEditionId = "FULL"): string {
  const cut = edition === "FULL" ? "" : `&edition=${edition.toLowerCase()}`;
  return `${STORY_START_HREF}${cut}&start=${Date.now().toString(36)}`;
}

/**
 * "Hey Q, pitch yourself", "present Capital Q", "tell me your story",
 * typed or said, from any page where Q Pitch is on: straight into the
 * story, by code (classifyStoryTrigger), no model call and no turn. Held
 * only while no tour runs; a running story takes words itself.
 */
export function useStoryTrigger(active: boolean): void {
  const router = useRouter();
  const session = useQSessionOptional();
  // An open voice line ends when the story starts (owner, 23 Oct): its
  // model never answers over the story, and its microphone never hears
  // the story's narration as the person's words.
  const voiceRef = useRef(session?.voice);
  useEffect(() => {
    voiceRef.current = session?.voice;
  }, [session?.voice]);
  useEffect(() => {
    if (!active) return;
    const start = (said: string, line: "TYPED" | "HEARD"): boolean => {
      const asked = classifyStoryTrigger(said);
      if (asked?.kind !== "STORY") return false;
      // A heard ask closes its own line (heard-intercept.ts); a typed one
      // while a line is open ends it here.
      const voice = voiceRef.current;
      if (line === "TYPED" && voice?.active === true) {
        void voice.client.end().catch(() => undefined);
      }
      router.push(storyAskedHref(asked.edition));
      return true;
    };
    const releaseTyped = setTypedInterceptor((text) => start(text, "TYPED"));
    // Said on a voice line: the final transcript, before the line's model
    // may answer it.
    const releaseHeard = setHeardInterceptor((said) => start(said, "HEARD"));
    return () => {
      releaseTyped();
      releaseHeard();
    };
  }, [active, router]);

  // Said aloud on a line that reports the person's words as lines (the
  // providers that never reach heard-intercept): their own lines only,
  // each once, never one from before this page held the trigger.
  const spoken = session?.spoken;
  const heard = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!active || spoken === undefined) {
      heard.current = null;
      return;
    }
    if (heard.current === null) {
      heard.current = new Set(spoken.map((line) => line.id));
      return;
    }
    for (const line of spoken) {
      if (heard.current.has(line.id)) continue;
      heard.current.add(line.id);
      if (line.role !== "user") continue;
      const asked = classifyStoryTrigger(line.text);
      if (asked?.kind === "STORY") {
        const voice = voiceRef.current;
        if (voice?.active === true) {
          void voice.client.end().catch(() => undefined);
        }
        router.push(storyAskedHref(asked.edition));
        return;
      }
    }
  }, [active, spoken, router]);
}

/** The person's turn just before Q's answer `turnId`, if any. */
export function askedBefore(
  turns: readonly {
    readonly kind: string;
    readonly id: string;
    readonly text: string;
  }[],
  turnId: string,
): string | null {
  const at = turns.findIndex((turn) => turn.id === turnId);
  for (let i = at - 1; i >= 0; i -= 1) {
    const turn = turns[i];
    if (turn?.kind === "PERSON") return turn.text;
    if (turn?.kind === "Q") return null;
  }
  return null;
}

export function StoryOffer({ turnId }: { readonly turnId: string }) {
  const on = useSyncExternalStore(
    subscribe,
    () => available,
    () => false,
  );
  const session = useQSessionOptional();
  if (!on || session === null) return null;
  const asked = askedBefore(session.turns, turnId);
  if (asked === null || classifyStoryTrigger(asked)?.kind !== "BRIEF") {
    return null;
  }
  return (
    <div className="flex flex-wrap items-center gap-2" data-q-story-offer>
      <Link
        href={STORY_START_HREF + "&start=1"}
        className={buttonClassName("secondary")}
      >
        Show me the story · about 7 minutes
      </Link>
    </div>
  );
}
