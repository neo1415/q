import type { Metadata } from "next";
import Link from "next/link";

import { buttonClassName } from "@capital-q/ui/button";

import { StatusPage } from "@/components/status-page";

export const metadata: Metadata = {
  title: "Not found",
  robots: { index: false, follow: false },
};

/** Any address Capital Q does not have (ux-direction §13). */
export default function NotFound() {
  // R3: the navigation lifecycle reads this marker, so a move that lands
  // here is reported as a page that isn't there, never as opened.
  return (
    <div data-q-not-found className="contents">
      <StatusPage
        notice="ERROR:NOT_FOUND"
        title="This page isn't here."
        // A signed-out visitor reached by a shared link has no account to
        // reassure about (QA F-54), so the line speaks to everyone.
        description="The address may be mistyped, or the page may have moved."
      >
        <Link href="/home" className={buttonClassName("primary")}>
          Go to Home
        </Link>
        <Link href="/discover" className={buttonClassName("secondary")}>
          Go to Discover
        </Link>
      </StatusPage>
    </div>
  );
}
