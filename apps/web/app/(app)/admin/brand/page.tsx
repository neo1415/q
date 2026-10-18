import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { getAdminBrandTheme } from "@capital-q/api-client";
import { ErrorState } from "@capital-q/ui/states";

import { PageSection } from "@/components/app-shell/page-container";
import { adminContext } from "@/features/admin/admin-context";
import { BrandEditor } from "@/features/brand-theme/brand-editor";
import { serverT } from "@/features/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await serverT();
  return { title: t("Brand · Admin") };
}

/**
 * P5 brand theming with K3 presets: the platform owner or an operator
 * switches Capital Q's look (black and gold, or Capital Q blue) and may
 * put their own accent on top, for everyone. The console hides the
 * section from other roles, and the API refuses them whatever the page
 * shows.
 */
export default async function AdminBrandPage() {
  const t = await serverT();

  const context = await adminContext();
  if (context === null || !context.can("flags.write")) notFound();
  const theme = await getAdminBrandTheme(context.session).catch(() => null);
  return (
    <PageSection
      id="brand"
      title={t("Brand")}
      description={t(
        "Choose how Capital Q looks for everyone. Black and gold changes the page, the menu bar, the buttons and Q's light together. Switch back at any time; nothing else changes.",
      )}
    >
      {theme === null ? (
        <ErrorState
          title={t("The brand couldn't load")}
          description={t("Nothing changed. Try again in a moment.")}
        />
      ) : (
        <BrandEditor
          savedPreset={theme.presetKey}
          savedHex={theme.primaryHex}
        />
      )}
    </PageSection>
  );
}
