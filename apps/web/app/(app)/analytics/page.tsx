import type { Metadata } from "next";

import {
  getCompanyEngagement,
  getMyEngagement,
  getMyInvestorViewing,
} from "@capital-q/api-client";
import type {
  CompanyEngagementDto,
  EngagementViewerDto,
  IntentSignalDto,
  InvestorViewingDto,
  MyEngagementDto,
} from "@capital-q/contracts";
import { EmptyState, ErrorState } from "@capital-q/ui/states";

import {
  PageContainer,
  PageSection,
} from "@/components/app-shell/page-container";
import { when } from "@/features/admin/words";
import { InvestorViewers } from "@/features/engagement/investor-viewers";
import { VisibilityChoice } from "@/features/engagement/visibility-choice";
import { apiSession, resolveOwnContext } from "@/features/q/context";
import { QSection } from "@/features/q/q-section";
import { serverT } from "@/features/i18n/server";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await serverT();
  return { title: t("Analytics") };
}

/**
 * Q Workspace §8 A3/A4. A founder sees intent first (real time, every
 * plan), then passive viewing within the floors, weekly and at each
 * viewer's own level; an investor sees their own visibility, what they
 * viewed and how founders answered. Every identity was decided by the
 * analytics projection; this page only shows it. Nothing here suggests
 * contacting anyone because they viewed (§6.7.14).
 */
export default async function AnalyticsPage() {
  const t = await serverT();
  const [context, session] = await Promise.all([
    resolveOwnContext(),
    apiSession(),
  ]);
  if (session === null || context.kind === "NONE") {
    return (
      <PageContainer>
        <EmptyState
          title={t("Analytics needs a company or a firm")}
          description={t(
            "Once you work for a company or an investment firm, what happened with your profile and your requests shows here.",
          )}
        />
      </PageContainer>
    );
  }
  if (context.kind === "FOUNDER") {
    const data = await getCompanyEngagement(session, context.companyId).catch(
      () => null,
    );
    return (
      <PageContainer className="flex flex-col gap-8">
        {data === null ? (
          <ErrorState
            title={t("Analytics couldn't load")}
            description={t("Try again in a moment.")}
          />
        ) : (
          <FounderAnalytics data={data} t={t} />
        )}
      </PageContainer>
    );
  }
  const [mine, viewing] = await Promise.all([
    getMyEngagement(session).catch(() => null),
    // Who viewed you: only for a member of an investor firm (404 otherwise).
    getMyInvestorViewing(session).catch(() => null),
  ]);
  return (
    <PageContainer className="flex flex-col gap-8">
      {mine === null ? (
        <ErrorState
          title={t("Analytics couldn't load")}
          description={t("Try again in a moment.")}
        />
      ) : (
        <InvestorAnalytics data={mine} viewing={viewing} t={t} />
      )}
    </PageContainer>
  );
}

type T = (text: string) => string;

const LIST =
  "divide-y divide-(--cq-border-subtle) border-y border-(--cq-border-subtle)";
const ROW = "flex flex-col gap-1 py-3";
const MAIN = "cq-body text-(--cq-text-primary)";
const NOTE = "cq-caption text-(--cq-text-secondary)";

function intentWho(signal: IntentSignalDto): string {
  if (signal.viewerName !== null && signal.organisationName !== null) {
    return `${signal.viewerName} (${signal.organisationName})`;
  }
  if (signal.organisationName !== null) {
    return `Someone from ${signal.organisationName}`;
  }
  return "An investor";
}

const INTENT_VERB: Record<IntentSignalDto["type"], string> = {
  SAVE: "saved your company",
  INTEREST: "asked to connect",
  DATA_ROOM_REQUEST: "asked for data-room access",
};

function viewerWho(viewer: EngagementViewerDto): string {
  switch (viewer.visibility) {
    case "FULL_IDENTITY":
      return `${viewer.viewerName ?? "A named investor"}${viewer.organisationName === null ? "" : ` (${viewer.organisationName})`}`;
    case "ORGANISATION_ONLY":
      return `Someone from ${viewer.organisationName ?? "an investor organisation"}`;
    case "ANONYMOUS":
      return `Investors who chose to stay anonymous (${String(viewer.organisations)} organisations)`;
    case "AGGREGATE":
      return `${String(viewer.organisations)} investor organisations`;
  }
}

function FounderAnalytics({
  data,
  t,
}: {
  readonly data: CompanyEngagementDto;
  readonly t: T;
}) {
  const period = data.passiveBatch === "WEEKLY" ? "week" : "day";
  const below = t(
    `Fewer than ${String(data.floor)} investor organisations viewed this ${period}`,
  );
  const deck = data.deckFunnel;
  const opened = deck.length === 0 ? 0 : (deck[0]?.viewersReached ?? 0);
  return (
    <>
      <QSection
        id="intent"
        kind="INTEREST_LIST"
        total={data.intent.length}
        label={t("intent signals")}
      >
        <PageSection
          id="intent"
          title={t("Intent")}
          description={t(
            "Saves, connection requests and data-room requests, as they happen.",
          )}
        >
          {data.intent.length === 0 ? (
            <p className={NOTE}>{t("No saves or requests yet.")}</p>
          ) : (
            <ul className={LIST}>
              {data.intent.map((signal) => (
                <li
                  key={`${signal.type}-${signal.occurredAt}-${signal.viewerOrganisationId ?? "anon"}`}
                  className={ROW}
                >
                  <span className={MAIN}>
                    {t(intentWho(signal))} {t(INTENT_VERB[signal.type])}
                  </span>
                  <span className={NOTE}>{t(when(signal.occurredAt))}</span>
                </li>
              ))}
            </ul>
          )}
        </PageSection>
      </QSection>

      <QSection
        id="deck-views"
        kind="DECK"
        total={deck.length}
        label={t("deck views by slide")}
      >
        <PageSection
          id="deck-views"
          title={t("Deck views")}
          description={t(
            "How far investors got through your deck, slide by slide, in completed weeks.",
          )}
        >
          {!data.floorMet ? (
            <p className={NOTE}>{below}</p>
          ) : deck.length === 0 ? (
            <p className={NOTE}>{t("No one has read your deck yet.")}</p>
          ) : (
            <ol className={LIST}>
              {deck.map((step) => (
                <li
                  key={`${step.documentId}-${String(step.slideNumber)}`}
                  className="flex items-center gap-3 py-2"
                >
                  <span className={`${MAIN} w-20 shrink-0`}>
                    {t(`Slide ${String(step.slideNumber)}`)}
                  </span>
                  <span
                    aria-hidden="true"
                    className="h-2 rounded-(--cq-radius-full) bg-(--cq-surface-strong)"
                    style={{
                      width: `${String(opened === 0 ? 0 : Math.round((step.viewersReached / opened) * 100))}%`,
                      maxWidth: "60%",
                    }}
                  />
                  <span className={NOTE}>
                    {t(
                      `${String(step.viewersReached)} reached · median ${String(Math.round(step.medianDwellMs / 1000))}s`,
                    )}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </PageSection>
      </QSection>

      <QSection
        id="viewers"
        kind="OTHER"
        total={data.viewers.length}
        label={t("who viewed")}
      >
        <PageSection
          id="viewers"
          title={t("Who viewed")}
          description={
            data.perViewer
              ? t(
                  "Each investor appears at the level they chose. Viewing is not interest, and not an invitation to get in touch.",
                )
              : t(
                  "Shown together on your plan. Founder Pro shows each investor at the level they chose. Viewing is not interest, and not an invitation to get in touch.",
                )
          }
        >
          {data.viewers.length === 0 ? (
            <p className={NOTE}>{below}</p>
          ) : (
            <ul className={LIST}>
              {data.viewers.map((viewer) => (
                <li
                  key={`${viewer.visibility}-${viewer.viewerUserId ?? viewer.viewerOrganisationId ?? "merged"}`}
                  className={ROW}
                >
                  <span className={MAIN}>{t(viewerWho(viewer))}</span>
                  <span className={NOTE}>
                    {t(
                      `${String(viewer.profileViews)} profile views · ${String(viewer.deckOpens)} deck opens · ${String(viewer.qCardViews)} Q Card views`,
                    )}
                    {viewer.lastPeriodStart === null
                      ? ""
                      : ` · ${t("week of")} ${viewer.lastPeriodStart}`}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </PageSection>
      </QSection>

      <QSection
        id="trend"
        kind="OTHER"
        total={data.periods.length}
        label={t("views by week")}
      >
        <PageSection id="trend" title={t("By week")}>
          {data.periods.length === 0 ? (
            <p className={NOTE}>{below}</p>
          ) : (
            <ul className={LIST}>
              {data.periods.map((week) => (
                <li key={week.periodStart} className={ROW}>
                  <span className={MAIN}>
                    {t("Week of")} {week.periodStart}
                  </span>
                  <span className={NOTE}>
                    {t(
                      `${String(week.organisations)} organisations · ${String(week.profileViews)} profile views · ${String(week.deckOpens)} deck opens · ${String(week.videoWatches)} video plays`,
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </PageSection>
      </QSection>

      <QSection
        id="breakdown"
        kind="OTHER"
        total={data.slices.length}
        label={t("viewers by type and geography")}
      >
        <PageSection
          id="breakdown"
          title={t("By investor type and geography")}
          description={t(
            `Groups under ${String(data.sliceFloor)} organisations are combined so no one can be singled out.`,
          )}
        >
          {data.slices.length === 0 ? (
            <p className={NOTE}>{below}</p>
          ) : (
            <ul className={LIST}>
              {data.slices.map((slice) => (
                <li key={`${slice.dimension}-${slice.slice}`} className={ROW}>
                  <span className={MAIN}>
                    {slice.suppressed ? t("Others") : slice.slice}
                  </span>
                  <span className={NOTE}>
                    {slice.suppressed
                      ? t("Too few to show")
                      : t(`${String(slice.organisations ?? 0)} organisations`)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </PageSection>
      </QSection>

      <QSection
        id="documents"
        kind="DOCUMENT_LIST"
        total={data.documents.length}
        label={t("document views")}
      >
        <PageSection id="documents" title={t("Documents")}>
          {data.documents.length === 0 ? (
            <p className={NOTE}>{below}</p>
          ) : (
            <ul className={LIST}>
              {data.documents.map((document) => (
                <li
                  key={`${document.documentId}-${document.type}`}
                  className={ROW}
                >
                  <span className={MAIN}>
                    {document.type === "DECK_OPEN"
                      ? t("Pitch deck")
                      : t("Data-room document")}
                  </span>
                  <span className={NOTE}>
                    {t(
                      `${String(document.viewers)} people · ${String(document.views)} opens`,
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </PageSection>
      </QSection>
    </>
  );
}

const ANSWER: Record<MyEngagementDto["responses"][number]["state"], string> = {
  WAITING: "waiting for an answer",
  ACCEPTED: "accepted",
  DECLINED: "declined",
};

function InvestorAnalytics({
  data,
  viewing,
  t,
}: {
  readonly data: MyEngagementDto;
  readonly viewing: InvestorViewingDto | null;
  readonly t: T;
}) {
  return (
    <>
      {viewing === null ? null : (
        <QSection
          id="who-viewed-you"
          kind="OTHER"
          total={viewing.periods.length}
          label={t("who viewed your profile")}
        >
          <InvestorViewers data={viewing} t={t} />
        </QSection>
      )}
      <QSection id="visibility" kind="VISIBILITY" label={t("your visibility")}>
        <PageSection
          id="visibility"
          title={t("Your visibility")}
          description={t(
            "Choosing to be more private is always free. Founders never see more than you allow, even for past views.",
          )}
        >
          <VisibilityChoice
            current={data.privacy.visibility}
            allowed={data.privacy.allowedVisibilities}
          />
        </PageSection>
      </QSection>

      <QSection
        id="my-activity"
        kind="COMPANY_LIST"
        refs={data.viewed.slice(0, 20).map((company) => ({
          kind: "COMPANY",
          id: company.companyId,
        }))}
        total={data.viewed.length}
        label={t("companies you viewed")}
      >
        <PageSection id="my-activity" title={t("Companies you viewed")}>
          {data.viewed.length === 0 ? (
            <p className={NOTE}>{t("Nothing yet.")}</p>
          ) : (
            <ul className={LIST}>
              {data.viewed.map((company) => (
                <li key={company.companyId} className={ROW}>
                  <span className={MAIN}>{company.companyName}</span>
                  <span className={NOTE}>
                    {t(
                      `${String(company.views)} views · ${String(company.deckMinutes)} min on the deck`,
                    )}{" "}
                    · {t(when(company.lastViewedAt))}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </PageSection>
      </QSection>

      <QSection
        id="responses"
        kind="OTHER"
        total={data.responses.length}
        label={t("founders' answers")}
      >
        <PageSection
          id="responses"
          title={t("Founders' answers")}
          description={t(
            "Your connection and data-room requests, and how each founder answered.",
          )}
        >
          {data.responses.length === 0 ? (
            <p className={NOTE}>{t("No requests yet.")}</p>
          ) : (
            <ul className={LIST}>
              {data.responses.map((response) => (
                <li
                  key={`${response.companyId}-${response.kind}-${response.askedAt}`}
                  className={ROW}
                >
                  <span className={MAIN}>
                    {response.companyName} ·{" "}
                    {response.kind === "INTEREST"
                      ? t("connection request")
                      : t("data-room request")}
                  </span>
                  <span className={NOTE}>
                    {t(ANSWER[response.state])} ·{" "}
                    {t(when(response.answeredAt ?? response.askedAt))}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </PageSection>
      </QSection>
    </>
  );
}
