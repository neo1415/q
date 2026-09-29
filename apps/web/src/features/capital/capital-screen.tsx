import Link from "next/link";
import type { ReactNode } from "react";

import {
  ApiProblemError,
  getCompanyFundraising,
  getCurrentCapitalObjective,
} from "@capital-q/api-client";
import type { CapitalObjectiveDto, FundraisingDto } from "@capital-q/contracts";
import { instrumentLabel, STAGE_OPTIONS } from "@capital-q/founder-onboarding";
import { Badge } from "@capital-q/ui/badge";
import { buttonClassName } from "@capital-q/ui/button";
import { formatAmountForDisplay } from "@capital-q/ui/money-input";

import { PageSection } from "@/components/app-shell/page-container";
import { apiSession, resolveOwnContext } from "@/features/q/context";
import { ownRelationships } from "@/features/relationships/relationship-data";
import { RelationshipList } from "@/features/relationships/relationship-list";
import { formatDay } from "@/components/date-format";

import { AskQChips } from "./ask-q-chips";
import { FundraisingPanel } from "./fundraising-panel";

/**
 * Capital: the objective and the relationships behind it (doc 17 §§105-107;
 * design/visual-direction.md "No dashboards").
 *
 * Rendered on the server under the person's own session. The objective is
 * the company's current capital objective as the API returns it — the same
 * row F6 created — shown as one dossier panel. Relationships are hairline
 * rows from the side's own per-party fold (CQ-WEB-030): where each stands,
 * since when, and what is next. Nothing here is a counter, a score or a
 * pipeline.
 */

const STAGE_LABELS: ReadonlyMap<string, string> = new Map(
  STAGE_OPTIONS.map((option) => [option.optionKey, option.label]),
);
// The objective stores canonical codes ("priced_equity"); the shared
// label reads either spelling.
const INSTRUMENT_LABELS = {
  get: (code: string) => instrumentLabel(code),
};

const STATUS_LABELS: Readonly<Record<CapitalObjectiveDto["status"], string>> = {
  ACTIVE: "Active",
  ACHIEVED: "Achieved",
  CLOSED_BY_FOUNDER: "Closed",
  DISCONTINUED: "Discontinued",
  REPLACED: "Replaced",
};

function label(
  map: { readonly get: (code: string) => string | undefined },
  code: string | null,
) {
  return code === null ? null : (map.get(code) ?? code.replace(/_/g, " "));
}

/** A calendar date as people write it; the stored value is untouched. */
function formatDate(value: string): string {
  return formatDay(value.slice(0, 10));
}

async function currentObjective(
  companyId: string,
): Promise<CapitalObjectiveDto | null | undefined> {
  const session = await apiSession();
  if (session === null) {
    return undefined;
  }
  try {
    return await getCurrentCapitalObjective(session, companyId);
  } catch (error) {
    // No current objective is a normal state, not an error to show.
    if (error instanceof ApiProblemError && error.status === 404) {
      return null;
    }
    return undefined;
  }
}

async function fundraisingOf(
  companyId: string,
): Promise<FundraisingDto | null> {
  const session = await apiSession();
  if (session === null) return null;
  return getCompanyFundraising(session, companyId).catch(() => null);
}

export async function CapitalScreen() {
  const context = await resolveOwnContext();
  const [objective, relationships, fundraising] = await Promise.all([
    context.kind === "FOUNDER"
      ? currentObjective(context.companyId)
      : Promise.resolve(null),
    ownRelationships(context),
    context.kind === "FOUNDER"
      ? fundraisingOf(context.companyId)
      : Promise.resolve(null),
  ]);

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
      <PageSection id="objective" title="Your raise">
        {objective !== null && objective !== undefined ? (
          <ObjectivePanel objective={objective} />
        ) : (
          <QuietEmpty
            sentence={
              objective === undefined
                ? "Your raise couldn't load. Try again in a moment."
                : context.kind === "INVESTOR"
                  ? "Your mandate stands in for an objective on this side of the table. Review it whenever it changes."
                  : "No raise yet. Tell Q what you're raising and this page gathers around it."
            }
            action={
              context.kind === "INVESTOR" ? (
                <span className="flex flex-wrap gap-2">
                  <Link
                    href="/onboarding/investor?review=1"
                    className={buttonClassName("secondary")}
                  >
                    Review my mandate
                  </Link>
                  <Link
                    href="/discover/saved"
                    className={buttonClassName("secondary")}
                  >
                    Saved companies
                  </Link>
                  <Link
                    href="/gateway"
                    className={buttonClassName("secondary")}
                  >
                    Your gateway
                  </Link>
                </span>
              ) : objective === null ? (
                <Link href="/home#q" className={buttonClassName("secondary")}>
                  Tell Q your objective
                </Link>
              ) : undefined
            }
          />
        )}
        {fundraising === null ? null : (
          <div className="pt-6">
            <FundraisingPanel fundraising={fundraising} />
          </div>
        )}
        <div className="pt-4">
          <AskQChips asks={asks} />
        </div>
      </PageSection>

      <PageSection id="relationships" title="Relationships">
        {relationships === undefined ? (
          <QuietEmpty sentence="Your relationships couldn't load. Try again in a moment." />
        ) : (
          <RelationshipList
            items={relationships}
            emptySentence={
              context.kind === "INVESTOR"
                ? "No company relationships yet. Expressing interest from Discover starts one."
                : "No investor relationships yet. When an investor organisation expresses interest, it appears here."
            }
          />
        )}
      </PageSection>
    </div>
  );
}

function ObjectivePanel({
  objective,
}: {
  readonly objective: CapitalObjectiveDto;
}) {
  const target = `${objective.target.currency} ${formatAmountForDisplay(objective.target.amount)}`;
  const rows: readonly {
    readonly id: string;
    readonly term: string;
    readonly value: string | null;
    readonly numeric?: boolean;
  }[] = [
    { id: "target", term: "Target", value: target, numeric: true },
    {
      id: "instrument",
      term: "Instrument",
      value: label(INSTRUMENT_LABELS, objective.instrumentCode),
    },
    {
      id: "stage",
      term: "Stage",
      value: label(STAGE_LABELS, objective.targetStage),
    },
    {
      id: "close",
      term: "Target close",
      value:
        objective.targetCloseDate === null
          ? null
          : formatDate(objective.targetCloseDate),
      numeric: true,
    },
    { id: "use", term: "Use of funds", value: objective.useOfFundsSummary },
  ];

  // The raise at a glance (founder direction 2026-09-29): the number large,
  // the terms as quiet chips, the use of funds under it. What is not set
  // is simply absent; editing is Q's (the asks below the card).
  const terms = rows.filter(
    (row) =>
      row.id !== "target" &&
      row.id !== "use" &&
      row.value !== null &&
      row.value.length > 0,
  );
  const use = rows.find((row) => row.id === "use")?.value ?? null;
  return (
    <section
      className="cq-glow-card flex max-w-(--cq-layout-reading) flex-col gap-4 rounded-2xl p-5 sm:p-6"
      data-objective
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <span className="cq-caption text-(--cq-text-tertiary)">Raising</span>
          <h3 className="cq-title-xl cq-numeric text-(--cq-text-primary)">
            {target}
          </h3>
        </div>
        <span className="flex items-center gap-2">
          <Badge tone={objective.status === "ACTIVE" ? "accent" : "neutral"}>
            {STATUS_LABELS[objective.status]}
          </Badge>
          <span className="cq-caption cq-numeric text-(--cq-text-tertiary)">
            since {formatDate(objective.startedAt)}
          </span>
        </span>
      </div>
      {terms.length === 0 ? null : (
        <ul className="flex flex-wrap gap-2" aria-label="Terms">
          {terms.map((row) => (
            <li
              key={row.id}
              data-objective-row={row.id}
              className="cq-body-sm rounded-full border border-(--cq-border-subtle) bg-(--cq-surface-subtle) px-3 py-1 text-(--cq-text-primary)"
            >
              <span className="sr-only">{row.term}: </span>
              {row.id === "close" ? `Close ${row.value ?? ""}` : row.value}
            </li>
          ))}
        </ul>
      )}
      {use === null || use.length === 0 ? null : (
        <p
          className="cq-body text-(--cq-text-secondary)"
          data-objective-row="use"
        >
          {use}
        </p>
      )}
    </section>
  );
}

/** An absence is one sentence and, when there is one, the way forward. */
function QuietEmpty({
  sentence,
  action,
}: {
  readonly sentence: string;
  readonly action?: ReactNode | undefined;
}) {
  return (
    <div
      className="flex max-w-(--cq-layout-reading) flex-col gap-3"
      data-state="empty"
    >
      <p className="cq-body text-(--cq-text-secondary)">{sentence}</p>
      {action !== undefined ? <div>{action}</div> : null}
    </div>
  );
}
