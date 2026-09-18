import Link from "next/link";
import { Suspense } from "react";

import { loadWebServerConfig } from "@capital-q/config/web";
import { buttonClassName } from "@capital-q/ui/button";

import {
  PageContainer,
  PageHeader,
  PageSection,
} from "@/components/app-shell/page-container";

import {
  resolveOwnContext,
  resolveUnfinishedSetup,
  type OwnContext,
} from "@/features/q/context";
import { ChatsList } from "@/features/q/chats-list";
import {
  QConversationPanel,
  type QSurfaceContext,
} from "@/features/q/q-conversation";

/**
 * Home is the Q workspace (doc 17 §60-§63; CQ-PRE-REC-001 §12).
 *
 * Q first: the conversation is the primary surface, with a few contextual
 * suggestions before the first turn and a composer that stays reachable.
 * Honest about its fresh state: no greeting by an invented name, no empty
 * "next priority" panel pretending to be a queue, no fabricated activity.
 * The setup paths appear only for a person Capital Q knows nothing about
 * yet; once a company or an investor organisation exists, the context cue
 * says so and Q's questions are about it.
 *
 * Whether this build can reach Q is a server-side fact, resolved here and
 * passed down as a boolean -- the browser is told what is available, never
 * where. Nothing else on this screen is read from a fixture or demo data.
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

function surfaceContext(context: OwnContext): QSurfaceContext {
  switch (context.kind) {
    case "FOUNDER":
      return {
        companyId: context.companyId,
        scope: "founder_private",
        label: context.label ?? undefined,
        suggestions: [
          "Analyse my company",
          "What did my deck say about our customers?",
          "What should I fix before investors see this?",
          "What can you help me with?",
        ],
      };
    case "INVESTOR":
      return {
        investorOrganisationId: context.investorOrganisationId,
        scope: "investor_private",
        label: context.label ?? undefined,
        suggestions: [
          "What is my mandate?",
          "What are my hard exclusions?",
          "What can you help me with?",
        ],
      };
    case "NONE":
      return {
        scope: "unset",
        suggestions: [
          "What can you help me with?",
          "Who are you?",
          "How do I get started?",
        ],
      };
  }
}

export async function HomeScreen() {
  const qConnected = loadWebServerConfig().qApiBaseUrl !== undefined;
  // Which subject Q's questions are about, if Capital Q knows of one. A
  // server fact, resolved once per render and never asked of the browser.
  const context = qConnected
    ? await resolveOwnContext()
    : { kind: "NONE" as const };
  // A setup that was left part-way is offered back, in one tap; the setup
  // paths below are only for a person Capital Q knows nothing about yet.
  const unfinished =
    qConnected && context.kind !== "NONE"
      ? await resolveUnfinishedSetup()
      : null;

  return (
    <PageContainer>
      <PageHeader
        title="Home"
        description={
          context.kind === "NONE"
            ? "Ask Q, or tell Q what you're here to do."
            : "Ask Q, then handle what matters next."
        }
      />

      <div className="flex flex-col gap-8">
        <PageSection id="q" title="Ask Q" titleHidden>
          {/* Below the desktop breakpoint the sidebar is hidden, so the
              chats list sits above the conversation instead. */}
          <div className="mb-4 lg:hidden">
            <Suspense fallback={null}>
              <ChatsList variant="inline" />
            </Suspense>
          </div>
          <Suspense fallback={null}>
            <QConversationPanel
              connected={qConnected}
              context={surfaceContext(context)}
            />
          </Suspense>
        </PageSection>

        {unfinished !== null ? (
          <PageSection
            id="continue-setup"
            title="Finish setting up"
            description={
              unfinished === "founder"
                ? "Your company setup is part-way through. Q picks up exactly where you left off, and asks only for what is still missing."
                : "Your mandate is part-way through. Q picks up exactly where you left off, and asks only for what is still missing."
            }
          >
            <div>
              <Link
                href={`/onboarding/${unfinished}`}
                className={buttonClassName("secondary", "regular")}
              >
                Continue setup
              </Link>
            </div>
          </PageSection>
        ) : null}

        {context.kind !== "NONE" ? (
          <PageSection
            id="visibility"
            title="Visibility & Discovery"
            description={
              context.kind === "INVESTOR"
                ? "Who can see your investor profile, what founders would see, and whether they can find you. Nothing becomes visible until you choose."
                : "Who can see your company, what investors would see, and whether they can find you. Nothing becomes visible until you choose."
            }
          >
            <div>
              <Link
                href="/company/visibility"
                className={buttonClassName("secondary", "regular")}
              >
                Manage visibility
              </Link>
            </div>
          </PageSection>
        ) : null}

        {context.kind === "NONE" ? (
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
        ) : null}
      </div>
    </PageContainer>
  );
}
