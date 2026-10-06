import type { ReactNode } from "react";

import { buttonClassName } from "@capital-q/ui/button";

import type { ContextScope } from "@capital-q/ui/tokens";

import { DocumentReadyCenter } from "@/features/documents/document-ready-center";
import { QDock } from "@/features/q-dock";
import { NO_SUBJECT, type QSubject } from "@/features/q/q-subject";

import { VerifyNudgeLink } from "@/features/verification/verify-nudge";
import type { VerifyNudge } from "@/features/verification/verify-state";
import { WakeIndicator } from "@/features/wake/wake-indicator";

import { AppHeader } from "./app-header";
import { DesktopSidebar } from "./desktop-sidebar";
import { FictionalNames } from "./fictional-names";
import { GlobalQProvider } from "./global-q";
import { MobileNavigation } from "./mobile-navigation";
import { NetworkStatus } from "./network-status";

/**
 * The workspace cue the shell shows: which organisation context this person
 * is acting in, resolved on the server. `unset` is an honest answer for a
 * person with no company and no investor organisation yet; the shell never
 * invents one (CQ-PRE-REC-001 §12).
 */
export type ShellContext = {
  readonly scope: ContextScope;
  readonly label?: string | undefined;
  /** A platform admin (WORK-58): the sidebar adds the Admin group. */
  readonly admin?: boolean | undefined;
};

const UNSET: ShellContext = { scope: "unset" };

/**
 * The application shell. Server-rendered structure; only the pieces that
 * need the browser (current route, network state) are client components.
 *
 * Mobile: header → main → bottom navigation. Desktop: sidebar + workspace.
 * `main` carries the id the skip link targets.
 */
export function AppShell({
  children,
  context = UNSET,
  subject = NO_SUBJECT,
  qConnected = false,
  onboarding = null,
  verifyNudge = null,
}: {
  readonly children: ReactNode;
  readonly context?: ShellContext | undefined;
  /** What Q looks at from any page: the person's own subject, server-resolved. */
  readonly subject?: QSubject | undefined;
  /** False when this build has no Q API. */
  readonly qConnected?: boolean | undefined;
  /**
   * Where their unfinished onboarding continues, or null once it is done.
   * While set, the shell offers no navigation but the way back to Q.
   */
  readonly onboarding?: string | null | undefined;
  /** ADMIN-4: "Verify you and <organisation>" while either claim is unverified. */
  readonly verifyNudge?: VerifyNudge | null | undefined;
}) {
  if (onboarding !== null) {
    return (
      <GlobalQProvider subject={subject} connected={qConnected}>
        <div className="cq-shell-body">
          <header className="flex min-h-14 items-center justify-between gap-3 border-b border-(--cq-border-subtle) px-4">
            <span className="cq-label text-(--cq-text-primary)">Capital Q</span>
            <a href={onboarding} className={buttonClassName("primary")}>
              Continue with Q
            </a>
          </header>
          <WakeIndicator />
          <main id="main" className="cq-shell-main">
            {children}
          </main>
        </div>
        {/* DOCS: a deck made during setup still pops up when it is ready. */}
        <DocumentReadyCenter connected={qConnected} />
      </GlobalQProvider>
    );
  }
  return (
    <GlobalQProvider subject={subject} connected={qConnected} dock={<QDock />}>
      <div className="cq-shell">
        <a
          href="#main"
          className="sr-only z-(--cq-z-toast) rounded-md bg-(--cq-surface-raised) px-4 py-3 cq-body-sm font-medium text-(--cq-text-primary) shadow-(--cq-shadow-overlay) focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
        >
          Skip to content
        </a>
        <DesktopSidebar context={context} />
        <div className="cq-shell-body">
          <AppHeader context={context} />
          <NetworkStatus />
          <WakeIndicator />
          {verifyNudge === null ? null : (
            <div className="cq-verify-nudge-desktop justify-end px-6 pt-3">
              <VerifyNudgeLink nudge={verifyNudge} />
            </div>
          )}
          <main id="main" className="cq-shell-main">
            {children}
            <FictionalNames />
          </main>
          <MobileNavigation
            scope={context.scope}
            admin={context.admin === true}
            verifyNudge={verifyNudge}
          />
        </div>
      </div>
      {/* DOCS: the one owner of document-ready cards, on every page. */}
      <DocumentReadyCenter connected={qConnected} />
    </GlobalQProvider>
  );
}
