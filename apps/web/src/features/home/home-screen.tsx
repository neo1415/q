import Link from "next/link";

import { buttonClassName } from "@capital-q/ui/button";
import { PriorityList } from "@capital-q/ui/priority-list";
import { QComposer } from "@capital-q/ui/q-composer";

import {
  PageContainer,
  PageHeader,
  PageSection,
} from "@/components/app-shell/page-container";

import { ActivitySummary } from "./activity-summary";

/**
 * Home answers: where am I, what matters, what is happening, what next.
 * Q-centric, mobile-first, and honest about its fresh state: with no
 * authoritative data there is no greeting by name, no invented priority
 * and no fabricated activity. The two setup paths are the useful action.
 *
 * Nothing on this screen is read from a session, a fixture or demo data.
 */

const SETUP_PATHS = [
  {
    id: "founder",
    title: "I'm raising or building a company",
    description:
      "Share a deck or memo. Q assesses readiness, fills the gaps with you and prepares you for the right investors.",
    href: "/onboarding/founder",
    action: "Set up as a founder",
  },
  {
    id: "investor",
    title: "I'm deploying capital",
    description:
      "Describe your mandate. Q builds a relevant, explainable view of opportunities and keeps it current.",
    href: "/onboarding/investor",
    action: "Set up as an investor",
  },
] as const;

export function HomeScreen() {
  return (
    <PageContainer>
      <PageHeader
        title="Home"
        description="Ask Q, then handle what matters next."
      />

      <div className="flex flex-col gap-8">
        <PageSection id="q" title="Ask Q" titleHidden>
          <QComposer id="home-q" contextScope="unset" />
        </PageSection>

        <PageSection id="priority" title="Next priority">
          <PriorityList state="empty" />
        </PageSection>

        <PageSection
          id="setup"
          title="Help Q understand what you're here to do"
          description="Choose a path. Q works from whatever you already have and asks only for what's missing."
        >
          <ul className="flex flex-col divide-y divide-(--cq-border-subtle) border-y border-(--cq-border-subtle)">
            {SETUP_PATHS.map((path) => (
              <li
                key={path.id}
                className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex min-w-0 flex-col gap-1">
                  <p className="cq-body font-medium text-(--cq-text-primary)">
                    {path.title}
                  </p>
                  <p className="cq-body-sm max-w-(--cq-layout-narrow) text-(--cq-text-secondary)">
                    {path.description}
                  </p>
                </div>
                <Link
                  href={path.href}
                  className={buttonClassName(
                    "secondary",
                    "regular",
                    "shrink-0 sm:self-center",
                  )}
                >
                  {path.action}
                </Link>
              </li>
            ))}
          </ul>
        </PageSection>

        <ActivitySummary />
      </div>
    </PageContainer>
  );
}
