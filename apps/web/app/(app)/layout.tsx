import type { ReactNode } from "react";

import { loadWebServerConfig } from "@capital-q/config/web";

import { requireSessionUser } from "@/auth/session";
import { AppShell, type ShellContext } from "@/components/app-shell/app-shell";
import { resolveOwnContext } from "@/features/q/context";
import type { QSubject } from "@/features/q/q-subject";
import { InstallPrompt } from "@/pwa/install-prompt";

// Session-bound HTML is rendered per request and never prerendered or
// shared-cached (doc 15 s9.4).
export const dynamic = "force-dynamic";

/**
 * The application route group requires a session. The request proxy
 * redirects a signed-out visitor before rendering; this guard is the second
 * layer, so a route that somehow bypasses the proxy still never renders
 * application HTML without a verified session.
 *
 * The shell's context cue is resolved here from what Capital Q knows about
 * this person: a founder sees their company, an investor their
 * organisation, anyone else an honest "no context set".
 */
export default async function ApplicationLayout({
  children,
}: {
  children: ReactNode;
}): Promise<ReactNode> {
  await requireSessionUser();
  const context = await resolveOwnContext();
  const shell: ShellContext =
    context.kind === "FOUNDER"
      ? { scope: "founder_private", label: context.label ?? undefined }
      : context.kind === "INVESTOR"
        ? { scope: "investor_private", label: context.label ?? undefined }
        : { scope: "unset" };
  // The same resolution, as the subject Q looks at from any page.
  const subject: QSubject =
    context.kind === "FOUNDER"
      ? {
          kind: "COMPANY",
          companyId: context.companyId,
          label: context.label ?? undefined,
          scope: "founder_private",
        }
      : context.kind === "INVESTOR"
        ? {
            kind: "INVESTOR_ORGANISATION",
            investorOrganisationId: context.investorOrganisationId,
            label: context.label ?? undefined,
            scope: "investor_private",
          }
        : { kind: "NONE", scope: "unset" };
  const qConnected = loadWebServerConfig().qApiBaseUrl !== undefined;
  return (
    <AppShell context={shell} subject={subject} qConnected={qConnected}>
      {children}
      <InstallPrompt />
    </AppShell>
  );
}
