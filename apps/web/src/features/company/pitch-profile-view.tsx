"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { ReadCarousel } from "./material/deck-sections";
import type { PitchProfileSection } from "./pitch-profile";
import { useProfileTab } from "./profile-tabs";

/**
 * The profile's Overview, section by section (owner 2026-10-16): the same
 * carousel, chips and card as Q's read of the deck, so an investor reads
 * every company in one shape. Q opens a section from anywhere with
 * `?tab=overview&sub=<section key>` ("show me Harbourline's market"); it
 * is only a view of what this reader already has.
 */
export function PitchProfileOverview({
  sections,
  companyName,
  own,
}: {
  readonly sections: readonly PitchProfileSection[];
  readonly companyName: string;
  readonly own: boolean;
}) {
  const params = useSearchParams();
  const tab = useProfileTab();
  const sub =
    tab === null || tab === "overview"
      ? (params?.get("sub")?.toLowerCase() ?? null)
      : null;
  const askedAt =
    sub === null
      ? -1
      : sections.findIndex((section) => section.sectionKey === sub);
  // A pick holds until Q (or a link) asks for another section.
  const [picked, setPicked] = useState<{
    readonly for: string | null;
    readonly at: number;
  } | null>(null);
  const index =
    picked !== null && picked.for === sub
      ? picked.at
      : askedAt >= 0
        ? askedAt
        : 0;
  const top = useRef<HTMLElement>(null);
  useEffect(() => {
    if (askedAt < 0) return;
    top.current?.scrollIntoView?.({ block: "start", behavior: "smooth" });
  }, [askedAt]);

  const provided = sections.filter((section) => section.provided).length;
  const fromDeck = sections.filter(
    (section) => section.status === "PRESENT",
  ).length;
  return (
    <section
      ref={top}
      className="flex flex-col gap-3"
      aria-labelledby="pitch-profile-title"
      data-pitch-profile={own ? "owner" : "reader"}
    >
      <div className="flex flex-col gap-1">
        <h2
          id="pitch-profile-title"
          className="cq-title-md text-(--cq-text-primary)"
        >
          {own
            ? "Your profile, section by section"
            : `${companyName}, section by section`}
        </h2>
        <p
          className="cq-body-sm text-(--cq-text-secondary)"
          data-pitch-profile-summary
        >
          {provided} of {sections.length} sections provided
          {fromDeck === 0 ? "" : ` · ${String(fromDeck)} from the deck`}.
          {own
            ? " Gaps are yours to fill: tell Q."
            : " Figures are the company’s own claims unless marked verified."}
        </p>
      </div>
      <ReadCarousel
        sections={sections}
        attribute="profile"
        label={`${companyName}'s profile, section by section`}
        index={index}
        onIndex={(at) => setPicked({ for: sub, at })}
      />
    </section>
  );
}
