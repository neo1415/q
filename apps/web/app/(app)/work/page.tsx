import type { Metadata } from "next";

import {
  PageContainer,
  PageHeader,
} from "@/components/app-shell/page-container";
import { WorkPanel } from "@/features/work/work-panel";

export const metadata: Metadata = { title: "Q's work" };

/**
 * Q's work (AUTO, ADR 0029): every outreach and stand-in the person
 * approved, with what Q did and the controls that act now. The panel loads
 * after the page opens, so the page itself never waits on Q.
 */
export default function WorkPage() {
  return (
    <PageContainer width="reading">
      <PageHeader
        title="Q's work"
        description="What Q is doing for you under the plans you approved. Stop any of it at any time."
      />
      <WorkPanel variant="page" />
    </PageContainer>
  );
}
