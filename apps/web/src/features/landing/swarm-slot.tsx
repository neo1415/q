"use client";

import dynamic from "next/dynamic";

import type { LandingSwarmProps } from "./landing-swarm";

/**
 * The swarm's code is its own chunk, fetched only once its scene is near
 * the viewport. Until then the dark stage simply has no particles; the
 * canvas is absolutely positioned, so arriving never shifts anything.
 */
const LandingSwarm = dynamic(
  () => import("./landing-swarm").then((m) => m.LandingSwarm),
  { ssr: false },
);

export function SwarmSlot({
  near,
  ...props
}: LandingSwarmProps & { readonly near: boolean }) {
  return near ? <LandingSwarm {...props} /> : null;
}
