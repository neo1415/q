"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

import { buttonClassName } from "@capital-q/ui/button";
import { ArrowLeft, ICON_SIZE } from "@capital-q/ui/icons";

/**
 * "Back" for an owner on their own company page (founder 2026-10-08: "Back
 * to Discover" made no sense there -- they came from Home, Capital or Q).
 * Goes back to where they came from when that was inside Capital Q, and to
 * the fallback (Home) otherwise. A real link, so it works without script.
 */
export function BackLink({ fallbackHref }: { readonly fallbackHref: string }) {
  const router = useRouter();
  return (
    <Link
      href={fallbackHref}
      data-back-link
      className={buttonClassName("quiet", "compact", "self-start")}
      onClick={(event) => {
        if (!cameFromHere()) return;
        event.preventDefault();
        router.back();
      }}
    >
      <ArrowLeft size={ICON_SIZE.compact} aria-hidden="true" />
      Back
    </Link>
  );
}

/** Only a same-origin previous page; an outside one goes to the fallback. */
function cameFromHere(): boolean {
  if (window.history.length <= 1 || document.referrer === "") return false;
  try {
    return new URL(document.referrer).origin === window.location.origin;
  } catch {
    return false;
  }
}
