import { notFound } from "next/navigation";

import { AppShell } from "@/components/app-shell/app-shell";

import { HARROW } from "../../crm/fixtures";
import CrmReviewPage from "../../crm/page";
import { DiscoverHarness } from "../../discover/discover-harness";
import GateqReviewPage from "../../gateq-review/page";
import GateqV2Page from "../../gateq-v2/page";
import ProfileReviewPage from "../../profile/page";

/**
 * One story page in the harness: an existing dev review page, unchanged
 * (Discover gains the app shell the real route has),
 * rendered under the story layout so the story host stays mounted.
 */
export default async function StoryHarnessPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly page: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { page } = await params;
  switch (page) {
    case "discover":
      // Inside the app's own shell, as /discover is: the story lights its
      // sidebar and Q dock here (#35, #40).
      return (
        <AppShell
          context={{
            scope: "investor_private",
            label: `${HARROW.name} (fictional)`,
            admin: false,
          }}
        >
          <DiscoverHarness />
        </AppShell>
      );
    case "crm":
      return <CrmReviewPage searchParams={searchParams} />;
    case "profile":
      return <ProfileReviewPage searchParams={searchParams} />;
    case "gateq":
      return <GateqV2Page searchParams={searchParams} />;
    // An application with its frozen dossier: transcript and brief (#41).
    case "gateq-review":
      return <GateqReviewPage searchParams={searchParams} />;
    default:
      notFound();
  }
}
