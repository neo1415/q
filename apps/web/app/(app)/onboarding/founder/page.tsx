import type { Metadata } from "next";
import Link from "next/link";

import { buttonClassName } from "@capital-q/ui/button";
import { InlineNotice } from "@capital-q/ui/states";

import {
  PageContainer,
  PageHeader,
} from "@/components/app-shell/page-container";

export const metadata: Metadata = { title: "Founder setup" };

/** Entry surface only. The founder onboarding flow is CQ-WEB-011. */
export default function FounderSetupPage() {
  return (
    <PageContainer width="narrow">
      <PageHeader
        title="Founder setup"
        description="Q starts from what you already have, such as a deck, a memo or a few sentences, and returns useful intelligence before asking for more."
      />
      <div className="flex flex-col gap-5">
        <InlineNotice
          tone="info"
          title="Founder setup isn't open on this build yet."
        >
          When it is, you&apos;ll start here. Nothing you&apos;ve done so far is
          lost.
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
