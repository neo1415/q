"use client";

import dynamic from "next/dynamic";
import { useSyncExternalStore } from "react";

import {
  STORY_LEDGER,
  type StoryEditionId,
  type StoryRoute,
} from "@capital-q/q-pitch";

/**
 * The fictional demo account the story's claims are certified for (the
 * ledger's actor): the harness plays the story as that account sees it, so
 * the certification gate (and its "Internal rehearsal" stamp) is the real
 * one, never bypassed.
 */
const HARNESS_ACCOUNT = STORY_LEDGER[0]?.actorContext.account ?? "harness";

const StoryHost = dynamic(
  () => import("@/features/q-pitch/story/story-host").then((m) => m.StoryHost),
  { ssr: false },
);

/** The story's pages, as the dev review pages that render them. */
function harnessPath(route: StoryRoute): string {
  switch (route) {
    case "home":
      return "/dev/story";
    case "discover":
      return "/dev/story/discover";
    case "capital-mandate":
      return "/dev/story/crm?view=capital";
    case "company-diligence":
      return "/dev/story/profile?tab=diligence";
    case "relationship-prep":
      return "/dev/story/crm?view=record";
    case "gateq-gate":
      return "/dev/story/gateq?view=gate";
    case "gateq-application":
      return "/dev/story/gateq-review?page=investor-inbox&state=dossier";
    case "gateq-inbox":
      return "/dev/story/gateq?view=inbox";
  }
}

const HARNESS = { pathFor: harnessPath };
/** `?stills=1`: as any viewer but the certified demo actor sees it. */
const STILLS = { pathFor: harnessPath, live: false };
const VOICE_ID = /^[A-Za-z0-9]{8,40}$/u;

/** `?voice=<id>`: another rendered voice set, for a one-command re-record. */
function voiceOf(search: string): string | undefined {
  const voice = new URLSearchParams(search).get("voice");
  return voice !== null && VOICE_ID.test(voice) ? voice : undefined;
}

/**
 * `?film=1`: the recorded master (film type sizes, no controls). Read once
 * per page load: the story's own moves leave the parameter behind.
 */
let filmLatch: boolean | null = null;
function filmOnce(): boolean {
  filmLatch ??= new URLSearchParams(window.location.search).get("film") === "1";
  return filmLatch;
}

let stillsLatch: boolean | null = null;
function stillsOnce(): boolean {
  stillsLatch ??=
    new URLSearchParams(window.location.search).get("stills") === "1";
  return stillsLatch;
}

/** `?edition=investor|founder`: one of the story's cuts. Read once too. */
let editionLatch: StoryEditionId | null = null;
function editionOnce(): StoryEditionId {
  if (editionLatch === null) {
    const asked = new URLSearchParams(window.location.search).get("edition");
    editionLatch =
      asked === "investor"
        ? "INVESTOR"
        : asked === "founder"
          ? "FOUNDER"
          : "FULL";
  }
  return editionLatch;
}

export function StoryHarnessHost() {
  const voice = useSyncExternalStore(
    noSubscription,
    () => voiceOf(window.location.search),
    () => undefined,
  );
  const film = useSyncExternalStore(noSubscription, filmOnce, () => false);
  const stills = useSyncExternalStore(noSubscription, stillsOnce, () => false);
  const edition = useSyncExternalStore(
    noSubscription,
    editionOnce,
    () => "FULL" as const,
  );
  return (
    <StoryHost
      account={HARNESS_ACCOUNT}
      role="INVESTOR"
      harness={stills ? STILLS : HARNESS}
      voice={voice}
      film={film}
      edition={edition}
      onExit={() => undefined}
    />
  );
}

const noSubscription = () => () => undefined;
