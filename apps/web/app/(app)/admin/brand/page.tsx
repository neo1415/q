import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { getAdminBrandTheme } from "@capital-q/api-client";
import { ErrorState } from "@capital-q/ui/states";

import { PageSection } from "@/components/app-shell/page-container";
import { adminContext } from "@/features/admin/admin-context";
import { BrandEditor } from "@/features/brand-theme/brand-editor";

export const metadata: Metadata = { title: "Brand · Admin" };

/**
 * P5 brand theming with K3 presets: the platform owner or an operator
 * switches Capital Q's look (black and gold, or Capital Q blue) and may
 * put their own accent on top, for everyone. The console hides the
 * section from other roles, and the API refuses them whatever the page
 * shows.
 */
export default async function AdminBrandPage() {
  const context = await adminContext();
  if (context === null || !context.can("flags.write")) notFound();
  const theme = await getAdminBrandTheme(context.session).catch(() => null);
  return (
    <PageSection
      id="brand"
      title="Brand"
      description="Choose how Capital Q looks for everyone. Black and gold changes the page, the menu bar, the buttons and Q's light together. Switch back at any time; nothing else changes."
    >
      {theme === null ? (
        <ErrorState
          title="The brand couldn't load"
          description="Nothing changed. Try again in a moment."
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
