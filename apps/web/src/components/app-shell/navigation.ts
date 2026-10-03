import type { ComponentType } from "react";

import {
  ChartColumn,
  CircleUser,
  FileText,
  Compass,
  Handshake,
  Search,
  Landmark,
  Newspaper,
  Play,
  Presentation,
  Settings,
  Users,
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
    | "/documents";
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
  { href: "/home", label: "Q", icon: QNavIcon },
  { href: "/capital", label: "Capital", icon: Landmark },
  // Every canonical relationship of the person's side (R27).
  { href: "/relationships", label: "Relationships", icon: Users },
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
 * Founder requests (ADR 0023): founders' Connection Requests to an
 * investor's organisation. A founder's /investors now opens Discover's
 * Investors tab, so only investors see this entry.
 */
export const FOUNDER_REQUESTS_NAVIGATION: NavigationItem = {
  href: "/investors",
  label: "Founder requests",
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

// ADMIN block
/**
 * Results (spec docs/specs/2026-10/admin.md §5): what a person's activity
 * on Capital Q produced, with reports to download. Founders and investors.
 */
export const RESULTS_NAVIGATION: NavigationItem = {
  href: "/results",
  label: "Results",
  icon: ChartColumn,
};
// end ADMIN block

/**
 * The Q Daily (DAILY): the person's own newspaper of news about their
 * sectors, markets, deals and the people they know, with its archive.
 */
export const DAILY_NAVIGATION: NavigationItem = {
  href: "/daily",
  label: "The Q Daily",
  icon: Newspaper,
};

/** Search people by @handle and founders' videos (founder design 2026-09-29). */
export const FIND_NAVIGATION: NavigationItem = {
  href: "/search",
  label: "Search",
  icon: Search,
};

/**
 * The phone's tab bar (founder directive, 2026-09-27): Discover first, Q in
 * the centre. There is no separate Chats area -- a person's conversations
 * with Q live on the Q page and their relationship threads under
 * Relationships. The fifth slot is More (founder report, 2026-10-01: the
 * phone could not reach Rehearsals, Results, Documents and the rest), which
 * opens every other section, Profile first.
 */
export const MOBILE_NAVIGATION: readonly NavigationItem[] = [
  byHref("/discover"),
  byHref("/relationships"),
  byHref("/home"),
  byHref("/capital"),
];

/** Profile and Settings: the person's own pages, on every side. */
export const ACCOUNT_NAVIGATION: readonly NavigationItem[] = [
  PROFILE_NAVIGATION,
  SETTINGS_NAVIGATION,
];

/**
 * Every section a person in this context can reach, in the sidebar's
 * order. The one source both the desktop sidebar and the phone's More
 * sheet read, so the two never drift. Showing a link is not access: each
 * route's server decides what this person may see.
 */
export function sectionsFor(scope: ContextScope): readonly NavigationItem[] {
  const founder = scope === "founder_private";
  const investor = scope === "investor_private";
  return [
    ...PRIMARY_NAVIGATION,
    // Founder Discover's Investors tab is the investor list; a second
    // "Investors" entry showed the same list (demo audit 2026-10-03).
    ...(founder ? [FOUNDER_MEDIA_NAVIGATION] : []),
    ...(investor ? [FOUNDER_REQUESTS_NAVIGATION] : []),
    ...(founder || investor ? [REHEARSALS_NAVIGATION, RESULTS_NAVIGATION] : []),
    DOCUMENTS_NAVIGATION,
    DAILY_NAVIGATION,
    FIND_NAVIGATION,
  ];
}

/** What the More sheet lists: Profile first, then everything not on a tab. */
export function moreSectionsFor(
  scope: ContextScope,
): readonly NavigationItem[] {
  const onTabs = new Set(MOBILE_NAVIGATION.map((item) => item.href));
  return [
    PROFILE_NAVIGATION,
    ...sectionsFor(scope).filter((item) => !onTabs.has(item.href)),
    SETTINGS_NAVIGATION,
  ];
}

/** The centre tab, drawn as Q's own mark rather than a plain icon. */
export const MOBILE_CENTRE_HREF = "/home" satisfies NavigationItem["href"];

export function isActiveRoute(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
