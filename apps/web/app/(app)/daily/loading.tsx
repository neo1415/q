/**
 * The Q Daily while it loads: the newspaper's own shape (masthead, lead,
 * two columns), quiet and still under reduced motion.
 */
export default function Loading() {
  return (
    <div
      className="mx-auto flex w-full max-w-(--cq-layout-content) flex-col gap-8 px-4 py-6 motion-safe:animate-pulse"
      aria-busy="true"
      aria-label="Loading The Q Daily"
      data-daily-loading
    >
      <div className="flex flex-col items-center gap-3">
        <div className="h-12 w-64 rounded-sm bg-(--cq-surface-strong)" />
        <div className="h-4 w-full max-w-xl rounded-sm bg-(--cq-surface-subtle)" />
      </div>
      <div className="grid gap-5 md:grid-cols-[3fr_2fr]">
        <div className="flex flex-col gap-3">
          <div className="h-9 w-full rounded-sm bg-(--cq-surface-strong)" />
          <div className="h-9 w-4/5 rounded-sm bg-(--cq-surface-strong)" />
          <div className="h-4 w-full rounded-sm bg-(--cq-surface-subtle)" />
          <div className="h-4 w-11/12 rounded-sm bg-(--cq-surface-subtle)" />
        </div>
        <div className="aspect-[16/9] w-full rounded-sm bg-(--cq-surface-subtle)" />
      </div>
      <div className="grid gap-8 md:grid-cols-2">
        {[0, 1].map((column) => (
          <div key={column} className="flex flex-col gap-3">
            <div className="h-6 w-3/4 rounded-sm bg-(--cq-surface-strong)" />
            <div className="h-4 w-full rounded-sm bg-(--cq-surface-subtle)" />
            <div className="h-4 w-5/6 rounded-sm bg-(--cq-surface-subtle)" />
          </div>
        ))}
      </div>
    </div>
  );
}
