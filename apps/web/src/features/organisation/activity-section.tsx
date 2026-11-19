import "server-only";

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
import { apiSession } from "@/features/q/context";

import { ActivityPageView, type AdminRead } from "./admin-pages";
import { loadMyCapabilities } from "./load-capabilities";
import { activityQuery, type ActivityFilters } from "./role-words";

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The Activity screen with its reads, shared by Settings → Activity and
 * Organisation → Activity log: who did what for the person's active
 * organisation, newest first, for its admins and owners. The API decides
 * (organisation.activity.view) and its 403 renders the honest refusal.
 * Filters arrive in the address as input only (`?member=&kind=&from=&to=`,
 * days as yyyy-mm-dd) and are validated before they are sent.
 */
export async function ActivitySection({
  params,
  back,
}: {
  readonly params: Record<string, string | string[] | undefined>;
  readonly back?: { readonly href: string; readonly label: string } | null;
}) {
  const t = await serverT();
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
      {...(back === undefined ? {} : { back })}
    />
  );
}
