"use client";

import { createContext, useContext, type ReactNode } from "react";

import { ContextIndicator } from "@capital-q/ui/context-indicator";

import type { VerifyNudge } from "@/features/verification/verify-state";
import { NotificationCenter } from "@/features/work/notification-center";
import { useT } from "@/features/i18n/language";

import type { ShellContext } from "./app-shell";
import { MobileMenu, YouSheet } from "./mobile-navigation";

type PhoneLead = {
  readonly context: ShellContext;
  readonly verifyNudge: VerifyNudge | null;
};

const PhoneLeadContext = createContext<PhoneLead | null>(null);

/** The shell's context, for a page that draws its own phone top bar. */
export function ShellPhoneLeadProvider({
  context,
  verifyNudge = null,
  children,
}: {
  readonly context: ShellContext;
  readonly verifyNudge?: VerifyNudge | null | undefined;
  readonly children: ReactNode;
}) {
  return (
    <PhoneLeadContext.Provider value={{ context, verifyNudge }}>
      {children}
    </PhoneLeadContext.Provider>
  );
}

/**
 * Owner 2026-11-06 (Q home like ChatGPT): on a phone the Q home has one
 * slim top bar, so the shell's own header steps aside there (globals.css)
 * and the Q home draws this menu button at its start instead. Nothing the
 * header held is lost: the drawer's first row is the scope ("Private"),
 * the notices bell and You, each one tap from the open drawer. Null
 * outside the signed-in shell (the dev harness without `?shell=1`).
 */
export function PhoneShellLead() {
  const lead = useContext(PhoneLeadContext);
  const t = useT();
  if (lead === null) return null;
  const { context, verifyNudge } = lead;
  return (
    <MobileMenu
      extras={
        <div
          className="mb-3 flex items-center justify-between gap-2 border-b border-(--cq-border-subtle) px-1 pb-3"
          data-nav-shell-controls
        >
          <ContextIndicator
            translate={t}
            scope={context.scope}
            detail={context.label}
            compact
          />
          <div className="flex items-center gap-1">
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
      }
    />
  );
}
