import type { ComponentType } from "react";

import {
  CircleUser,
  FileText,
  Compass,
  DoorOpen,
  Gauge,
  Handshake,
  LayoutDashboard,
  ListChecks,
  Landmark,
  Newspaper,
  Play,
  Presentation,
  Settings,
  Users,
  Wrench,
} from "@capital-q/ui/icons";

import type { ContextScope } from "@capital-q/ui/tokens";

import { QNavIcon } from "./q-nav-icon";

/**
 * The information architecture (doc 17 §§6–8, as amended by ADR 0017).
 * Four primary areas plus Profile. Discover comes first: it is where the
 * product starts (founder directive, 2026-09-27). Q's own page is labelled
 * "Q" (lead decision, 2026-09-25); its route stays /home so every
 * `/home?c=` link keeps working (/q redirects there). Q is also the
 * floating dock (F1), so it is never more than one tap away.
 */

export type NavigationItem = {
  readonly href:
    | "/home"
    | "/discover"
    | "/explore"
    | "/capital"
    | "/relationships"
    | "/profile"
    | "/pitch"
    | "/investors"
    | "/search"
    | "/rehearsals"
    | "/results"
    | "/daily"
    | "/settings"
    | "/settings/usage"
    | "/documents"
    | "/work"
    | "/admin"
    | "/gateq"
    | "/q-pitch";
  readonly label: string;
  readonly icon: ComponentType<{
    readonly size?: number;
    readonly strokeWidth?: number;
    readonly "aria-hidden"?: boolean | "true";
    readonly className?: string;
  }>;
};

export const PRIMARY_NAVIGATION: readonly NavigationItem[] = [
  { href: "/discover", label: "Discover", icon: Compass },
  // Explore (E1-E5, ADR 0055): what "Search" became -- every pitch on the
  // network, with search at its top.
  { href: "/explore", label: "Explore", icon: LayoutDashboard },
  { href: "/home", label: "Q", icon: QNavIcon },
  { href: "/capital", label: "Capital", icon: Landmark },
  // CRM (owner directive 2026-10-15 §D): the person's side's canonical
  // relationships (R27), its pipeline and its reports in one workspace.
  // Founders see it as their Fundraising Hub, investors as their
  // Investment Hub. Results is now its Reports tab, so has no entry of its
  // own; /results and /crm still mark this entry as current.
  { href: "/relationships", label: "CRM", icon: Users },
];

const byHref = (href: NavigationItem["href"]): NavigationItem => {
  const item = PRIMARY_NAVIGATION.find((entry) => entry.href === href);
  if (item === undefined) throw new Error(`No primary navigation for ${href}`);
  return item;
};

export const PROFILE_NAVIGATION: NavigationItem = {
  href: "/profile",
  label: "Profile",
  icon: CircleUser,
};

/** Settings (R28): per-device preferences, from the account menu. */
export const SETTINGS_NAVIGATION: NavigationItem = {
  href: "/settings",
  label: "Settings",
  icon: Settings,
};

/**
 * A founder's own pitch and its versions (VID). Secondary, not a fourth
 * primary area: it belongs to the founder's company, so the shell shows it
 * only in a founder's context, and the server refuses it to anyone else
 * whatever the navigation shows.
 */
export const FOUNDER_MEDIA_NAVIGATION: NavigationItem = {
  href: "/pitch",
  label: "Pitch & media",
  icon: Play,
};

/**
 * Company requests (ADR 0023; renamed by the founder brief B4, ADR 0052):
 * companies' Connection Requests to an
 * investor's organisation. A founder's /investors now opens Discover's
 * Investors tab, so only investors see this entry.
 */
export const COMPANY_REQUESTS_NAVIGATION: NavigationItem = {
  href: "/investors",
  label: "Company requests",
  icon: Handshake,
};

/**
 * REHEARSE: rehearse a meeting with someone you are connected to, played by
 * Q, and every past rehearsal with its review. For founders and investors.
 */
export const REHEARSALS_NAVIGATION: NavigationItem = {
  href: "/rehearsals",
  label: "Rehearsals",
  icon: Presentation,
};

/** DOCS: every document Q made for them, and their brand kit. */
export const DOCUMENTS_NAVIGATION: NavigationItem = {
  href: "/documents",
  label: "Documents",
  icon: FileText,
};

/**
 * The Q Daily (DAILY): the person's own newspaper of news about their
 * sectors, markets, deals and the people they know, with its archive.
 */
/**
 * Q Pitch (owner request, 15 Oct): the guided tour entry. Shown only when
 * the server enables Q Pitch (CQ_Q_PITCH_TOUR) and only to a founder or
 * investor workspace; the page and the host re-check both.
 */
export const Q_PITCH_NAVIGATION: NavigationItem = {
  href: "/q-pitch",
  label: "Q Pitch",
  icon: Play,
};

export const DAILY_NAVIGATION: NavigationItem = {
  href: "/daily",
  label: "The Q Daily",
  icon: Newspaper,
};

/**
 * GateQ (F2, 2026-10-06): its own page. A founder checks their fit against
 * investors' gates and finds their company; an investor works their gate's
 * inbox, finds startups and runs the gate.
 */
export const GATEQ_NAVIGATION: NavigationItem = {
  href: "/gateq",
  label: "GateQ",
  icon: DoorOpen,
};

/**
 * Q's work (WORK-58): what Q suggests, what waits for their yes, what it
 * runs and what it finished. Reached from the bell before; now a section.
 */
export const WORK_NAVIGATION: NavigationItem = {
  href: "/work",
  label: "Work",
  icon: ListChecks,
};

/** What Q used for them this month (lead 2026-10-03), under You. */
export const USAGE_NAVIGATION: NavigationItem = {
  href: "/settings/usage",
  label: "Usage",
  icon: Gauge,
};

/**
 * Capital Q's operations console (ADR 0033), shown only to platform
 * admins. The flag comes from the server; the console's own route still
 * refuses everyone else whatever the navigation shows.
 */
export const ADMIN_NAVIGATION: NavigationItem = {
  href: "/admin",
  label: "Admin console",
  icon: Wrench,
};

/**
 * Explore (ADR 0055) replaced the Search field: search lives at the top of
 * Explore. Kept under this name for the shell's "find" affordances.
 */
export const FIND_NAVIGATION: NavigationItem = {
  href: "/explore",
  label: "Explore",
  icon: LayoutDashboard,
};

/**
 * The phone's tab bar (founder directive, 2026-09-27; Explore design
 * 2026-10-06): Discover, Explore, Q in the centre, Relationships, then
 * More. Explore takes Capital's place; Capital stays in the sidebar and
 * the More sheet. There is no separate Chats area. More (founder report,
 * 2026-10-01) opens every other section, Profile first.
 */
export const MOBILE_NAVIGATION: readonly NavigationItem[] = [
  byHref("/discover"),
  byHref("/explore"),
  byHref("/home"),
  byHref("/relationships"),
];

/** Profile and Settings: the person's own pages, on every side. */
export const ACCOUNT_NAVIGATION: readonly NavigationItem[] = [
  PROFILE_NAVIGATION,
  SETTINGS_NAVIGATION,
];

/**
 * The sidebar's groups (WORK-58, founder-approved 2026-10-04): the main
 * areas with no label, then Workspace, You, and Admin for platform admins
 * only. Few short labels, never a heading per item. The one source both
 * the desktop sidebar and the phone's More sheet read, so the two never
 * drift. Showing a link is not access: each route's server decides.
 */
export type NavigationGroup = {
  /** Null for the main areas, which need no label. */
  readonly label: "Workspace" | "You" | "Admin" | null;
  readonly items: readonly NavigationItem[];
};

export type NavigationOptions = {
  readonly admin?: boolean | undefined;
  /** The server enabled Q Pitch (CQ_Q_PITCH_TOUR=1). */
  readonly qPitch?: boolean | undefined;
};

export function navigationGroupsFor(
  scope: ContextScope,
  options: NavigationOptions = {},
): readonly NavigationGroup[] {
  const founder = scope === "founder_private";
  const investor = scope === "investor_private";
  return [
    { label: null, items: PRIMARY_NAVIGATION },
    {
      label: "Workspace",
      items: [
        ...(founder || investor ? [GATEQ_NAVIGATION] : []),
        WORK_NAVIGATION,
        ...(founder ? [FOUNDER_MEDIA_NAVIGATION] : []),
        ...(investor ? [COMPANY_REQUESTS_NAVIGATION] : []),
        DOCUMENTS_NAVIGATION,
        ...(founder || investor ? [REHEARSALS_NAVIGATION] : []),
        ...((founder || investor) && options.qPitch === true
          ? [Q_PITCH_NAVIGATION]
          : []),
        DAILY_NAVIGATION,
      ],
    },
    {
      label: "You",
      items: [PROFILE_NAVIGATION, USAGE_NAVIGATION, SETTINGS_NAVIGATION],
    },
    ...(options.admin === true
      ? [{ label: "Admin" as const, items: [ADMIN_NAVIGATION] }]
      : []),
  ];
}

/**
 * Every section a person in this context can reach, in the sidebar's
 * order, Profile and Settings aside (ACCOUNT_NAVIGATION). Explore, where
 * search lives, is one of the main areas.
 */
export function sectionsFor(
  scope: ContextScope,
  options: NavigationOptions = {},
): readonly NavigationItem[] {
  const account = new Set(ACCOUNT_NAVIGATION.map((item) => item.href));
  return [
    ...navigationGroupsFor(scope, options)
      .flatMap((group) => group.items)
      .filter((item) => !account.has(item.href)),
  ];
}

/**
 * What the More sheet lists, in groups: everything not on a tab. Profile
 * heads the sheet.
 */
export function moreGroupsFor(
  scope: ContextScope,
  options: NavigationOptions = {},
): readonly NavigationGroup[] {
  const onTabs = new Set(MOBILE_NAVIGATION.map((item) => item.href));
  return navigationGroupsFor(scope, options)
    .map((group) => ({
      label: group.label,
      items: group.items.filter(
        (item) => !onTabs.has(item.href) && item.href !== "/profile",
      ),
    }))
    .filter((group) => group.items.length > 0);
}

/** What the More sheet lists, flat: Profile, then every group's. */
export function moreSectionsFor(
  scope: ContextScope,
  options: NavigationOptions = {},
): readonly NavigationItem[] {
  return [
    PROFILE_NAVIGATION,
    ...moreGroupsFor(scope, options).flatMap((group) => group.items),
  ];
}

/** The centre tab, drawn as Q's own mark rather than a plain icon. */
export const MOBILE_CENTRE_HREF = "/home" satisfies NavigationItem["href"];

/**
 * Routes that belong to another entry's area: the CRM's Reports tab keeps
 * the Results URL, and /crm is the CRM's alias.
 */
const AREA_ALIASES: Readonly<Record<string, readonly string[]>> = {
  "/relationships": ["/results", "/crm"],
};

export function isActiveRoute(pathname: string, href: string): boolean {
  return [href, ...(AREA_ALIASES[href] ?? [])].some(
    (root) => pathname === root || pathname.startsWith(`${root}/`),
  );
}
