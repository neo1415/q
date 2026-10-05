import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { CanvasPreview } from "./canvas-preview";

export const metadata: Metadata = {
  title: "Answer canvas",
  robots: { index: false },
};

/**
 * The answer canvas, the Board and the answer chip with fictional
 * fixtures, for design review against the approved mockups and for the
 * screenshot checks (C1-C7). Development only; a production build serves
 * it only when CQ_DEV_PREVIEW=1 is set on that server (local screenshots).
 *
 * `?state=top|overview|compare|research|board|board-empty|chip`,
 * `&n=1|3|5|10`, `&focus=0..9`, `&theme=light|dark`.
 */
export default async function CanvasPreviewPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (
    process.env.NODE_ENV === "production" &&
    process.env["CQ_DEV_PREVIEW"] !== "1"
  ) {
    notFound();
  }
  const params = await searchParams;
  const one = (key: string) => {
    const value = params[key];
    return Array.isArray(value) ? value[0] : value;
  };
  const n = Number(one("n") ?? "3");
  const focus = Number(one("focus") ?? "0");
  return (
    <CanvasPreview
      state={one("state") ?? "top"}
      n={Number.isFinite(n) ? n : 3}
      focus={Number.isFinite(focus) ? focus : 0}
      theme={one("theme") === "dark" ? "dark" : "light"}
    />
  );
}
