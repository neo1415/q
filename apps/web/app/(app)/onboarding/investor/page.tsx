import type { Metadata } from "next";
import Link from "next/link";

import { buttonClassName } from "@capital-q/ui/button";
import { InlineNotice } from "@capital-q/ui/states";

import {
  PageContainer,
  PageHeader,
} from "@/components/app-shell/page-container";

export const metadata: Metadata = { title: "Investor setup" };

/** Entry surface only. The investor onboarding flow is a later WEB packet. */
export default function InvestorSetupPage() {
  return (
    <PageContainer width="narrow">
      <PageHeader
        title="Investor setup"
        description="Describe your mandate once. Q keeps a relevant, explainable view of opportunities from then on."
      />
      <div className="flex flex-col gap-5">
        <InlineNotice
          tone="info"
          title="Investor setup isn't open on this build yet."
        >
          When it is, you&apos;ll start here.
        </InlineNotice>
        <div>
          <Link href="/home" className={buttonClassName("quiet")}>
            Back to Home
          </Link>
        </div>
      </div>
    </PageContainer>
  );
}
