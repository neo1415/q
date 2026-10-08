"use client";

import { useSearchParams } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";

import type { QManifestRef, QManifestSectionKind } from "@capital-q/contracts";
import { Skeleton } from "@capital-q/ui/states";

import { QPageState, QSection } from "@/features/q/q-section";

import { profileTabHref, profileTabOf, type ProfileTab } from "./profile-tab";

/**
 * Moving between a profile's tabs without leaving the page (founder
 * 2026-10-08: "when moving between tabs let it be smooth and not reload
 * the page every time").
 *
 * Every tab's panel arrives with the page (the slow reads stream into
 * their own panel behind a skeleton), so a tab is a shallow URL change:
 * `history.pushState`, which Next.js folds into its router, so
 * `useSearchParams`, Back and Forward all follow it and nothing is fetched
 * again. A panel once opened stays mounted while hidden, so its scroll,
 * folds and video position are where they were; a hidden panel's media is
 * paused. A link opened in a new tab, or a URL typed, still lands on the
 * server-rendered tab.
 */

type TabsContext = {
  readonly tab: ProfileTab;
  readonly visited: ReadonlySet<ProfileTab>;
  readonly hrefFor: (tab: ProfileTab) => string;
  readonly select: (tab: ProfileTab) => void;
};

const Context = createContext<TabsContext | null>(null);

export function ProfileTabs({
  base,
  initial,
  available,
  focus,
  children,
}: {
  /** `/company/<id>`. */
  readonly base: string;
  /** The tab the server rendered (and the first, when the URL names none). */
  readonly initial: ProfileTab;
  /** The tabs this reader has; the first is the bare URL. */
  readonly available: readonly ProfileTab[];
  /** Q's page focus, with the tab that is open now. */
  readonly focus?: QManifestRef | undefined;
  readonly children: ReactNode;
}) {
  const params = useSearchParams();
  const first = available[0] ?? initial;
  const requested = profileTabOf(params.get("tab"));
  const tab =
    available.length <= 1
      ? first
      : requested !== null && available.includes(requested)
        ? requested
        : first;

  const [visited, setVisited] = useState<ReadonlySet<ProfileTab>>(
    () => new Set([initial, tab]),
  );
  if (!visited.has(tab)) setVisited(new Set([...visited, tab]));

  const search = params.toString();
  const hrefFor = useCallback(
    (to: ProfileTab) => profileTabHref(base, to, first, search),
    [base, first, search],
  );
  const select = useCallback(
    (to: ProfileTab) => {
      if (to === tab) return;
      // A shallow entry: Next.js keeps its tree in the history state, so
      // Back and Forward restore the tab without a request.
      window.history.pushState(null, "", hrefFor(to));
    },
    [hrefFor, tab],
  );
  const value = useMemo(
    () => ({ tab, visited, hrefFor, select }),
    [tab, visited, hrefFor, select],
  );
  return (
    <Context.Provider value={value}>
      <QPageState tab={tab} focus={focus} />
      {children}
    </Context.Provider>
  );
}

/** The open tab, or null outside a profile's tabs (tests, design review). */
export function useProfileTab(): ProfileTab | null {
  return useContext(Context)?.tab ?? null;
}

/**
 * A link to one of the profile's tabs. Inside `ProfileTabs` it switches in
 * place; a modified click (new tab, new window) is the browser's.
 */
export function ProfileTabLink({
  tab,
  fallbackHref,
  current,
  className,
  activeClassName,
  idleClassName,
  children,
  ...data
}: {
  readonly tab: ProfileTab;
  /** Where the link goes outside `ProfileTabs`. */
  readonly fallbackHref: string;
  /** Marks the open tab with aria-current (the tab bar). */
  readonly current?: boolean;
  readonly className?: string;
  /** Added while this tab is open, and while it is not. */
  readonly activeClassName?: string;
  readonly idleClassName?: string;
  readonly children: ReactNode;
  readonly [data: `data-${string}`]: string | undefined;
}) {
  const context = useContext(Context);
  const active = context === null ? (current ?? false) : context.tab === tab;
  const href = context === null ? fallbackHref : context.hrefFor(tab);
  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (context === null) return;
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }
    event.preventDefault();
    context.select(tab);
  };
  return (
    <a
      href={href}
      onClick={onClick}
      aria-current={current !== undefined && active ? "page" : undefined}
      className={[className, active ? activeClassName : idleClassName]
        .filter((part) => part !== undefined && part !== "")
        .join(" ")}
      {...data}
    >
      {children}
    </a>
  );
}

/**
 * One tab's panel. Shown when open; once opened, kept mounted while
 * hidden, with its media paused. Outside `ProfileTabs`, the server's tab
 * decides.
 */
export function ProfileTabPanel({
  tab,
  serverTab,
  children,
}: {
  readonly tab: ProfileTab;
  readonly serverTab: ProfileTab;
  readonly children: ReactNode;
}) {
  const context = useContext(Context);
  const open = context === null ? serverTab === tab : context.tab === tab;
  const mounted = open || (context?.visited.has(tab) ?? false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open) return;
    for (const media of ref.current?.querySelectorAll("video, audio") ?? []) {
      if (media instanceof HTMLMediaElement) media.pause();
    }
  }, [open]);
  if (!mounted) return null;
  return (
    <div ref={ref} hidden={!open} data-profile-panel={tab}>
      {children}
    </div>
  );
}

/** A page section for Q whose label is said only while its tab is open. */
export function ProfileTabQSection({
  id,
  kind,
  refs,
  total,
  labelOn,
  label,
}: {
  readonly id: string;
  readonly kind: QManifestSectionKind;
  readonly refs: readonly QManifestRef[];
  readonly total: number;
  readonly labelOn: ProfileTab;
  readonly label: string;
}) {
  const tab = useProfileTab();
  return (
    <QSection
      id={id}
      kind={kind}
      refs={refs}
      total={total}
      label={tab === labelOn ? label : undefined}
    />
  );
}

/** The panel's own placeholder while its read streams in. */
export function ProfilePanelSkeleton() {
  return (
    <div className="py-2" aria-busy="true" data-profile-panel-loading>
      <Skeleton lines={6} />
    </div>
  );
}
