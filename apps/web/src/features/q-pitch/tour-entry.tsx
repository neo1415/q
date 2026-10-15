"use client";

import dynamic from "next/dynamic";
import { useState, useSyncExternalStore } from "react";

/**
 * Starts a Q Pitch rehearsal when the page is opened with `?qpitch=pilot`.
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
}: {
  readonly account: string;
  readonly role: "INVESTOR" | "FOUNDER";
}) {
  // Read once from the address the page was opened with; false on the server.
  const asked = useSyncExternalStore(
    noSubscription,
    () => new URLSearchParams(window.location.search).get("qpitch") === "pilot",
    () => false,
  );
  // Latched: the tour must outlive the first route change, whose address no
  // longer carries the parameter.
  const [started, setStarted] = useState(false);
  const [ended, setEnded] = useState(false);
  if (asked && !started) setStarted(true);
  const active = started && !ended;
  if (!active) return null;
  return (
    <QPitchHost account={account} role={role} onExit={() => setEnded(true)} />
  );
}
