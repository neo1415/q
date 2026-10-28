"use client";

import { useEffect, useRef } from "react";

/**
 * A validation message beside the field it is about (live typed run
 * 2026-10-28, D3): on a fourteen-question form, "Answer X to continue"
 * printed at the very bottom, under the sticky Continue bar, so eight
 * presses looked like a button that did nothing. The message sits next to
 * its field, is announced, and is scrolled into view when it appears;
 * the button itself stays enabled, because a disabled button says even
 * less.
 */
export function FieldProblem({
  id,
  children,
}: {
  readonly id?: string | undefined;
  readonly children: string;
}) {
  const ref = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    const note = ref.current;
    if (note !== null) revealProblem(note);
  }, [children]);
  return (
    <p
      ref={ref}
      id={id}
      role="alert"
      className="cq-caption text-(--cq-danger)"
      data-field-problem
    >
      {children}
    </p>
  );
}

/**
 * Scroll a problem into view and move focus to the first control of the
 * field it sits in (its nearest fieldset or labelled group), so the next
 * key or tap answers it.
 */
export function revealProblem(note: HTMLElement): void {
  if (typeof note.scrollIntoView === "function") {
    note.scrollIntoView({ block: "center", behavior: "smooth" });
  }
  const field = note.closest("fieldset") ?? note.parentElement;
  const control = field?.querySelector<HTMLElement>(
    "input:not([disabled]), select, textarea, button",
  );
  control?.focus({ preventScroll: true });
}

/**
 * The first validation message on the step, revealed after a Continue that
 * did not move on (the shell's catch-all for every step that prints its
 * message at the end of the form).
 */
export function revealFirstProblem(root: ParentNode = document): void {
  const note = root.querySelector<HTMLElement>('#main [role="alert"]');
  if (note !== null) revealProblem(note);
}
