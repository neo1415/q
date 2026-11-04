"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef } from "react";

import { buttonClassName } from "@capital-q/ui/button";
import { ArrowLeft, ICON_SIZE } from "@capital-q/ui/icons";
import { useT } from "@/features/i18n/language";

import { canGoBack, markInAppNavigation, markLanding } from "./back-history";

/**
 * "Back" on an interior page (founder 2026-10-08; client feedback UX-04,
 * 2026-11-04). Goes back to where the person came from when that was
 * inside Capital Q, and to the fallback (the page's parent) otherwise: a
 * deep link, a new tab or an outside referrer never leaves Capital Q or
 * loops. A real link, so it works without script. Never on a root page.
 */
export function BackLink({
  fallbackHref,
  label,
}: {
  readonly fallbackHref: string;
  /** Defaults to "Back"; a parent's name reads better where it is fixed. */
  readonly label?: string | undefined;
}) {
  const t = useT();
  const router = useRouter();
  return (
    <Link
      href={fallbackHref}
      data-back-link
      className={buttonClassName("quiet", "compact", "self-start")}
      onClick={(event) => {
        if (!canGoBack(browserHistory())) return;
        event.preventDefault();
        router.back();
      }}
    >
      <ArrowLeft size={ICON_SIZE.compact} aria-hidden="true" />
      {label ?? t("Back")}
    </Link>
  );
}

/**
 * Mounted once in the signed-in layout: notes that a client-side move has
 * happened, which `document.referrer` never reflects (it keeps the page
 * the tab was first loaded from), so Back can use the real history.
 */
export function InAppNavigationMark() {
  const pathname = usePathname();
  const first = useRef(pathname);
  useEffect(() => {
    markLanding(first.current);
    if (pathname !== first.current) markInAppNavigation();
  }, [pathname]);
  return null;
}

function browserHistory() {
  return {
    length: window.history.length,
    referrer: document.referrer,
    origin: window.location.origin,
    pathname: window.location.pathname,
  };
}
