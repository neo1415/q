import type { Metadata } from "next";

import {
  ApiProblemError,
  getOrganisationActivity,
  getOrganisationMemberSummary,
  getTeam,
} from "@capital-q/api-client";
import { UuidSchema, type MemberSummaryDto } from "@capital-q/contracts";

import { serverT } from "@/features/i18n/server";
import { activityQuery } from "@/features/organisation/role-words";
import {
  MemberPageView,
  type AdminRead,
} from "@/features/organisation/admin-pages";
import { loadMyCapabilities } from "@/features/organisation/load-capabilities";
import { apiSession } from "@/features/q/context";

export const metadata: Metadata = { title: "Team member" };
export const dynamic = "force-dynamic";

/**
 * Settings → Team → a person, for admins and owners: their role and its
 * history, when they joined and were last active, the invitations they
 * sent, their last 30 days by kind, the relationships they worked on and
 * their own activity. The API decides (organisation.activity.view); a
 * person outside the organisation is its one enumeration-safe 404.
 */
export default async function TeamMemberPage({
  params,
}: {
  readonly params: Promise<{ readonly userId: string }>;
}) {
  const t = await serverT();
  const { userId } = await params;
  const session = await apiSession();
  const id = UuidSchema.safeParse(userId);
  if (session === null || !id.success) {
    return (
      <MemberPageView
        t={t}
        summary={{ status: session === null ? "ERROR" : "NOT_FOUND" }}
        activity={null}
      />
    );
  }
  const [summary, activity, team, capabilities] = await Promise.all([
    getOrganisationMemberSummary(session, id.data).then(
      (value): AdminRead<MemberSummaryDto> => ({ status: "READ", value }),
      (error: unknown): AdminRead<MemberSummaryDto> =>
        error instanceof ApiProblemError && error.status === 403
          ? { status: "DENIED", role: null }
          : error instanceof ApiProblemError && error.status === 404
            ? { status: "NOT_FOUND" }
            : { status: "ERROR" },
    ),
    getOrganisationActivity(session, activityQuery({ member: id.data })).catch(
      () => null,
    ),
    getTeam(session).catch(() => null),
    loadMyCapabilities(),
  ]);
  return (
    <MemberPageView
      t={t}
      summary={
        summary.status === "DENIED"
          ? { status: "DENIED", role: capabilities?.role ?? null }
          : summary
      }
      activity={activity}
      avatarUrl={
        team?.members.find((member) => member.userId === id.data)?.avatarUrl ??
        null
      }
    />
  );
}
