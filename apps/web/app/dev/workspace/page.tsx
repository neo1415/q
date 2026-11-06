import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { AppShell } from "@/components/app-shell/app-shell";
import { PageContainer } from "@/components/app-shell/page-container";
import { LanguageProvider } from "@/features/i18n/language";
import { QConversationPanel } from "@/features/q/q-conversation";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Workspace harness",
  robots: { index: false },
};

/**
 * Q Workspace W1 (ADR 0077): the real shell with the flag on (`?ws=on`) or
 * off, around a sample page, for screenshots at 1440 and 390. Q is not
 * connected (no Q API, no provider, no database): the pane shows the
 * real panel's empty state. Development only; a production build serves it
 * only when CQ_DEV_PREVIEW=1 is set on that server.
 */
export default async function WorkspaceHarnessPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (
    process.env.NODE_ENV === "production" &&
    process.env["CQ_DEV_PREVIEW"] !== "1"
  ) {
    notFound();
  }
  const enabled = (await searchParams)["ws"] === "on";
  return (
    <LanguageProvider language="en">
      <AppShell
        context={{ scope: "investor_private", label: "Harbour Ventures" }}
        workspace={{ enabled, available: true }}
        qPane={
          <QConversationPanel
            workspace
            connected={false}
            context={{
              scope: "investor_private",
              label: "Harbour Ventures",
              suggestions: [
                "What is my mandate?",
                "What should I look at?",
              ],
            }}
            greeting="What's on your mind today, Ada?"
          />
        }
      >
        <PageContainer>
          <h1 className="cq-title-lg text-(--cq-text-primary)">
            Relationships
          </h1>
          <p className="mt-2 cq-body text-(--cq-text-secondary)">
            A sample page in the page pane. Every real page renders here
            unchanged.
          </p>
          <ul className="mt-6 flex flex-col gap-3">
            {[
              "Tamarind Pay",
              "Ledgerfold",
              "Brightwell",
              "Northwind Health",
              "Copperline",
              "Sable Freight",
            ].map((name) => (
              <li
                key={name}
                className="flex min-h-14 items-center justify-between border border-(--cq-border-subtle) bg-(--cq-surface) px-4"
              >
                <span className="cq-label text-(--cq-text-primary)">
                  {name}
                </span>
                <span className="cq-body-sm text-(--cq-text-secondary)">
                  In diligence
                </span>
              </li>
            ))}
          </ul>
        </PageContainer>
      </AppShell>
    </LanguageProvider>
  );
}
