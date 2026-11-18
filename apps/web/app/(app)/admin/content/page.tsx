import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { listAdminSitePages } from "@capital-q/api-client";
import { ErrorState } from "@capital-q/ui/states";

import { PageSection } from "@/components/app-shell/page-container";
import { adminContext } from "@/features/admin/admin-context";
import { serverT } from "@/features/i18n/server";
import { ContentIndex } from "@/features/site-content/editor/content-index";
import { SiteSettingsForm } from "@/features/site-content/editor/site-settings-form";

import "@/features/site-content/site-content.css";

export async function generateMetadata(): Promise<Metadata> {
  const t = await serverT();
  return { title: t("Site content · Admin") };
}

/**
 * Decision 107: the public site's pages, and the details that fill their
 * placeholders. The console hides the section from roles without
 * content.read; the API refuses them whatever the page shows.
 */
export default async function AdminContentPage() {
  const t = await serverT();
  const context = await adminContext();
  if (context === null || !context.can("content.read")) notFound();
  const list = await listAdminSitePages(context.session).catch(() => null);
  return (
    <>
      <PageSection
        id="content"
        title={t("Site content")}
        description={t(
          "The home page, pricing, FAQ and legal pages. Open one to edit it block by block, preview it at desktop and phone widths, and publish. Every published version is kept.",
        )}
      >
        {list === null ? (
          <ErrorState
            title={t("The pages couldn't load")}
            description={t("Nothing changed. Try again in a moment.")}
          />
        ) : list.pages.length === 0 ? (
          <p className="cq-body-sm text-(--cq-text-secondary)">
            {t(
              "No pages yet. Import the default content with scripts/seed/site-content.mjs; legal pages arrive as drafts waiting for review.",
            )}
          </p>
        ) : (
          <ContentIndex pages={list.pages} />
        )}
      </PageSection>
      {list === null ? null : (
        <PageSection
          id="site-settings"
          title={t("Site settings")}
          description={t(
            "These fill the placeholders on every page, such as {{COMPANY_NAME}}. A change shows on every published page at once.",
          )}
        >
          {context.can("content.write") ? (
            <SiteSettingsForm saved={list.settings} />
          ) : null}
        </PageSection>
      )}
    </>
  );
}
