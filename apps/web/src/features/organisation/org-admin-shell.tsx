"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";

import type { MyOrganisationDto, TeamRole } from "@capital-q/contracts";
import { cx } from "@capital-q/ui";
import { Lock, ICON_SIZE, ICON_STROKE } from "@capital-q/ui/icons";
import { fieldControlClassName } from "@capital-q/ui/input";

import { useT } from "@/features/i18n/language";
import { ScopeOrganisationSwitch } from "@/features/team/org-switcher";

import {
  currentOrgSection,
  ORG_SECTION_GROUPS,
  ORG_SECTIONS,
  scopeParts,
} from "./org-admin-sections";

/**
 * The organisation admin's frame (admin design 2026-11-19 §3.2): the light
 * scope bar saying whose organisation this is and the person's role in it,
 * then the section index beside the page (a selector on a phone).
 */
export function OrgScopeBar({
  name,
  role,
  organisations,
}: {
  readonly name: string;
  readonly role: TeamRole;
  readonly organisations: readonly MyOrganisationDto[];
}) {
  const t = useT();
  const [organisation, yours, scope] = scopeParts(name, role);
  return (
    <div
      className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-(--cq-radius-md) bg-(--cq-surface-strong) px-4 py-2 cq-body-sm text-(--cq-text-secondary)"
      data-org-scope-bar
    >
      <span className="font-medium text-(--cq-text-primary)">
        {organisation}
      </span>
      <span aria-hidden="true">·</span>
      <span>{t(yours ?? "")}</span>
      <span aria-hidden="true" className="hidden sm:inline">
        ·
      </span>
      <span className="hidden sm:inline">{t(scope ?? "")}</span>
      <span className="ms-auto">
        <ScopeOrganisationSwitch organisations={organisations} />
      </span>
    </div>
  );
}

/** The scope bar above, the section index beside the page (§3.2). */
export function OrgAdminFrame({
  name,
  role,
  organisations,
  children,
  section,
}: {
  readonly name: string;
  readonly role: TeamRole;
  readonly organisations: readonly MyOrganisationDto[];
  readonly children: ReactNode;
  /** Design review only: the section a fixture page stands in for. */
  readonly section?: string | undefined;
}) {
  return (
    <div
      className="mx-auto flex w-full max-w-[1280px] flex-col gap-4 px-4 pt-4 sm:px-6 lg:px-8"
      data-org-admin
    >
      <OrgScopeBar name={name} role={role} organisations={organisations} />
      <div className="grid grid-cols-[minmax(0,1fr)] gap-2 lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-6">
        <div className="lg:sticky lg:top-4 lg:self-start lg:pt-8">
          <OrgSectionNav section={section} />
        </div>
        <div className="min-w-0">{children}</div>
      </div>
    </div>
  );
}

export function OrgSectionNav({
  section,
}: {
  /** Design review only: the section a fixture page stands in for. */
  readonly section?: string | undefined;
} = {}) {
  const t = useT();
  const pathname = usePathname();
  const router = useRouter();
  const current = currentOrgSection(section ?? pathname);
  return (
    <>
      <nav
        aria-label={t("Organisation sections")}
        className="hidden lg:block"
        data-org-section-nav
      >
        <div className="flex flex-col gap-4">
          {ORG_SECTION_GROUPS.map((group) => (
            <div key={group} role="group" aria-label={t(group)}>
              <span className="block px-3 pb-1 text-xs text-(--cq-text-tertiary)">
                {t(group)}
              </span>
              <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
                {ORG_SECTIONS.filter((section) => section.group === group).map(
                  (section) => {
                    const active = section.href === current?.href;
                    return (
                      <li key={section.href}>
                        <Link
                          href={section.href}
                          aria-current={active ? "page" : undefined}
                          className={cx(
                            "cq-body-sm relative flex min-h-11 items-center rounded-(--cq-radius-md) px-3 pointer-fine:min-h-9",
                            active
                              ? "bg-(--cq-accent-soft) font-medium text-(--cq-text-primary)"
                              : "text-(--cq-text-secondary) hover:bg-(--cq-surface-subtle) hover:text-(--cq-text-primary)",
                          )}
                        >
                          {active ? (
                            <span
                              aria-hidden="true"
                              className="absolute inset-y-2 start-0 w-[3px] rounded-full bg-(--cq-accent)"
                            />
                          ) : null}
                          {t(section.label)}
                        </Link>
                      </li>
                    );
                  },
                )}
              </ul>
            </div>
          ))}
        </div>
      </nav>
      <label className="flex flex-col gap-1 lg:hidden" data-org-section-select>
        <span className="cq-caption text-(--cq-text-secondary)">
          {t("Section")}
        </span>
        <select
          className={`${fieldControlClassName} h-11 cq-body-sm`}
          value={current?.href ?? "/organisation"}
          onChange={(event) => {
            router.push(event.target.value);
          }}
        >
          {ORG_SECTION_GROUPS.map((group) => (
            <optgroup key={group} label={t(group)}>
              {ORG_SECTIONS.filter((section) => section.group === group).map(
                (section) => (
                  <option key={section.href} value={section.href}>
                    {t(section.label)}
                  </option>
                ),
              )}
            </optgroup>
          ))}
        </select>
      </label>
    </>
  );
}

/**
 * Decision 110: a member sees the section read-only. Every form control
 * inside is disabled by the fieldset and the note says why. This is the
 * page's courtesy only; the API refuses a member's writes whatever renders.
 */
export function OrgReadOnly({
  readOnly,
  children,
}: {
  readonly readOnly: boolean;
  readonly children: ReactNode;
}) {
  const t = useT();
  if (!readOnly) return <>{children}</>;
  return (
    <div data-org-read-only>
      <p
        className="mx-auto mb-2 flex w-full max-w-[calc(820px+4rem)] items-center gap-2 px-4 pt-5 cq-body-sm text-(--cq-text-secondary) sm:px-6 lg:px-8"
        data-org-read-only-note
      >
        <Lock
          aria-hidden="true"
          size={ICON_SIZE.compact}
          strokeWidth={ICON_STROKE}
        />
        {t("Only owners and admins can change this.")}
      </p>
      <fieldset disabled className="m-0 min-w-0 border-0 p-0">
        <legend className="sr-only">{t("Read only")}</legend>
        {children}
      </fieldset>
    </div>
  );
}
