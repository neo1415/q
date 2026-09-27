import Link from "next/link";
import type { ReactNode } from "react";

import {
  ApiProblemError,
  getCurrentCapitalObjective,
} from "@capital-q/api-client";
import type { CapitalObjectiveDto } from "@capital-q/contracts";
import { instrumentLabel, STAGE_OPTIONS } from "@capital-q/founder-onboarding";
import { Badge } from "@capital-q/ui/badge";
import { buttonClassName } from "@capital-q/ui/button";
import { formatAmountForDisplay } from "@capital-q/ui/money-input";

import { PageSection } from "@/components/app-shell/page-container";
import { apiSession, resolveOwnContext } from "@/features/q/context";
import { ownRelationships } from "@/features/relationships/relationship-data";
import { RelationshipList } from "@/features/relationships/relationship-list";

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
  const parsed = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(parsed);
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

export async function CapitalScreen() {
  const context = await resolveOwnContext();
  const [objective, relationships] = await Promise.all([
    context.kind === "FOUNDER"
      ? currentObjective(context.companyId)
      : Promise.resolve(null),
    ownRelationships(context),
  ]);

  return (
    <div className="flex flex-col gap-10">
      <PageSection
        id="objective"
        title="Your objective"
        description={
          context.kind === "INVESTOR"
            ? "What you are deploying is your mandate; Discover works from it."
            : undefined
        }
      >
        {objective !== null && objective !== undefined ? (
          <ObjectivePanel objective={objective} />
        ) : (
          <QuietEmpty
            sentence={
              objective === undefined
                ? "Your objective couldn't be read just now."
                : context.kind === "INVESTOR"
                  ? "Your mandate stands in for an objective on this side of the table. Review it whenever it changes."
                  : "No capital objective yet. Tell Q what you're raising, and it becomes the objective everything here gathers around."
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
                </span>
              ) : objective === null ? (
                <Link href="/home#q" className={buttonClassName("secondary")}>
                  Tell Q your objective
                </Link>
              ) : undefined
            }
          />
        )}
      </PageSection>

      <PageSection
        id="relationships"
        title="Relationships"
        description={
          context.kind === "INVESTOR"
            ? "Companies your organisation has discovered or approached, and where each stands."
            : "Investor organisations that have approached your company, and where each stands."
        }
      >
        {relationships === undefined ? (
          <QuietEmpty sentence="Your relationships couldn't be read just now." />
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

  return (
    <section className="cq-panel max-w-(--cq-layout-reading)" data-objective>
      <header className="cq-panel-header">
        <h3 className="cq-title-sm cq-numeric text-(--cq-text-primary)">
          Raising {target}
        </h3>
        <span className="cq-status-line">
          <Badge tone={objective.status === "ACTIVE" ? "accent" : "neutral"}>
            {STATUS_LABELS[objective.status]}
          </Badge>
          <span className="cq-numeric">
            since {formatDate(objective.startedAt)}
          </span>
        </span>
      </header>
      <dl className="cq-panel-body cq-panel-rows py-1">
        {rows.map((row) => (
          <div
            key={row.id}
            className="flex flex-col gap-0.5 py-3 sm:flex-row sm:justify-between sm:gap-4"
            data-objective-row={row.id}
          >
            <dt className="cq-label shrink-0 text-(--cq-text-secondary)">
              {row.term}
            </dt>
            <dd
              className={
                row.numeric === true
                  ? "cq-body cq-numeric text-(--cq-text-primary) sm:text-right"
                  : "cq-body text-(--cq-text-primary) sm:text-right"
              }
            >
              {row.value === null || row.value.length === 0 ? (
                <span className="text-(--cq-text-tertiary)">Not set</span>
              ) : (
                row.value
              )}
            </dd>
          </div>
        ))}
      </dl>
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
