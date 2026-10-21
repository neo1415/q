import type { ReactNode } from "react";

import { cx } from "@capital-q/ui";
import { Check, CircleHelp, X } from "@capital-q/ui/icons";

import { EntityAvatar, type EntityKind } from "../entity/entity-avatar";

/**
 * Small marks the discovery pages share (app prototypes 2026-10-20): the
 * four match words' glyphs, the round tick, and an organisation's dark
 * logo tile. Presentation only; every glyph sits beside words that say
 * the same thing, so nothing is told by colour or shape alone.
 */

/** How one published dimension reads against the founder's own profile. */
export type MatchState = "ok" | "part" | "no" | "unk";

export const MATCH_WORDS: Readonly<Record<MatchState, string>> = {
  ok: "Matches",
  part: "Partly",
  no: "Doesn’t match",
  unk: "Not known yet",
};

/** A filled tick on the positive tone (the designs' `.tick`). */
export function Tick({
  size = 20,
  className,
}: {
  readonly size?: number | undefined;
  readonly className?: string | undefined;
}) {
  return (
    <span
      aria-hidden="true"
      className={cx(
        "inline-grid flex-none place-items-center rounded-full bg-(--cq-positive) text-(--cq-text-inverse)",
        className,
      )}
      style={{ width: size, height: size }}
    >
      <Check size={Math.round(size * 0.6)} strokeWidth={2.4} />
    </span>
  );
}

/** Half a circle: partly. */
function Half() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 18 18"
      aria-hidden="true"
      className="flex-none text-(--cq-warning)"
    >
      <circle
        cx="9"
        cy="9"
        r="7"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.6"
      />
      <path d="M9 2a7 7 0 0 1 0 14z" fill="currentColor" />
    </svg>
  );
}

/** The glyph for one match state; the words beside it carry the meaning. */
export function MatchMark({ state }: { readonly state: MatchState }) {
  switch (state) {
    case "ok":
      return <Tick size={18} />;
    case "part":
      return <Half />;
    case "no":
      return (
        <X
          size={16}
          aria-hidden="true"
          className="flex-none text-(--cq-text-tertiary)"
        />
      );
    case "unk":
      return (
        <CircleHelp
          size={16}
          aria-hidden="true"
          className="flex-none text-(--cq-text-tertiary)"
        />
      );
  }
}

/** "Stage: matches", with its mark. */
export function MatchWord({
  label,
  state,
  className,
}: {
  readonly label: ReactNode;
  readonly state: MatchState;
  readonly className?: string | undefined;
}) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1.5 text-[13px] text-(--cq-text-secondary)",
        className,
      )}
      data-match={state}
    >
      <MatchMark state={state} />
      <span>{label}</span>
    </span>
  );
}

/**
 * An organisation's logo as the designs draw it: their own photo when the
 * read minted one, else a dark tile with initials (warm charcoal inside a
 * `.cq-charcoal` page). Ten-pixel corners, eight on the small size.
 */
export function LogoTile({
  kind,
  name,
  src,
  companyId,
  investorOrganisationId,
  size = 40,
  className,
}: {
  readonly kind: Exclude<EntityKind, "person">;
  readonly name: string;
  readonly src?: string | null | undefined;
  readonly companyId?: string | undefined;
  readonly investorOrganisationId?: string | undefined;
  readonly size?: number | undefined;
  readonly className?: string | undefined;
}) {
  return (
    <EntityAvatar
      kind={kind}
      name={name}
      src={src}
      companyId={companyId}
      investorOrganisationId={investorOrganisationId}
      size={size}
      decorative
      className={cx(
        "border-transparent! bg-[var(--cq-tile,var(--cq-text-primary))]! font-semibold text-[var(--cq-on-tile,var(--cq-text-inverse))]!",
        size <= 32 ? "rounded-[8px]!" : "rounded-[10px]!",
        className,
      )}
    />
  );
}
