"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";

import { GlobalQProvider } from "@/components/app-shell/global-q";
import { DocumentReadyCenter } from "@/features/documents/document-ready-center";
import { demoTop } from "@/features/q/answer-canvas-fixtures";
import { navigationHeardFor } from "@/features/q/control/fast-navigation";
import { QControlRuntime } from "@/features/q/control/q-control-runtime";
import { showInModal } from "@/features/q/control/show-store";
import { NO_SUBJECT } from "@/features/q/q-subject";
import { useQSession } from "@/features/q/q-session";

/**
 * The harness's strip: the typed line (the Q session's own `ask`, as the
 * composer sends it), the pages, and a stand-in for an answer that shows
 * cards (what Q's answer does off the Q page).
 */
function Strip() {
  const session = useQSession();
  const [text, setText] = useState("");
  useEffect(() => {
    const own = window as Window & {
      cqHarnessShowCards?: (title: string) => void;
      cqHarnessHeard?: (text: string) => void;
    };
    // A voice line's final transcript, as every voice line hands it over.
    own.cqHarnessHeard = (said) => {
      void navigationHeardFor("harness-voice", said);
    };
    own.cqHarnessShowCards = (title) =>
      showInModal({
        key: `harness-${String(Date.now())}`,
        title,
        text: "Three companies fit your mandate best. **Norrland Grid** leads on mandate fit; the other two are close behind.",
        blocks: [demoTop(3)],
      });
  }, []);
  return (
    <div
      className="flex flex-col gap-2 border-b border-(--cq-border) p-3"
      data-harness-strip
    >
      <nav aria-label="Harness pages" className="flex flex-wrap gap-3">
        <Link href="/dev/instant-nav" data-harness-link="feed">
          Feed page
        </Link>
        <Link
          href="/dev/instant-nav/company/7b1f7e2a-0c1d-4b5e-9a7f-2b3c4d5e6f72"
          data-harness-link="company"
        >
          Company page
        </Link>
        <Link href="/dev/instant-nav/work" data-harness-link="work">
          Work page
        </Link>
      </nav>
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          const said = text;
          setText("");
          void session.q.ask(said);
        }}
      >
        <label className="sr-only" htmlFor="harness-ask">
          Ask Q
        </label>
        <input
          id="harness-ask"
          className="min-h-11 flex-1 rounded-(--cq-radius-md) border border-(--cq-border) bg-(--cq-surface) px-3 text-(--cq-text-primary)"
          value={text}
          onChange={(event) => setText(event.target.value)}
          data-harness-ask
        />
      </form>
    </div>
  );
}

export function InstantNavShell({
  children,
}: {
  readonly children: ReactNode;
}) {
  return (
    <GlobalQProvider subject={NO_SUBJECT} connected={false}>
      <QControlRuntime />
      {/* The app shell's one document viewer, as on every signed-in page. */}
      <DocumentReadyCenter connected={false} />
      <div className="flex min-h-dvh flex-col bg-(--cq-canvas) text-(--cq-text-primary)">
        <Strip />
        <main className="flex min-h-0 flex-1 flex-col">{children}</main>
      </div>
    </GlobalQProvider>
  );
}
