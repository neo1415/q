import type { ReactNode } from "react";

import {
  Check,
  FileText,
  ICON_SIZE,
  Lock,
  UserRound,
} from "@capital-q/ui/icons";

import "./brief.css";

/**
 * The decision brief's small parts (profile option 1): the Q mark, the
 * evidence labels, the coverage strip and the cards. Each label is a word
 * with its mark, never colour alone.
 */

/** Q, as the brief marks its own read: a ringed letter, never a sparkle. */
export function QMark() {
  return (
    <span className="cq-brief-qmark" aria-hidden="true">
      Q
    </span>
  );
}

/** The hatched swatch that means "not known yet". */
export function Hatch() {
  return <i className="cq-brief-hatch" aria-hidden="true" />;
}

/**
 * Where a fact stands, on the three evidence labels of the brief:
 *   doc    document-supported       ver   verified by Capital Q
 *   claim  the founder's claim      lock  not shared with you yet
 *   none   not verified yet         unk   not known yet
 */
export type Evidence = "doc" | "ver" | "claim" | "lock" | "none" | "unk";

export function EvidenceTag({
  evidence,
  where,
}: {
  readonly evidence: Evidence;
  readonly where?: string | null | undefined;
}) {
  const tag =
    evidence === "doc" ? (
      <span className="cq-brief-tag" data-tone="positive">
        <FileText size={ICON_SIZE.compact} aria-hidden="true" />
        Document-supported
      </span>
    ) : evidence === "ver" ? (
      <span className="cq-brief-tag" data-tone="positive">
        <Check size={ICON_SIZE.compact} aria-hidden="true" />
        Verified by Capital Q
      </span>
    ) : evidence === "claim" ? (
      <span className="cq-brief-tag" data-tone="claim">
        <UserRound size={ICON_SIZE.compact} aria-hidden="true" />
        Founder’s claim
      </span>
    ) : evidence === "lock" ? (
      <span className="cq-brief-tag">
        <Lock size={ICON_SIZE.compact} aria-hidden="true" />
        Not shared with you yet
      </span>
    ) : evidence === "none" ? (
      <span className="cq-brief-tag">Not verified yet</span>
    ) : (
      <span className="cq-brief-tag" data-tone="gap">
        <Hatch />
        Not known yet
      </span>
    );
  return (
    <>
      {tag}
      {where === undefined || where === null || where === "" ? null : (
        <span className="ew">{where}</span>
      )}
    </>
  );
}

/** "Founder’s claim, not verified": the small line under a claimed figure. */
export function ClaimLine({ children }: { readonly children: ReactNode }) {
  return (
    <span className="cq-brief-claim">
      <UserRound size={ICON_SIZE.compact} aria-hidden="true" />
      {children}
    </span>
  );
}

/** The recurring coverage strip: one segment per fact or section. */
export function EvidenceBar({
  marks,
  size,
  label,
}: {
  readonly marks: readonly Evidence[];
  readonly size?: "sm" | undefined;
  readonly label?: string | undefined;
}) {
  return (
    <span
      className="cq-brief-bar"
      data-size={size}
      role={label === undefined ? undefined : "img"}
      aria-label={label}
      aria-hidden={label === undefined ? true : undefined}
    >
      {marks.map((mark, index) => (
        <i
          key={index}
          data-k={
            mark === "doc" || mark === "ver"
              ? "ok"
              : mark === "claim"
                ? "claim"
                : mark === "unk"
                  ? "gap"
                  : undefined
          }
        />
      ))}
    </span>
  );
}

export function EvidenceLegend() {
  return (
    <div className="cq-brief-legend">
      <span>
        <i data-k="ok" aria-hidden="true" />
        Document-supported
      </span>
      <span>
        <i data-k="claim" aria-hidden="true" />
        Founder’s claim
      </span>
      <span>
        <i data-k="gap" aria-hidden="true" />
        Not known yet
      </span>
    </div>
  );
}

/** "Q’s read, not verified": a labelled inference, never a finding. */
export function QReadCard({ children }: { readonly children: ReactNode }) {
  return (
    <section className="cq-brief-card cq-brief-qread" data-q-read>
      <h3>
        <QMark />
        Q’s read, not verified
      </h3>
      {children}
    </section>
  );
}

/** A rail card with its small heading. */
export function BriefCard({
  title,
  children,
  ...data
}: {
  readonly title?: ReactNode;
  readonly children: ReactNode;
  readonly [data: `data-${string}`]: string | undefined;
}) {
  return (
    <section className="cq-brief-card" {...data}>
      {title === undefined ? null : <h3>{title}</h3>}
      {children}
    </section>
  );
}

/** Two columns: the reading and its sticky rail (one column on a phone). */
export function BriefGrid({
  main,
  rail,
}: {
  readonly main: ReactNode;
  readonly rail?: ReactNode;
}) {
  return (
    <div className="cq-brief-grid">
      <div className="cq-brief-main">{main}</div>
      {rail === undefined || rail === null ? null : (
        <div className="cq-brief-rail">{rail}</div>
      )}
    </div>
  );
}

/** Initials for a person, never a photo they did not share here. */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/u).filter(Boolean);
  const first = words[0]?.[0] ?? "";
  const last = words.length > 1 ? (words.at(-1)?.[0] ?? "") : "";
  return `${first}${last}`.toUpperCase();
}
