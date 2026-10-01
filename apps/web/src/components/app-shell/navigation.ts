import type { ComponentType } from "react";

import {
  ChartColumn,
  CircleUser,
  Compass,
  Handshake,
  Search,
  Landmark,
  Play,
  Presentation,
  Settings,
  Users,
} from "@capital-q/ui/icons";

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
    | "/settings";
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
 * Investors (ADR 0023). For a founder: the investors they may look at and
 * ask to connect with. For an investor: founders' Connection Requests to
 * their organisation. Same route, the person's own side decides the page;
 * the server decides what either may see.
 */
export const INVESTORS_NAVIGATION: NavigationItem = {
  href: "/investors",
  label: "Investors",
  icon: Handshake,
};
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

/** Search people by @handle and founders' videos (founder design 2026-09-29). */
export const FIND_NAVIGATION: NavigationItem = {
  href: "/search",
  label: "Search",
  icon: Search,
};

/**
 * The phone's tab bar (founder directive, 2026-09-27): Discover first, Q in
 * the centre, Profile last. There is no separate Chats area -- a person's
 * conversations with Q live on the Q page and their relationship threads
 * under Relationships -- so the fourth slot is Capital.
 */
export const MOBILE_NAVIGATION: readonly NavigationItem[] = [
  byHref("/discover"),
  byHref("/relationships"),
  byHref("/home"),
  byHref("/capital"),
  PROFILE_NAVIGATION,
];

/** The centre tab, drawn as Q's own mark rather than a plain icon. */
export const MOBILE_CENTRE_HREF = "/home" satisfies NavigationItem["href"];

export function isActiveRoute(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
