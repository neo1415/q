import Link from "next/link";

import { loadWebServerConfig } from "@capital-q/config/web";
import { buttonClassName } from "@capital-q/ui/button";

import { PageSection } from "@/components/app-shell/page-container";

import {
  resolveOwnContext,
  resolveUnfinishedSetup,
  type OwnContext,
} from "@/features/q/context";
import {
  QConversationPanel,
  type QSurfaceContext,
} from "@/features/q/q-conversation";
import { PersonaCards } from "@/features/persona/persona-cards";

/**
 * Home is Q (QX-001 §4; doc 17 §60-§63).
 *
 * Not a dashboard with a chatbot in the corner, and not a dashboard at
 * all. Q is the surface: the conversation occupies the centre of the
 * screen, the composer is the thing your eye lands on, and everything
 * else on this page has to earn its place underneath.
 *
 * What earns it, and nothing else does: a setup left part-way, the
 * visibility control that decides who can see you, and — for somebody
 * Capital Q knows nothing about yet — the choice of which side of the
 * table they are on. There is no counter reading zero, no empty activity
 * feed, no "0 matches" panel. A new account sees Q offering a real
 * starting point rather than an empty product pretending to be full.
 *
 * Whether this build can reach Q is a server-side fact, resolved here and
 * passed down as a boolean — the browser is told what is available, never
 * where. Nothing on this screen comes from a fixture.
 */

function surfaceContext(context: OwnContext): QSurfaceContext {
  switch (context.kind) {
    case "FOUNDER":
      return {
        companyId: context.companyId,
        scope: "founder_private",
        label: context.label ?? undefined,
        // Only what Q can actually answer from what is on record. A
        // shortcut that produces a shrug is worse than one fewer chip.
        suggestions: [
          "How is my raise going?",
          "What should I fix before investors see this?",
          "What did my deck say about our customers?",
          "Review my company",
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
          "What should I look at?",
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

/**
 * Everything under the Q surface sits in the same reading column, with the
 * page gutter, so a section never starts at the workspace edge while Q is
 * centred above it.
 */
const SECTION_COLUMN =
  "mx-auto w-full max-w-(--cq-layout-reading) px-4 sm:px-6 lg:px-8";

/** The one line under Q, in the person's terms rather than the product's. */
function openingLine(context: OwnContext): string {
  switch (context.kind) {
    case "FOUNDER":
      return "Ask about your company, your raise, or what to do next.";
    case "INVESTOR":
      return "Ask about your mandate, what to look at, or what changed.";
    case "NONE":
      return "Ask Q anything, or tell Q what you're here to do.";
  }
}

export async function HomeScreen({
  conversationId = null,
}: {
  /** The conversation the URL names, resolved on the server. */
  readonly conversationId?: string | null | undefined;
} = {}) {
  const qConnected = loadWebServerConfig().qApiBaseUrl !== undefined;
  // Which subject Q's questions are about, if Capital Q knows of one. A
  // server fact, resolved once per render and never asked of the browser.
  const context = qConnected
    ? await resolveOwnContext()
    : { kind: "NONE" as const };
  // A setup that was left part-way is offered back, in one tap.
  const unfinished =
    qConnected && context.kind !== "NONE"
      ? await resolveUnfinishedSetup()
      : null;

  return (
    <div className="flex flex-col gap-10 py-6 sm:py-10">
      {/*
        The Q surface. Deliberately not a PageHeader and a card: a heading
        reading "Home" above a boxed chat is the dashboard composition
        this packet exists to replace.
      */}
      <section
        aria-label="Ask Q"
        className="flex flex-col gap-5"
        data-q-surface
      >
        {/* Previous conversations live in the sidebar on desktop and behind
            the history control on the Q surface everywhere (QX-001 §7;
            design/visual-debt.md P0): never a list above the composer. */}
        <p className="cq-body mx-auto w-full max-w-(--cq-layout-reading) text-center text-(--cq-text-secondary)">
          {openingLine(context)}
        </p>

        {/*
          Deliberately not inside a Suspense boundary (QX-003A).

          Nothing here is async: the panel is a client component and the
          conversation it opens is already resolved above. A boundary was
          needed only while the panel read the parameter with
          `useSearchParams`, and it outlived that read.

          It is not free. React streams a boundary's content into a hidden
          holder and reveals it on a `requestAnimationFrame`, which never
          fires while the tab is hidden. Home's whole Q surface therefore
          stayed blank in a background tab — and in any automated browser
          whose page is not visible, which is what made this bug look for
          a long time like history that hydrated and was then destroyed.
          In the shell it is parsed in place and hydrates with the root.
        */}
        <QConversationPanel
          connected={qConnected}
          context={surfaceContext(context)}
          conversationId={conversationId}
        />
      </section>

      {context.kind === "NONE" ? (
        <PageSection
          id="setup"
          title="What are you here to do?"
          description="Q works from whatever you already have, and asks only for what is missing."
          className={SECTION_COLUMN}
        >
          <PersonaCards />
        </PageSection>
      ) : null}

      {unfinished !== null ? (
        <PageSection
          id="continue-setup"
          title="Finish setting up"
          className={SECTION_COLUMN}
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
          className={SECTION_COLUMN}
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
    </div>
  );
}
