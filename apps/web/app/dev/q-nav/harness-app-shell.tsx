"use client";

import type { ReactNode } from "react";

import { AppHeader } from "@/components/app-shell/app-header";
import type { ShellContext } from "@/components/app-shell/app-shell";
import { ShellPhoneLeadProvider } from "@/components/app-shell/phone-lead";

const CONTEXT: ShellContext = {
  scope: "investor_private",
  label: "Personal investing",
};

/**
 * `?shell=1`: the signed-in shell's phone header and the shell context
 * around the Q page, so the Q home's one phone top bar (owner 2026-11-06)
 * can be seen and tested as the app renders it. Fictional context only.
 */
export function HarnessAppShell({
  children,
}: {
  readonly children: ReactNode;
}) {
  return (
    <div className="cq-shell" data-harness-app-shell>
      <div className="cq-shell-body">
        <AppHeader context={CONTEXT} />
        <main className="cq-shell-main">
          <ShellPhoneLeadProvider context={CONTEXT}>
            {children}
          </ShellPhoneLeadProvider>
        </main>
      </div>
    </div>
  );
}
