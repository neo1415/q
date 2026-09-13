import type { Metadata } from "next";

import {
  PageContainer,
  PageHeader,
} from "@/components/app-shell/page-container";
import {
  VisibilityScreen,
  VisibilityUnavailable,
} from "@/features/company/visibility-screen";
import { resolveOwnContext } from "@/features/q/context";

export const metadata: Metadata = { title: "Visibility & Discovery" };

export const dynamic = "force-dynamic";

/**
 * Visibility & Discovery (CQ-PRE-REC-001 §31). The founder's own company is
 * resolved on the server; the screen then reads the company and the network
 * projection through the API under the person's session.
 */
export default async function CompanyVisibilityPage() {
  const context = await resolveOwnContext();
  return (
    <PageContainer>
      <PageHeader
        title="Visibility & Discovery"
        description="Who can see your company, what they see, and whether investors can find you."
      />
      {context.kind === "FOUNDER" ? (
        <VisibilityScreen companyId={context.companyId} />
      ) : (
        <VisibilityUnavailable />
      )}
    </PageContainer>
  );
}
