"use client";

import dynamic from "next/dynamic";
import { useState, useSyncExternalStore } from "react";

import type { TourChoice } from "./tour-host";

/**
 * Starts a Q Pitch rehearsal when the page is opened with `?qpitch=pilot`
 * (the certified pilot) or `?qpitch=premiere` (the r3 cut, internal only).
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
    (): TourChoice | null => {
      const asked = new URLSearchParams(window.location.search).get("qpitch");
      return asked === "pilot" || asked === "premiere" ? asked : null;
    },
    () => null,
  );
  // Latched: the tour must outlive the first route change, whose address no
  // longer carries the parameter.
  const [started, setStarted] = useState<TourChoice | null>(null);
  const [ended, setEnded] = useState(false);
  if (asked !== null && started === null) setStarted(asked);
  if (started === null || ended) return null;
  return (
    <QPitchHost
      account={account}
      role={role}
      tour={started}
      onExit={() => setEnded(true)}
    />
  );
}
