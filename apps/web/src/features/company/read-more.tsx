"use client";

import { useId, useState } from "react";

/** Past about six lines on a phone, the text opens on request. */
const LONG = 420;

/**
 * The founder's own words, whole and unsplit (P0-4 2026-10-03). The page
 * never cuts their text into claims or sections it did not declare; a
 * long description is clamped for reading and opens in full on request.
 * Line breaks the founder wrote are kept.
 */
export function ReadMore({ text }: { readonly text: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const long = text.length > LONG;
  return (
    <div className="flex max-w-(--cq-layout-reading) flex-col items-start gap-2">
      <p
        id={id}
        className={`cq-prose whitespace-pre-line text-(--cq-text-primary) ${
          long && !open ? "line-clamp-6" : ""
        }`}
      >
        {text}
      </p>
      {long ? (
        <button
          type="button"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen((value) => !value)}
          className="cq-body-sm inline-flex min-h-11 items-center text-(--cq-text-primary) underline underline-offset-4"
        >
          {open ? "Show less" : "Read more"}
        </button>
      ) : null}
    </div>
  );
}
