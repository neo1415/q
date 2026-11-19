import type { TeamRole } from "@capital-q/contracts";

/**
 * The organisation admin's section index (admin design 2026-11-19 §2.1(b),
 * decisions 109 and 110). One address per section under /organisation;
 * each section reuses the screen that already does the job, or says
 * plainly that it is not built yet.
 */

export type OrgSectionGroup =
  "Organisation" | "Data" | "Q and brand" | "Governance";

export type OrgSection = {
  readonly href: string;
  readonly label: string;
  readonly group: OrgSectionGroup;
};

export const ORG_SECTIONS: readonly OrgSection[] = [
  { href: "/organisation", label: "General", group: "Organisation" },
  {
    href: "/organisation/members",
    label: "Members and usage",
    group: "Organisation",
  },
  { href: "/organisation/roles", label: "Roles", group: "Organisation" },
  {
    href: "/organisation/plan",
    label: "Plan and billing",
    group: "Organisation",
  },
  { href: "/organisation/import", label: "Import", group: "Data" },
  { href: "/organisation/connections", label: "Connections", group: "Data" },
  {
    href: "/organisation/data",
    label: "Export and deletion",
    group: "Data",
  },
  { href: "/organisation/privacy", label: "Privacy", group: "Data" },
  {
    href: "/organisation/speaking",
    label: "How Q speaks for us",
    group: "Q and brand",
  },
  {
    href: "/organisation/brand",
    label: "Gateway and Q Card brand",
    group: "Q and brand",
  },
  {
    href: "/organisation/activity",
    label: "Activity log",
    group: "Governance",
  },
];

export const ORG_SECTION_GROUPS: readonly OrgSectionGroup[] = [
  "Organisation",
  "Data",
  "Q and brand",
  "Governance",
];

/** The current section: an exact address, else the deepest one it is under. */
export function currentOrgSection(pathname: string): OrgSection | null {
  let best: OrgSection | null = null;
  for (const section of ORG_SECTIONS) {
    const under =
      pathname === section.href ||
      (section.href !== "/organisation" &&
        pathname.startsWith(`${section.href}/`));
    if (under && (best === null || section.href.length > best.href.length)) {
      best = section;
    }
  }
  return best;
}

/**
 * Decision 110: owners and admins change things here; a member sees the
 * same page read-only. This only decides what the page draws; every write
 * is refused again by the API to anyone who may not make it.
 */
export function manages(role: TeamRole | null): boolean {
  return role === "OWNER" || role === "ADMIN";
}

/** The role with its article: an organisation can have several owners. */
export const ROLE_NAME: Readonly<Record<TeamRole, string>> = {
  OWNER: "an owner",
  ADMIN: "an admin",
  MEMBER: "a member",
};

/** The scope bar's parts (§3.2), in order. */
export function scopeParts(name: string, role: TeamRole): readonly string[] {
  return [
    name,
    `You are ${ROLE_NAME[role]}`,
    `Changes here apply to ${name} only`,
  ];
}
