import type { Metadata } from "next";

import {
  PageContainer,
  PageHeader,
} from "@/components/app-shell/page-container";
import { CapitalScreen } from "@/features/capital/capital-screen";

export const metadata: Metadata = { title: "Capital" };

// The objective is read under the person's own session on every request.
export const dynamic = "force-dynamic";

/**
 * Capital workspace: the objective, the relationships behind it, and what
 * happens next. Meetings, diligence and execution will gather here; until
 * there is an objective, the page says so in a sentence.
 */
export default function CapitalPage() {
  return (
    <PageContainer>
      <PageHeader title="Capital" />
      <CapitalScreen />
    </PageContainer>
  );
}
