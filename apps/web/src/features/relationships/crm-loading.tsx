import { PageContainer } from "@/components/app-shell/page-container";

/**
 * Loading shapes for the CRM (research 2026-10-15 §3.4): each block at its
 * final size, so nothing moves when the page arrives (CLS 0). No spinner,
 * no text that changes; the pulse stops under reduced motion.
 */
const bar =
  "block animate-pulse bg-(--cq-surface-strong) motion-reduce:animate-none";

function Rows({
  count,
  label,
}: {
  readonly count: number;
  readonly label: string;
}) {
  return (
    <ul
      className="flex flex-col divide-y divide-(--cq-border-subtle) border-y border-(--cq-border-subtle)"
      aria-hidden="true"
      data-loading-rows={label}
    >
      {Array.from({ length: count }, (_, n) => (
        <li key={n} className="flex min-h-16 items-center gap-3 py-3">
          <span className={`${bar} size-8 flex-none rounded-full`} />
          <span className="flex flex-1 flex-col gap-2">
            <span className={`${bar} h-3.5 w-2/5`} />
            <span className={`${bar} h-3 w-3/5`} />
          </span>
          <span className={`${bar} h-8 w-20 flex-none max-sm:hidden`} />
        </li>
      ))}
    </ul>
  );
}

/** The CRM header and tabs, then rows: Overview and Pipeline alike. */
export function HubLoading() {
  return (
    <PageContainer className="flex flex-col gap-8">
      <div
        className="flex flex-col gap-2"
        role="status"
        aria-busy="true"
        aria-label="Loading your CRM"
      >
        {/* The h1's line box and the tab strip at their real heights. */}
        <span className="flex min-h-8 items-center">
          <span className={`${bar} h-7 w-56`} />
        </span>
        <span className="flex min-h-11 items-end gap-1 border-b border-(--cq-border-subtle)">
          <span className={`${bar} mb-3 ml-3 h-3.5 w-16`} />
          <span className={`${bar} mb-3 ml-6 h-3.5 w-16`} />
        </span>
      </div>
      <div className="flex flex-col gap-2">
        <span className={`${bar} h-5 w-28`} />
        <Rows count={5} label="queue" />
      </div>
    </PageContainer>
  );
}

/** A relationship record: back link, name and state line, tabs, two columns. */
export function RecordLoading() {
  return (
    <PageContainer>
      <div
        className="flex flex-col gap-6"
        role="status"
        aria-busy="true"
        aria-label="Loading the relationship"
      >
        <span className="flex min-h-11 items-center">
          <span className={`${bar} h-4 w-36`} />
        </span>
        <div className="flex items-center gap-4">
          <span className={`${bar} size-14 flex-none`} />
          <span className="flex flex-1 flex-col gap-2.5">
            <span className={`${bar} h-7 w-1/2`} />
            <span className={`${bar} h-3.5 w-1/3`} />
          </span>
        </div>
        <span className={`${bar} h-4 w-2/3 max-w-md`} />
        <span className="flex min-h-11 items-end gap-1 border-b border-(--cq-border-subtle)">
          <span className={`${bar} mb-3 ml-3 h-3.5 w-16`} />
          <span className={`${bar} mb-3 ml-6 h-3.5 w-16`} />
        </span>
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="flex flex-col gap-3 border-t border-(--cq-border-subtle) pt-5">
            <span className={`${bar} h-5 w-32`} />
            <Rows count={3} label="record" />
          </div>
          <div className="flex flex-col gap-3 border-t border-(--cq-border-subtle) pt-5 max-lg:order-first">
            <span className={`${bar} h-5 w-16`} />
            <span className={`${bar} h-11 w-full`} />
          </div>
        </div>
      </div>
    </PageContainer>
  );
}
