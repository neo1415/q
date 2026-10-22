import type { Metadata } from "next";

import {
  ApiProblemError,
  getOrganisationActivity,
  getTeam,
} from "@capital-q/api-client";
import {
  ACTIVITY_KINDS,
  UuidSchema,
  type ActivityPageDto,
} from "@capital-q/contracts";

import { serverT } from "@/features/i18n/server";
import {
  activityQuery,
  type ActivityFilters,
} from "@/features/organisation/role-words";
import {
  ActivityPageView,
  type AdminRead,
} from "@/features/organisation/admin-pages";
import { loadMyCapabilities } from "@/features/organisation/load-capabilities";
import { apiSession } from "@/features/q/context";

export const metadata: Metadata = { title: "Activity" };
export const dynamic = "force-dynamic";

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Settings → Activity: who did what for the person's active organisation,
 * newest first, for its admins and owners. The API decides
 * (organisation.activity.view) and its 403 renders the honest refusal.
 * Filters arrive in the address as input only (`?member=&kind=&from=&to=`,
 * days as yyyy-mm-dd) and are validated before they are sent.
 */
export default async function ActivityPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const t = await serverT();
  const params = await searchParams;
  const one = (key: string) =>
    typeof params[key] === "string" ? params[key] : undefined;
  const member = UuidSchema.safeParse(one("member"));
  const kind = ACTIVITY_KINDS.find((candidate) => candidate === one("kind"));
  const from = one("from");
  const to = one("to");
  const filters: ActivityFilters = {
    ...(member.success ? { member: member.data } : {}),
    ...(kind === undefined ? {} : { kind }),
    ...(from !== undefined && DAY.test(from) ? { fromDay: from } : {}),
    ...(to !== undefined && DAY.test(to) ? { toDay: to } : {}),
  };
  const session = await apiSession();
  const [activity, team, capabilities] = await Promise.all([
    session === null
      ? Promise.resolve({ status: "ERROR" } as const)
      : getOrganisationActivity(session, activityQuery(filters)).then(
          (value) => ({ status: "READ" as const, value }),
          (error: unknown) =>
            error instanceof ApiProblemError && error.status === 403
              ? ({ status: "DENIED", role: null } as const)
              : ({ status: "ERROR" } as const),
        ),
    session === null
      ? Promise.resolve(null)
      : getTeam(session).catch(() => null),
    loadMyCapabilities(),
  ]);
  const read: AdminRead<ActivityPageDto> =
    activity.status === "DENIED"
      ? { status: "DENIED", role: capabilities?.role ?? null }
      : activity;
  return (
    <ActivityPageView
      t={t}
      organisationName={team?.organisation.name ?? null}
      activity={read}
      people={(team?.members ?? []).map((person) => ({
        userId: person.userId,
        name: person.name,
        avatarUrl: person.avatarUrl ?? null,
      }))}
      filters={filters}
    />
  );
}
