import type { Metadata } from "next";

import { connectOutcome } from "@/features/integrations/connect-popup";
import { ConnectReturn } from "@/features/integrations/connect-return";

export const metadata: Metadata = { title: "Google" };
export const dynamic = "force-dynamic";

/**
 * Q room W4b: where Google returns the small connect window. It tells the
 * room how it went and closes; it reads and shows nothing else. The room
 * asks the server for the real connection state before it believes this.
 */
export default async function GoogleConnectedPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  return <ConnectReturn outcome={connectOutcome(params["google"])} />;
}
