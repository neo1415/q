import { notFound } from "next/navigation";

import CrmReviewPage from "../../crm/page";
import DiscoverHarnessPage from "../../discover/page";
import GateqReviewPage from "../../gateq-v2/page";
import ProfileReviewPage from "../../profile/page";

/**
 * One story page in the harness: an existing dev review page, unchanged,
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
      return <DiscoverHarnessPage />;
    case "crm":
      return <CrmReviewPage searchParams={searchParams} />;
    case "profile":
      return <ProfileReviewPage searchParams={searchParams} />;
    case "gateq":
      return <GateqReviewPage searchParams={searchParams} />;
    default:
      notFound();
  }
}
