import { ExploreGridSkeleton } from "@/features/explore/explore-grid";

/**
 * Explore while it loads (P9): the page's own frame -- search, topics and
 * the mosaic's own reserved boxes -- instead of a spinner.
 */
export default function ExploreLoading() {
  return (
    <div className="flex w-full flex-col gap-4 px-4 pt-4 pb-[calc(var(--cq-bottom-nav-height)+88px)] sm:px-6 lg:px-8 lg:pt-7 lg:pb-16">
      <h1 className="cq-title-md lg:sr-only">Explore</h1>
      <div
        className="flex max-w-[1240px] flex-col gap-3.5"
        aria-busy="true"
        aria-label="Loading pitches"
      >
        <div className="h-12 w-full border border-(--cq-border) bg-(--cq-surface-raised)" />
        <div className="flex gap-2 overflow-hidden py-0.5">
          {[72, 96, 120, 84, 104].map((width) => (
            <div
              key={width}
              className="h-9 shrink-0 border border-(--cq-border) bg-(--cq-surface-raised)"
              style={{ width }}
            />
          ))}
        </div>
        <ExploreGridSkeleton />
      </div>
    </div>
  );
}
