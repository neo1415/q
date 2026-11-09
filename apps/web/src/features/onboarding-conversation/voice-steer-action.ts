"use server";

import { z } from "zod";

import { qApiSession } from "@/features/q/context";

/**
 * D86 (owner, 9 Nov): what Capital Q tells the live voice line after each
 * reading of their words: what it saved, what it could not save and why,
 * what waits for their yes, and the one thing to ask next. The onboarding
 * screen hands it to its live call (the call keeps speaking at once) and
 * shows the next question's choices. The person's own session only.
 */
const VoiceSteerSchema = z
  .object({
    id: z.string().min(1).max(40),
    text: z.string().min(1).max(3_000),
    askedStepKey: z.string().max(80).nullable(),
  })
  .strict();
export type VoiceSteer = z.infer<typeof VoiceSteerSchema>;

export async function voiceSteerAction(
  onboardingSessionId: unknown,
): Promise<VoiceSteer | null> {
  const id = z.string().uuid().safeParse(onboardingSessionId);
  if (!id.success) return null;
  const session = await qApiSession();
  if (session === null) return null;
  try {
    const response = await fetch(
      `${session.baseUrl.replace(/\/$/u, "")}/v1/q/voice/onboarding/${id.data}/steer`,
      {
        headers: { authorization: `Bearer ${session.accessToken}` },
        cache: "no-store",
      },
    );
    if (response.status !== 200) return null;
    const parsed = VoiceSteerSchema.safeParse(await response.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
