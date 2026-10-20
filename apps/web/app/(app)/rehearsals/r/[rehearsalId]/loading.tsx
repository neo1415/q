import { PageContainer } from "@/components/app-shell/page-container";

/** While Q writes the review: the shape of the page, and what is happening. */
export default function Loading() {
  return (
    <PageContainer>
      <div
        aria-busy="true"
        className="mx-auto flex w-full max-w-3xl flex-col gap-6"
      >
        <div className="h-4 w-64 animate-pulse rounded-(--cq-radius-sm) bg-(--cq-surface-subtle) motion-reduce:animate-none" />
        <p className="cq-title-lg text-(--cq-text-primary)">
          Q is reviewing your rehearsal…
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          {[0, 1, 2, 3].map((key) => (
            <div
              key={key}
              className="h-20 animate-pulse rounded-(--cq-radius-md) bg-(--cq-surface-subtle) motion-reduce:animate-none"
            />
          ))}
        </div>
      </div>
    </PageContainer>
  );
}
