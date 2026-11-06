"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Suspense, type ReactNode } from "react";

import { GlobalQProvider } from "@/components/app-shell/global-q";
import { arrive, markQMove } from "@/features/q/control/arrival";
import { QArrival } from "@/features/q/control/q-arrival";
import { NO_SUBJECT } from "@/features/q/q-subject";

import { HARNESS_ITEM, HARNESS_MESSAGE } from "./fixtures";

const PAGES = [
  ["board", `/dev/deep-links/board?item=${HARNESS_ITEM}`],
  ["thread", `/dev/deep-links/thread?message=${HARNESS_MESSAGE}`],
  ["section", "/dev/deep-links/sections#section-commitments"],
] as const;

/**
 * Q's move, as the app makes it once the lifecycle reports VERIFIED
 * (q-arrival.tsx): the router's push, then the entry marked as Q's and
 * the arrival with focus. /dev paths are not app routes, so the lifecycle
 * itself (which validates against them) is exercised by the unit tests.
 */
function useQMove(): (path: string) => void {
  const router = useRouter();
  return (path) => {
    const from = window.location.href;
    const want = new URL(path, window.location.origin);
    router.push(path);
    const landed = () => {
      if (window.location.pathname !== want.pathname) {
        window.setTimeout(landed, 30);
        return;
      }
      markQMove(from);
      void arrive({ byQ: true });
    };
    landed();
  };
}

function Strip() {
  const move = useQMove();
  return (
    <div
      className="flex flex-col gap-2 border-b border-(--cq-border) p-3"
      data-harness-strip
    >
      <nav aria-label="Harness pages" className="flex flex-wrap gap-3">
        <Link href="/dev/deep-links" data-harness-link="hub">
          Hub
        </Link>
        {PAGES.map(([key, href]) => (
          <Link key={key} href={href} data-harness-link={key}>
            {key}
          </Link>
        ))}
      </nav>
      <div className="flex flex-wrap gap-2">
        {PAGES.map(([key, href]) => (
          <button
            key={key}
            type="button"
            className="min-h-11 px-3"
            onClick={() => move(href)}
            data-harness-q-move={key}
          >
            Q opens {key}
          </button>
        ))}
      </div>
      <textarea
        aria-label="Ask Q"
        className="min-h-11 border border-(--cq-border) p-2"
        data-harness-composer
      />
    </div>
  );
}

export function DeepLinkShell({ children }: { readonly children: ReactNode }) {
  return (
    <GlobalQProvider subject={NO_SUBJECT} connected={false}>
      <div className="flex min-h-dvh flex-col bg-(--cq-canvas)">
        <Strip />
        <main id="main" className="flex min-h-0 flex-1 flex-col p-4">
          {children}
        </main>
        <Suspense fallback={null}>
          <QArrival />
        </Suspense>
      </div>
    </GlobalQProvider>
  );
}
