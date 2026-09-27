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
  return (
    <StatusPage
      title="This page isn't here."
      description="The address may be mistyped, or the page may have moved. Nothing is wrong with your account."
    >
      <Link href="/home" className={buttonClassName("primary")}>
        Go to Home
      </Link>
      <Link href="/discover" className={buttonClassName("secondary")}>
        Go to Discover
      </Link>
    </StatusPage>
  );
}
