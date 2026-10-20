"use client";

import Link from "next/link";

import { buttonClassName } from "@capital-q/ui/button";
import { EmptyState, ErrorState, Skeleton } from "@capital-q/ui/states";

import { PageHeader } from "@/components/app-shell/page-container";
import { FitPanel } from "@/features/fit/fit-panel";
import { FitTopView } from "@/features/fit/fit-top-view";
import { QViewMark } from "@/features/fit/q-view-note";
import { ConnectionRequestsInbox } from "@/features/network/connection-requests-inbox";
import { RelationshipsIndex } from "@/features/relationships/relationships-index";

import { FITS, KORA, relationships, requests, TOP3, VIEWS } from "./fixtures";

export type MatchReviewProps = {
  readonly view: "requests" | "top3" | "relationships" | "profile";
  readonly state: "full" | "loading" | "empty" | "error" | "limited";
  readonly sheet: "none" | "fit" | "why";
  readonly now: number;
};

const refused = () =>
  Promise.resolve({
    ok: false as const,
    message: "Design review: nothing is sent.",
    retryable: false,
  });

export function MatchReview({ view, state, sheet, now }: MatchReviewProps) {
  if (view === "top3") {
    return (
      <FitTopView
        state={
          state === "loading"
            ? { kind: "LOADING" }
            : state === "error"
              ? { kind: "ERROR" }
              : state === "limited"
                ? { kind: "NO_MANDATE" }
                : {
                    kind: "READY",
                    comparison:
                      state === "empty"
                        ? {
                            ...TOP3,
                            entries: [],
                            considered: 46,
                            leftOut: {
                              outsideMandate: 41,
                              notEnoughInformation: 5,
                            },
                          }
                        : TOP3,
                  }
        }
        qViews={VIEWS}
        closeHref="/dev/match"
        retryHref="/dev/match?view=top3"
        defaultWhyOpen={sheet === "why"}
      />
    );
  }

  if (view === "relationships") {
    const items = relationships(now);
    return (
      <div className="flex max-w-[820px] flex-col gap-4">
        <h1 className="cq-title-lg text-(--cq-text-primary)">Relationships</h1>
        {state === "loading" ? (
          <Skeleton lines={6} />
        ) : state === "error" ? (
          <RelationshipsIndex side="INVESTOR" items={undefined} now={now} />
        ) : (
          <RelationshipsIndex
            side="INVESTOR"
            items={state === "empty" ? [] : items}
            now={now}
            fits={Object.fromEntries(
              items.map((item) => [
                item.counterpart.id,
                state === "limited"
                  ? null
                  : (FITS.get(item.counterpart.id)?.profile ?? null),
              ]),
            )}
          />
        )}
      </div>
    );
  }

  if (view === "profile") {
    return (
      <div className="grid max-w-[1180px] gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex flex-col gap-3">
          <h1 className="cq-title-lg text-(--cq-text-primary)">
            {KORA.fit.name}
          </h1>
          <p className="cq-body-sm text-(--cq-text-secondary)">
            {KORA.fit.line}. The profile itself belongs to the profile page;
            this shows the fit panel its FitPanelSlot takes.
          </p>
        </div>
        {state === "error" ? (
          <ErrorState
            title="Fit didn't load"
            description="Nothing you did was lost. Try again in a moment."
          />
        ) : state === "empty" || state === "limited" ? (
          <EmptyState
            title="Fit shows once your mandate is set"
            description="Q measures every company against what you tell it. It takes about two minutes."
            action={
              <Link href="/profile" className={buttonClassName("primary")}>
                Set your mandate
              </Link>
            }
          />
        ) : (
          <FitPanel
            companyId={KORA.fit.companyId}
            name={KORA.fit.name}
            fit={
              state === "loading"
                ? { status: "LOADING" }
                : { status: "READY", fit: KORA.fit }
            }
            qView={KORA.view}
            defaultOpen={sheet === "fit"}
          />
        )}
      </div>
    );
  }

  const items = requests(now);
  return (
    <div className="flex max-w-[1180px] flex-col">
      <PageHeader
        title="Company requests"
        description="Companies that asked to connect with Northbound Capital. Accepting connects you; it isn’t an investment."
      >
        {state === "empty" ? null : (
          <Link
            href="/dev/match?view=top3"
            className={buttonClassName("secondary")}
          >
            <QViewMark />
            Q, give me the top three
          </Link>
        )}
      </PageHeader>
      {state === "limited" ? (
        <p className="cq-body-sm mb-4 rounded-xl bg-(--cq-surface-subtle) px-3.5 py-2.5 text-(--cq-text-primary)">
          You&apos;re a Member at Northbound Capital. You can read requests;
          admins accept or decline.
        </p>
      ) : null}
      {state === "loading" ? (
        <div className="grid gap-3 min-[1200px]:grid-cols-2">
          {[1, 2, 3, 4].map((n) => (
            <div
              key={n}
              className="flex flex-col gap-3 rounded-(--cq-radius-lg) border border-(--cq-border-subtle) p-4"
            >
              <Skeleton lines={3} />
              <Skeleton lines={2} />
            </div>
          ))}
        </div>
      ) : state === "error" ? (
        <ErrorState
          title="Company requests didn't load"
          description="The connection dropped before it finished. Nothing you did was lost."
          action={
            <Link href="/dev/match" className={buttonClassName("secondary")}>
              Try again
            </Link>
          }
        />
      ) : (
        <ConnectionRequestsInbox
          items={state === "empty" ? [] : items}
          answer={refused}
          fits={FITS}
          qViews={VIEWS}
          answerable={state !== "limited"}
          now={now}
          openFitFor={sheet === "fit" ? KORA.fit.companyId : undefined}
        />
      )}
    </div>
  );
}
