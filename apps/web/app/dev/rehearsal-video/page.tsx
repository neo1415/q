import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { AppShell } from "@/components/app-shell/app-shell";
import { PageContainer } from "@/components/app-shell/page-container";

import { RehearsalVideoHarness } from "./harness";

// Read per request: the harness's gate is the running server's setting.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Rehearsal video harness",
  robots: { index: false },
};

/**
 * The rehearsal video stage and voice room in the real shell, over a
 * fictional rehearsal, so tablet/phone/desktop layouts can be driven in a
 * browser (apps/web/e2e/rehearsal-video-tablet.spec.ts). The provider room
 * is an empty frame, so no Tavus room is ever allocated.
 *
 * Development only; a production build serves it only when
 * CQ_DEV_PREVIEW=1 is set on that server.
 */
export default async function RehearsalVideoHarnessPage({
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
  const params = await searchParams;
  const view = params["view"] === "room" ? "room" : "stage";
  return (
    <AppShell
      context={{
        scope: "founder_private",
        label: "Ledgerfold (fictional)",
        admin: false,
      }}
    >
      <PageContainer>
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
          <RehearsalVideoHarness view={view} />
        </div>
      </PageContainer>
    </AppShell>
  );
}
