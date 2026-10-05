import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { getAdminEtiquetteGuide } from "@capital-q/api-client";
import { ErrorState } from "@capital-q/ui/states";

import { PageSection } from "@/components/app-shell/page-container";
import { adminContext } from "@/features/admin/admin-context";
import { HouseGuideEditor } from "@/features/etiquette/house-guide-editor";

export const metadata: Metadata = { title: "How Q conducts business · Admin" };

/**
 * ADR 0050: the house guide Q follows for everyone when it writes or speaks
 * for a person. The platform owner or an operator changes it; the console
 * hides the section from other roles, and the API refuses them whatever
 * the page shows.
 */
export default async function AdminEtiquettePage() {
  const context = await adminContext();
  if (context === null || !context.can("flags.write")) notFound();
  const guide = await getAdminEtiquetteGuide(context.session).catch(() => null);
  return (
    <PageSection
      id="etiquette"
      title="How Q conducts business"
      description="The house guide Q follows when it writes or speaks to investors and founders for anyone on Capital Q."
    >
      {guide === null ? (
        <ErrorState
          title="The guide couldn't load"
          description="Nothing changed. Try again in a moment."
        />
      ) : (
        <HouseGuideEditor guide={guide} />
      )}
    </PageSection>
  );
}
