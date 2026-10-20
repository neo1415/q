"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import { registerClientPrefetch, registerShellRouter } from "../client-actions";
import { registerNavigationViewer, type NavigationViewer } from "./app-routes";
import { navigationFailureMessage } from "./navigation-lifecycle";
import { currentManifest } from "../manifest";
import {
  noteRoute,
  onNavigationOutcome,
  onUiActReport,
  type UiActReport,
} from "../ui-act-controller";
import { startReceiptReporter } from "./receipt-reporter";

/**
 * RECOVERY-2026-10 (C2/C3): the shell's part of Q's control of the app,
 * mounted by every signed-in layout (the app shell and onboarding: R3, so
 * Q's moves have a client router and a verified receipt on every
 * authenticated screen).
 *
 * - The route trail: each route this tab shows, so a chained act waits for
 *   the page Q moved to, and "back" knows whether there is a page of the
 *   app behind them.
 * - The receipt reporter: every act's receipt to the Q API.
 * - The notice: when an act did not happen, the person reads that at once,
 *   in plain words, whatever Q's answer said while it was still on its way.
 */
export function QControlRuntime({
  viewer,
}: {
  /**
   * Who is signed in, as the shell knows it: lets a move to a page that
   * isn't theirs fail at VALIDATED with a plain reason. Absent outside the
   * app shell (onboarding); the server authorises every page regardless.
   */
  readonly viewer?: NavigationViewer | undefined;
} = {}) {
  const viewerKind = viewer?.kind;
  const viewerAdmin = viewer?.admin;
  useEffect(() => {
    registerNavigationViewer(
      viewerKind === undefined
        ? null
        : { kind: viewerKind, admin: viewerAdmin === true },
    );
    return () => registerNavigationViewer(null);
  }, [viewerKind, viewerAdmin]);

  const pathname = usePathname();
  const search = useSearchParams();
  const query = search.toString();
  useEffect(() => {
    noteRoute(query.length > 0 ? `${pathname}?${query}` : pathname);
  }, [pathname, query]);

  useEffect(() => startReceiptReporter(currentManifest), []);

  // The fast path prefetches the page a partial transcript points at, so
  // the move when the sentence ends costs nothing.
  const router = useRouter();
  useEffect(() => {
    registerClientPrefetch((path) => router.prefetch(path));
    // The tab's own router for Q's moves, whatever page is mounted: a move
    // never falls back to a full page load (it would end a voice call).
    registerShellRouter((path) => router.push(path));
    return () => {
      registerClientPrefetch(null);
      registerShellRouter(null);
    };
  }, [router]);

  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const show = (text: string | null) => {
      if (text === null) return;
      setNotice(text);
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => setNotice(null), NOTICE_MS);
    };
    const stop = onUiActReport((report) => show(noticeOf(report)));
    // A move Q made that did not happen is said too, with its reason,
    // never left as if done. One replaced by a newer move is not news.
    const stopMoves = onNavigationOutcome((outcome) =>
      show(
        outcome.status === "FAILED" && outcome.reason !== "SUPERSEDED"
          ? navigationFailureMessage(outcome.reason)
          : null,
      ),
    );
    return () => {
      stop();
      stopMoves();
      if (timer !== null) clearTimeout(timer);
    };
  }, []);

  return (
    <div
      role="status"
      aria-live="polite"
      data-q-self
      className={
        notice === null
          ? "sr-only"
          : "fixed inset-x-4 bottom-24 z-(--cq-z-toast) mx-auto w-fit max-w-[min(32rem,calc(100vw-2rem))] rounded-md border border-(--cq-border-subtle) bg-(--cq-surface-raised) px-4 py-2 cq-caption text-(--cq-text-secondary) shadow-(--cq-shadow-overlay)"
      }
    >
      {notice}
    </div>
  );
}

const NOTICE_MS = 6_000;

/** What the person reads when an act did not happen; null when it did. */
export function noticeOf(report: UiActReport): string | null {
  switch (report.receipt.status) {
    case "DONE":
      return null;
    case "TARGET_MISSING":
      return report.intent.act === "SELECT_ITEM"
        ? "Q couldn't find that item in the list on this page."
        : "Q couldn't find that on this page.";
    case "NOT_APPLICABLE":
      return report.intent.act === "BACK"
        ? "There's no earlier page here to go back to."
        : "Q can't do that with this part of the page.";
    case "FAILED":
      return "That didn't work on this page. Try it yourself, or ask Q again.";
  }
}
