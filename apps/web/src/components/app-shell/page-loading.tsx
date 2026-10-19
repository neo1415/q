"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { PageContainer } from "@/components/app-shell/page-container";
import { ParticleLoader } from "@/features/q-swarm/particle-loader";

/**
 * Every page of the app, while it loads: the page's frame (a heading and
 * a few blocks in the same container every page uses), with Q's swarm
 * beside the heading (founder direction 2026-09-29: the loading state is
 * Q's swarm). P9: a centred spinner on an empty page read as "stuck" on a
 * slow line; the frame shows where the page will be, and nothing moves
 * when it arrives in the same container. Still under reduced motion.
 */
export function PageLoading() {
  return (
    <PageContainer className="flex flex-col gap-5">
      <div className="flex items-center gap-3">
        <ParticleLoader size={28} />
        <div className="h-7 w-48 bg-(--cq-surface-strong) motion-safe:animate-pulse" />
      </div>
      <div
        className="flex flex-col gap-3"
        aria-hidden="true"
        data-page-skeleton
      >
        <div className="h-4 w-full max-w-xl bg-(--cq-surface-subtle)" />
        {[0, 1, 2].map((block) => (
          <div
            key={block}
            className="h-24 w-full border border-(--cq-border-subtle) bg-(--cq-surface-raised) motion-safe:animate-pulse"
          />
        ))}
      </div>
    </PageContainer>
  );
}

/**
 * A route's own loading shape for its index page only (instant tabs
 * 2026-10-18). A `loading.tsx` also covers the pages nested under its
 * route (`/rehearsals/live`, `/gateq/pack`), which are not that tab: those
 * keep the app's frame rather than another page's header and tabs.
 */
export function IndexLoading({
  path,
  children,
}: {
  readonly path: string;
  readonly children: ReactNode;
}) {
  const at = usePathname();
  if (at !== path) return <PageLoading />;
  return children;
}
