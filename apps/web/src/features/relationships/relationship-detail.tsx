import Link from "next/link";
import type { ReactNode } from "react";

import type { RelationshipStatusDto } from "@capital-q/contracts";
import { buttonClassName } from "@capital-q/ui/button";
import { ArrowLeft, ICON_SIZE } from "@capital-q/ui/icons";

import {
  PageContainer,
  PageHeader,
  PageSection,
} from "@/components/app-shell/page-container";

import { AskQAboutRelationship } from "./relationship-actions";
import { RelationshipTimeline } from "./relationship-timeline";
import {
  formatRelationshipDate,
  nextStepSentence,
  type RelationshipSide,
  STATE_WORDS,
} from "./relationship-words";

/**
 * One relationship, for one side (CQ-WEB-030; doc 25 §121: "where are we,
 * what happened, what is next"; spec §12.5).
 *
 * Three sections in that order, each from the server's per-party fold:
 * where the relationship stands (in words, with the date it got there),
 * what can be done about it (the same server-confirmed controls used
 * everywhere else, and Ask Q; absent when there is nothing to do), and
 * what happened (a dated timeline with who can see each entry). No
 * celebration, no score, no badge; nothing here is a messaging surface
 * (CQ-COMM-001).
 */
export function RelationshipDetail({
  side,
  counterpart,
  relationship,
  actions,
  absentSentence,
  askQ = true,
}: {
  readonly side: RelationshipSide;
  readonly counterpart: string;
  readonly relationship: RelationshipStatusDto | null;
  /** The server-confirmed action for this side and state, if any. */
  readonly actions: ReactNode;
  /** Said when nothing is on record that this side can see. */
  readonly absentSentence: string;
  /** Whether Q can be asked about it: false when nothing is on record to ask about. */
  readonly askQ?: boolean | undefined;
}) {
  return (
    <PageContainer>
      <BackToCapital />
      <PageHeader
        title={counterpart}
        description={
          side === "INVESTOR"
            ? "Your organisation's relationship with this company."
            : "Your company's relationship with this investor organisation."
        }
      />

      <div className="flex flex-col gap-10">
        <PageSection id="where" title="Where you are">
          <div
            className="flex max-w-(--cq-layout-reading) flex-col gap-2"
            data-relationship-state={relationship?.state ?? "NONE"}
          >
            {relationship === null ? (
              <p className="cq-body text-(--cq-text-secondary)">
                {absentSentence}
              </p>
            ) : (
              <>
                <p className="cq-title-sm text-(--cq-text-primary)">
                  {STATE_WORDS[relationship.state]}
                  <span className="cq-numeric text-(--cq-text-secondary)">
                    {" "}
                    since {formatRelationshipDate(relationship.stateSince)}
                  </span>
                </p>
                <p className="cq-body text-(--cq-text-secondary)">
                  {nextStepSentence(relationship.nextStep, counterpart)}
                </p>
              </>
            )}
          </div>
        </PageSection>

        {/* The next step is said above; this holds only what can be done. */}
        {actions === null && !askQ ? null : (
          <PageSection id="next" title="What you can do">
            <div className="flex max-w-(--cq-layout-reading) flex-col items-start gap-3">
              {actions}
              {askQ ? (
                <AskQAboutRelationship counterpart={counterpart} />
              ) : null}
            </div>
          </PageSection>
        )}

        {relationship === null ||
        relationship.milestones.length === 0 ? null : (
          <PageSection id="history" title="What happened">
            <RelationshipTimeline
              milestones={relationship.milestones}
              side={side}
              counterpart={counterpart}
            />
          </PageSection>
        )}
      </div>
    </PageContainer>
  );
}

function BackToCapital() {
  return (
    <Link
      href="/capital#relationships"
      className={buttonClassName("quiet", "regular", "-ml-4 self-start")}
    >
      <ArrowLeft size={ICON_SIZE.regular} aria-hidden="true" />
      All relationships
    </Link>
  );
}

/** A page that cannot answer for this person: one calm sentence. */
export function RelationshipUnavailable({
  sentence,
}: {
  readonly sentence: string;
}) {
  return (
    <PageContainer>
      <BackToCapital />
      <PageHeader title="Relationship" />
      <p className="cq-body max-w-(--cq-layout-reading) text-(--cq-text-secondary)">
        {sentence}
      </p>
    </PageContainer>
  );
}
