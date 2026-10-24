import { Suspense, type ReactNode } from "react";

import { loadWebServerConfig } from "@capital-q/config/web";

import { requireSessionUser } from "@/auth/session";
import { AppShell, type ShellContext } from "@/components/app-shell/app-shell";
import { redirect } from "next/navigation";

import {
  onboardingGate,
  onboardingPath,
  resolveOnboardingState,
  resolveOwnContext,
  resolveQStanding,
} from "@/features/q/context";
import { QControlRuntime } from "@/features/q/control/q-control-runtime";
import type { QSubject } from "@/features/q/q-subject";
import { QSwarmPointer } from "@/features/q-swarm/q-swarm-pointer";
import { loadVerifyNudge } from "@/features/verification/verify-nudge-loader";
import { adminContext } from "@/features/admin/admin-context";
import { BrandStyle, loadBrandStyle } from "@/features/brand-theme/brand-style";
import { InstallPrompt } from "@/pwa/install-prompt";
import { SearchPalette } from "@/features/search/search-palette";
import { loadMyOrganisations } from "@/features/team/load-organisations";
import { CapabilitiesProvider } from "@/features/organisation/capabilities";
import { loadMyCapabilities } from "@/features/organisation/load-capabilities";
import { PitchWarmup } from "@/features/discover/player/pitch-warmup-trigger";
import { qPitchEnabled } from "@/features/q-pitch/flag";
import { QPitchEntrySlot } from "@/features/q-pitch/tour-entry-slot";
import { LanguageProvider } from "@/features/i18n/language";
import { machineUiText } from "@/features/i18n/machine";
import { uiLanguageOf } from "@/features/i18n/messages";

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
  const user = await requireSessionUser();
  const qConnected = loadWebServerConfig().qApiBaseUrl !== undefined;
  // Every read the shell needs, asked side by side (L1 latency sweep,
  // 2026-10-06): context, standing, onboarding (two journeys), KYB, admin
  // and brand were five or six API round trips one after another before
  // any page could paint. Each is a read; what decides is unchanged below.
  const standingRead = qConnected ? resolveQStanding() : Promise.resolve(null);
  const onboardingRead = qConnected ? resolveOnboardingState() : null;
  onboardingRead?.catch(() => undefined);
  const verifyRead = loadVerifyNudge();
  // Only awaited when it is shown; never an unhandled rejection otherwise.
  verifyRead.catch(() => undefined);
  const adminRead = adminContext()
    .then((found) => found !== null)
    .catch(() => false);
  const brandRead = loadBrandStyle().catch(() => null);
  // What they may do in their active organisation, read once per request
  // and handed to client controls (presentation only; the API decides).
  const capabilitiesRead = loadMyCapabilities();
  const context = await resolveOwnContext();
  const qPitch = qPitchEnabled();
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
  // Founder direction 2026-09-30: nobody uses Capital Q before Q has onboarded
  // them. Until then the navigation is one way back to Q; a page Q sent them
  // to while they are not ready stays readable, nothing else is offered.
  // An account Q paused sees nothing but that it is paused, until a person
  // at Capital Q reinstates it.
  const standing = await standingRead;
  if (standing?.paused === true) {
    redirect("/paused");
  }
  const onboardingState = onboardingRead === null ? null : await onboardingRead;
  // Setup not finished (or not started): some extras wait for it.
  const unfinished =
    onboardingState === null ? null : onboardingPath(onboardingState);
  // Owner 2026-10-16: the app is fully usable with setup incomplete. Only
  // somebody who has not chosen a journey at all is held to the way in;
  // an unfinished setup keeps the whole shell, and is offered back on Home.
  const gate =
    onboardingState === null ? null : onboardingGate(onboardingState);
  // ADMIN-4 block: "Verify you and <organisation>" stays in the shell until
  // both the person and the organisation are verified. A read that fails
  // shows nothing rather than a wrong state.
  // WORK-58: the Admin group shows only to a platform admin, decided by
  // the API (the console's own route refuses anyone else regardless).
  // P5: the brand colour, read alongside so it paints with the first frame.
  const [verifyNudgeState, admin, brandCss, organisations, capabilities] =
    await Promise.all([
      unfinished === null && context.kind !== "NONE"
        ? verifyRead
        : Promise.resolve(null),
      adminRead,
      brandRead,
      // G2: the switcher's list (shown only for two or more).
      loadMyOrganisations(),
      capabilitiesRead,
    ]);
  // Any language: the interface follows the language they chose; Q's
  // machine translations fill what no hand catalogue covers.
  const language = uiLanguageOf(standing?.language);
  const machine = await machineUiText(language);
  return (
    <LanguageProvider language={language} machine={machine}>
      <CapabilitiesProvider value={capabilities}>
        <AppShell
          context={{ ...shell, admin, organisations, qPitch }}
          subject={subject}
          qConnected={qConnected}
          onboarding={gate}
          verifyNudge={verifyNudgeState}
        >
          <BrandStyle css={brandCss} />
          {children}
          <InstallPrompt />
          {/* Search as a palette (app prototype "search", option 2): / from
            any page opens it over what the person is doing. */}
          <SearchPalette viewer={user.authUserId} />
          {/* An investor's first pitches, cached before Discover opens (ADR 0064). */}
          {context.kind === "INVESTOR" && unfinished === null ? (
            <PitchWarmup />
          ) : null}
          <QSwarmPointer />
          {/* Q Pitch host (QP-F08): off unless the server enables it; then
          for any signed-in account (owner, 23 Oct). The story shows other
          accounts stills of fictional pages, never their own; the v6
          tracks still admit only fictional demo accounts. Its subject read
          streams after the page and never holds the first byte. */}
          {/* QO-37 (live 2026-10-23, a new founder): with setup unfinished
            the host was not mounted, so "Hey Q, pitch yourself" got Q's
            self-introduction. The app is usable with setup unfinished
            (owner, 2026-10-16) and the story only ever starts when asked,
            so it is held for every account. */}
          {qPitch ? (
            <Suspense fallback={null}>
              <QPitchEntrySlot
                account={user.email ?? ""}
                role={context.kind === "FOUNDER" ? "FOUNDER" : "INVESTOR"}
              />
            </Suspense>
          ) : null}
          {/* RECOVERY-2026-10 (C): Q's control of the page -- the route trail,
          receipts to the Q API, and the notice when an act did not happen. */}
          <Suspense fallback={null}>
            <QControlRuntime
              viewer={{
                kind:
                  context.kind === "FOUNDER" || context.kind === "INVESTOR"
                    ? context.kind
                    : "NONE",
                admin,
              }}
            />
          </Suspense>
        </AppShell>
      </CapabilitiesProvider>
    </LanguageProvider>
  );
}
