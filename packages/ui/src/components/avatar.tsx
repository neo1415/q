import { cx } from "../primitives/class-names.js";

/**
 * Person or organisation avatar with explicit dimensions, so it never shifts
 * layout. Falls back to initials; never to a stock image.
 */

export const AVATAR_SIZES = { sm: 32, md: 40, lg: 48 } as const;
export type AvatarSize = keyof typeof AVATAR_SIZES;

export type AvatarProps = {
  readonly name: string;
  readonly src?: string | undefined;
  readonly size?: AvatarSize | undefined;
  readonly shape?: "circle" | "square" | undefined;
  readonly className?: string | undefined;
};

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "";
  const second = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? "") : "";
  return (first + second).toUpperCase() || "?";
}

export function Avatar({
  name,
  src,
  size = "md",
  shape = "circle",
  className,
}: AvatarProps) {
  const px = AVATAR_SIZES[size];
  const frame = cx(
    "inline-flex shrink-0 items-center justify-center overflow-hidden border border-(--cq-border-subtle) bg-(--cq-surface-subtle) text-(--cq-text-secondary) cq-label",
    shape === "circle" ? "rounded-full" : "rounded-md",
    className,
  );
  if (src !== undefined) {
    return (
      <span className={frame} style={{ width: px, height: px }}>
        <img
          src={src}
          alt={name}
          width={px}
          height={px}
          className="size-full object-cover"
        />
      </span>
    );
  }
  return (
    <span
      role="img"
      aria-label={name}
      className={frame}
      style={{ width: px, height: px }}
    >
      {initials(name)}
    </span>
  );
}
