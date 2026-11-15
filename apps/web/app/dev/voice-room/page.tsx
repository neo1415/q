import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { VoiceRoomHarness } from "./voice-room-harness";

// Read per request: the harness's gate is the running server's setting.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Voice room harness",
  robots: { index: false },
};

/**
 * Owner audit 2026-11-15, Phase 4: the Q view's voice room -- the same
 * layout, presence, captions and answer stage the Q page draws -- over a
 * simulated voice line: a fake speaker level and growing captions, and
 * the dev cards fixture as the result. No audio, no provider, no Q.
 * `?result=1` starts with the cards up; `?speaking=1` starts Q speaking.
 *
 * Development only; a production build serves it only when
 * CQ_DEV_PREVIEW=1 is set on that server.
 */
export default async function VoiceRoomHarnessPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (
    process.env.NODE_ENV === "production" &&
    process.env["CQ_DEV_PREVIEW"] !== "1"
  ) {
    notFound();
  }
  const params = await searchParams;
  return (
    <VoiceRoomHarness
      initialResult={params["result"] === "1"}
      initialSpeaking={params["speaking"] === "1"}
    />
  );
}
