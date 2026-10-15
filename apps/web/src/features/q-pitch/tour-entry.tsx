"use client";

import dynamic from "next/dynamic";
import { useState, useSyncExternalStore } from "react";

import { RESUME_KEY } from "./resume";
import type { TourSubject } from "./subject-model";
import type { TourChoice } from "./tour-host";

type Start = { readonly tour: TourChoice; readonly chapter: string | null };
function choiceOf(value: string | null): TourChoice | null {
  return value === "pilot" || value === "premiere" || value === "short"
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
/** Parsed once per address, so the snapshot is stable between renders. */
function readStart(): Start | null {
  const search = window.location.search;
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
        };
  const resumed = start ?? readResume();
  lastRead = { search, start: resumed };
  return resumed;
}

/**
 * Starts a Q Pitch rehearsal when the page is opened with `?qpitch=pilot`
 * (the certified pilot), `?qpitch=premiere` (the r3 cut, internal only) or
 * `?qpitch=short` (two minutes), optionally `&chapter=<id>` (Feature Atlas).
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
  // Read once from the address the page was opened with; false on the server.
  // Read from the address the page was opened with; null on the server.
  const asked = useSyncExternalStore(noSubscription, readStart, () => null);
  // Latched: the tour must outlive the first route change, whose address no
  // longer carries the parameter.
  const [started, setStarted] = useState<Start | null>(null);
  const [ended, setEnded] = useState(false);
  if (asked !== null && started === null) setStarted(asked);
  if (started === null || ended) return null;
  return (
    <QPitchHost
      account={account}
      role={role}
      tour={started.tour}
      chapter={started.chapter}
      subject={subject}
      onExit={() => {
        try {
          window.sessionStorage.removeItem(RESUME_KEY);
        } catch {
          // Nothing kept, nothing to clear.
        }
        setEnded(true);
      }}
    />
  );
}
