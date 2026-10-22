"use client";

import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";

import { RESUME_KEY } from "./resume";
import { markQPitchRunning } from "./tour-presence";
import { markStoryAvailable, useStoryTrigger } from "./story/story-offer";
import type { TourSubject } from "./subject-model";
import type { TourChoice } from "./tour-host";

/** v7: the story track (`?qpitch=story`) has its own host. */
type EntryChoice = TourChoice | "story";
type Start = {
  readonly tour: EntryChoice;
  readonly chapter: string | null;
  /** Asked for in words: the story starts on arrival (`&start=`). */
  readonly autostart?: boolean;
};
function choiceOf(value: string | null): EntryChoice | null {
  return value === "story" || value === "founder-v6" || value === "investor-v6"
    ? value
    : null;
}
const CHAPTER = /^ch\.[a-z0-9][a-z0-9.-]{1,62}$/u;

let lastRead: { readonly search: string; readonly start: Start | null } | null =
  null;

function readResume(): Start | null {
  try {
    const raw = window.sessionStorage.getItem(RESUME_KEY);
    if (raw === null) return null;
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null) return null;
    const record = value as { tour?: unknown; chapter?: unknown };
    const tour = choiceOf(typeof record.tour === "string" ? record.tour : null);
    if (tour === null) return null;
    const chapter =
      typeof record.chapter === "string" && CHAPTER.test(record.chapter)
        ? record.chapter
        : null;
    return { tour, chapter };
  } catch {
    return null;
  }
}
/** Parsed once per address, so the result is stable between renders. */
function readStart(search: string): Start | null {
  if (lastRead?.search === search) return lastRead.start;
  const params = new URLSearchParams(search);
  const tour = choiceOf(params.get("qpitch"));
  const chapter = params.get("chapter");
  const start: Start | null =
    tour === null
      ? null
      : {
          tour,
          chapter: chapter !== null && CHAPTER.test(chapter) ? chapter : null,
          autostart: params.has("start"),
        };
  const resumed = start ?? readResume();
  lastRead = { search, start: resumed };
  return resumed;
}

/**
 * Starts Q Pitch when the page is opened with `?qpitch=story` (the v7
 * story, its own host) or a v6 track (`?qpitch=investor-v6`,
 * `?qpitch=founder-v6`), optionally `&chapter=<id>`. The v5 tours (pilot,
 * premiere, short, atlas) are retired.
 * The host's code loads only then. Once started, the tour lives in the
 * application layout, so it survives route changes until "End tour".
 *
 * Rendered only when the server enabled Q Pitch (CQ_Q_PITCH_TOUR=1). The
 * host still refuses any account that is not a fictional demo account.
 */
const QPitchHost = dynamic(
  () => import("./tour-host").then((m) => m.QPitchHost),
  { ssr: false },
);

const StoryHost = dynamic(
  () => import("./story/story-host").then((m) => m.StoryHost),
  { ssr: false },
);

const noSubscription = () => () => undefined;

export function QPitchEntry({
  account,
  role,
  subject = null,
}: {
  readonly account: string;
  readonly subject?: TourSubject | null | undefined;
  readonly role: "INVESTOR" | "FOUNDER";
}) {
  // Read from the address on every route change, not only the first load:
  // Q's own move to "/home?qpitch=..." (the natural-language trigger, live
  // 2026-10-17) is a client navigation, and this host lives in the layout.
  // Latched: the tour outlives route changes whose address no longer
  // carries the parameter; a new ask after "End tour" starts it again.
  // Read in the browser only (the session's resume), after hydration.
  const search = useSearchParams().toString();
  const client = useSyncExternalStore(
    noSubscription,
    () => true,
    () => false,
  );
  const [seen, setSeen] = useState<string | null>(null);
  const [started, setStarted] = useState<Start | null>(null);
  const [ended, setEnded] = useState(false);
  if (client && seen !== search) {
    setSeen(search);
    const asked = readStart(search === "" ? "" : `?${search}`);
    if (asked !== null && started === null) setStarted(asked);
    else if (asked !== null && ended && search.includes("qpitch=")) {
      setStarted(asked);
      setEnded(false);
    }
  }
  const holding = started !== null && !ended;
  useStoryTrigger(!holding);
  // Q Pitch is on here (the server mounted this entry): Q may offer the
  // story under a "what is Capital Q?" answer.
  useEffect(() => {
    markStoryAvailable(true);
    return () => markStoryAvailable(false);
  }, []);
  useEffect(() => {
    markQPitchRunning(holding);
    return () => markQPitchRunning(false);
  }, [holding]);
  if (started === null || ended) return null;
  const exit = () => {
    try {
      window.sessionStorage.removeItem(RESUME_KEY);
    } catch {
      // Nothing kept, nothing to clear.
    }
    setEnded(true);
  };
  if (started.tour === "story") {
    return (
      <StoryHost
        account={account}
        role={role}
        onExit={exit}
        autostart={started.autostart === true}
      />
    );
  }
  return (
    <QPitchHost
      account={account}
      role={role}
      tour={started.tour}
      chapter={started.chapter}
      subject={subject}
      onExit={exit}
    />
  );
}
