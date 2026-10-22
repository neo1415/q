import type { ReactNode } from "react";

import { PublicBrandStyle } from "@/features/brand-theme/public-brand-style";

/**
 * Design review pages paint Capital Q's default brand (black and gold), as
 * a signed-in person sees it, so a screenshot here matches the real app
 * rather than the unbranded token fallback. Each page keeps its own gate.
 */
export default function DevLayout({
  children,
}: {
  readonly children: ReactNode;
}) {
  return (
    <>
      <PublicBrandStyle />
      {children}
    </>
  );
}
