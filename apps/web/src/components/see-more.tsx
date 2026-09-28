"use client";

import { useEffect, useId, useRef, useState } from "react";

/**
 * Long text, clamped to a few lines with "See more" -- the LinkedIn
 * pattern. The toggle appears only when the text actually overflows, and
 * the full text is always in the DOM (screen readers and find-in-page
 * reach all of it; only the visual clamp changes).
 */
export function SeeMore({
  text,
  lines = 4,
  className,
}: {
  readonly text: string;
  readonly lines?: 3 | 4 | 6 | undefined;
  readonly className?: string | undefined;
}) {
  const id = useId();
  const ref = useRef<HTMLParagraphElement>(null);
  const [open, setOpen] = useState(false);
  const [overflows, setOverflows] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (element === null) return;
    const check = () => {
      if (!open) setOverflows(element.scrollHeight > element.clientHeight + 1);
    };
    check();
    const observer =
      typeof ResizeObserver === "function" ? new ResizeObserver(check) : null;
    observer?.observe(element);
    return () => observer?.disconnect();
  }, [open, text]);

  const clamp =
    lines === 3
      ? "line-clamp-3"
      : lines === 6
        ? "line-clamp-6"
        : "line-clamp-4";

  return (
    <div className="flex flex-col items-start gap-1">
      <p
        id={id}
        ref={ref}
        className={`${className ?? "cq-body text-(--cq-text-primary)"} break-words whitespace-pre-line ${open ? "" : clamp}`}
        data-see-more={open ? "open" : "clamped"}
      >
        {text}
      </p>
      {overflows || open ? (
        <button
          type="button"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen((value) => !value)}
          className="cq-body-sm -mx-2 inline-flex min-h-11 items-center rounded-md px-2 font-semibold text-(--cq-text-secondary) hover:text-(--cq-text-primary) focus-visible:outline-2 focus-visible:outline-(--cq-focus-ring)"
        >
          {open ? "See less" : "See more"}
        </button>
      ) : null}
    </div>
  );
}
