import type { Metadata } from "next";
import { notFound } from "next/navigation";

import {
  PageContainer,
  PageHeader,
} from "@/components/app-shell/page-container";

import { PresencePlayground } from "./presence-playground";

export const metadata: Metadata = {
  title: "Q presence",
  robots: { index: false },
};

/**
 * Every state and gesture of Q's particle presence (PRESENCE spec §7), for
 * design review and the screenshot checks. Development only.
 *
 * `?state=SPEAKING` starts in a state; `?gesture=MONEY` plays a gesture
 * once the page is up (and again every few seconds, for screenshots).
 * `?face=1` lets the stage show Q's speaking face (as the Q page does);
 * `?play=shapes` or `?play=face` cycles the states for a screen recording.
 */
export default async function PresencePage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (process.env.NODE_ENV === "production") {
    notFound();
  }
  const params = await searchParams;
  const one = (value: string | string[] | undefined) =>
    Array.isArray(value) ? value[0] : value;
  return (
    <PageContainer width="content">
      <PageHeader
        title="Q presence"
        description="What Q's particles form for each state and for each gesture an answer can ask for. Levels here are synthetic; in the product they come from the microphone and Q's voice."
      />
      <PresencePlayground
        initialState={one(params["state"]) ?? null}
        initialGesture={one(params["gesture"]) ?? null}
        initialFace={one(params["face"]) === "1"}
        play={one(params["play"]) ?? null}
      />
    </PageContainer>
  );
}
