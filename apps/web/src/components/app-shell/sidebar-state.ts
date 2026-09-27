import { isActiveRoute } from "./navigation";

/**
 * Whether the desktop sidebar is folded to its rail (R24).
 *
 * The Q page starts folded, so the presence has the width; every other
 * page starts open. A choice the person makes holds for the kind of page
 * it was made on (the Q page, or the rest) and is forgotten on moving to
 * the other kind, so opening the list on Q does not leave Discover with a
 * rail, and folding it on Discover does not reopen it over Q.
 */
export type SidebarOverride = {
  readonly onQ: boolean;
  readonly collapsed: boolean;
};

export function sidebarCollapsed(
  pathname: string,
  override: SidebarOverride | null,
): boolean {
  const onQ = isActiveRoute(pathname, "/home");
  if (override !== null && override.onQ === onQ) return override.collapsed;
  return onQ;
}
