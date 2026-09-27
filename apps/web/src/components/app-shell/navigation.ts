import type { ComponentType } from "react";

import {
  CircleUser,
  Compass,
  Landmark,
  Play,
  Settings,
  Users,
} from "@capital-q/ui/icons";

import { QNavIcon } from "./q-nav-icon";

/**
 * The information architecture (doc 17 §§6–8, as amended by ADR 0017).
 * Four primary areas plus Profile. The first is Q's own page, labelled
 * "Q" (lead decision, 2026-09-25); its route stays /home so every
 * `/home?c=` link keeps working. Q is also the floating dock (F1).
 */

export type NavigationItem = {
  readonly href:
    | "/home"
    | "/discover"
    | "/capital"
    | "/relationships"
    | "/profile"
    | "/pitch"
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
  { href: "/home", label: "Q", icon: QNavIcon },
  { href: "/discover", label: "Discover", icon: Compass },
  { href: "/capital", label: "Capital", icon: Landmark },
  // Every canonical relationship of the person's side (R27).
  { href: "/relationships", label: "Relationships", icon: Users },
];

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

/** Mobile carries Profile as the fifth and last tab. */
export const MOBILE_NAVIGATION: readonly NavigationItem[] = [
  ...PRIMARY_NAVIGATION,
  PROFILE_NAVIGATION,
];

export function isActiveRoute(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
