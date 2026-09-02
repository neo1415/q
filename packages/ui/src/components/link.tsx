import type { AnchorHTMLAttributes, ReactNode } from "react";

import { cx } from "../primitives/class-names.js";

/**
 * Inline text link styling. The design system does not depend on a router:
 * application code applies `linkClassName()` to its own routing Link, and
 * `TextLink` covers plain anchors.
 */
export function linkClassName(className?: string): string {
  return cx(
    "rounded-xs font-medium text-(--cq-accent) underline decoration-(--cq-accent-soft) decoration-2 underline-offset-4 transition-colors duration-(--cq-motion-fast) hover:decoration-(--cq-accent)",
    className,
  );
}

export type TextLinkProps = Omit<
  AnchorHTMLAttributes<HTMLAnchorElement>,
  "className"
> & {
  readonly className?: string | undefined;
  readonly children: ReactNode;
};

export function TextLink({ className, children, ...rest }: TextLinkProps) {
  return (
    <a className={linkClassName(className)} {...rest}>
      {children}
    </a>
  );
}
