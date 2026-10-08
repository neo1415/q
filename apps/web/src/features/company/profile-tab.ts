/** A company profile's tabs, and `?tab=` as the URL says it. */
export type ProfileTab = "overview" | "elevator" | "dataroom" | "deck" | "team";

/** `?tab=` as the URL says it; "videos" is the old name of Elevator. */
export function profileTabOf(
  requested: string | null | undefined,
): ProfileTab | null {
  switch (requested) {
    case "overview":
    case "elevator":
    case "dataroom":
    case "deck":
    case "team":
      return requested;
    case "videos":
      return "elevator";
    case null:
    case undefined:
    default:
      return null;
  }
}

/**
 * The URL a tab lives at, keeping every other parameter (`?as=investor`).
 * The first tab is the bare profile, as it always was.
 */
export function profileTabHref(
  base: string,
  tab: ProfileTab,
  first: ProfileTab,
  search: string,
): string {
  const params = new URLSearchParams(search);
  if (tab === first) params.delete("tab");
  else params.set("tab", tab);
  const query = params.toString();
  return query === "" ? base : `${base}?${query}`;
}
