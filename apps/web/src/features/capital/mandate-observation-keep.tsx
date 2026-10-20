"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";

import { Check } from "@capital-q/ui/icons";

import { crmButton, QRing } from "@/features/relationships/crm-kit";

const KEY = "cq.capital.mandate-note.kept.v1";

function month(): string {
  return new Date().toISOString().slice(0, 7);
}

/**
 * The observation's card and its "Keep as is": a per-device note that it
 * was seen this month (browser storage, a convenience only). It never
 * reaches the mandate or the server.
 */
export function KeepMandate({
  signature,
  title,
  kept,
  keep,
  review,
  children,
}: {
  /** What was noticed: a new observation shows again. */
  readonly signature: string;
  readonly title: string;
  readonly kept: string;
  readonly keep: string;
  readonly review: string;
  readonly children: ReactNode;
}) {
  const [state, setState] = useState<"open" | "kept" | "hidden">("open");
  useEffect(() => {
    try {
      if (window.localStorage.getItem(KEY) === `${month()}|${signature}`)
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setState("hidden");
    } catch {
      // No storage: the note shows; nothing else depends on it.
    }
  }, [signature]);
  if (state === "hidden") return null;
  return (
    <div
      className="flex flex-col gap-2 rounded-(--cq-radius-lg) border border-dashed border-(--cq-border) bg-(--cq-surface-subtle) p-3.5 text-sm text-(--cq-text-primary)"
      data-mandate-observation
    >
      {state === "kept" ? (
        <span className="cq-crm-swap flex items-center gap-2" role="status">
          <Check size={15} aria-hidden="true" />
          {kept}
        </span>
      ) : (
        <>
          <b className="flex items-center gap-2 font-semibold">
            <QRing />
            {title}
          </b>
          {children}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={crmButton("secondary")}
              onClick={() => {
                try {
                  window.localStorage.setItem(KEY, `${month()}|${signature}`);
                } catch {
                  // Kept for this visit only.
                }
                setState("kept");
              }}
            >
              {keep}
            </button>
            <Link
              href="/onboarding/investor?review=1"
              className={crmButton("quiet")}
            >
              {review}
            </Link>
          </div>
        </>
      )}
    </div>
  );
}
