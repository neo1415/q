/**
 * Discover while it loads (Discover v2): the feed's own shape, never a
 * sentence. The stage, the rail and the caption sit exactly where the real
 * ones will, so nothing moves when they arrive (CLS). A slow shimmer runs
 * across the poster only, and stops under reduced motion.
 */
const RAIL = ["profile", "a", "b", "c", "d", "e", "f"] as const;

export function FeedSkeleton({
  label = "Loading companies",
}: {
  readonly label?: string;
}) {
  return (
    <div
      className="cq-stage cq-feed cq-feed-skeleton"
      data-feed-immersive
      data-feed-loading
      aria-busy="true"
    >
      <span className="sr-only" role="status">
        {label}
      </span>
      <div className="cq-feed-stage" aria-hidden="true">
        <div className="cq-feed-media">
          <div className="cq-skeleton cq-skeleton-poster" />
        </div>
        <div className="cq-skeleton-rail">
          {RAIL.map((key) => (
            <span key={key} className="cq-skeleton-rail-item">
              <span
                className={`cq-skeleton cq-skeleton-dot ${key === "profile" ? "cq-skeleton-dot-lg" : ""}`}
              />
              <span className="cq-skeleton cq-skeleton-bar cq-skeleton-bar-xs" />
            </span>
          ))}
        </div>
        <div className="cq-feed-overlay cq-skeleton-caption">
          <span className="cq-skeleton cq-skeleton-bar cq-skeleton-bar-title" />
          <span className="cq-skeleton cq-skeleton-bar cq-skeleton-bar-line" />
          <span className="cq-skeleton cq-skeleton-bar cq-skeleton-bar-short" />
          <span className="cq-skeleton-panel-only">
            <span className="cq-skeleton cq-skeleton-bar cq-skeleton-bar-line" />
            <span className="cq-skeleton cq-skeleton-bar cq-skeleton-bar-line" />
            <span className="cq-skeleton cq-skeleton-bar cq-skeleton-bar-short" />
            <span className="cq-skeleton-buttons">
              <span className="cq-skeleton cq-skeleton-pill" />
              <span className="cq-skeleton cq-skeleton-pill cq-skeleton-pill-sm" />
            </span>
          </span>
        </div>
      </div>
    </div>
  );
}
