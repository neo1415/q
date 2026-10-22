"use client";

import Link from "next/link";

import type { TeamDto } from "@capital-q/contracts";
import { Check, ICON_SIZE, ICON_STROKE, Lock } from "@capital-q/ui/icons";

import { useT } from "@/features/i18n/language";
import { teamWords } from "@/features/team/team-words";

import { useCapabilities } from "./capabilities";
import { CAP, ROLE_SUMMARY, ROLE_WORD, roleLines } from "./role-words";

/**
 * "Your role" on Team: the person's role in plain words, what it lets them
 * do and what it keeps for others, and who the admins are. The lines come
 * from the capabilities the server says they hold (GET /v1/me/capabilities)
 * so they say exactly what the server will allow. When those could not be
 * read, the role from the team read stands alone with its summary.
 */
export function RoleCard({ team }: { readonly team: TeamDto }) {
  const t = useT();
  const capabilities = useCapabilities();
  const role = capabilities?.role ?? team.you.role;
  const kind = team.organisation.kind;
  const lines =
    capabilities === null ? null : roleLines(capabilities.capabilities, kind);
  const admins = team.members.filter(
    (member) => member.role !== "MEMBER" && !member.isYou,
  );
  const canSeeActivity =
    capabilities?.capabilities.includes(CAP.ACTIVITY_VIEW) === true;
  return (
    <section
      aria-labelledby="your-role"
      className="flex flex-col gap-3 border-t border-(--cq-border-subtle) pt-5"
      data-role-card={role}
    >
      <div className="flex flex-wrap items-baseline gap-2.5">
        <h2
          id="your-role"
          className="m-0 text-[15px] font-semibold text-(--cq-text-primary)"
        >
          {t("Your role")}
        </h2>
        <span className="text-[15px] text-(--cq-text-primary)">
          {t(ROLE_WORD[role])}
        </span>
        {canSeeActivity ? (
          <Link
            href="/settings/activity"
            className="ms-auto inline-flex min-h-11 items-center text-sm font-medium text-(--cq-text-primary) underline underline-offset-4"
            data-role-activity-link
          >
            {t("See the team's activity")}
          </Link>
        ) : null}
      </div>
      <p className="m-0 max-w-[64ch] text-sm text-(--cq-text-secondary)">
        {t(ROLE_SUMMARY[role])}
      </p>
      {lines === null ? (
        <p className="m-0 max-w-[64ch] text-sm text-(--cq-text-secondary)">
          {t(
            role === "MEMBER" ? teamWords(kind).member : teamWords(kind).admin,
          )}
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <h3 className="m-0 text-[13px] font-medium text-(--cq-text-secondary)">
              {t("You can")}
            </h3>
            <ul className="m-0 flex list-none flex-col gap-1 p-0" data-role-can>
              {lines.can.map((line) => (
                <li
                  key={line}
                  className="flex items-start gap-2 text-sm text-(--cq-text-primary)"
                >
                  <Check
                    aria-hidden="true"
                    size={ICON_SIZE.compact}
                    strokeWidth={ICON_STROKE}
                    className="mt-0.5 shrink-0 text-(--cq-text-secondary)"
                  />
                  {t(line)}
                </li>
              ))}
            </ul>
          </div>
          {lines.cannot.length === 0 ? null : (
            <div className="flex flex-col gap-1.5">
              <h3 className="m-0 text-[13px] font-medium text-(--cq-text-secondary)">
                {role === "ADMIN"
                  ? t("Kept for owners")
                  : t("Kept for admins and owners")}
              </h3>
              <ul
                className="m-0 flex list-none flex-col gap-1 p-0"
                data-role-cannot
              >
                {lines.cannot.map((line) => (
                  <li
                    key={line}
                    className="flex items-start gap-2 text-sm text-(--cq-text-secondary)"
                  >
                    <Lock
                      aria-hidden="true"
                      size={ICON_SIZE.compact}
                      strokeWidth={ICON_STROKE}
                      className="mt-0.5 shrink-0"
                    />
                    {t(line)}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
      {role === "OWNER" ? null : (
        <p className="m-0 text-sm text-(--cq-text-secondary)" data-role-admins>
          {admins.length === 0
            ? t("No one else here is an admin yet.")
            : `${t(admins.length === 1 ? "Your admin:" : "Your admins:")} `}
          {admins.map((admin, index) => (
            <span key={admin.membershipId}>
              {index === 0 ? null : ", "}
              {admin.email === null ? (
                <b className="font-medium text-(--cq-text-primary)">
                  {admin.name}
                </b>
              ) : (
                <a
                  href={`mailto:${admin.email}`}
                  className="font-medium text-(--cq-text-primary) underline underline-offset-4"
                >
                  {admin.name}
                </a>
              )}{" "}
              ({t(ROLE_WORD[admin.role])})
            </span>
          ))}
        </p>
      )}
    </section>
  );
}
