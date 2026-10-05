import type { ReactNode } from "react";

import { loadWebServerConfig } from "@capital-q/config/web";

import { requireSessionUser } from "@/auth/session";
import { AppShell, type ShellContext } from "@/components/app-shell/app-shell";
import { redirect } from "next/navigation";

import {
  onboardingPath,
  resolveOnboardingState,
  resolveOwnContext,
  resolveQStanding,
} from "@/features/q/context";
import type { QSubject } from "@/features/q/q-subject";
import { QSwarmPointer } from "@/features/q-swarm/q-swarm-pointer";
import { loadVerifyNudge } from "@/features/verification/verify-nudge-loader";
import { adminContext } from "@/features/admin/admin-context";
import { BrandStyle, loadBrandStyle } from "@/features/brand-theme/brand-style";
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
  // Founder direction 2026-09-30: nobody uses Capital Q before Q has onboarded
  // them. Until then the navigation is one way back to Q; a page Q sent them
  // to while they are not ready stays readable, nothing else is offered.
  // An account Q paused sees nothing but that it is paused, until a person
  // at Capital Q reinstates it.
  if (qConnected && (await resolveQStanding())?.paused === true) {
    redirect("/paused");
  }
  const unfinished = qConnected
    ? onboardingPath(await resolveOnboardingState())
    : null;
  // ADMIN-4 block: "Verify you and <organisation>" stays in the shell until
  // both the person and the organisation are verified. A read that fails
  // shows nothing rather than a wrong state.
  // WORK-58: the Admin group shows only to a platform admin, decided by
  // the API (the console's own route refuses anyone else regardless).
  // P5: the brand colour, read alongside so it paints with the first frame.
  const [verifyNudgeState, admin, brandCss] = await Promise.all([
    unfinished === null && context.kind !== "NONE"
      ? loadVerifyNudge()
      : Promise.resolve(null),
    adminContext()
      .then((found) => found !== null)
      .catch(() => false),
    loadBrandStyle().catch(() => null),
  ]);
  return (
    <AppShell
      context={{ ...shell, admin }}
      subject={subject}
      qConnected={qConnected}
      onboarding={unfinished}
      verifyNudge={verifyNudgeState}
    >
      <BrandStyle css={brandCss} />
      {children}
      <InstallPrompt />
      <QSwarmPointer />
    </AppShell>
  );
}
