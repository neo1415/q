"use client";

import { useEffect, useRef, useState } from "react";

import "./founder-tour.css";

/**
 * The pitch board's index (founder track, step two): the template's
 * fourteen parts in order. While Q talks about a part, the tour lights its
 * section (`data-qp-lit`); the index follows it, and a gold thread runs
 * down to the part in focus, so the room sees where in the pitch Q is.
 * Read-only: it watches the page, it never moves the tour.
 */
export function PitchRail({
  sections,
}: {
  readonly sections: readonly {
    readonly key: string;
    readonly title: string;
    readonly anchor: string;
  }[];
}) {
  const [current, setCurrent] = useState<number>(-1);
  const list = useRef<HTMLOListElement>(null);
  const [thread, setThread] = useState(0);

  useEffect(() => {
    const read = () => {
      const lit = sections.findIndex((section) =>
        document
          .querySelector(`[data-qp-anchor~="${section.anchor}"]`)
          ?.hasAttribute("data-qp-lit"),
      );
      setCurrent((was) => (lit === -1 ? was : lit));
    };
    read();
    const observer = new MutationObserver(read);
    observer.observe(document.body, {
      subtree: true,
      attributes: true,
      attributeFilter: ["data-qp-lit"],
    });
    return () => observer.disconnect();
  }, [sections]);

  useEffect(() => {
    const item = list.current?.children.item(current);
    if (!(item instanceof HTMLElement)) {
      setThread(0);
      return;
    }
    setThread(item.offsetTop + item.offsetHeight);
  }, [current]);

  return (
    <nav aria-label="Pitch sections" className="cq-qp-rail">
      <div
        className="cq-qp-rail-track"
        style={{ ["--qp-thread" as string]: `${String(thread)}px` }}
      >
        <span className="cq-qp-thread" aria-hidden="true" />
        <ol ref={list}>
          {sections.map((section, index) => (
            <li key={section.key}>
              <a
                href={`#pitch-${section.key}`}
                className="cq-body-sm"
                aria-current={index === current ? "true" : undefined}
                data-passed={index < current ? "" : undefined}
              >
                <span className="cq-qp-num">{index + 1}</span>
                <span>{section.title}</span>
              </a>
            </li>
          ))}
        </ol>
      </div>
    </nav>
  );
}
