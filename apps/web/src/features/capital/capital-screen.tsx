import Link from "next/link";
import type { ReactNode } from "react";

import {
  ApiProblemError,
  getCurrentCapitalObjective,
} from "@capital-q/api-client";
import type { CapitalObjectiveDto } from "@capital-q/contracts";
import { buttonClassName } from "@capital-q/ui/button";

import { PageSection } from "@/components/app-shell/page-container";
import { apiSession, resolveOwnContext } from "@/features/q/context";
import { QSection } from "@/features/q/q-section";
import { ownRelationships } from "@/features/relationships/relationship-data";
import { RelationshipList } from "@/features/relationships/relationship-list";

import { AskQChips } from "./ask-q-chips";
import {
  draftFrom,
  founderLedger,
  FounderBook,
  InvestorBook,
  investorCommitments,
} from "./capital-book";
import { MandateSummary } from "./mandate-summary";
import { RaiseTerms } from "./raise-terms";
import { horizonFrom, ReadinessBlueprintSection } from "./readiness-blueprint";
import { ActionPlanBoard } from "@/features/readiness/action-plan-board";
import { ownReadiness } from "@/features/readiness/readiness-data";
import {
  PrivateNote,
  ReadinessSection,
} from "@/features/readiness/readiness-section";

/**
 * Capital (founder direction 2026-10-04: "is capital divided into
 * different rounds? ... how does one now confirm they've gotten the
 * money"): for a founder, the current round as a card -- raised, confirmed
 * and pledged against its target -- the total across rounds, every
 * commitment as a card with its one next step, and the other rounds; for
 * an investor, what they invested and their commitments, each with its
 * next step. Raised is always received money, derived, never typed.
 * Relationships follow, as before.
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

export async function CapitalScreen({
  horizon,
}: {
  /** Q.04: the plan horizon from `?horizon=3|6|12`; anything else is 6. */
  readonly horizon?: string | undefined;
} = {}) {
  const context = await resolveOwnContext();
  const [objective, relationships, ledger, mine, readiness] = await Promise.all(
    [
      context.kind === "FOUNDER"
        ? currentObjective(context.companyId)
        : Promise.resolve(null),
      ownRelationships(context),
      context.kind === "FOUNDER"
        ? founderLedger(context.companyId)
        : Promise.resolve(null),
      context.kind === "INVESTOR"
        ? investorCommitments()
        : Promise.resolve(null),
      // Q.03/Q.04: founder-private; never read for an investor.
      context.kind === "FOUNDER" ? ownReadiness() : Promise.resolve(null),
    ],
  );

  const asks =
    context.kind === "INVESTOR"
      ? [
          {
            label: "Companies that fit my mandate",
            prompt:
              "Which companies on Capital Q fit my mandate best right now?",
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
        ]
      : [
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
              <AskQChips asks={asks} />
            </div>
          </PageSection>
        </>
      ) : (
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
          <div className="pt-6">
            <AskQChips asks={asks} />
          </div>
        </PageSection>
      )}

      {/*
        Q.03/Q.04: the founder's readiness and action plan, founder-private
        (design: docs/design/2026-10-07/founder-readiness).
      */}
      {context.kind === "FOUNDER" ? (
        <>
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
          <PageSection
            id="action-plan"
            title="Action plan"
            description="Built from your readiness gaps. Steps close themselves when Q sees the evidence."
          >
            {readiness === null ? (
              <QuietEmpty sentence="Your action plan couldn't load." retry />
            ) : (
              <ActionPlanBoard readiness={readiness} />
            )}
          </PageSection>
        </>
      ) : null}

      {/*
        BILLING-2 (ADR 0036) / Q.04: the Readiness Blueprint as "Your
        3/6/12-month plan"; a plan without it shows the Pro entry instead.
      */}
      {context.kind === "FOUNDER" ? (
        <ReadinessBlueprintSection
          companyId={context.companyId}
          horizon={horizonFrom(horizon)}
        />
      ) : null}

      <PageSection id="relationships" title="Relationships">
        {relationships === undefined ? (
          <QuietEmpty sentence="Your relationships couldn't load. Try again in a moment." />
        ) : (
          <RelationshipList
            items={relationships}
            emptySentence={
              context.kind === "INVESTOR"
                ? "No company relationships yet. Expressing interest from Discover starts one."
                : "No investor relationships yet. When an investor expresses interest, it appears here."
            }
          />
        )}
      </PageSection>
    </div>
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
