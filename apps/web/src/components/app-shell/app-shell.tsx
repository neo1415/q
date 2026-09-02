import type { ReactNode } from "react";

import { AppHeader } from "./app-header";
import { DesktopSidebar } from "./desktop-sidebar";
import { MobileNavigation } from "./mobile-navigation";
import { NetworkStatus } from "./network-status";

/**
 * The application shell. Server-rendered structure; only the pieces that
 * need the browser (current route, network state) are client components.
 *
 * Mobile: header → main → bottom navigation. Desktop: sidebar + workspace.
 * `main` carries the id the skip link targets.
 */
export function AppShell({ children }: { readonly children: ReactNode }) {
  return (
    <div className="cq-shell">
      <a
        href="#main"
        className="sr-only z-(--cq-z-toast) rounded-md bg-(--cq-surface-raised) px-4 py-3 cq-body-sm font-medium text-(--cq-text-primary) shadow-(--cq-shadow-overlay) focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Skip to content
      </a>
      <DesktopSidebar />
      <div className="cq-shell-body">
        <AppHeader />
        <NetworkStatus />
        <main id="main" className="cq-shell-main">
          {children}
        </main>
        <MobileNavigation />
      </div>
    </div>
  );
}
