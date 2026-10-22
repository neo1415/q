"use client";

import dynamic from "next/dynamic";
import { useSyncExternalStore } from "react";

import type { StoryRoute } from "@capital-q/q-pitch";

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
      return "/dev/story/gateq?view=inbox-detail";
    case "gateq-inbox":
      return "/dev/story/gateq?view=inbox";
  }
}

const HARNESS = { pathFor: harnessPath };
const VOICE_ID = /^[A-Za-z0-9]{8,40}$/u;

/** `?voice=<id>`: another rendered voice set, for a one-command re-record. */
function voiceOf(search: string): string | undefined {
  const voice = new URLSearchParams(search).get("voice");
  return voice !== null && VOICE_ID.test(voice) ? voice : undefined;
}

export function StoryHarnessHost() {
  const voice = useSyncExternalStore(
    noSubscription,
    () => voiceOf(window.location.search),
    () => undefined,
  );
  return (
    <StoryHost
      account="harness"
      role="INVESTOR"
      harness={HARNESS}
      voice={voice}
      onExit={() => undefined}
    />
  );
}

const noSubscription = () => () => undefined;
