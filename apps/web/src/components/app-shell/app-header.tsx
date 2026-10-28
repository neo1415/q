"use client";

import Link from "next/link";

import { ContextIndicator } from "@capital-q/ui/context-indicator";

import { NotificationCenter } from "@/features/work/notification-center";

import type { VerifyNudge } from "@/features/verification/verify-state";

import type { ShellContext } from "./app-shell";
import { MobileMenu, YouSheet } from "./mobile-navigation";
import { useT } from "@/features/i18n/language";

/**
 * Compact mobile top bar: the menu (owner 2026-10-28: no tab bar; the
 * sections open from it), wordmark, the current context (the scope, never
 * inside the input), notices, and You. You opens Profile, Usage, Settings,
 * Admin, who they act for, the theme (worded) and sign out: what the More
 * tab held before Work replaced it in the bar (owner-approved option B,
 * 2026-10-18; the theme left the header so a 360 px phone still fits the
 * wordmark, context, bell and You). Q is the floating dock on a phone
 * (ADR 0017 F1), not a header button. Hidden on desktop.
 */
export function AppHeader({
  context,
  verifyNudge = null,
}: {
  readonly context: ShellContext;
  readonly verifyNudge?: VerifyNudge | null | undefined;
}) {
  const t = useT();
  return (
    <header className="cq-shell-header">
      <div className="flex h-(--cq-header-height) items-center justify-between gap-3 px-4">
        <div className="flex min-w-0 items-center gap-1 -ms-2">
          <MobileMenu />
          <Link
            href="/home"
            className="cq-title-md inline-flex min-h-11 shrink-0 items-center rounded-xs whitespace-nowrap text-(--cq-text-primary)"
          >
            Capital Q
          </Link>
        </div>
        <div className="flex min-w-0 items-center gap-2">
          <ContextIndicator
            translate={t}
            scope={context.scope}
            detail={context.label}
            compact
          />
          <NotificationCenter />
          <YouSheet
            scope={context.scope}
            admin={context.admin === true}
            qPitch={context.qPitch === true}
            organisations={context.organisations ?? []}
            verifyNudge={verifyNudge}
          />
        </div>
      </div>
    </header>
  );
}
