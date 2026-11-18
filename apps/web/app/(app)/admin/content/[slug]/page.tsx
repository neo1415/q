import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ApiProblemError, getAdminSitePage } from "@capital-q/api-client";
import { SiteSlugSchema } from "@capital-q/contracts";
import { ErrorState } from "@capital-q/ui/states";

import { adminContext } from "@/features/admin/admin-context";
import { BackLink } from "@/features/company/back-link";
import { serverT } from "@/features/i18n/server";
import { ConsoleContentEditor } from "@/features/site-content/editor/console-content-editor";

import "@/features/site-content/site-content.css";

type Props = { readonly params: Promise<{ readonly slug: string }> };

export async function generateMetadata(): Promise<Metadata> {
  const t = await serverT();
  return { title: t("Edit page · Admin") };
}

/**
 * Decision 107: one page in the content editor. The draft, its versions
 * and its history come from the API, which checks the admin's role; a
 * draft is never readable by anyone without content.read.
 */
export default async function AdminContentEditPage({ params }: Props) {
  const t = await serverT();
  const context = await adminContext();
  if (context === null || !context.can("content.read")) notFound();
  const parsed = SiteSlugSchema.safeParse((await params).slug);
  if (!parsed.success) notFound();
  let detail;
  try {
    detail = await getAdminSitePage(context.session, parsed.data);
  } catch (error: unknown) {
    if (error instanceof ApiProblemError && error.status === 404) notFound();
    return (
      <ErrorState
        title={t("The page couldn't load")}
        description={t("Nothing changed. Try again in a moment.")}
      />
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <BackLink fallbackHref="/admin/content" label={t("Site content")} />
      <ConsoleContentEditor detail={detail} slug={parsed.data} />
    </div>
  );
}
