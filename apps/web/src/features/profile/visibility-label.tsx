import { Eye, Lock } from "@capital-q/ui/icons";

/**
 * Who can see a profile section, in words beside its title (chosen design
 * 2026-10-21): only the person's own company or firm (organisation
 * private), Capital Q members (network visible), or anyone with the
 * person's link (public, the Q Card). The icon only repeats the words.
 */
export type SectionVisibility = "private" | "members" | "link";

export function VisibilityLabel({
  scope,
  side,
  translate = (english) => english,
}: {
  readonly scope: SectionVisibility;
  /** Whose "only your …": a founder's company or an investor's firm. */
  readonly side: "company" | "firm";
  readonly translate?: ((english: string) => string) | undefined;
}) {
  const words =
    scope === "private"
      ? side === "company"
        ? "Only your company"
        : "Only your firm"
      : scope === "members"
        ? "Capital Q members"
        : "Anyone with your link";
  return (
    <span
      className="inline-flex shrink-0 items-center gap-[5px] text-xs text-(--cq-text-tertiary)"
      data-visibility={scope}
    >
      {scope === "private" ? (
        <Lock size={13} strokeWidth={1.75} aria-hidden="true" />
      ) : (
        <Eye size={13} strokeWidth={1.75} aria-hidden="true" />
      )}
      {translate(words)}
    </span>
  );
}
