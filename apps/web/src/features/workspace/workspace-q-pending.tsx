"use client";

import { useT } from "@/features/i18n/language";
import {
  DEFAULT_GREETING,
  startersOf,
  type QStarter,
} from "@/features/q/q-starter-list";

const NO_STARTERS: readonly QStarter[] = [];
const NO_SUGGESTIONS: readonly string[] = [];

/**
 * The Q pane while its conversation's code arrives (no spinner).
 *
 * LCP (production 21 Nov 2026; owner approval 26 Nov): the empty pane's
 * greeting is the largest paint on /home and /settings, and it waited for
 * hydration and then for the conversation's code. The pane's first HTML now
 * carries the same greeting, in the same place and with the same classes as
 * the panel's empty home (q-conversation.tsx, `data-q-home-empty`), so it
 * paints with the page and the panel, when it mounts, replaces it with an
 * identical line rather than moving it. The top line, the composer and the
 * starter rows are held as invisible shapes of their real size so the
 * greeting sits where the panel will draw it. Nothing here is interactive:
 * the controls are the panel's. A returning person with an open thread may
 * see the greeting briefly before their thread (an accepted trade-off).
 */
export function WorkspaceQPending({
  awaitingGreeting = false,
  greeting,
  starters = NO_STARTERS,
  suggestions = NO_SUGGESTIONS,
  connected = false,
}: {
  /**
   * The layout's own fallback, before the server has resolved who is here:
   * the greeting's line is held, empty, so the named greeting that streams
   * in next never replaces a different sentence ("…today?" -> "…today, Ada?").
   */
  readonly awaitingGreeting?: boolean | undefined;
  readonly greeting?: string | undefined;
  readonly starters?: readonly QStarter[] | undefined;
  readonly suggestions?: readonly string[] | undefined;
  readonly connected?: boolean | undefined;
}) {
  const t = useT();
  // The panel shows starters only when Q is connected; the same rows here.
  const shown = connected ? startersOf(starters, suggestions) : NO_STARTERS;
  return (
    <div className="cq-stage cq-q-pane" aria-busy="true" data-q-pane-pending>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {/* The top line's height: the Q | Chat switch and its buttons. */}
        <div
          className="cq-q-top-line flex flex-none items-center justify-between gap-2 px-3 pt-3 pb-2 sm:px-6"
          aria-hidden="true"
        >
          <span className="block h-9 max-lg:h-11" />
        </div>
        <div className="cq-stage-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 sm:px-8">
          <div className="cq-arrival mx-auto flex min-h-full w-full max-w-3xl flex-col items-center justify-center gap-5 py-6">
            {awaitingGreeting ? (
              <p
                className="cq-title-lg invisible m-0 text-center"
                aria-hidden="true"
              >
                &nbsp;
              </p>
            ) : (
              <p
                className="cq-title-lg m-0 text-center text-balance text-(--cq-text-primary)"
                data-q-greeting
              >
                {t(greeting ?? DEFAULT_GREETING)}
              </p>
            )}
            {/* The composer's shape (QComposer, variant "pill"). */}
            <div className="w-full max-w-3xl" aria-hidden="true">
              <div className="cq-q-pill border border-(--cq-border) bg-(--cq-surface-raised) px-2 py-1.5 shadow-(--cq-shadow-sm)">
                <div className="h-11" />
              </div>
            </div>
            {shown.length === 0 ? null : (
              <div
                className="invisible w-full max-w-3xl px-2"
                aria-hidden="true"
              >
                <div className="flex w-full flex-col gap-0.5">
                  {shown.map((starter) => (
                    <span key={starter.id} className="cq-q-starter">
                      &nbsp;
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
