import { PageContainer } from "@/components/app-shell/page-container";

/** The list's shape while it loads: the same rows, no spinner. */
export default function RelationshipsLoading() {
  return (
    <PageContainer className="flex flex-col gap-4">
      <h1 className="cq-title-lg text-(--cq-text-primary)">Relationships</h1>
      <div className="h-12 rounded-xl border border-(--cq-border) bg-(--cq-surface-raised)" />
      <div className="h-11 border-b border-(--cq-border-subtle)" />
      <ul
        className="flex flex-col gap-2"
        aria-busy="true"
        aria-label="Loading relationships"
      >
        {[0, 1, 2, 3, 4].map((n) => (
          <li
            key={n}
            className="flex items-center gap-3 rounded-xl border border-(--cq-border-subtle) bg-(--cq-surface-raised) p-3.5"
          >
            <span className="size-10 shrink-0 animate-pulse rounded-md bg-(--cq-surface-strong) motion-reduce:animate-none" />
            <span className="flex flex-1 flex-col gap-2">
              <span className="h-3.5 w-1/2 animate-pulse rounded bg-(--cq-surface-strong) motion-reduce:animate-none" />
              <span className="h-2.5 w-1/3 animate-pulse rounded bg-(--cq-surface-strong) motion-reduce:animate-none" />
            </span>
          </li>
        ))}
      </ul>
    </PageContainer>
  );
}
