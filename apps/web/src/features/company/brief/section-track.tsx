"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";

import { ChevronLeft, ChevronRight, ICON_SIZE } from "@capital-q/ui/icons";

import { useT } from "@/features/i18n/language";

/**
 * "Section by section" (profile option 1; the founder's explicit ask): one
 * block per section, then the open section's detail, which moves like
 * turning a page.
 *
 *   phone    swipe the detail (CSS scroll snap: native momentum and
 *            rubber-banding, no gesture library); dots and "3 of 14" say
 *            where you are
 *   desktop  swipe on a trackpad, or the round arrows on the card's sides,
 *            or Left / Right with the strip or the detail focused
 *
 * A tap or an arrow scrolls smoothly (an occasional, spatial move); a key
 * press lands at once, since keyboard moves are repeated and should never
 * wait on an animation. The track's own scroll position says which section
 * is open (an observer, not a scroll handler), so a swipe, a tap and a key
 * always agree. Every section stays in the page for Q and assistive tech.
 */
export type TrackSection = {
  readonly key: string;
  readonly label: string;
  /** A gap is hatched; anything provided is solid. */
  readonly gap: boolean;
};

export function SectionTrack({
  sections,
  label,
  initial = 0,
  onIndex,
  render,
}: {
  readonly sections: readonly TrackSection[];
  readonly label: string;
  readonly initial?: number | undefined;
  readonly onIndex?: ((index: number) => void) | undefined;
  readonly render: (index: number) => ReactNode;
}) {
  const t = useT();
  const track = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState(() =>
    Math.max(0, Math.min(sections.length - 1, initial)),
  );
  const shown = useRef(at);
  const report = useRef(onIndex);
  useEffect(() => {
    report.current = onIndex;
  }, [onIndex]);

  const go = useCallback(
    (next: number, smooth: boolean) => {
      const root = track.current;
      const clamped = Math.max(0, Math.min(sections.length - 1, next));
      const card = root?.children[clamped];
      if (
        root !== null &&
        card instanceof HTMLElement &&
        typeof root.scrollTo === "function"
      ) {
        root.scrollTo({
          left: card.offsetLeft - root.offsetLeft,
          behavior: smooth ? "smooth" : "instant",
        });
      }
      // The observer confirms it; say it now so the strip answers at once.
      shown.current = clamped;
      setAt(clamped);
      report.current?.(clamped);
    },
    [sections.length],
  );

  // Opening on a section asked for from outside (Q, a link): no animation.
  const opening = useRef(at);
  useEffect(() => {
    if (opening.current > 0) go(opening.current, false);
  }, [go]);
  // Only a new outside request moves the track.
  const asked = useRef(initial);
  useEffect(() => {
    if (initial === asked.current) return;
    asked.current = initial;
    if (initial >= 0) go(initial, true);
  }, [initial, go]);

  useEffect(() => {
    const root = track.current;
    if (root === null || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting || entry.intersectionRatio < 0.6) continue;
          const index = Array.prototype.indexOf.call(
            root.children,
            entry.target,
          );
          if (index >= 0 && index !== shown.current) {
            shown.current = index;
            setAt(index);
            report.current?.(index);
          }
        }
      },
      { root, threshold: [0.6] },
    );
    for (const child of Array.from(root.children)) observer.observe(child);
    return () => observer.disconnect();
  }, [sections.length]);

  const onKey = (event: KeyboardEvent) => {
    const forward = event.key === "ArrowRight";
    const back = event.key === "ArrowLeft";
    if (!forward && !back) return;
    event.preventDefault();
    // Right-to-left reading turns the other way.
    const rtl =
      typeof document !== "undefined" &&
      document.documentElement.dir === "rtl";
    go(at + ((forward ? 1 : -1) * (rtl ? -1 : 1)), false);
  };

  const current = sections[at];
  return (
    <div className="flex flex-col gap-0" onKeyDown={onKey}>
      <div
        className="cq-brief-secstrip"
        role="group"
        aria-label={t("Sections")}
        data-section-strip
      >
        {sections.map((section, index) => (
          <button
            key={section.key}
            type="button"
            aria-label={`${section.label}${section.gap ? ", not provided" : ""}`}
            title={section.label}
            aria-current={index === at ? "true" : undefined}
            data-gap={section.gap ? "" : undefined}
            onClick={() => go(index, true)}
          />
        ))}
      </div>
      <div className="cq-brief-sections">
        <button
          type="button"
          className="cq-brief-arrow"
          data-side="prev"
          aria-label={t("Previous section")}
          disabled={at === 0}
          onClick={() => go(at - 1, true)}
        >
          <ChevronLeft size={ICON_SIZE.regular} aria-hidden="true" />
        </button>
        <div
          ref={track}
          className="cq-brief-track"
          tabIndex={0}
          role="region"
          aria-roledescription="carousel"
          aria-label={label}
          data-profile-carousel=""
        >
          {sections.map((section, index) => (
            <div
              key={section.key}
              className="cq-brief-secdetail"
              role="group"
              aria-roledescription="slide"
              aria-label={`${String(index + 1)} of ${String(sections.length)}: ${section.label}`}
              aria-current={index === at ? "true" : undefined}
              data-away={index === at ? undefined : ""}
              data-profile-section={section.key}
            >
              {render(index)}
            </div>
          ))}
        </div>
        <button
          type="button"
          className="cq-brief-arrow"
          data-side="next"
          aria-label={t("Next section")}
          disabled={at === sections.length - 1}
          onClick={() => go(at + 1, true)}
        >
          <ChevronRight size={ICON_SIZE.regular} aria-hidden="true" />
        </button>
      </div>
      <div className="cq-brief-secnav">
        <span className="cq-brief-pos" aria-live="polite">
          {String(at + 1)} of {String(sections.length)}
          {current === undefined ? "" : ` · ${current.label}`}
        </span>
        <span className="cq-brief-dots" aria-hidden="true">
          {sections.map((section, index) => (
            <i key={section.key} data-on={index === at ? "" : undefined} />
          ))}
        </span>
      </div>
    </div>
  );
}
