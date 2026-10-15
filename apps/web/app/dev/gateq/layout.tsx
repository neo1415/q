import type { ReactNode } from "react";

import { PublicBrandStyle } from "@/features/brand-theme/public-brand-style";

/** Public surface: Capital Q's own brand, whoever is looking. */
export default function PublicLayout({
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
