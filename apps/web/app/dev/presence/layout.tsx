import type { ReactNode } from "react";

import { PublicBrandStyle } from "@/features/brand-theme/public-brand-style";

/**
 * Capital Q's own brand (black and gold), so the presence harness shows Q
 * in the colour the product does: Q is gold, not the bare tokens' blue.
 */
export default function PresenceLayout({
  children,
}: {
  children: ReactNode;
}): ReactNode {
  return (
    <>
      <PublicBrandStyle />
      {children}
    </>
  );
}
