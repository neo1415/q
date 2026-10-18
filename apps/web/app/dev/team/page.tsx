import type { Metadata } from "next";
import { notFound } from "next/navigation";

import type {
  InvitationPreviewDto,
  MyOrganisationDto,
  TeamDto,
} from "@capital-q/contracts";

import { AppShell } from "@/components/app-shell/app-shell";
import { PageContainer } from "@/components/app-shell/page-container";
import { JoinCard, JoinCardSkeleton } from "@/features/team/join-card";
import {
  SettingsNav,
  TeamError,
  TeamSkeleton,
} from "@/features/team/settings-nav";
import { TeamPage } from "@/features/team/team-page";

// Read per request: the preview's gate is the running server's setting.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Team (design review)",
  robots: { index: false },
};

/**
 * Settings → Team, the accept page and the switcher in the real shell with
 * fictional fixtures, for design review against
 * docs/design/2026-10-06/a/orgs.html and the screenshot checks (G1/G2).
 * Development only; a production build serves it only with
 * CQ_DEV_PREVIEW=1 (local screenshots). Nothing here reads or writes.
 *
 * `?view=team|founder|switcher|accept`, `&state=full|loading|empty|error|limited`.
 */

const IDS = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const AGO = (days: number) =>
  new Date(Date.now() - days * 86_400_000).toISOString();

type Row = readonly [
  name: string,
  email: string,
  role: "OWNER" | "ADMIN" | "MEMBER",
  title: string,
];

const FIRM: readonly Row[] = [
  ["Daniel Reyes", "daniel@northbound.vc", "OWNER", "Managing partner"],
  ["Sara Kimani", "sara@northbound.vc", "ADMIN", "Partner"],
  ["James Okoro", "james@northbound.vc", "MEMBER", "Associate"],
  ["Nina Berg", "nina@northbound.vc", "MEMBER", "Analyst"],
  ["Marcus Hale", "marcus@northbound.vc", "MEMBER", "Venture partner"],
  ["Ali Hassan", "ali@northbound.vc", "MEMBER", "Platform"],
];
const COMPANY: readonly Row[] = [
  ["Amara Okafor", "amara@korahealth.ng", "OWNER", "CEO"],
  ["Tunde Bello", "tunde@korahealth.ng", "ADMIN", "CTO"],
  ["Ifeoma Nwosu", "ifeoma@korahealth.ng", "MEMBER", "Head of clinic success"],
  ["Leila Hassan", "leila.hassan@gmail.com", "MEMBER", "Finance"],
];

function fixture(founder: boolean, state: string): TeamDto {
  const solo = state === "empty";
  const rows: readonly Row[] = solo
    ? [
        [
          founder ? "Amara Okafor" : "Ada Okafor",
          "you@example.com",
          "OWNER",
          "",
        ],
      ]
    : founder
      ? COMPANY
      : FIRM;
  const me = state === "limited" ? 2 : 0;
  const myRole = rows[me]?.[2] ?? "OWNER";
  const admin = myRole !== "MEMBER";
  return {
    organisation: {
      organisationId: IDS(1),
      name: solo
        ? founder
          ? "Kora Health"
          : "Ada Okafor (angel)"
        : founder
          ? "Kora Health"
          : "Northbound Capital",
      kind: founder ? "COMPANY" : "FIRM",
      organisationType: founder ? "company" : "investment_firm",
    },
    you: {
      membershipId: IDS(100 + me),
      role: myRole,
      can: {
        invite: admin,
        changeRoles: admin,
        removeMembers: admin,
        own: myRole === "OWNER",
      },
    },
    ownerCount: 1,
    members: rows.map(([name, email, role, title], index) => ({
      membershipId: IDS(100 + index),
      userId: IDS(200 + index),
      name,
      email,
      title: title === "" ? null : title,
      role,
      isYou: index === me,
      joinedAt: AGO(300 - index * 20),
    })),
    invitations:
      solo || !admin
        ? []
        : founder
          ? [
              {
                invitationId: IDS(301),
                email: "kwame@korahealth.ng",
                role: "MEMBER",
                state: "PENDING",
                sentAt: AGO(2),
                sentCount: 1,
                expiresAt: AGO(-5),
                invitedByName: "Amara Okafor",
              },
            ]
          : [
              {
                invitationId: IDS(301),
                email: "peter@northbound.vc",
                role: "MEMBER",
                state: "PENDING",
                sentAt: AGO(2),
                sentCount: 1,
                expiresAt: AGO(-5),
                invitedByName: "Sara Kimani",
              },
              {
                invitationId: IDS(302),
                email: "grace.ade@gmail.com",
                role: "ADMIN",
                state: "EXPIRED",
                sentAt: AGO(9),
                sentCount: 1,
                expiresAt: AGO(2),
                invitedByName: "Daniel Reyes",
              },
            ],
    joinRequests:
      solo || !admin || founder
        ? []
        : [
            {
              requestId: IDS(401),
              name: "Omar Farouk",
              email: "omar@northbound.vc",
              message: null,
              requestedAt: AGO(1),
            },
          ],
    ownershipOffers: [],
  };
}

const ORGS: readonly MyOrganisationDto[] = [
  {
    organisationId: IDS(1),
    name: "Northbound Capital",
    kind: "FIRM",
    organisationType: "investment_firm",
    role: "OWNER",
    memberCount: 6,
    active: true,
    companyId: null,
  },
  {
    organisationId: IDS(2),
    name: "Daniel Reyes (angel)",
    kind: "FIRM",
    organisationType: "syndicate",
    role: "OWNER",
    memberCount: 1,
    active: false,
    companyId: null,
  },
  {
    organisationId: IDS(3),
    name: "Lagoon Angels",
    kind: "FIRM",
    organisationType: "syndicate",
    role: "MEMBER",
    memberCount: 14,
    active: false,
    companyId: null,
  },
];

const PREVIEW: InvitationPreviewDto = {
  state: "PENDING",
  organisationName: "Northbound Capital",
  kind: "FIRM",
  role: "MEMBER",
  email: "peter@northbound.vc",
  invitedByName: "Sara Kimani",
  memberCount: 6,
  memberInitials: ["DR", "SK", "JO", "NB"],
};

export default async function TeamReviewPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (
    process.env.NODE_ENV === "production" &&
    process.env["CQ_DEV_PREVIEW"] !== "1"
  ) {
    notFound();
  }
  const params = await searchParams;
  const one = (key: string) => {
    const value = params[key];
    return Array.isArray(value) ? value[0] : value;
  };
  const view = one("view") ?? "team";
  const state = one("state") ?? "full";
  const founder = view === "founder";
  const team = fixture(founder, state);
  // One organisation hides the switcher; the switcher view has three.
  const organisations: readonly MyOrganisationDto[] =
    view === "switcher" || view === "accept" ? ORGS : [];

  const content =
    view === "accept" ? (
      state === "loading" ? (
        <JoinCardSkeleton />
      ) : (
        <JoinCard
          token="x"
          preview={
            state === "error" ? { ...PREVIEW, state: "EXPIRED" } : PREVIEW
          }
          signedInAs={
            state === "limited" ? "peter.m@gmail.com" : "peter@northbound.vc"
          }
          keeps={state === "empty" ? null : "Peter Musa (angel)"}
          alreadyIn={false}
        />
      )
    ) : (
      <PageContainer>
        <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[13rem_minmax(0,1fr)] lg:gap-10">
          <SettingsNav current="team" />
          <div className="max-w-[52rem] min-w-0">
            {state === "loading" ? (
              <TeamSkeleton />
            ) : state === "error" ? (
              <TeamError />
            ) : (
              <TeamPage initial={team} />
            )}
          </div>
        </div>
      </PageContainer>
    );

  return (
    <AppShell
      context={{
        scope: founder ? "founder_private" : "investor_private",
        label: team.organisation.name,
        organisations,
      }}
    >
      {content}
    </AppShell>
  );
}
