"use client";

import dynamic from "next/dynamic";

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

export function StoryHarnessHost() {
  return (
    <StoryHost
      account="harness"
      role="INVESTOR"
      harness={HARNESS}
      onExit={() => undefined}
    />
  );
}
