import type { ReactNode } from "react";

import { PublicBrandStyle } from "@/features/brand-theme/public-brand-style";
import { LanguageProvider } from "@/features/i18n/language";
import { serverUiLanguage } from "@/features/i18n/server";

/**
 * Public surface: Capital Q's own brand, whoever is looking. A signed-in
 * founder who chose Arabic applies in Arabic, right to left; anyone else
 * (no saved choice) sees English.
 */
export default async function PublicLayout({
  children,
}: {
  children: ReactNode;
}): Promise<ReactNode> {
  const language = await serverUiLanguage();
  return (
    <LanguageProvider language={language}>
      <PublicBrandStyle />
      {children}
    </LanguageProvider>
  );
}
