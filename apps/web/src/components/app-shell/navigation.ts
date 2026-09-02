import type { ComponentType } from "react";

import { CircleUser, Compass, Home, Landmark } from "@capital-q/ui/icons";

/**
 * The information architecture (doc 17 §§6–8). Exactly three primary areas
 * plus Profile; Q is reached through Home and contextual actions, never as
 * a fifth tab or a floating bubble.
 */

export type NavigationItem = {
  readonly href: "/home" | "/discover" | "/capital" | "/profile";
  readonly label: string;
  readonly icon: ComponentType<{
    readonly size?: number;
    readonly strokeWidth?: number;
    readonly "aria-hidden"?: boolean | "true";
    readonly className?: string;
  }>;
};

export const PRIMARY_NAVIGATION: readonly NavigationItem[] = [
  { href: "/home", label: "Home", icon: Home },
  { href: "/discover", label: "Discover", icon: Compass },
  { href: "/capital", label: "Capital", icon: Landmark },
];

export const PROFILE_NAVIGATION: NavigationItem = {
  href: "/profile",
  label: "Profile",
  icon: CircleUser,
};

/** Mobile carries Profile as the fourth and last tab. */
export const MOBILE_NAVIGATION: readonly NavigationItem[] = [
  ...PRIMARY_NAVIGATION,
  PROFILE_NAVIGATION,
];

export function isActiveRoute(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
