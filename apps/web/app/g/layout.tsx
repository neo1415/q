import type { ReactNode } from "react";

import { PublicBrandStyle } from "@/features/brand-theme/public-brand-style";
import { LanguageProvider } from "@/features/i18n/language";
import { machineUiText } from "@/features/i18n/machine";
import { serverUiLanguage } from "@/features/i18n/server";

/**
 * Public surface: Capital Q's own brand, whoever is looking. A signed-in
 * founder who chose a language applies in it (right to left where it is
 * written so); anyone else (no saved choice) sees English.
 */
export default async function PublicLayout({
  children,
}: {
  children: ReactNode;
}): Promise<ReactNode> {
  const language = await serverUiLanguage();
  const machine = await machineUiText(language);
  return (
    <LanguageProvider language={language} machine={machine}>
      <PublicBrandStyle />
      {children}
    </LanguageProvider>
  );
}
