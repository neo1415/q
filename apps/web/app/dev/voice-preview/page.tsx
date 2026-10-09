import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { getSessionAccessToken } from "@/auth/session";
import {
  PageContainer,
  PageHeader,
  PageSection,
} from "@/components/app-shell/page-container";
import {
  voicePreviewAllowed,
  voicePreviewEnabled,
} from "@/features/voice/live/live-relay-proxy";
import { VoicePreview } from "@/features/voice/live/voice-preview";

export const metadata: Metadata = {
  title: "Voice preview",
  robots: { index: false },
};

export const dynamic = "force-dynamic";

/**
 * V: compare Q's voice lines side by side (developer only). Served only in
 * a local deployment with CQ_VOICE_PREVIEW=on, checked here on the server:
 * a production build answers 404 whatever the request says. Every line is
 * real provider audio and costs real money: the GPT-Live line is capped at
 * the Q API's CQ_VOICE_LIVE_MAX_SESSION_SECONDS (3 minutes by default).
 */
export default async function VoicePreviewPage() {
  if (!voicePreviewEnabled()) notFound();
  // Deployed, only the people the Q API names may see it (CQ_VOICE_LIVE_USERS).
  const signedInNow = (await getSessionAccessToken()) !== null;
  if (signedInNow && !(await voicePreviewAllowed())) notFound();
  const signedIn = (await getSessionAccessToken()) !== null;
  const flag = (name: string) => {
    const value = process.env[name]?.trim().toLowerCase();
    return value === "on" || value === "1" || value === "true";
  };
  return (
    <PageContainer>
      <PageHeader
        title="Voice preview"
        description="Developer only. Real provider audio, real cost: GPT-Live, the realtime duplex line and the standard line."
      />
      <PageSection id="voice-lines" title="Lines" titleHidden>
        {signedIn ? (
          <VoicePreview
            available={{
              A: true,
              B: flag("CQ_VOICE_REALTIME"),
              C: true,
            }}
          />
        ) : (
          <p className="cq-body">Sign in first: every line runs as you.</p>
        )}
      </PageSection>
    </PageContainer>
  );
}
