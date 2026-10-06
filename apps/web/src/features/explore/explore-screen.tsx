"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import type {
  ExploreMode,
  ExplorePageDto,
  ExploreRelatedDto,
  ExploreTileDto,
  PlaybackAuthorizationDto,
} from "@capital-q/contracts";

import { authorisePlaybackViaAction } from "../discover/feed/action-feed-transport";
import { recordDecisionAction } from "../discover/feed/feed-actions";

import {
  loadExplorePageAction,
  loadExploreRelatedAction,
  type ExploreActionResult,
} from "./explore-actions";
import { ExploreFeed, type ExploreFeedItem } from "./explore-feed";
import { ExploreGrid, ExploreGridSkeleton } from "./explore-grid";
import {
  ExploreSearchBar,
  ExploreSearchResults,
} from "./explore-search-results";
import type { ExploreSearchView, SectorWord } from "./explore-search-view";
import {
  ExploreEndNote,
  ExploreLimitedBanner,
  ExploreState,
} from "./explore-state";
import { columnsForWidth } from "./masonry";

/**
 * Explore (E1-E5, ADR 0055): search at the top, topic chips, the masonry
 * grid of every pitch the viewer may see, and the opened pitch's
 * "Related to X" feed. The slate is the server's, deterministic and
 * explained tile by tile; this screen only lays it out, pages it by
 * cursor, and stops at "You're up to date".
 */

export type ExploreDataSource = {
  readonly loadPage: (
    mode: ExploreMode,
    cursor: string | null,
  ) => Promise<ExploreActionResult<ExplorePageDto>>;
  readonly loadRelated: (
    mediaAssetId: string,
  ) => Promise<ExploreActionResult<ExploreRelatedDto>>;
  readonly authorize: (
    companyId: string,
    mediaAssetId: string,
  ) => Promise<PlaybackAuthorizationDto>;
  readonly save: (
    companyId: string,
    save: boolean,
  ) => Promise<{ readonly ok: boolean; readonly message?: string }>;
};

function clientEventId(): string {
  const random =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${String(Date.now())}-${String(Math.random()).slice(2)}`;
  return `explore:${random}`.slice(0, 64);
}

export const LIVE_EXPLORE_SOURCE: ExploreDataSource = {
  loadPage: (mode, cursor) => loadExplorePageAction(mode, cursor),
  loadRelated: (id) => loadExploreRelatedAction(id),
  authorize: authorisePlaybackViaAction,
  save: async (companyId, save) => {
    const result = await recordDecisionAction({
      companyId,
      intent: save ? "SAVE" : "UNSAVE",
      slateId: null,
      clientEventId: clientEventId(),
      surface: "COMPANY_PROFILE",
    });
    return result.ok
      ? { ok: true }
      : { ok: false, message: "Saving is for investors, from their own feed." };
  },
};

const POSTER_BATCH = 12;
const FRESH_DAYS = 7;

/** Columns from the viewport, read only in the browser (no layout guess on the server). */
const WIDTH_QUERIES = [
  "(min-width: 640px)",
  "(min-width: 1024px)",
  "(min-width: 1400px)",
] as const;
function subscribeColumns(onChange: () => void): () => void {
  if (
    typeof window === "undefined" ||
    typeof window.matchMedia !== "function"
  ) {
    return () => {};
  }
  const lists = WIDTH_QUERIES.map((q) => window.matchMedia(q));
  for (const list of lists) list.addEventListener("change", onChange);
  return () => {
    for (const list of lists) list.removeEventListener("change", onChange);
  };
}
function columnsNow(): number {
  return columnsForWidth(window.innerWidth);
}
function useColumns(): number | null {
  return useSyncExternalStore(subscribeColumns, columnsNow, () => null);
}

type Topic =
  | { readonly kind: "FOR_YOU" }
  | { readonly kind: "EVERYTHING" }
  | { readonly kind: "NEW" }
  | {
      readonly kind: "SECTOR";
      readonly nodeId: string;
      readonly label: string;
    };

type Opened = {
  readonly items: readonly ExploreFeedItem[];
  readonly loading: boolean;
};

export function ExploreScreen({
  source = LIVE_EXPLORE_SOURCE,
  initial = null,
  initialError = false,
  forceLoading = false,
  search = null,
  searchState = "ready",
  sectors = [],
  limitedOrganisation = null,
  startOnRequest = false,
  openOnArrival = null,
}: {
  /** Design review: open this tile's feed on arrival, at this position. */
  readonly openOnArrival?: {
    readonly index: number;
    readonly at: number;
  } | null;
  readonly source?: ExploreDataSource;
  readonly initial?: ExplorePageDto | null;
  readonly initialError?: boolean;
  /** Design review only: hold the loading state. */
  readonly forceLoading?: boolean;
  readonly search?: ExploreSearchView | null;
  readonly searchState?: "ready" | "loading" | "error";
  readonly sectors?: readonly SectorWord[];
  /** Pitches for verified investors only are not shown to this viewer. */
  readonly limitedOrganisation?: string | null;
  readonly startOnRequest?: boolean;
}) {
  const columns = useColumns();
  const sectorLabels = useMemo(
    () => new Map(sectors.map((s) => [s.nodeId, s.label])),
    [sectors],
  );
  const [mode, setMode] = useState<ExploreMode>(initial?.mode ?? "FOR_YOU");
  const [topic, setTopic] = useState<Topic>({ kind: "FOR_YOU" });
  const [tiles, setTiles] = useState<readonly ExploreTileDto[] | null>(
    initial?.items ?? null,
  );
  const [cursor, setCursor] = useState<string | null>(
    initial?.nextCursor ?? null,
  );
  const [upToDate, setUpToDate] = useState(initial?.upToDate ?? false);
  const [error, setError] = useState(initialError);
  const [loadingMore, setLoadingMore] = useState(false);
  const [posters, setPosters] = useState<Readonly<Record<string, string>>>({});
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const [saved, setSaved] = useState<ReadonlySet<string>>(new Set());
  const [opened, setOpened] = useState<Opened | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const loadedFor = useRef<string | null>(
    initial === null ? null : `${initial.mode}:0`,
  );
  const returnFocus = useRef<HTMLElement | null>(null);

  // First page (unless the server already read it) and on every mode change.
  useEffect(() => {
    if (search !== null || forceLoading) return;
    const key = `${mode}:${String(reload)}`;
    if (loadedFor.current === key) return;
    loadedFor.current = key;
    let cancelled = false;
    setTiles(null);
    setError(false);
    void source.loadPage(mode, null).then((result) => {
      if (cancelled) return;
      if (!result.ok) {
        setError(true);
        return;
      }
      setTiles(result.value.items);
      setCursor(result.value.nextCursor);
      setUpToDate(result.value.upToDate);
    });
    return () => {
      cancelled = true;
    };
  }, [mode, reload, search, source, forceLoading]);

  const loadMore = useCallback(async () => {
    if (cursor === null || loadingMore) return;
    setLoadingMore(true);
    const result = await source.loadPage(mode, cursor);
    setLoadingMore(false);
    if (!result.ok) {
      setToast(result.message);
      return;
    }
    setTiles((known) => [...(known ?? []), ...result.value.items]);
    setCursor(result.value.nextCursor);
    setUpToDate(result.value.upToDate);
  }, [cursor, loadingMore, mode, source]);

  // Lazy pages: the next page is read as the end of the grid comes near.
  const sentinel = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const node = sentinel.current;
    if (
      node === null ||
      cursor === null ||
      typeof IntersectionObserver === "undefined"
    ) {
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) void loadMore();
      },
      { rootMargin: "600px 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [cursor, loadMore]);

  // Posters are signed grants, asked for a batch at a time as tiles arrive.
  const asked = useRef(new Set<string>());
  const posterTiles = useMemo(
    () => [
      ...(tiles ?? []),
      ...(search?.pitches ?? []),
      ...(opened?.items ?? []),
    ],
    [tiles, search, opened],
  );
  useEffect(() => {
    let cancelled = false;
    const next = posterTiles
      .filter((t) => !asked.current.has(t.pitch.mediaAssetId))
      .slice(0, POSTER_BATCH * 3);
    for (const tile of next) {
      asked.current.add(tile.pitch.mediaAssetId);
      source.authorize(tile.companyId, tile.pitch.mediaAssetId).then(
        (grant) => {
          const url = grant.posterUrl;
          if (cancelled || url === null) return;
          setPosters((known) => ({ ...known, [tile.pitch.mediaAssetId]: url }));
        },
        () => undefined,
      );
    }
    return () => {
      cancelled = true;
    };
  }, [posterTiles, source]);

  useEffect(() => {
    if (toast === null) return;
    const timer = setTimeout(() => setToast(null), 2400);
    return () => clearTimeout(timer);
  }, [toast]);

  const open = useCallback(
    (list: readonly ExploreTileDto[], index: number) => {
      const anchor = list[index];
      if (anchor === undefined) return;
      returnFocus.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null;
      setOpened({ items: [anchor], loading: true });
      try {
        window.history.pushState(
          { exploreOpen: anchor.pitch.mediaAssetId },
          "",
        );
      } catch {
        // History is a convenience; the back button works without it.
      }
      void source.loadRelated(anchor.pitch.mediaAssetId).then((result) => {
        setOpened((current) =>
          current === null ||
          current.items[0]?.pitch.mediaAssetId !== anchor.pitch.mediaAssetId
            ? current
            : {
                items: result.ok
                  ? [
                      anchor,
                      ...result.value.items.filter(
                        (i) => !hidden.has(i.companyId),
                      ),
                    ]
                  : [anchor],
                loading: false,
              },
        );
      });
    },
    [hidden, source],
  );

  const close = useCallback(() => {
    setOpened(null);
    const state: unknown = window.history.state;
    if (typeof state === "object" && state !== null && "exploreOpen" in state) {
      window.history.back();
    }
    returnFocus.current?.focus({ preventScroll: true });
  }, []);

  const arrived = useRef(false);
  useEffect(() => {
    if (openOnArrival === null || arrived.current) return;
    const list = search?.pitches ?? tiles;
    if (list === null || list.length === 0) return;
    arrived.current = true;
    open(list, openOnArrival.index);
  }, [openOnArrival, open, search, tiles]);

  useEffect(() => {
    const onPop = () => setOpened(null);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const onSave = useCallback(
    (item: ExploreTileDto) => {
      const was = saved.has(item.companyId);
      setSaved((known) => {
        const next = new Set(known);
        if (was) next.delete(item.companyId);
        else next.add(item.companyId);
        return next;
      });
      void source.save(item.companyId, !was).then((result) => {
        if (result.ok) return;
        setSaved((known) => {
          const next = new Set(known);
          if (was) next.add(item.companyId);
          else next.delete(item.companyId);
          return next;
        });
        setToast(result.message ?? "That did not save. Try again.");
      });
    },
    [saved, source],
  );

  const onHide = useCallback((item: ExploreTileDto) => {
    setHidden((known) => new Set(known).add(item.companyId));
    setOpened((current) =>
      current === null
        ? null
        : {
            ...current,
            items: current.items.filter(
              (i, at) => at === 0 || i.companyId !== item.companyId,
            ),
          },
    );
    setToast(`Hidden from Explore. Your mandate is unchanged.`);
  }, []);

  const shown = useMemo(() => {
    const list = (tiles ?? []).filter((t) => !hidden.has(t.companyId));
    if (topic.kind === "NEW") {
      const cutOff = Date.now() - FRESH_DAYS * 86_400_000;
      return list.filter((t) => Date.parse(t.postedAt) >= cutOff);
    }
    if (topic.kind === "SECTOR") {
      return list.filter((t) => t.sectorNodeIds.includes(topic.nodeId));
    }
    return list;
  }, [tiles, hidden, topic]);

  // Topic chips from the slate's own declared sectors, never from popularity.
  const sectorTopics = useMemo(() => {
    const out: { nodeId: string; label: string }[] = [];
    for (const tile of tiles ?? []) {
      const nodeId = tile.sectorNodeIds.find((id) => sectorLabels.has(id));
      if (nodeId === undefined || out.some((t) => t.nodeId === nodeId))
        continue;
      out.push({ nodeId, label: sectorLabels.get(nodeId) ?? "" });
      if (out.length >= 4) break;
    }
    return out;
  }, [tiles, sectorLabels]);

  const choose = (next: Topic) => {
    setTopic(next);
    if (next.kind === "FOR_YOU") setMode("FOR_YOU");
    if (next.kind === "EVERYTHING") setMode("EVERYTHING");
  };
  const topicOn = (t: Topic) =>
    t.kind === topic.kind &&
    (t.kind !== "SECTOR" ||
      (topic.kind === "SECTOR" && topic.nodeId === t.nodeId));

  const limited =
    limitedOrganisation === null ? null : (
      <ExploreLimitedBanner organisationName={limitedOrganisation} />
    );

  const feed =
    opened === null ? null : (
      <ExploreFeed
        items={opened.items}
        loadingMore={opened.loading}
        sectorLabels={sectorLabels}
        authorize={source.authorize}
        posters={posters}
        saved={saved}
        onSave={onSave}
        onHide={onHide}
        onClose={close}
        startOnRequest={startOnRequest}
        initialIndex={openOnArrival?.at ?? 0}
      />
    );
  const toastNode =
    toast === null ? null : (
      <div
        role="status"
        className="fixed bottom-[calc(var(--cq-bottom-nav-height)+20px)] left-1/2 z-(--cq-z-toast) -translate-x-1/2 rounded-(--cq-radius-md) bg-(--cq-text-primary) px-4 py-3 text-sm text-(--cq-canvas) shadow-(--cq-shadow-overlay) lg:bottom-6"
      >
        {toast}
      </div>
    );

  if (search !== null) {
    return (
      <>
        <ExploreSearchResults
          view={search}
          state={searchState}
          columns={columns}
          posters={posters}
          sectorLabels={sectorLabels}
          limited={limited}
          onOpen={open}
        />
        {feed}
        {toastNode}
      </>
    );
  }

  const topics: readonly (Topic & { readonly label: string })[] = [
    { kind: "FOR_YOU", label: "For you" },
    { kind: "EVERYTHING", label: "Everything" },
    { kind: "NEW", label: "New this week" },
    ...sectorTopics.map((s) => ({
      kind: "SECTOR" as const,
      nodeId: s.nodeId,
      label: s.label,
    })),
  ];

  return (
    <div className="flex max-w-[1240px] flex-col gap-3.5" data-explore>
      <ExploreSearchBar />
      <div
        role="group"
        aria-label="Topics"
        className="flex gap-2 overflow-x-auto py-0.5 [scrollbar-width:none]"
      >
        {topics.map((t) => (
          <button
            key={t.kind === "SECTOR" ? t.nodeId : t.kind}
            type="button"
            aria-pressed={topicOn(t)}
            onClick={() => choose(t)}
            className={`inline-flex min-h-9 shrink-0 items-center rounded-(--cq-radius-full) border px-3.5 text-sm whitespace-nowrap ${
              topicOn(t)
                ? "border-(--cq-text-primary) bg-(--cq-text-primary) text-(--cq-canvas)"
                : "border-(--cq-border) bg-(--cq-surface-raised) text-(--cq-text-secondary) hover:text-(--cq-text-primary)"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {error ? (
        <ExploreState
          kind="error"
          what="Explore"
          onRetry={() => setReload((n) => n + 1)}
        />
      ) : tiles === null || columns === null || forceLoading ? (
        <ExploreGridSkeleton columns={columns ?? 2} />
      ) : tiles.length === 0 ? (
        <ExploreState
          kind="empty"
          {...(mode === "FOR_YOU"
            ? { onShowEverything: () => choose({ kind: "EVERYTHING" }) }
            : {})}
        />
      ) : (
        <>
          {limited}
          <ExploreGrid
            tiles={shown}
            posters={posters}
            columns={columns}
            sectorLabels={sectorLabels}
            onOpen={(index) => open(shown, index)}
          />
          {cursor === null ? null : (
            <div
              ref={sentinel}
              aria-hidden="true"
              className="h-px"
              data-explore-sentinel
            />
          )}
          {loadingMore ? (
            <p
              role="status"
              className="cq-body-sm text-center text-(--cq-text-secondary)"
            >
              Loading more pitches…
            </p>
          ) : null}
          {upToDate ? (
            <ExploreEndNote
              mode={mode}
              onKeepBrowsing={() => choose({ kind: "EVERYTHING" })}
            />
          ) : null}
        </>
      )}
      {feed}
      {toastNode}
    </div>
  );
}
