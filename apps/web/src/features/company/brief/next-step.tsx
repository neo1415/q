"use client";

import Link from "next/link";
import { useRef, useState, useSyncExternalStore, type ReactNode } from "react";

import type {
  DataRoomView,
  InterestDto,
  RelationshipStateV2,
} from "@capital-q/contracts";
import { Button, buttonClassName } from "@capital-q/ui/button";

import { ExpressInterest } from "@/features/network/express-interest";
import { useDockAvoid } from "@/features/q-dock/dock-avoid";
import { useT } from "@/features/i18n/language";

import { ProfilePass } from "../company-profile-parts";
import type { ProfileTab } from "../profile-tab";
import { ProfileTabLink, useProfileTab } from "../profile-tabs";
import { useBrief } from "./brief-context";
import { journeyFor, type JourneyStep } from "./journey";
import { QMark } from "./parts";

/**
 * The next-step ribbon (profile option 1): one next action, its reason,
 * and the journey's marks; on a phone the same step is the bottom dock.
 * Every action is an existing flow behind its own approval: the questions
 * sheet, the data-room request sheet, the calls page, the commitment on
 * the relationship record. Before the founders accept, the step is the
 * server-confirmed Express interest (Pass stays beside it, neutral).
 */

const PHONE = "(max-width: 1023px)";
function subscribePhone(listener: () => void): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function")
    return () => undefined;
  const query = window.matchMedia(PHONE);
  query.addEventListener("change", listener);
  return () => query.removeEventListener("change", listener);
}
function isPhone(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia(PHONE).matches
  );
}

export { nextCallOf, type NextCall } from "./journey";
import type { NextCall } from "./journey";

export function NextStepRibbon({
  companyId,
  companyName,
  state,
  connected,
  met,
  dataRoom,
  nextCall,
  interest,
  serverTab,
}: {
  /** The tab the server rendered (outside ProfileTabs, it decides). */
  readonly serverTab: ProfileTab;
  readonly companyId: string;
  readonly companyName: string;
  readonly state: RelationshipStateV2 | null;
  readonly connected: boolean;
  readonly met: boolean;
  readonly dataRoom: DataRoomView | null;
  readonly nextCall: NextCall | null;
  readonly interest: InterestDto | null;
}) {
  const t = useT();
  const brief = useBrief();
  const tab = useProfileTab() ?? serverTab;
  // One of the two at a time, so the step's controls (Express interest
  // keeps its own state) exist once: the ribbon, or on a phone the dock.
  const phone = useSyncExternalStore(subscribePhone, isPhone, () => false);
  const requested = brief?.requested ?? new Set<string>();
  const roomDocs =
    dataRoom !== null && dataRoom.viewer === "INVESTOR"
      ? dataRoom.documents
      : [];
  const asked = (id: string) => requested.has(id) || requested.has("*");
  const requestable = roomDocs.filter(
    (doc) => doc.access === "REQUESTABLE" && !asked(doc.documentId),
  );
  const journey = journeyFor({
    companyName,
    founderName: brief?.who === companyName ? null : (brief?.who ?? null),
    state,
    connected,
    drafts: brief?.drafts ?? [],
    waiting: brief?.waiting ?? 0,
    requestable: requestable.map((doc) => doc.title),
    requested: roomDocs.filter(
      (doc) =>
        doc.access === "REQUESTED" ||
        (doc.access === "REQUESTABLE" && asked(doc.documentId)),
    ).length,
    nextCall,
    met,
  });

  // The ribbon moves on with a brass sweep, never on the first paint.
  const step = journey?.steps[journey.now];
  const signature = step === undefined ? "" : `${step.kind}:${step.title}`;
  const [seen, setSeen] = useState(signature);
  const [moved, setMoved] = useState(0);
  if (seen !== signature) {
    setSeen(signature);
    setMoved(moved + 1);
  }

  if (journey === null || step === undefined) return null;
  const record = `/relationships/company/${encodeURIComponent(companyId)}`;
  const total = journey.steps.length;

  const primary = (place: "ribbon" | "dock") => {
    const words = place === "dock" ? step.short : step.action;
    if (step.kind === "CONNECT") {
      return step.action === null ? null : (
        <ExpressInterest
          companyId={companyId}
          companyName={companyName}
          surface="COMPANY_PROFILE"
          initialInterest={interest}
          relationshipState={state}
          prominent
        />
      );
    }
    if (words === null) return null;
    if (step.kind === "ASK") {
      return (
        <Button
          variant="primary"
          onClick={() => brief?.openQuestions()}
          data-next-step="ASK"
        >
          {words}
        </Button>
      );
    }
    if (step.kind === "DOCUMENTS") {
      const only = requestable.length === 1 ? requestable[0] : undefined;
      return (
        <Button
          variant="primary"
          onClick={() => brief?.requestDocuments(only ?? "ALL")}
          data-next-step="DOCUMENTS"
        >
          {words}
        </Button>
      );
    }
    return (
      <Link
        href={step.kind === "CALL" ? `${record}/calls` : `${record}#commitment`}
        className={buttonClassName("primary")}
        data-next-step={step.kind}
      >
        {words}
      </Link>
    );
  };

  const secondary =
    step.kind === "ASK" ? (
      <Button variant="secondary" onClick={() => brief?.openQuestions()}>
        {t("Review first")}
      </Button>
    ) : step.kind === "DOCUMENTS" && tab !== "dataroom" ? (
      <ProfileTabLink
        tab="dataroom"
        fallbackHref={`/company/${encodeURIComponent(companyId)}?tab=dataroom`}
        className={buttonClassName("secondary")}
      >
        {t("Review first")}
      </ProfileTabLink>
    ) : step.kind === "CONNECT" && step.action !== null ? (
      <ProfilePass companyId={companyId} companyName={companyName} />
    ) : null;

  return (
    <>
      {/* The data room has its own next step (data room option 1). */}
      {tab === "dataroom" || phone ? null : (
        <section
          key={`ribbon-${String(moved)}`}
          className="cq-brief-ribbon"
          data-place="page"
          data-moved={moved > 0 ? "" : undefined}
          aria-label={t("Next step")}
          data-next-step-ribbon={step.kind}
        >
          <div className="rb">
            <p className="rk">
              <QMark />
              {t("Next step")}
            </p>
            <p className="rt">{step.title}</p>
            <p className="rw">{step.reason}</p>
            <Marks steps={journey.steps} />
          </div>
          <div className="ra">
            {secondary}
            {primary("ribbon")}
          </div>
        </section>
      )}
      {!phone ? null : (
        <PhoneDock
          key={`dock-${String(moved)}`}
          moved={moved > 0}
          kind={step.kind}
        >
          <p className="dt">
            <span>
              Next step {journey.now + 1} of {total}
            </span>
            <b>{step.title}</b>
          </p>
          {primary("dock")}
        </PhoneDock>
      )}
    </>
  );
}

/**
 * The phone's next-step bar, registered with the Q dock so the dock never
 * sits on its text or button (QA F-87, live 24 Oct: the Q bubble covered
 * "Next step 1 of 5"). Its own component so a re-keyed bar registers again.
 */
function PhoneDock({
  moved,
  kind,
  children,
}: {
  readonly moved: boolean;
  readonly kind: string;
  readonly children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useDockAvoid(ref);
  return (
    <div
      ref={ref}
      className="cq-brief-dock"
      data-moved={moved ? "" : undefined}
      data-next-step-dock={kind}
    >
      {children}
    </div>
  );
}

function Marks({ steps }: { readonly steps: readonly JourneyStep[] }) {
  const done = steps.filter((step) => step.mark === "DONE").length;
  return (
    <span
      className="cq-brief-steps"
      role="img"
      aria-label={`${String(done)} of ${String(steps.length)} steps done`}
    >
      {steps.map((step) => (
        <i key={step.kind} data-step={step.mark.toLowerCase()} />
      ))}
    </span>
  );
}
