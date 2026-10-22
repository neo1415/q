import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import type { TeamRole } from "@capital-q/contracts";

import { AppShell } from "@/components/app-shell/app-shell";
import { PublicBrandStyle } from "@/features/brand-theme/public-brand-style";
import { PolicyEditor } from "@/features/gateq/policy-editor";
import { serverT, serverUiLanguage } from "@/features/i18n/server";
import {
  ActivityPageView,
  MemberPageView,
  OrgDenied,
} from "@/features/organisation/admin-pages";
import { CapabilitiesProvider } from "@/features/organisation/capabilities";
import { RoleCard } from "@/features/organisation/role-card";
import { CAP } from "@/features/organisation/role-words";
import { EditableSection } from "@/features/profile/editable-section";
import { INVESTOR_FIELDS } from "@/features/profile/profile-fields";
import { AccountColumn, AccountHead } from "@/features/settings/account-layout";
import { TeamSettingsView } from "@/features/team/team-settings-view";

import { HARBOURLINE } from "../account-review/fixtures";
import {
  PEOPLE,
  activityPage,
  capabilitiesAs,
  memberActivity,
  memberSummary,
  teamAs,
} from "./fixtures";

export const metadata: Metadata = {
  title: "Organisation roles (design review)",
  robots: { index: false },
};
export const dynamic = "force-dynamic";

const ROLES = ["owner", "admin", "member"] as const;

const PAGES = [
  { id: "team", title: "Team, by role", states: ROLES },
  {
    id: "activity",
    title: "Activity (admins and owners)",
    states: ["full", "filtered", "empty", "error", "loading"],
  },
  { id: "member", title: "A member's page", states: ["full", "not-found"] },
  { id: "denied", title: "A member opens Activity", states: ["member"] },
  { id: "role", title: "Your role card", states: ROLES },
  {
    id: "gated",
    title: "Admin-only controls, as each role sees them",
    states: ROLES,
  },
] as const;

const ROLE_OF: Readonly<Record<string, TeamRole>> = {
  owner: "OWNER",
  admin: "ADMIN",
  member: "MEMBER",
};

/**
 * Organisation roles' screens (owner, admin, member) in the real shell
 * with fictional data, for design review and screenshots: Team for each
 * role, Activity in every state, a member's page, the refusal a member
 * sees, the role card, and admin-only controls as a member sees them.
 * Each renders the same component its real route renders, under the
 * capabilities the role holds. Nothing here reads or writes a service: a
 * press that reaches a server action may fail, and the first render is
 * still complete. Development only, or a production build started with
 * CQ_REVIEW_PAGES=1 for the screenshot run.
 *
 * `?page=<id>&state=<state>`; no `page` lists every link.
 */
export default async function OrgReviewPage({
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
  // Activity and a member's page are an admin's; a refusal is a member's.
  const role: TeamRole =
    ROLE_OF[state] ??
    (entry.id === "activity" || entry.id === "member" ? "ADMIN" : "MEMBER");
  const now = Date.now();
  const t = await serverT();
  return (
    <>
      <PublicBrandStyle />
      <CapabilitiesProvider value={capabilitiesAs(role)}>
        <AppShell
          context={{
            scope: "investor_private",
            label: `${HARBOURLINE.name} (fictional)`,
            admin: false,
          }}
        >
          <ReviewPage id={entry.id} state={state} role={role} now={now} t={t} />
        </AppShell>
      </CapabilitiesProvider>
    </>
  );
}

function ReviewPage({
  id,
  state,
  role,
  now,
  t,
}: {
  readonly id: (typeof PAGES)[number]["id"];
  readonly state: string;
  readonly role: TeamRole;
  readonly now: number;
  readonly t: (english: string) => string;
}) {
  const team = teamAs(role, now);
  const people = team.members.map((member) => ({
    userId: member.userId,
    name: member.name,
    avatarUrl: member.avatarUrl ?? null,
  }));
  switch (id) {
    case "team":
      return (
        <TeamSettingsView t={t} team={team} claims={[]} claimsFor={null} />
      );
    case "activity":
      return (
        <ActivityPageView
          t={t}
          organisationName={`${HARBOURLINE.name} (fictional)`}
          activity={
            state === "error"
              ? { status: "ERROR" }
              : state === "loading"
                ? { status: "READ", value: activityPage(now, "full") }
                : {
                    status: "READ",
                    value: activityPage(
                      now,
                      state === "filtered"
                        ? "filtered"
                        : state === "empty"
                          ? "empty"
                          : "full",
                    ),
                  }
          }
          people={people}
          filters={
            state === "filtered"
              ? { member: PEOPLE.mira.userId, kind: "TEAM" }
              : undefined
          }
          review={state === "loading" ? { loading: true } : undefined}
        />
      );
    case "member":
      return (
        <MemberPageView
          t={t}
          summary={
            state === "not-found"
              ? { status: "NOT_FOUND" }
              : { status: "READ", value: memberSummary(now) }
          }
          activity={memberActivity(now)}
          now={new Date(now)}
        />
      );
    case "denied":
      return <OrgDenied t={t} role="MEMBER" />;
    case "role":
      return (
        <AccountColumn>
          <AccountHead title={t("Your role")} />
          <RoleCard team={team} />
        </AccountColumn>
      );
    case "gated":
      return (
        <AccountColumn>
          <AccountHead
            title={t("Admin-only controls")}
            sub={`Shown as a ${role.toLowerCase()} sees them. Fictional data.`}
          />
          <div className="flex flex-col gap-6">
            <EditableSection
              id="firm"
              variant="brief"
              title={t("Your firm")}
              capability={CAP.INVESTOR_EDIT}
              profile={{
                kind: "INVESTOR_ORGANISATION",
                subjectId: HARBOURLINE.id,
                fields: INVESTOR_FIELDS.filter(
                  (spec) =>
                    spec.field === "displayName" ||
                    spec.field === "websiteUrl",
                ),
                values: {
                  displayName: `${HARBOURLINE.name} (fictional)`,
                  websiteUrl: "https://harbourline.example",
                },
                version: 1,
                provenance: "Your statement · self-reported",
              }}
            />
            <section className="flex flex-col gap-3">
              <h2 className="m-0 text-base font-semibold text-(--cq-text-primary)">
                {t("Your gate")}
              </h2>
              <PolicyEditor
                hasRules
                preview={{
                  text: "Seed to Series A, climate and logistics, Europe and East Africa.",
                  extraction: {
                    proposals: [],
                    notFound: [],
                    excludedPlaces: [],
                  },
                }}
              />
            </section>
          </div>
        </AccountColumn>
      );
  }
}

function ReviewIndex() {
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-10 text-(--cq-text-primary)">
      <h1 className="m-0 text-2xl font-semibold">
        Organisation roles, design review
      </h1>
      <p className="m-0 text-sm text-(--cq-text-secondary)">
        Fictional data only. Each link renders the real page in one state,
        under the capabilities that role holds.
      </p>
      {PAGES.map((entry) => (
        <section key={entry.id} className="flex flex-col gap-2">
          <h2 className="m-0 text-base font-semibold">{entry.title}</h2>
          <ul className="m-0 flex list-none flex-wrap gap-x-4 gap-y-1 p-0 text-sm">
            {entry.states.map((state) => (
              <li key={state}>
                <Link
                  href={`/dev/org-review?page=${entry.id}&state=${state}`}
                  className="inline-flex min-h-11 items-center underline underline-offset-4"
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
