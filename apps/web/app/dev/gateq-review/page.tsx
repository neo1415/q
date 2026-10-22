import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { AppShell } from "@/components/app-shell/app-shell";
import { PageContainer } from "@/components/app-shell/page-container";
import { PublicBrandStyle } from "@/features/brand-theme/public-brand-style";
import { OwnRoom } from "@/features/company/material/own-room";
import { EMPTY_ANSWERS, type FormStep } from "@/features/gateq/form/form-model";
import {
  GateQForm,
  type GateQFormPreview,
} from "@/features/gateq/form/gateq-form";
import { FounderApplications } from "@/features/gateq/page/founder-views";
import { GateqChrome, type GateqTab } from "@/features/gateq/page/gateq-chrome";
import {
  CopyLink,
  InboxView,
  type InboxDemo,
} from "@/features/gateq/page/inbox-view";
import type { PaneView } from "@/features/gateq/page/inbox-model";
import {
  FindView,
  GateEmpty,
  GateView,
} from "@/features/gateq/page/investor-views";
import { PolicyEditor } from "@/features/gateq/policy-editor";
import { serverT, serverUiLanguage } from "@/features/i18n/server";
import { qrSvg } from "@/features/q-card/qr";

import {
  APPLICATIONS,
  CONTACT,
  COVERAGE,
  DOSSIER_ITEM,
  FIND_TEXT,
  FOUND,
  FOUNDER_SHEETS,
  FUND,
  GATE_LINK,
  GATEWAY,
  INTERVIEW,
  KESTREL,
  KESTREL_ELSEWHERE,
  KESTREL_PARTIAL,
  POLICY,
  PUBLIC_ID,
  ROOM_COMPANY,
  inboxFixture,
  ownerView,
  roomPreviews,
  summary,
} from "./fixtures";

export const metadata: Metadata = {
  title: "GateQ (design review)",
  robots: { index: false },
};
export const dynamic = "force-dynamic";

/** Every page this review covers, and the states each renders. */
const PAGES = {
  "investor-inbox": [
    "all",
    "first",
    "today",
    "mine",
    "outside",
    "dossier",
    "book",
    "ask",
    "pass",
    "loading",
    "error",
    "empty",
    "member",
  ],
  "investor-gate": ["full", "no-gate"],
  "investor-find": ["full", "empty"],
  "founder-applications": [
    "list",
    "replied",
    "waiting",
    "passed",
    "empty",
    "loading",
    "error",
  ],
  "public-gate": [
    "fresh",
    "partial",
    "not-met",
    "all-met",
    "contact",
    "interview",
    "review",
    "submitted",
  ],
  "own-room": ["connected", "not-connected", "names-off", "requested"],
} as const satisfies Readonly<Record<string, readonly string[]>>;
type PageId = keyof typeof PAGES;

const BASE = "/dev/gateq-review";
const hrefOf = (page: PageId, state: string) =>
  `${BASE}?page=${page}&state=${state}`;

/**
 * GateQ's redesigned screens (gateq-2, gateqf-1, gatepub-1, ownroom-2) in
 * the real shell with fictional data, for design review and screenshots.
 * Each page renders the components its real route renders (/gateq,
 * /g/[publicId], the company profile's data room tab), with every read
 * handed in from ./fixtures. Nothing here reads or writes a service: a
 * press that reaches a server action may fail or do nothing, and the first
 * render is still complete. Development only, or a production build
 * started with CQ_REVIEW_PAGES=1 for the screenshot run.
 *
 * `?page=<id>&state=<state>`; with no page, an index of every link.
 */
export default async function GateqReviewPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (
    process.env.NODE_ENV === "production" &&
    process.env["CQ_REVIEW_PAGES"] !== "1"
  ) {
    notFound();
  }
  // The language for the server components below.
  await serverUiLanguage();
  const params = await searchParams;
  const one = (key: string) =>
    typeof params[key] === "string" ? params[key] : undefined;
  const page = (Object.keys(PAGES) as PageId[]).find(
    (entry) => entry === one("page"),
  );
  if (page === undefined) return <ReviewIndex />;
  const states: readonly string[] = PAGES[page];
  const requested = one("state");
  const state =
    requested !== undefined && states.includes(requested)
      ? requested
      : (states[0] ?? "");

  if (page === "public-gate") return <PublicGate state={state} />;

  const founder = page === "founder-applications" || page === "own-room";
  const t = await serverT();
  return (
    <>
      <PublicBrandStyle />
      <AppShell
        context={{
          scope: founder ? "founder_private" : "investor_private",
          label: founder ? "Kestrel Health (fictional)" : `${FUND} (fictional)`,
          admin: false,
        }}
      >
        <PageContainer>
          {page === "investor-inbox" ? (
            <Inbox state={state} t={t} />
          ) : page === "investor-gate" ? (
            <Gate state={state} t={t} />
          ) : page === "investor-find" ? (
            <InvestorChrome active="find" t={t}>
              <FindView
                state="full"
                initialText={state === "full" ? FIND_TEXT : ""}
                initialResults={state === "full" ? FOUND : null}
              />
            </InvestorChrome>
          ) : page === "founder-applications" ? (
            <GateqChrome
              t={t}
              role="FOUNDER"
              active="applications"
              maxWidth={860}
              hrefFor={(tab) => founderHref(tab)}
            >
              <FounderApplications
                state={
                  state === "empty" || state === "loading" || state === "error"
                    ? state
                    : "full"
                }
                applications={state === "empty" ? [] : APPLICATIONS}
                demoOpen={FOUNDER_SHEETS[state]}
              />
            </GateqChrome>
          ) : (
            <OwnRoom
              companyId={ROOM_COMPANY}
              view={ownerView(state !== "names-off")}
              demo={{
                lens:
                  state === "connected"
                    ? "CONNECTED"
                    : state === "requested"
                      ? "REQUESTED"
                      : "NOT_YET",
                previews: roomPreviews(state !== "names-off"),
              }}
            />
          )}
        </PageContainer>
      </AppShell>
    </>
  );
}

function ReviewIndex() {
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-10">
      <h1 className="cq-title-lg text-(--cq-text-primary)">
        GateQ design review
      </h1>
      <p className="cq-body-sm text-(--cq-text-secondary)">
        Fictional data only. Each link renders the real redesigned components.
      </p>
      {(Object.keys(PAGES) as PageId[]).map((page) => (
        <section key={page} className="flex flex-col gap-2">
          <h2 className="cq-title-sm text-(--cq-text-primary)">{page}</h2>
          <ul className="flex flex-wrap gap-x-4 gap-y-2">
            {PAGES[page].map((state) => (
              <li key={state}>
                <Link
                  href={hrefOf(page, state)}
                  className="cq-body-sm text-(--cq-text-primary) underline underline-offset-4"
                >
                  {state}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </main>
  );
}

const investorHref = (tab: GateqTab) =>
  tab === "find"
    ? hrefOf("investor-find", "full")
    : tab === "gate"
      ? hrefOf("investor-gate", "full")
      : hrefOf("investor-inbox", "all");
const founderHref = (tab: GateqTab) =>
  tab === "applications" ? hrefOf("founder-applications", "list") : BASE;

function InvestorChrome({
  active,
  t,
  unread,
  children,
}: {
  readonly active: GateqTab;
  readonly t: (english: string) => string;
  readonly unread?: number | undefined;
  readonly children: ReactNode;
}) {
  return (
    <GateqChrome
      t={t}
      role="INVESTOR"
      active={active}
      action={<CopyLink text={GATE_LINK} />}
      maxWidth={active === "inbox" ? undefined : 900}
      unread={unread}
      hrefFor={investorHref}
    >
      {children}
    </GateqChrome>
  );
}

const PANES: Readonly<Record<string, PaneView>> = {
  all: "ALL",
  first: "FIRST",
  today: "TODAY",
  mine: "MINE",
  outside: "OUTSIDE",
};
const SHEETS: Readonly<Record<string, NonNullable<InboxDemo["sheet"]>>> = {
  book: "book",
  ask: "ask",
  pass: "pass",
};

function Inbox({
  state,
  t,
}: {
  readonly state: string;
  readonly t: (english: string) => string;
}) {
  const now = reviewClock();
  const fixture = inboxFixture(now, {
    member: state === "member",
    empty: state === "empty",
  });
  const sheet = SHEETS[state];
  const onDossier = state === "dossier" || sheet !== undefined;
  return (
    <InvestorChrome active="inbox" t={t} unread={fixture.inbox.counts.INBOX}>
      <InboxView
        inbox={state === "error" ? null : fixture.inbox}
        state={
          state === "loading" || state === "error" || state === "empty"
            ? state
            : "full"
        }
        initialDetail={null}
        initialPane={PANES[state]}
        gateLink={GATE_LINK}
        fund={FUND}
        viewBase={`${hrefOf("investor-inbox", "all")}&view=`}
        demo={{
          details: fixture.details,
          ...(onDossier ? { selected: DOSSIER_ITEM } : {}),
          ...(sheet === undefined ? {} : { sheet }),
        }}
      />
    </InvestorChrome>
  );
}

function Gate({
  state,
  t,
}: {
  readonly state: string;
  readonly t: (english: string) => string;
}) {
  if (state === "no-gate") {
    return (
      <GateqChrome t={t} role="INVESTOR" active="gate" hrefFor={investorHref}>
        <GateEmpty />
      </GateqChrome>
    );
  }
  const link = `https://capitalq.app/g/${PUBLIC_ID}`;
  return (
    <InvestorChrome active="gate" t={t} unread={3}>
      <GateView
        state="full"
        gatewayId={POLICY.gateway.id}
        policy={POLICY}
        link={link}
        snippet={`<script src="https://capitalq.app/gateq.js" data-gate="${PUBLIC_ID}" async></script>`}
        qr={qrSvg(link)}
        replyWithinDays={10}
        canDecide
        editor={<PolicyEditor hasRules />}
      />
    </InvestorChrome>
  );
}

/** What the public gate's form is handed for each state. */
function formPreview(state: string): GateQFormPreview {
  const step: FormStep =
    state === "contact" || state === "interview" || state === "review"
      ? state
      : state === "submitted"
        ? "sent"
        : "company";
  switch (state) {
    case "fresh":
      return { step, answers: EMPTY_ANSWERS, application: null };
    case "partial":
      return {
        step,
        answers: KESTREL_PARTIAL,
        application: summary({
          access: "NEEDS_INFORMATION",
          stillNeeded: ["Southern Europe", "€500k to €3M"],
        }),
      };
    case "not-met":
      return {
        step,
        answers: KESTREL_ELSEWHERE,
        application: summary({
          access: "MAY_NOT_APPLY",
          unmet: ["Southern Europe"],
        }),
      };
    default:
      return {
        step,
        answers: KESTREL,
        application: summary({
          access: "MAY_APPLY",
          status: state === "submitted" ? "SUBMITTED" : "READY_TO_SUBMIT",
          submittedAt:
            state === "submitted" ? "2026-10-21T09:00:00.000Z" : null,
        }),
        contact: state === "contact" ? null : CONTACT,
        transcript: INTERVIEW,
        coverage: COVERAGE,
      };
  }
}

/** The public gate (/g/[publicId]): the route's own frame, signed out. */
async function PublicGate({ state }: { readonly state: string }) {
  const t = await serverT();
  return (
    <>
      <PublicBrandStyle />
      <div className="min-h-dvh bg-(--cq-canvas)">
        <header className="sticky top-0 z-(--cq-z-sticky) flex h-14 items-center gap-3 border-b border-(--cq-border-subtle) bg-(--cq-canvas) px-4 sm:h-16 sm:px-8">
          <span className="text-lg font-semibold tracking-tight text-(--cq-text-primary)">
            Capital Q
          </span>
        </header>
        <main className="mx-auto flex w-full max-w-[1120px] flex-col gap-6 px-4 pt-5 pb-16 sm:px-10 sm:pt-8">
          <GateQForm gateway={GATEWAY} preview={formPreview(state)} />
          <p className="cq-caption text-(--cq-text-tertiary)">
            {t("Powered by Capital Q")}
          </p>
        </main>
      </div>
    </>
  );
}

/** The review page's clock, read once per request (fixtures are relative to it). */
function reviewClock(): number {
  return Date.now();
}
