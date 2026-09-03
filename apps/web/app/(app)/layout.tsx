import type { ReactNode } from "react";

import { requireSessionUser } from "@/auth/session";
import { AppShell } from "@/components/app-shell/app-shell";

// Session-bound HTML is rendered per request and never prerendered or
// shared-cached (doc 15 s9.4).
export const dynamic = "force-dynamic";

/**
 * The application route group requires a session. The request proxy
 * redirects a signed-out visitor before rendering; this guard is the second
 * layer, so a route that somehow bypasses the proxy still never renders
 * application HTML without a verified session.
 */
export default async function ApplicationLayout({
  children,
}: {
  children: ReactNode;
}): Promise<ReactNode> {
  await requireSessionUser();
  return <AppShell>{children}</AppShell>;
}
