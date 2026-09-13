import type { ReactNode } from "react";

import { requireSessionUser } from "@/auth/session";
import { AppShell, type ShellContext } from "@/components/app-shell/app-shell";
import { resolveOwnContext } from "@/features/q/context";

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
  return <AppShell context={shell}>{children}</AppShell>;
}
