import Link from "next/link";

import type {
  ActivityPageDto,
  MemberSummaryDto,
  TeamRole,
} from "@capital-q/contracts";
import { Avatar } from "@capital-q/ui/avatar";
import { CircleAlert, ICON_SIZE, ICON_STROKE, Lock } from "@capital-q/ui/icons";

import { QSection } from "@/features/q/q-section";
import {
  AccountColumn,
  AccountHead,
  GroupHead,
} from "@/features/settings/account-layout";
import { accountButton } from "@/features/settings/account-styles";

import {
  ActivityFeed,
  ActivitySkeleton,
  type ActivityFilters,
  type ActivityPerson,
} from "./activity-feed";
import { KIND_WORD, ROLE_WORD, dayWords, whenWords } from "./role-words";

/**
 * Settings → Activity and Settings → Team → a person: the organisation's
 * own record of who did what, for its admins and owners. Server-safe
 * frames; the routes read under the person's session and /dev/org-review
 * hands in fixtures. The API is the authority (organisation.activity.view):
 * its 403 renders `OrgDenied`, never a crash and never an empty feed.
 */

type T = (english: string) => string;

export type AdminRead<V> =
  | { readonly status: "READ"; readonly value: V }
  | { readonly status: "DENIED"; readonly role: TeamRole | null }
  | { readonly status: "NOT_FOUND" }
  | { readonly status: "ERROR" };

/** The honest refusal: a member (or anyone without the capability) lands here. */
export function OrgDenied({
  t,
  role,
  back = { href: "/settings/team", label: "Team" },
}: {
  readonly t: T;
  readonly role: TeamRole | null;
  readonly back?: { readonly href: string; readonly label: string };
}) {
  return (
    <AccountColumn>
      <AccountHead
        title={t("Activity")}
        back={{ href: back.href, label: t(back.label) }}
      />
      <div
        className="flex max-w-[60ch] flex-col items-start gap-3 py-2"
        data-org-denied
      >
        <Lock
          aria-hidden="true"
          size={ICON_SIZE.prominent}
          strokeWidth={ICON_STROKE}
          className="text-(--cq-text-secondary)"
        />
        <h2 className="m-0 text-lg font-semibold text-(--cq-text-primary)">
          {t("Only admins and owners see this")}
        </h2>
        <p className="m-0 text-[15px] text-(--cq-text-secondary)">
          {role === null
            ? t(
                "This page shows what everyone on the team has done. Ask an admin if you need to know what changed.",
              )
            : t(
                `You're ${role === "MEMBER" ? "a" : "an"} ${ROLE_WORD[role]}. This page shows what everyone on the team has done; ask an admin if you need to know what changed.`,
              )}
        </p>
        <Link
          href="/settings/team"
          className={accountButton("secondary", "sm")}
        >
          {t("See your team")}
        </Link>
      </div>
    </AccountColumn>
  );
}

function ReadError({ t, what }: { readonly t: T; readonly what: string }) {
  return (
    <div className="flex flex-col items-start gap-3 py-2" data-org-error>
      <CircleAlert
        aria-hidden="true"
        size={ICON_SIZE.prominent}
        strokeWidth={ICON_STROKE}
        className="text-(--cq-text-secondary)"
      />
      <p className="m-0 text-[15px] text-(--cq-text-primary)">
        {t(`${what} couldn't load. Nothing changed; reload in a moment.`)}
      </p>
    </div>
  );
}

export function ActivityPageView({
  t,
  organisationName,
  activity,
  people,
  filters,
  review,
}: {
  readonly t: T;
  readonly organisationName: string | null;
  readonly activity:
    AdminRead<ActivityPageDto> | { readonly status: "LOADING" };
  readonly people: readonly ActivityPerson[];
  readonly filters?: ActivityFilters | undefined;
  readonly review?: { readonly loading?: boolean } | undefined;
}) {
  if (activity.status === "DENIED") {
    return <OrgDenied t={t} role={activity.role} />;
  }
  return (
    <AccountColumn>
      <QSection id="activity" kind="OTHER" label={t("your team's activity")}>
        <AccountHead
          title={t("Activity")}
          back={{ href: "/settings/team", label: t("Team") }}
          sub={
            organisationName === null
              ? t(
                  "Who did what, newest first. Q appears under the approval of the person it acted for.",
                )
              : t(
                  `Who did what for ${organisationName}, newest first. Q appears under the approval of the person it acted for.`,
                )
          }
        />
        {activity.status === "LOADING" ? (
          <ActivitySkeleton />
        ) : activity.status === "NOT_FOUND" ? (
          <ReadError t={t} what="Activity" />
        ) : (
          <ActivityFeed
            initial={activity.status === "READ" ? activity.value : null}
            people={people}
            filters={filters}
            review={review}
          />
        )}
        <p className="mt-6 max-w-[64ch] text-[13px] text-(--cq-text-tertiary)">
          {t(
            "This is the accountability record. It never shows anyone's conversations with Q, what Q remembers for them, or their reminders.",
          )}
        </p>
      </QSection>
    </AccountColumn>
  );
}

/** "Last active 5 hours ago", "Last active yesterday", "Last active 12 Oct 2026". */
function lastActive(iso: string, now: Date): string {
  const words = whenWords(iso, now);
  return words === "Just now" || words === "Yesterday"
    ? words.toLowerCase()
    : words;
}

const STATE_WORD = {
  PENDING: "Waiting",
  EXPIRED: "Expired",
  ACCEPTED: "Joined",
  REVOKED: "Cancelled",
  DECLINED: "Declined",
} as const;

export function MemberPageView({
  t,
  summary,
  activity,
  avatarUrl,
  now = new Date(),
}: {
  readonly t: T;
  readonly summary: AdminRead<MemberSummaryDto>;
  readonly activity: ActivityPageDto | null;
  readonly avatarUrl?: string | null | undefined;
  readonly now?: Date | undefined;
}) {
  if (summary.status === "DENIED") {
    return <OrgDenied t={t} role={summary.role} />;
  }
  if (summary.status !== "READ") {
    return (
      <AccountColumn>
        <AccountHead
          title={t("Team member")}
          back={{ href: "/settings/team", label: t("Team") }}
        />
        {summary.status === "NOT_FOUND" ? (
          <p
            className="m-0 text-[15px] text-(--cq-text-secondary)"
            data-org-missing
          >
            {t("That person isn't on your team.")}
          </p>
        ) : (
          <ReadError t={t} what="This person" />
        )}
      </AccountColumn>
    );
  }
  const { member, roleHistory, invitationsSent, last30Days, relationships } =
    summary.value;
  const facts = [
    member.role === null ? null : t(ROLE_WORD[member.role]),
    t(`Joined ${dayWords(member.joinedAt)}`),
    member.status === "LEFT" && member.leftAt !== null
      ? t(`Left ${dayWords(member.leftAt)}`)
      : null,
    member.status === "REMOVED" && member.leftAt !== null
      ? t(`Removed ${dayWords(member.leftAt)}`)
      : null,
    summary.value.lastActiveAt === null
      ? t("Not active yet")
      : t(`Last active ${lastActive(summary.value.lastActiveAt, now)}`),
  ].filter((part): part is string => part !== null);
  const counted = last30Days.counts.reduce(
    (sum, entry) => sum + entry.count,
    0,
  );
  return (
    <AccountColumn>
      <QSection id="member" kind="TEAM" label={t("a team member")}>
        <AccountHead
          title={member.name}
          back={{ href: "/settings/team", label: t("Team") }}
          right={
            <Avatar name={member.name} size="lg" src={avatarUrl ?? undefined} />
          }
          sub={
            <>
              <span className="block">{facts.join(" · ")}</span>
              {member.email === null ? null : (
                <span className="block text-[13px] text-(--cq-text-tertiary)">
                  {member.email}
                </span>
              )}
            </>
          }
        />

        <GroupHead
          title={t("Last 30 days")}
          note={counted === 0 ? undefined : t(`${String(counted)} actions`)}
          className="mt-2"
        />
        {last30Days.counts.length === 0 ? (
          <p className="m-0 text-sm text-(--cq-text-secondary)">
            {t("Nothing in the last 30 days.")}
          </p>
        ) : (
          <dl
            className="m-0 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4"
            data-member-counts
          >
            {last30Days.counts.map((entry) => (
              <div key={entry.kind} className="flex flex-col gap-0.5">
                <dt className="text-[13px] text-(--cq-text-secondary)">
                  {t(KIND_WORD[entry.kind])}
                </dt>
                <dd className="m-0 text-xl font-semibold tabular-nums text-(--cq-text-primary)">
                  {entry.count}
                </dd>
              </div>
            ))}
          </dl>
        )}

        <GroupHead title={t("Relationships they worked on")} />
        {relationships.length === 0 ? (
          <p className="m-0 text-sm text-(--cq-text-secondary)">
            {t("None yet.")}
          </p>
        ) : (
          <ul
            className="m-0 flex list-none flex-col p-0"
            data-member-relationships
          >
            {relationships.map((relationship) => (
              <li
                key={relationship.relationshipId}
                className="flex min-h-11 flex-wrap items-center gap-x-3 border-t border-(--cq-border-subtle) py-2.5 first:border-t-0"
              >
                {relationship.link === null ? (
                  <span className="text-[15px] font-medium text-(--cq-text-primary)">
                    {t(relationship.label)}
                  </span>
                ) : (
                  <Link
                    href={relationship.link}
                    className="inline-flex min-h-11 items-center text-[15px] font-medium text-(--cq-text-primary) underline-offset-4 hover:underline"
                  >
                    {t(relationship.label)}
                  </Link>
                )}
                <span className="ms-auto text-[13px] text-(--cq-text-secondary)">
                  {[
                    relationship.events === 0
                      ? null
                      : t(
                          relationship.events === 1
                            ? "1 update"
                            : `${String(relationship.events)} updates`,
                        ),
                    relationship.notes === 0
                      ? null
                      : t(
                          relationship.notes === 1
                            ? "1 note"
                            : `${String(relationship.notes)} notes`,
                        ),
                    t(whenWords(relationship.lastTouchedAt, now)),
                  ]
                    .filter((part) => part !== null)
                    .join(" · ")}
                </span>
              </li>
            ))}
          </ul>
        )}

        <GroupHead title={t("Role history")} />
        <ol className="m-0 flex list-none flex-col p-0" data-member-roles>
          {roleHistory.map((entry) => (
            <li
              key={`${entry.role}-${entry.from}`}
              className="flex flex-wrap items-baseline gap-x-3 border-t border-(--cq-border-subtle) py-2.5 text-sm first:border-t-0"
            >
              <b className="font-medium text-(--cq-text-primary)">
                {t(ROLE_WORD[entry.role])}
              </b>
              <span className="text-(--cq-text-secondary)">
                {entry.until === null
                  ? t(`Since ${dayWords(entry.from)}`)
                  : `${t(dayWords(entry.from))} – ${t(dayWords(entry.until))}`}
              </span>
            </li>
          ))}
        </ol>

        <GroupHead
          title={t("Invitations they sent")}
          note={
            invitationsSent.length === 0
              ? undefined
              : t(String(invitationsSent.length))
          }
        />
        {invitationsSent.length === 0 ? (
          <p className="m-0 text-sm text-(--cq-text-secondary)">
            {t("None yet.")}
          </p>
        ) : (
          <ul
            className="m-0 flex list-none flex-col p-0"
            data-member-invitations
          >
            {invitationsSent.map((invitation) => (
              <li
                key={invitation.invitationId}
                className="flex flex-wrap items-baseline gap-x-3 border-t border-(--cq-border-subtle) py-2.5 text-sm first:border-t-0"
              >
                <span className="min-w-0 truncate text-(--cq-text-primary)">
                  {invitation.email}
                </span>
                <span className="text-(--cq-text-secondary)">
                  {t(ROLE_WORD[invitation.role])}
                </span>
                <span className="ms-auto text-[13px] text-(--cq-text-secondary)">
                  {t(STATE_WORD[invitation.state])} ·{" "}
                  {t(dayWords(invitation.sentAt))}
                </span>
              </li>
            ))}
          </ul>
        )}

        <GroupHead title={t("What they did")} />
        <ActivityFeed
          initial={activity}
          people={[{ userId: member.userId, name: member.name, avatarUrl }]}
          fixedMember={member.userId}
        />
      </QSection>
    </AccountColumn>
  );
}
