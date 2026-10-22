/**
 * "Recently opened" on Search (app prototype "search", option 2): the
 * people, cards and videos this person opened from the palette, kept in
 * their own browser only, per signed-in account, as a convenience. It is
 * never a source of truth: every entry links to a page that re-checks
 * access when opened, a video's poster is asked for again under the
 * viewer's session, and storage that is blocked or empty just means an
 * empty list. Nothing private beyond a name and a link is kept.
 */

export type RecentPerson = {
  readonly kind: "person";
  readonly name: string;
  readonly href: string;
  readonly entity: "company" | "investor" | "person";
  readonly companyId?: string | undefined;
  /** "In your CRM", "In Discover", "Found by handle". */
  readonly where: string;
  readonly line: string | null;
};

export type RecentVideo = {
  readonly kind: "video";
  readonly companyId: string;
  readonly mediaAssetId: string;
  readonly company: string;
  readonly title: string | null;
  readonly durationSeconds: number | null;
};

export type RecentItem = RecentPerson | RecentVideo;

const PEOPLE_MAX = 6;
const VIDEOS_MAX = 4;

function keyFor(viewer: string): string {
  return `cq.search.recent.v1.${viewer}`;
}

function valid(value: unknown): value is RecentItem {
  if (typeof value !== "object" || value === null) return false;
  const item = value as Record<string, unknown>;
  if (item.kind === "person") {
    return (
      typeof item.name === "string" &&
      typeof item.href === "string" &&
      item.href.startsWith("/") &&
      !item.href.startsWith("//") &&
      (item.entity === "company" ||
        item.entity === "investor" ||
        item.entity === "person") &&
      typeof item.where === "string"
    );
  }
  if (item.kind === "video") {
    return (
      typeof item.companyId === "string" &&
      typeof item.mediaAssetId === "string" &&
      typeof item.company === "string"
    );
  }
  return false;
}

/** The stored text as entries; anything malformed is dropped. */
export function parseRecent(raw: string | null): readonly RecentItem[] {
  if (raw === null) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(valid) : [];
  } catch {
    return [];
  }
}

/** The stored text itself (a stable snapshot for React). */
export function readRecentRaw(viewer: string): string | null {
  try {
    return window.localStorage.getItem(keyFor(viewer));
  } catch {
    return null;
  }
}

export function readRecent(viewer: string): readonly RecentItem[] {
  return parseRecent(readRecentRaw(viewer));
}

/** Same person or video: the same link, or the same media asset. */
function same(a: RecentItem, b: RecentItem): boolean {
  if (a.kind === "person" && b.kind === "person") return a.href === b.href;
  if (a.kind === "video" && b.kind === "video") {
    return a.mediaAssetId === b.mediaAssetId;
  }
  return false;
}

/** Newest first, de-duplicated, bounded per kind. */
export function withRecent(
  list: readonly RecentItem[],
  item: RecentItem,
): readonly RecentItem[] {
  const next = [item, ...list.filter((known) => !same(known, item))];
  const people = next.filter((entry) => entry.kind === "person");
  const videos = next.filter((entry) => entry.kind === "video");
  return [...people.slice(0, PEOPLE_MAX), ...videos.slice(0, VIDEOS_MAX)];
}

export function rememberOpened(viewer: string, item: RecentItem): void {
  try {
    window.localStorage.setItem(
      keyFor(viewer),
      JSON.stringify(withRecent(readRecent(viewer), item)),
    );
    window.dispatchEvent(new Event(RECENT_CHANGED));
  } catch {
    // Storage blocked: the list just stays as it was.
  }
}

/** Fired on this window when the list changes. */
export const RECENT_CHANGED = "cq:search-recent";

/** Asks the palette (mounted once in the shell) to open. */
export const OPEN_SEARCH = "cq:open-search";

export function openSearch(query = ""): void {
  window.dispatchEvent(new CustomEvent(OPEN_SEARCH, { detail: { query } }));
}
