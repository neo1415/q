"use client";

import { useEffect, useState } from "react";

import { cx } from "@capital-q/ui";

/**
 * Settings' index (chosen design "One page with an index", 2026-10-21): a
 * sticky list beside the sections on desktop. A tap scrolls smoothly to the
 * section, and the section in view is marked as you scroll. Plain anchors
 * underneath, so it works without script.
 */
export function SettingsJumpIndex({
  sections,
  label,
}: {
  readonly sections: readonly { readonly id: string; readonly label: string }[];
  readonly label: string;
}) {
  const [active, setActive] = useState(sections[0]?.id ?? "");
  useEffect(() => {
    const targets = sections
      .map((section) => document.getElementById(section.id))
      .filter((node): node is HTMLElement => node !== null);
    if (targets.length === 0 || typeof IntersectionObserver === "undefined") {
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        const seen = entries
          .filter((entry) => entry.isIntersecting)
          .toSorted(
            (a, b) => a.boundingClientRect.top - b.boundingClientRect.top,
          );
        const first = seen[0];
        if (first !== undefined) setActive(first.target.id);
      },
      { rootMargin: "0px 0px -70% 0px" },
    );
    for (const target of targets) observer.observe(target);
    return () => observer.disconnect();
  }, [sections]);
  return (
    <nav
      aria-label={label}
      className="hidden min-w-0 lg:sticky lg:top-6 lg:block lg:self-start"
      data-settings-index
    >
      <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
        {sections.map((section) => (
          <li key={section.id}>
            <a
              href={`#${section.id}`}
              aria-current={active === section.id ? "true" : undefined}
              onClick={(event) => {
                const target = document.getElementById(section.id);
                if (target === null) return;
                event.preventDefault();
                setActive(section.id);
                const reduce = window.matchMedia(
                  "(prefers-reduced-motion: reduce)",
                ).matches;
                target.scrollIntoView({
                  behavior: reduce ? "auto" : "smooth",
                  block: "start",
                });
                history.replaceState(null, "", `#${section.id}`);
              }}
              className={cx(
                "flex min-h-[38px] items-center rounded-(--cq-radius-md) px-3 text-sm transition-colors duration-(--cq-motion-fast) hover:bg-(--cq-surface-subtle) hover:text-(--cq-text-primary)",
                active === section.id
                  ? "bg-(--cq-surface-subtle) font-medium text-(--cq-text-primary)"
                  : "text-(--cq-text-secondary)",
              )}
            >
              {section.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
