/**
 * Explore while it loads (P9): the page's own frame -- search, topics and
 * poster boxes in the grid's column counts -- instead of a spinner.
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
        <div className="h-12 w-full rounded-(--cq-radius-full) border border-(--cq-border) bg-(--cq-surface-raised)" />
        <div className="flex gap-2 overflow-hidden py-0.5">
          {[72, 96, 120, 84, 104].map((width) => (
            <div
              key={width}
              className="h-9 shrink-0 rounded-(--cq-radius-full) border border-(--cq-border) bg-(--cq-surface-raised)"
              style={{ width }}
            />
          ))}
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 min-[1400px]:grid-cols-5">
          {[1.5, 1.2, 1.3, 1.6, 1.4, 1.2, 1.5, 1.3, 1.4, 1.6].map(
            (ratio, index) => (
              <div
                key={index}
                className="w-full rounded-xl bg-(--cq-surface-strong) motion-safe:animate-pulse"
                style={{ aspectRatio: `1 / ${String(ratio)}` }}
              />
            ),
          )}
        </div>
      </div>
    </div>
  );
}
