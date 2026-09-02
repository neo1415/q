import type { Metadata } from "next";
import Link from "next/link";

import { buttonClassName } from "@capital-q/ui/button";
import { EmptyState } from "@capital-q/ui/states";

import {
  PageContainer,
  PageHeader,
} from "@/components/app-shell/page-container";

export const metadata: Metadata = { title: "Capital" };

/**
 * Capital workspace shell: objectives, relationships, meetings, diligence
 * and execution will live here. Until an objective exists, it says so.
 */
export default function CapitalPage() {
  return (
    <PageContainer>
      <PageHeader
        title="Capital"
        description="Your objective, the relationships behind it, and what happens next, in one working view."
      />
      <EmptyState
        title="No capital objective yet."
        description="Tell Q what you're raising or deploying. Relationships, meetings and diligence gather around that objective as they happen."
        action={
          <Link href="/home#q" className={buttonClassName("secondary")}>
            Tell Q your objective
          </Link>
        }
      />
    </PageContainer>
  );
}
