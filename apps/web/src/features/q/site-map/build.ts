import {
  QSiteMapSchema,
  Q_RECORD_PAGES,
  Q_SETTINGS_SECTIONS,
  Q_SITE_MAP_VERSION,
  Q_VOICE_DESTINATIONS,
  type QRecordPage,
  type QSettingsSection,
  type QSiteMap,
  type QSiteMapPage,
  type QVoiceDestination,
} from "@capital-q/contracts";

import { APP_ROUTE_PATTERNS } from "@/features/q/control/app-routes";
import { recordPagePath, settingsPath } from "@/features/q/client-actions";
import { destinationPath } from "@/features/voice/destinations";

import { SITE_MAP_AUDIENCES, SITE_MAP_PAGES, SITE_MAP_PARAMS } from "./pages";

/**
 * Q Workspace W2.1: the site map, built deterministically from
 *   - the route table (`APP_ROUTE_PATTERNS`: one entry per page),
 *   - the page registry (`SITE_MAP_PAGES`: titles, purposes, tabs, sections),
 *   - the contract enums mapped through the browser's own route maps
 *     (destinations, record pages, settings sections).
 * Same input, same output, in route order: the checked-in snapshot
 * (`@capital-q/contracts` `Q_SITE_MAP`) is this function's output, and a
 * test fails when they differ.
 */

/** A fixed id for mapping record pages to routes; never a real record. */
const SAMPLE_ID = "00000000-0000-4000-8000-000000000000";

type Split = {
  readonly pathname: string;
  readonly query: string;
  readonly hash: string;
};

function split(path: string): Split {
  const hashAt = path.indexOf("#");
  const hash = hashAt < 0 ? "" : path.slice(hashAt + 1);
  const rest = hashAt < 0 ? path : path.slice(0, hashAt);
  const queryAt = rest.indexOf("?");
  return {
    pathname: queryAt < 0 ? rest : rest.slice(0, queryAt),
    query: queryAt < 0 ? "" : rest.slice(queryAt + 1),
    hash,
  };
}

function segments(path: string): readonly string[] {
  return path.split("/").filter((part) => part.length > 0);
}

const isParam = (segment: string) =>
  segment.startsWith("[") && segment.endsWith("]");

/** The route pattern a concrete pathname belongs to; literal routes win. */
export function routeFor(pathname: string): string | null {
  const parts = segments(pathname);
  let best: { route: string; params: number } | null = null;
  for (const route of APP_ROUTE_PATTERNS) {
    const pattern = segments(route);
    if (pattern.length !== parts.length) continue;
    if (
      !pattern.every(
        (segment, index) => isParam(segment) || segment === parts[index],
      )
    ) {
      continue;
    }
    const params = pattern.filter(isParam).length;
    if (best === null || params < best.params) best = { route, params };
  }
  return best?.route ?? null;
}

/** A concrete path written back as its route's template ("/company/<id>?tab=x" -> "/company/[companyId]?tab=x"). */
function template(path: string): {
  readonly route: string;
  readonly href: string;
} | null {
  const parts = split(path);
  const route = routeFor(parts.pathname);
  if (route === null) return null;
  const query = parts.query
    .split("&")
    .filter((pair) => pair.length > 0 && !pair.includes(SAMPLE_ID))
    .join("&");
  return {
    route,
    href: `${route}${query === "" ? "" : `?${query}`}${parts.hash === "" ? "" : `#${parts.hash}`}`,
  };
}

type Landing = {
  readonly route: string;
  /** The tab whose href it is, if any. */
  readonly tab: string | null;
};

/** Where a path lands in the registry: its page, and the tab it opens. */
export function landingOf(path: string): Landing | null {
  const found = template(path);
  if (found === null) return null;
  const tabs = SITE_MAP_PAGES[found.route]?.tabs ?? [];
  const tab = tabs.find((one) => one.href === found.href);
  return { route: found.route, tab: tab?.id ?? null };
}

function destinationsByLanding(): Map<string, QVoiceDestination[]> {
  const out = new Map<string, QVoiceDestination[]>();
  for (const destination of Q_VOICE_DESTINATIONS) {
    const path = destinationPath(destination);
    if (path === null) continue;
    const landing = landingOf(path);
    if (landing === null) continue;
    const key = `${landing.route} ${landing.tab ?? ""}`;
    out.set(key, [...(out.get(key) ?? []), destination]);
  }
  return out;
}

function recordPagesByRoute(): Map<string, QRecordPage[]> {
  const out = new Map<string, QRecordPage[]>();
  for (const page of Q_RECORD_PAGES) {
    const landing = template(recordPagePath(page, SAMPLE_ID, SAMPLE_ID));
    if (landing === null) continue;
    out.set(landing.route, [...(out.get(landing.route) ?? []), page]);
  }
  return out;
}

function settingsByRoute(): Map<string, QSettingsSection[]> {
  const out = new Map<string, QSettingsSection[]>();
  for (const section of Q_SETTINGS_SECTIONS) {
    const landing = template(settingsPath(section));
    if (landing === null) continue;
    out.set(landing.route, [...(out.get(landing.route) ?? []), section]);
  }
  return out;
}

/** The site map. Throws when the registry does not cover a route (the coverage test names it). */
export function buildSiteMap(): QSiteMap {
  const destinations = destinationsByLanding();
  const records = recordPagesByRoute();
  const settings = settingsByRoute();
  const pages: QSiteMapPage[] = [...APP_ROUTE_PATTERNS].sort().map((route) => {
    const entry = SITE_MAP_PAGES[route];
    if (entry === undefined) {
      throw new Error(`site map: no registry entry for ${route}`);
    }
    const audiences = SITE_MAP_AUDIENCES[route] ?? {};
    return {
      route,
      title: entry.title,
      purpose: entry.purpose,
      audience: entry.audience,
      ...(entry.redirectsTo === undefined
        ? {}
        : { redirectsTo: entry.redirectsTo }),
      params: segments(route)
        .filter(isParam)
        .map((segment) => {
          const name = segment.slice(1, -1);
          const instance = SITE_MAP_PARAMS[name];
          if (instance === undefined) {
            throw new Error(`site map: unknown route parameter ${name}`);
          }
          return { name, instance };
        }),
      shows: [...(entry.shows ?? [])],
      destinations: destinations.get(`${route} `) ?? [],
      recordPages: records.get(route) ?? [],
      settingsSections: settings.get(route) ?? [],
      tabs: (entry.tabs ?? []).map((tab) => ({
        id: tab.id,
        title: tab.title,
        href: tab.href,
        destinations: destinations.get(`${route} ${tab.id}`) ?? [],
        subs: [...(tab.subs ?? [])],
        ...(tab.purpose === undefined ? {} : { purpose: tab.purpose }),
        ...(audiences.tabs?.[tab.id] === undefined
          ? {}
          : { audience: audiences.tabs[tab.id] }),
      })),
      sections: (entry.sections ?? []).map((section) => ({
        id: section.id,
        title: section.title,
        kind: section.kind,
        ...(section.tab === undefined ? {} : { tab: section.tab }),
        ...(audiences.sections?.[section.id] === undefined
          ? {}
          : { audience: audiences.sections[section.id] }),
      })),
    };
  });
  // An audience for a tab or section that is not there is a typo, not a rule.
  for (const [route, audiences] of Object.entries(SITE_MAP_AUDIENCES)) {
    const page = pages.find((one) => one.route === route);
    for (const id of Object.keys(audiences.tabs ?? {})) {
      if (page?.tabs.some((tab) => tab.id === id) !== true) {
        throw new Error(`site map: audience for unknown tab ${route} ${id}`);
      }
    }
    for (const id of Object.keys(audiences.sections ?? {})) {
      if (page?.sections.some((section) => section.id === id) !== true) {
        throw new Error(
          `site map: audience for unknown section ${route} ${id}`,
        );
      }
    }
  }
  return QSiteMapSchema.parse({ version: Q_SITE_MAP_VERSION, pages });
}

/** The snapshot file's source: the map as a typed constant, stable formatting. */
export function siteMapSource(map: QSiteMap): string {
  return [
    "// GENERATED by apps/web (Q Workspace W2): pnpm --filter @capital-q/web site-map:write",
    "// Do not edit by hand: edit apps/web/src/features/q/site-map/pages.ts and regenerate.",
    'import type { QSiteMap } from "./site-map.js";',
    "",
    `export const Q_SITE_MAP: QSiteMap = ${JSON.stringify(map, null, 2)};`,
    "",
  ].join("\n");
}
