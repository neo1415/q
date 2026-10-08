import Link from "next/link";
import { cache, Suspense, type ReactNode } from "react";

import {
  ApiProblemError,
  getCurrentCapitalObjective,
} from "@capital-q/api-client";
import type { CapitalObjectiveDto } from "@capital-q/contracts";
import { buttonClassName } from "@capital-q/ui/button";

import { PageSection } from "@/components/app-shell/page-container";
import {
  apiSession,
  resolveOwnContext,
  type OwnContext,
} from "@/features/q/context";
import { QSection } from "@/features/q/q-section";
import { ActionPlanBoard } from "@/features/readiness/action-plan-board";
import { ownReadiness } from "@/features/readiness/readiness-data";
import {
  PrivateNote,
  ReadinessSection,
} from "@/features/readiness/readiness-section";
import { ownRelationships } from "@/features/relationships/relationship-data";
import { RelationshipList } from "@/features/relationships/relationship-list";

import { AskQChips } from "./ask-q-chips";
import {
  CapitalSkeleton,
  draftFrom,
  founderLedger,
  FounderBook,
  InvestorBook,
  investorCommitments,
} from "./capital-book";
import {
  NextSteps,
  needsYouCount,
  nowCount,
  RaiseSummary,
  StopYourRaise,
} from "./capital-overview";
import { CapitalTabBar, TabBadge } from "./capital-tab-bar";
import type { CapitalTab } from "./capital-tabs";
import { MandateSummary } from "./mandate-summary";
import { RaiseTerms } from "./raise-terms";
import {
  type BlueprintHorizon,
  horizonFrom,
  ReadinessBlueprintSection,
} from "./readiness-blueprint";

/**
 * Capital (founder direction 2026-10-04: "is capital divided into
 * different rounds? ... how does one now confirm they've gotten the
 * money"). For a founder, in tabs (founder 2026-10-08, design:
 * docs/design/2026-10-08/capital-tabs): Overview (the raise, what could
 * stop it, the next three steps), Raise & rounds (the current round card,
 * every commitment with its next step, every round, the terms), Readiness,
 * the Action plan board, the 12-month plan and Investors. For an investor,
 * what they invested and their commitments, each with its next step, then
 * relationships. Raised is always received money, derived, never typed.
 */

async function currentObjective(
  companyId: string,
): Promise<CapitalObjectiveDto | null> {
  const session = await apiSession();
  if (session === null) return null;
  try {
    return await getCurrentCapitalObjective(session, companyId);
  } catch (error) {
    // No current objective is a normal state; the round form starts empty.
    if (error instanceof ApiProblemError) return null;
    return null;
  }
}

/*
  Per-request reads (capital-tabs): the open tab and the badges on the bar
  may ask for the same thing; React's cache makes that one call per
  request. Each tab reads only what it shows, so it paints first.
*/
const ledgerOf = cache(founderLedger);
const readinessOf = cache(ownReadiness);
const objectiveOf = cache(currentObjective);
const relationshipsOf = cache(ownRelationships);

const FOUNDER_ASKS = [
  {
    label: "Plan this raise",
    prompt:
      "Plan my raise: who to approach, in what order, and what to prepare.",
  },
  {
    label: "Investors who fit",
    prompt: "Which investors on Capital Q fit my raise best, and why?",
  },
  {
    label: "Make my pitch deck",
    prompt: "Make me a pitch deck for this raise.",
  },
  {
    label: "What's missing?",
    prompt:
      "What would an investor ask about my raise that I can't answer yet?",
  },
];

const INVESTOR_ASKS = [
  {
    label: "Companies that fit my mandate",
    prompt: "Which companies on Capital Q fit my mandate best right now?",
  },
  {
    label: "Where are my deals?",
    prompt:
      "Summarise where each of my company relationships stands and what I should do next.",
  },
  {
    label: "Sharpen my mandate",
    prompt:
      "Review my mandate and tell me what would make it sharper for founders.",
  },
];

export async function CapitalScreen({
  tab = "overview",
  hadTabParam = false,
  horizon,
}: {
  /** capital-tabs: the founder's open tab, from `?tab=`. */
  readonly tab?: CapitalTab | undefined;
  /** Whether the URL named the tab (an old `#anchor` maps only when not). */
  readonly hadTabParam?: boolean | undefined;
  /** Q.04: the plan horizon from `?horizon=3|6|12`; anything else is 6. */
  readonly horizon?: string | undefined;
} = {}) {
  const context = await resolveOwnContext();
  if (context.kind === "FOUNDER") {
    const companyId = context.companyId;
    return (
      <div className="flex flex-col gap-6">
        <CapitalTabBar
          active={tab}
          hadTabParam={hadTabParam}
          badges={{
            raise: (
              <Suspense fallback={null}>
                <RaiseBadge companyId={companyId} />
              </Suspense>
            ),
            readiness: (
              <Suspense fallback={null}>
                <ReadinessBadge />
              </Suspense>
            ),
            "action-plan": (
              <Suspense fallback={null}>
                <NowBadge />
              </Suspense>
            ),
          }}
        />
        <div
          id="capital-panel"
          role="tabpanel"
          aria-labelledby={`capital-tab-${tab}`}
          data-capital-tab={tab}
        >
          <Suspense key={tab} fallback={<CapitalSkeleton />}>
            <FounderTab
              tab={tab}
              context={context}
              horizon={horizonFrom(horizon)}
            />
          </Suspense>
        </div>
      </div>
    );
  }

  const [relationships, mine] = await Promise.all([
    relationshipsOf(context),
    context.kind === "INVESTOR" ? investorCommitments() : Promise.resolve(null),
  ]);
  return (
    <div className="flex flex-col gap-10">
      {context.kind === "INVESTOR" ? (
        <>
          <PageSection id="commitments" title="My commitments">
            {mine === null ? (
              <QuietEmpty sentence="Your commitments couldn't load." retry />
            ) : (
              <InvestorBook mine={mine} />
            )}
          </PageSection>
          <PageSection id="mandate" title="Your mandate">
            <MandateSummary
              investorOrganisationId={context.investorOrganisationId}
            />
            <div className="pt-4">
              <AskQChips asks={INVESTOR_ASKS} />
            </div>
          </PageSection>
        </>
      ) : (
        <PageSection id="rounds" title="Your raise">
          <QuietEmpty sentence="Your rounds couldn't load." retry />
        </PageSection>
      )}
      <RelationshipsPanel
        relationships={relationships}
        investor={context.kind === "INVESTOR"}
      />
    </div>
  );
}

type FounderContext = Extract<OwnContext, { readonly kind: "FOUNDER" }>;

/** One tab's content: only this tab's data is read (exported for its test). */
export async function FounderTab({
  tab,
  context,
  horizon,
}: {
  readonly tab: CapitalTab;
  readonly context: FounderContext;
  readonly horizon: BlueprintHorizon;
}) {
  switch (tab) {
    case "overview": {
      const [ledger, readiness] = await Promise.all([
        ledgerOf(context.companyId),
        readinessOf(),
      ]);
      return (
        <div className="flex flex-col gap-6" data-capital-overview>
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
            <RaiseSummary ledger={ledger} />
            <StopYourRaise readiness={readiness} />
          </div>
          <NextSteps readiness={readiness} />
          <AskQChips asks={FOUNDER_ASKS} />
        </div>
      );
    }
    case "raise": {
      const [objective, relationships, ledger] = await Promise.all([
        objectiveOf(context.companyId),
        relationshipsOf(context),
        ledgerOf(context.companyId),
      ]);
      return (
        <PageSection id="rounds" title="Your raise">
          {/* Q room R1: every round on this page, by id, for Q. */}
          {ledger === null ? null : (
            <QSection
              id="rounds"
              kind="CAPITAL_ROUNDS"
              refs={ledger.rounds.slice(0, 12).map((round) => ({
                kind: "CAPITAL_ROUND" as const,
                id: round.id,
              }))}
              total={ledger.rounds.length}
              label={`${String(ledger.rounds.length)} round${ledger.rounds.length === 1 ? "" : "s"}`}
            />
          )}
          {ledger === null ? (
            <QuietEmpty sentence="Your rounds couldn't load." retry />
          ) : (
            <FounderBook
              ledger={ledger}
              draft={draftFrom(objective)}
              leads={(relationships ?? []).flatMap((item) =>
                item.counterpart.kind === "INVESTOR_ORGANISATION"
                  ? [
                      {
                        relationshipId: item.relationshipId,
                        name: item.counterpart.name,
                      },
                    ]
                  : [],
              )}
            />
          )}
          {/* F5: the raise's terms, when there is a raise to set them on. */}
          {objective === null ? null : (
            <div className="pt-6">
              <RaiseTerms objective={objective} />
            </div>
          )}
        </PageSection>
      );
    }
    // Q.03/Q.04: founder-private (docs/design/2026-10-07/founder-readiness).
    case "readiness": {
      const readiness = await readinessOf();
      return (
        <PageSection
          id="readiness"
          title="Readiness"
          description="How ready your company looks to an investor today, from what you have shared. Each pillar in words, with the evidence behind it."
        >
          <div className="flex flex-col gap-4">
            <PrivateNote />
            {readiness === null ? (
              <QuietEmpty sentence="Your readiness couldn't load." retry />
            ) : (
              <ReadinessSection readiness={readiness} />
            )}
          </div>
        </PageSection>
      );
    }
    case "action-plan": {
      const readiness = await readinessOf();
      return (
        <PageSection
          id="action-plan"
          title="Action plan"
          description="Built from your readiness gaps. Steps close themselves when Q sees the evidence."
        >
          <div className="flex flex-col gap-4">
            <PrivateNote />
            {readiness === null ? (
              <QuietEmpty sentence="Your action plan couldn't load." retry />
            ) : (
              <ActionPlanBoard readiness={readiness} />
            )}
          </div>
        </PageSection>
      );
    }
    // BILLING-2 (ADR 0036) / Q.04: the Readiness Blueprint as "Your
    // 3/6/12-month plan"; a plan without it shows the Pro entry instead.
    case "plan":
      return (
        <ReadinessBlueprintSection
          companyId={context.companyId}
          horizon={horizon}
        />
      );
    case "investors": {
      const relationships = await relationshipsOf(context);
      return (
        <RelationshipsPanel relationships={relationships} investor={false} />
      );
    }
  }
}

function RelationshipsPanel({
  relationships,
  investor,
}: {
  readonly relationships: Awaited<ReturnType<typeof ownRelationships>>;
  readonly investor: boolean;
}) {
  return (
    <PageSection id="relationships" title="Relationships">
      {relationships === undefined ? (
        <QuietEmpty sentence="Your relationships couldn't load. Try again in a moment." />
      ) : (
        <RelationshipList
          items={relationships}
          emptySentence={
            investor
              ? "No company relationships yet. Expressing interest from Discover starts one."
              : "No investor relationships yet. When an investor expresses interest, it appears here."
          }
        />
      )}
    </PageSection>
  );
}

/** Raise & rounds: commitments waiting on the founder. */
async function RaiseBadge({ companyId }: { readonly companyId: string }) {
  const ledger = await ledgerOf(companyId);
  const count = ledger === null ? 0 : needsYouCount(ledger);
  return count === 0 ? null : (
    <TabBadge
      text={String(count)}
      spoken={`${String(count)} commitment${count === 1 ? " needs" : "s need"} you`}
    />
  );
}

/** Readiness: what could stop the raise. */
async function ReadinessBadge() {
  const readiness = await readinessOf();
  const count = readiness === null ? 0 : readiness.blockers.length;
  return count === 0 ? null : (
    <TabBadge
      text={String(count)}
      spoken={`${String(count)} thing${count === 1 ? "" : "s"} could stop your raise`}
    />
  );
}

/** Action plan: open steps in Now. */
async function NowBadge() {
  const readiness = await readinessOf();
  const count = readiness === null ? 0 : nowCount(readiness);
  return count === 0 ? null : (
    <TabBadge
      text={`Now ${String(count)}`}
      spoken={`${String(count)} step${count === 1 ? "" : "s"} to do now`}
    />
  );
}

/** An absence or a failure is one sentence and, when there is one, the way forward. */
function QuietEmpty({
  sentence,
  action,
  retry = false,
}: {
  readonly sentence: string;
  readonly action?: ReactNode | undefined;
  readonly retry?: boolean;
}) {
  return (
    <div
      className="flex max-w-(--cq-layout-reading) flex-col gap-3 rounded-2xl border border-(--cq-border-subtle) bg-(--cq-surface-raised) p-5"
      data-state={retry ? "error" : "empty"}
    >
      <p className="cq-body text-(--cq-text-primary)">{sentence}</p>
      {action ?? null}
      {retry ? (
        <div>
          <Link href="/capital" className={buttonClassName("secondary")}>
            Try again
          </Link>
        </div>
      ) : null}
    </div>
  );
}
