import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { AppShell } from "@/components/app-shell/app-shell";
import { PublicBrandStyle } from "@/features/brand-theme/public-brand-style";
import { PlanView } from "@/features/billing/plan-view";
import { UsageView } from "@/features/billing/usage-view";
import { serverT, serverUiLanguage } from "@/features/i18n/server";
import { OwnProfileView } from "@/features/profile/own-profile-view";
import { QSection } from "@/features/q/q-section";
import { ReviewsView } from "@/features/reviews/reviews-view";
import { MemoryView } from "@/features/settings/memory-view";
import { SettingsView } from "@/features/settings/settings-view";
import { JoinCard } from "@/features/team/join-card";
import { TeamSettingsView } from "@/features/team/team-settings-view";
import { VerificationView } from "@/features/verification/verification-view";
import { WorkspaceChoice } from "@/features/welcome/workspace-choice";

import {
  CATALOGUE,
  HARBOURLINE,
  INVITE,
  JOIN_TOKEN,
  KESTREL,
  KYB_TYPED,
  LEARNING,
  MEMORY_CORRECTING,
  MEMORY_FORGOTTEN,
  REVIEW_REASON,
  TEAM_ROLE_FOR,
  answers,
  claims,
  company,
  daily,
  findings,
  founderBackground,
  investor,
  kyb,
  memory,
  orgImages,
  person,
  personFindings,
  personImages,
  plan,
  qCard,
  reviews,
  speaking,
  team,
  thesis,
  usage,
  work,
  workspaceOf,
  workspaces,
  type Side,
} from "./fixtures";

export const metadata: Metadata = {
  title: "Account pages (design review)",
  robots: { index: false },
};
export const dynamic = "force-dynamic";

/**
 * Every page and state. `sided`: the page differs for a founder and an
 * investor, so each state is listed for both (`&side=founder|investor`).
 */
const PAGES = [
  {
    id: "profile",
    title: "Your profile",
    sided: true,
    states: [
      "full",
      "photo-sheet",
      "logo-sheet",
      "cover-sheet",
      "mandate-editing",
      "found-loading",
      "found-nothing",
      "not-set-up",
      "unavailable",
    ],
  },
  {
    id: "settings",
    title: "Settings",
    sided: true,
    states: ["full", "photo-sheet", "solo", "unavailable"],
  },
  {
    id: "memory",
    title: "What Q remembers",
    sided: false,
    states: ["full", "forgotten", "correcting", "empty", "unavailable"],
  },
  {
    id: "plan",
    title: "Plan and billing",
    sided: true,
    states: [
      "launch",
      "paid",
      "checkout-done",
      "billing-sheet",
      "talk-sheet",
      "no-catalogue",
      "error",
    ],
  },
  {
    id: "usage",
    title: "Usage",
    sided: false,
    states: ["this-month", "last-month", "quiet", "error"],
  },
  {
    id: "team",
    title: "Team settings",
    sided: true,
    states: [
      "full",
      "role-sheet",
      "solo",
      "member",
      "claims",
      "empty-claims",
      "error",
    ],
  },
  {
    id: "verification",
    title: "Verification",
    sided: true,
    states: [
      "step-who",
      "step-company",
      "step-send",
      "done-skipped",
      "sent",
      "verified",
      "optional",
      "declined",
      "from-setup",
      "unavailable",
      "no-company",
    ],
  },
  {
    id: "join",
    title: "Join an organisation",
    sided: false,
    states: [
      "pending",
      "pending-switch",
      "wrong-email",
      "joined",
      "declined",
      "expired",
      "cancelled",
      "used",
      "already-in",
      "invalid",
    ],
  },
  {
    id: "welcome",
    title: "Welcome, choose a workspace",
    sided: false,
    states: ["three", "two"],
  },
  {
    id: "reviews",
    title: "Reviews",
    sided: false,
    states: [
      "empty",
      "typed",
      "sending",
      "sent",
      "error",
      "earlier",
      "earlier-unavailable",
    ],
  },
] as const;

type PageId = (typeof PAGES)[number]["id"];

/**
 * The account pages' chosen designs (2026-10-21) in the real shell with
 * fictional data, for design review and screenshots: Your profile,
 * Settings, What Q remembers, Plan and billing, Usage, Team, Verification,
 * Join, Welcome and Reviews. Each state renders the same view component
 * its real route renders, with every read handed in from ./fixtures, and
 * a sheet or form open where the state says so. Nothing here reads or
 * writes a service: a press that reaches a server action may fail, and
 * the first render is still complete. Development only, or a production
 * build started with CQ_REVIEW_PAGES=1 for the screenshot run.
 *
 * `?page=<id>&state=<state>&side=founder|investor`; no `page` lists every
 * link.
 */
export default async function AccountReviewPage({
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
  await serverUiLanguage();
  const params = await searchParams;
  const one = (key: string) =>
    typeof params[key] === "string" ? params[key] : undefined;
  const entry = PAGES.find((candidate) => candidate.id === one("page"));
  if (entry === undefined) return <ReviewIndex />;
  const states: readonly string[] = entry.states;
  const state = states.find((s) => s === one("state")) ?? entry.states[0];
  const side: Side = one("side") === "founder" ? "founder" : "investor";
  const sideOf: Side = entry.sided ? side : "investor";
  const now = reviewClock();

  if (entry.id === "welcome") {
    return (
      <>
        <PublicBrandStyle />
        <WorkspaceChoice
          name={HARBOURLINE.partner}
          workspaces={workspaces(state === "two" ? 2 : 3)}
        />
      </>
    );
  }
  const founder = sideOf === "founder";
  return (
    <>
      <PublicBrandStyle />
      <AppShell
        context={{
          scope: founder ? "founder_private" : "investor_private",
          label: founder
            ? `${KESTREL.name} (fictional)`
            : `${HARBOURLINE.name} (fictional)`,
          admin: false,
        }}
      >
        <ReviewPage id={entry.id} state={state} side={sideOf} now={now} />
      </AppShell>
    </>
  );
}

async function ReviewPage({
  id,
  state,
  side,
  now,
}: {
  readonly id: Exclude<PageId, "welcome">;
  readonly state: string;
  readonly side: Side;
  readonly now: number;
}) {
  const t = await serverT();
  const founder = side === "founder";
  switch (id) {
    case "profile":
      return <Profile state={state} side={side} now={now} t={t} />;
    case "settings": {
      const unavailable = state === "unavailable";
      const who = person(side, now);
      return (
        <SettingsView
          t={t}
          email={founder ? KESTREL.email : HARBOURLINE.email}
          person={unavailable ? null : who}
          avatar={
            unavailable ? null : (personImages(side, now).avatar?.url ?? null)
          }
          personality="CALM"
          language="AUTO"
          languageName={null}
          daily={unavailable ? null : daily(now)}
          plan={unavailable ? null : plan(side, "LAUNCH_DEFAULT", now)}
          canBrand={false}
          speaking={unavailable ? null : speaking(now)}
          acting={workspaceOf(side, state === "solo")}
          learning={unavailable ? null : LEARNING}
          review={{ photoSheet: state === "photo-sheet" }}
        />
      );
    }
    case "memory":
      return (
        <MemoryView
          t={t}
          items={
            state === "unavailable"
              ? null
              : state === "empty"
                ? []
                : memory(now)
          }
          learning={state === "unavailable" ? null : LEARNING}
          review={
            state === "forgotten"
              ? { forgotten: MEMORY_FORGOTTEN }
              : state === "correcting"
                ? { correcting: MEMORY_CORRECTING }
                : undefined
          }
        />
      );
    case "plan":
      return (
        <PlanView
          t={t}
          plan={
            state === "error"
              ? null
              : plan(
                  side,
                  state === "launch" ? "LAUNCH_DEFAULT" : "STRIPE",
                  now,
                )
          }
          catalogue={state === "no-catalogue" ? null : CATALOGUE}
          side={founder ? "FOUNDER" : "INVESTOR"}
          accountName={founder ? KESTREL.name : HARBOURLINE.name}
          checkoutDone={state === "checkout-done"}
          reviewSheet={
            state === "billing-sheet"
              ? "billing"
              : state === "talk-sheet"
                ? "talk"
                : undefined
          }
        />
      );
    case "usage": {
      const period = state === "last-month" ? "previous" : "current";
      const quiet = state === "quiet";
      return (
        <UsageView
          t={t}
          usage={state === "error" ? null : usage(period, quiet, now)}
          work={work(quiet, now)}
          period={period}
        />
      );
    }
    case "team":
      return (
        <TeamSettingsView
          t={t}
          team={
            state === "error"
              ? null
              : team(
                  side,
                  state === "solo"
                    ? "solo"
                    : state === "member"
                      ? "member"
                      : "full",
                  now,
                )
          }
          claims={founder && state === "claims" ? claims(now) : []}
          claimsFor={
            founder && (state === "claims" || state === "empty-claims")
              ? KESTREL.name
              : null
          }
          reviewRoleFor={state === "role-sheet" ? TEAM_ROLE_FOR : undefined}
        />
      );
    case "verification":
      return <Verification state={state} side={side} now={now} t={t} />;
    case "join":
      return <Join state={state} now={now} />;
    case "reviews":
      return (
        <ReviewsView
          t={t}
          subject="READINESS_ASSESSMENT"
          subjectRef={null}
          reviews={
            state === "earlier"
              ? reviews(now)
              : state === "earlier-unavailable"
                ? null
                : []
          }
          review={
            state === "typed"
              ? { reason: REVIEW_REASON, phase: "idle" }
              : state === "sending"
                ? { reason: REVIEW_REASON, phase: "pending" }
                : state === "sent"
                  ? { reason: REVIEW_REASON, phase: "done" }
                  : state === "error"
                    ? {
                        reason: REVIEW_REASON,
                        phase: "idle",
                        error:
                          "That wasn't sent. Nothing was recorded; try again in a moment.",
                      }
                    : undefined
          }
        />
      );
  }
}

function Profile({
  state,
  side,
  now,
  t,
}: {
  readonly state: string;
  readonly side: Side;
  readonly now: number;
  readonly t: (english: string) => string;
}) {
  const founder = side === "founder";
  const unavailable = state === "unavailable";
  const notSetUp = state === "not-set-up";
  const organisation = !unavailable && !notSetUp;
  const orgFindings =
    state === "found-loading"
      ? ({ status: "LOADING" } as const)
      : state === "found-nothing"
        ? ({ status: "READ", findings: [] } as const)
        : ({ status: "READ", findings: findings(side, now) } as const);
  const personState =
    state === "found-loading"
      ? ({ status: "LOADING" } as const)
      : state === "found-nothing" || !founder
        ? ({ status: "READ", findings: [] } as const)
        : ({ status: "READ", findings: personFindings(now) } as const);
  return (
    <OwnProfileView
      t={t}
      email={founder ? KESTREL.email : HARBOURLINE.email}
      context={
        notSetUp
          ? { kind: "NONE" }
          : founder
            ? { kind: "FOUNDER", companyId: KESTREL.id, label: KESTREL.name }
            : {
                kind: "INVESTOR",
                investorOrganisationId: HARBOURLINE.id,
                label: HARBOURLINE.name,
              }
      }
      data={{
        person: unavailable ? null : person(side, now),
        company: organisation && founder ? company(now) : null,
        investor: organisation && !founder ? investor(now) : null,
        verification: { status: "NONE" },
      }}
      kyb={organisation ? kyb(side, founder ? "sent" : "none", now) : null}
      personImages={unavailable ? null : personImages(side, now)}
      orgImages={organisation ? orgImages(side, now) : null}
      answers={organisation ? answers(side) : null}
      requestKey="00000000-0000-4000-8000-0000000000aa"
      qPitch={false}
      given={{
        findings: {
          COMPANY: orgFindings,
          INVESTOR_ORGANISATION: orgFindings,
          PERSON: personState,
        },
        thesis: thesis(now),
        founderBackground: founderBackground(),
        team: team(side, "full", now),
        qCard: { card: qCard(side, now) },
      }}
      review={{
        sheet:
          state === "photo-sheet"
            ? "photo"
            : state === "logo-sheet"
              ? "logo"
              : state === "cover-sheet"
                ? "cover"
                : undefined,
        editing:
          state === "mandate-editing"
            ? founder
              ? "traction"
              : "mandate"
            : undefined,
      }}
    />
  );
}

function Verification({
  state,
  side,
  now,
  t,
}: {
  readonly state: string;
  readonly side: Side;
  readonly now: number;
  readonly t: (english: string) => string;
}) {
  const standing =
    state === "done-skipped"
      ? "org-verified"
      : state === "sent" ||
          state === "verified" ||
          state === "optional" ||
          state === "declined"
        ? state
        : "none";
  const flow = state !== "unavailable" && state !== "no-company";
  const step = state === "step-company" ? 1 : state === "step-send" ? 2 : 0;
  return (
    <VerificationView
      t={t}
      side={
        state === "no-company"
          ? "NONE"
          : side === "founder"
            ? "FOUNDER"
            : "INVESTOR"
      }
      unavailable={false}
      kyb={flow ? kyb(side, standing, now) : null}
      loaded={
        state === "unavailable" ? { ok: false, notice: "unavailable" } : null
      }
      notice={null}
      fromSetup={state === "from-setup"}
      skipTo="/home"
      review={
        step === 0
          ? undefined
          : {
              step,
              person: KYB_TYPED.person,
              organisation: KYB_TYPED.organisation,
            }
      }
    />
  );
}

function Join({
  state,
  now,
}: {
  readonly state: string;
  readonly now: number;
}) {
  const preview =
    state === "invalid"
      ? null
      : {
          ...INVITE,
          state:
            state === "declined"
              ? ("DECLINED" as const)
              : state === "expired"
                ? ("EXPIRED" as const)
                : state === "cancelled"
                  ? ("REVOKED" as const)
                  : state === "used" || state === "already-in"
                    ? ("ACCEPTED" as const)
                    : ("PENDING" as const),
        };
  return (
    <QSection
      id="invitation"
      kind="OTHER"
      total={0}
      label="an invitation to join"
    >
      <JoinCard
        token={state === "invalid" ? "" : JOIN_TOKEN}
        preview={preview}
        signedInAs={
          state === "wrong-email"
            ? "oliver.personal@mail.example"
            : INVITE.email
        }
        invitation={
          preview?.state === "PENDING"
            ? {
                invitationId: "80000000-0000-4000-8000-000000000001",
                expiresAt: new Date(now + 5 * 86_400_000).toISOString(),
              }
            : null
        }
        keeps={state === "pending-switch" ? KESTREL.name : null}
        alreadyIn={state === "already-in"}
        reviewPhase={state === "joined" ? "joined" : "idle"}
      />
    </QSection>
  );
}

/** The fixtures' dates are relative to now, so expiries read as in a few days. */
function reviewClock(): number {
  return Date.now();
}

function ReviewIndex() {
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-10 text-(--cq-text-primary)">
      <h1 className="m-0 text-2xl font-semibold">
        Account pages, design review
      </h1>
      <p className="m-0 text-sm text-(--cq-text-secondary)">
        Fictional data only. Each link renders the real page in one state.
      </p>
      {PAGES.map((entry) => (
        <section key={entry.id} className="flex flex-col gap-2">
          <h2 className="m-0 text-base font-semibold">{entry.title}</h2>
          <ul className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 text-sm">
            {(entry.sided
              ? (["founder", "investor"] as const)
              : ([null] as const)
            ).flatMap((side) =>
              entry.states.map((state) => {
                const href = `/dev/account-review?page=${entry.id}&state=${state}${side === null ? "" : `&side=${side}`}`;
                return (
                  <li key={`${side ?? ""}-${state}`}>
                    <Link href={href} className="underline underline-offset-4">
                      {side === null ? state : `${side}: ${state}`}
                    </Link>
                  </li>
                );
              }),
            )}
          </ul>
        </section>
      ))}
    </main>
  );
}
