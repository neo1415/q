import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { getAdminBrandTheme } from "@capital-q/api-client";
import { ErrorState } from "@capital-q/ui/states";

import { PageSection } from "@/components/app-shell/page-container";
import { adminContext } from "@/features/admin/admin-context";
import { BrandEditor } from "@/features/brand-theme/brand-editor";

export const metadata: Metadata = { title: "Brand colour · Admin" };

/**
 * P5 brand theming: the platform owner or an operator recolours Capital Q
 * for everyone. The console hides the section from other roles, and the
 * API refuses them whatever the page shows.
 */
export default async function AdminBrandPage() {
  const context = await adminContext();
  if (context === null || !context.can("flags.write")) notFound();
  const theme = await getAdminBrandTheme(context.session).catch(() => null);
  return (
    <PageSection
      id="brand"
      title="Brand colour"
      description="Recolour buttons, links and highlights for everyone. Q's own light keeps its colour."
    >
      {theme === null ? (
        <ErrorState
          title="The brand colour couldn't load"
          description="Nothing changed. Try again in a moment."
        />
      ) : (
        <BrandEditor saved={theme.primaryHex} />
      )}
    </PageSection>
  );
}
